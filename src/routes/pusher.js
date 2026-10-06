import { Router } from "express";
import { z } from "zod";
import { coupleChannel, getPusher, userChannel } from "../lib/pusher.js";
import { HttpError, formatZodError } from "../lib/errors.js";

const router = Router();

const bodySchema = z.object({
  socket_id: z.string().regex(/^\d+\.\d+$/, "socket_id tidak valid"),
  channel_name: z.string().min(1).max(200),
});

// POST /pusher/auth — otorisasi private channel (JSON atau form-urlencoded).
router.post("/auth", (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_body", formatZodError(parsed.error));
  const { socket_id, channel_name } = parsed.data;

  const allowed = new Set([userChannel(req.user.id)]);
  if (req.user.coupleId) allowed.add(coupleChannel(req.user.coupleId));

  if (!allowed.has(channel_name)) throw new HttpError(403, "forbidden");

  res.json(getPusher().authorizeChannel(socket_id, channel_name));
});

export default router;
