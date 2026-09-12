// Registry SEMUA kolom terenkripsi OneVity (satu sumber kebenaran).
// Dipakai engine re-enkripsi vault (scripts/migrate-rekey-vault.ts) untuk
// "ganti kata sandi = decrypt semua data lalu encrypt ulang dengan kunci baru".
//
// [table, column, kind] — kind "n" = angka uang, "t" = teks identitas (PII).
// Gabungan dua gelombang migrasi:
//   · wave 28-c (migrate-encrypt.ts)  — 16 kolom uang payroll + 5 PII identitas
//   · wave M-8  (migrate-encrypt-money.ts) — 38 kolom uang modul claim
// Kolom config/master (routing approval, katalog komponen upah, bracket
// pajak, dsb.) TIDAK termasuk — bukan data personal karyawan.
export const ENCRYPTED_COLUMNS: [string, string, "t" | "n"][] = [
  // ==== wave 28-c — payroll money ====
  ["PayrollRun", "totalBruto", "n"],
  ["PayrollRun", "totalDeduction", "n"],
  ["PayrollRun", "totalTax", "n"],
  ["PayrollRun", "totalNet", "n"],
  ["PayrollRunLine", "bruto", "n"],
  ["PayrollRunLine", "deduction", "n"],
  ["PayrollRunLine", "taxRegular", "n"],
  ["PayrollRunLine", "taxIrregular", "n"],
  ["PayrollRunLine", "net", "n"],
  ["PayrollRunLine", "actualNetTax", "n"],
  ["PayrollRunItem", "amount", "n"],
  ["PayrollJournal", "totalDebit", "n"],
  ["PayrollJournal", "totalCredit", "n"],
  ["PayrollJournalLine", "amount", "n"],
  ["EmployeeAssignment", "baseSalary", "n"],
  ["EmployeeComponentAssignment", "amount", "n"],
  // ==== wave 28-c — PII identitas ====
  ["Employee", "nationalId", "t"],
  ["Employee", "taxId", "t"],
  ["Employee", "bankAccount", "t"],
  ["EmployeePayrollProfile", "npwp", "t"],
  ["EmployeePayrollProfile", "bankAccount", "t"],
  // ==== wave M-8 — claim: loan ====
  ["EmployeeLoan", "amount", "n"],
  ["EmployeeLoan", "installmentAmount", "n"],
  ["EmployeeLoan", "paidAmount", "n"],
  ["EmployeeLoan", "outstanding", "n"],
  ["LoanInstallment", "amount", "n"],
  // ==== wave M-8 — claim: benefit ====
  ["BenefitClaim", "amount", "n"],
  ["BenefitClaim", "approvedAmount", "n"],
  ["BenefitClaim", "limitUsed", "n"],
  ["BenefitClaim", "limitRemaining", "n"],
  // ==== wave M-8 — claim: leave encashment ====
  ["LeaveEncashment", "amount", "n"],
  // ==== wave M-8 — claim: medical ====
  ["MedicalBalance", "benefitAmount", "n"],
  ["MedicalBalance", "adjustmentAmount", "n"],
  ["MedicalBalance", "initialUsed", "n"],
  ["MedicalBalance", "usedAmount", "n"],
  ["MedicalBalance", "depBenefitAmount", "n"],
  ["MedicalBalance", "depAdjustment", "n"],
  ["MedicalBalance", "depUsed", "n"],
  ["MedicalBalance", "carriedOver", "n"],
  ["MedicalClaim", "maxBenefitAt", "n"],
  ["MedicalClaim", "usedAt", "n"],
  ["MedicalClaim", "totalBill", "n"],
  ["MedicalClaim", "totalReimburse", "n"],
  ["MedicalClaim", "totalApproved", "n"],
  ["MedicalClaim", "totalNonRe", "n"],
  ["MedicalClaimLine", "billAmount", "n"],
  ["MedicalClaimLine", "reimburseAmount", "n"],
  ["MedicalClaimLine", "approvedAmount", "n"],
  ["MedicalClaimLine", "nonReAmount", "n"],
  ["MedicalAdjustment", "amount", "n"],
  // ==== wave M-8 — claim: travel ====
  ["TravelClaim", "otherCompanyExp", "n"],
  ["TravelClaim", "exchangeLoss", "n"],
  ["TravelClaim", "payableEmployee", "n"],
  ["TravelClaim", "payableCompany", "n"],
  ["TravelClaim", "totalSettlement", "n"],
  ["TravelClaimExpense", "amount", "n"],
  ["TravelAdvance", "amount", "n"],
  ["TravelBudget", "totalBudget", "n"],
  ["TravelBudgetItem", "amount", "n"],
];
