import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { publicBaseUrl, serializeUser, userInclude } from "../lib/serialize.js";
import { HttpError, formatZodError } from "../lib/errors.js";

const router = Router();
const googleClient = new OAuth2Client();

const bodySchema = z.object({ idToken: z.string().min(1) });

// POST /auth/google — tukar Google ID token dengan JWT aplikasi.
router.post("/google", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_body", formatZodError(parsed.error));

  const audience = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!audience) throw new Error("GOOGLE_WEB_CLIENT_ID belum di-set");

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: parsed.data.idToken, audience });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, "invalid_google_token");
  }
  if (!payload?.sub || !payload.email) throw new HttpError(401, "invalid_google_token");

  const email = payload.email.toLowerCase();
  const googleName = payload.name || email.split("@")[0];
  const photoUrl = payload.picture ?? null;

  const user = await upsertGoogleUser(payload.sub, { email, googleName, photoUrl });

  res.json({ token: signToken(user.id), user: serializeUser(user, publicBaseUrl(req)) });
});

// User baru: isi nama & foto dari Google.
// User lama: selalu perbarui email & foto Google, tapi nama hanya jika belum diganti user sendiri.
async function upsertGoogleUser(googleId, { email, googleName, photoUrl }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await prisma.user.findUnique({
      where: { googleId },
      select: { id: true, nameCustomized: true },
    });

    if (existing) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { email, photoUrl, ...(existing.nameCustomized ? {} : { name: googleName }) },
        include: userInclude,
      });
    }

    try {
      return await prisma.user.create({
        data: { googleId, email, name: googleName, photoUrl },
        include: userInclude,
      });
    } catch (err) {
      // Login pertama paralel dari akun yang sama: baris sudah dibuat request lain -> ulangi sebagai update.
      if (err?.code === "P2002" && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("Gagal menyimpan user");
}

export default router;
