import express from "express";
import cors from "cors";
import { requireAuth } from "./middleware/auth.js";
import { HttpError } from "./lib/errors.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import inviteRoutes from "./routes/invites.js";
import coupleRoutes from "./routes/couple.js";
import statusRoutes from "./routes/status.js";
import pusherRoutes from "./routes/pusher.js";
import userRoutes from "./routes/users.js";

const app = express();

app.disable("x-powered-by");
// Di Vercel request datang lewat proxy; perlu agar req.protocol = "https" (fallback URL foto).
app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false }));

// Publik
app.get("/", (req, res) => res.json({ name: "Love Tracking API", ok: true }));
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/auth", authRoutes);
app.use("/users", userRoutes);

// Wajib JWT
app.use("/me", requireAuth, meRoutes);
app.use("/invites", requireAuth, inviteRoutes);
app.use("/couple", requireAuth, coupleRoutes);
app.use("/status", requireAuth, statusRoutes);
app.use("/pusher", requireAuth, pusherRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

// Error handler terpusat -> { error, message }
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    const body = { error: err.code };
    if (err.publicMessage) body.message = err.publicMessage;
    return res.status(err.status).json(body);
  }

  // Error dari body-parser (JSON rusak, body terlalu besar, dll.)
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid_body", message: "JSON tidak valid" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large" });
  }
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: "bad_request", message: err.message });
  }

  console.error(err);
  const body = { error: "internal_error" };
  if (process.env.NODE_ENV !== "production") body.message = err?.message;
  res.status(500).json(body);
});

export default app;
