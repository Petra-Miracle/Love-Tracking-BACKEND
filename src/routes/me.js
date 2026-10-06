import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { serializeCouple, serializeStatus, serializeUser } from "../lib/serialize.js";

const router = Router();

// GET /me — profil, pasangan, dan status terakhir keduanya.
router.get("/", async (req, res) => {
  const me = req.user;

  const [myStatus, couple] = await Promise.all([
    prisma.status.findUnique({ where: { userId: me.id } }),
    me.coupleId
      ? prisma.couple.findUnique({
          where: { id: me.coupleId },
          include: { members: { include: { status: true } } },
        })
      : null,
  ]);

  const partner = couple?.members.find((m) => m.id !== me.id) ?? null;

  res.json({
    user: serializeUser(me),
    couple: serializeCouple(couple),
    partner: serializeUser(partner),
    partnerStatus: serializeStatus(partner?.status),
    myStatus: serializeStatus(myStatus),
  });
});

export default router;
