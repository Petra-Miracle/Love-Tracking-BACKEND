import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { coupleChannel, safeTrigger, userChannel } from "../lib/pusher.js";
import { HttpError } from "../lib/errors.js";

const router = Router();

// DELETE /couple — putuskan pasangan.
router.delete("/", async (req, res) => {
  const coupleId = req.user.coupleId;
  if (!coupleId) throw new HttpError(404, "not_paired");

  const memberIds = await prisma.$transaction(async (tx) => {
    const members = await tx.user.findMany({ where: { coupleId }, select: { id: true } });
    if (members.length === 0) throw new HttpError(404, "not_paired");
    const ids = members.map((m) => m.id);

    await tx.user.updateMany({ where: { coupleId }, data: { coupleId: null } });
    // Privasi: hapus status terakhir kedua user.
    await tx.status.deleteMany({ where: { userId: { in: ids } } });
    await tx.couple.deleteMany({ where: { id: coupleId } });
    return ids;
  });

  const partnerId = memberIds.find((id) => id !== req.user.id);

  await Promise.all([
    safeTrigger(coupleChannel(coupleId), "couple-unpaired", {}),
    partnerId ? safeTrigger(userChannel(partnerId), "couple-unpaired", {}) : null,
  ]);

  res.status(204).end();
});

export default router;
