import { randomInt } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { safeTrigger, userChannel } from "../lib/pusher.js";
import { serializeCouple, serializeStatus, serializeUser } from "../lib/serialize.js";
import { HttpError, formatZodError } from "../lib/errors.js";

const router = Router();

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 10;

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

function isUniqueViolation(err) {
  return err?.code === "P2002";
}

// POST /invites — buat (atau ganti) kode undangan milik user.
router.post("/", async (req, res) => {
  const me = req.user;
  if (me.coupleId) throw new HttpError(409, "already_paired");

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    try {
      const [, invite] = await prisma.$transaction([
        prisma.invite.deleteMany({ where: { inviterId: me.id } }),
        prisma.invite.create({ data: { code, inviterId: me.id, expiresAt } }),
      ]);
      return res.status(201).json({
        code: invite.code,
        expiresAt: invite.expiresAt.toISOString(),
        link: `lovetracking://invite?code=${invite.code}`,
      });
    } catch (err) {
      // Bentrok kode (atau request paralel dari user yang sama) -> coba lagi dengan kode baru.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error("Gagal membuat kode undangan unik");
});

const acceptSchema = z.object({
  code: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().min(1).max(32)),
});

// POST /invites/accept — terima undangan dan bentuk pasangan.
router.post("/accept", async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_body", formatZodError(parsed.error));
  const { code } = parsed.data;
  const me = req.user;

  // Pemeriksaan awal untuk kode error yang tepat.
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: { inviter: { select: { coupleId: true } } },
  });
  if (!invite || invite.expiresAt <= new Date()) throw new HttpError(404, "invite_not_found");
  if (invite.inviterId === me.id) throw new HttpError(400, "own_invite");
  if (me.coupleId || invite.inviter.coupleId) throw new HttpError(409, "already_paired");

  const inviterId = invite.inviterId;

  // Semua pengecekan diulang secara atomik di dalam transaksi dengan DELETE/UPDATE bersyarat,
  // sehingga request paralel tidak bisa memakai invite dua kali atau membuat pasangan > 2 orang.
  const couple = await prisma.$transaction(async (tx) => {
    // Klaim invite: hanya satu transaksi yang berhasil menghapusnya.
    const claimed = await tx.invite.deleteMany({
      where: { code, inviterId, expiresAt: { gt: new Date() } },
    });
    if (claimed.count !== 1) throw new HttpError(404, "invite_not_found");

    const created = await tx.couple.create({ data: {} });

    // Kunci baris user dalam urutan id yang konsisten untuk menghindari deadlock
    // (mis. A menerima undangan B bersamaan dengan B menerima undangan A).
    for (const userId of [me.id, inviterId].sort()) {
      const updated = await tx.user.updateMany({
        where: { id: userId, coupleId: null },
        data: { coupleId: created.id },
      });
      if (updated.count !== 1) throw new HttpError(409, "already_paired");
    }

    // Invite lain milik penerima tidak relevan lagi.
    await tx.invite.deleteMany({ where: { inviterId: me.id } });

    return created;
  });

  const [inviter, acceptor] = await Promise.all([
    prisma.user.findUnique({ where: { id: inviterId }, include: { status: true } }),
    prisma.user.findUnique({ where: { id: me.id }, include: { status: true } }),
  ]);

  await safeTrigger(userChannel(inviterId), "couple-paired", {
    couple: serializeCouple(couple),
    partner: serializeUser(acceptor),
    partnerStatus: serializeStatus(acceptor.status),
  });

  res.json({
    couple: serializeCouple(couple),
    partner: serializeUser(inviter),
    partnerStatus: serializeStatus(inviter.status),
  });
});

export default router;
