# UAT HR BASE — BAGIAN 1: Autentikasi + Perusahaan + Struktur Organisasi
Tanggal: 2026-10-27 · Browser: agent-browser (headless Chromium, 1 sesi) · Akun: hrd@mii.co.id (OWNER MII) · Bahasa: Indonesia

## 1. TABEL HASIL PER SKENARIO

| ID | Skenario | Hasil | Bukti | Catatan |
|----|----------|-------|-------|---------|
| A1 | Halaman login render | **PASS** | 01-login-page.png | Judul "RekanKerja — Human Resource Base"; form MASUK (email+sandi) render penuh bahasa Indonesia; hero + trust badge |
| A2 | Login password salah | **PASS** | 02-login-invalid.png | Alert: "Email atau kata sandi salah (sisa 4 percobaan sebelum akun terkunci)" — tidak crash/blank; lockout counter aktif |
| A3 | Login benar | **PASS** | 03-login-success.png | Masuk workspace; header "PT Mitra Industri Internasional · TRIAL"; user "Tri Handayani · OWNER"; dashboard 43 karyawan aktif / 18 unit |
| A4 | Sesi tersimpan | **PASS** | (via curl header) | Sesi di cookie httpOnly `rekankerja_session` (SameSite=lax, Max-Age 7 hari) — BUKAN localStorage (lebih aman, lihat F-09) |
| B1 | Sidebar/menu HR | **PASS** | 04-sidebar-hr.png | Rail 9 modul; HR Base aktif; submenu lengkap terlihat (daftar di §3) |
| B2 | Buka modul HR Base | **PASS** | 04-sidebar-hr.png | Dashboard HR render (KPI 43 karyawan / 2 approval / 18 unit / 20 posisi) |
| C1 | Daftar perusahaan render | **FAIL** | 05-company-list.png | Halaman render TAPI data kosong semua: nama perusahaan kosong, Karyawan=0, Unit=0, Posisi=0, semua info "—" — padahal API kembalikan 45/18/3 dan DB punya alamat/telp/email/NPWP (F-02) |
| C2 | Regresi: edit company | **FAIL** | 06-company-edit.png, 07-company-save-failed.png | Klik Simpan → toast error "id company wajib" (400). Bug lama "tidak bisa edit company" MASIH ADA. Form terbuka KOSONG (field tidak terisi data existing). PATCH API dengan `id` langsung via fetch TERBUKTI BEKERJA (200) → bug murni frontend (F-01) |
| C3 | Validasi form company | **FAIL** | 07-company-save-failed.png | Tidak ada validasi field wajib client-side; kosongkan Nama → Simpan → error generik teknis yang sama (bukan 500, tapi bukan pesan validasi proper) (F-06) |
| C4 | Field Kode Perusahaan | **READ-ONLY (by design)** | 06-company-edit.png | Dialog edit TIDAK punya field kode (hanya nama/nama singkat/NPWP/telepon/email/website/kota/alamat); PATCH API juga tidak menerima perubahan `code` (F-10) |
| D1 | Tree struktur organisasi | **PASS** | 08-org-tree.png | "18 unit organisasi dalam 4 level hierarki"; CEO Office → 6 divisi → sub-unit; indentasi + badge jumlah karyawan jelas; panel detail okupasi vs budget |
| D2 | Buat unit baru | **PASS** | 09-org-create.png, 10-org-created.png | UAT-TEST-1 / "Unit Uji Coba UAT" / parent IT / budget 5 → tersimpan, muncul di tree (19 unit), toast sukses; validasi kode+nama wajib ada |
| D3 | Edit unit baru | **FAIL (UI) / PASS (API)** | 11-org-edit.png | UI TIDAK PUNYA tombol/dialog edit unit sama sekali (hanya Buat + Hapus) (F-03). Via API PATCH: name → "Unit Uji Coba UAT v2", budget → 7 — tersimpan & bertahan setelah reload (200) |
| D4 | Edit kode unit (kritikal) | **FAIL** | 12-org-code-field.png | Kode unit TIDAK BISA diedit: (a) UI: tidak ada dialog edit unit; (b) API PATCH: field `code` di-ignore diam-diam (balas 200 OK tapi kode tetap) — fitur yang pernah diminta user BELUM ada (F-04) |
| D5 | Hapus unit uji | **PASS** | 13-org-deleted.png | Dialog konfirmasi "Hapus unit? … akan dihapus permanen" → unit hilang dari tree, kembali 18 unit |
| D6 | Hapus unit ber-anak/karyawan | **PASS** | 14-org-delete-guard.png | CEO Office (2 sub-unit + 2 karyawan + 1 posisi): tombol Hapus TIDAK DIRENDER di UI (guard); API DELETE → 400 "Unit memiliki sub-unit — hapus/pindahkan sub-unit terlebih dahulu" (bukan 500). Catat: UI tidak menjelaskan alasan tombol hilang (F-07) |
| D7 | Fitur org lainnya | **INFO** | 15-org-map-bonus.png | Peta Organisasi: mode Orang/Unit, pan+zoom, buka/tutup semua cabang, filter level, ekspor PNG 2×, legenda; Kantor & Lokasi Kerja (3 kantor MII); tree expand/collapse; daftar karyawan per unit. Tidak ada drag-drop reordering unit |
| E1 | Hygiene console | **PASS** | — | 0 console error, 0 page error (agent-browser errors kosong). Hanya: warning a11y Radix DialogContent (F-08) + log HMR/Fast Refresh dev + info React DevTools |
| E2 | Tutup browser | **PASS** | — | `agent-browser close` sukses; 16 file bukti tersimpan |

## 2. DAFTAR TEMUAN

- **[F-01] [KRITIS] Edit profil Perusahaan gagal total — regresi "tidak bisa edit company" masih ada**
  Repro: HR Base → Perusahaan → Edit Profil → isi field → Simpan → toast merah **"id company wajib"**, data tidak tersimpan.
  Akar masalah: commit multi-company (`a90147e`) mengubah kontrak PATCH `/api/rekankerja/companies` menjadi wajib `id` by-id, tapi form `CompanyProfile` (org-module.tsx) tidak pernah mengirim `id`.
  Bukti: 07-company-save-failed.png; PATCH langsung via fetch dengan `id` → 200 sukses (phone DB berubah) → bug 100% frontend.
- **[F-02] [MAJOR] Halaman Perusahaan menampilkan data kosong/nol padahal data ada**
  Repro: HR Base → Perusahaan → nama perusahaan kosong, Karyawan Aktif=0, Unit Organisasi=0, Posisi=0, Alamat/Telepon/Email/Website/NPWP semua "—", badge mata uang kosong.
  Akar masalah: GET companies kini mengembalikan `{companies[], activeId, multi}` (shape switcher multi-company) sedangkan CompanyProfile membaca `data.company.{name, activeEmployees, positions, orgUnitCount, address…}` → undefined. DB aktual: PT Mitra Industri Internasional, 45 karyawan, 18 unit, alamat "Jl. Industri Raya Kav. 25, Kawasan Industri Pulogadung", telp, email, website, NPWP semuanya terisi.
  Bukti: 05-company-list.png vs respons API & DB (curl/prisma). Risiko turunan: form edit terbuka KOSONG — jika F-01 di-fix tanpa fix shape, simpan akan menimpa data valid dengan nilai kosong (bahaya kehilangan data).
- **[F-03] [MAJOR] Tidak ada fitur EDIT unit organisasi di UI**
  Repro: pilih unit apa pun di tree → panel detail hanya punya tombol "Hapus"; tidak ada tombol/tulisan edit; tidak bisa ubah nama/budget dari UI.
  API PATCH `/api/rekankerja/org-units` (name, headcountBudget, active) tersedia dan bekerja — hanya tidak dipakai UI.
- **[F-04] [MAJOR] Kode unit tidak dapat diubah — fitur yang pernah diminta user BELUM tersedia**
  UI: tidak ada dialog edit sama sekali. API: PATCH mengabaikan field `code` secara diam-diam (kirim `code:"UAT-TEST-9"` → 200 OK, kode tetap UAT-TEST-1, tanpa pesan error). Perlu keputusan produk: whitelist `code` di PATCH (+validasi unik) + dialog edit UI, atau tolak eksplisit 400.
- **[F-05] [MINOR] Copy toast dobel kata: "Unit Unit Uji Coba UAT berhasil dibuat" / "Unit Unit Uji Coba UAT v2 akan dihapus permanen"**
  Repro: buat/hapus unit → awalan template "Unit {n}" bertabrakan dengan nama yang sudah ber-kata "Unit". Bukti: snapshot D2/D5.
- **[F-06] [MINOR] Validasi form company minim + pesan error teknis tidak diterjemahkan**
  Field wajib (Nama Perusahaan) bisa dikosongkan tanpa pesan inline; error server "id company wajib" adalah teks dev (campur istilah EN "company"/"id" di UI Indonesia). PATCH juga tidak menolak name kosong → hazard timpa nama kosong pasca-fix F-01.
- **[F-07] [MINOR] Guard hapus unit tidak menjelaskan alasan di UI**
  Unit ber-anak/ber-karyawan: tombol Hapus disembunyikan begitu saja tanpa tooltip/pesan "tidak bisa dihapus karena memiliki sub-unit/karyawan" — user bingung tombolnya ke mana. (Pesan 400 di API sudah jelas & dwibahasa-ish.)
- **[F-08] [MINOR] Warning a11y Radix: "Missing `Description` or `aria-describedby={undefined}` for {DialogContent}"** (console, muncul tiap buka dialog) — pre-existing, aksesibilitas.
- **[F-09] [INFO] Sesi disimpan di cookie httpOnly `rekankerja_session` (SameSite=lax, Max-Age 7 hari), bukan localStorage** — lebih aman terhadap XSS; verifikasi via header respons curl. localStorage hanya berisi preferensi (`rekankerja:lang`, `rekankerja:pwa-dismissed`).
- **[F-10] [INFO] Kode Perusahaan read-only by design** — tidak ada field kode di dialog edit; API PATCH tidak menerima `code`. Konsisten, tapi tidak didokumentasikan ke user (tidak ada keterangan "kode tidak dapat diubah").
- **[F-11] [MINOR] Dialog PWA install tetap muncul di sesi pertama** meskipun flag dismissal diset — efektif baru setelah reload berikutnya (jebakan lingkungan yang diketahui, tapi terasa oleh user baru).
- **[F-12] [INFO] Lockout login informatif dan bekerja** — pesan sisa percobaan muncul sejak kegagalan pertama.
- Catatan insiden kecil: 1x `TypeError: Failed to fetch` dari eval browser saat HMR rebuild (transient, konteks eval, bukan error aplikasi — 0 error console page).

## 3. SUBMENU HR BASE (bahasa Indonesia sesuai UI)

Rail modul (9): Human Resource Base · Payroll · Attendance · Leave · Travel · Medical · Whistleblowing · Recruitment · Performance (+ tombol Pengaturan Sistem).

Grup & submenu Human Resource Base (ID → EN):
- Dashboard
- PERUSAHAAN & ORGANISASI: Perusahaan (Company) · Kantor & Lokasi Kerja (Offices) · Unit Organisasi (Org Unit/Tree) · Peta Organisasi (Org Chart)
- POSISI & JABATAN: Daftar Posisi (Positions) · Katalog Jabatan (Job Catalog) · Katalog Keahlian (Skills) · Jalur Karier (Career Paths) · Grade & Level · Level Jabatan (Job Levels)
- KARYAWAN: Direktori Karyawan (Directory) · Onboarding Karyawan · Checklist Onboarding · Catatan Disiplin · Dokumen Karyawan · Aset Karyawan · Offboarding Karyawan
- PENGAJUAN & PERSETUJUAN: Menunggu Persetujuan (badge 2) · Semua Pengajuan · Pengajuan Ubah Data
- DOKUMEN & SURAT: Template Surat
- KOMUNIKASI: Pengumuman
- LAPORAN: Laporan HR · Laporan Kustom

## 4. STATUS KHUSUS

- **(a) Edit company: TIDAK BEKERJA dari UI** — gagal 400 "id company wajib" (F-01); lapisan API PATCH sendiri SEHAT (terbukti 200 saat `id` dikirim manual). Ditambah halaman profil menampilkan data kosong (F-02). Dua-duanya regresi dari fitur multi-company switcher.
- **(b) Field kode unit: TIDAK BISA diedit** — tidak ada UI edit; API PATCH mengabaikan `code` diam-diam (200 tanpa efek) (F-04).
- **(c) Error console: NOL** selama sesi penuh. Hanya warning a11y Radix DialogContent (berulang) + log HMR/React dev + info SW PWA — tidak ada error aplikasi baru.

## 5. PERUBAHAN DATA UAT (untuk transparansi)

- Phone company MII diubah menjadi "(021) 555-0100" via PATCH API langsung (bukti API bekerja; nilai asli tidak tercantum di seed saat ini).
- Unit UAT-TEST-1 dibuat → di-rename "Unit Uji Coba UAT v2" (budget 7) → DIHAPUS. Tree kembali bersih: 18 unit, 4 level.

Semua bukti: /home/z/my-project/audit/uat-hr-base/ (16 file: 01–15 + duplikat 07-company-save-failed.png).
