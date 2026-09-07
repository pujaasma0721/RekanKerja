# GAP-ANALISIS-DEEP — Audit Domain-First OneVity HRIS

> Tanggal: sesi audit ulang setelah umpan balik pengguna.
> Status: **Jawaban atas kritik metodologi audit sebelumnya** (audit/BPA-*.md).

---

## 0. Pengakuan Keterbatasan Metodologi Audit Sebelumnya

Audit lama (BPA-*.md) menjawab pertanyaan yang salah:

| | Audit lama (BPA) | Audit ini (domain-first) |
|---|---|---|
| Pertanyaan | "Seberapa matang modul yang **sudah dibangun**?" | "Apa yang **wajib/akan diharapkan** dimiliki HRIS Indonesia — dan mana yang **belum ada** di OneVity?" |
| Metode | Baca kode modul → skor kematangan 1–10 | Checklist domain penuh (lifecycle karyawan × pilar HCM × kepatuhan UU/PP Indonesia × fitur power benchmark Mekari Talenta / CATAPA / Gadjian / SAP SF) → diff terhadap kode |
| Hasil | Skor ±6.9/10 untuk fitur yang ada | Daftar **fitur yang tidak ada sama sekali** — tidak dapat di-skor |
| Blind spot | Tidak bisa menemukan fitur yang **tidak ada** karena hanya menilai yang ada | — |

Bukti bahwa metode lama gagal: 6 temuan pengguna (edit posisi, surat disiplin, surat PA, demografi lengkap, NPWP per kantor, offboarding) semuanya adalah **table stakes** yang terlihat dalam 5 menit pemakaian oleh praktisi HR — dan semuanya **tidak muncul** di audit lama karena audit lama tidak pernah "berjalan sebagai pengguna HR". Semua sudah diperbaiki (commit `5eb6ed8`), tapi pola kegagalan analisisnya harus diakui: **analisis hanya seputar apa yang sudah dibuat.**

Audit ini membalik metodenya: mulai dari peta domain lengkap, baru cocokkan dengan kode. Setiap temuan diverifikasi dengan pencarian kode (grep) — "TIDAK ADA" berarti benar-benar nol kecocokan di `src/onevity` + `prisma/schema-tenant.prisma`.

---

## 1. Kerangka Analisis Domain-First

Empat sumbu:

1. **Lifecycle karyawan**: pre-hire (rekrutmen) → onboarding → aktif → exit → **alumni**.
2. **Pilar HCM** (bukan hanya HR-administratif): kinerja, pelatihan, suksesi, aset, pengumuman.
3. **Kepatuhan Indonesia**: PP 35/2021 (PKWT), UU 13/2003 (PP, PKWT→PKS), UMP/UMK (PP 36/2021), format e-SPT 1721 DJP, format BPJS, JKK kelas risiko, surat-surat ketenagakerjaan.
4. **Fitur power benchmark produk komersial**: geofencing, sinkron mesin absen, tukar shift, payslip berpassword, PWA, WhatsApp, audit trail UI, report builder.

---

## 2. Hasil Diff — Fitur yang TIDAK ADA (terverifikasi)

### 2.1 Lifecycle — lubang besar di AWAL dan AKHIR

| Gap | Bukti (grep nol kecuali disebut) | Dampak | Prioritas |
|---|---|---|---|
| **Rekrutmen/ATS** (permintaan lowongan, kanban pipeline kandidat, jadwal & feedback wawancara, penawaran/offer) | nol kecocokan `applicant\|candidate\|recruitment\|lowongan` | HR rekrut di Excel/WhatsApp; data kandidat hilang. Ini modul pertama yang dilihat calon pembeli HRIS | P1 |
| **Onboarding checklist** (peralatan, akun, buddy, orientasi) | hanya surat PA_HIRE + provisioning user | Karyawan baru tanpa checklist; offboarding PUNYA 9 tugas tapi onboarding NOL — asimetri aneh | P1 |
| **Alumni / rehire** | status `Blacklisted` saja; tidak ada basis alumni, SK pengalaman kerja, rujukan kerja ulang | Mantan karyawan kembali "from scratch" | P2 |
| **Permintaan surat oleh karyawan (ESS)** | nol di `ess/` | Surat keterangan hanya bisa via minta manual ke HR — padahal infra template surat baru dibangun | **P0** |

### 2.2 Pilar HCM — 4 domain utuh hilang

| Gap | Bukti | Dampak | Prioritas |
|---|---|---|---|
| **Manajemen kinerja** (siklus penilaian, KPI/OKR, 360, PIP → sumber SP objektif) | nol `appraisal\|kpi\|okr\|penilaian kinerja` | Modul Disiplin ada tanpa akar masalah kinerja; kenaikan gaji tanpa dasar penilaian | P1 |
| **Pelatihan & sertifikasi** (riwayat, biaya, kedaluwarsa sertifikat, evaluasi) | nol `training\|pelatihan\|sertifikat` | Wajib bagi manufaktur (K3) — MII adalah demo manufaktur | P1 |
| **Aspek karyawan / inventaris** (laptop, seragam, tooling; assignment + pengembalian) | nol `asset\|inventaris` | Offboarding clearance menulis tugas "kembalikan laptop" tanpa data aset nyata | P1 |
| **Suksesi & peta karier** (calon pengganti, 9-box, jalur karier per posisi) | nol | Reorganisasi tanpa data | P2 |
| **Pengumuman/broadcast perusahaan** ( announcement ke seluruh ESS, read-tracking) | nol `announcement\|pengumuman` | Komunikasi HR masih via grup WhatsApp | P1 |

### 2.3 Kepatuhan Indonesia — mesin pajak benar, tapi di sekitarnya bolong

| Gap | Bukti | Dampak | Prioritas |
|---|---|---|---|
| **Validasi UMP/UMK (upah minimum)** | nol `umk\|ump\|upah minimum`; engine cek PPh21 peduli tapi gaji < UMK **lolos diam-diam** | Pelanggaran PP 36/2021 + sengketa UPMK. NPWP per kantor sudah diperbaiki, tapi UMK per kantor belum — pasangan alaminya | **P0** |
| **Lifecycle PKWT per PP 35/2021** | hanya string status `Probation/Contract` + reminder kedaluwarsa kontrak; tidak ada: tanggal PKWT, hitungan perpanjangan, cap 5 tahun, konversi otomatis ke PKS | Pelanggaran cap 5 tahun tidak terdeteksi; PKWT adalah jenis PA `CONTRACTRENEWAL` tanpa aritmetika kontrak | **P0** |
| **Surat keterangan kerja / gaji / pengalaman kerja / referensi** | katalog LetterTemplate hanya 15 kunci (3 disiplin + 12 PA) — **tanpa satu pun surat layanan karyawan** | Surat paling sering diminta karyawan (kredit, visa, KPR) tidak bisa diterbitkan dari sistem yang baru saja dibangun sistemnya | **P0** |
| **Perjanjian Kerja (PKWT/PKS) tergenerate** | tidak ada template PK | Dokumen hukum paling penting per karyawan dibuat manual di Word — duplikasi data | **P0** |
| **e-SPT 1721 format DJP** (file .csv/.txt upload) | `payroll-spt.ts` hanya rekap XLSX | Rekap bagus untuk internal, tidak bisa diupload ke DJP Online | P1 |
| **Format upload BPJS** (laporan kepegawaian/pembayaran) | XLSX generik `reports-bpjs` | Staff admin harus re-format manual tiap bulan | P1 |
| **JKK kelas risiko per perusahaan/posisi** | `PayrollRegulation.jkkRate` tunggal global (0.24%) | 5 kelas risiko (0.24–1.74%) tidak bisa dibedakan per unit manufaktur vs kantor | P1 |
| **Peraturan Perusahaan (UU 13/2003 §108) registry + acknowledgment** | hanya 1 kata di `letter-defaults` (tidak fungsional) | Kepatuhan dokumen wajib ≥10 karyawan tidak terlacak | P2 |

### 2.4 Fitur power (benchmark produk komersial) — paritas sebagian

| Gap | Bukti | Dampak | Prioritas |
|---|---|---|---|
| **Geofencing** (radius kantor ditegakkan saat clock) | `recordClockLog` menyimpan lat/lng tapi tidak ada `radius\|geofence` di API clock | Clock dari mana saja diterima; data lokasi jadi hiasan | **P0** |
| **Sinkron mesin absen (sidik jari/face)** — import log mentah, dedupe | nol di `clocking` (G2 roadmap, **tidak pernah dikirim**) | Perusahaan bermesin absen tidak bisa pakai OneVity sebagai sumber kebenaran absensi | **P0** |
| **Papan kehadiran real-time** ("siapa di kantor sekarang") | overview = agregat harian, bukan live | Fitur "wow" pertama yang dilihat demo | P1 |
| **Tukar shift self-service** | nol | Semua perubahan jadwal lewat admin | P1 |
| **Payslip PDF berpassword** (default NIK/tgl lahir) | nol di `payslip-pdf.ts` | Kirim massal slip tanpa password = risiko kebocoran data sensitif via email | **P0** |
| **PWA (installable, manifest+SW)** | `public/` tanpa manifest | HR/karyawan mobile memakai browser tab biasa | P1 |
| **Audit trail UI** (siapa mengubah apa) | `ActivityLog` **datanya sudah dikumpulkan di 12+ API** tapi TIDAK ADA viewer sama sekali | Data audit dikumpulkan lalu dikubur — satu komponen UI saja yang kurang | **P0** |
| **Laporan terjadwal via email** (mingguan/bulanan otomatis) | scheduler ada (6 jam) tapi hanya reminder, bukan laporan | Manajer harus buka aplikasi untuk laporan rutin | P1 |
| **Notifikasi WhatsApp** | nol (hanya email+in-app) | Kanal #1 komunikasi HR di Indonesia | P2 |
| **Report builder kustom** | nol | Laporan fixed 12 sheet demografi; kebutuhan ad-hoc tak terlayani | P2 |
| **Analitik kompensasi** (pemerataan gaji, salary banding per grade vs pasar) | nol | `Grade` ada tanpa pemanfaatan analitik | P2 |
| **Enkripsi field sensitif** (NIK/NPWP/rekening saat rest) | plain di DB | Target audit keamanan (hanya sandi yang di-hash) | P2 |

### Yang TERNYATA SUDAH BENAR (diverifikasi ulang, bukan asumsi)
- Cuti setengah hari: mesin `sessionFrom/sessionTo` AM/PM + `allowHalfDay` per jenis ✓
- Rate BPJS configurable (JHT 2/3,7% — JP 1/2% — JKK/JKM/JPK + cap) ✓ (kecuali kelas risiko, lihat atas)
- NPWP karyawan + profil payroll + non-NPWP surcharge 20% ✓
- Settlement PHK: pesangon UPMK + THR prorata + uang cuti + PPh final ✓
- ActivityLog data collection ✓ (viewer-nya yang tidak ada)
- Delegasi approver, MFA TOTP, webhook HMAC, public API ✓

---

## 3. Kesimpulan Prioritas

**OneVity kuat di "administrasi inti + kepatuhan pajak", lemah di "pilar HCM dan lifecycle penuh".** Skor kematangan lama ±6.9 mengukur yang ada; yang TIDAK ada membuat aplikasi ini bukan pesaing penuh produk komersial:

- **P0 — table-stakes yang hilang (bangun sekarang, semua infra sudah ada):**
  1. 5 surat layanan karyawan (SK Kerja, SK Gaji, SK Pengalaman Kerja, Referensi, Perjanjian Kerja PKWT) — tinggal tambah kunci ke `letter-defaults` + penerbitan dari profil.
  2. Permintaan surat dari ESS (karyawan minta → HR terbitkan → PDF) — sistem surat baru dibangun, jadikan dua arah.
  3. Viewer ActivityLog (data sudah terkumpul, hanya UI).
  4. Payslip PDF berpassword (opsi per run, default NIK).
  5. Validasi UMK per kantor ( tabel UMK per tahun/kantor + warning di payroll run).
  6. Pelacakan PKWT PP 35/2021 (kolom kontrak + hitungan perpanjangan + cap 5 tahun + konversi PKS).
  7. Geofencing radius + import log mesin absen (CSV/Excel, dedupe) — item G2 yang tidak pernah dikirim.
- **P1 — modul utuh**: rekrutmen ATS-lite, kinerja, pelatihan, aset, pengumuman, onboarding checklist, papan kehadiran live, tukar shift, e-SPT/BPJS format resmi, JKK kelas risiko, PWA, laporan terjadwal.
- **P2 — diferensiator**: WhatsApp, suksesi/9-box, alumni/rehire, report builder, analitik kompensasi, enkripsi field.

**Pola penyebab akar**: audit lama menilai *kualitas bangunan yang berdiri*, bukan *kelengkapan kota*. Kedepannya, setiap audit harus dimulai dari checklist domain dan persona (HR admin, karyawan, atasan, payroll) — bukan dari daftar file.
