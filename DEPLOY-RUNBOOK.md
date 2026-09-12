# DEPLOY-RUNBOOK — OneVity Production

> Dokumen operasional untuk developer/ops yang menangani deploy **OneVity — Human Resource Base**
> ke production: **https://onevity.sayone.my.id/**
>
| | |
|---|---|
| Repo | `github.com/pujaasma0721/OneVity` (branch `main`) |
| Runtime | Next.js 16 (App Router, output `standalone`), TypeScript |
| Database | PostgreSQL (platform + multi-tenant schema-per-tenant) |
| Kasus pemicu dokumen | Deploy commit `befb30d` (Task 39 — perbaikan lebar modal dialog) sempat "tidak terlihat perubahannya" di production |

---

## 0. Status terkini (hasil verifikasi)

**Deploy `befb30d` SUDAH BERHASIL di production** — diverifikasi langsung dari browser eksternal:

| Bukti | Build lama | Hasil verifikasi (build baru) |
|---|---|---|
| Dialog **Ajukan Cuti** (modul Leave) | 512px, class bare `max-w-xl` | **672px**, class `sm:max-w-2xl` |
| Dialog **Struktur Baru** (Approval Berjenjang) | 512px, class bare `max-w-3xl` | **768px**, class `sm:max-w-3xl` |
| File CSS yang dilayani | `85ebf5081250a4ee.css`, `65126b0985f5f605.css` (naming webpack) | `0z85y9qo_k01u.css`, `2mjtnosjvux-z.css` (naming Turbopack) |

> Catatan data: setelah redeploy, daftar **Jurnal Payroll** kosong ("Belum ada jurnal payroll").
> Ini BUKAN bug — jurnal hanya terbuat otomatis saat **run payroll dikonfirmasi** (menu Payroll → Proses & Hasil).
> DB production ter-reseed (data demo) saat redeploy; data jurnal lama tidak ikut ter-restore.

---

## 1. Arsitektur production

```
Internet ──▶ Caddy (:80 / :443, TLS) ──▶ reverse proxy ──▶ PM2 app "onevity" (cluster mode, PORT=3001) ──▶ next-server v16.1.3
```

- **Build dilakukan DI SERVER** (bukan upload artifact): `git pull` → `build` → `pm2 restart`.
- `next.config.ts` memakai `output: "standalone"` — script `build` di `package.json` otomatis menyalin
  `.next/static` + `public/` ke `.next/standalone/`.
- Docker yang berjalan di server **hanya Superset BI** — tidak terkait app Next.js ini.
- Mini-services (`mini-services/postgres`, `mini-services/smtp-catcher`) adalah artefak **sandbox** saja;
  production memakai PostgreSQL sungguhan (lihat env `PLATFORM_DB_URL`).

---

## 2. Prosedur deploy standar (step-by-step)

> Jalankan semua sebagai user yang sama dengan pemilik proses PM2.

```bash
# (1) Temukan folder project yang dijalankan PM2 — CATAT cwd & script
pm2 describe onevity | grep -iE "cwd|script|interpreter"

# (2) Masuk ke folder project (sesuai output cwd di atas)
cd <folder-project>

# (3) Cek posisi kode sekarang & pastikan working tree bersih
git log --oneline -3
git status            # bila dirty → git stash (jangan commit asal-asalan di server)

# (4) Tarik kode terbaru
git pull origin main
git log --oneline -1  # HARUS menunjukkan commit target (mis. befb30d atau lebih baru)

# (5) Install dependency — HANYA bila lockfile berubah
npm install           # atau: bun install

# (6) WAJIB untuk fresh clone / folder src/generated belum ada:
npm run db:generate   # prisma generate untuk schema.prisma + schema-tenant.prisma
                      # → menghasilkan src/generated/platform + src/generated/tenant (GITIGNORED)
                      # TANPA langkah ini build gagal: "Cannot find module '@/generated/platform'"

# (7) Hapus build lama & build ulang
rm -rf .next
npm run build         # HARUS selesai tanpa error

# (8) Restart PM2 (pertahankan env, termasuk PORT=3001)
pm2 restart onevity --update-env

# (9) Pantau log — pastikan tidak ada error fatal
pm2 logs onevity --lines 30
```

Lanjutkan ke **§3 Verifikasi post-deploy** — jangan dianggap selesai sebelum lolos verifikasi.

### Catatan penting

| Commit | Sifat perubahan | Migrasi DB? |
|---|---|---|
| `befb30d` (Task 39 — lebar modal) | **Murni className** pada 110 dialog di 65 file | **Tidak perlu** — tanpa perubahan schema |
| Commit lain (lihat `git log`) | Bisa menyertakan schema baru | Cek pesan commit; instrumen auto-parity di §5 biasanya menangani |

- Aplikasi **tidak butuh** `prisma db push` untuk deploy `befb30d`.
- Bila `git pull` menolak karena ada file lokal berubah (mis. `.env` yang diedit langsung di server):
  simpan dulu `cp .env /tmp/env.bak`, lalu `git stash` / `git checkout -- <file>`.

---

## 3. Verifikasi post-deploy (wajib, dengan bukti terukur)

### 3.1 Dari terminal server (cepat)

```bash
# (a) Nama file chunk CSS/JS yang dilayanan — HARUS berbeda dari sebelum deploy
curl -s https://onevity.sayone.my.id/ | grep -oE 'chunks/[^"]+\.(css|js)' | sort -u

# (b) Marker konten build baru — HARUS ada hasil
grep -rl "sm:max-w-4xl" .next/static/chunks/ | head -3

# (c) Commit yang aktif di folder server
git log --oneline -1
```

> **PENTING — jangan bandingkan NAMA chunk antar bundler.** Build lama memakai naming webpack
> (16 hex, mis. `85ebf5081250a4ee.css`); build Next 16 memakai naming Turbopack
> (mis. `0z85y9qo_k01u.css`). Nama SELALU berbeda antar bundler meski source sama.
> Marker yang andal = **isi konten** (point b) + **ukuran modal** (§3.2) + **commit** (point c).

### 3.2 Dari browser (golden test — yang dilihat user)

Login (`hrd@mii.co.id` / `onevity123`, pilih workspace **PT Mitra Industri Internasional**) →
modul **Cuti** → **Permintaan Cuti** → klik **Ajukan Cuti**, lalu di DevTools Console:

```js
document.querySelector('[data-slot="dialog-content"]').getBoundingClientRect().width
// build baru: 672   |   build lama: 512

document.querySelector('[data-slot="dialog-content"]').className
// build baru mengandung: sm:max-w-2xl   |   build lama: max-w-xl (bare, tanpa prefix sm:)
```

Ekspektasi lebar dialog per titik uji (sampling Task 39):

| Titik uji | Rute | Build lama | Build baru |
|---|---|---|---|
| Ajukan Cuti | Leave → Permintaan Cuti | 512px | **672px** (`sm:max-w-2xl`) |
| Struktur Baru | Pengaturan → Approval Berjenjang | 512px | **768px** (`sm:max-w-3xl`) |
| Pengajuan Lembur | Attendance → Lembur | 512px | **576px** (`sm:max-w-xl`) |
| Posisi Baru | HR → Daftar Posisi | 512px | **672px** (`sm:max-w-2xl`) |
| Detail Jurnal Payroll | Payroll → Jurnal Payroll | 512px | **896px** (`sm:max-w-4xl`) |

Mobile (viewport 390px): dialog mengisi lebar layar dikurangi margin — normal dan aman.

### 3.3 PWA / Service Worker (penyebab "sudah deploy tapi user masih lihat UI lama")

Aplikasi adalah PWA (`public/sw.js`): HTML = network-first, `/_next/static/*` = stale-while-revalidate.

- Setelah deploy sukses, user lama mungkin masih melihat UI lama **sekali** → cukup **hard refresh 1×** (Ctrl+Shift+R).
- Bila masih stale: DevTools → **Application → Service Workers → Unregister** + **Clear storage** → reload.
- `sw.js` sendiri dilayani dengan `Cache-Control: must-revalidate` (diatur di `next.config.ts`), jadi versi SW baru aktif segera.

---

## 4. Troubleshooting — gejala → penyebab → solusi

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| Nama/isi chunk tidak berubah setelah `pm2 restart` | `git pull` gagal / build gagal / build di folder berbeda dari cwd PM2 / instance duplikat | Ulangi §2 langkah 1–8; `pm2 describe onevity` pastikan cwd = folder build; `pm2 ls` cek duplikat; `ss -tlnp \| grep 3001` |
| `npm run build` error `Cannot find module '@/generated/platform'` | `src/generated/` belum digenerate (gitignored) | `npm run db:generate` lalu build ulang |
| `git pull` gagal / conflict | Working tree dirty di server | `git stash`; bila yakin tidak ada perubahan penting: `git reset --hard origin/main` (HATI-HATI — menghapus perubahan lokal) |
| `npm run build` gagal (selain module di atas) | Node < 20.9, memory tidak cukup saat build | `node -v` (butuh ≥ 20.9); cek log error persisnya; pertimbangkan `NODE_OPTIONS=--max-old-space-size=2048 npm run build` |
| Hash chunk berubah, verifikasi §3.2 lulus, tapi user komplain "masih sama" | Cache service worker / browser di sisi user | Arahkan user hard refresh 1× (§3.3); bukan masalah server |
| `pm2 restart` sukses tapi masih menyajikan build lama | Proes PM2 memuat `.next` lama dari folder lain, atau ada 2 instance | `pm2 delete onevity` lalu start ulang dengan konfigurasi yang sama dari `pm2 describe` (catat dulu script/cwd/interpreter/env), `pm2 save` |
| Halaman error / blank setelah restart | Env var hilang saat restart | Pastikan `PLATFORM_DB_URL` & `TENANT_DB_BASE_URL` terdefinisi di env PM2; restart dengan `--update-env` |
| "Belum ada jurnal payroll" | Bukan bug — jurnal tercreate saat run payroll dikonfirmasi | Konfirmasi run di Payroll → Proses & Hasil |
| Login demo gagal setelah DB reseed | Seed belum tuntas / migrasi password belum jalan | `bun scripts/restore-demo.ts` lalu `bun scripts/migrate-password-security.ts` |
| `curl /api/health` → **503** | Platform DB tidak bisa diakses (DB mati / kredensial / network) | App tetap hidup — cek DB itu sendiri; detail penyebab hanya di **log server** (`[health] platform DB tidak siap …`), respons klien sengaja generik (tanpa DSN/host) |
| Skrip migrasi (`bun scripts/migrate-*.ts`) koneksi ke DB dev / gagal saat cron-systemd | Env tidak diekspor di konteks cron/systemd | Sejak Task 43-e skrip otomatis memuat `.env` root sebagai **fallback** (env proses/PM2 tetap menang) — pastikan `.env` di folder project berisi URL produksi, atau ekspor env di unit cron/systemd |

---

## 5. Database & auto-seed (perilaku yang perlu diketahui)

- **Platform DB** (registry tenant/user): `PLATFORM_DB_URL` — PostgreSQL.
- **Data domain HRIS**: schema per tenant di DB yang sama, client `src/generated/tenant`
  (`TENANT_DB_BASE_URL`).
- `src/` **generated/** dan `.env*` **di-gitignore** → fresh clone WAJIB:
  1. siapkan `.env` (minimal `PLATFORM_DB_URL` + `TENANT_DB_BASE_URL`),
  2. `npm run db:generate`,
  3. `npm run db:push` (schema platform) bila database masih kosong.
- **Auto-seed / auto-parity** (`src/instrumentation.ts`, jalan otomatis saat server start):
  - DB platform kosong → restore demo 3 tenant di background (MII penuh + Cahaya + Sentra)
    — inilah sebabnya deployment baru langsung punya data demo.
  - Tenant sudah ada tapi schema tertinggal → migrasi parity in-process berjalan otomatis
    (kode baru + DB lama menyehatkan sendiri, idempoten).
  - Manual: `bun scripts/restore-demo.ts` (full) — akun demo:
    `hrd@mii.co.id/onevity123` · `ayu@cahaya.id/cahaya12345` · `bambang@sentra.co.id/sentra12345`.
- **Jangan jalankan `db:push` sembarangan di production** kecuali yakin — auto-parity di atas
  biasanya sudah cukup untuk upgrade kode.

### 5.1 Env var produksi (WAJIB / opsional)

| Env var | Status | Fungsi |
|---|---|---|
| `PLATFORM_DB_URL` | **WAJIB** | Koneksi DB platform (registry Tenant/User/UserTenant). |
| `TENANT_DB_BASE_URL` | **WAJIB** | Base URL DB domain HRIS (schema per tenant, client di-append `?schema=tenant_x`). |
| `ONEVITY_ENCRYPTION_KEY` | **WAJIB di production** (43-b / M-10) | Kunci master enkripsi field PII & uang (`enc:v1:…`: NIK, NPWP, rekening, nominal payroll). Di `NODE_ENV=production` **tanpa** key ini, operasi baca/tulis field terenkripsi **throw saat pertama dipakai** (fail-fast — aplikasi boot tapi modul keuangan/karyawan error jelas). Dev pakai fallback deterministik. PERINGATAN: mengganti key = data lama terenkripsi tidak terbaca lagi. |
| `ONEVITY_ALLOW_DEMO_SEED` | opsional (43-c / M-2) | `1`/`true` → izinkan seed **data demo** di production (auto-seed fresh-install + token seed). Default: **ditolak** di production. Jalur parity-only (upgrade migrasi tenant existing) tetap jalan tanpa env ini. |
| `DEMO_SEED_TOKEN` | opsional (43-c / M-2) | Token guard `POST/GET /api/admin/seed-demo`. Di production **tanpa** env ini token default repo NONAKTIF → endpoint selalu 401 sampai env diset. Dev memakai token default repo. |

Catatan perilaku ops (43-c / M-3): `/api/auth/register` dibatasi **5 permintaan/15 menit/IP** + **3/jam/email** (429 + header `Retry-After`). Limiter in-memory per-instance — cukup untuk single node PM2; state reset saat restart; pindah ke store bersama (mis. Redis) bila multi-instance.

Semua skrip CLI `scripts/migrate-*.ts` + `restore-demo.ts` sejak Task 43-e otomatis memuat `.env` dari root project **hanya untuk key yang belum ada di env proses** (env PM2/systemd/`KEY=x bun …` selalu menang) — skrip aman dijalankan dari cron/systemd tanpa env diekspor selama `.env` berisi URL produksi.

### 5.2 Daftar langkah parity (`PARITY_STEPS` — src/onevity/shared/lib/parity-runner.ts)

Runner in-process dijalankan otomatis saat boot (instrumentation, bila gap) atau manual via `POST /api/admin/seed-demo`. Urutan append-only kronologis; tiap langkah idempoten dan never-throw. Langkah **BARU (Task 43-e, K-6)** — sebelumnya hanya skrip manual (fresh deploy prod melewatkannya, panel Webhook 500):

| # | key | Isi |
|---|---|---|
| 1–17 | `p0-wave1` … `entity-rules` | Migrasi gelombang lama: DDL kolom Employee, approval berjenjang, ESS+Notification, kalender libur, lembur/klaim, ApiKey/Webhook(+Log), Attachment, template surat/offboarding, UMP/UMK, email-config, wave27/28, template WA, demo tukar shift, enkripsi 16 kolom uang/PII, settlement travel, WageComponentRule (T32), entity-rules (T33) |
| 18 | `scheduler-race` (**BARU**) | Task 41 — partial unique index dedupe `ActivityLog` baris Reminder (scheduler race-safe; TIDAK ada di tenant-ddl.sql Prisma) |
| 19 | `webhook-retry` (**BARU**) | Task 41 — kolom retry `WebhookLog` (attempts/nextRetryAt/lastError) + index status,nextRetryAt + DEFAULT status='delivered' — **dibutuhkan panel Webhook** |
| 20 | `task43-indexes` (**BARU**) | Task 43 — 4 index payroll/klaim (M-15) + partial unique run payroll aktif (M-20) |
| 21 | `encrypt-money` (**BARU**) | Task 44 (audit 42 M-8) — gelombang enkripsi kedua: 38 kolom uang modul claim (EmployeeLoan/LoanInstallment, BenefitClaim, LeaveEncashment.amount, MedicalBalance/Claim/ClaimLine/Adjustment, TravelClaim/Expense/Advance/Budget/BudgetItem) Float→TEXT + encrypt-in-place `enc:v1:n`. Skrip `scripts/migrate-encrypt-money.ts` (idempoten, skip baris sudah terenkripsi). Kunci = SAMA `ONEVITY_ENCRYPTION_KEY`. Catatan: agregasi SQL (`_sum`/`groupBy`) pada kolom ini sudah dipindah in-memory di kode — JANGAN menambah query SQL agregat ke kolom terenkripsi. |

### 5.2.1 Enkripsi uang modul claim — catatan perilaku (Task 44 / M-8)

- 38 kolom uang klaim (loan/benefit/encashment/medical/travel) kini `enc:v1:n:…` di rest; dekripsi di batas serializer (`decryptJson`) → **bentuk respons API dan frontend TIDAK berubah** (angka tetap angka).
- Nilai legacy plaintext numerik pra-migrasi tetap terbaca (`decryptMoney` parse passthrough) — migrasi mengonversi bertahap; rerun aman.
- Laporan XLSX modul terkait menampilkan nilai terdekripsi (report-builder flag `encrypted`).
- PII scope-aware list karyawan (M-9): akun dengan data-scope CUSTOM menerima field PII di-mask (`piiScope:"limited"` di respons; export tanpa kolom PII).

### 5.2.2 Money Vault (Brankas Uang, Task 45/46) — env key & precheck UI

- **PRASYARUT**: mengatur kata sandi enkripsi uang (tombol vault di header) memanggil `tenantDataKey()` → **`ONEVITY_ENCRYPTION_KEY` WAJIB sudah di-set** sebelum admin menekan "Atur Kata Sandi Enkripsi". Tanpa itu, production melempar error fail-fast M-10 (`[field-crypto] ONEVITY_ENCRYPTION_KEY wajib di-set di production…`).
- **Sejak Task 46** status `GET /api/onevity/money-vault` mengembalikan `envKeyMissing:true` untuk kondisi tsb — dialog vault menampilkan alert merah **sebelum** admin mengetik sandi, dan form pengaturan dinonaktifkan (tidak ada lagi 500 setelah submit).
- **Urutan benar fresh-install production**: (1) set `ONEVITY_ENCRYPTION_KEY` (≥ 32 karakter acak, simpan di password manager — **rotasi = data terenkripsi lama tidak terbaca**), (2) restart app, (3) admin atur kata sandi vault, (4) assign hak lihat uang ke anggota.
- Operasi vault yang **tidak** butuh env key: unlock (verifier PBKDF2 lokal), lock, ganti kata sandi (DEK dari memori saat open), grant/revoke (baris DB). Hanya **setup** dan dekripsi jalur env (legacy/masked-PII) yang bergantung master key.
- Status "open" vault hanya di **memori proses** (TTL 8 jam; restart PM2 = terkunci kembali — by design). Kolom `openUntil`/`openByUserId` di DB bersifat informatif saja.

### 5.3 Health endpoint `/api/health` (Task 43-e)

Untuk load balancer / uptime monitor (Caddy health check, k8s probe, UptimeRobot):

- **200** `{"status":"ok","db":"ok",…}` = aplikasi hidup DAN platform DB menjawab `SELECT 1`.
- **503** `{"status":"error","db":{"error":"unreachable"|"timeout"},…}` = app hidup tapi DB tidak siap → LB boleh mencabut instance.
- Selalu cepat (<500ms; cek DB dibatasi race-timeout 800ms — tidak pernah menggantung walau DB black-hole).
- TANPA autentikasi (LB tidak punya session) dan TANPA kebocoran (tidak ada nama schema/DSN/host — kategori error generik; detail hanya di log server `[health]`).
- `db:"timeout"` vs `"unreachable"`: timeout = DB menerima koneksi tapi tidak menjawab / jaringan lambat; unreachable = koneksi ditolak.

```bash
curl -s -w "\n%{http_code}\n" https://onevity.sayone.my.id/api/health   # 200 = sehat
```

---

## 6. Rollback

```bash
cd <folder-project>
git checkout <commit-sebelumnya>     # mis. 2b1ed6d (task 38)
rm -rf .next && npm run build
pm2 restart onevity --update-env
# lalu verifikasi §3 sesuai ekspektasi commit tersebut
```

Bila perlu rollback database: jangan asal `db:push` — koordinasikan dengan pemilik data
(auto-parity idempoten membuat rollback kode umumnya aman terhadap DB yang lebih baru).

---

## 7. Lampiran — root cause Task 39: kenapa modal terasa "kecil dan padat"

**Gejala**: hampir semua dialog terkunci di lebar 512px meskipun kodenya `max-w-2xl`/`max-w-3xl`.

**Root cause** (kombinasi 3 fakta):

1. Base `DialogContent` shadcn (`src/components/ui/dialog.tsx`) membawa class `sm:max-w-lg` → 512px pada viewport ≥ 640px.
2. Tailwind CSS menempatkan **responsive variant SETELAH bare utility** dalam urutan stylesheet →
   pada viewport ≥ 640px, `sm:max-w-lg` (base) **MENANG** melawan bare `max-w-2xl` pada className yang sama.
3. `tailwind-merge` tidak menghapus `sm:max-w-lg` saat merge bare `max-w-2xl` — karena keduanya
   **beda variant**, dianggap class berbeda.

**Fix** (`befb30d`): semua DialogContent memakai prefix `sm:max-w-*` sehingga benar-benar menimpa base,
dengan tier lebar sesuai konten:

| Token | Lebar efektif ≥ 640px | Penggunaan |
|---|---|---|
| `sm:max-w-md` | 448px | dialog konfirmasi kecil |
| `sm:max-w-lg` | 512px | form 3–6 field |
| `sm:max-w-xl` | 576px | form 7+ field |
| `sm:max-w-2xl` | 672px | grid banyak field / detail |
| `sm:max-w-3xl` | 768px | dialog berisi tabel |
| `sm:max-w-4xl` | 896px | tabel uang / editor |
| `sm:max-w-5xl` / `6xl` / 920px | 1024–1152px | rule engine / import massal (memang lebar) |

**Aturan emas untuk dialog baru**: SELALU pakai prefix `sm:max-w-*` (jangan bare `max-w-*`) pada
`DialogContent`/`AlertDialogContent`, dan pilih tier sesuai tabel di atas. 0 bare token tersisa
setelah `befb30d`.

---

## 8. Cheatsheet cepat (copy-paste)

```bash
# DEPLOY PENUH
pm2 describe onevity | grep -iE "cwd|script"      # temukan folder
cd <folder> && git pull origin main && git log --oneline -1
npm run db:generate                                # bila src/generated belum ada
rm -rf .next && npm run build && pm2 restart onevity --update-env
pm2 logs onevity --lines 20

# VERIFIKASI
curl -s -w "\n%{http_code}\n" https://onevity.sayone.my.id/api/health   # 200 + db:"ok" = app + DB sehat
curl -s https://onevity.sayone.my.id/ | grep -oE 'chunks/[^"]+\.css'
grep -rl "sm:max-w-4xl" .next/static/chunks/ | head -3
# lalu browser: Leave → Permintaan Cuti → Ajukan Cuti → lebar dialog harus 672px
```

---

## 9. Log & rotasi (logrotate)

Aplikasi menulis log ke file via `tee` (lihat script `dev`/`start` di `package.json`):

- **dev**: `next dev … | tee dev.log` → `dev.log` di folder project (mesin dev/sandbox).
- **prod**: `start` = `… | tee server.log` → `server.log` di folder project. Bila stdout juga ditangkap PM2, file di `~/.pm2/logs/` ikut bertumbuh.

Tanpa rotasi, file ini tumbuh tanpa batas (log kompilasi + query + modul bisa puluhan MB/hari). Pasang logrotate — **`copytruncate` WAJIB** karena `tee` terus memegang inode file yang sama (rotasi rename saja membuat `tee` terus menulis ke inode lama yang terhapus):

```bash
# /etc/logrotate.d/onevity  (ganti <folder-project> dengan cwd PM2 — §2 langkah 1)
<folder-project>/dev.log <folder-project>/server.log {
    daily
    rotate 14
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
}
```

Alternatif bila seluruh log lewat PM2: `pm2 install pm2-logrotate` (atur `max_size 50M`).
Verifikasi: `logrotate -d /etc/logrotate.d/onevity` (dry-run) → `ls -lh dev.log server.log` keesokan hari.
