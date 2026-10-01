# ANALISA DEEP-DIVE: Modul Travel Administration oranHR → Rencana Implementasi Perjalanan Dinas RekanKerja

> Dokumen analisa murni. Basis: eksplorasi langsung demo.oranhr.com (login MII000001,
> PT Mitra Industri Internasional / "MII", versi 11.08.00) — seluruh 12 halaman modul
> Travel Administration dipetakan via navigasi tree (ExtJS) & data nyata dibaca dari
> grid + form + handler JS + source JSP (presenter class), ditambah halaman ESS terkait
> travel dan interface payroll/jurnal (wage definition + expense COA). Tanggal: sesi
> analisa travel. Penulis: agent RekanKerja.

---

## 1. PETA MODUL TRAVEL ADMINISTRATION ORANHR (12 HALAMAN, 3 GRUP)

```
TRAVEL ADMINISTRATION
├─ Travel Budget ......................... TravelPeriod.jsp      ★ budget per period (5 baris 2022-2026)
│   └─ detail: Budget Per Cost Center   (isToDetail)
├─ TRANSACTION
│   ├─ Travel Request ................... TravelRequest.jsp      ★ pengajuan perjalanan dinas
│   ├─ Travel Request Approval .......... TravelRequestToApprove.jsp ★ antrean approval (24 pending)
│   ├─ Travel & Entertainment Settlement TravelClaim.jsp        ★ klaim/settlement + Transfer payroll
│   └─ T&E Settlement Approval .......... TravelClaimToApprove.jsp  ★ (12 pending)
└─ GENERAL SETTING
    ├─ Travel Administration Template ... ClaimTmpl.jsp          ★ template (settlement day, metode)
    ├─ Travel Expense Definition ........ ExpenseDefinition.jsp  ★ master jenis biaya (20+ baris)
    ├─ Travel Expense Definition Rules .. ExpenseDefinitionDesc.jsp ★ limit nominal + wage kompensasi
    ├─ Expense Chart of Account ......... ExpenseAccount.jsp     ★ mapping akun Debit/Kredit per biaya
    ├─ Domestic Zone Definition ......... DomesticZone.jsp       ★ zona (LOCAL/JAWA BARAT/ASIA/OTHERS)
    ├─ Travel Administration Wage Def... TravelWageDefinition.jsp ★ 3 wage code payroll interface
    └─ Travel Report Template ........... TravelRptTmpl.jsp      ★ layout laporan (LOCAL/OVERSEAS)

ESS / MSS
├─ My Travel Request .................... MyTravelRequest.jsp   (ajukan sendiri + destinasi + advance)
├─ My Travel Claim ...................... MyTravelClaim.jsp     (settlement sendiri)
└─ My Travel Request Approval ........... MyTravelRequestToApprove.jsp (manager setujui tim)
```

Reminder home page MII: **Approval - 24 Travel Request, Approval - 12 Travel Claim** —
travel adalah modul dengan beban approval TERBESAR di MII (31 leave, 24+12 travel).

---

## 2. DATA MODEL INTI (dari grid + form + data nyata MII + source JSP)

### 2.1 TRAVEL BUDGET — TravelPeriod.jsp (5 baris nyata)

```
Company Id | Period Id | Currency Code | Start Date | End Date |
Total Budget | Total Used Amount | Total Unused Amount
2022: Rupiah 01 Jan–31 Dec 2022 | 0              | 33.000.000     | -33.000.000
2023: Rupiah 01 Jan–31 Dec 2023 | 2.600.000.000  | 90.200.000     | 2.509.800.000
2024: Rupiah 01 Jan–31 Dec 2024 | 0              | 9.800.000      | -9.800.000
2025: Rupiah 01 Jan–31 Dec 2025 | 630.000        | 11.630.000     | -11.000.000
2026: Rupiah 01 Jan–31 Dec 2026 | 0              | 0              | 0
```

- Kolom detail: **Budget Per Cost Center** (isToDetail) — budget dapat dipecah per CC.
- Catatan pola MII: budget sering 0 / terlampaui (Used > Budget) → sistem TIDAK memblokir
  klaim melebihi budget; budget = alat monitoring, bukan hard limit.

### 2.2 TRAVEL REQUEST — TravelRequest.jsp (grid + form New)

Header (12 field form New):
```
Employee Id* (LOV Active Employee) | Employee Name (auto)
Request No (auto: 002/08/2026/0002 = seq/MM/YYYY/NNNN; boleh manual "TR-0282/12/2023")
Request Date* (default hari ini)   | Status (Prepared→Submitted→Partially Approved→Approved/Rejected/Cancelled)
Start Date | End Date              | Template Name* (LOV, default template "TRAVEL")
Cost Center (auto dari employee)   | Is Claim Requested Yet (flag klaim sudah diajukan)
Purpose* (textarea) | Remark (textarea)
```

Detail (presenter class dari source JSP):
- **TravelRequestDestinationPres** → Request Destination: Request Detail No, Start Date,
  End Date, Destination, Overseas, Domestic Zone, Country (multi-kaki perjalanan)
- **TravelCashAdvancePres** → Cash Advance: uang muka yang diberikan sebelum berangkat
- **TravelRequestStatusPres** → Status Log (riwayat status)

Operation menu: **Submit | Return To Prepare | Approve | Reject | Cancel**
(terlihat saat baris dipilih; approval bisa langsung dari halaman HR).

### 2.3 TRAVEL CLAIM / SETTLEMENT — TravelClaim.jsp

Header (grid 28 kolom, form New 22 field):
```
Employee Id* (default login user) | Claim No.* (bebas "TEST1234"/auto)
Request No (LOV → hanya request Approved; Purpose & template ter-copy otomatis)
Template Name* | Status (Prepared→Submitted→Partially Approved→Approved→Transferred)
Start Date | End Date | Request Date | Claim Date | Cost Center (auto)
Voucher No | Settlement Method (default template: "Settled by Cash")
Purpose | Remark | Journal No | Journal Type | Journal Date (auto saat posting)

SETTLEMENT AMOUNT (formula oranHR):
  Amount of Other Company Expense  (a)  — biaya dibayar pihak lain (kartu korporat dsb.)
  Amount of Currency Exchange Loss (a)  — rugi selisih kurs (transaksi overseas)
  Amount Payable to Employee       (b)  — harus dibayar ke karyawan
  Amount Payable to Company        (c)  — harus dikembalikan ke perusahaan
  Total Settlement (a)+(b)-(c)          — angka final (bisa negatif = karyawan bon)
```

Detail TABS (presenter class dari source JSP — inti modul):
```
TravelClaimPerDestinationPres  → Destination (kaki perjalanan klaim)
TravelClaimGenExPres           → General Expense   (hotel, transport, meals, phone, laundry, retribution, license/visa)
TravelClaimAllowancePres       → Allowance         (pocket money / uang saku harian)
TravelClaimMileagePres         → Mileage           (BBM, jarak tempuh)
EntertainmentExpensePres       → Entertainment Expense (hadiah, tiket, restoran — relasi kerja)
EntertainmentGuestPres         → Entertainment Guest   (DAFTAR TAMU yang di-entertain — detail per tamu!)
TravelClaimCashAdvancePres     → Cash Advance (uang muka yang ditarik)
TravelCashOnHandPres           → Cash On Hand
ExchangeTransactionPres        → Exchange Transaction (kurs beli/jual saat dinas luar negeri)
CashReturnPres                 → Cash Return
TravelClaimRatePres            → Currency Rate
TravelClaimSummaryPres         → Expense Summary (agregasi a/b/c per jenis)
TravelClaimStatusPres          → Status Log
```

Operation menu: **Submit | Return To Prepare | Approve | Reject | Cancel | TRANSFER**
- **Transfer** = kirim settlement ke payroll (lihat 2.7). Transfer ditolak jika klaim
  belum layak ("Sorry, there are no data to process" pada klaim kosong).

Status nyata di grid: Prepared, Submitted, Partially Approved, Approved, **Transferred**.

### 2.4 TRAVEL ADMINISTRATION TEMPLATE — ClaimTmpl.jsp (5 template MII)

```
Template Name | Is Default | Template Description | Settlement Day | Default Settlement Method
TRAVEL             (default)                     14
TRAVEL_KA                                        14
TRAVEL LOCAL       Perjalanan Dinas Local        14
TRAVEL LOCAL 150KM                        ✓      14   Settled by Cash
TRAVEL OVERSEAS    Perjalanan Dinas Luar Negeri  14
```

- Settlement Day 14 = batas hari settlement setelah kembali.
- Template dipakai request & claim; menentukan expense yang relevan (local vs overseas).

### 2.5 TRAVEL EXPENSE DEFINITION + RULES

ExpenseDefinition.jsp (master, 20+ baris MII):
```
Expense Name | Expense Type | Expense Description | Need Supporting Documents
ADVANCE              General Expense
E-GIFT               Entertainment     Entertainment Gift
E-MOVIE              Entertainment     Entertainment Movie
E-RESTAURANT         Entertainment     Entertainment Restaurant
L_BBM, L_SAKU,       Mileage           (berbasis jarak)
L-TRANSPORTJARAK
L_BBM_150KM          General Expense
L-HOTEL/-LAUNDRY/-MEALS/-PHONE/-RETRIBUTION  General Expense  Local *
L-POCKET MONEY       Allowance         Local Pocket Money
O-HOTEL/-LAUNDRY/-MEALS/-PHONE/-LICENSE      General Expense  Overseas * (License = Visa)
```

ExpenseDefinitionDesc.jsp (rules per jenis, tab per tipe: General/Entertainment/Mileage/
Allowance Expense Rules):
```
Expense Name | Expense Type | Expense Description
Valid From (01 Jan 1990) | Valid To (01 Jan 9999)
Nominal Amount (limit: E-GIFT 800.000; L-HOTEL 2.000.000; L_BBM_150KM 125.000; 0 = tak dibatasi?)
Currency Code (Rupiah + 20+ mata uang asing: USD, EUR, JPY, SGD, MYR...)
Unlimited | Compensation Wage | Compensation Wage Name
```

### 2.6 EXPENSE CHART OF ACCOUNT + DOMESTIC ZONE + WAGE DEFINITION

ExpenseAccount.jsp — mapping jurnal per jenis biaya:
```
Expense Name | Debit Credit | Account Code | Description | analysis1..analysis10
Based On: Region | Organization Unit | Company Office | Employment Type | Position Grade | Employee Grade
L-HOTEL → Debit+Credit 00013 (region JAKARTA), L_BBM → 00004, E-GIFT → 900001, L-POCKET MONEY → 900002
```
→ journal posting klaim memetakan tiap baris biaya ke akun beban (Debit) dengan dimensi
analisis (cost center / region / grade) — sama seperti posting payroll oranHR.

DomesticZone.jsp (zona):
```
LOCAL (Local or Domestic Area) | JAWA BARAT (Bandung) | ASIA (All Asia Non Japan) | OTHERS (Japan, US, Europe)
```
→ dipakai di destinasi request/claim; kombinasi Overseas flag + zone menentukan aturan
biaya (expense local L-* vs overseas O-*).

TravelWageDefinition.jsp (interface payroll — 1 baris global):
```
Wage for Employee Loan → TRVLOAN  (uang muka = pinjaman karyawan)
Wage for Compensation  → UTRP     (upah kompensasi travel — dibayar)
Wage for Deduction     → TRVSTLIN (potongan settlement — kelebihan uang muka)
```

### 2.7 ALUR END-TO-END ORANHR (disintesis dari halaman + data)

```
[HR/ESS] Travel Request (Prepared)
   └─ Submit → Submitted → (Partially) Approved
        ├─ detail: Destinasi (multi kaki: kota, zone, overseas, tanggal)
        └─ detail: Cash Advance (uang muka — tercatat sebagai LOAN TRVLOAN)
[Karyawan berangkat — biaya aktual]
[HR/ESS] Travel Claim / Settlement (Prepared) ← link Request No (Approved)
   └─ rincian per tab: General Expense / Allowance / Mileage / Entertainment (+ Guest)
        Cash Advance dipakai, Exchange Transaction (kurs), Cash Return
   └─ Expense Summary: (a)+(b)-(c) → Payable to Employee (b) / to Company (c)
   └─ Submit → Approval → Approve
        ├─ Journal No/Type/Date terisi (posting jurnal via Expense COA)
        └─ TRANSFER → payroll: komponen UTRP (bayar b) / TRVSTLIN (potong c) / TRVLOAN (lunasi advance)
[Payroll run] → komponen travel masuk payslip → klaim berstatus final
[Travel Budget] Total Used Amount bertambah per klaim approved/transferred
```

---

## 3. ANALISA KEKUATAN & KEPUTUSAN DESAIN REKANKERJA

| Aspek oranHR | Keputusan RekanKerja |
|---|---|
| 12 halaman ExtJS terpisah | 8 view dalam 1 modul travel (paradigma attendance/leave) |
| Formula settlement (a)+(b)-(c) | Dipertahankan persis — sumber kebenaran finansial klaim |
| 4 tab tipe biaya (Gen/Allowance/Mileage/Entertainment) + Guest | 1 tabel detail ClaimExpense dengan kolom expenseType + limit check per jenis; guest sebagai kolom penerima di baris entertainment |
| Destinasi multi-kaki + zone + overseas | TravelDestination di request & claim (Zone master dipertahankan) |
| Cash advance = loan (TRVLOAN) | Advance per request; saat transfer, saldo advance dianggap dipakai |
| Wage 3 kode (TRVLOAN/UTRP/TRVSTLIN) | Komponen upah payroll: UTRP (Travel Compensation, earning) + TRVSTLIN (potongan) via ComponentAssignment Specific — pola sama dengan encashment cuti UCT |
| Journal per expense (COA Debit/Credit) | JournalEntry/JournalLine (modul payroll sudah punya jurnal — dipakai ulang: klaim generate jurnal per baris biaya, akun dari Expense COA master) |
| Budget period + per cost center (soft limit) | TravelBudget per period + detail per cost center; progress bar; warning (bukan blokir) sesuai perilaku nyata MII |
| Settlement day per template | Batas jatuh tempo settlement ditampilkan; status Overdue di daftar |
| Approval multi status (Partially Approved) | Disederhanakan: Submitted → Approved (approval tunggal berjenjang dari modul existing; note di backlog) |
| Transfer (klaim → payroll) | transferClaimToPayroll: period aktif + assignment komponen Specific (idempotent), paid saat run confirm — pola encashment |

### 3.1 MODEL DATA PRISMA (schema-tenant)

```
TravelZone            (code, name)                     — LOCAL/JAWA BARAT/ASIA/OTHERS
TravelTemplate        (name, isDefault, description, settlementDay, settlementMethod)
TravelExpenseType     (name, kind GENERAL|ALLOWANCE|MILEAGE|ENTERTAINMENT, description,
                       needDocs, limitAmount, currency, unlimited, compWageCode?,
                       debitAccount, creditAccount, validFrom, validTo)
TravelBudget          (year, startDate, endDate, totalBudget) + TravelBudgetItem (costCenter, amount)
TravelRequest         (docNo auto TR/MM/YYYY/NNNN, employeeId, requestDate, startDate, endDate,
                       templateName, costCenter, purpose, remark, status, claimRequestedAt?)
TravelDestination     (requestId, seq, startDate, endDate, city, zoneCode, country, overseas)
TravelAdvance         (requestId, amount, note, givenAt)  — uang muka
TravelClaim           (docNo auto CL/MM/YYYY/NNNN, requestId?, employeeId, claimDate,
                       templateName, costCenter, purpose, remark, status,
                       otherCompanyExp (a), exchangeLoss (a), payableEmployee (b), payableCompany (c),
                       totalSettlement = (a)+(b)-(c), settlementMethod, voucherNo,
                       journalNo?, transferredAt?, paidRunNo?)
TravelClaimExpense    (claimId, expenseName, kind, expenseDate, qty/unit, amount,
                       description, guestName? — untuk Entertainment, distanceKm? — untuk Mileage)
```

Formula & invarian:
- `totalSettlement = otherCompanyExp + exchangeLoss + payableEmployee − payableCompany`
- Advance request total → saat claim transfer: b bertambah advance? TIDAK — advance sudah
  diterima; settlement = realisasi − advance → payableEmployee/Company.
- Budget used = SUM(totalSettlement klaim Transferred) per period.

### 3.2 API ROUTE (/api/rekankerja/travel/*)

```
GET  /overview                 — KPI + alur + budget berjalan
GET/POST/PATCH /budget         — daftar/adjust period + item per cost center
GET/POST/PATCH /templates      — template & expense type & zone (master)
GET/POST /requests             — daftar + buat (destinasi + advance) + preview
PATCH /requests                — submit / approve / reject / cancel
GET/POST /claims               — daftar + buat (expenses) + preview formula
PATCH /claims                  — decide (approve/reject) / submit / cancel
POST /claims/transfer          — transfer ke payroll period (UTRP/TRVSTLIN)
GET  /reports                  — klaim per period, biaya per jenis, budget vs realisasi
```

### 3.3 UI 8 VIEW (Bahasa Indonesia, aksen oranye — konsisten modul lain)

```
1 travel-overview    Ringkasan: KPI (request bulan ini, pending approval, klaim menunggu,
                     total klaim tahun, budget vs terpakai) + alur 4 langkah + kartu formula (a)(b)(c)
2 travel-request     Permintaan: daftar + form multi-destinasi + advance + dialog status
3 travel-approval    Persetujuan request: antrean + Approve/Reject/Cancel + efek
4 travel-claim       Klaim & Settlement: buat klaim dari request (rincian per jenis biaya,
                     cek limit per jenis, guest untuk entertainment, km untuk mileage) +
                     dialog advance & summary (a)(b)(c) live
5 travel-claim-approval  Persetujuan klaim: antrean + approve → jurnal + transfer payroll
6 travel-budget      Budget: period + per cost center + progress + warning over-budget
7 travel-templates   Master: template (settlement day/metode) + jenis biaya + limit +
                     akun Debit/Kredit + zona
8 travel-reports     Laporan: klaim per period, biaya per jenis (bar), destinasi teratas
```

---

## 4. INTEGRASI

- **Payroll**: transferClaim(claim, period) → ComponentAssignment Specific:
  - payableEmployee (b) → komponen UTRP (earning, periode aktif)
  - payableCompany (c) → komponen TRVSTLIN (deduction) — hanya jika > 0
  - saat run confirm → markTravelPaidForRun → status Paid/Transferred final (pola
    markOvertimePaidForRun & markEncashmentPaidForRun).
- **Jurnal (akuntansi)**: approve klaim → generate JournalEntry (periode klaim) dengan
  JournalLine per baris biaya: Debit akun beban dari ExpenseType.debitAccount +
  dimensi cost center; Credit akun counterpart (creditAccount / kas "Settled by Cash").
  Jurnal no = JL-… idempotent per klaim (hapus-tulis ulang pola transfer encashment).
- **Attendance**: (opsional backlog) hari perjalanan bisa menandai absensi OnTravel —
  TIDAK diimplement sekarang agar scope terkendali.

---

## 5. ROADMAP IMPLEMENTASI (Task 19)

- **T1 Prisma**: 8 model (TravelZone/Template/ExpenseType/Budget+Item/Request+Destination+
  Advance/Claim+Expense) → DDL → apply ke 3 tenant.
- **T2 Service** travel-service.ts: docNo per-prefix, submitRequest/decideRequest,
  createClaim (auto-copy request: template/cost center/purpose/destinasi), validasi limit
  per jenis biaya (warning + boleh lewat sesuai perilaku oranHR), formula settlement,
  approveClaim → journal + update budget used, transferClaimToPayroll (idempotent),
  markTravelPaidForRun, budgetOverview, travelStats.
- **T3 API** 8 route.
- **T4 UI** 8 view + wiring page.tsx + nav 8 view + MODULES ready.
- **T5 Seed**: master (4 zona, 5 template, ~14 jenis biaya + limit + akun, budget 2026
  MII per cost center), demo MII: request bulan Sep (2-3 kaki destinasi + advance),
  klaim Approved + Transferred; Cahaya/Sentra master saja.

Backlog (tidak dikerjakan): ESS mobile self-service, multi-currency exchange rate
transaksi, entertainment guest table terpisah, partially approved multi-level,
template laporan PDF custom, integrasi mesin kasir/kartu korporat.
