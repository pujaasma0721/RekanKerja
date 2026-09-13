// RESTORE-MII-PAYROLL-MONEY (Task 57) — pemulihan data uang tenant MII ======
// ===========================================================================
// Konteks insiden: bug migrasi (migrate-encrypt.ts filter `NOT LIKE 'enc:v1%'`)
// menimpa SELURUH kolom uang wave 28-c tenant ber-vault menjadi 0 saat parity
// rerun (13 Sep 2026 04:00 UTC — log "126 baris dienkripsi"). MII satu-satunya
// tenant ber-vault → satu-satunya korban. Fix akar bug sudah ada di
// migrate-encrypt.ts / migrate-encrypt-money.ts (skip `enc:%`).
//
// Skrip ini memulihkan nilai dari SUMBER YANG MASIH UTUH (dapat di-reason):
//   1. EmployeeAssignment.baseSalary — seed mengisi RANDOM per grade
//      (G1 4.5-7jt … G8 50-80jt, kelipatan 50rb); nilai asli tak dapat
//      direkonstruksi → diisi ulang angka realistis per grade (deterministik
//      per baris — PRNG di-seed id assignment) + multiplier mutasi historis
//      (PA-2022-010x) sesuai seed.
//   2. EmployeeComponentAssignment.amount — nilai seed diketahui eksplisit:
//      BONUS Q3 SEP (MII00004 2.5jt / MII00009 1.5jt / MII00014 3jt) +
//      TTRANS (MII00021 1jt). Baris lain bernilai 0 sah (settlement) dibiarkan.
//   3. PayrollRun JUL/AGU 2026 (Paid) — dihitung ULANG via engine payroll
//      sungguhan (calculateAndSaveRun + confirmRun): RunLine/RunItem/totals +
//      jurnal terisi konsisten dengan data master yang baru. Jurnal lama yang
//      isinya 0 dihapus dulu (generateJournalForRun idempoten per runId).
//      Run SEP tetap Draft (demo interaktif — dihitung user via UI).
// Kolom M-8 (loan/benefit/travel/medical), PII, jurnal settlement 12 Sep —
// TIDAK tersentuh (terverifikasi utuh oleh diag Task 57).
//
// IDEMPOTEN & CRASH-SAFE: hanya baris bernilai 0 yang ditulis; run hanya
// diproses bila status ≠ Paid ATAU totalNet-nya 0; rerun setelah sukses =
// no-op penuh. Didaftarkan sebagai parity step (self-heal, konvensi K-6).
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { getTenantClient } from "../src/onevity/shared/lib/tenant-db";
import { primeTenantCrypto, tenantCrypto } from "../src/onevity/shared/lib/field-crypto";
import { calculateAndSaveRun, confirmRun } from "../src/onevity/payroll/services/payroll-service";

const MII = "tenant_pt_mitra_industri_internasional";

// Rentang gaji per grade — persis prisma/seed.ts (empGradeSalary).
const GRADES: Record<string, [number, number]> = {
  G1: [4_500_000, 7_000_000], G2: [6_500_000, 10_000_000], G3: [9_000_000, 14_000_000],
  G4: [13_000_000, 19_000_000], G5: [18_000_000, 28_000_000], G6: [25_000_000, 38_000_000],
  G7: [35_000_000, 52_000_000], G8: [50_000_000, 80_000_000],
};
// Multiplier riwayat penempatan (seed historyDefs, sourceDocNo → salaryMult).
const DOC_MULT: Record<string, number> = {
  "PA-2022-0101": 1.18, "PA-2022-0102": 1.0, "PA-2022-0103": 1.12, "PA-2022-0104": 1.05,
};
// Nilai komponen seed yang diketahui eksplisit (employeeNo|kode → nominal).
const SEED_COMP: Record<string, number> = {
  "MII00004|BONUS": 2_500_000, "MII00009|BONUS": 1_500_000, "MII00014|BONUS": 3_000_000,
  "MII00021|TTRANS": 1_000_000,
};

/** PRNG deterministik per string (mulberry32 + FNV-1a seed) — rerun konsisten. */
function rngFor(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const round50k = (n: number) => Math.round(n / 50_000) * 50_000;

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? [MII];
  if (!list.includes(MII)) return;
  const db = getTenantClient(MII);
  try {
    // kunci vault (enc:v2) harus termuat sebelum menulis nilai baru
    await primeTenantCrypto(MII);
    const tc = tenantCrypto(MII);
    const vault = await db.moneyVault.findFirst();
    if (!vault) {
      console.log("[restore-mii] tenant tanpa MoneyVault — tidak ada yang perlu dipulihkan");
      return;
    }

    // ---- 1. baseSalary: hanya baris yang dekripsinya 0 ----
    const assigns = await db.employeeAssignment.findMany({
      select: { id: true, gradeId: true, baseSalary: true, sourceDocNo: true },
    });
    const gradeCode = new Map((await db.grade.findMany({ select: { id: true, code: true } })).map((g) => [g.id, g.code]));
    let fixedSal = 0;
    for (const a of assigns) {
      if (a.baseSalary == null || a.baseSalary === "") continue;
      const cur = tc.decryptMoney(a.baseSalary);
      if (cur != null && cur !== 0) continue; // utuh / sudah dipulihkan
      const range = a.gradeId ? GRADES[gradeCode.get(a.gradeId) ?? ""] : undefined;
      if (!range) continue; // tanpa grade — biarkan (bukan data seed)
      const mult = a.sourceDocNo ? (DOC_MULT[a.sourceDocNo] ?? 1) : 1;
      const val = round50k(round50k(range[0] + rngFor(a.id)() * (range[1] - range[0])) * mult);
      await db.employeeAssignment.update({ where: { id: a.id }, data: { baseSalary: tc.encryptMoney(val) } });
      fixedSal++;
    }
    console.log(`[restore-mii] baseSalary dipulihkan: ${fixedSal} dari ${assigns.length} baris penempatan`);

    // ---- 2. komponen assignment bernilai seed eksplisit ----
    const empNo = new Map((await db.employee.findMany({ select: { id: true, employeeNo: true } })).map((e) => [e.id, e.employeeNo]));
    const compRows = await db.employeeComponentAssignment.findMany({ include: { wageComponent: { select: { code: true } } } });
    let fixedComp = 0;
    for (const ca of compRows) {
      if (ca.amount == null || ca.amount === "") continue;
      const cur = tc.decryptMoney(ca.amount);
      if (cur != null && cur !== 0) continue;
      const val = SEED_COMP[`${empNo.get(ca.employeeId) ?? ""}|${ca.wageComponent.code}`];
      if (!val) continue; // bukan komponen seed (mis. settlement 0 sah) — biarkan
      await db.employeeComponentAssignment.update({ where: { id: ca.id }, data: { amount: tc.encryptMoney(val) } });
      fixedComp++;
    }
    console.log(`[restore-mii] komponen assignment dipulihkan: ${fixedComp}`);

    // ---- 3. hitung ulang run JUL & AGU (engine sungguhan) ----
    for (const runNo of ["PR-2026-07-SAL-01", "PR-2026-08-SAL-01"]) {
      const run = await db.payrollRun.findFirst({ where: { runNo } });
      if (!run) { console.log(`[restore-mii] ${runNo} tidak ditemukan — lewati`); continue; }
      const netVal = run.totalNet ? tc.decryptMoney(run.totalNet) : null;
      if (run.status === "Paid" && netVal != null && netVal !== 0) {
        continue; // sudah dipulihkan / memang utuh
      }
      // jurnal lama (isinya 0) dihapus agar ter-generate ulang saat confirm
      const j = await db.payrollJournal.findUnique({ where: { runId: run.id } });
      if (j) {
        await db.payrollJournalLine.deleteMany({ where: { journalId: j.id } });
        await db.payrollJournal.delete({ where: { id: j.id } });
      }
      // Rollback buku pinjaman yang pernah dipotong run ini (M-8 terenkripsi):
      // angsuran Deducted oleh run tsb → kembalikan paid/outstanding + status
      // Pending agar recalc memasukkan kembali item LOAN dan confirmRun
      // memotong ulang SEKALI — buku pinjaman tidak berubah netto.
      const deducted = await db.loanInstallment.findMany({
        where: { deductedRunNo: run.runNo, status: "Deducted" },
        include: { loan: true },
      });
      for (const inst of deducted) {
        const amt = tc.decryptMoney(inst.amount) ?? 0;
        const paid = (tc.decryptMoney(inst.loan.paidAmount) ?? 0) - amt;
        const out = (tc.decryptMoney(inst.loan.outstanding) ?? 0) + amt;
        // M-8: kolom buku pinjaman NOT NULL — encryptMoney non-null (polanya
        // sama dgn encLoan di confirmRun).
        await db.employeeLoan.update({
          where: { id: inst.loanId },
          data: {
            paidAmount: tc.encryptMoney(Math.max(0, paid)) ?? "0",
            outstanding: tc.encryptMoney(out) ?? "0",
            status: "Active",
          },
        });
        await db.loanInstallment.update({ where: { id: inst.id }, data: { status: "Pending", periodCode: null, deductedRunNo: null } });
        console.log(`[restore-mii] rollback angsuran ${inst.loan.letterNo} #${inst.sequence} (${amt}) → Pending`);
      }
      await db.payrollRun.update({ where: { id: run.id }, data: { status: "Draft" } });
      await calculateAndSaveRun(db, run.id);
      await confirmRun(db, run.id);
      const paidAt = runNo.includes("2026-07") ? new Date(2026, 6, 28) : new Date(2026, 7, 28);
      await db.payrollRun.update({ where: { id: run.id }, data: { status: "Paid", paidAt } });
      console.log(`[restore-mii] ${runNo} dihitung ulang (engine) & dikonfirmasi Paid`);
    }
    console.log("[restore-mii] selesai — idempoten (rerun = no-op)");
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("restore-mii-payroll-money.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
