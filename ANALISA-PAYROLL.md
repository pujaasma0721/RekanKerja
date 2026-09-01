# ANALISA DEEP-DIVE: Modul Payroll oranHR → Rencana Implementasi Payroll OneVity

> Dokumen analisa murni (tanpa perubahan kode). Basis: eksplorasi langsung demo.oranhr.com
> (login MII000001, PT Mitra Industri Internasional / "MII", versi 11.08.00) — 74 halaman
> modul Payroll Administration dipetakan, form & data nyata dibaca via API ExtJS.
> Tanggal: sesi analisa payroll. Penulis: agent OneVity.

---

## 1. PETA MODUL PAYROLL ORANHR (74 HALAMAN, 8 GRUP)

```
PAYROLL ADMINISTRATION
├─ Encryption User Assignment ............... /AssignUser.jsp          (keamanan data payroll)
├─ Employee Salary Information ............. /EmpPayrollInfo.jsp      (master payroll per karyawan)
├─ TRANSACTION (input data pemrosesan)
│   ├─ Employee Attendance .................. /EmployeeAttendance.jsp
│   ├─ Employee Absence ..................... /EmployeeAbsence.jsp
│   ├─ Employee Overtime .................... /EmployeeOvertime.jsp
│   ├─ Employee Increment ................... /EmployeeIncrement.jsp
│   ├─ Employee Piecework ................... /EmployeePiecework.jsp
│   ├─ Employee Leave Cashable .............. /EmpLeaveCashable.jsp
│   ├─ Employee Specific Salary Component ... /EmployeeWageCode.jsp
│   ├─ Employee Loan ......................... /EmployeeLoan.jsp
│   ├─ Employee Periodic Salary Component ... /FrequencyWage.jsp
│   └─ Employee Loan Approval ................ /EmployeeLoanToApprove.jsp
├─ PROCESS (eksekusi & hasil)
│   ├─ Back Pay Process ..................... /RapelProcess.jsp
│   ├─ Back Pay Transaction ................. /RapelTransaction.jsp
│   ├─ Payroll Process ...................... /PayrollProcess.jsp   ★ inti
│   ├─ Wage Transaction ..................... /WageTransaction.jsp  ★ hasil
│   ├─ Query - Wage Transaction Payment ..... /QueryWagePayment.jsp
│   ├─ Accumulated Wage Transaction ......... /WageAccumulation.jsp
│   ├─ Tax Calculator ....................... /TaxCalculator.jsp
│   ├─ Pension/Severance Calculator ......... /PensionCalculator.jsp
│   ├─ Salary Increment / Result ............ /SalaryIncrement.jsp, SalaryIncrementLog.jsp
│   ├─ Transfer Bank Payment (12 bank) ...... BCA, BCA Multipayroll, Mandiri, Mandiri Syariah,
│   │                                        BNI, BRI, BSI, Danamon, CIMB, NISP, Permata, DBS, Bank MAS
│   ├─ Service Charge (9 sub) ............... target penjualan, kontribusi, poin & bobot, outlet,
│   │                                        upload, proses SC, range SC
│   ├─ Salary Simulation (4 sub) ............ indikator, template, proses, hasil
│   ├─ Transfer to Account .................. /TransferAccounting.jsp (jurnal ke GL)
│   ├─ Payroll Transaction Account .......... /TransactionAccount.jsp
│   └─ Wage Transaction Report Template ...... /WageReportTemplate.jsp
├─ CORETAX TRANSACTION (integrasi DJP Coretax)
│   ├─ Bukti Potong PPh21 Bulanan / Tahunan / Final&TdkFinal
│   └─ Upload PPh21 Bulanan / Tahunan / Final&TdkFinal
├─ ANNUAL SPT (PPh21 tahunan)
│   ├─ Final Process Annual SPT ............. /SptProcess.jsp
│   ├─ Employee Annual SPT .................. /SptFinal.jsp
│   └─ Initial Employee Annual SPT .......... /SptInit.jsp
├─ EMPLOYEE BENEFIT
│   ├─ Benefit Type / Claim / Claim Approval / Benefit Chart of Account
└─ GENERAL SETTING (master & parameter)
    ├─ Salary Component ...................... /WageCodeDetail.jsp  ★ master komponen
    ├─ System-Defined Salary Component ...... /SystemWageParameter.jsp (komponen sistem: hari kerja dsb)
    ├─ Salary Chart of Account ............... /WageAccountCode.jsp
    ├─ Payroll Period ........................ /PayrollPeriod.jsp  ★
    ├─ Process Type .......................... /ProcessType.jsp    ★
    ├─ Wage Template .......................... /WageTemplate.jsp
    ├─ Bank Information ....................... /Bank.jsp
    ├─ Initial Employee Wage Transaction ..... /WageInit.jsp
    ├─ SC Range ............................... /ServiceChargeRange.jsp
    └─ Setup System Parameter
        ├─ Company Payroll Information ....... (NPWP, BPJS, ID TKU perusahaan)
        ├─ Natura Regulation ................. (PP 68/2024)
        ├─ Government Tax & Payroll Regulation /PayrollRegulation.jsp (switch aturan per tahun)
        ├─ Income Tax Bracket ................ (progresif NPWP vs non-NPWP)
        ├─ Severance Tax Bracket / Pension Tax Bracket
        └─ TER Income Tax .................... (PP 58/2023 — TER kategori A/B/C)
```

---

## 2. DATA MODEL INTI (hasil pembacaan form/grid + data nyata)

### 2.1 Salary Component (Wage Code) — master komponen, 40+ atribut

**Identitas:** Wage Code, Wage Name, Currency, Valid From/To, has_rule + rule_expression
(nominal_amount utk fixed).

**Klasifikasi (enumerasi nyata dari combo):**
- **Wage Type (13):** Basic Salary, Compensation, Compensation in Natura, Deduction, Overtime,
  Jaminan Sosial Tenaga Kerja (BPJS), Loan, Take Home Pay Rounding, Final Tax, Income Tax,
  Information, Back Pay, Service Charge
- **Wage Category (3):** Income, Deduction, Information
- **Income Tax Method (8):** Non Taxable, Regular, Irregular, Fixed-Rate Final, Severance Final,
  Pension Final, PKP, Final > 2 years
- **Process Method (2):** GrossToNet, NetToGross
- **Rounding Type (3):** Rounding Up / Down / Nearest + Rounding Value
- **SPT Reference (8):** Gaji/Pensiunan/THT-JHT, Tunjangan & Lembur, Honorarium, Premi Asuransi,
  Penerimaan Natura, Bonus & THR, Pensiun JHT, Zakat → pemetaan baris bukti potong 1721-A1
- **Natura Type (11):** Makanan/Minuman, Bingkisan Hari Raya, Bingkisan non-Hari Raya, Peralatan
  Kerja, Kesehatan & Pengobatan, Fasilitas Olahraga, Tempat Tinggal Komunal/Non-Komunal,
  Kendaraan, Iuran Dana Pensiun, Peribadatan → kategori PP 68/2024

**Flag perilaku:** Include as Basic Income (ikut dasar upah), JAMSOSTEK Type (basis potongan
JSTK), Deduction Type (Deduction from THP / …), Display in Pay Slip, Include in Take Home Pay,
Only Print When Has Value, Apply THR Rules, Prorate Rule + Use Default Schedule + Average
Working Day + First/Last Year Prorate Rule, Cut-Off Date.

**Data-access rules (komponen berlaku utk siapa):** Organization Unit, Company Office, Work
Location, Employee Status, Employment Type, Service Year, Position, Position Grade, Employee
Grade, Religion, Marital Status, No of Dependent, Employee, Warning Level, Service Group, Age,
Gender, Employee (Secure) → komponen bisa di-scope per demografi (17 dimensi!).

**Back Pay mapping:** Wage Code Back Pay + Reverse Back Pay Code (komponen ↔ pasangan rapelnya).

**Bukti formula engine nyata (dari data MII):**
- `BPJSK`  (Deduction, BPJS Kesehatan kary.) = `DP_BPJS*0.01*NO_BPJS`
- `BPJSP`  (Income, BPJS Kesehatan perush.) = `DP_BPJS*0.04*NO_BPJS`
- `BPJSP_NET` = NetToGross + formula sama
→ ada evaluator ekspresi + variabel sistem (DP_BPJS, NO_BPJS, dsb).

### 2.2 Payroll Period — 1 baris per period, 5 jendela tanggal

`payroll_period` (label bebas spt "FEB 2028"), `pay_type` (Monthly/…), `start_date`, `end_date`,
`ta_start_date`, `ta_end_date` (jendela kehadiran ≠ jendela payroll!), `sc_start_date`,
`sc_end_date`, `sc_base_date` (service charge), `pay_period` (urutan bulan), `spt_month`,
`spt_year` (pajak bisa beda period — mis. FEB 2028 → SPT month 2/2028; JAN 2027 → SPT 2/2027?),
`payroll_process_date`.

→ **Insight penting:** period = master berdiri sendiri, dipakai semua proses; jendela TA
memungkinkan cut-off kehadiran sebelum akhir bulan payroll.

### 2.3 Process Type — multi-run payroll per period

Nilai nyata: Salary, Termination, Outstanding Transaction, Bonus, THR Natal, THR Lebaran,
Pension, Year End Adjustment, Benefit, THR, tes. Atribut: `process_no`, Process Type,
Process Sequence, Calculate Tax. → **satu period bisa diproses berkali-kali** (run gaji bulanan,
run THR, run bonus, run adjustment), tiap run punya urutan & flag hitung pajak.

### 2.4 Wage Template — paket komponen

`template_code` (BS = Basic Salary only, DEFAULT, FREELANCE, SV, UNTAR, MPMF…), Description.
Template dipilih **per karyawan** di Employee Salary Information. (Mapping detail komponen
template diatur di setup template, tidak terekspos di grid demo.)

### 2.5 Employee Salary Information — master payroll karyawan

Per karyawan: NPWP No + NPWP Submitted Date + Old NPWP, IDTKU (kode unit kerja fiskal),
Basic Salary + Currency + per + Basic Salary Unit (per Month/…), Process Method
(GrossToNet / **NetToGross per karyawan** — data nyata: Dita Tri Avista = NetToGross),
Payment Frequency, Wage Template, Marital Status + No of Dependents + **Payroll Dependent
Allowed** (→ penentu PTKP TK/K), audit field.

### 2.6 Wage Transaction — hasil payroll (header per karyawan·period·processType)

Kolom grid: Company, Employee, Payroll Period, start/end, Pay Period, Tax Month/Year,
Process Type, Process Date, **PTKP Value + PTKP Status** (nyata: 54.000.000/TK0, 58.500.000/K0),
**Total THP (IDR)**, Company Office (multi-office: MDO/SBY/TGR/…), Company NPWP, Company
Social Insurance No, Company BPJS Kesehatan No, **Actual Net Tax + Actual Gross Tax** (hasil
iterasi NetToGross), Status (**Processed / Posted**), Processing Sequence No, **Journal No +
Journal Type + Journal Date** (integrasi jurnal), THP Summary, pph26_tax, bptkp_value.
Total 2.526 transaksi di demo. → hasil disimpan per karyawan per period per run.

### 2.7 Employee Loan — engine pinjaman karyawan

Letter No, Status, Loan Date, Loan Amount, Currency, Number of Installment, Amount of
Installment, Start Payment Date, Transfer to Salary, Wage Code Loan/Installment/Interest
(potongan dipetakan ke komponen upah!), Deducted from Salary, Process Type, Purpose of Loan,
Total Loan, Paid Amount, Outstanding Amount, **Wage Code Interest + Flat Rate + Rate of
Interest [%]/year + Loan Amount with Interest**, Journal No/Type/Date, Payroll Period, audit.

### 2.8 Employee Specific & Periodic Salary Component

- Specific (EmployeeWageCode): Company, Payroll Period, Process Type, Employee → komponen
  one-off per run (mis. bonus khusus).
- Periodic (FrequencyWage): + Wage Code, Nominal Amount, Currency, based_date → nominal
  tetap yang diproses tiap period.

### 2.9 Parameter pajak & regulasi

- **Income Tax Bracket:** Lower/Upper Limit, Tax Rate NPWP, Tax Rate Non NPWP, Valid From/To
  → progresif + penalti non-NPWP dalam satu tabel ber-dating.
- **TER Income Tax:** kategori TER (A/B/C — PP 58/2023) → tarif efektif bulanan.
- **Natura Regulation** + Natura Type per komponen (PP 68/2024).
- **Government Tax & Payroll Regulation (PayrollRegulation):** kumpulan switch parameter aturan
  per tahun regulasi (mis. aturan UU HPP vs sebelumnya).
- **Severance / Pension Tax Bracket:** bracket khusus pesangon (final) & pension.
- **Company Payroll Information:** Registration No (NPWP), Social Insurance No, Tax Compulsion
  No, BPJS Kesehatan No, ID TKU, Company Type/Group, Use Company Office as Outlet.

### 2.10 Salary Chart of Account — pemetaan akuntansi

Per Wage Code: Debit/Credit, Account Code, **Cost Center**, **hingga 10 dimensi analisis**
(analysis_type1..10 — Region, dst.), based_on Organization… → jurnal payroll ber-dimensi
penuh (gaya ERP), lalu **Transfer to Account** memposting ke GL & **Transaction Account**
per transaksi (Journal No/Type/Date tercetak di wage transaction).

### 2.11 Tax Calculator — algoritma PPh21 yang terekspos

Input: Working Period, PTKP Status→PTKP Value, WNI, NPWP, Basic Salary, Allowance #1-3,
Bonus/THR, Deduction. Output antara lain: Total Regular/Irregular, Yearly Gross/Net, Tax
Allowance, Bruto, **Positional Expense (Biaya Jabatan)**, Neto, **Annualized**, PKP,
Annualized Income Tax, **Tax Gross/Net Yearly & Monthly breakdown [R], [I], [R+I]** →
memisahkan pajak regular vs irregular (Pasal 17 vs THR/Bonus dihitung tahunan-terproyeksi).

### 2.12 Employee Annual SPT (1721) — rekap tahunan

Per karyawan·tahun: Working/Income Period From-To, PTKP, Regular/Irregular/Final Income,
Position Allowance, PKP Deduction, **Tax Paid by Company vs Employee, Adjustment Tax, Total
Paid Tax, Income Tax, Final Tax, Annualized Net Income, Government Tax Subsidy (PPH26),
PPH26 Income/Tax, Previous Neto/Tax**, Sequence No → lengkap utk cetak 1721-A1 & upload Coretax.

### 2.13 Benefit Type — klaim benefit terintegrasi payroll

Category, Entitle For, Valid From/To, Entitled Wage, Reset Period, Max Claim (in/month/period),
Need Supporting Documents, Settlement Wage, Unlimited Amount, **Auto Approve When in Limit**,
Allow Overlimit, **Pay In Payroll** + Process Type, Send Employee ID to Journal.

### 2.14 Back Pay (Rapel) & Salary Increment

- RapelProcess: target Payroll Period + **From Period + From Process Type + All Employee** →
  hitung ulang retroaktif lintas period, selisih masuk komponen Back Pay (Wage Code Back Pay).
- SalaryIncrement: parameter global (Effective Date, Reference Letter, Rounding, All Employee,
  **Clear Salary History Record Later Than Effective Date**) + grid karyawan berisi snapshot
  kerja DAN field salary history: `sh_golid, sh_valid_to, basic_salary, currency, per_unit,
  start_date, end_date` → oranHR menyimpan **gaji juga ber-history** (pola sama dgn
  EmployeeAssignment OneVity).

### 2.15 Transfer Bank Payment — file per bank × office × processType

BCA Company Setting (kredensial korporat) + halaman per bank: Company Code, Transfer Code,
Transfer Date, Payroll Period, lalu checkbox per **Process Type** (Salary, THR, Bonus, …) ×
per **Company Office/Outlet** (33 outlet: BDG, JKT, SBY, MDO…) → generate file transfer
(bank file format per bank).

### 2.17 Keamanan khusus payroll

Operation menu khusus: **Lock/Unlock Encryption, User Assignment, Change Encryption** → data
payroll dienkripsi aplikasi, akses per user. Modul access group "Payroll" terpisah dari HR.

---

## 3. PERBANDINGAN DENGAN KONDISI ONEVITY SAAT INI

| Aspek | oranHR | OneVity sekarang | Gap |
|---|---|---|---|
| Master komponen upah | WageCode 40+ atribut, 13 wage type, 8 metode pajak, formula engine, scoping 17 dimensi, natura, back pay mapping | `WageComponent`: code/name/type(3)/calcMethod(3)/amount/prorated/taxable/active | **BESAR** — klasifikasi & perilaku pajak belum ada |
| Period payroll | Tabel period + jendela TA/SC + SPT month/year | — | BELUM ADA |
| Process type / run | Multi-run per period (Salary/THR/Bonus/…), sequence, flag tax | — | BELUM ADA |
| Template upah | Wage Template per karyawan | — | BELUM ADA |
| Master payroll karyawan | NPWP, PTKP (marital+dependent), metode G2N/N2G per karyawan, frekuensi, IDTKU | NPWP ada di Employee; PTKP & metode tidak ada | SEBAGIAN |
| History gaji | `sh_valid_to` per gaji | ✅ `EmployeeAssignment` (baseSalary ber-histori, validFrom/validTo) | SUDAH (basis kuat!) |
| Hasil payroll | Wage Transaction + PTKP + actual net/gross tax + THP + journal | — | BELUM ADA |
| PPh21 | Bracket progresif NPWP/non, TER, annualized, R/I terpisah, biaya jabatan | — | BELUM ADA |
| Rapel/back pay | Lintas period + komponen back pay | — | BELUM ADA |
| Loan | Cicilan+bunga+outstanding+potongan via wage code | — | BELUM ADA |
| SPT tahunan & Coretax | 1721-A1 + upload Coretax | — | BELUM ADA |
| Transfer bank | 12 bank × outlet × processType | — | BELUM ADA |
| Jurnal | COA per wage code D/K + cost center + 10 analisis + journal di transaksi | `AccountGroup/Account/PostingEvent` (sederhana) | SEBAGIAN (struktur ada, mapping per komponen belum) |
| Benefit | Tipe + klaim + approval + pay-in-payroll | — | BELUM ADA |
| Service charge / simulasi / piecework | Ada (industri hotel/retail) | — | BELUM ADA (opsional utk OneVity) |
| Approval payroll | — (oranHR approval umumnya di modul lain; loan & benefit claim pakai approval) | ✅ engine PA + ApprovalLayer ada | MODAL KUAT |
| Keamanan payroll | Enkripsi data + user assignment | AccessGroup + ActivityLog | SEBAGIAN |

**Kesimpulan gap:** OneVity punya *foundation* bagus (EmployeeAssignment ber-histori, engine
approval PA, master komponen sederhana, COA) tetapi **belum punya tulang punggung pemrosesan
payroll**: period → run → hasil → pajak → output (payslip/bank/SPT).

---

## 4. RANCANGAN IMPLEMENTASI ONEVITY (USULAN — belum dieksekusi)

### Fase P1 — Foundation Payroll (prasyarat)
1. **Upgrade `WageComponent`** → sejajarkan dgn oranHR: wageType (13), wageCategory (3),
   incomeTaxMethod (8), processMethod G2N/N2G, rounding type+value, includeInBasicIncome,
   jamsostekBasis (JSTK type), displayInPaySlip, includeInTHP, applyTHRRules, prorate fields,
   sptReference, naturaType, formula (rule) + variabel sistem, validFrom/To, wageCodeBackPay.
2. **Model `PayrollPeriod`**: name, payType, startDate, endDate, taStart/taEnd, payPeriod,
   sptMonth, sptYear, processDate, status (Open/Processed/Closed/Locked).
3. **Model `ProcessType`**: code (SALARY/THR/BONUS/…), name, sequence, calculateTax.
4. **Model `WageTemplate` + `WageTemplateItem`** (template → daftar komponen).
5. **Model `EmployeePayrollProfile`**: employeeId (1-1), NPWP+tanggal lapor, IDTKU,
   processMethod, paymentFrequency, wageTemplateId, maritalStatus(PKPU), dependents,
   payrollDependentAllowed, bank utama (sudah ada bankName/bankAccount di Employee — pindah
   ke sini saat migrasi), currency.
6. **Tax parameter**: `TaxBracket` (lower/upper/rateNPWP/rateNonNPWP/validFrom/To),
   `PayrollRegulation` (switch tahun aturan: biaya jabatan, JKK/JKM/JPK/JHT/JP rates,
   batas BPJS, TER enabled), `TerRate` (kategori A/B/C × rentang penghasilan).

### Fase P2 — Run Engine & Payslip (jantung sistem)
7. **`PayrollRun`** (periodId × processTypeId × sequence, status Draft→Calculated→
   Confirmed→Paid→Posted, calculateTax, allEmployee, timestamps, total).
8. **`PayrollRunLine`** (runId, employeeId, komponen snapshot, amount, PTKP status/value,
   bruto/deduction/netto per baris) + **`PayrollSlipHeader`** alias run-line dengan agregat:
   totalBruto, totalDeduction, taxRegular, taxIrregular, THP, actualNet/GrossTax (utk N2G),
   journalNo (nullable).
9. Kalkulasi: evaluator formula sederhana (parse ekspresi + variabel), prorata hari kerja,
   **PPh21 engine**: progressive bracket, TER opsional, pemisahan R/I, annualized, biaya
   jabatan 5% (cap), PTKP dari status, penalti non-NPWP; **BPJS engine**: JHT 3,7%/2%,
   JP 2%/1%, JKK, JKM, JPK 4%/1% dgn cap (dari PayrollRegulation).
10. **Payslip view** (per karyawan, ESS-style) + PDF/print, password opsional.

### Fase P3 — Input Transaksional
11. **`EmployeeComponentAssignment`** (specific & periodic; period×processType×component,
    nominal, basedDate).
12. **`EmployeeLoan`** + skedul amortisasi cicilan (installmentNo, amount, periodId,
    statusPaid) — potongan otomatis masuk run via wageCode mapping.
13. Integrasi ke **PersonnelAction** (SalaryAdjustment/Promotion → ubah EmployeeAssignment →
    memengaruhi run berikutnya; sudah tersambung via sourceDocNo).
14. **Increment massal** (effectiveDate, %/nominal, rounding, referenceLetter).

### Fase P4 — Rapel, Tahunan, Output
15. **Back pay**: run rapel (fromPeriod→toPeriod), komponen selisih (wageCodeBackPay).
16. **SPT tahunan** (`AnnualTaxSummary`): agregat 12 period, workingPeriod, R/I/Final income,
    tax paid, 1721-A1 printable; **ekspor CSV siap-upload Coretax** (bulanan/tahunan).
17. **Bank transfer file**: generator CSV/Excel per bank (mulai 2-3 bank umum: BCA, Mandiri,
    BNI), scope office×processType.
18. **Posting jurnal**: mapping `WageComponent`→(account D/K, cost center), `JournalEntry` +
    `JournalLine` dari run confirmed → status Posted.

### Fase P5 — Benefit & Lanjutan (opsional)
19. `BenefitType` + `BenefitClaim` (limit, auto-approve via engine approval, pay-in-payroll).
20. Service charge & simulasi gaji (kalau target pasar butuh).

### Catatan arsitektur
- Semua tabel hasil (run/line) menyimpan **snapshot** (nilai & label komponen saat proses) —
  histori tidak berubah saat master diubah (pola oranHR: golid/golversion = optimistic locking
  + audit; OneVity cukup pakai createdAt/updatedAt + ActivityLog).
- NetToGross dihitung iteratif (gross diproyeksikan dari net target) — catat actualNetTax &
  actualGrossTax seperti oranHR.
- Multi-office (Company Office) → di OneVity bisa dipetakan ke OrgUnit level tinggi; file bank
  bisa difilter per unit.
- Keamanan: batasi tampilan nominal gaji via AccessGroup role "Payroll" (enkripsi penuh ala
  oranHR = over-engineering utk OneVity tahap ini).

### Urutan kerja yang disarankan (bila disetujui)
P1 (schema + UI master period/processType/komponen upgrade) → P2 (engine + payslip + E2E
1 karyawan) → P3 → P4 → P5. Tiap fase diakhiri verifikasi browser + lint + commit.
