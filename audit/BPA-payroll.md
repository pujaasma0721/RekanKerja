# AUDIT BISNIS PROSES — MODUL PAYROLL (OneVity HRIS)

- Task ID: **24-b** · Tanggal: 22 Januari 2026 · Mode: **READ-ONLY** (kode tidak diubah, runtime GET-only, DB query read-only).
- Lingkup: siklus period → run → engine kalkulasi → rapel → jurnal → bank export → integrasi agregator (TA/Leave/Travel/Medical/Benefit) → loan → SPT.
- Sumber: `src/onevity/payroll/**` (5 services + 16 api + 13 komponen), `prisma/schema-tenant.prisma` (18 model payroll), `prisma/seed.ts`, `ANALISA-PAYROLL.md`, worklog Task 17–23, + probing runtime (login hrd@mii.co.id → tenant MII) dan query PostgreSQL read-only.
- Tumpang-tindih dihindari: AUDIT-MODULES.md F-01..F-12 (sudah diperbaiki) tidak dilaporkan ulang; temuan lintas-modul BPA-cross-module (C-01..C-04, M-02/M-03/M-05..M-08, m-06/m-08) hanya dirujuk, tidak diduplikasi.

---

## 1. Ringkasan Eksekutif

| Dimensi | Hasil |
|---|---|
| Konsistensi data hasil (6 run live) | ✅ 252 line / 3.806 item / 6 jurnal payroll — Σlines vs total run Δ=0; semua jurnal D=C; duplikat journalNo 0 |
| State machine run | ✅ Draft→Calculated→Confirmed→Paid dengan guard hitung ulang/confirm ganda/hapus; 🔴 **cancel Confirmed tidak membalikkan efek samping** (K-2) |
| Kalkulasi PPh21 run SALARY | ✅ Progresif annualized/12 + PTKP + biaya jabatan; N2G gross-up iteratif terverifikasi manual; 🔴 **run suplemental (THR/BONUS/RAPEL) pajak ≈ 0** (K-1); ⚠️ klasifikasi objek pajak BPJS salah 2 arah (M-1) |
| BPJS | ✅ Rates/caps dari regulasi (JHT 3,7/2%, JP 2/1% cap 10.547.400, JPK 4/1% cap 12jt); ⚠️ basis = gaji pokok saja, flag `includeInBasicIncome` (tunjangan tetap) mati (M-10) |
| Jurnal | ✅ Idempotent per runId, balance enforced, saldo COA dimutasi; jurnal nomor count-based = C-03 lintas-modul (dirujuk) |
| Loan | ✅ 1 cicilan/run, urutan sequence benar live (5 period × 3 loan, tanpa dobel); ⚠️ kena dampak K-2 (cancel Confirmed) |
| Rapel | ⚠️ Alur preview→assignment→run ada; tanpa guard duplikat & rapel ke run Confirmed tidak pernah diproses (M-3) |
| Bank export | ✅ Hanya Confirmed/Paid; ⚠️ tanpa penandaan/verifikasi pembayaran, 10 karyawan BRI tanpa format (M-6) |
| Benefit pay-in-payroll | ✅ Limit snapshot + re-check saat approve + sinkronisasi assignment agregat; ⚠️ markPaid tanpa verifikasi masuk run (M-5) |
| Data live bermasalah | period **2026-10 payPeriod=0** (rapel melewatkan Oktober); jendela TA period seed terbalik (taStart 26 > taEnd 25) |

**Hitungan temuan: KRITIS 2 · MAJOR 11 · MINOR 11 · GAP 12.**
Tiga terpenting: **K-1** (pajak run suplemental ≈ 0), **K-2** (cancel run Confirmed tanpa rollback → jurnal dobel + cicilan dianggap terbayar), **M-1** (JKK/JKM/JPK perusahaan dihitung sebagai objek pajak → over-withholding seluruh karyawan, bukti live).

---

## 2. Peta Proses As-Is

### 2.1 Aktor
Semua aksi via 1 aktor serba-bisa (session tenant, tanpa cek role — C-02 lintas-modul): "HR/Payroll Admin" (owner hrd@mii.co.id). Tidak ada maker-checker (lihat GAP G-6). ActivityLog dicatat untuk create/confirm/export tetapi `appUserId` NULL (M-05 lintas-modul).

### 2.2 Siklus periode (`PayrollPeriod`, api/payroll-periods.ts)
- Status: `Open → (confirm run pertama) → Processed → (tutup manual) → Closed / Locked` (locked tidak pernah disetel oleh kode — hanya guard).
- Buat period: validasi nama/tanggal, `code` unik, **(sptMonth, sptYear) unik** — sisa field (taStart/taEnd, payPeriod, sptMonth/Year) diisi otomatis.
- Guard tutup: PATCH status Closed/Locked ditolak bila masih ada run `Draft/Calculated` (payroll-periods.ts:74-79) — ✅. Tidak diperiksa: klaim benefit `Scheduled` belum dibayar, assignment Specific belum terproses, run BENEFIT belum dibuat (M-5). Re-open period Closed diterima tanpa guard (m-7).
- **Tidak ada validasi overlap rentang tanggal** antar period (M-2). Jendela TA (`taStartDate/taEndDate`) tidak pernah dibaca engine payroll — murni data informatif (dan salah arah pada data seed, lihat §6 m-2).

### 2.3 Siklus run (`PayrollRun`, api/payroll-runs.ts + services/payroll-service.ts)
Langkah bisnis: buat run (period × processType, default calculateTax dari processType) → **Hitung** (`calculateAndSaveRun`: rakit input → engine → tulis snapshot lines+items, status Calculated) → review payslip → **Konfirmasi** (`confirmRun`: kunci hasil, potong cicilan pinjaman, period → Processed, 5 callback markPaid modul lain, posting jurnal otomatis) → **Dibayar** (markPaid manual, tanpa integrasi bank/export) → bank export (CSV) di sisi Confirmed/Paid.

Run suplemental (semua processType ≠ SALARY): hanya komponen **Specific** yang cocok (period × processType) yang diproses — THR/BONUS/RAPEL/BENEFIT/TERMINATION/YEAR_END_ADJ tidak mengulang gaji bulanan (payroll-service.ts:149-196). Komponen masuk run dari: template profil (SALARY saja), Periodic assignment (SALARY saja), Specific assignment (semua run), angsuran pinjaman (SALARY saja), transfer TA/Leave/Travel/Medical (menulis Specific dengan processType SALARY).

### 2.4 Tabel state machine run (as-implemented)

| Dari \ Aksi | calculate | confirm | markPaid | cancel | delete | bank export |
|---|---|---|---|---|---|---|
| **Draft** | ✅ → Calculated | ❌ (harus Calculated) | ❌ | ✅ → Cancelled (lines dihapus) | ✅ | ❌ (400) |
| **Calculated** | ✅ (rekalkulasi, hapus & tulis ulang lines) | ✅ → Confirmed (potong loan, period→Processed, 5 markPaid, jurnal) | ❌ | ✅ → Cancelled | ✅ | ❌ |
| **Confirmed** | ❌ (payroll-service.ts:240-242) | ❌ (double confirm ditolak) | ✅ → Paid | 🔴 **✅ diterima API** (payroll-runs.ts:116-122) — tanpa rollback jurnal/loan/markPaid | ❌ (141-143) | ✅ |
| **Paid** | ❌ | ❌ | ❌ | ❌ (117) | ❌ | ✅ |
| **Cancelled** | — | — | — | — | ✅ (delete diizinkan) | ❌ |

Guard lain: POST run ganda per (period × processType) ditolak bila ada run status ≠ Cancelled (payroll-runs.ts:50-58) ✅; nomor run `PR-{period}-{TYPE3}-{NN}` di-generate count-based (m-1); run pada period Closed/Locked ditolak ✅ (Processed diterima — multi-run dimaksudkan).

### 2.5 Mekanisme input ke engine (jawaban pertanyaan audit)
- **Absensi/kehadiran**: engine **tidak membaca AttendanceDaily sama sekali**. Kehadiran memengaruhi gaji hanya lewat **transfer manual modul TA** → Specific assignment `TABS/TLATE/TKEHADIRAN/LEMBUR` (period × SALARY). Tidak ada prorate gaji pokok /25 atau /hari-kerja (prorate hanya untuk komponen ber-flag `prorated`, yang tidak disetel pada seed — M-9).
- **Lembur**: masuk run via transfer endpoint TA (assignment LEMBUR), bukan query engine langsung ✅ (pola oranHR).
- **Leave encashment / travel / medical UMC**: masuk via transfer masing-masing modul → Specific assignment (UCT/UTRP/TRVSTLIN/UMC, processType default SALARY) ✅; dibayar saat run dikonfirmasi.
- **Loan**: buildRunRows memilih 1 installment `Pending` tertua per loan dengan `dueDate ≤ period.endDate` (payroll-service.ts:199-207); ditandai `Deducted` saat confirm.
- **THR**: hanya komponen template/Specific (`THR` formula BASE_SALARY, Irregular); tidak ada engine aturan THR (G-2).

---

## 3. Audit Kalkulasi Engine (payroll-engine.ts) — as-implemented vs seharusnya

Verifikasi numerik live (run PR-2026-09-SAL-01):
- **MII00002 (G2N, K1, gaji 38.150.000, template BS)**: bruto kena pajak 40.458.508 (BASIC + 5 iuran perusahaan); iuran pegawai 988.474; bj 500.000; neto×12 467.640.408; PKP 404.640.000; PPh21 70.160.000/12 = **5.846.667** = nilai tersimpan ✅ (engine konsisten dengan desainnya).
- **MII00001 (N2G, K2)**: TAX_ALLOW iteratif konvergen = PPH21 = **19.156.983** ✅ diverifikasi manual (gross-up = G×t/(1−t) pada bracket 30%).
- **Dengan aturan benar (JKK/JKM/JPK perusahaan bukan objek pajak — PMK 16/PMK.03/2021)**: MII00002 seharusnya ±5.675.164 → **over-withhold ±171.503/bulan** (M-1).

| Komponen | As-implemented | Seharusnya (aturan ID) | Status |
|---|---|---|---|
| BASIC/TJAB/TKEL | Formula `BASE_SALARY`, `×0.1`, `×0.05` | ✓ | ✅ |
| TTRANS/TMAKAN | Fixed 750rb/550rb | ✓ (tunjangan tetap) | ✅ |
| **JHT C/E** 3,7%/2% | `JHT_BASE×rate`, basis gaji pokok, tanpa cap | objek pajak ✓; basis seharusnya gaji pokok + tunjangan tetap (`includeInBasicIncome` mati) | ⚠ M-10 |
| **JP C/E** 2%/1% cap 10.547.400 | ✓ objek pajak; iuran pegawai deductible ✓ | ✓ (basis idem M-10) | ⚠ M-10 |
| **JKK/JKM/JPK perusahaan** | Earning `Regular` → **masuk penghasilan kena pajak** | **Bukan objek PPh21** (PMK 16/2021) | 🔴 M-1 |
| **JPK pegawai 1%** (cap 12jt) | ikut `taxDeductibleIuran` (dikurangkan dari neto) | Hanya JHT/JP pegawai yang boleh jadi pengurang (UU PPh 21(3)) | 🔴 M-1 |
| PPh21 regular | progresif annualized (neto×12 − PTKP → PKP floor 1000) /12; TER opsional (useTer=false live) | ✓ metode bulanan standar; TER tabel puncak perlu verifikasi | ✅ / ⚠ M-11 |
| **PPh21 run suplemental** | regularIncome run non-SALARY = 0 → netoAnnual = 0 → pajak THR/Rapel = progresif(THR−PTKP) ≈ **0** | THR dihitung di atas penghasilan regular kumulatif | 🔴 K-1 |
| PPh21 irregular | (netoAnnual + irregular − PTKP) − pajak regular; THR/bonus satu kali tanpa ×12 | ✓ pendekatan standar | ✅ |
| Biaya jabatan | 5% cap 500rb/bln (6jt/thn via ×12) | ✓ | ✅ |
| PTKP | map TK/K/KI 0-3 PMK 101/2016 | ✓ | ✅ |
| Non-NPWP | bracket `rateNonNpwp` (+20%) | ✓; field `nonNpwpSurcharge` regulasi mati | ✅/m-3 |
| NetToGross | gross-up iteratif ≤30×, TAX_ALLOW item + actualNetTax | ✓ | ✅ |
| Loan | item Deduction NonTaxable, 1 cicilan/run | ✓ | ✅ |
| THR/BONUS/RAPEL (Irregular) | item Irregular; THR formula = BASE_SALARY saja; `applyThrRules` **tidak pernah dibaca engine** | THR = 1× (gaji + tunjangan tetap), prorata masa kerja | ⚠ G-2 |
| Prorate masa kerja | faktor hari kalender dihitung (payroll-service.ts:139-147) tapi **semua komponen seed `prorated=false`** → mid-month joiner dibayar penuh | prorata masuk/pulang | 🔴 M-9 |
| Rounding | per komponen Up/Down/Nearest step; net `Math.round` | ✓ (THPRounding wageType tanpa pemakai) | ✅ |
| Formula evaluator | parser expr + variabel; div/0 & var tak dikenal → throw (run gagal total) | perlu pre-validasi saat simpan komponen | ⚠ m-4 |

---

## 4. Alur Jurnal (payroll-journal.ts)

Confirm run → `generateJournalForRun` (idempotent per `runId` unik ✅; guard status Confirmed/Paid ✅):
1. D beban per komponen Earning (5101/5102 atau `accountDebitCode`; Jamsostek perusahaan → D 5103 / C 2103 langsung, tidak lewat THP) / C 2101 Hutang Gaji = Σ earning THP;
2. D 2101 / C 2102 PPh21 · 2103 BPJS · 2104 Pinjaman · 2105 potongan lain (atau `accountCreditCode`);
3. D 2101 / C 1101 Kas = netPaid; selisih pembulatan baris penyeimbang.
- Balance D=C di-enforce (throw, payroll-journal.ts:159-163) ✅; live 6 jurnal payroll D=C semua ✅.
- Saldo `Account.balance` dimutasi per baris — hanya modul payroll yang memutasi (travel/medical tidak → m-08 lintas-modul).
- **Nomor jurnal count-based `JV-{tahun}-{count+1}`** — bertabrakan dengan generator travel/medical pada tabel yang sama (sudah dilaporkan sebagai C-03 lintas-modul; aspek payroll: `confirmRun` menelan error posting → run Confirmed tanpa jurnal, hanya ActivityLog "Error", recoverable via tombol backfill UI ✅).
- Jurnal multi-langkah (create + N× update saldo akun) **tanpa `$transaction`** (M-7).
- PostingEvent (tabel + UI Accounting) tidak pernah dipakai engine — master dekoratif (m-3).
- Run dibatalkan setelah confirm → jurnal TETAP Posted menempel pada run Cancelled (K-2).

---

## 5. Temuan per Severity

### KRITIS (2)

**K-1 · PPh21 run suplemental (THR/BONUS/RAPEL) dihitung ≈ 0**
`payroll-engine.ts:342-379` (computeTaxOn atas `regularIncome` run saja) × `payroll-service.ts:149-196` (run non-SALARY hanya memuat Specific).
Run THR/BONUS/RAPEL terpisah tidak memuat gaji regular → `grossBeforeTax = 0` → `netoAnnual = 0` → `annualRegularTax = 0` → `taxIrregular = progresif(irregular − PTKP)` ≈ 0 (mis. THR 20jt status TK0 → PPh21 0). Rapel 3jt → 0.
Dampak: under-withholding sistemik setiap run THR/bonus/rapel yang dijalankan sebagai run sendiri (aturan PPh21 rusak; sanksi/denda tanggungan perusahaan). Live belum terpicu (6 run semuanya SALARY; BONUS kebetulan dibayar via Specific di run SALARY) — risiko laten penuh, jalur THR/BONUS/RAPEL/BENEFIT adalah alur yang didesain dan diiklankan UI.
Fix minimal: saat menjalankan run suplemental, kalkulasi pajak atas **basis kumulatif masa pajak** (Σ bruto regular period s.d. bulan berjalan + irregular run ini) — baca dari PayrollRunLine/Item period berjalan, atau muat ulang konteks regular karyawan di run suplemental.

**K-2 · Cancel run Confirmed tanpa pembalikan efek samping**
`payroll-runs.ts:116-122` — PATCH `action=cancel` hanya memblokir status Paid; Confirmed diterima.
Confirm run telah mengeksekusi: cicilan → `Deducted` + `paidAmount/outstanding` (payroll-service.ts:311-336), period → Processed (342-345), 5 callback markPaid klaim/lembur/encashment/travel/medical (350-383), jurnal Posted + mutasi saldo COA. Cancel Confirmed hanya menghapus lines — semua efek tetap. Run baru period+type yang sama kini dibuat (guard mengecualikan Cancelled) → confirm ulang → **jurnal beban & kredit kas tercatat 2×**; cicilan bulan itu dianggap sudah dibayar tanpa pernah benar-benar dipotong dari gaji yang cair; klaim/lembur tetap "Paid".
Dampak: double-book beban/kas, korupsi state pinjaman, klaim termarking Paid tanpa dibayar. UI menyembunyikan tombol cancel untuk Confirmed (payroll-runs.tsx:152) tetapi API terbuka.
Fix minimal: tolak cancel untuk Confirmed di server (mirip guard Paid); bila cancel memang disediakan, balikkan jurnal (Reversed), installment (→Pending, kurangi paidAmount), dan markPaid callback dalam satu transaksi.

### MAJOR (11)

**M-1 · Klasifikasi objek pajak BPJS salah dua arah** — `prisma/seed.ts:494-501` (JKK_C/JKM_C/JPK_C incomeTaxMethod `Regular` default) + `payroll-engine.ts:342` (regularIncome = semua Earning Regular tanpa filter objek pajak) + `payroll-engine.ts:345-347` (iuran pegawai = semua Deduction Jamsostek, termasuk JPK_E).
JKK/JKM/JPK(BPJS Kesehatan) iuran perusahaan bukan objek PPh21 (PMK 16/PMK.03/2021), JPK pegawai bukan pengurang neto (UU PPh 21(3): hanya iuran JHT/JP pegawai). Komentar kode di engine:345 mengklaim "JPK non-deductible per komponen" — tidak terimplementasi.
Dampak: over-withholding (contoh live MII00002 +171rb/bln; N2G diperbesar gross-up) sekaligus under-deduction kecil dari JPK_E — PPh21 salah untuk seluruh 42 karyawan setiap bulan. Fix: set `incomeTaxMethod NonTaxable` untuk JKK_C/JKM_C/JPK_C (dan keluarkan dari basis TER); filter `taxDeductibleIuran` hanya jamsostekBasis JHT/JP.

**M-2 · Period overlap tidak divalidasi** — `payroll-periods.ts:21-57` (hanya cek kode unik + sptMonth/sptYear unik). Dua period boleh beririsan rentang tanggal (mis. 01–15 bulan berikut vs 01–31) → dua run SALARY meng-cover hari yang sama → gaji pokok dobel + 2 cicilan pinjaman pada satu bulan. Fix: validasi `startDate/endDate` tidak beririsan dengan period lain ber-status ≠ Closed.

**M-3 · Rapel: tanpa guard duplikat & bisa "hilang" senyap** — `payroll-rapel.ts:134-168`. (a) Submit rapel yang sama 2× → 2 assignment Specific RAPEL; engine memakai nilai assignment TERAKHIR (override, payroll-service.ts:185-193) → nominal salah tanpa peringatan (bukan dobel, tapi silent-wrong). (b) autoRun: bila run RAPEL period target sudah `Confirmed`, assignment tetap dibuat namun `if (run.status === "Draft")` meng-skip kalkulasi → rapel tidak pernah dibayar dan tidak bisa dibayar (run tak bisa dihitung ulang) — tanpa error/warning. (c) Range query pakai `payPeriod` — period 2026-10 live bernilai 0 → Oktober selalu terlewat dari range rapel. Fix: guard "rapel sudah ada untuk employee+komponen+range" (notes assignment bisa ditandai); tolak/beri peringatan bila run RAPEL period target bukan Draft; normalisasi payPeriod.

**M-4 · Specific assignment dapat dibuat ke period yang run-nya sudah Confirmed** — `component-assignments.ts:32-68` (POST tanpa cek status period/run; DELETE juga bebas untuk assignment period lama — snapshot run aman, tapi periode aktif rawan). Kelas masalah yang sama dengan M-08 BPA-cross-module (transfer 4 modul), kini pada endpoint internal payroll: komponen ditambahkan setelah run dikonfirmasi → tidak pernah masuk payslip mana pun (run tak bisa dihitung ulang, run baru period+type ditolak guard duplikat). Fix: tolak Specific untuk kombinasi period+processType yang punya run Confirmed/Paid.

**M-5 · Tutup period tidak memeriksa kewajiban belum terbayar; klaim Scheduled terjebak** — `payroll-periods.ts:74-79` hanya cek run Draft/Calculated. Klaim benefit `Scheduled`, assignment Specific (BENEFIT/THR dsb.), transfer modul lain pada period ber-status Processed tidak diperiksa; period bisa ditutup → tertutup permanen. Bukti live: 3 klaim `Scheduled` (BC-2026-007/008/009, period 2026-09 Processed) belum dibayar — masih recoverable via run BENEFIT, tapi alurnya tanpa prompt UI dan rentan ditutup. Fix: cek klaim Scheduled / assignment Specific aktif pada period sebelum Closed/Locked; tambahkan prompt "buat run BENEFIT" di UI klaim.

**M-6 · Bank export tanpa penandaan pembayaran & cakupan bank** — `payroll-run-export.ts:13-89`. (a) Ekspor boleh berulang tanpa flag "sudah diekspor" (hanya ActivityLog) dan tidak memicu/memeriksa status Paid → tidak ada penyatuan "file bank ↔ run dibayar" (digabung risiko K-2: file lama tetap sah saat run dibatalkan/di-recreate). (b) Rekening tanpa validasi nomor/format panjang; karyawan bank BRI (10 dari 44 live) tidak match format manapun → hanya masuk CSV "umum" (oranHR 12 bank). Fix minimal: tandai `exportedAt` pada run + dedupe file per run×bank; validasi nomor rekening non-kosong pada file per bank.

**M-7 · confirmRun & posting jurnal multi-langkah tanpa $transaction** — `payroll-service.ts:302-397` (cicilan N-loan + status run + period + 5 callback + jurnal), `payroll-journal.ts:174-210` (create jurnal + N update saldo akun berurutan). Kegagalan di tengah → partial write (mis. sebagian cicilan Deducted, jurnal Posted tanpa saldo termutasi semua). Callback markPaid memang sengaja non-fatal (try/catch — wajar), tetapi inti (loan + run + jurnal) sebaiknya atomik. Fix: bungkus loan-apply + status run + jurnal dalam `db.$transaction`.

**M-8 · Bukti potong Coretax: bruto understated** — `payroll-spt.ts (api):22-59` memakai `line.bruto` (bruto THP, meng-exclude iuran JHT/JP perusahaan yang adalah objek PPh21 karena `includeInTHP=false`). Jumlah bruto bukti potong bulanan undervalued (live Sep: −23,4jt/run dari JHT_C+JP_C). Fix: bruto bukti potong = Σ item Earning objek pajak (termasuk non-THP JHT_C/JP_C), bukan line.bruto.

**M-9 · Prorate masa kerja mati oleh seed** — mekanisme ada (`payroll-service.ts:139-147` + flag komponen `prorated`) tetapi **tidak ada satu pun komponen seed yang prorated** → karyawan masuk/pulang pertengahan bulan dibayar gaji penuh (BASIC Formula tanpa prorate). Prorate juga berbasis hari-kalender, bukan hari kerja. Fix: set `prorated=true` untuk BASIC/TJAB/TKEL/tunjangan tetap, atau prorate otomatis BASIC bila `validFrom` dalam period.

**M-10 · Basis BPJS = gaji pokok saja; `includeInBasicIncome` (tunjangan tetap) diabaikan engine** — `payroll-engine.ts:286-303` (jhtBase/jpkBase = `emp.baseSalary`); flag schema `includeInBasicIncome` (seeded true untuk BASIC) tidak pernah dibaca `runPayroll`. Dasar upah BPJS seharusnya gaji pokok + tunjangan tetap (UU SJSN & peraturan pelaksana) → iuran BPJS understated bila ada tunjangan tetap (live: TJAB+TKEL+TTRANS+TMAKAN = ±1,05–2,2× gaji pokok). Fix: hitung basis BPJS = BASIC + komponen `includeInBasicIncome` (variabel formula tetap tersedia sebagai override).

**M-11 · TER: fallback pajak 0 & tabel puncak diragukan** — `payroll-engine.ts:360-367`: bila `terRateFor` tidak menemukan rate → `taxRegular = 0` (seharusnya fallback Pasal 17 annualized). Live useTer=false (dorman) dan tabel seeded punya baris puncak terbuka (A/B/C: 0,20 pada >75–77jt) — **perlu diverifikasi terhadap Lampiran PP 58/2023** (indikasi batas atas baris & rate tidak sesuai tabel resmi). Fix: fallback Pasal 17 saat rate null; audit ulang data TerRate seed.

### MINOR (11)

- **m-1 · `nextRunNo` count-based** (`payroll-service.ts:400-404`) — race konkuren / setelah DELETE run menengah → nomor tabrak unique → 500 mentah (korupsi dicegah constraint). Pola sama dengan C-03 jurnal. Fix: `max(suffix)` + retry.
- **m-2 · Data period live/seed** — period 2026-10 `payPeriod=0` (dibuat di luar jalur standar; tidak bisa dikoreksi via API — PATCH tidak punya field payPeriod) → merusak range rapel (M-3c); period seed 2026-02..09 jendela TA terbalik (taStart tgl 26 > taEnd tgl 25, seed.ts:584-585) — jendela TA tidak dipakai siapa pun (dead field).
- **m-3 · Flag/schema mati** — `displayInPaySlip` (editable UI, payslip tidak memfilter), `applyThrRules`, `nonNpwpSurcharge` (rate ada di bracket), `WageComponent.processMethod` per komponen, `PostingEvent`, `TerRate` saat useTer=false, `PayrollRegulation.validFrom/validTo` tidak difilter runtime (`getActiveRegulation` hanya `active=true` orderBy validFrom desc — regulasi masa depan bisa terpilih lebih awal).
- **m-4 · calcMethod "Percentage" tidak diimplementasi** — jatuh ke evalFormula (`formula` null → "0") = 0 senyap bila dikirim via API (engine.ts:310-318); UI hanya Fixed/Formula. Formula tak di-pre-validasi saat simpan komponen → salah ketik variabel membuat seluruh run gagal 500 di tengah `calculateAndSaveRun`.
- **m-5 · Loan validasi/transisi lemah** — `loans.ts:30-106`: amount negatif lolos (`!b.amount` hanya menangkap 0/NaN); PATCH status transisi bebas (PaidOff manual tanpa alasan/audit → write-off senyap; Cancelled dengan outstanding tak direset; Active bisa dikembalikan untuk loan lunas); pencocokan cicilan saat confirm via substring `letterNo` (payroll-service.ts:319) — rawan kolisi prefix (LTR-2026-001 vs LTR-2026-0010).
- **m-6 · Semantik Specific = MENIMPA, bukan menambah** — `payroll-service.ts:181-193`: komponen Specific dengan kode sama seperti template/Periodic mengganti nilai (override), bukan menambah. Konsisten dengan komentar kode, tetapi kontra-intuisi untuk "komponen khusus one-off" (user menambah TJAB 500rb mengganti tunjangan 5,49jt). Perlu label UI eksplisit atau penjumlahan terpisah.
- **m-7 · PATCH period menerima status string bebas** — tanpa enum validation; reopen Closed → Open diterima tanpa guard/alasan (payroll-periods.ts:80-89).
- **m-8 · Karyawan aktif tanpa assignment aktif / tanpa payrollProfile dilewati senyap** (payroll-service.ts:131-135) — tidak masuk run tanpa peringatan; default PTKP TK0/hasNpwp true bisa salah.
- **m-9 · SPT nuansa** — N2G: pajak ditanggung perusahaan tetap dilaporkan sebagai "PPh21 dipotong" karyawan (delta salah makna); `getBrackets` tidak memfilter `validFrom` (bracket masa depan ikut terpakai); biayaJabatan bulanan×12 mengasumsikan kerja penuh 12 bulan (tahun parsial → koreksi tak mekanis).
- **m-10 · Profil** — konsistensi `dependents` (0-3) vs `taxStatus` (K2 dsb.) tidak divalidasi (payroll-profiles.ts:71-87); `allEmployee` run diabaikan engine; `npwp` boleh kosong saat hasNpwp=true.
- **m-11 · Ekspor CSV "umum"** menyertakan semua baris termasuk bank tanpa format (BRI) tanpa penanda; CSV semi-colon tanpa escaping nama (ada tanda kutip manual — cukup untuk demo, tidak untuk bank).

### GAP — proses standar payroll Indonesia yang belum ada (12)

1. **G-1 Slip gaji cetak/PDF & ESS** — payslip hanya dialog UI (payroll-run-detail.tsx), tanpa print/PPDF/kirim email/ESS karyawan.
2. **G-2 Aturan THR** — prorata masa kerja (<12 bulan proporsional, UU 13/2003), basis 1× gaji + tunjangan tetap, tenggat H-7 lebaran, run THR massal per period; `applyThrRules` mati.
3. **G-3 Koreksi PPh21 akhir tahun** — processType YEAR_END_ADJ tersedia tapi tidak ada mekanisme koreksi kumulatif YTD; laporan SPT menunjukkan delta (live: **−311.366.594** — kombinasi tahun parsial demo & aturan) tanpa proses penyelesaian (lebih/kurang bayar).
4. **G-4 Final settlement / pesangon** — processType TERMINATION ada nama saja: TaxBracket Severance/Pension tidak pernah dipakai; formula pesangon (1×/2×/UPMK) & PPh21 final pesangon (Pasal 17 khusus) tidak ada; karyawan berhenti mid-month tidak diproses sama sekali (di-exclude dari run, tanpa final pay/prorate).
5. **G-5 Laporan/iuran BPJS** — tidak ada file laporan bulanan (bpjskuota), kontrol karyawan tanpa BPJS (template FREELANCE tanpa komponen Jamsostek — tidak terdeteksi sebagai exception).
6. **G-6 Approval maker-checker payroll** — confirm run/parameter pajak/loan tanpa layer approval (engine ApprovalLayer milik PA tidak dipakai payroll).
7. **G-7 Dimensi akuntansi** — jurnal flat tanpa cost center/segmen (oranHR: COA per wage code + cost center + 10 dimensi analisis + per office); tidak ada jurnal per unit/outlet.
8. **G-8 Format bank resmi & multi-outlet** — CSV generik; format fixed-width per bank & pemisahan per office belum (oranHR 12 bank × 33 outlet); BRI tidak tersedia.
9. **G-9 Keamanan data payroll** — tanpa enkripsi field gaji/pembatasan tampilan per role (oranHR Encryption User Assignment); AccessGroup tidak enforce (M-06 lintas-modul).
10. **G-10 Natura PP 68/2024** — `naturaType` tersimpan tetapi tidak dipakai; pembayaran UMC medical via payroll ditaxable `Regular` tanpa pertimbangan natura kesehatan/kenikmatan.
11. **G-11 Loan approval flow** — pinjaman langsung `Active` tanpa approval (oranHR EmployeeLoanToApprove) dan tanpa integrasi kasbon travel (TRVLOAN).
12. **G-12 Master process type & regulasi ber-dating** — ProcessType tanpa CRUD (fixed seed 7 jenis); PayrollRegulation versi per tahun tidak dipilih berdasarkan tanggal proses (multi-tahun regulasi tidak didukung runtime).

---

## 6. Verifikasi Live (tenant MII, GET & SELECT read-only)

- 6 run: PR-2026-07..12-SAL-01 (2 Paid, 4 Confirmed); Σ line vs total run Δ=0 semua; 3.806 item; nomor run unik & berurutan.
- 15 jurnal: 6 payroll (JV-2026-001..004/009/010, D=C persis), 4 travel, 5 medical (JV-2027..2031, artefak C-03 lintas-modul); `missingRuns` = [] (semua run Confirmed punya jurnal).
- 3 loan × 5 cicilan Deducted tepat 1 per period per loan (Aug–Des), paidAmount/outstanding akurat; item LOAN per run cocok installment.
- Benefit: 3 klaim Scheduled (period 2026-09) belum dibayar — konsisten dengan tidak adanya run BENEFIT (lihat M-5); sinkronisasi 3 klaim → 2 assignment BEN_MED (1,75jt + 1,7jt agregat) benar.
- PPh21 diverifikasi manual 2 karyawan (G2N & N2G) — konsisten engine; koreksi aturan JKK/JKM/JPK → selisih (M-1).
- Profil: 42 (1 N2G, 41 G2N; PTKP campuran TK0–KI2); TerRate 107 baris A/B/C; bracket UU HPP 5 lapis benar; useTer=false.
- Bank: 44/44 karyawan punya rekening (BCA 10, Mandiri 13, BNI 11, **BRI 10 — tanpa format**).
- Account balance konsisten internal payroll (2102 = PPh21 tertahan 555,6jt; 2104 = 13,9jt = Σ cicilan; 1101 negatif karena tidak ada sisi penerimaan kas — artefak demo).

## 7. Hal yang Sudah BAIK (dipertahankan)

Snapshot run/line/item (histori tak berubah saat master diubah); guard kunci run (calculate/confirm/delete/double-run); jurnal idempotent per runId + balance enforced + fallback backfill UI; multi-run per period dengan semantik suplemental anti double-pay gaji; engine formula + variabel sistem & regulasi terpusat; N2G gross-up iteratif dengan actualNetTax; benefit limit snapshot + re-check saat approve + agregasi assignment; loan 1-cicilan-per-run dengan urutan sequence; ekspor dibatasi run Confirmed/Paid; idempotensi transfer modul lain (delete+rewrite).

## 8. Urutan Rekomendasi

1. **K-1** — basis pajak kumulatif masa pajak untuk run suplemental ( THR/BONUS/RAPEL ) sebelum fitur run THR dipakai nyata.
2. **K-2** — tolak cancel Confirmed di server (+ reversi bila perlu).
3. **M-1 + M-10** — perbaiki klasifikasi objek pajak BPJS & basis upah BPJS (data seed + filter engine).
4. **M-3/M-4/M-5** — guard rapel & assignment-period-confirmed & close-period (kelas "komponen terjebak").
5. **M-7** — `$transaction` untuk confirmRun; lalu gunakan generator nomor jurnal/run terpusat (mengacu C-03).
