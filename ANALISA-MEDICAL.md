# ANALISA-MEDICAL — Modul Medical Benefit oranHR → RekanKerja

> Task 21 · Sumber: eksplorasi live `https://demo.oranhr.com/` (login MII000001/MII1,
> presenter ExtJS dibaca langsung dari `var APPJSON` tiap halaman + data grid nyata).
> Modul terakhir dari 6 modul RekanKerja (HR · Payroll · Attendance · Leave · Travel · **Medical**).

---

## 1. Peta Halaman oranHR (12 halaman + 3 ESS)

Modul **Medical Benefit** di navigasi oranHR punya 4 cabang:

| # | Halaman (JSP) | Presenter | Isi nyata di MII demo |
|---|---|---|---|
| 1 | `MedicalBenefitInformation.jsp` — Employee Medical Information | `medical.process.EmployeeMedicalBenefitInformationPres` | Lister karyawan × period (54 baris 2026); filter "Based on Period" tahun; zoom » ke Employee Working Info |
| 2 | `MedicalBenefitClaim.jsp` — Medical Claim | `medical.transaction.MedicalBenefitClaimPres` | 52 klaim; header snapshot Max Benefit/Used/Balance; detail baris per perawatan; tab Claim Information + Status Log |
| 3 | `MedicalBenefitClaimToApprove.jsp` — Medical Claim Approval | `medical.transaction.MedicalBenefitClaimToApprovePres` | Antrean klaim status Submitted (4 di demo); Operation sama |
| 4 | `MedicalBenefitAdjustment.jsp` — Medical Adjustment | `medical.transaction.MedicalBenefitAdjustmentPres` | 8 penyesuaian (Employee/Dependent Adjustment Amount + period + jenis + tanggal + catatan) |
| 5 | `MedicalBenefitAdjustmentToApprove.jsp` — Medical Adjustment Approval | — | Antrean adjustment Submitted |
| 6 | `MedicalBenefitSummaryType.jsp` — Summary by Benefit Type | `medical.transaction.MedicalBenefitSummaryTypeMasterPres` | Drill-down per jenis (12 jenis) |
| 7 | `MedicalBenefitSummaryEmployee.jsp` — Summary by Employee | — | Rekap klaim per karyawan |
| 8 | `MedicalBenefitAdjustmentEmp.jsp` — Adjustment by Employee | — | Riwayat penyesuaian per karyawan |
| 9 | `GenerateMedicalBenefitInfo.jsp` — Generate Employee Medical Info | `medical.process.GenerateMedicalBenefitInfoPres` | Parameter: Period* + Medical Benefit Type + "Benefit Limit Correction" + All Employee / Specific Employee(s) + Process |
| 10 | `MedicalBenefitTypeDetail.jsp` — Medical Benefit Type | `medical.general.MedicalBenefitTypeDetailPres` | Master 12 jenis; ±60 atribut (lihat §2) |
| 11 | `Hospital.jsp` + `InsuranceCompany.jsp` | `medical.general.HospitalPres` / `InsuranceCompanyPres` | Master identik (Name/Address/City/State/Postal/Country) — kosong di demo MII |
| 12 | `InitialMedicalBenefit.jsp` — Initial Employee Medical Info | `medical.general.InitialMedicalBenefitPres` | Saldo used awal dibawa periode (emp_used + dep_used, 2 baris demo) |
| ESS | `MyMedicalBenefitInformation.jsp` / `MyMedicalExpenseClaim.jsp` / `MyMedicalExpenseClaimHistory.jsp` | `medical.myorange.*` | Wizard klaim ESS + info saldo pribadi |

### Status & operasi nyata
- **Klaim**: `Created (Prepared) → Submitted → Approved → Settled` (+ Rejected/Cancelled).
  Operation ListerMenu: **Submit | Return To Requester | Approve | Reject | Cancel | Settle** — semua minta "Enter Reason".
  Status Log tercatat per perubahan (status, timestamp detik, user).
- **Adjustment**: `Submitted → Approved` (+ Reject/Cancel). Operation: **Approve | Reject | Cancel**.
- Dashboard HR: "Approval - 5 Medical Adjustment", "Approval - 15 Medical Claim".

---

## 2. Medical Benefit Type (master, 60+ atribut → 20 atribut kunci)

Nilai nyata MII (12 jenis): RAWAT INAP, RAWAT_JALAN, GLASSES, KACAMATA, KACAMATA NEW,
MEDICAL, GIGI & MULUT, IMUNISASI, IMUNISASI2, + 3 lain.

Contoh terbaca **RAWAT INAP** (form):
- Max Claim in 1 × period; Frequency: Value 2 / **Year Period** ("sekali dalam setiap X tahun")
- Reimbursement Employee: Paid By **Company 100%** (atauInsurance % + nama asuransi)
- Total Amount: **Unlimited | Nominal Value | factor × Basic Salary** — RAWAT INAP = 1 × gaji
  atau komponen upah **MEDICAL_KL** (Wage Name "MEDICAL KL")
- Base on Employee Characteristics: Employment Type/Status/Remuneration/Company Office/
  Position Grade/Employee Grade/Specific Employee/Age/Service Year/Service Group (semua
  checkbox — segmentasi penerima benefit)
- Max Claim Amount: Nominal / Based On Salary Component
- Settlement Rule: `MEDICAL` → "Medical Claim"
- **Unused Balance will be**: Forfeited (reset periode berikut) | Paid to employee in cash
  at end of period **with Wage Code** | Added to following period with Max Carry Over
- Dependent: No of Dependent **2**, Max Child Age **21**, Paid By Company 100%,
  Dependent Benefit Limit: *Included in Employee's* | *total for all dependents* | *each dependent*

Snapshot saldo klaim nyata (Max Benefit / Used / Balance):
- RAWAT INAP MII000001: 12.000.000 / 250.000 / 11.750.000 (≈ factor × gaji)
- RAWAT_JALAN MII000001: 24.960.572 / 1.000.000 / 23.960.572
- GLASSES MII000001: 1.500.000 / 1.000.000 / 500.000

---

## 3. Struktur data klaim

**Header** (`MedicalBenefitClaim`): company, employee, letter_no (surat rujukan),
claim_date, state, period_id, medical_type_name, valid_from, **snapshot**
max_benefit_amount / used_amount / balance_amount, payment_date (settlement),
journal_no/type/date, total_amount_on_bill, total_re_amount, total_approved_amount,
total_non_re_amount.

**Baris perawatan** (Claim Information tab + wizard ESS): treated_id/treated_name
(karyawan atau anggota keluarga), receipt_no, treatment (diagnosa/perawatan),
treatment_date, occupational_injury (bool — PJK/kecelakaan kerja), file_name (bukti),
amount_on_bill, re_amount, approved_amount, non_re_amount, currency,
physician_name, hospital_name, note.

**Formula**: `Total Approved` menjumlah baris approved; `Non Re` = bill − re (atau
bagian ditolak). Saldo karyawan berkurang sebesar approved saat Settled (used bertambah).

---

## 4. Keputusan Desain RekanKerja (12 halaman → 8 view)

| View RekanKerja | Padanan oranHR |
|---|---|
| `medical-overview` (Ringkasan) | dashboard modul + KPI |
| `medical-info` (Saldo Medis Karyawan) | Employee Medical Information + Generate Employee Medical Info + Initial + My Medical Information |
| `medical-claim` (Klaim Medis) | Medical Claim (form + baris perawatan) |
| `medical-approval` (Persetujuan & Settlement) | Medical Claim Approval + Operation Settle + journal |
| `medical-adjustment` (Penyesuaian Saldo) | Medical Adjustment + Medical Adjustment Approval |
| `medical-benefit-type` (Jenis Benefit) | Medical Benefit Type (General Setting) |
| `medical-providers` (Rumah Sakit & Asuransi) | Hospital + Insurance Company (2 halaman → 1 view 2 tab) |
| `medical-reports` (Laporan Medis) | MedicalBenefitSummaryType + SummaryEmployee + AdjustmentEmp (3 laporan → 1 view) |

Simplifikasi sadar (dicatat backlog): ESS mobile wizard, file attachment storage,
segmentasi 10 karakteristik, exchange multi-currency, partially-approved.

### Model data (6 model Prisma baru)
- `MedicalBenefitType` — kebijakan limit (UNLIMITED/NOMINAL/FACTOR/WAGE_COMPONENT),
  frekuensi, kebijakan saldo tak terpakai (FORFEITED/CASH/CARRY + cashWageCode +
  maxCarryOver), persentase company/insurance, kebijakan dependent, needReceipt.
- `MedicalProvider` — hospital + insurance (kind HOSPITAL|INSURANCE).
- `MedicalBalance @@unique[employeeId,typeId,year]` — benefit/adjustment/initialUsed/
  used × (employee + dependent), snapshot generate.
- `MedicalClaim` — docNo MC-YYYY-NNN, snapshot saldo, totals, status log array JSON,
  journalNo, periodCode + paidRunNo (payroll).
- `MedicalClaimLine` — perawatan (treated, diagnosa, tanggal, receipt, physician,
  hospital, CK/KK, bill/re/approved/nonRe).
- `MedicalAdjustment` — docNo MA-YYYY-NNN, ± amount (employee/dependent), status.

### Alur end-to-end
1. Master: jenis benefit (limit factor × gaji pokok / nominal), provider.
2. Generate saldo per tahun → hitung limit dari gaji aktif (assignment) + prorata
   opsional + carry-over (jika CARRY).
3. Klaim: pilih karyawan + jenis → tampil snapshot limit/used/balance → baris
   perawatan (bill, reimbursement, approved, nonRe) → validasi saldo & frekuensi → Submit.
4. Approval: Approve (dengan alasan) → Reject/Cancel.
5. Settle: jurnal otomatis (Debit 5106 Beban Medis per jenis / Credit 1101 Kas,
   pola klaim travel) + settleDate + used bertambah.
6. Penyesuaian: ± saldo karyawan (employee/dependent) dengan approval.
7. Payroll: jenis dengan unusedRule CASH → **Tarik Sisa Saldo** akhir tahun →
   ComponentAssignment Specific komponen **UMC** (Earning Compensation) → Paid saat
   run dikonfirmasi (`markMedicalPaidForRun`).
8. Laporan: rekap per jenis/karyawan + rentang klaim.

### Regulasi & praktik Indonesia
- BPJS Kesehatan adalah dasar; benefit medis perusahaan = pelengkap (reimbursement
  rawat inap/jalan, kacamata, gigi, persalinan, imunisasi anak).
- Limit klasik: rawat inap ≈ 1×gaji/tahun; rawat jalan nominal/kapasitas; kacamata
  1× per 1-2 tahun (freq Year Period — persis konsep oranHR).
- Dependent: pasangan + max 2 anak (batas usia 21/25 th) — dipakai limit bersama
  (Shared) atau terpisah.

---

## 5. Roadmap implementasi

- **M1** Prisma 6 model + DDL + migrasi 3 tenant (pola migrate-travel.ts).
- **M2** provisioning `ensureMedicalReference`: 12 jenis (RAWAT INAP factor 1×gaji,
  RAWAT_JALAN nominal 25 jt, GIGI & MULUT 5 jt, GLASSES 1,5 jt 1×/2th, KACAMATA,
  MEDICAL, IMUNISASI, PERSALINAN, KHUSUS…) + akun 5106 + komponen UMC.
- **M3** `medical-service.ts`: generateBalances (limit dari gaji aktif), previewClaim
  (snapshot + sisa), submitClaim (baris + validasi saldo/frekuensi), decideClaim
  (approve/reject/cancel), settleClaim (jurnal + used bertambah + idempoten),
  adjustment ±, transferUnused (→ UMC payroll), markMedicalPaidForRun, reports, stats.
- **M4** API routes ×7: overview, types, providers, balances, claims, adjustments, reports.
- **M5** UI 8 view Bahasa Indonesia (aksen teal/rose — beda dari travel oranye).
- **M6** Seed: MII 2026 saldo 42 karyawan × jenis + klaim bervariasi status + adjustment;
  Cahaya/Sentra master saja.
- **M7** E2E + lint + worklog + commit push.
