# BPA-FIX-54 — Remediasi Penuh Temuan BPA-AUDIT-53 ("perbaiki semua")

> Tanggal: 13 September 2026 · Implementasi remediasi R1–R9 audit BPA-AUDIT-53.
> Perintah pengguna: "perbaiki semua" → seluruh temuan KRITIS/SEDANG/RENAH
> ditindaklanjuti (F-10 penyimpangan yang disahkan pemilik produk tetap
> dipertahankan; F-11 dicatat sebagai catatan review tahunan).

## Sumber utama yang dipakai

**PMK 168/2023 — PDF resmi DJP (pajak.go.id)** diunduh & diekstrak langsung
(hlm. 9–12): tabel TER Kategori A/B/C resmi **44/40/41 lapisan** (total 125
baris, maksimum tarif 34%), skema kategori PTKP, dan formula masa pajak
terakhir. Tabel ini divalidasi silang dengan 9 contoh perhitungan resmi di
dokumen yang sama (hlm. 28, 29, 31, 40, 50) — 9/9 cocok.

## Remediasi per temuan

| # | Temuan | Perbaikan | Status |
|---|---|---|---|
| F-01 | JKP PP 6/2025 salah struktur (0,24% pekerja + 0,22% beban fiktif) | Struktur benar Ps.11: 0,36% = 0,22% APBN + 0,14% **rekomposisi iuran JKK**. `jkpEmployeeRate 0`, `jkpCompanyRate 0.0014` (informatif), komponen JKP_C/JKP_E **dinonaktifkan** + item template DEFAULT/BS dihapus (migrasi 3 tenant), UI/rekap BPJS menampilkan struktur benar + catatan informatif | ✅ 3 tenant |
| F-02 | Tabel TER seed menyimpang dari lampiran resmi | Modul sumber tunggal `ter-official.ts` (ekstraksi verbatim PMK 168/2023) → seed.ts + provisioning + migrasi `migrate-audit53.ts` re-seed 125 baris (validasi 9/9 contoh DJP) | ✅ |
| F-03 | Mapping kategori TER salah (K1→A, K3→B) | `terCategoryOf`: A = TK0/TK1/K0 · B = TK2/TK3/K1/K2/KI0/KI1 · C = K3/KI2/KI3 (sesuai PTKP hlm. 9) | ✅ |
| F-04 | Tanpa true-up masa pajak terakhir (Pasal 17) | Engine `lastTaxPeriod`: run SALARY **Desember** (bulan endDate-11) ATAU period terakhir **leaver** → PPh21 = Pasal 17 atas (bruto setahun aktual − biaya jabatan 5% cap 6jt/thn − iuran pensiun setahun − PTKP) **− PPh21 telah dipotong YTD**. Konteks YTD dari semua run Confirmed/Paid non-TERMINATION/non-YEAR_END_ADJ (pesangon dipajaki final terpisah). NetToGross iteratif didukung. Uji terisolasi: eksak (216.250 = 2.595.000 − 2.378.750) | ✅ |
| F-05 | Kompensasi PKWT tidak dibayar saat resign | Gate `!isResignation` dihapus (PP 35/2021 Ps.17 "salah satu pihak" termasuk pengunduran diri). Pesangon/UPMK/uang pisah/THR tetap 0 saat resign (benar) | ✅ |
| F-06 | PPh kompensasi PKWT di-hardcode 0% | `finalTerminationTax` tarif lapisan PP 36/2021 (0/10/20/25%) + **non-NPWP ×120%** (juga diterapkan ke kelompok pesangon). Baris `PKWT_TAX` terpisah; komponen `PKWT_KOMP` → `SeveranceFinal`. Verifikasi: kompensasi 57.712.500 → PPh final 771.250 (10% × 7.712.500) eksak | ✅ |
| F-07 | Cuti melahirkan 6 bln flat | **3+3 bersyarat** UU KIA Ps.4(3)(a): hak dasar 3 bln; perpanjangan bulan 4–6 HANYA dengan gerbang **surat keterangan dokter** (catatan pengajuan wajib, kosong → tolak). Keguguran 1,5 bln + perpanjangan per rekomendasi dokter (max 3). Gerbang memakai **bulan kalender** (bukan ÷21 hari — 3 bln kalender ≈ 3,1 satuan ÷21 akan salah memicu gerbang) | ✅ |
| F-08 | Kutipan regulasi keliru | ptkp-auto.ts: sumber PTKP = **PMK 101/2016** (PMK 168/2023 dicatat sebagai aturan teknis TER, bukan pengatur PTKP) · CT-LAHIR/CT-GUGUR-I: dasar **UU 13/2003 Ps.93** · CT-LAHIR-P: **UU KIA Ps.4(3)(a)** (bukan Ps.22) · catatan settlement: PP 36/2021 (bukan PP 68/2009/Ps.16) | ✅ |
| F-09 | Tanpa hari istirahat mingguan | `assertWeeklyHours`: rata-rata hari Off/Libur ≥ 1/minggu (UU 13/2003 Ps.79(2)) — cycle 7 hari kerja ditolak; 6×8 jam tetap ditolak batas Ps.77 | ✅ |
| F-10 | Snapshot tahunan vs Ps.7(2) | **Dipertahankan** — penyimpangan yang DISKAHKAN pemilik produk (Task 50); UI transparan | — (by design) |
| F-11 | Plafon JP review tahunan | Catatan review tahunan BPJS — di luar lingkup | — |

## File yang berubah

- `src/onevity/payroll/services/ter-official.ts` **(baru)** — tabel TER resmi (sumber tunggal)
- `src/onevity/payroll/services/payroll-engine.ts` — F-03 mapping, F-04 true-up + catatan PPh21
- `src/onevity/payroll/services/payroll-service.ts` — F-04 konteks YTD (bruto/iuran/dipotong) + deteksi Desember/leaver
- `src/onevity/payroll/services/settlement-service.ts` — F-05/F-06 + non-NPWP ×120% + PKWT_TAX
- `src/onevity/leave/services/leave-service.ts` — F-07 gerbang surat dokter (bulan kalender)
- `src/onevity/time-attendance/api/schedules.ts` — F-09 istirahat mingguan
- `src/onevity/payroll/services/ptkp-auto.ts` — F-08 kutipan PTKP
- `src/onevity/shared/lib/provisioning.ts` — F-01/F-02/F-07/F-08 (tenant baru)
- `prisma/seed.ts` + `prisma/schema-tenant.prisma` — F-02 tabel resmi + default JKP 0/0.0014
- `src/onevity/payroll/components/payroll-parameters.tsx` — F-01 teks & label UI
- `src/onevity/payroll/api/wage-component-rules.ts` — F-01 default preview
- `src/onevity/payroll/api/reports-bpjs.ts` — F-01 header + catatan jkpNote
- `scripts/migrate-jkp.ts` — F-01 revisi perilaku (perbaiki instalasi lama)
- `scripts/migrate-audit53.ts` **(baru)** — F-02/F-06/F-07/F-08 migrasi data
- `src/onevity/shared/lib/parity-runner.ts` — step `audit53` + 5 marker gap baru

## Verifikasi

- **DB**: 3/3 tenant — TER 125 baris (A:44/B:40/C:41) resmi + marker · jkpEmployeeRate 0 · komponen JKP nonaktif · 0 item template JKP · CT-LAHIR-P 3/6/advance · PKWT_KOMP SeveranceFinal + PKWT_TAX ada · `checkParityGap` → `{gap:false}`.
- **Engine (terisolasi)**: true-up Desember eksak (216.250; over-withheld → 0, tak negatif); mapping kategori 12/12 benar.
- **API E2E (login hrd MII)**: run Sep normal kembali (progresif 56,27jt, tanpa item JKP) · run Desember masa-terakhir ter-plumbing (YTD aktual 3 bln < PTKP → 0 — matematis benar; data uji dibersihkan) · cuti 6 bln tanpa surat dokter → **ditolak**; dengan surat → **dibuat** (LR-2026-011, lalu dihapus) · settlement resign MII00013 → PKWT_KOMP 57.712.500 + PKWT_TAX 771.250 + penggantian hak, NET 61.729.250 · jadwal 7 hari kerja → **ditolak Ps.79(2)**.
- **Browser**: login → Parameter Pajak (JKP "0% — PP 6/2025", "Rekomposisi JKK 0,14%", nilai input 0/0.14/5jt) → Jenis Cuti (CT-LAHIR-P "3 bln" + deskripsi Ps.4(3)(a)) → tanpa error console; mobile 390px tanpa overflow horizontal; footer ada.
- **Kesehatan**: `bun run lint` exit 0 · `tsc --noEmit` bersih · dev.log tanpa 500.

## Catatan desain

- Deteksi Desember memakai **bulan endDate = 11** (bukan "period endDate terbesar" — period Okt–Des umumnya baru dibuat menjelang akhir tahun; max-endDate akan salah memicu true-up di Sep).
- True-up hanya pada run **SALARY**; run suplemental Desember (THR/bonus) memakai jalur K-1 — bila THR dibayar SETELAH run gaji Desember, true-up tidak mencakupnya (edge case terdokumentasi).
- YTD true-up mengecualikan run TERMINATION (pesangon dipajaki final PP 36/2021) & YEAR_END_ADJ (penyesuaian manual).
- Gerbang F-07 memakai bulan kalender; saldo tetap dibukukan ÷21 (konvensi Task 52-a) — saldo dapat tampil −0,1 bln untuk permintaan tepat-n-bulan (kosmetik, terdokumentasi).
- Zakat/sumbangan keagamaan wajib (pengurang neto resmi) belum dimodelkan — dicatat di komentar engine.
