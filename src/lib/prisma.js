import { PrismaClient } from "@prisma/client";

// Satu instance per proses: di serverless (Vercel) modul bisa dievaluasi ulang
// saat hot-reload / reuse, jadi simpan di globalThis agar koneksi tidak berlipat.
const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

globalForPrisma.__prisma = prisma;
