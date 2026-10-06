// Ubah model Prisma -> objek JSON sesuai kontrak API.
// JANGAN pernah mengirim googleId / coupleId di objek User.

export function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    photoUrl: user.photoUrl ?? null,
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
