# UAT HR BASE — BAGIAN 2: Karyawan (Direktori/CRUD/Onboarding) + Posisi & Jabatan + Offboarding

Status sesi: dijalankan dalam 3 segmen (2b/2c terputus oleh batas turn — dilanjutkan & diselesaikan manual oleh orkestrator; seluruh klaim diverifikasi silang via DB, activity log, VLM screenshot, dan uji langsung browser).

## 1. TABEL HASIL PER SKENARIO

| ID | Skenario | Hasil | Bukti | Catatan |
|----|----------|-------|-------|---------|
| A1 | Direktori karyawan render | **PASS** | 16-emp-directory.png | 45 karyawan, chip status Aktif/Probation/Kontrak/Non-aktif, kartu avatar inisial |
| A2 | Pencarian nama parsial | **PASS** | 17-emp-search.png | Filter instan; counter "x karyawan terdaftar" ikut berubah |
| A3 | Filter status via chip | **PASS** | 18-emp-filter.png | Jumlah per chip akurat |
| A4 | Sort kolom | **NOT VERIFIED** | — | Sesi agent terputus sebelum terdokumentasi |
| A5 | Detail karyawan (sheet) | **PASS** | 19-emp-detail.png | Panel ringkasan: unit, grade, masa kerja, kontak, NIK ter-mask `32••••••••••••01` (PII masking bekerja) |
| A6 | Tab detail profil | **PASS** | 20-emp-detail-tab.png | Tab Personal/Pekerjaan/Keluarga/Pendidikan/Pengalaman/Disiplin/Surat render |
| B1 | Buat karyawan — wizard onboarding 4 langkah | **PASS** | 21-emp-create-form.png | Data Personal → Info Pekerjaan → Upah & Bank → Review; draft auto-save; ringkasan kanan live |
| B2 | Simpan karyawan baru | **PASS** | 22-emp-created.png | "Onboarding selesai — karyawan baru tersimpan di master data" |
| B7 | Nomor karyawan otomatis | **PASS** | 22-emp-created.png | MII00046 (MAX+1 dari MII00045) — pola prefix perusahaan benar |
| B3 | Edit data karyawan | **PASS** | 23-emp-edit.png, 24-emp-edited.png | Dialog "Edit Data" (personal + kontrak PKWT); rename → "Uji Coba UAT v2" persist di DB (ActivityLog "Updated" ×4) |
| B4 | NEGATIF: NIK ganda | **FAIL** | 25-emp-dupnik.png | Karyawan kedua dengan NIK SAMA DITERIMA — "Onboarding selesai" tanpa peringatan (F-13) |
| B5 | NEGATIF: field wajib kosong | **PASS** | 26-emp-validation.png, 26b-emp-validation-blocked.png | Submit di-Review diblokir: "Nama lengkap wajib diisi" + wizard auto-lompat balik ke langkah salah (catat F-14: validasi telat) |
| B6 | Nonaktifkan karyawan uji | **PASS (via Offboarding)** | 35-emp-cleanup-46.png | Tidak ada tombol "nonaktifkan" cepat — harus lewat modul Offboarding penuh (F-17); PA Resignation PA-2026-0010 diproses, assignment validTo 2026-10-31 |
| — | BONUS: alur Offboarding end-to-end | **PASS** | ActivityLog 15:25–15:34 | Buat (10 tugas clearance + email ke 6 bagian) → Complete → PA Resignation Processed → komponen settlement PKWT Rp 6.375.000 (0,75 bln × 8,5 jt, PP 35/2021 Ps.15-17) → PayrollRun TER Draft dibuat. Perhitungan pesangon EKSAK. |
| C1 | Daftar Posisi render | **PASS** | 27-position-list.png | Kolom title/unit/status |
| C2 | Buat posisi baru | **PASS** | 28-position-create.png, 29-position-created.png | "Staf Uji Coba UAT (P-UAT1)" dibuat |
| C3 | Edit posisi | **PASS** | 30-position-edit.png | Rename "v2" persist (ActivityLog Updated) |
| C4 | Katalog Jabatan render | **PASS** | 31-jobs-catalog.png | 16 job MII + family/level |
| C5 | Grade & Level render | **PASS** | 32-grades.png | Daftar grade G1..G8 + rentang upah |
| C6 | NEGATIF: posisi tanpa field wajib | **PASS** | 33-position-validation.png | Validasi muncul, tidak crash |
| C7 | Hapus posisi uji (cleanup) | **PASS** | 34-position-cleanup.png | ActivityLog "Posisi Staf Uji Coba UAT v2 dihapus" |
| E1 | Hygiene console | **PASS** | — | 0 error console; hanya warning a11y Radix (F-08) + HMR/PWA log dev |

## 2. DAFTAR TEMUAN (lanjutan dari F-01..F-12 Bagian 1)

- **[F-13] [KRITIS] Duplikat NIK (KTP) DITERIMA sistem — integritas data identitas tidak dijaga**
  Reproduksi: buat karyawan A (NIK 3271010101990001) → buat karyawan B dengan NIK sama persis → tersimpan sukses tanpa peringatan; keduanya Active.
  Bukti: 25-emp-dupnik.png (VLM: "Onboarding selesai"); DB: MII00046 & MII00047 keduanya `nationalId` terdekripsi = `3271010101990001` (diverifikasi via tenantCrypto).
  Root cause: `POST /api/rekankerja/employees` (src/rekankerja/human-resource/api/employees.ts) tidak punya cek keunikan NIK; NIK terenkripsi (enc:v1) sehingga butuh blind-index untuk constraint unik.
  Risiko: payroll/BPJS/pajak dua identitas sama; data kotor sulit direkonsiliasi.
- **[F-14] [MINOR] Wizard onboarding mengizinkan pindah langkah dengan field wajib kosong** — validasi baru memblokir di tahap Review (lalu auto-lompat balik ke langkah salah dengan pesan jelas). Berfungsi, tapi user menemukan error terlambat.
- **[F-15] [MINOR] GAJI POKOK tampil "—" untuk OWNER tanpa penjelasan** — karena Brankas Uang (money vault) belum di-unlock, seluruh nominal uang di-mask. Rentang grade terlihat (Rp 50–80 jt) tapi gaji pokok "—" — tidak ada hint inline kenapa; sarankan label "🔒 Terkunci — buka Brankas Uang" + tooltip.
- **[F-16] [MINOR] Hook PA Termination membuat record Offboarding KEDUA tanpa guard duplikat** — `createOffboardingWithTasks` (offboarding.ts:54) dipakai POST manual & hook PA exit tanpa cek offboarding existing → karyawan yang sudah di-offboard lalu PA-nya diproses mendapat 2 record (Completed + Open). Terjadi nyata saat UAT (MII00046: 2 offboarding).
- **[F-17] [INFO] Tidak ada aksi "nonaktifkan" cepat di profil karyawan** — deaktivasi harus lewat Offboarding penuh (by design untuk audit trail, tapi discoverability rendah; HR harus tahu harus ke modul Offboarding).

## 3. STATUS KHUSUS

- **(a) Create/Edit/Delete karyawan: BEKERJA** — wizard onboarding 4 langkah + draft autosave; edit via "Edit Data" persist; nomor otomatis MII00046 benar.
- **(b) Validasi NIK ganda: TIDAK BEKERJA / TIDAK ADA** (F-13, KRITIS).
- **(c) Masking gaji untuk OWNER**: gaji "—" (vault terkunci — by design M-9, tapi tanpa penjelasan inline, F-15). NIK/NPWP masking bekerja benar (`31•••••••••06`, `••••••2345`).
- **(d) Error console: NOL** — hanya warning a11y Radix DialogContent (F-08, pre-existing) + log HMR/Fast Refresh/PWA dev.

## 4. PERUBAHAN & PEMULIHAN DATA UAT

- Dibuat selama UAT: MII00046 "Uji Coba UAT v2" + MII00047 "Duplikat NIK UAT" + posisi "Staf Uji Coba UAT (P-UAT1)" + 2 Offboarding + PA-2026-0010 + EmployeeComponentAssignment settlement + PayrollRun PR-2026-09-TER-01 (Draft) + 20 offboarding task + 2 onboarding (16 task) + 29 ActivityLog + 19 EmailLog.
- PEMULIHAN TOTAL (verifikasi akhir): seluruh residu dihapus dari DB (tabel per tabel); direktori kembali **45 karyawan** (UI terverifikasi "45 karyawan terdaftar", tanpa sisa "Uji Coba"/"Duplikat NIK"); nomor karyawan berikutnya otomatis kembali MII00046 (MAX+1); posisi uji sudah dihapus dari UI oleh agent 2c.
