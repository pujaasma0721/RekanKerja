# Laporan UAT — Modul Human Resource Base (RekanKerja)

## 1. Informasi Umum

| Item | Keterangan |
|---|---|
| Tanggal | 27 Oktober 2026 |
| Aplikasi | RekanKerja — Modul Human Resource Base |
| Environment utama | Development: `http://localhost:3000` (dev server di dalam container; data demo PT Mitra Industri Internasional/MII, 45 karyawan; vault KMS dev belum terkonfigurasi) |
| Environment tambahan | Domain publik `https://rekankerja.namatawa.my.id/` — dipakai untuk pemeriksaan awal & investigasi; ternyata mengalami **split-brain routing** (dua backend bergantian — lihat bagian 5). Seluruh UAT fungsional kemudian dijalankan dan diselesaikan di `localhost:3000` agar kode & data terkendali. |
| Tester | Tri Handayani — PT Mitra Industri Internasional (MII), role **OWNER**, login `hrd@mii.co.id` (peran HR) |
| Metode | UAT eksploratif via browser, desktop 1280×720 dan mobile 390×844. Pada dasarnya **read-only** (tidak ada approve/reject/submit/hapus/export); aksi tulis hanya pada uji end-to-end yang ditetapkan (edit profil perusahaan, edit unit + budget) dan **seluruhnya direvert** ke nilai asli. |
| Cakupan | Seluruh 21 menu HR dalam 7 kelompok (Perusahaan & Organisasi; Posisi & Jabatan; Karyawan; Pengajuan; Dokumen & Surat; Komunikasi; Laporan) + Dashboard + pencarian global (Ctrl+K) + responsif mobile (dashboard & direktori karyawan) + footer |
| Eksekusi | 3 sesi paralel: sesi utama (dashboard, perusahaan & organisasi, posisi & jabatan, direktori — uji 01–18) + subagent A (karyawan & pengajuan — uji 19–28) + subagent B (dokumen/surat, komunikasi, laporan, mobile, footer — uji 29–35) |
| Artefak | `audit/uat-hr-base/` — 39 file screenshot (35 butir bernomor 01–35 + 4 tangkapan pendukung) + `findings.md` + `findings-b.md` + laporan ini |

## 2. Ringkasan Eksekutif

**SKOR TOTAL: 33/34 PASS (97%) — LULUS UAT dengan catatan. Tidak ada blocker fungsional.**

- 35 butir uji bernomor (01–35) terdiri dari **34 butir uji inti** (menu modul, dashboard, responsif mobile, footer) + **1 uji lintas-menu** (pencarian global Ctrl+K, uji #28 — **PASS**, dilaporkan terpisah karena bukan menu modul).
- Hasil uji inti: **33 PASS, 1 FAIL** — uji #34 (Direktori Karyawan versi mobile) gagal karena overflow horizontal 98px pada viewport 390×844 (klasifikasi **MAYOR**).
- Console browser bersih sepanjang seluruh sesi (0 error JS; tidak ada skeleton macet; semua fetch selesai).
- Temuan terklasifikasi: **1 KRITIS-INFRASTRUKTUR** (split-brain routing domain publik — isu platform di luar container, bukan bug kode aplikasi), **1 MAYOR** (overflow mobile direktori), **8 MINOR/UX**, plus catatan tambahan non-blocker dan **1 catatan performa** (endpoint employee-detail 6–10 detik saat cold compile dev).
- Konsistensi data baik: KPI dashboard ↔ direktori ↔ badge sidebar ↔ laporan saling cocok (43 aktif, 2 approval menunggu, 45 total karyawan, 9 dokumen pengajuan); 3 empty state terverifikasi via API memang kosong di DB (bukan bug UI).

## 3. Tabel Hasil per Menu/Uji

| No | Area/Uji | Status | Catatan singkat |
|----|----------|--------|-----------------|
| 01 | Dashboard | PASS | KPI konsisten: 43 karyawan aktif, +1 hiring YTD, 2 approval menunggu, 18 unit, 20 posisi, gaji rata-rata Rp 11,5 jt (vault dev tidak terkonfigurasi); tren rekrutmen, komposisi gender 25/18, headcount per divisi, distribusi grade. Diverifikasi ulang di localhost pasca anomali domain (lihat INF-01; butir ini punya 2 tangkapan). |
| 02 | Perusahaan — Profil | PASS | Profil perusahaan lengkap termuat tanpa error. |
| 03 | Perusahaan — Edit Profil (E2E) | PASS | Ubah telepon 021-4600808 → 021-4600999 → simpan → tampil di UI → revert ke nilai asli; kedua arah sukses. |
| 04 | Kantor & Lokasi Kerja | PASS | 3 kantor, 6 lokasi, 42 karyawan terpenempat; tabel lengkap. |
| 05 | Unit Organisasi — Pohon | PASS | Pohon 18 unit, 4 level, termuat lengkap. |
| 06 | Unit Organisasi — Panel Detail | PASS | Detail unit IT: 4 karyawan, info unit lengkap. |
| 07 | Unit Organisasi — Edit Unit (warning kode) | PASS | Prefill benar; ganti kode MII-ITD → MII-TECH memunculkan warning "Kode unit akan berubah — periksa dampaknya" + status aman + advisory template Excel. |
| 08 | Unit Organisasi — Edit Budget (E2E) | PASS | Budget 8 → 10 tersimpan (UI BUDGET HC 10, okupasi 4/10 = 40%) lalu direvert ke 8 via DB. |
| 09 | Peta Organisasi | PASS | 53 node SVG, zoom/pan berfungsi, KPI header. |
| 10 | Daftar Posisi | PASS | 20 posisi, 45 terisi, 21 lowongan; filter unit/grade + advance search. |
| 11 | Katalog Jabatan | PASS | 16 job family, 20 posisi terpetakan. |
| 12 | Katalog Keahlian | PASS | 17 keahlian aktif. |
| 13 | Jalur Karier | PASS | Empty state rapi — 0 jalur terdaftar (gap data seed, bukan bug; lihat MIN-08). |
| 14 | Level Jabatan | PASS | 8 level, 43 karyawan terpetakan. |
| 15 | Direktori Karyawan — Daftar & Filter | PASS | 45 karyawan; filter status (aktif 43, probation 2, kontrak 6, non-aktif 2); bucket kontrak berakhir. |
| 16 | Direktori Karyawan — Pencarian | PASS | Pencarian "Dedi" → 2 hasil benar (Dedi Mahendra, Dedi Pratama). |
| 17 | Direktori — QuickView Karyawan | PASS | Dialog quickview lengkap: unit, grade, masa kerja, kontak. |
| 18 | Profil Karyawan 360° | PASS | Tab lengkap (Personal/Pekerjaan/Keluarga/Pendidikan/Pengalaman/Disiplin/Surat); field terenkripsi NIK/NPWP terbaca benar; gaji Rp 4.500.000 tampil (vault legacy). Catatan performa: employee-detail 6–10 dtk saat cold compile (PERF-01). |
| 19 | Onboarding Karyawan | PASS | Wizard 4 langkah (Data Personal → Info Pekerjaan → Upah & Bank → Review) lengkap; indikator "Langkah 1 dari 4" + 0%; notice draft otomatis. |
| 20 | Checklist Onboarding | PASS | 1 checklist: Siti Rahmawati (MII00045, CEO, mulai 9 Nov 2026), progres 0/8, status Terbuka. |
| 21 | Catatan Disiplin | PASS | Statistik verbal 2 / tertulis 3 / final 0; tabel 5 catatan lengkap dengan aksi "Surat". |
| 22 | Dokumen Karyawan | PASS | Empty state benar — API mengembalikan 0 dokumen (gap seed, lihat MIN-07); filter ≤30/≤60/≤90 hari belum bisa diverifikasi dengan data nyata. |
| 23 | Aset Karyawan | PASS | Tab Inventaris: 8 aset, nilai total Rp 316.470.000; tab Penugasan: 4 assignment aktif. |
| 24 | Offboarding Karyawan | PASS | Empty state rapi & konsisten (0 proses — satu-satunya pengajuan resignasi berstatus Ditolak). |
| 25 | Menunggu Persetujuan (+ Detail) | PASS | 2 pengajuan (sesuai badge sidebar & dashboard); detail PA-2026-0002 lengkap: perubahan posisi/grade/gaji, alur approval 2 layer, jejak aktivitas. Tombol Setujui/Tolak TIDAK dieksekusi (mandat read-only). |
| 26 | Semua Pengajuan | PASS | 9 dokumen PA-2026-0001..0009; stat bar 2/2/1/1/2/1 = 9 ✓ konsisten; filter status/jenis + advance search. |
| 27 | Pengajuan Ubah Data | PASS | Empty state rapi (pengajuan ubah data diri dari ESS belum ada). |
| 28 | Pencarian Global (Ctrl+K, "Dedi") | PASS | Command palette menampilkan 2 hasil karyawan benar; ditutup via Escape. *Uji lintas-menu — di luar penghitungan 34 butir inti.* |
| 29 | Template Surat | PASS | 28 template dalam 5 kategori (verifikasi hitung kartu); tab katalog/dokumen terbit/permintaan; tidak ada tombol pratinjau (aksi "Ubah"/"Kembalikan ke Bawaan" bersifat tulis — tidak diklik). Lihat MIN-04. |
| 30 | Pengumuman | PASS | Data nyata: 2 Terbit Aktif, 1 Draft, 8 total dibaca; tabel 3 baris; filter + advance search lengkap. |
| 31 | Laporan HR | PASS | 3 tab lengkap: Turnover & Tenure (KPI + grafik + tabel per divisi), Demografi (8 visual termasuk crosstab), Reports (16 laporan siap cetak, 4 grup). Lihat MIN-05. |
| 32 | Laporan Kustom | PASS | Builder 6 entity (Karyawan/Baris Payroll/Rekap Kehadiran/Cuti/Klaim Perjalanan/Klaim Medis); empty state rapi. |
| 33 | Mobile — Dashboard (390×844) | PASS | Tanpa overflow; KPI 1 kolom; bottom navigation + drawer menu modul lengkap & dapat dinavigasi; prompt PWA bisa ditutup. |
| 34 | Mobile — Direktori Karyawan (390×844) | **FAIL (Mayor)** | Overflow horizontal 98px (scrollW 488 > 390): baris aksi "Onboarding · Import Excel · Export Excel" tidak wrap (tombol Export Excel terpotong off-screen) dan chip filter "Kontrak 6"/"Non-aktif 2" keluar viewport (hingga x=557). Lihat MAY-01. |
| 35 | Footer (desktop) | PASS | `position: static` (bukan fixed/overlay); tepat di dasar viewport saat scroll penuh; 0 elemen tumpang tindih di Dashboard dan halaman panjang Direktori. |

> Penghitungan skor: 35 butir bernomor = 34 butir uji inti (01–27, 29–35) + 1 uji lintas-menu (#28, PASS). Uji inti: **33 PASS + 1 FAIL (#34)** → 33/34 PASS (97%).

## 4. Daftar Temuan Terklasifikasi

### KRITIS — Infrastruktur (bukan kode aplikasi)

- **INF-01 — Split-brain routing domain publik `https://rekankerja.namatawa.my.id/`**: request yang sama dilayani bergantian oleh DUA backend berbeda (dev server container dengan data terkini vs deployment remote dengan database berbeda). Pengguna domain dapat melihat data yang BUKAN data dev terkini dan perilaku bisa berubah-ubah antar koneksi. Akar masalah ada di platform (di luar container) — detail lengkap di bagian 5. Tidak memblokir kelulusan UAT fungsional, tetapi wajib ditindaklanjuti sebelum domain dipakai pengguna nyata.

*(Tidak ditemukan blocker fungsional pada kode aplikasi modul Human Resource Base.)*

### MAYOR

- **MAY-01 — [Mobile][Direktori Karyawan] Overflow horizontal 98px pada viewport 390×844** (scrollW 488 > 390): baris aksi "Onboarding · Import Excel · Export Excel" tidak membungkus (tombol Export Excel di ujung kanan terpotong off-screen, x=488) dan chip filter "Kontrak 6" / "Non-aktif 2" melewati viewport (hingga x=557) — keduanya harus di-scroll horizontal untuk diakses. Kartu karyawan sendiri responsif (full-width 358×260) dan data termuat lengkap. Dampak: kontrol tidak terlihat/tidak praktis dijangkau di ponsel; tidak merusak data. Perbaikan: `flex-wrap` pada action row + wrap atau scroll-x bersyarat pada chips.

### MINOR / UX

- **MIN-01 — KPI gaji "Rp 0" tanpa indikator terkunci**: saat vault terkunci (sebagaimana terlihat di deployment remote via domain publik), dashboard menampilkan "Rata-rata Gaji Rp 0" — perilaku by-design (nilai disensor vault), namun UX-nya menyesatkan (terlihat seperti gaji nol/data rusak). Sebaiknya tampilkan "—"/"Terkunci"/tooltip penjelas.
- **MIN-02 — Tombol "Kembali ke Daftar" pada detail pengajuan selalu mendarat di "Semua Pengajuan"**: masuk dari menu "Menunggu Persetujuan" → buka detail → kembali → mendarat di `actions/all`, bukan ke inbox persetujuan asal (`actions-module.tsx` ~baris 629, `navigate("actions","all")` tanpa mengingat asal). Tidak fatal, tetapi alur balik kurang intuitif bagi approver.
- **MIN-03 — Command palette (Ctrl+K) tidak memfilter daftar menu**: saat mengetik query, section "Navigasi" tetap menampilkan semua menu tanpa filter; hanya section "Karyawan" yang terfilter. Jika menu memang seharusnya bisa dicari, filternya tidak bekerja; jika memang desain (menu selalu tampil), perlu dikonfirmasi/didokumentasikan.
- **MIN-04 — Ringkasan header Template Surat tidak konsisten dengan katalog**: header menulis "28 template … 3 disipliner · 12 personnel action · 5 surat layanan karyawan · 4 rekrutmen" (jumlah 24) — kategori KINERJA (4 template) tidak disebut, padahal kartu aktual = 28. Katalog benar; hanya teks ringkasan yang salah jumlah.
- **MIN-05 — Pie "Komposisi Gender" (Laporan Demografi) tidak sinkron dengan crosstab**: pie menampilkan Laki-laki 25 · Perempuan 17 · slice ketiga berlabel "P" 1, sedangkan crosstab Gender × Status Kepegawaian menghitung Laki-laki 26 · Perempuan 17 (total sama 43). Ada 1 karyawan dengan nilai gender yang di pie dianggap kategori terpisah tetapi di crosstab digabung ke Laki-laki → normalisasi nilai gender tidak konsisten antar widget.
- **MIN-06 — Anomali tanggal data seed PA-2026-0002**: "Dibuat: 9 Agu 2026" tetapi "Submit: 17 Apr 2026" (submit mendahului created ±4 bulan); jejak aktivitas tertulis "Submitted 26 Okt 2026"; tanggal efektif 18 Jul 2026 juga mendahului tanggal submit. Anomali data seed, bukan bug render.
- **MIN-07 — Seed Dokumen Karyawan kosong**: API `/api/rekankerja/employee-documents` mengembalikan 0 dokumen — fitur monitoring kedaluwarsa 30/60/90 hari tidak bisa di-UAT dengan data nyata. Disarankan menambah seed (mis. KTP/paspor dengan tanggal kedaluwarsa bervariasi).
- **MIN-08 — Seed Jalur Karier kosong**: 0 jalur terdaftar — halaman hanya bisa diverifikasi empty state-nya. Disarankan menambah contoh jalur karier agar fitur dapat di-UAT.

### Catatan tambahan (non-blocker)

- Flash state "0 template surat siap cetak" ±2–3 detik pertama di Template Surat sebelum data termuat (async) — berpotensi membingungkan sesaat.
- Prompt instal PWA muncul lagi di mobile meski flag `rekankerja:pwa-dismissed=1` sudah dipasang — cek dismissal mungkin tidak memperhitungkan kondisi viewport mobile.
- 4 penugasan aset seragam bertanggal sama "28 Jun 2026" (masa depan relatif terhadap data lain yang ber-2025) — kosmetik seed.
- Progres baca pengumuman rendah (4/43 = 9%) — konteks data seed, bukan bug.
- (QA-only) Radix Tabs memerlukan event mousedown untuk klik programatik — klik manual user asli tidak terdampak.
- (Transient) Dev server sempat restart sekali di tengah sesi ("Gagal memuat direktori — Failed to fetch", curl exit 7) — watchdog auto-restart dalam ±30 detik, bukan bug aplikasi.

### Catatan performa

- **PERF-01 — Endpoint employee-detail lambat 6–10 detik saat kompilasi pertama (dev mode / cold compile)** pada pembukaan Profil 360°. Perlu diverifikasi ulang pada build produksi; bila terjadi juga di produksi, pertimbangkan optimasi query/serialisasi atau prefetch.

## 5. Temuan Infrastruktur Domain Publik (KRITIS-INFRASTRUKTUR)

### INF-01 — Split-Brain Routing pada `https://rekankerja.namatawa.my.id/`

**Gejala**: request yang sama ke domain publik dilayani **bergantian oleh DUA backend yang berbeda**:

| Aspek | Backend A — dev server (container) | Backend B — deployment remote |
|---|---|---|
| Kode | Terkini (perubahan debug langsung berpengaruh) | Per push terakhir |
| Database | Data dev terkini — unit IT id `cmvpuaw4…` | **DATABASE BERBEDA** — unit IT id `cmtnsso…` |
| Vault KMS | TIDAK terkonfigurasi (`configured:false`) → KPI gaji tampil Rp 11,5 jt (nilai legacy) | TERKONFIGURASI + TERKUNCI → KPI gaji tampil Rp 0 |
| Sesi | Login `hrd@mii.co.id` | Sesi lintas-backend bisa valid (cookie/session diterima kedua backend) |

**Bukti**:
1. PATCH unit via domain → respons "Unit tidak ditemukan" (id unit lokal tidak ada di database backend remote).
2. API vault via domain → `configured:true`; via localhost → `configured:false` — dua backend berbeda.
3. `dev.log` tidak mencatat request yang dilayani via domain pada saat itu.
4. Edit kode debug hanya berpengaruh pada jalur localhost, tidak pada domain.

**Implikasi**:
- Pengguna domain publik bisa melihat data yang **BUKAN data dev terkini** (database berbeda).
- Perilaku aplikasi bisa berubah-ubah antar koneksi (request bergantian dilayani backend mana) — tidak deterministik, sulit direproduksi.
- KPI "Rata-rata Gaji Rp 0" yang terlihat di domain = vault terkunci (perilaku by-design, bukan bug data) — namun UX-nya menampilkan "Rp 0" tanpa indikator terkunci (lihat MIN-01).
- Risiko kebingungan demo/produksi: data & status konfigurasi yang dilihat user tidak dapat dijamin konsisten.

**Klasifikasi & penanganan**: KRITIS-INFRASTRUKTUR — isu platform di luar container (routing DNS/proxy/load balancer di depan domain publik), bukan bug kode aplikasi. Tidak memblokir kelulusan UAT fungsional modul (yang dijalankan penuh di localhost), tetapi **wajib ditindaklanjuti pemilik platform sebelum domain digunakan pengguna nyata**.

**Rekomendasi**: audit konfigurasi DNS/proxy/reverse-proxy domain publik (pipa menuju container dev vs deployment remote); pastikan domain hanya dilayani SATU backend yang dituju; hapus/redirect jalur satunya; verifikasi ulang dengan membandingkan id unit (`cmvpuaw4…` vs `cmtnsso…`) dan status vault API; sementara belum selesai, hindari memakai domain untuk demo yang mengandalkan data dev terkini.

## 6. Rekomendasi Perbaikan (urut prioritas)

1. **[KRITIS-INFRA, segera — pemilik platform]** Perbaiki routing domain publik: pastikan domain hanya dilayani satu backend tunggal; verifikasi dengan membandingkan id unit dan status vault via domain vs localhost. Sampai selesai, beri label/komunikasikan bahwa data di domain tidak dapat dijamin sama dengan data dev terkini.
2. **[MAYOR] Perbaiki overflow mobile Direktori Karyawan**: bungkus (flex-wrap) baris aksi Onboarding/Import/Export Excel dan beri wrap/scroll-x bersyarat pada chip filter agar semua kontrol masuk viewport 390px.
3. **[MIN-01] Indikator vault terkunci**: tampilkan "—"/"Terkunci"/tooltip alih-alih "Rp 0" pada KPI gaji saat vault tidak tersedia.
4. **[MIN-02] Navigasi balik detail pengajuan**: "Kembali ke Daftar" kembali ke konteks asal (Menunggu Persetujuan vs Semua Pengajuan) — simpan asal route di `actions-module.tsx` (~baris 629).
5. **[MIN-03] Command palette**: filter section Navigasi sesuai query, atau tetapkan (dan dokumentasikan) bahwa daftar menu memang selalu ditampilkan.
6. **[MIN-04] Ringkasan Template Surat**: cantumkan kelima kategori (tambah "4 kinerja") agar 3+12+5+4+4 = 28 konsisten dengan katalog.
7. **[MIN-05] Normalisasi gender**: satukan definisi/normalisasi nilai gender antar widget Laporan Demografi (pie vs crosstab) dan perbaiki 1 record bernilai ambigu.
8. **[MIN-06/07/08 + seed] Perbaikan data seed**: rapikan tanggal PA-2026-0002 (urutan created/submit/efektif) dan tanggal penugasan aset; tambah seed dokumen karyawan dengan kedaluwarsa bervariasi (≤30/≤60/≤90 hari) agar fitur monitoring dapat diverifikasi; tambah contoh jalur karier.
9. **[PERF-01] Employee-detail**: ukur ulang pada build produksi; bila lambat juga, optimasi query/serialisasi atau pertimbangkan prefetch profil.
10. **[Opsional]** flash state "0 template" (tampilkan skeleton/placeholder), PWA prompt mobile (perhitungkan viewport saat cek flag dismissal).

## 7. Lampiran

### Tangkapan layar (39 file, `audit/uat-hr-base/`)

**Sesi utama — dashboard, perusahaan & organisasi, posisi & jabatan, direktori (uji 01–18, 20 file):**
`01-dashboard.png` · `01-dashboard-localhost.png` (butir 01 — dua tangkapan: versi awal & verifikasi ulang localhost pasca temuan INF-01) · `02-perusahaan.png` · `03-perusahaan-edit.png` · `04-kantor-lokasi.png` · `05-unit-organisasi.png` · `06-unit-detail.png` · `07-edit-unit-warning.png` · `08-unit-budget-saved.png` · `09-peta-organisasi.png` · `10-daftar-posisi.png` · `11-katalog-jabatan.png` · `12-katalog-keahlian.png` · `13-jalur-karier.png` · `14-level-jabatan.png` · `15-direktori.png` · `16-direktori-search.png` · `17-quickview-karyawan.png` · `17-detail-karyawan.png` · `18-profil-360.png`

**Seksi karyawan & pengajuan — subagent A (uji 19–28, 12 file):**
`19-onboarding.png` · `20-checklist-onboarding.png` · `21-catatan-disiplin.png` · `22-dokumen-karyawan.png` · `23-aset-karyawan.png` · `23-aset-karyawan-penugasan.png` · `24-offboarding.png` · `25-menunggu-persetujuan.png` · `25-detail-pengajuan.png` · `26-semua-pengajuan.png` · `27-pengajuan-ubah-data.png` · `28-search-global.png`

**Seksi dokumen/surat, komunikasi, laporan + mobile + footer — subagent B (uji 29–35, 7 file):**
`29-template-surat.png` · `30-pengumuman.png` · `31-laporan-hr.png` · `32-laporan-kustom.png` · `33-mobile-dashboard.png` · `34-mobile-direktori.png` · `35-footer.png`

> 35 tangkapan utama bernomor 01–35 + 4 tangkapan pendukung (butir 01 versi localhost, 17 detail karyawan, 23 tab penugasan, 25 detail pengajuan) = 39 file.

### Laporan pendukung

- `findings.md` — hasil UAT seksi Karyawan & Pengajuan (subagent A, uji 19–28)
- `findings-b.md` — hasil UAT seksi Dokumen/Surat, Komunikasi, Laporan + Mobile (subagent B, uji 29–35)
- `LAPORAN-UAT.md` — laporan kompilasi final (laporan ini)

---

*Disusun 27 Oktober 2026 — UAT modul Human Resource Base, RekanKerja. Semua aksi tulis pada data demo telah direvert; tidak ada dokumen pengajuan yang di-approve/reject/submit selama UAT.*
