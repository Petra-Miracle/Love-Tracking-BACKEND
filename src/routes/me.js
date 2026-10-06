import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { coupleChannel, safeTrigger } from "../lib/pusher.js";
import {
  publicBaseUrl,
  serializeCouple,
  serializeStatus,
  serializeUser,
  userInclude,
} from "../lib/serialize.js";
import { HttpError, formatZodError } from "../lib/errors.js";

const router = Router();

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// GET /me — profil, pasangan, dan status terakhir keduanya.
router.get("/", async (req, res) => {
  const me = req.user;
  const baseUrl = publicBaseUrl(req);

  const [myStatus, couple] = await Promise.all([
    prisma.status.findUnique({ where: { userId: me.id } }),
    me.coupleId
      ? prisma.couple.findUnique({
          where: { id: me.coupleId },
          include: { members: { include: { status: true, ...userInclude } } },
        })
      : null,
  ]);

  const partner = couple?.members.find((m) => m.id !== me.id) ?? null;

  res.json({
    user: serializeUser(me, baseUrl),
    couple: serializeCouple(couple),
    partner: serializeUser(partner, baseUrl),
    partnerStatus: serializeStatus(partner?.status),
    myStatus: serializeStatus(myStatus),
  });
});

// Kirim profil terbaru ke response, dan ke pasangan lewat Pusher jika berpasangan.
async function respondWithProfile(req, res, user) {
  const payload = { user: serializeUser(user, publicBaseUrl(req)) };
  if (user.coupleId) {
    await safeTrigger(coupleChannel(user.coupleId), "profile-updated", payload);
  }
  res.json(payload);
}

const patchSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "nama tidak boleh kosong").max(40, "nama maksimal 40 karakter")),
});

// PATCH /me — ganti nama.
router.patch("/", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_body", formatZodError(parsed.error));

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { name: parsed.data.name, nameCustomized: true },
    include: userInclude,
  });

  await respondWithProfile(req, res, user);
});

// PUT /me/photo — upload foto profil sebagai raw body.
router.put(
  "/photo",
  (req, res, next) => {
    // Dicek dari header langsung: req.is() mengembalikan null untuk body kosong (harusnya 400, bukan 415).
    const mimeType = (req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!PHOTO_TYPES.includes(mimeType)) throw new HttpError(415, "unsupported_media_type");
    res.locals.mimeType = mimeType;
    next();
  },
  express.raw({ type: PHOTO_TYPES, limit: "1mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, "invalid_body", "body foto kosong");
    }

    const mimeType = res.locals.mimeType;
    const data = req.body;

    await prisma.userPhoto.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, mimeType, data },
      update: { mimeType, data },
    });

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: userInclude });
    await respondWithProfile(req, res, user);
  },
);

// DELETE /me/photo — hapus foto upload, kembali ke foto Google.
router.delete("/photo", async (req, res) => {
  await prisma.userPhoto.deleteMany({ where: { userId: req.user.id } });
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: userInclude });
  await respondWithProfile(req, res, user);
});

export default router;
