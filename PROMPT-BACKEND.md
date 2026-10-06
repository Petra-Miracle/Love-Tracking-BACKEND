# Prompt: Build Backend "Love Tracking" (Express.js + Pusher + Neon Postgres + Vercel)

Kamu adalah senior Node.js backend engineer. Bangun backend untuk aplikasi **Love Tracking** — aplikasi Android (Flutter) untuk pasangan (tepat 2 pengguna per pasangan) yang saling berbagi **lokasi real-time, status baterai, dan status jaringan/operator seluler**.

Frontend Flutter **sudah dibangun** dan bergantung pada **kontrak API di bawah ini secara persis** (path, method, nama field JSON, nama channel & event Pusher). **Jangan mengubah kontrak** tanpa alasan kuat; jika harus, tulis perubahannya di `CHANGES.md`.

Root folder proyek: `D:\Love-Tracking-BACKEND` (bangun langsung di folder ini).

---

## 1. Tech Stack (wajib)

| Kebutuhan | Pilihan                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Runtime   | Node.js 20+ (JavaScript ESM, atau TypeScript jika kamu mau — tetap compile ke Vercel)                                     |
| Framework | **Express 5**                                                                                                        |
| Database  | **PostgreSQL di Neon** (neon.tech, free tier)                                                                        |
| ORM       | **Prisma 6.19.x** (pin versi 6 — JANGAN Prisma 7/8, API config-nya berbeda)                                         |
| Realtime  | **Pusher Channels** (paket `pusher` server SDK), free Sandbox plan                                                 |
| Auth      | Verifikasi**Google ID Token** (`google-auth-library`) → terbitkan **JWT sendiri** (`jsonwebtoken`, HS256) |
| Validasi  | `zod`                                                                                                                    |
| Hosting   | **Vercel** (Express dijalankan sebagai serverless function)                                                          |

Tidak ada WebSocket server sendiri — semua realtime lewat Pusher (server `trigger`, client `subscribe`).

---

## 2. Environment Variables

Buat `.env.example` (dan pastikan `.env` ada di `.gitignore`):

```
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require   # Neon pooled connection
DIRECT_URL=postgresql://.../neondb?sslmode=require               # Neon direct (untuk migrate)
JWT_SECRET=ganti-dengan-string-acak-panjang
GOOGLE_WEB_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com          # OAuth "Web application" client ID
PUSHER_APP_ID=
PUSHER_KEY=
PUSHER_SECRET=
PUSHER_CLUSTER=ap1
```

Catatan Google: aplikasi Android memakai `google_sign_in` dengan `serverClientId = GOOGLE_WEB_CLIENT_ID`, sehingga `idToken` yang dikirim ke backend memiliki `aud` = Web Client ID. Verifikasi dengan `audience: GOOGLE_WEB_CLIENT_ID`.

---

## 3. Skema Database (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model User {
  id        String   @id @default(cuid())
  googleId  String   @unique
  email     String   @unique
  name      String
  photoUrl  String?
  coupleId  String?
  couple    Couple?  @relation(fields: [coupleId], references: [id], onDelete: SetNull)
  status    Status?
  invite    Invite?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Couple {
  id        String   @id @default(cuid())
  members   User[]
  createdAt DateTime @default(now())
}

model Invite {
  code      String   @id            // 6 karakter, lihat aturan di bawah
  inviterId String   @unique        // 1 invite aktif per user
  inviter   User     @relation(fields: [inviterId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
}

// Hanya status TERAKHIR per user (tidak menyimpan riwayat lokasi).
model Status {
  userId           String   @id
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  lat              Float?
  lng              Float?
  accuracy         Float?
  speed            Float?   // m/s
  heading          Float?   // derajat
  battery          Int?     // 0-100
  batteryState     String   @default("unknown") // charging | discharging | full | unknown
  networkType      String   @default("none")    // wifi | mobile | ethernet | vpn | other | none
  carrier          String?  // contoh: "Telkomsel"
  mobileNetworkGen String?  // 2G | 3G | 4G | 5G | null
  sharingPaused    Boolean  @default(false)
  updatedAt        DateTime @updatedAt
}
```

Tambahkan `"postinstall": "prisma generate"` di `package.json` agar Prisma Client tergenerate saat build di Vercel. Gunakan **satu instance PrismaClient** (simpan di `globalThis`) agar tidak membuat koneksi berulang di serverless.

---

## 4. Autentikasi

- Semua endpoint kecuali `GET /health` dan `POST /auth/google` wajib header: `Authorization: Bearer <jwt>`.
- JWT payload: `{ sub: user.id }`, algoritma HS256, masa berlaku **60 hari**.
- Middleware auth: verifikasi JWT, load user dari DB, taruh di `req.user`. Jika token invalid/expired/user tidak ada → `401 { "error": "unauthorized" }`.

---

## 5. Format Objek JSON (dipakai di semua response & event)

**User**

```json
{ "id": "ck...", "email": "a@gmail.com", "name": "Budi", "photoUrl": "https://..." }
```

**Status** (semua tanggal ISO-8601 UTC)

```json
{
  "userId": "ck...",
  "lat": -6.2, "lng": 106.8,
  "accuracy": 12.5, "speed": 1.4, "heading": 90,
  "battery": 76, "batteryState": "charging",
  "networkType": "mobile", "carrier": "Telkomsel", "mobileNetworkGen": "4G",
  "sharingPaused": false,
  "updatedAt": "2026-10-06T05:00:00.000Z"
}
```

**Couple**

```json
{ "id": "ck...", "createdAt": "2026-10-06T05:00:00.000Z" }
```

**Format error** (semua error): `{ "error": "<kode_error>", "message": "<pesan opsional>" }`

---

## 6. Endpoint REST

### `GET /health`

→ `200 { "ok": true }`

### `POST /auth/google`

Body: `{ "idToken": "<google id token>" }`

- Verifikasi dengan `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_WEB_CLIENT_ID })`.
- Upsert user berdasarkan `googleId` (= `payload.sub`); update `email`, `name`, `photoUrl` (`payload.picture`).
- → `200 { "token": "<jwt>", "user": User }`
- Token Google invalid → `401 { "error": "invalid_google_token" }`

### `GET /me`

→ `200`

```json
{
  "user": User,
  "couple": Couple | null,
  "partner": User | null,
  "partnerStatus": Status | null,
  "myStatus": Status | null
}
```

### `POST /invites`

Membuat (atau mengganti) kode undangan milik user.

- Jika user sudah punya pasangan → `409 { "error": "already_paired" }`.
- Hapus invite lama milik user, buat yang baru. Kode: **6 karakter**, huruf besar + angka **tanpa karakter ambigu** (alfabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), gunakan `crypto.randomInt`, ulangi jika bentrok. Berlaku **24 jam**.
- → `201 { "code": "K7P2QX", "expiresAt": "...", "link": "lovetracking://invite?code=K7P2QX" }`

### `POST /invites/accept`

Body: `{ "code": "k7p2qx" }` (normalisasi: trim + uppercase)

- Kode tidak ada / kedaluwarsa → `404 { "error": "invite_not_found" }`
- Kode milik sendiri → `400 { "error": "own_invite" }`
- Penerima atau pengundang sudah punya pasangan → `409 { "error": "already_paired" }`
- Jika valid, dalam **satu transaksi Prisma**: buat `Couple`, set `coupleId` kedua user, hapus invite tersebut (dan invite lain milik penerima jika ada).
- Setelah commit, trigger Pusher ke **pengundang**: channel `private-user-{inviterId}`, event `couple-paired`, data `{ "couple": Couple, "partner": <User penerima>, "partnerStatus": <Status penerima | null> }`.
- → `200 { "couple": Couple, "partner": <User pengundang>, "partnerStatus": <Status pengundang | null> }`

### `DELETE /couple`

Putuskan pasangan (unpair).

- Jika user tidak punya pasangan → `404 { "error": "not_paired" }`
- Set `coupleId = null` untuk kedua anggota, hapus `Couple`, hapus `Status` kedua user (privasi).
- Trigger event `couple-unpaired` data `{}` ke `private-couple-{coupleId}` **dan** ke `private-user-{partnerId}`.
- → `204`

### `PUT /status`

Dikirim oleh HP setiap ada perubahan (lokasi bergeser ≥10 m, baterai/jaringan berubah, atau heartbeat tiap ~60 detik).
Body (validasi zod; semua field selain yang ditandai boleh `null`/tidak ada):

```json
{
  "lat": -6.2, "lng": 106.8, "accuracy": 12.5, "speed": 1.4, "heading": 90,
  "battery": 76, "batteryState": "charging",
  "networkType": "mobile", "carrier": "Telkomsel", "mobileNetworkGen": "4G",
  "sharingPaused": false
}
```

Aturan validasi: `lat` -90..90, `lng` -180..180, `battery` integer 0..100, `batteryState` ∈ {charging, discharging, full, unknown}, `networkType` ∈ {wifi, mobile, ethernet, vpn, other, none}, `mobileNetworkGen` ∈ {2G, 3G, 4G, 5G, null}, `carrier` string ≤ 64 karakter, `sharingPaused` boolean (wajib).

- **Jika `sharingPaused` = true**, simpan `lat/lng/accuracy/speed/heading` sebagai `null` (jangan simpan lokasi saat dijeda).
- Upsert `Status` milik user.
- Jika user punya pasangan → trigger Pusher channel `private-couple-{coupleId}`, event `status-updated`, data = objek **Status** lengkap (termasuk `userId` & `updatedAt`). Client akan mengabaikan event dengan `userId` miliknya sendiri.
- Body invalid → `400 { "error": "invalid_body", "message": ... }`
- → `200 { "status": Status }`
- Rate limit ringan (opsional): tolak dengan `429 { "error": "too_many_requests" }` jika user mengirim > 1 request per 2 detik.

### `POST /pusher/auth`

Endpoint otorisasi private channel Pusher. Client mengirim **JSON** (bukan form):

```json
{ "socket_id": "123.456", "channel_name": "private-couple-ck..." }
```

(Terima juga `application/x-www-form-urlencoded` untuk jaga-jaga — aktifkan `express.urlencoded()`.)

- Izinkan **hanya**:
  - `private-user-{req.user.id}`
  - `private-couple-{req.user.coupleId}` (jika user punya pasangan)
- Lainnya → `403 { "error": "forbidden" }`
- Jika diizinkan → `200` dengan body hasil `pusher.authorizeChannel(socket_id, channel_name)` (objek `{ "auth": "key:signature" }`).

---

## 7. Ringkasan Pusher

| Channel                       | Event               | Data                                   | Pemicu                                           |
| ----------------------------- | ------------------- | -------------------------------------- | ------------------------------------------------ |
| `private-couple-{coupleId}` | `status-updated`  | Status                                 | `PUT /status`                                  |
| `private-couple-{coupleId}` | `couple-unpaired` | `{}`                                 | `DELETE /couple`                               |
| `private-user-{userId}`     | `couple-paired`   | `{ couple, partner, partnerStatus }` | `POST /invites/accept` (dikirim ke pengundang) |
| `private-user-{userId}`     | `couple-unpaired` | `{}`                                 | `DELETE /couple` (dikirim ke pasangan)         |

Kegagalan `pusher.trigger` **tidak boleh** membuat request gagal — log error saja (`console.error`) dan tetap kembalikan response sukses. Gunakan `await` pada trigger (di serverless, promise yang tidak di-await bisa terputus).

---

## 8. Struktur Proyek yang Diharapkan

```
D:\Love-Tracking-BACKEND
├── api/index.js            # export default app (entry Vercel)
├── src/
│   ├── app.js              # buat express app, middleware, routes, error handler
│   ├── server.js           # app.listen(PORT||3000) untuk development lokal
│   ├── lib/prisma.js       # singleton PrismaClient
│   ├── lib/pusher.js       # instance Pusher
│   ├── lib/serialize.js    # ubah model Prisma → objek JSON kontrak (User/Status/Couple)
│   ├── middleware/auth.js
│   └── routes/{auth,me,invites,couple,status,pusher}.js
├── prisma/schema.prisma
├── vercel.json             # rewrite semua path ke /api
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

`vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/api" }] }
```

Middleware global: `cors()`, `express.json({ limit: "16kb" })`, `express.urlencoded({ extended: false })`, error handler terpusat yang mengubah error menjadi format `{ error, message }` (500 → `internal_error`; jangan bocorkan stack trace di production).

Serializer: **jangan pernah** mengirim `googleId` atau `coupleId` di objek User. Tanggal → `toISOString()`.

---

## 9. Scripts `package.json`

```json
{
  "scripts": {
    "dev": "node --watch --env-file=.env src/server.js",
    "start": "node src/server.js",
    "postinstall": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy"
  }
}
```

---

## 10. README (wajib ditulis)

Jelaskan langkah demi langkah:

1. Buat project di **Neon** → salin pooled & direct connection string.
2. Buat app di **Pusher Channels** (cluster `ap1`) → salin app_id, key, secret, cluster. (Client events tidak perlu diaktifkan.)
3. Di **Google Cloud Console** → buat OAuth consent screen, lalu buat 2 OAuth client:
   - **Web application** → client ID ini = `GOOGLE_WEB_CLIENT_ID` (juga dipakai app Flutter sebagai `serverClientId`).
   - **Android** → package name `com.lovetracking.love_tracking` + SHA-1 dari debug/release keystore (`cd android && ./gradlew signingReport`).
4. `npm install`, isi `.env`, `npm run db:migrate`, `npm run dev`.
5. Deploy: `npx vercel`, isi env vars di dashboard Vercel, jalankan `npm run db:deploy` terhadap DB production.
6. Contoh `curl` untuk setiap endpoint.

---

## 11. Kriteria Selesai

- [ ] Semua endpoint & event Pusher sesuai kontrak di atas (nama field persis).
- [ ] Pairing aman dari race condition (transaksi) dan tidak bisa menghasilkan pasangan berisi > 2 orang.
- [ ] User tidak bisa membaca status / subscribe channel milik orang yang bukan pasangannya.
- [ ] Lokasi tidak disimpan saat `sharingPaused = true`.
- [ ] Berjalan lokal (`npm run dev`) dan di Vercel.
- [ ] Tidak ada secret yang di-hardcode atau ter-commit.
