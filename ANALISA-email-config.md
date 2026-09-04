# ANALISA — Konfigurasi Email & Notifikasi Otomatis (Task 34)

## Permintaan
Buat email configuration setting di menu Pengaturan Sistem yang berfungsi mengirim email
**otomatis oleh sistem** ketika ada approval / pengajuan (cuti, travel, klaim medis, dsb.).

## Desain (mengikuti pola Task 25/31/32/33 — approval berjenjang / per-user / kebijakan sandi)

### 1. Model Prisma (schema-per-tenant — tiap tenant punya konfigurasi sendiri)
- **EmailConfig** (singleton, satu baris aktif): SMTP host/port/secure/user/password,
  fromEmail/fromName, enabled, status tes terakhir (lastTestOk/At/Message), updatedById.
- **EmailTemplate** (per event, `event` unique): label, active, recipient switches
  (notifyEmployee/notifyApprover/notifyHrd), subject + body dengan placeholder `{{nama}}`,
  `{{docNo}}`, `{{status}}`, dst. Self-heal seed default Bahasa Indonesia bila belum ada.
- **EmailLog**: audit trail pengiriman (event, toEmail, subject, status Sent/Failed/Skipped,
  error, body preview, createdAt) — muncul di tab "Riwayat Kirim".

### 2. Katalog event (selaras endpoint approval nyata)
| Event | Pemicu | Penerima default |
|---|---|---|
| leave.submitted | POST permintaan cuti | approver |
| leave.approved / leave.rejected | PUT keputusan | pengaju |
| travel.submitted / approved / rejected | permintaan travel | approver/pengaju |
| travel.claim.submitted / approved / rejected | klaim settlement | approver/pengaju |
| medical.claim.submitted / approved / rejected | klaim medis | approver/pengaju |
| medical.claim.settled | settlement klaim | pengaju |
| payroll.run.confirmed / paid | konfirmasi & tandai dibayar | HRD |
| user.created | tambah pengguna baru (Task 33) | user baru |

### 3. Pengiriman otomatis — fire-and-forget
`notifyEmailEvent(db, {event, to, data})` dipanggil dari route keputusan/pengajuan
SETELAH operasi utama sukses. Asynchronous, never-await: gagal kirim tidak pernah
mengganggu proses approval; config kosong/nonaktif → log "Skipped" diam-diam.

### 4. API (thin-route pattern + guard aksi menu `settings:email`)
- `GET/PUT /api/onevity/email-config` (PUT guard update; GET self-heal seed)
- `POST /api/onevity/email-config/test` — tes koneksi + email percobaan
- `GET/PUT /api/onevity/email-templates` (PUT guard update)
- `GET /api/onevity/email-logs` (view)

### 5. UI — "Konfigurasi Email" (Pengaturan Sistem)
3 tab gaya kartu teal/emerald: **Server SMTP** (form + tombol Tes Kirim + badge status),
**Template & Pemicu** (daftar event + editor subject/body + bantuan placeholder + switch
penerima), **Riwayat Kirim** (tabel log + status pill). Nav id `email`; katalog aksi menu
`settings:email` (ops: `test` — kirim email uji).

### 6. Teknis
- nodemailer (SMTP standar: Gmail app password / Office365 / relay).
- Password SMTP tidak pernah dikirim ke klien (masked panjang saja).
- Migrasi idempoten `scripts/migrate-email-config.ts` (DDL + seed template default
  per tenant) + dipanggil otomatis dari restore-demo (blok 1g).
- Sandbox demo tanpa SMTP asli → tombol Tes menampilkan error SMTP yang ramah
  (bukti alur hidup), pemicu event mencatat log Skipped bila belum dikonfigurasi.

## Urutan implementasi
Prisma model → db push → service (render/kirim/log) → API routes → UI + nav + katalog
aksi → hook route approval (leave/travel/medical/payroll/app-users) → migrasi + restore-demo
→ E2E agent-browser → worklog → commit & push.
