// Ubah model Prisma -> objek JSON sesuai kontrak API.
// JANGAN pernah mengirim googleId / coupleId di objek User.

// Relasi yang wajib dimuat setiap kali mengambil User untuk serializeUser.
// Hanya updatedAt — kolom `data` (bytes foto) tidak boleh ikut dimuat.
export const userInclude = { photo: { select: { updatedAt: true } } };

// Base URL publik untuk membentuk URL foto. PUBLIC_BASE_URL diutamakan,
// fallback ke protocol + host dari request.
export function publicBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

export function serializeUser(user, baseUrl) {
  if (!user) return null;
  const photoUrl = user.photo
    ? `${baseUrl}/users/${user.id}/photo?v=${user.photo.updatedAt.getTime()}`
    : (user.photoUrl ?? null);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    photoUrl,
  };
}

export function serializeStatus(status) {
  if (!status) return null;
  return {
    userId: status.userId,
    lat: status.lat ?? null,
    lng: status.lng ?? null,
    accuracy: status.accuracy ?? null,
    speed: status.speed ?? null,
    heading: status.heading ?? null,
    battery: status.battery ?? null,
    batteryState: status.batteryState,
    networkType: status.networkType,
    carrier: status.carrier ?? null,
    mobileNetworkGen: status.mobileNetworkGen ?? null,
    sharingPaused: status.sharingPaused,
    updatedAt: status.updatedAt.toISOString(),
  };
}

export function serializeCouple(couple) {
  if (!couple) return null;
  return {
    id: couple.id,
    createdAt: couple.createdAt.toISOString(),
  };
}
