// OneVity Payroll Journal (P4) — posting jurnal otomatis dari run confirmed.
// Pattern "Transfer to Accounting" oranHR: Journal No/Type/Date melekat pada hasil
// payroll; tiap baris = snapshot akun + nominal + komponen asal.
//
// Struktur jurnal (selalu balance):
//   1. D Beban komponen THP (5101/5102, atau akun komponen)   / C 2101 Hutang Gaji
//   2. D 5103 BPJS Perusahaan (iuran perush.)                 / C 2103 Hutang BPJS
//   3. D 2101 Hutang Gaji (tiap potongan)                     / C 2102/2103/2104/2105
//   4. D 2101 Hutang Gaji (net / pembulatan)                  / C 1101 Kas & Bank
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { nextJournalNo } from "@/onevity/shared/lib/journal-no";

// Akun default (COA minimal seed) — kode komponen boleh menimpa via
// WageComponent.accountDebitCode / accountCreditCode (Salary Chart of Account).
export const JOURNAL_ACCOUNTS = {
  cash: { code: "1101", name: "Kas & Bank" },
  clearing: { code: "2101", name: "Hutang Gaji" },
  pph21: { code: "2102", name: "Hutang PPh 21" },
  bpjs: { code: "2103", name: "Hutang BPJS" },
  loan: { code: "2104", name: "Pinjaman Karyawan" },
  otherDed: { code: "2105", name: "Potongan Lain-lain" },
  salaryExp: { code: "5101", name: "Gaji & Upah" },
  allowanceExp: { code: "5102", name: "Tunjangan Karyawan" },
  bpjsExp: { code: "5103", name: "BPJS Perusahaan" },
} as const;

type Acc = { code: string; name: string };

// Akun beban untuk komponen Earning (fallback per wageType, dapat ditimpa akun komponen).
export function debitAccountFor(code: string, wageType: string, accountDebitCode: string | null): Acc {
  if (accountDebitCode) return { code: accountDebitCode, name: `Akun ${accountDebitCode}` };
  if (wageType === "Jamsostek") return JOURNAL_ACCOUNTS.bpjsExp;
  if (wageType === "BasicSalary" || wageType === "BackPay" || wageType === "THPRounding" || wageType === "IncomeTax")
    return JOURNAL_ACCOUNTS.salaryExp;
  return JOURNAL_ACCOUNTS.allowanceExp;
}

// Akun kewajiban untuk komponen Deduction (fallback per wageType, dapat ditimpa).
export function creditAccountFor(wageType: string, accountCreditCode: string | null): Acc {
  if (accountCreditCode) return { code: accountCreditCode, name: `Akun ${accountCreditCode}` };
  if (wageType === "Jamsostek") return JOURNAL_ACCOUNTS.bpjs;
  if (wageType === "IncomeTax") return JOURNAL_ACCOUNTS.pph21;
  if (wageType === "Loan") return JOURNAL_ACCOUNTS.loan;
  return JOURNAL_ACCOUNTS.otherDed;
}

interface JournalLineDraft {
  accountCode: string;
  accountName: string;
  position: "Debit" | "Credit";
  amount: number;
  memo: string;
  wageCode: string | null;
}

// Generate jurnal untuk satu run (idempotent — jika sudah ada, kembalikan yang ada).
// Dipanggil otomatis oleh confirmRun(); API backfill memakai fungsi ini untuk run lama.
export async function generateJournalForRun(db: TenantDb, runId: string) {
  const existing = await db.payrollJournal.findUnique({
    where: { runId },
    include: { lines: { orderBy: { sequence: "asc" } } },
  });
  if (existing) return existing;

  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: {
      period: true,
      processType: true,
      lines: { include: { items: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!run) throw new Error("Run payroll tidak ditemukan");
  if (run.status !== "Confirmed" && run.status !== "Paid") {
    throw new Error("Jurnal hanya dapat dibuat untuk run yang dikonfirmasi/dibayar");
  }

  // Salary Chart of Account per komponen (menimpa fallback wageType).
  const comps = await db.wageComponent.findMany({ select: { code: true, accountDebitCode: true, accountCreditCode: true } });
  const compMap = new Map(comps.map((c) => [c.code, c]));

  // Agregat nilai per komponen (urutan menstabil: map insertion by sortOrder pertama).
  const agg = new Map<string, { code: string; name: string; wageType: string; type: string; total: number }>();
  for (const line of run.lines) {
    for (const item of line.items) {
      if (item.type === "Informational") continue; // komponen informasi tidak dijurnal
      const cur = agg.get(item.code) ?? { code: item.code, name: item.name, wageType: item.wageType, type: item.type, total: 0 };
      cur.total += item.amount;
      agg.set(item.code, cur);
    }
  }

  const drafts: JournalLineDraft[] = [];
  let thpEarnings = 0; // total earning masuk THP (→ clearing)
  let bpjsCompany = 0; // iuran perusahaan (→ hutang BPJS langsung)
  let totalDeductions = 0;
  let seq = 1;

  // 1. Earnings.
  for (const c of agg.values()) {
    if (c.type !== "Earning") continue;
    const amount = Math.round(c.total);
    if (amount === 0) continue;
    const mapping = compMap.get(c.code);
    if (c.wageType === "Jamsostek" && !mapping?.accountDebitCode) {
      // Iuran JSTK ditanggung perusahaan: beban ↔ hutang BPJS (tidak lewat THP).
      bpjsCompany += amount;
      const acc = debitAccountFor(c.code, c.wageType, mapping?.accountDebitCode ?? null);
      drafts.push({ accountCode: acc.code, accountName: acc.name, position: "Debit", amount, memo: `${c.name} (${run.employeeCount} karyawan)`, wageCode: c.code });
      drafts.push({ accountCode: JOURNAL_ACCOUNTS.bpjs.code, accountName: JOURNAL_ACCOUNTS.bpjs.name, position: "Credit", amount, memo: `Hutang iuran perusahaan — ${c.name}`, wageCode: c.code });
      seq += 2;
    } else {
      thpEarnings += amount;
      const acc = debitAccountFor(c.code, c.wageType, mapping?.accountDebitCode ?? null);
      drafts.push({ accountCode: acc.code, accountName: acc.name, position: "Debit", amount, memo: `${c.name} (${run.employeeCount} karyawan)`, wageCode: c.code });
      seq += 1;
    }
  }

  // 2. Hutang Gaji (clearing) = total earning THP.
  thpEarnings = Math.round(thpEarnings);
  if (thpEarnings > 0) {
    drafts.push({ accountCode: JOURNAL_ACCOUNTS.clearing.code, accountName: JOURNAL_ACCOUNTS.clearing.name, position: "Credit", amount: thpEarnings, memo: `Akumulasi gaji & tunjangan — ${run.runNo}`, wageCode: null });
  }

  // 3. Potongan: hutang gaji (D) ↔ kewajiban spesifik (C).
  for (const c of agg.values()) {
    if (c.type !== "Deduction") continue;
    const amount = Math.round(c.total);
    if (amount === 0) continue;
    totalDeductions += amount;
    const mapping = compMap.get(c.code);
    const acc = creditAccountFor(c.wageType, mapping?.accountCreditCode ?? null);
    drafts.push({ accountCode: JOURNAL_ACCOUNTS.clearing.code, accountName: JOURNAL_ACCOUNTS.clearing.name, position: "Debit", amount, memo: `Potongan ${c.name}`, wageCode: c.code });
    drafts.push({ accountCode: acc.code, accountName: acc.name, position: "Credit", amount, memo: `${c.name} — ${run.period.name}`, wageCode: c.code });
  }

  // 4. Pembayaran net dari hutang gaji ke kas/bank + baris pembulatan penyeimbang.
  const netPaid = Math.round(run.lines.reduce((s, l) => s + l.net, 0));
  const diff = thpEarnings - Math.round(totalDeductions) - netPaid; // selisih pembulatan per baris
  if (Math.abs(diff) >= 1) {
    drafts.push({
      accountCode: JOURNAL_ACCOUNTS.clearing.code, accountName: JOURNAL_ACCOUNTS.clearing.name,
      position: diff > 0 ? "Credit" : "Debit", amount: Math.abs(Math.round(diff)),
      memo: "Pembulatan pembayaran (rounding)", wageCode: null,
    });
  }
  if (netPaid > 0) {
    drafts.push({ accountCode: JOURNAL_ACCOUNTS.clearing.code, accountName: JOURNAL_ACCOUNTS.clearing.name, position: "Debit", amount: netPaid, memo: `Pembayaran THP — ${run.period.name}`, wageCode: null });
    drafts.push({ accountCode: JOURNAL_ACCOUNTS.cash.code, accountName: JOURNAL_ACCOUNTS.cash.name, position: "Credit", amount: netPaid, memo: `Transfer gaji ${run.runNo} (${run.employeeCount} karyawan)`, wageCode: null });
  }

  const totalDebit = drafts.filter((d) => d.position === "Debit").reduce((s, d) => s + d.amount, 0);
  const totalCredit = drafts.filter((d) => d.position === "Credit").reduce((s, d) => s + d.amount, 0);
  if (Math.abs(totalDebit - totalCredit) > 0) {
    throw new Error(`Jurnal tidak balance: D ${totalDebit} vs C ${totalCredit}`);
  }

  // Nama akun actual dari COA (menimpa nama default bila akun terdaftar).
  const accounts = await db.account.findMany({ include: { accountGroup: true } });
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));
  for (const d of drafts) {
    const acc = accountByCode.get(d.accountCode);
    if (acc) d.accountName = acc.name;
  }

  const journalNo = await nextJournalNo(db);
  const journal = await db.payrollJournal.create({
    data: {
      journalNo,
      journalDate: run.confirmedAt ?? new Date(),
      runId: run.id,
      runNo: run.runNo,
      description: `Payroll ${run.processType.name} — ${run.period.name} (${run.runNo}) · ${run.employeeCount} karyawan · THP Rp ${Math.round(run.totalNet).toLocaleString("id-ID")}`,
      totalDebit,
      totalCredit,
      status: "Posted",
      lines: {
        create: drafts.map((d, i) => ({
          sequence: i + 1,
          accountCode: d.accountCode,
          accountName: d.accountName,
          position: d.position,
          amount: d.amount,
          memo: d.memo,
          wageCode: d.wageCode,
        })),
      },
    },
    include: { lines: { orderBy: { sequence: "asc" } } },
  });

  // Update saldo COA: aset/beban naik saat D, kewajiban naik saat C.
  const accTypeByCode = new Map(accounts.map((a) => [a.code, a.accountGroup?.accountType ?? null]));
  for (const d of drafts) {
    const at = accTypeByCode.get(d.accountCode);
    if (!at) continue;
    const isDebitNatural = at === "Asset" || at === "Expense";
    const delta = d.position === "Debit" ? d.amount : -d.amount;
    await db.account.update({
      where: { code: d.accountCode },
      data: { balance: { increment: isDebitNatural ? delta : -delta } },
    });
  }

  await db.activityLog.create({
    data: {
      action: "Posted", entity: "PayrollJournal", entityId: journal.id,
      detail: `Jurnal ${journalNo} dibuat dari run ${run.runNo} (D = C = Rp ${totalDebit.toLocaleString("id-ID")})`,
    },
  });
  return journal;
}
