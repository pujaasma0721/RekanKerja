# ANALISA — Keamanan & Akses: Tambah Pengguna + Kebijakan Kata Sandi (Task 33)

## Permintaan

> "pada menu 'Keamanan & Akses' pada tab pengguna tambahkan fungsi untuk menambahkan
> user/pengguna, lalu untuk input password buatkan setting [rules] untuk memvalidasi
> password pengguna baru tersebut secara lengkap, misal password minimum karakter,
> kombinasi password, lifetime, tidak boleh password yang sama 6 password terakhir dll, lengkapi"

## Kondisi Saat Ini (hasil riset)

| Aspek | Kondisi |
|---|---|
| Tab Pengguna | Tabel daftar + dialog edit (nama/email/role) saja — **tidak ada tambah user, tidak ada password sama sekali** |
| Login | Level platform: `User` (public schema) email + `passwordHash` scrypt; session `{uid, tid}`; AppUser tenant dicocokkan via **email** |
| AppUser (tenant) | `username, fullName, email, role, employeeId, active, lastLogin` — tanpa password; `lastLogin` tidak pernah di-update |
| Buat user | Hanya `register` (self-service SaaS) yang membuat akun platform; admin tenant **tidak bisa** membuat pengguna |
| Kebijakan sandi | Tidak ada. Register hanya cek panjang ≥ 8. Tidak ada riwayat/umur/lockout |

Arsitektur password yang dipilih: **hash tetap tunggal di platform `User.passwordHash`** (sumber
verifikasi login). Tenant menyimpan **meta sandi**: `AppUser.passwordChangedAt` (umur) +
`PasswordHistory` (hash N terakhir, untuk larangan pakai ulang). Kebijakan (`PasswordPolicy`)
disimpan per tenant schema — diatur admin workspace di menu Keamanan & Akses.

## Desain

### 1. Model data

**Tenant schema** (`prisma/schema-tenant.prisma`):

- `PasswordPolicy` (singleton, `active=true`):
  - Kompleksitas: `minLength` 8, `maxLength` 64, `requireUppercase/Lowercase/Number/Special`,
    `minUniqueChars` 4, `maxRepeated` 3 (aaa), `maxSequential` 3 (abc/321),
    `blockUsername`, `blockName` (nama depan/belakang ≥3 huruf), `blockCommon` (daftar sandi umum + brand)
  - Umur: `lifetimeDays` 90 (0 = tidak pernah), `warnDays` 7
  - Riwayat: `historyCount` 6 — sandi baru tidak boleh sama dengan N terakhir
  - Percobaan login: `maxFailedAttempts` 5, `lockoutMinutes` 15
- `PasswordHistory`: `appUserId → AppUser` (cascade), `hash` (scrypt), `setAt`, `setById`
- `AppUser.passwordChangedAt DateTime?`

**Platform schema** (`prisma/schema.prisma`):

- `User.failedAttempts Int @default(0)`, `User.lockedUntil DateTime?` (lockout login lintas schema)

### 2. Titik penegakan (enforcement)

| Titik | Aturan yang berlaku |
|---|---|
| **Tambah pengguna** (tab Pengguna) | seluruh aturan kompleksitas; email belum terdaftar platform → buat `User` + `UserTenant` (role dipetakan) + `AppUser` + riwayat + `passwordChangedAt` |
| **Reset kata sandi** (admin, per user) | kompleksitas + **riwayat N terakhir** (verify tiap hash) + perbarui hash platform |
| **Ganti kata sandi** (self-service, shell) | verifikasi sandi saat ini + kompleksitas + riwayat |
| **Register** (self-service SaaS) | kompleksitas (kebijakan default) |
| **Login** | **lockout** setelah N gagal (policy tenant pertama), pesan menit tersisa; sukses → reset hitungan + update `lastLogin`; **kedaluwarsa** → flag di response + toast di shell |

### 3. API

- `GET/PUT /api/onevity/password-policy` — baca (self-heal singleton) / simpan; guard `requireMenuAction("settings:security", "update")`
- `POST /api/onevity/app-users` — diperluas: `email` wajib + `password` + `employeeId` opsional; guard `settings:security` **create**; detail error per aturan (array `details`)
- `PATCH /api/onevity/app-users` — diperluas: `password` (reset; guard **update**; cek riwayat)
- `DELETE /api/onevity/app-users` — guard **delete** (tetap ≥ 1 user)
- `POST /api/auth/change-password` — `{ currentPassword, newPassword }`
- `POST /api/auth/login` — lockout + kedaluwarsa + lastLogin
- `GET /api/auth/me` — tambah `password { expired, remainingDays, warn }` (best-effort)

### 4. UI

- Tab **Pengguna**: tombol **Tambah Pengguna** (dialog: nama, username, email, role, tautan
  karyawan opsional, status aktif, sandi + konfirmasi dengan **checklist aturan live** +
  meter kekuatan) — tabel tambah kolum **Kata Sandi** (umur / kedaluwarsa) + aksi
  **Reset Kata Sandi** (dialog dengan cek riwayat) dan **Hapus** (konfirmasi).
- Tab baru **Kebijakan Kata Sandi**: editor 3 seksi (Kompleksitas / Umur & Riwayat /
  Percobaan Login Gagal) + kartu **Uji Coba** (input sandi → checklist lolos/gagal live) +
  ringkasan penerapan. Tombol ter-gate hak aksi `settings:security`.
- Shell: tombol kunci di footer sidebar → **Ganti Kata Sandi** (sandi saat ini + baru +
  checklist); toast peringatan kedaluwarsa saat sesi dimuat.
- Komponen bersama `PasswordRuleChecklist` + `passwordStrength` (client-safe,
  dipakai dialog create/reset/change/tester).

### 5. Migrasi & seed

`scripts/migrate-password-security.ts` (idempoten, pola pg Client + `SET search_path`, semua
schema tenant): DDL tabel `PasswordPolicy`/`PasswordHistory` + kolom `AppUser."passwordChangedAt"`
+ seed policy default + backfill `passwordChangedAt` + riwayat awal untuk akun demo MII
(`onevity123` hrd — sehingga reset ke sandi sama **ditolak**, demo riwayat hidup) + kolom
lockout platform `User`. Dipanggil dari `restore-demo.ts` (blok 1f).

## Risiko & Keputusan

- Sandi demo (`onevity123`) tidak lolos policy — **disengaja** (penegakan hanya untuk sandi
  BARU; data lama tidak divalidasi ulang) supaya demo login tetap hidup.
- Email yang sudah terdaftar platform → tolak dengan pesan jelas (tidak menimpa sandi orang).
- Lockout lintas-tenant: policy diambil dari workspace pertama user (praktik wajar utk demo;
  user multi-tenant memakai policy workspace pertamanya).
- `lastLogin` AppUser kini diupdate saat login sukses (kolum yang sebelumnya selalu NULL).
