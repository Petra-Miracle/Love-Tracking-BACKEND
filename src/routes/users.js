import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/errors.js";

const router = Router();

// GET /users/:userId/photo — PUBLIK (dipakai Image.network tanpa header Authorization).
// ID user berupa cuid yang tidak bisa ditebak; URL selalu memuat ?v=<updatedAt>
// sehingga aman di-cache selamanya.
router.get("/:userId/photo", async (req, res) => {
  const photo = await prisma.userPhoto.findUnique({
    where: { userId: req.params.userId },
    select: { mimeType: true, data: true },
  });
  if (!photo) throw new HttpError(404, "not_found");

  res.set({
    "Content-Type": photo.mimeType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(Buffer.from(photo.data));
});

export default router;
