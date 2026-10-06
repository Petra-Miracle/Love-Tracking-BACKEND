import jwt from "jsonwebtoken";

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET belum di-set");
  return s;
}

export function signToken(userId) {
  return jwt.sign({ sub: userId }, secret(), { algorithm: "HS256", expiresIn: "60d" });
}

export function verifyToken(token) {
  return jwt.verify(token, secret(), { algorithms: ["HS256"] });
}
