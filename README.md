# Love Tracking — Backend

Backend untuk aplikasi Android **Love Tracking** (Flutter): pasangan (tepat 2 orang) saling berbagi lokasi real-time, status baterai, dan status jaringan/operator.

**Stack:** Node.js 20+ (ESM) · Express 5 · Prisma 6.19 · PostgreSQL (Neon) · Pusher Channels · Google Sign-In → JWT · zod · Vercel.

```
api/index.js          entry Vercel (export default app)
src/app.js            express app, middleware, routes, error handler
src/server.js         app.listen untuk development lokal
src/lib/              prisma (singleton), pusher, serialize, jwt, errors
src/middleware/auth.js
src/routes/           auth, me, invites, couple, status, pusher
prisma/schema.prisma  + prisma/migrations/ (migration awal sudah tersedia)
```

---

## 1. Neon (PostgreSQL)

1. Daftar di <https://neon.tech> → **New Project** (pilih region terdekat, mis. *AWS Asia Pacific (Singapore)*).
2. Di dashboard → **Connect**:
   - Aktifkan **Connection pooling** → salin string-nya ke `DATABASE_URL` (host mengandung `-pooler`).
   - Matikan pooling → salin string-nya ke `DIRECT_URL` (dipakai `prisma migrate`).
3. Pastikan keduanya berakhiran `?sslmode=require`.

## 2. Pusher Channels

1. Daftar di <https://dashboard.pusher.com> → **Channels** → **Create app** (cluster **ap1**, plan Sandbox gratis).
2. Tab **App Keys** → salin `app_id`, `key`, `secret`, `cluster` ke `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`.
3. *Client events* **tidak** perlu diaktifkan (semua event dikirim dari server).

## 3. Google Cloud Console (Google Sign-In)

1. <https://console.cloud.google.com> → buat/pilih project.
2. **APIs & Services → OAuth consent screen** → isi nama aplikasi & email, tipe *External*, tambahkan akun penguji selama mode *Testing*.
3. **Credentials → Create credentials → OAuth client ID**, buat **2** client:
   - **Web application** → client ID-nya adalah `GOOGLE_WEB_CLIENT_ID`. Nilai yang sama dipakai app Flutter sebagai `serverClientId`, sehingga `aud` pada ID token = Web Client ID.
   - **Android** → package name `com.lovetracking.love_tracking` + SHA-1 keystore. Ambil SHA-1 dengan:
     ```bash
     cd android && ./gradlew signingReport
     ```
     Tambahkan SHA-1 debug **dan** release (buat client Android terpisah untuk masing-masing bila perlu).

## 4. Menjalankan lokal

```bash
npm install                 # otomatis menjalankan prisma generate
cp .env.example .env        # lalu isi semua nilai
npm run db:migrate          # menerapkan migration ke DB (dev)
npm run dev                 # http://localhost:3000
```

`JWT_SECRET` bisa dibuat dengan:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> Untuk menguji dari HP fisik, gunakan IP LAN komputer (mis. `http://192.168.1.10:3000`) atau tunnel seperti `ngrok`.

## 5. Deploy ke Vercel

**Cara A — dari GitHub (disarankan):** di <https://vercel.com/new> → *Import* repo ini → biarkan *Framework Preset*, *Build/Output/Install Command* default → isi Environment Variables (lihat di bawah) → **Deploy**. Setiap `git push` ke `main` akan otomatis di-deploy.

**Cara B — dari CLI:**

```bash
npx vercel                  # ikuti prompt, link ke project baru
npx vercel --prod
```

**Environment Variables** (Settings → Environment Variables, centang Production + Preview):

| Nama | Catatan |
|---|---|
| `DATABASE_URL` | URL **pooled** Neon. Tambahkan `&connect_timeout=15` di akhir agar request pertama tidak timeout saat compute Neon bangun dari *scale-to-zero*. |
| `DIRECT_URL` | URL direct Neon (tanpa `-pooler`). |
| `JWT_SECRET` | **Harus sama** dengan yang dipakai sebelumnya, kalau tidak semua token lama jadi invalid. |
| `GOOGLE_WEB_CLIENT_ID` | Client ID tipe *Web application*. |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Dari tab *App Keys* Pusher. |

Setelah mengubah env var, lakukan **Redeploy** agar nilainya terpakai.

**Migration database** tidak dijalankan otomatis oleh Vercel. Jalankan dari komputer lokal setiap ada migration baru:

```bash
npm run db:deploy
```

**Cek setelah deploy:**

```bash
curl https://<project>.vercel.app/health      # {"ok":true}
curl https://<project>.vercel.app/me          # {"error":"unauthorized"}  (berarti routing + function jalan)
```

Catatan teknis:
- `vercel.json` me-rewrite semua path ke function `api/index.js`, sehingga Express menangani routing (`/health`, `/me`, dst.).
- `vercel-build` & `postinstall` menjalankan `prisma generate`; `binaryTargets` di `schema.prisma` menyertakan engine Linux (`rhel-openssl-3.0.x`) untuk runtime Vercel.
- Runtime dipin ke Node `22.x` lewat `engines` di `package.json`.
- Region function default Vercel (`iad1`, US East) sudah dekat dengan Neon `us-east-2`; jangan dipindah ke Singapore kecuali database juga dipindah.

---

## 6. Ringkasan API

Semua endpoint kecuali `GET /health` dan `POST /auth/google` wajib header `Authorization: Bearer <jwt>` (JWT HS256, berlaku 60 hari). Format error: `{ "error": "<kode>", "message": "<opsional>" }`.

| Method | Path | Sukses | Error |
| ------ | ---- | ------ | ----- |
| GET | `/health` | 200 `{ ok: true }` | — |
| POST | `/auth/google` | 200 `{ token, user }` | 400 `invalid_body`, 401 `invalid_google_token` |
| GET | `/me` | 200 `{ user, couple, partner, partnerStatus, myStatus }` | 401 |
| POST | `/invites` | 201 `{ code, expiresAt, link }` | 409 `already_paired` |
| POST | `/invites/accept` | 200 `{ couple, partner, partnerStatus }` | 400 `own_invite`, 404 `invite_not_found`, 409 `already_paired` |
| DELETE | `/couple` | 204 | 404 `not_paired` |
| PUT | `/status` | 200 `{ status }` | 400 `invalid_body`, 429 `too_many_requests` |
| POST | `/pusher/auth` | 200 `{ auth }` | 400 `invalid_body`, 403 `forbidden` |

Error tambahan yang bersifat umum: `404 not_found` (path tidak dikenal), `413 payload_too_large` (body > 16 KB), `500 internal_error`.

### Event Pusher

| Channel | Event | Data | Pemicu |
| ------- | ----- | ---- | ------ |
| `private-couple-{coupleId}` | `status-updated` | Status | `PUT /status` |
| `private-couple-{coupleId}` | `couple-unpaired` | `{}` | `DELETE /couple` |
| `private-user-{userId}` | `couple-paired` | `{ couple, partner, partnerStatus }` | `POST /invites/accept` (ke pengundang) |
| `private-user-{userId}` | `couple-unpaired` | `{}` | `DELETE /couple` (ke pasangan) |

Kegagalan Pusher hanya dicatat di log; request tetap sukses.

### Catatan perilaku

- **Pairing aman dari race condition:** invite "diklaim" dengan `DELETE ... WHERE code AND expiresAt > now` dan kedua user di-update dengan `WHERE coupleId IS NULL` di dalam satu transaksi (urutan id konsisten untuk mencegah deadlock). Jika salah satu gagal, seluruh transaksi di-rollback, jadi satu pasangan tidak mungkin berisi lebih dari 2 orang.
- **Privasi:** saat `sharingPaused = true`, `lat/lng/accuracy/speed/heading` disimpan sebagai `null`. Saat unpair, `Status` kedua user dihapus. `/pusher/auth` hanya mengizinkan `private-user-{diri sendiri}` dan `private-couple-{pasangan sendiri}`.
- **Rate limit `PUT /status`:** maks. 1 request / 2 detik per user, disimpan di memori per instance. Di serverless ini bersifat *best-effort* (instance berbeda tidak berbagi hitungan).

---

## 7. Contoh `curl`

```bash
BASE=http://localhost:3000
TOKEN=<jwt dari /auth/google>

# Health
curl $BASE/health

# Login (idToken dari google_sign_in di app Flutter)
curl -X POST $BASE/auth/google -H "Content-Type: application/json" \
  -d '{"idToken":"eyJhbGciOiJSUzI1NiIs..."}'

# Profil + pasangan + status
curl $BASE/me -H "Authorization: Bearer $TOKEN"

# Buat / ganti kode undangan
curl -X POST $BASE/invites -H "Authorization: Bearer $TOKEN"

# Terima undangan (huruf kecil & spasi dinormalisasi)
curl -X POST $BASE/invites/accept -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"code":"k7p2qx"}'

# Kirim status
curl -X PUT $BASE/status -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"lat":-6.2,"lng":106.8,"accuracy":12.5,"speed":1.4,"heading":90,"battery":76,"batteryState":"charging","networkType":"mobile","carrier":"Telkomsel","mobileNetworkGen":"4G","sharingPaused":false}'

# Otorisasi private channel Pusher
curl -X POST $BASE/pusher/auth -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"socket_id":"123.456","channel_name":"private-user-<userId>"}'

# Putuskan pasangan
curl -X DELETE $BASE/couple -H "Authorization: Bearer $TOKEN" -i
```

> Di Windows PowerShell gunakan `curl.exe` dan escape tanda kutip pada body JSON, atau jalankan contoh di atas lewat Git Bash.
