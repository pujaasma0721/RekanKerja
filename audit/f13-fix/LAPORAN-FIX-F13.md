# Laporan Perbaikan F-13 — Validasi Duplikat NIK di Wizard Onboarding

**Task ID: FIX-F13** · Tanggal: 28 Okt 2026 · Basis kode: `6e4a0fc` (sinkron dengan origin/main, diverifikasi sebelum mulai)

## 1. Temuan Asli (UAT HR-Base Bagian 2)

**[F-13] [KRITIS] Duplikat NIK (KTP) DITERIMA sistem** — `POST /api/rekankerja/employees` (wizard onboarding) tidak punya cek keunikan NIK. Reproduksi UAT: karyawan A (NIK 3271010101990001) → karyawan B NIK sama → tersimpan sukses tanpa peringatan. Jalur import Excel sudah punya cek (nikSet dari existingNiks terdekripsi) → **inkonsistensi antar jalur input**. Risiko: payroll/BPJS/pajak dua identitas sama; data kotor sulit direkonsiliasi.

## 2. Akar Masalah

NIK tersimpan terenkripsi (`enc:v1`, random-IV) sehingga tidak bisa dibandingkan di level SQL / tidak bisa diberi unique constraint biasa. Jalur wizard, edit profil, dan pengangkatan rekrutmen sama-sama tanpa guard duplikat.

## 3. Perubahan Kode (4 titik, 3 file)

### `src/rekankerja/human-resource/api/employees.ts`
1. **Helper baru `findEmployeeByNationalId(db, nationalId)`** — dekripsi seluruh `nationalId` tenant lalu cocokkan di JS (pola sama dengan `nikSet` jalur import Excel; `decryptText` melewatkan plaintext legacy sehingga data pra-enkripsi ikut tercakup). Mengembalikan pemilik NIK (`id`, `employeeNo`, `fullName`) untuk pesan error.
2. **Helper `nikTakenMessage(nik, owner)`** — pesan 400 seragam lintas jalur: `"NIK <nik> sudah dipakai karyawan lain (<employeeNo> — <fullName>)"`.
3. **POST wizard**: NIK tetap opsional, tapi bila diisi wajib `^\d{16}$` (konsisten import & client-side wizard) + belum dipakai karyawan mana pun (aktif/non-aktif — konsisten import). Nilai di-trim sebelum disimpan.

### `src/rekankerja/human-resource/api/employee-detail.ts` (PATCH)
4. **Guard saat NIK diubah**: nilai yang sama dengan tersimpan → skip validasi (data legacy < 16 digit tidak ditolak bila tidak diubah), tetap re-encrypt plaintext legacy (perilaku lama dipertahankan); nilai baru berbeda → 16 digit angka + belum dipakai karyawan lain **kecuali dirinya sendiri** (exclude by id). `exists` select kini mengambil `nationalId`.

### `src/rekankerja/recruitment/services/appointment-service.ts` (`continueToOnboarding`)
5. **Guard lintas modul**: pelamar dengan KTP yang sudah dipakai karyawan lain (mis. re-hire mantan karyawan) ditolak sebelum transaksi; error membawa `status: 400` → dipetakan handler `offers.ts` sebagai 400 (bukan 500 mentah).

## 4. Hasil Verifikasi E2E (browser, login HR `hrd@mii.co.id`, DB cross-check)

| # | Skenario | Ekspektasi | Hasil |
|---|----------|-----------|-------|
| A | POST NIK 15 digit | 400 "NIK harus 16 digit angka" | ✅ PASS |
| C | POST NIK 16 digit baru | 201, MII00046 | ✅ PASS |
| **D** | **POST NIK duplikat (reproduksi UAT B4)** | **400 "NIK 3271010101990001 sudah dipakai karyawan lain (MII00046 — Uji F-13 Positif)"** | ✅ **PASS** |
| E1 | POST NIK 16 digit kedua | 201, MII00047 | ✅ PASS |
| E2 | PATCH karyawan A dengan NIK milik B | 400 duplikat (pemilik disebut) | ✅ PASS |
| E3 | PATCH NIK sama dgn milik sendiri (no-op) | 200 (tidak salah tolak) | ✅ PASS |
| E4 | PATCH NIK 15 digit | 400 format | ✅ PASS |
| UX | **Wizard UI 4 langkah penuh + NIK duplikat → submit** | toast error jelas + karyawan TIDAK tersimpan + console 0 error | ✅ PASS |

Catatan: NIK seed demo MII memakai dummy 13 digit — duplikat diuji dengan NIK 16 digit valid (pola UAT asli). Guard membandingkan string hasil dekripsi, sehingga berlaku juga untuk data seed bila nilainya identik.

Bukti: `01-wizard-review-dupnik.png` (review dgn NIK duplikat) · `02b-toast-error.png` (toast penolakan) · network log POST 400 · DB count tetap.

## 5. Dampak & Risiko

- **Semua jalur tulis NIK kini konsisten**: wizard POST, PATCH employee-detail, import Excel (sudah ada), pengangkatan rekrutmen.
- Pre-check (bukan constraint DB atomic): window race dua onboarding paralel dengan NIK sama sangat kecil — par pola import yang sudah diterima.
- NIK opsional tidak diubah (wizard tetap bisa simpan tanpa NIK — perilaku lama dipertahankan; format hanya divalidasi bila diisi).
- Data legacy salah format tidak terblokir selama nilainya tidak diubah.

## 6. Pemulihan Data

Seluruh data uji dibersihkan & diverifikasi: MII00046 + MII00047 + relasi (assignment, onboarding+tasks, activity log, email log) dihapus; **direktori kembali 45 karyawan**, nomor berikutnya otomatis MII00046 (MAX+1), 0 pasangan NIK duplikat tersimpan, 0 email log sisa.
