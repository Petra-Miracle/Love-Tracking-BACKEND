# Prompt: Fitur Profil Pengguna (nama & foto) — Backend Love Tracking

Kamu melanjutkan backend Love Tracking di `D:\Love-Tracking-BACKEND` (Express 5 + Prisma 6.19 + Pusher + Neon, deploy di Vercel: `https://love-tracking-api.vercel.app`). Kontrak lama di `PROMPT-BACKEND.md` **tetap berlaku**; dokumen ini hanya **menambah** fitur. Aplikasi Flutter sudah dibangun mengikuti kontrak di bawah ini secara persis.

## Tujuan
User bisa **mengganti nama pengguna** dan **foto profil** dari halaman Profil di aplikasi. Pasangannya melihat perubahan itu **langsung** (realtime) — termasuk foto yang dipakai sebagai pin di peta.

---

## 1. Perubahan skema Prisma

```prisma
model User {
  // ... field lama tetap ...
  photoUrl        String?   // foto dari Google (diisi saat login) — JANGAN dihapus
  nameCustomized  Boolean   @default(false) // true setelah user mengganti nama sendiri
  photo           UserPhoto?
}

/// Foto profil yang diunggah user sendiri (sudah dikompres oleh aplikasi, ±20–150 KB).
model UserPhoto {
  userId    String   @id
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  mimeType  String   // image/jpeg | image/png | image/webp
  data      Bytes
  updatedAt DateTime @updatedAt
}
```
Buat migration baru (`npx prisma migrate dev --name user_profile`) dan terapkan ke database production (`npm run db:deploy`).

## 2. Perbaikan `POST /auth/google` (penting)
Saat ini setiap login menimpa `name` dan `photoUrl` dengan data Google, sehingga nama yang sudah diganti user akan **hilang setiap login ulang**. Ubah upsert:
- **User baru:** isi `name` dan `photoUrl` dari Google seperti sekarang.
- **User lama:** selalu perbarui `email` dan `photoUrl` (foto Google), tapi **perbarui `name` hanya jika `nameCustomized = false`**.

## 3. Aturan serializer `User` (berlaku di SEMUA response & event Pusher)
Bentuk JSON tidak berubah: `{ id, email, name, photoUrl }`. Hanya nilai `photoUrl` yang ditentukan begini:
- Jika user punya `UserPhoto` → `photoUrl = "<PUBLIC_BASE_URL>/users/<id>/photo?v=<updatedAt dalam milidetik>"`
  (query `v` membuat URL berubah setiap foto diganti, sehingga cache di HP otomatis diperbarui).
- Jika tidak → `photoUrl` = foto Google (boleh `null`).

Tambahkan env var `PUBLIC_BASE_URL` (production: `https://love-tracking-api.vercel.app`; lokal: `http://localhost:3000`), isi juga di dashboard Vercel. Jika kosong, bentuk dari `req.protocol + '://' + req.get('host')`.

Saat mengambil user untuk serializer, **jangan** memuat kolom `data` (bytes) — cukup `photo: { select: { updatedAt: true } }`.

## 4. Endpoint baru

### `PATCH /me` (auth)
Body JSON: `{ "name": "Ana Putri" }`
- `name`: string, di-`trim`, panjang 1–40 karakter. Selain itu → `400 { "error": "invalid_body", "message": ... }`.
- Simpan `name` dan set `nameCustomized = true`.
- → `200 { "user": User }`
- Jika user punya pasangan → trigger Pusher `private-couple-{coupleId}`, event **`profile-updated`**, data `{ "user": User }`.

### `PUT /me/photo` (auth)
Upload foto profil sebagai **raw body** (bukan multipart, bukan base64):
- Header `Content-Type`: `image/jpeg`, `image/png`, atau `image/webp`. Lainnya → `415 { "error": "unsupported_media_type" }`.
- Gunakan `express.raw({ type: ["image/jpeg","image/png","image/webp"], limit: "1mb" })` **khusus di route ini** (limit global JSON 16 KB tetap).
- Body kosong → `400 { "error": "invalid_body" }`; lebih dari 1 MB → `413 { "error": "payload_too_large" }`.
- Upsert `UserPhoto` (mimeType + data).
- → `200 { "user": User }` (dengan `photoUrl` versi baru)
- Trigger `profile-updated` `{ "user": User }` ke `private-couple-{coupleId}` jika berpasangan.

### `DELETE /me/photo` (auth)
Hapus `UserPhoto` (kembali ke foto Google). Jika tidak ada → tetap `200`.
- → `200 { "user": User }`, trigger `profile-updated` jika berpasangan.

### `GET /users/:userId/photo` (PUBLIK, tanpa auth)
Dipakai `Image.network` di aplikasi, jadi **tidak boleh** butuh header Authorization.
- Jika ada → `200`, `Content-Type` = mimeType, body = bytes, header `Cache-Control: public, max-age=31536000, immutable`.
- Jika tidak ada → `404 { "error": "not_found" }`.
- ID user berupa cuid (tidak bisa ditebak), jadi aman dibuat publik.

## 5. Ringkasan Pusher (tambahan)

| Channel | Event | Data | Pemicu |
|---|---|---|---|
| `private-couple-{coupleId}` | `profile-updated` | `{ user: User }` | `PATCH /me`, `PUT /me/photo`, `DELETE /me/photo` |

Kegagalan trigger tidak boleh menggagalkan request (sama seperti event lain).

## 6. Kriteria selesai
- [ ] Migration diterapkan di Neon production; `PUBLIC_BASE_URL` diisi di Vercel; sudah di-deploy.
- [ ] `PATCH /me` mengganti nama; login ulang dengan Google **tidak** mengembalikan nama lama.
- [ ] `PUT /me/photo` dengan JPEG ±100 KB berhasil; `GET /me` mengembalikan `photoUrl` ke `/users/<id>/photo?v=...`; URL itu bisa dibuka di browser tanpa login.
- [ ] Mengganti foto lagi menghasilkan nilai `v` yang berbeda.
- [ ] `DELETE /me/photo` mengembalikan `photoUrl` ke foto Google.
- [ ] Pasangan menerima `profile-updated` di `private-couple-{coupleId}`.
- [ ] Endpoint lama tetap lulus semua pengujian sebelumnya.

Contoh uji upload:
```
curl -X PUT https://love-tracking-api.vercel.app/me/photo \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: image/jpeg" \
  --data-binary @foto.jpg
```
