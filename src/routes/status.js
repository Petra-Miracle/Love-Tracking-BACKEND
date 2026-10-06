import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { coupleChannel, safeTrigger } from "../lib/pusher.js";
import { serializeStatus } from "../lib/serialize.js";
import { HttpError, formatZodError } from "../lib/errors.js";

const router = Router();

const statusSchema = z.object({
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  accuracy: z.number().min(0).nullish(),
  speed: z.number().nullish(),
  heading: z.number().nullish(),
  battery: z.number().int().min(0).max(100).nullish(),
  batteryState: z.enum(["charging", "discharging", "full", "unknown"]).nullish(),
  networkType: z.enum(["wifi", "mobile", "ethernet", "vpn", "other", "none"]).nullish(),
  carrier: z.string().max(64).nullish(),
  mobileNetworkGen: z.enum(["2G", "3G", "4G", "5G"]).nullish(),
  sharingPaused: z.boolean(),
});

// Rate limit ringan, per instance (best-effort di serverless): maks 1 request / 2 detik / user.
const RATE_WINDOW_MS = 2000;
const lastRequestAt = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const last = lastRequestAt.get(userId);
  if (last !== undefined && now - last < RATE_WINDOW_MS) return true;
  lastRequestAt.set(userId, now);
  if (lastRequestAt.size > 10_000) {
    for (const [id, t] of lastRequestAt) if (now - t >= RATE_WINDOW_MS) lastRequestAt.delete(id);
  }
  return false;
}

// PUT /status — simpan status terakhir & broadcast ke pasangan.
router.put("/", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_body", formatZodError(parsed.error));

  const me = req.user;
  if (isRateLimited(me.id)) throw new HttpError(429, "too_many_requests");

  const b = parsed.data;
  const paused = b.sharingPaused;

  const data = {
    // Saat dijeda, lokasi TIDAK disimpan.
    lat: paused ? null : (b.lat ?? null),
    lng: paused ? null : (b.lng ?? null),
    accuracy: paused ? null : (b.accuracy ?? null),
    speed: paused ? null : (b.speed ?? null),
    heading: paused ? null : (b.heading ?? null),
    battery: b.battery ?? null,
    batteryState: b.batteryState ?? "unknown",
    networkType: b.networkType ?? "none",
    carrier: b.carrier ?? null,
    mobileNetworkGen: b.mobileNetworkGen ?? null,
    sharingPaused: paused,
  };

  const status = await prisma.status.upsert({
    where: { userId: me.id },
    create: { userId: me.id, ...data },
    update: data,
  });

  const payload = serializeStatus(status);

  if (me.coupleId) {
    await safeTrigger(coupleChannel(me.coupleId), "status-updated", payload);
  }

  res.json({ status: payload });
});

export default router;
