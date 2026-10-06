import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { serializeUser } from "../lib/serialize.js";
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

  const profile = {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split("@")[0],
    photoUrl: payload.picture ?? null,
  };

  const user = await prisma.user.upsert({
    where: { googleId: payload.sub },
    create: { googleId: payload.sub, ...profile },
    update: profile,
  });

  res.json({ token: signToken(user.id), user: serializeUser(user) });
});

export default router;
