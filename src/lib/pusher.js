import Pusher from "pusher";

let instance;

// Dibuat lazily agar app (mis. GET /health) tetap jalan walau env Pusher belum diisi.
export function getPusher() {
  if (!instance) {
    instance = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER || "ap1",
      useTLS: true,
    });
  }
  return instance;
}

// Kegagalan Pusher tidak boleh menggagalkan request: log saja.
// Tetap di-await oleh pemanggil karena di serverless promise yang menggantung bisa terputus.
export async function safeTrigger(channel, event, data) {
  try {
    await getPusher().trigger(channel, event, data);
  } catch (err) {
    console.error(`[pusher] trigger ${event} -> ${channel} gagal:`, err?.message ?? err);
  }
}

export const userChannel = (userId) => `private-user-${userId}`;
export const coupleChannel = (coupleId) => `private-couple-${coupleId}`;
