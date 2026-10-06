import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { userInclude } from "../lib/serialize.js";

function unauthorized(res) {
  return res.status(401).json({ error: "unauthorized" });
}

export async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return unauthorized(res);

  let payload;
  try {
    payload = verifyToken(match[1].trim());
  } catch {
    return unauthorized(res);
  }
  if (!payload || typeof payload.sub !== "string") return unauthorized(res);

  const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: userInclude });
  if (!user) return unauthorized(res);

  req.user = user;
  next();
}
