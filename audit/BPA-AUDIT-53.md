# BPA-AUDIT-53 — Audit Ulang Kepatuhan Implementasi (Task 49–52) terhadap Peraturan Pemerintah

> Tanggal: 12 September 2026 · Audit verification (riset + kode + DB live) — TANPA perubahan kode.
> Lingkup: hasil implementasi Task 49 (PTKP otomatis), Task 50 (snapshot tahunan),
> Task 51 (matriks kepatuhan), Task 52 (7 fitur A–G) — diverifikasi ulang terhadap
> peraturan yang dirujuk: UU PPh (Ps.7, 17, 21), PMK 101/2016, PP 58/2023 + PMK 168/2023,
> PP 35/2021, PP 36/2021, PP 6/2025, UU 13/2003 jo. UU 6/2023, UU KIA 4/2024.

## Metode

1. Pembacaan kode sumber (payroll-engine.ts, ptkp-auto.ts, settlement-service.ts,
   provisioning.ts, seed.ts, scheduler-service.ts, schedules.ts, keluarga API).
2. Riset regulasi via web (pajak.go.id / JDIH Kemenkeu, peraturan.bpk.go.id,
   bpjsketenagakerjaan.go.id, klikpajak, muc.co.id, ortax, ideatax, hukumonline, dsb.).
3. Verifikasi "as-built" langsung ke DB tenant (schema tenant_pt_mitra_industri_internasional).

---

## Ringkasan Eksekutif

| Severity | Jumlah | Aktif di payroll hari ini? |
|---|---|---|
| 🔴 KRITIS | 4 | 1 aktif (F-01 JKP) · 3 laten (F-02..F-04, aktif bila `useTer=true`) |
| ⚠️ SEDANG | 3 | settlement/leave (saat dipakai) |
| ℹ️ RENDAH/catatan | 4 | tidak berdampak numerik |

**PTKP (inti permintaan Task 49/50): angka & logika LOLOS audit** — PTKP Rp54jt
(PMK 101/2016) masih berlaku s.d. TA 2026 (pajakku, ikpi, DDTC; tidak ada perubahan).
Temuan besar justru ada pada **parameter pajak/JKP yang diklaim "sesuai regulasi" pada
Task 51/52 namun ternyata menyimpang dari teks aturan**.

---

## 🔴 TEMUAN KRITIS

### F-01 — JKP PP 6/2025: iuran pekerja 0,24% & perusahaan 0,22% — SALAH struktur & besaran (AKTIF)

**Implementasi** (provisioning.ts:243-244, live di DB MII): `jkpEmployeeRate 0,0024`,
`jkpCompanyRate 0,0022`, cap 5jt. Komponen `JKP_E` (potongan THP pekerja 0,24%) +
`JKP_C` (beban perusahaan 0,22%, non-objek PPh21) terpasang di template DEFAULT & BS
(terverifikasi live) → **setiap run gaji berikutnya memotong 0,24%×upah (max Rp12.000/bln)
dari THP pekerja dan menambah beban perusahaan 0,22% yang tidak ada dalam hukum.**

**Regulasi (PP 6/2025 Pasal 11, perubahan PP 37/2021; Permenaker 3/2025):**
- Iuran JKP = **0,36%** dari upah sebulan (basis dibatasi plafon Rp5.000.000):
  - **0,22% ditanggung Pemerintah (APBN)**;
  - **0,14% dari REKOMPOSISI iuran JKK** yang sudah dibayar pemberi kerja —
    bukan biaya baru; potongan 0,14 poin dari premi JKK yang sudah ada.
- **TIDAK ADA iuran pekerja** (porsi 0,10% pekerja pada PP 37/2021 lama DIHAPUS PP 6/2025).
- Sumber: teks PP 6/2025 (peraturan.bpk.go.id): "rekomposisi dari iuran program JKK …
  iuran JKK direkomposisi sebesar 0,14% dari Upah sebulan"; BPJS Ketenagakerjaan (rilis
  19 Feb 2025): "Iuran JKP ditetapkan sebesar 0,36%, dari rekomposisi iuran JKK sebesar
  0,14% dan iuran dari pemerintah sebesar 0,22%"; Permenaker 3/2025.

**Dampak:** potongan THP tidak sah (0,24% padahal 0%), beban perusahaan fiktif 0,22%,
pengurang bruto PPh21 (DEDUCTIBLE_IURAN JKP) ikut salah ukuran. Elemen yang benar:
plafon 5jt, flag kelayakan, task klaim JKP saat offboarding (tetap dipertahankan).

**Remediasi:** JKP_E → 0% (hapus dari template), JKP_C → hapus sebagai beban baru
(ganti: catatan informatif "0,14% bagian rekomposisi JKK" di laporan BPJS), default rate
`jkpEmployeeRate 0` + migrasi 3 tenant + parity step.

### F-02 — Tabel TER yang di-seed MENYIMPANG dari tabel resmi UU HPP/PMK 168 (LATEN)

**Implementasi** (prisma/seed.ts terA/terB/terC; live DB MII): row kategori A ke-3 dst.
memakai batas `5.650.000–6.350.000 (0,5%)`, `6.350.000–6.800.000 (0,75%)` …;
kategori B baris 1 `≤ 5.600.000 (0%)`; kategori C maksimum 20% di `> 75.100.000`.

**Tabel resmi** (Lampiran UU HPP jo. PMK 168/2023 — diverifikasi pajak.go.id, muc.co.id,
klikpajak, ptpsi.com, ideatax, uc.co.id):
- Kategori A: `≤5.400.000: 0%` · `5.400.001–5.650.000: 0,25%` · `5.650.001–5.950.000: 0,5%`
  · `5.950.001–6.300.000: 0,75%` · … (lanjutan batas resmi ≠ seed).
- Kategori B: baris 1 = `≤ 6.200.000: 0%` (seed: 5.600.000 — terlalu rendah →
  pemotongan berlebih untuk bruto 5,6–6,2jt).
- Kategori C: memuat bracket ≥21% (contoh resmi pajak.go.id: kategori C, bruto
  Rp65.605.059 → **21%**), maksimum seed hanya 20%.

**Dampak:** bila `useTer` diaktifkan (Parameter Payroll), PPh21 bulanan meleset di
banyak bracket (over- maupun under-withholding). Saat ini laten karena default
`useTer=false` (terverifikasi live: progresif annualized).

**Remediasi:** re-seed 108 baris TerRate (36×3 kategori) dari Lampiran UU HPP/PMK 168
untuk 3 tenant + parity step + verifikasi baris-per-baris.

### F-03 — Mapping kategori TER salah untuk K/1 dan K/3 (LATEN)

**Implementasi** (payroll-engine.ts:191-195): A = default (mencakup **K1**); B memuat **K3**;
C = KI2/KI3.

**Regulasi** (pajak.go.id — PMK 168): TER A = TK/0 (54jt), TK/1 & K/0 (58,5jt);
TER B = TK/2 & **K/1** (63jt), TK/3 & K/2 (67,5jt) (+ K/I/0–1); TER C = **K/3** (72jt)
+ K/I/2–3. Jadi: **K1 harus B (bukan A)** dan **K3 harus C (bukan B)**.

**Dampak:** karyawan K1 mendapat tarif kategori A (lebih rendah → under-withholding),
K3 mendapat B (under-withholding) pada bulan TER. Live MII: 3 profil K1 `auto` terdampak.

**Remediasi:** koreksi `terCategoryOf` — A: TK0/TK1/K0; B: TK2/TK3/K1/K2/KI0/KI1;
C: K3/KI2/KI3.

### F-04 — Tidak ada penyesuaian Masa Pajak Terakhir (Desember) = Pasal 17 (LATEN)

**Implementasi:** engine memakai metode sama untuk 12 bulan (TER tiap bulan bila
aktif; progresif annualized tiap bulan bila tidak).

**Regulasi** (PMK 168/2023): tarif efektif bulanan hanya untuk masa pajak **selain
Masa Pajak Terakhir** (JDIH: "…setiap Masa Pajak selain Masa Pajak Terakhir dihitung
dengan tarif efektif bulanan"); **Desember = Pasal 17 atas SELURUH penghasilan setahun**
(bruto setahun, biaya jabatan dibatasi Rp6jt/TAHUN) **dikurangi PPh21 yang telah
dipotong Jan–Nov** (lekslawyer, catapa, uc.co.id, ortax; contoh taalenta: biaya jabatan
"batas Rp6 juta setahun").

**Dampak:** bila TER aktif, akumulasi pemotongan 11 bulan TER (aproksimasi) + Desember
TER ≠ pajak tahunan Pasal 17 — tidak ada true-up Desember. Jalur default (progresif
annualized bulanan) kebetulan self-reconcile untuk pegawai setahun penuh tanpa
penghasilan variable; untuk joiner/resigner/pendapatan berubah tetap meleset.

**Remediasi:** run periode Desember → hitung Pasal 17 atas YTD aktual (bruto Jan–Des,
biaya jabatan cap 6jt/tahun, PTKP) − YTD dipotong; persist flag khusus di run item.

---

## ⚠️ TEMUAN SEDANG

### F-05 — Uang kompensasi PKWT TIDAK dibayarkan saat pengunduran diri (PP 35/2021 Ps.17)

**Implementasi** (settlement-service.ts:311): `if (!isResignation && isPkwt)` — resign
dikeluarkan dari kompensasi, dengan komentar "Resignation TIDAK berhak".

**Regulasi:** PP 35/2021 Pasal 17: "Dalam hal **salah satu pihak** mengakhiri hubungan
kerja sebelum berakhirnya jangka waktu PKWT, pengusaha wajib memberikan uang kompensasi…"
— mencakup pengakhiran oleh PEKERJA (pengunduran diri), bukan hanya PHK/kontrak habis.
(Komposisi formula, prorata, dan ambang ≥1 bulan sudah benar.)

**Remediasi:** hapus gate `!isResignation` untuk baris PKWT_KOMP (pesangon/THR tetap
benar di-nol-kan saat resign — itu tidak berubah).

### F-06 — PPh atas kompensasi PKWT: di-hardcode 0% (dikecualikan total) — praktek lazim = tarif final lapisan pesangon

**Implementasi:** PKWT_KOMP NonTaxable + dikeluarkan dari basis PPh final settlement
(409-line "PPh final 0%").

**Regulasi/praktik:** PP 36/2021 mengenai PPh final atas "uang pesangon, uang jasa
produksi/pemborosan, uang penggantian hak" = **0% ≤50jt · 10% >50–100jt · 20% >100–500jt
· 25% >500jt** (+ ×120% tanpa NPWP). Kompensasi PKWT lazim diperlakukan pada kelompok
ini (kalkulator gadjian dsb.); sebagian konsultan memperlakukan "seperti bonus" (tidak
final). Area ini memang masih diperdebatkan — namun **0% tanpa parameter untuk semua
besaran** berisiko under-withholding untuk kompensasi >Rp50jt (PKWT ≥ 5 tahun × upah ≥10jt).

**Remediasi:** terapkan tarif final lapisan (0/10/20/25%) atas baris PKWT_KOMP dengan
parameter eksplisit + non-NPWP 1,2× — atau dokumentasikan keputusan 0% dengan dasar.

### F-07 — Cuti melahirkan: 6 bulan diberikan FLAT sebagai hak standar (UU KIA: 3 bulan + 3 bulan bersyarat)

**Implementasi** (provisioning.ts:513; live DB): CT-LAHIR-P `entitlement 6, maxPerRequest 6`
tanpa gate kondisi medis; deskripsi sendiri menulis "dapat diperpanjang hingga 6 bulan
sesuai surat rekomendasi dokter".

**Regulasi:** UU KIA 4/2024 Pasal 4 ayat (3) huruf a: cuti melahirkan "**paling singkat
3 (tiga) bulan pertama; dan paling lama 3 (tiga) bulan berikutnya APABILA ADA KONDISI
KHUSUS yang dibuktikan dengan surat keterangan dokter**" (hukumonline, glints, adcolaw,
tarakankota). Jadi 3 bulan = hak dasar; bulan ke-4–6 = perpanjangan bersyarat medis.

**Dampak:** memberikan 6 bulan sebagai saldo standar melebihi minimum UU (legal sebagai
fasilitas perusahaan yang lebih murah hati — hukum ketenagakerjaan mengatur minimum),
tetapi **kontradiktif dengan deskripsi seed sendiri** dan tanpa gerbang medis untuk
bulan 4–6.

**Remediasi (pilihan):** (a) entitlement 3 + jalur perpanjangan 1–3 bulan dengan wajib
surat dokter (paling faithfull ke UU), atau (b) pertahankan 6 sebagai kebijakan
perusahaan dan ganti deskripsi agar tidak menyatakan bersyarat.

---

## ℹ️ TEMUAN RENDAH / CATATAN

- **F-08 — Kutipan regulasi keliru (kosmetik, menyesatkan pembaca):**
  - ptkp-auto.ts header: "PMK 168/2023 … PTKP diri WP: Rp54.000.000" — PMK 168/2023
    adalah aturan TEKNIS PPh21/TER, BUKAN pengatur PTKP. Sumber PTKP yang benar:
    **PMK 101/2016** (besaran Rp54jt memang benar).
  - Deskripsi CT-LAHIR-P menulis "UU KIA 4/2024 Ps.22" — ketentuan cuti ada di **Ps.4(3)**.
  - Deskripsi CT-LAHIR (suami 2 hari) menulis "PP 35/2021" — dasarnya UU 13/2003 Ps.93
    & UU KIA (suami ikut beristirahat 2 hari).
  - Catatan settlement "PPh final 0% (Ps.16)" — Ps.16 PP 35/2021 adalah formula besaran,
    bukan ketentuan pajak.
- **F-09 — Istirahat mingguan (UU 13/2003 Ps.79) tidak di-enforce:** `assertWeeklyHours`
  mengizinkan cycle 7 hari kerja × 6 jam (2520 mnt = tepat batas pola 6 hari) — tanpa
  hari libur. Batas 40/42 jam & 8 jam/hari sudah benar (Ps.77).
- **F-10 — Snapshot tahunan vs UU PPh Ps.7(2):** peraturan menyatakan perubahan status
  berlaku mulai **bulan berikutnya**; kebijakan OneVity menunda s.d. **1 Jan tahun
  berikutnya**. Ini penyimpangan YANG DISKAHKAN pemilik produk (Task 50) — berdampak
  waktu (timing pemotongan), bukan liabilitas tahunan (SPT Tahunan menghitung ulang).
  UI sudah transparan ("berlaku 1 Jan …"). Pertahankan, catat sebagai keputusan sadar.
- **F-11 — Plafon JP Rp10.547.400:** perlu review tahunan (BPJS TK menyesuaikan plafon);
  bukan bagian Task 52. JKK tetap satu tarif global (kelas risiko — partial lama Task 51).

---

## ✅ TERVERIFIKASI PATUH (tidak berubah)

1. **PTKP besaran & tabel status** (TK0 54jt … KI3 76,5jt — PMK 101/2016, sah s.d. TA
   2026) + tampilan UI ("K2 Rp67,5jt/thn") — BENAR.
2. **Derivasi PTKP dari keluarga (Task 49):** pasangan (record Spouse / marital Menikah)
   → K; tanggungan = Child & Parent `isDependent` (garis keturunan lurus + anak angkat;
   Sibling dikecualikan — benar); maks 3 tanggungan; K/I manual by-design (pilihan
   penggabungan penghasilan tak dapat diderivasi).
3. **Mekanika snapshot & refresh 1 Januari (Task 49/50):** job scheduler dengan marker
   idempoten per tahun pajak, PTKP efektif hanya berubah via 3 jalur, mutasi keluarga
   tengah tahun hanya memperbarui saran (ptkpPending) tanpa tulis.
4. **Pasal 17 & biaya jabatan:** bracket 5/15/25/30/35 + non-NPWP ×1,2; 5% bruto capped
   500rb/bln (≈6jt/th); basis TER = penghasilan bruto (bukan bruto-dikurangi-iuran) ✓;
   bulan dengan penghasilan ireguler otomatis Pasal 17 ✓ (PMK 168); iuran JHT+JP pegawai
   = pengurang neto ✓ (format 1721-A1: "iuran pensiun atau iuran Jaminan Hari Tua").
5. **Lembur PP 35/2021, UMP/UMK, BPJS (JHT 3,7/2, JP 2/1, JKK 0,24, JKM 0,3, JPK 4/1
   cap 12jt), e-SPT 39 kolom** — lolos audit 51, tidak berubah.
6. **Kompensasi PKWT (Task 52-b):** formula masa kerja/12 × upah prorata, ambang ≥1 bln,
   opsi ×0 pesangon saat kontrak habis — BENAR (selain F-05/F-06).
7. **Cuti keguguran 1,5 bln + cuti suami 2 hari + gating gender** — BENAR (selain F-07).
8. **40 jam/minggu (8×5 / 6×7) + blokir PKWT >5 thn (409 + force)** — BENAR (selain F-09).
9. **Whistleblowing TPKS anonim, enkripsi PII 63 kolom, audit trail akses baca** —
   implementasi Task 52 utuh (E2E terverifikasi saat itu; tidak diulang di sini).

---

## Prioritas Remediasi (jika ditindaklanjuti)

| # | Temuan | Urgensi | Alasan |
|---|---|---|---|
| R1 | F-01 JKP (0,36%: 0% pekerja, 0,14% rekomposisi JKK, 0,22% APBN) | **SEGERA** | Potongan THP tidak sah pada setiap run gaji berikutnya (template live) |
| R2 | F-02 Re-seed tabel TER resmi (108 baris, 3 tenant) | Tinggi | Akurasi PPh21 saat TER aktif |
| R3 | F-03 Mapping kategori TER (K1→B, K3→C) | Tinggi | idem |
| R4 | F-04 True-up Desember Pasal 17 (YTD − dipotong, cap 6jt/th) | Tinggi | Kewajiban eksplisit PMK 168 |
| R5 | F-05 Kompensasi PKWT saat resign | Sedang | Hak yang tidak dibayarkan |
| R6 | F-06 PPh final lapisan atas kompensasi >50jt (parameter) | Sedang | Under-withholding |
| R7 | F-07 Cuti melahirkan 3+3 bersyarat (atau ubah deskripsi jadi kebijakan) | Sedang | Konsistensi UU KIA |
| R8 | F-08 Kutipan regulasi di komentar/deskripsi | Rendah | Kebersihan dokumentasi |
| R9 | F-09 Enforce ≥1 hari istirahat per minggu di cycle | Rendah | Edge case |

---

## Bukti As-Built (DB live, tenant MII, 2026-09-12)

```
PayrollRegulation : jkpEmployeeRate=0.0024, jkpCompanyRate=0.0022, jkpSalaryCap=5.000.000, useTer=false
TerRate A r3      : 5.650.000 – 6.350.000 @ 0,5%   (resmi: 5.650.001 – 5.950.000)
TerRate B r1      : 0 – 5.600.000 @ 0%             (resmi: ≤ 6.200.000)
TerRate C max     : > 75.100.000 @ 20%             (resmi memuat bracket ≥ 21%)
K1/K3 profiles    : K1 auto ×3 (terdampak F-03)
LeaveType         : CT-LAHIR-P 6 MONTH (flat) · CT-GUGUR-P 1,5 MONTH ✓
JKP di template   : DEFAULT:JKP_C, DEFAULT:JKP_E, BS:JKP_C, BS:JKP_E  → aktif di run berikutnya
JKP di run item   : (kosong — run demo dibuat sebelum komponen ditambahkan)
```

## Sumber Regulasi Utama

- PP 6/2025 (perubahan PP 37/2021 JKP) — peraturan.bpk.go.id; BPJS TK 19 Feb 2025; Permenaker 3/2025
- PMK 168/2023 (ketentuan teknis PPh21 TER) + PP 58/2023 — pajak.go.id, JDIH Kemenkeu
- UU HPP 7/2021 (bracket Ps.17, TER Ps.24, lampiran tabel TER)
- PMK 101/2016 (PTKP) — masih berlaku TA 2026 (pajakku.com; ikpi.or.id; DDTC)
- PP 35/2021 (PKWT, kompensasi Ps.15–17) — peraturan.bpk.go.id
- PP 36/2021 (PPh final pesangon/penggantian hak 0/10/20/25%)
- UU KIA 4/2024 Ps.4(3) (cuti melahirkan 3+3 bersyarat) — hukumonline, glints, adcolaw
- UU 13/2003 jo. UU 6/2023 (Ps.77 jam kerja, Ps.79 istirahat, Ps.82, Ps.93, Ps.59 PKWT)
