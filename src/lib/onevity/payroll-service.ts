// OneVity Payroll Service — orkestrasi server: merakit input engine (karyawan,
// komponen, regulasi, pinjaman) dan menyimpan hasil run ke database.
// Dipakai oleh API routes dan seed.
import { db } from "@/lib/db";
import {
  runPayroll, workingDaysBetween, EngineRow, EngineComponent, EngineBracket,
  EngineTer, EngineRegulation, EngineRunResult,
} from "@/lib/onevity/payroll-engine";
import { generateJournalForRun } from "@/lib/onevity/payroll-journal";

export async function getActiveRegulation(): Promise<EngineRegulation> {
  const r = await db.payrollRegulation.findFirst({ where: { active: true }, orderBy: { validFrom: "desc" } });
  if (!r) throw new Error("PayrollRegulation aktif tidak ditemukan — jalankan seed");
  return {
    biayaJabatanRate: r.biayaJabatanRate,
    biayaJabatanCapMonthly: r.biayaJabatanCapMonthly,
    jhtEmployeeRate: r.jhtEmployeeRate,
    jhtCompanyRate: r.jhtCompanyRate,
    jpEmployeeRate: r.jpEmployeeRate,
    jpCompanyRate: r.jpCompanyRate,
    jpSalaryCap: r.jpSalaryCap,
    jkkRate: r.jkkRate,
    jkmRate: r.jkmRate,
    jpkCompanyRate: r.jpkCompanyRate,
    jpkEmployeeRate: r.jpkEmployeeRate,
    jpkSalaryCap: r.jpkSalaryCap,
    nonNpwpSurcharge: r.nonNpwpSurcharge,
    useTer: r.useTer,
  };
}

export async function getBrackets(): Promise<EngineBracket[]> {
  const rows = await db.taxBracket.findMany({
    where: { bracketType: "Income", OR: [{ validTo: null }, { validTo: { gte: new Date() } }] },
    orderBy: { lowerLimit: "asc" },
  });
  return rows.map((b) => ({
    lowerLimit: b.lowerLimit,
    upperLimit: b.upperLimit,
    rateNpwp: b.rateNpwp,
    rateNonNpwp: b.rateNonNpwp,
  }));
}

export async function getTerRates(): Promise<EngineTer[]> {
  const rows = await db.terRate.findMany({ orderBy: [{ category: "asc" }, { lowerLimit: "asc" }] });
  return rows.map((t) => ({ category: t.category, lowerLimit: t.lowerLimit, upperLimit: t.upperLimit, rate: t.rate }));
}

function toEngineComponent(c: {
  code: string; name: string; type: string; wageType: string; calcMethod: string;
  amount: number; formula: string | null; incomeTaxMethod: string; prorated: boolean;
  includeInTHP: boolean; includeInBasicIncome: boolean; jamsostekBasis: string | null;
  roundingType: string; roundingValue: number;
}): EngineComponent {
  return {
    code: c.code, name: c.name, type: c.type, wageType: c.wageType, calcMethod: c.calcMethod,
    amount: c.amount, formula: c.formula, incomeTaxMethod: c.incomeTaxMethod, prorated: c.prorated,
    includeInTHP: c.includeInTHP, includeInBasicIncome: c.includeInBasicIncome,
    jamsostekBasis: c.jamsostekBasis, roundingType: c.roundingType, roundingValue: c.roundingValue,
  };
}

// Merakit baris input engine untuk satu run (period × processType).
// Komponen per karyawan = item template profil + komponen Periodic aktif +
// komponen Specific (period & processType cocok) + angsuran pinjaman jatuh tempo.
export async function buildRunRows(periodId: string, processTypeId: string): Promise<EngineRow[]> {
  const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");

  const [processType, profiles, components, templates, periodic, specific, loans] = await Promise.all([
    db.processType.findUnique({ where: { id: processTypeId } }),
    db.employeePayrollProfile.findMany({ where: { active: true }, include: { employee: true } }),
    db.wageComponent.findMany({ where: { active: true, OR: [{ validTo: null }, { validTo: { gte: period.startDate } }] } }),
    db.wageTemplate.findMany({ include: { items: { orderBy: { sortOrder: "asc" } } } }),
    db.employeeComponentAssignment.findMany({ where: { active: true, kind: "Periodic" } }),
    db.employeeComponentAssignment.findMany({
      where: { active: true, kind: "Specific", periodId, processTypeId },
    }),
    db.employeeLoan.findMany({
      where: { status: "Active" },
      include: { installments: { where: { status: "Pending" }, orderBy: { sequence: "asc" } } },
    }),
  ]);
  if (!processType) throw new Error("Process type tidak ditemukan");

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const templateByCode = new Map(templates.map((t) => [t.code, t]));

  // Assignment aktif semua karyawan (validTo null) + data employee.
  const activeEmployees = await db.employee.findMany({
    where: { status: "Active" },
    include: {
      assignments: {
        where: { validTo: null },
        include: { orgUnit: true, position: true },
        take: 1,
      },
      payrollProfile: true,
    },
    orderBy: { employeeNo: "asc" },
  });

  const specificByEmp = new Map<string, { wageComponentId: string; amount: number; notes: string | null }[]>();
  for (const s of specific) {
    const arr = specificByEmp.get(s.employeeId) ?? [];
    arr.push({ wageComponentId: s.wageComponentId, amount: s.amount, notes: s.notes });
    specificByEmp.set(s.employeeId, arr);
  }
  const periodicByEmp = new Map<string, { wageComponentId: string; amount: number }[]>();
  for (const p of periodic) {
    const arr = periodicByEmp.get(p.employeeId) ?? [];
    arr.push({ wageComponentId: p.wageComponentId, amount: p.amount });
    periodicByEmp.set(p.employeeId, arr);
  }
  const loansByEmp = new Map<string, typeof loans>();
  for (const l of loans) {
    const arr = loansByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    loansByEmp.set(l.employeeId, arr);
  }

  const workingDays = workingDaysBetween(period.startDate, period.endDate);
  const rows: EngineRow[] = [];

  for (const emp of activeEmployees) {
    const assignment = emp.assignments[0];
    if (!assignment) continue; // tidak punya penempatan aktif → dilewati
    const profile = emp.payrollProfile;
    const taxStatus = profile?.taxStatus ?? "TK0";
    const baseSalary = assignment.baseSalary;

    // Prorata: karyawan masuk di tengah period.
    const validFrom = new Date(assignment.validFrom);
    validFrom.setHours(0, 0, 0, 0);
    let prorateFactor = 1;
    if (validFrom > new Date(period.startDate)) {
      const totalDays = (new Date(period.endDate).getTime() - new Date(period.startDate).getTime()) / 86_400_000 + 1;
      const worked = (new Date(period.endDate).getTime() - validFrom.getTime()) / 86_400_000 + 1;
      prorateFactor = Math.max(0, Math.min(1, worked / Math.max(1, totalDays)));
      if (prorateFactor >= 0.999) prorateFactor = 1;
    }

    // Semantik multi-run (mengikuti oranHR): hanya run SALARY yang memproses
    // payroll penuh (template + periodic + pinjaman). Run THR/BONUS/TERMINATION/
    // YEAR_END_ADJ adalah run suplemental — hanya komponen Specific yang cocok
    // (period × processType) yang diproses, agar tidak terjadi pembayaran ganda.
    const isSalaryRun = processType.code === "SALARY";

    // Komponen dari template profil (fallback: template DEFAULT).
    const compList: { comp: EngineComponent; overrideAmount?: number }[] = [];
    const template = profile?.wageTemplateId
      ? (templateById.get(profile.wageTemplateId) ?? templateByCode.get("DEFAULT"))
      : templateByCode.get("DEFAULT");

    const seen = new Set<string>();
    if (isSalaryRun && template) {
      for (const item of template.items) {
        const c = components.find((x) => x.id === item.wageComponentId);
        if (!c || seen.has(c.code)) continue;
        seen.add(c.code);
        compList.push({ comp: toEngineComponent(c) });
      }
    }

    // Komponen Periodic (nilai tetap menimpa nilai formula/fixed) — hanya run salary.
    if (isSalaryRun) {
      for (const p of periodicByEmp.get(emp.id) ?? []) {
        const c = components.find((x) => x.id === p.wageComponentId);
        if (!c || seen.has(c.code)) continue;
        seen.add(c.code);
        compList.push({ comp: toEngineComponent(c), overrideAmount: p.amount });
      }
    }

    // Komponen Specific (one-off: bonus, THR, insentif period ini) — semua jenis run.
    for (const s of specificByEmp.get(emp.id) ?? []) {
      const c = components.find((x) => x.id === s.wageComponentId);
      if (!c) continue;
      if (seen.has(c.code)) {
        // komponen sama sudah masuk via template → timpa nilai utk run ini
        const existing = compList.find((x) => x.comp.code === c.code);
        if (existing) existing.overrideAmount = s.amount;
        continue;
      }
      seen.add(c.code);
      compList.push({ comp: toEngineComponent(c), overrideAmount: s.amount });
    }

    // Karyawan tanpa komponen apa pun pada run suplemental → dilewati.
    if (!isSalaryRun && compList.length === 0) continue;

    // Angsuran pinjaman jatuh tempo dalam period — hanya dipotong di run salary.
    const loanDues = isSalaryRun
      ? (loansByEmp.get(emp.id) ?? []).flatMap((l) => {
          const due = l.installments.find(
            (i) => i.status === "Pending" && new Date(i.dueDate) <= new Date(period.endDate)
          );
          if (!due) return [];
          return [{ loanId: l.id, letterNo: l.letterNo, installmentId: due.id, sequence: due.sequence, amount: due.amount }];
        })
      : [];

    rows.push({
      employee: {
        id: emp.id,
        employeeNo: emp.employeeNo,
        fullName: emp.fullName,
        orgUnitName: assignment.orgUnit?.name ?? null,
        positionName: assignment.position?.title ?? null,
        baseSalary,
        employmentStatus: assignment.employmentStatus,
        hasNpwp: profile?.hasNpwp ?? true,
        taxStatus,
        dependents: profile?.dependents ?? 0,
        processMethod: profile?.processMethod ?? "GrossToNet",
      },
      components: compList,
      loans: loanDues,
      workingDays,
      prorateFactor,
    });
  }

  return rows;
}

// Menjalankan kalkulasi dan menyimpan hasil (lines + items) ke run.
export async function calculateAndSaveRun(runId: string): Promise<EngineRunResult> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, processType: true },
  });
  if (!run) throw new Error("Run payroll tidak ditemukan");
  if (run.status === "Confirmed" || run.status === "Paid") {
    throw new Error("Run yang sudah dikonfirmasi/dibayar tidak dapat dihitung ulang");
  }

  const [reg, brackets, ter, rows] = await Promise.all([
    getActiveRegulation(),
    getBrackets(),
    getTerRates(),
    buildRunRows(run.periodId, run.processTypeId),
  ]);

  const result = runPayroll(rows, reg, brackets, ter, { calculateTax: run.calculateTax });

  // Simpan: hapus lines lama → tulis hasil baru (transaksional per line).
  await db.payrollRunLine.deleteMany({ where: { runId } });
  for (const line of result.lines) {
    const created = await db.payrollRunLine.create({
      data: {
        runId,
        employeeId: line.employeeId,
        employeeNo: line.employeeNo,
        employeeName: line.employeeName,
        orgUnitName: line.orgUnitName,
        positionName: line.positionName,
        ptkpStatus: line.ptkpStatus,
        ptkpValue: line.ptkpValue,
        bruto: line.bruto,
        deduction: line.deduction,
        taxRegular: line.taxRegular,
        taxIrregular: line.taxIrregular,
        net: line.net,
        actualNetTax: line.actualNetTax,
        notes: line.notes,
      },
    });
    if (line.items.length) {
      await db.payrollRunItem.createMany({
        data: line.items.map((it) => ({
          lineId: created.id,
          code: it.code, name: it.name, wageType: it.wageType, type: it.type,
          incomeTaxMethod: it.incomeTaxMethod, amount: it.amount, note: it.note, sortOrder: it.sortOrder,
        })),
      });
    }
  }

  await db.payrollRun.update({
    where: { id: runId },
    data: {
      status: "Calculated",
      employeeCount: result.lines.length,
      totalBruto: result.totalBruto,
      totalDeduction: result.totalDeduction,
      totalTax: result.totalTax,
      totalNet: result.totalNet,
      calculatedAt: new Date(),
    },
  });
  return result;
}

// Konfirmasi run: kunci hasil + apply angsuran pinjaman (status Deducted).
export async function confirmRun(runId: string): Promise<void> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { items: true } }, period: true },
  });
  if (!run) throw new Error("Run payroll tidak ditemukan");
  if (run.status !== "Calculated") throw new Error("Run harus berstatus Calculated sebelum dikonfirmasi");

  // Apply angsuran pinjaman: item LOAN pada tiap line → tandai installment Deducted.
  for (const line of run.lines) {
    const loanItems = line.items.filter((i) => i.wageType === "Loan");
    for (const item of loanItems) {
      // format item LOAN saat confirm: name "Angsuran Pinjaman {letterNo}", note "Cicilan ke-N"
      const loans = await db.employeeLoan.findMany({
        where: { employeeId: line.employeeId, status: "Active" },
        include: { installments: { where: { status: "Pending" }, orderBy: { sequence: "asc" } } },
      });
      const loan = loans.find((l) => item.name.includes(l.letterNo));
      if (!loan) continue;
      const seqMatch = item.note?.match(/ke-(\d+)/);
      const seq = seqMatch ? parseInt(seqMatch[1], 10) : null;
      const inst = loan.installments.find((i) => (seq != null ? i.sequence === seq : true));
      if (!inst) continue;
      await db.loanInstallment.update({
        where: { id: inst.id },
        data: { status: "Deducted", periodCode: run.period.code, deductedRunNo: run.runNo },
      });
      const paid = loan.paidAmount + inst.amount;
      const outstanding = Math.max(0, loan.outstanding - inst.amount);
      await db.employeeLoan.update({
        where: { id: loan.id },
        data: { paidAmount: paid, outstanding, status: outstanding <= 0 ? "PaidOff" : "Active" },
      });
    }
  }

  await db.payrollRun.update({
    where: { id: runId },
    data: { status: "Confirmed", confirmedAt: new Date() },
  });
  await db.payrollPeriod.update({
    where: { id: run.periodId },
    data: { status: "Processed", processDate: run.period.processDate ?? new Date() },
  });
  await db.activityLog.create({
    data: { action: "Confirmed", entity: "PayrollRun", entityId: runId, detail: `Run ${run.runNo} dikonfirmasi (${run.employeeCount} karyawan)` },
  });

  // Posting jurnal otomatis (P4) — idempotent; hasil run sudah dikunci aman.
  try {
    const journal = await generateJournalForRun(runId);
    await db.activityLog.create({
      data: { action: "Posted", entity: "PayrollRun", entityId: runId, detail: `Jurnal ${journal.journalNo} otomatis dibuat dari run ${run.runNo}` },
    });
  } catch (e) {
    // Posting gagal tidak boleh membatalkan konfirmasi — catat & bisa di-backfill manual.
    await db.activityLog.create({
      data: { action: "Error", entity: "PayrollRun", entityId: runId, detail: `Gagal posting jurnal: ${e instanceof Error ? e.message : "unknown"}` },
    });
  }
}

// Generate nomor run: PR-{period.code}-{typeCode3}-{seq}
export async function nextRunNo(periodCode: string, typeCode: string): Promise<string> {
  const prefix = `PR-${periodCode}-${typeCode.slice(0, 3).toUpperCase()}`;
  const count = await db.payrollRun.count({ where: { runNo: { startsWith: prefix } } });
  return `${prefix}-${String(count + 1).padStart(2, "0")}`;
}
