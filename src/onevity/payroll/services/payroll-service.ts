// OneVity Payroll Service — orkestrasi server: merakit input engine (karyawan,
// komponen, regulasi, pinjaman) dan menyimpan hasil run ke database.
// Dipakai oleh API routes dan seed.
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import {
  runPayroll, workingDaysBetween, EngineRow, EngineComponent, EngineBracket,
  EngineTer, EngineRegulation, EngineRunResult,
} from "@/onevity/payroll/services/payroll-engine";
import { ComponentRuleLite } from "@/onevity/payroll/services/component-rules";
import { generateJournalForRun } from "@/onevity/payroll/services/payroll-journal";
import { markClaimsPaidForRun } from "@/onevity/payroll/services/benefit-service";
import { markOvertimePaidForRun } from "@/onevity/time-attendance/services/attendance-service";
import { markEncashmentPaidForRun } from "@/onevity/leave/services/leave-service";
import { markTravelPaidForRun } from "@/onevity/travel/services/travel-service";
import { markMedicalPaidForRun } from "@/onevity/medical/services/medical-service";

export async function getActiveRegulation(db: TenantDb): Promise<EngineRegulation> {
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

export async function getBrackets(db: TenantDb): Promise<EngineBracket[]> {
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

export async function getTerRates(db: TenantDb): Promise<EngineTer[]> {
  const rows = await db.terRate.findMany({ orderBy: [{ category: "asc" }, { lowerLimit: "asc" }] });
  return rows.map((t) => ({ category: t.category, lowerLimit: t.lowerLimit, upperLimit: t.upperLimit, rate: t.rate }));
}

function toEngineComponent(c: {
  code: string; name: string; type: string; wageType: string; calcMethod: string;
  amount: number; formula: string | null; incomeTaxMethod: string; prorated: boolean;
  includeInTHP: boolean; includeInBasicIncome: boolean; jamsostekBasis: string | null;
  roundingType: string; roundingValue: number;
}, rules?: ComponentRuleLite[]): EngineComponent {
  return {
    code: c.code, name: c.name, type: c.type, wageType: c.wageType, calcMethod: c.calcMethod,
    amount: c.amount, formula: c.formula, incomeTaxMethod: c.incomeTaxMethod, prorated: c.prorated,
    includeInTHP: c.includeInTHP, includeInBasicIncome: c.includeInBasicIncome,
    jamsostekBasis: c.jamsostekBasis, roundingType: c.roundingType, roundingValue: c.roundingValue,
    ...(rules && rules.length > 0 ? { rules } : {}),
  };
}

// Merakit baris input engine untuk satu run (period × processType).
// Komponen per karyawan = item template profil + komponen Periodic aktif +
// komponen Specific (period & processType cocok) + angsuran pinjaman jatuh tempo.
export async function buildRunRows(db: TenantDb, periodId: string, processTypeId: string): Promise<EngineRow[]> {
  // 28-c: konteks dekripsi per-tenant (baseSalary & komponen tersimpan terenkripsi).
  const tc = tenantCryptoForDb(db);
  const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");

  const [processType, profiles, components, templates, periodic, specific, loans, rules] = await Promise.all([
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
    // Task 32: aturan diferensiasi besaran per parameter karyawan (aktif +
    // berlaku pada period ini). Validitas validTo difilter ulang di memori.
    db.wageComponentRule.findMany({
      where: { active: true, OR: [{ validTo: null }, { validTo: { gte: period.startDate } }] },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  if (!processType) throw new Error("Process type tidak ditemukan");

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const templateByCode = new Map(templates.map((t) => [t.code, t]));
  const rulesByComp = new Map<string, ComponentRuleLite[]>();
  for (const r of rules) {
    const arr = rulesByComp.get(r.wageComponentId) ?? [];
    arr.push({
      id: r.id, name: r.name, priority: r.priority, conditions: r.conditions,
      actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt,
    });
    rulesByComp.set(r.wageComponentId, arr);
  }

  // Assignment aktif semua karyawan (validTo null) + data employee.
  // T19: run TERMINATION (final settlement PHK) memproses karyawan yang BARU
  // KELUAR (status Termination/Resignation sudah diterapkan PA) — assignment
  // TERAKHIR dipakai sebagai snapshot penempatan (termasuk yang validTo-nya
  // sudah ditutup oleh PA). Jenis run lain (SALARY/THR/BONUS/…) memuat
  // karyawan Active dengan assignment aktif — DAN sejak fix K-2 juga leaver.
  // Fix audit 40 K-2 — leaver (validTo dalam period) tetap masuk run SALARY
  // dengan prorate s.d. hari terakhir: dulu karyawan berstatus keluar
  // (Resigned/Terminated) LANGSUNG dikecualikan begitu PA diproses (assignment
  // ditutup validTo = lastDay, filter where validTo:null + status Active) —
  // termasuk hari kerjanya s.d. lastDay → upah bulan terakhir tidak dibayar
  // siapa pun (underpayment sistemik semua jalur keluar; upah terakhir TIDAK
  // masuk settlement PHK by design). Sekarang: assignment yang masih menyentuh
  // period (validTo null ATAU validTo >= periodStart — validTo = lastDay
  // INKLUSIF hari terakhir masuk kerja) tetap dimuat + prorate leaver di bawah.
  // Karyawan yang keluar SEBELUM period (validTo/endDate < periodStart) tetap
  // dikecualikan; branch TERMINATION tidak berubah (item settlement, bukan upah).
  const isTerminationRun = processType.code === "TERMINATION";
  const leaverAssignmentFilter = {
    OR: [{ validTo: null }, { validTo: { gte: period.startDate } }],
  };
  const activeEmployees = await db.employee.findMany({
    where: isTerminationRun
      ? { status: { in: ["Active", "Resigned", "Terminated"] } }
      : {
          status: { in: ["Active", "Resigned", "Terminated"] },
          assignments: { some: leaverAssignmentFilter },
        },
    include: {
      assignments: {
        ...(isTerminationRun ? {} : { where: leaverAssignmentFilter }),
        orderBy: { validFrom: "desc" },
        include: {
          orgUnit: { select: { code: true, name: true } },
          position: { select: { code: true, title: true } },
          // Task 32: kode entitas utk konteks rule diferensiasi besaran.
          grade: { select: { code: true, name: true } },
          companyOffice: { select: { code: true, name: true } },
          workLocation: { select: { code: true, name: true } },
        },
        take: 1,
      },
      payrollProfile: true,
      positionLevel: { select: { code: true, name: true } },
      company: { select: { code: true, name: true } },
    },
    orderBy: { employeeNo: "asc" },
  });

  const specificByEmp = new Map<string, { wageComponentId: string; amount: number; notes: string | null }[]>();
  for (const s of specific) {
    const arr = specificByEmp.get(s.employeeId) ?? [];
    arr.push({ wageComponentId: s.wageComponentId, amount: tc.decryptMoney(s.amount) ?? 0, notes: s.notes });
    specificByEmp.set(s.employeeId, arr);
  }
  const periodicByEmp = new Map<string, { wageComponentId: string; amount: number }[]>();
  for (const p of periodic) {
    const arr = periodicByEmp.get(p.employeeId) ?? [];
    arr.push({ wageComponentId: p.wageComponentId, amount: tc.decryptMoney(p.amount) ?? 0 });
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

  // Semantik multi-run (perilaku standar industri): hanya run SALARY yang memproses
  // payroll penuh (template + periodic + pinjaman). Run THR/BONUS/TERMINATION/
  // YEAR_END_ADJ adalah run suplemental — hanya komponen Specific yang cocok
  // (period × processType) yang diproses, agar tidak terjadi pembayaran ganda.
  const isSalaryRun = processType.code === "SALARY";

  // K-1: konteks penghasilan regular kumulatif masa pajak (YTD) untuk run
  // suplemental — Σ bruto THP & Σ iuran pegawai Jamsostek karyawan dari run
  // SALARY Confirmed/Paid tahun pajak berjalan (Jan s.d. period ini), dibaca
  // dari snapshot PayrollRunLine/Item. Dipakai engine sebagai basis neto
  // disetahunkan untuk PPh21 ireguler (PMK 168/2023) — tanpa ini pajak THR/
  // bonus/rapel standalone dihitung ≈ 0. Fallback bila karyawan belum punya
  // run gaji tahun ini: gaji bulanan profil saat ini (iuran 0 — konservatif).
  const ytdCtx = new Map<string, { bruto: number; iuran: number; months: number }>();
  if (!isSalaryRun) {
    const yearStart = new Date(period.sptYear, 0, 1);
    const salaryRuns = await db.payrollRun.findMany({
      where: {
        status: { in: ["Confirmed", "Paid"] },
        processType: { code: "SALARY" },
        period: {
          sptYear: period.sptYear,
          startDate: { gte: yearStart },
          endDate: { lte: period.endDate },
        },
      },
      select: {
        lines: {
          select: {
            employeeId: true,
            bruto: true,
            items: { select: { wageType: true, type: true, amount: true } },
          },
        },
      },
    });
    for (const r of salaryRuns) {
      for (const line of r.lines) {
        const cur = ytdCtx.get(line.employeeId) ?? { bruto: 0, iuran: 0, months: 0 };
        cur.bruto += tc.decryptMoney(line.bruto) ?? 0;
        // Iuran pegawai (snapshot run historis — run lama masih mencakup JPK_E;
        // toleransi kecil, hanya sebagai konteks pajak ireguler).
        cur.iuran += line.items
          .filter((it) => it.wageType === "Jamsostek" && it.type === "Deduction")
          .reduce((s, it) => s + (tc.decryptMoney(it.amount) ?? 0), 0);
        cur.months += 1;
        ytdCtx.set(line.employeeId, cur);
      }
    }
  }

  // Fix audit 40 K-2 — batas period dinormalisasi ke HARI (inklusif) utk
  // kalkulasi prorate joiner/leaver (pola sama dgn validFrom di bawah).
  const periodStartDay = new Date(period.startDate);
  periodStartDay.setHours(0, 0, 0, 0);
  const periodEndDay = new Date(period.endDate);
  periodEndDay.setHours(0, 0, 0, 0);

  for (const emp of activeEmployees) {
    const assignment = emp.assignments[0];
    if (!assignment) continue; // tidak punya penempatan aktif → dilewati

    // Fix audit 40 K-2 — hari terakhir kerja EFEKTIF utk run non-TERMINATION:
    // assignment.validTo (PA menutup assignment pada lastDay — INKLUSIF hari
    // terakhir masuk kerja) → fallback Employee.endDate (residu jalur senyap
    // M-13: karyawan keluar tanpa penutupan assignment). null = bekerja s.d.
    // akhir period (karyawan biasa / leaver dgn validTo >= akhir period).
    let lastWorkDay: Date | null = null;
    if (!isTerminationRun) {
      const validToDay = assignment.validTo ? new Date(assignment.validTo) : null;
      if (validToDay) validToDay.setHours(0, 0, 0, 0);
      const endDay = emp.endDate ? new Date(emp.endDate) : null;
      if (endDay) endDay.setHours(0, 0, 0, 0);
      if (validToDay) {
        if (validToDay < periodStartDay) continue; // keluar sebelum period → tanpa upah period ini
        lastWorkDay = validToDay;
      } else if (emp.status !== "Active") {
        // karyawan keluar tapi assignment belum tertutup (data residu) — endDate dipakai
        if (!endDay || endDay < periodStartDay) continue;
        lastWorkDay = endDay;
      }
    }

    const profile = emp.payrollProfile;
    const taxStatus = profile?.taxStatus ?? "TK0";
    // 28-c: gaji pokok tersimpan terenkripsi — dekripsi utk engine (number).
    const baseSalary = tc.decryptMoney(assignment.baseSalary) ?? 0;

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

    // Fix audit 40 K-2 — prorate leaver, SIMETRIS dgn prorate joiner di atas
    // (basis HARI KALENDER period inklusif, bukan hari kerja — pola yang sama
    // persis supaya konsisten): hari efektif = max(validFrom, periodStart) s.d.
    // lastWorkDay (inklusif) / jumlah hari period. Intersection dgn prorate
    // joiner (min) bila karyawan masuk & keluar di period yang sama. Contoh:
    // period Sep (30 hari), lastDay 15 Sep → 15/30 = 50%; lastDay >= 30 Sep →
    // 100% (tidak dipotong); masuk 6 Sep & keluar 15 Sep → 10/30 ≈ 33,3%.
    if (lastWorkDay && lastWorkDay < periodEndDay) {
      const totalDays = (periodEndDay.getTime() - periodStartDay.getTime()) / 86_400_000 + 1;
      const from = validFrom > periodStartDay ? validFrom : periodStartDay;
      const worked = (lastWorkDay.getTime() - from.getTime()) / 86_400_000 + 1;
      const leaverFactor = Math.max(0, Math.min(1, worked / Math.max(1, totalDays)));
      prorateFactor = Math.min(prorateFactor, leaverFactor);
      if (prorateFactor >= 0.999) prorateFactor = 1;
    }

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
        compList.push({ comp: toEngineComponent(c, rulesByComp.get(c.id)) });
      }
    }

    // Komponen Periodic (nilai tetap menimpa nilai formula/fixed) — hanya run salary.
    if (isSalaryRun) {
      for (const p of periodicByEmp.get(emp.id) ?? []) {
        const c = components.find((x) => x.id === p.wageComponentId);
        if (!c || seen.has(c.code)) continue;
        seen.add(c.code);
        compList.push({ comp: toEngineComponent(c, rulesByComp.get(c.id)), overrideAmount: p.amount });
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
      compList.push({ comp: toEngineComponent(c, rulesByComp.get(c.id)), overrideAmount: s.amount });
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

    // Konteks K-1 untuk run suplemental (dihitung sebelum loop, per karyawan).
    const ctx = ytdCtx.get(emp.id);

    // Task 32: konteks parameter rule (kode entitas + atribut personal).
    // ageYears/tenureYears dihitung terhadap AKHIR period (konsisten dgn run).
    const periodEnd = new Date(period.endDate);
    const yearsSince = (from: Date | null | undefined): number | null => {
      if (!from) return null;
      return (periodEnd.getTime() - new Date(from).getTime()) / (365.25 * 86_400_000);
    };

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
        // Task 32: parameter pekerjaan (kode entitas) + personal.
        companyCode: emp.company?.code ?? null,
        orgUnitCode: assignment.orgUnit?.code ?? null,
        positionCode: assignment.position?.code ?? null,
        gradeCode: assignment.grade?.code ?? null,
        positionLevelCode: emp.positionLevel?.code ?? null,
        officeCode: assignment.companyOffice?.code ?? null,
        workLocationCode: assignment.workLocation?.code ?? null,
        workShift: assignment.workShift ?? null,
        employeeStatus: emp.status,
        gender: emp.gender ?? null,
        religion: emp.religion ?? null,
        maritalStatus: emp.maritalStatus ?? null,
        bloodType: emp.bloodType ?? null,
        city: emp.city ?? null,
        ageYears: yearsSince(emp.birthDate),
        tenureYears: yearsSince(emp.joinDate),
      },
      components: compList,
      loans: loanDues,
      workingDays,
      prorateFactor,
      // K-1: konteks regular YTD (run suplemental; fallback gaji bulanan profil).
      regularIncomeYtd: ctx && ctx.months > 0 ? ctx.bruto : baseSalary,
      regularIuranYtd: ctx && ctx.months > 0 ? ctx.iuran : 0,
      regularMonthsYtd: ctx && ctx.months > 0 ? ctx.months : 1,
    });
  }

  return rows;
}

// Menjalankan kalkulasi dan menyimpan hasil (lines + items) ke run.
// D-3 (integritas transaksi): komputasi MURNI dulu (tanpa mutasi), lalu seluruh
// persist — delete lines lama + create lines/items + update header run + jejak
// ActivityLog — dijalankan dalam SATU db.$transaction interaktif. Sebelumnya
// deleteMany + loop create tanpa transaksi → crash/race di tengah bisa
// meninggalkan snapshot setengah-tulis (lines lama terhapus, sebagian baru
// tercatat, header run & total tidak konsisten).
export async function calculateAndSaveRun(db: TenantDb, runId: string): Promise<EngineRunResult> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, processType: true },
  });
  if (!run) throw new Error("Run payroll tidak ditemukan");
  if (run.status === "Confirmed" || run.status === "Paid") {
    throw new Error("Run yang sudah dikonfirmasi/dibayar tidak dapat dihitung ulang");
  }

  // --- Fase 1: komputasi murni (baca input + runPayroll; nol mutasi DB) ---
  const [reg, brackets, ter, rows] = await Promise.all([
    getActiveRegulation(db),
    getBrackets(db),
    getTerRates(db),
    buildRunRows(db, run.periodId, run.processTypeId),
  ]);

  const result = runPayroll(rows, reg, brackets, ter, { calculateTax: run.calculateTax });

  // 26-b P0: validasi UMP/UMK (baca-saja) — snapshot per baris untuk UI run.
  const umkWarnings = await computeUmkWarnings(db, run.period, rows);

  // 28-c: konteks enkripsi per-tenant — ditangkap dari client LUAR sebelum
  // $transaction (client transaksi Prisma tidak membawa brand schema).
  const tc = tenantCryptoForDb(db);

  // --- Fase 2: persist atomik dalam satu $transaction ---
  // updateMany bersyarat di awal = kunci baris run (serialisasi terhadap
  // calculate/confirm/concurrent lain); bila status berubah sejak Fase 1
  // (mis. run dikonfirmasi di celah), transaksi digugurkan.
  await db.$transaction(async (tx) => {
    const updated = await tx.payrollRun.updateMany({
      where: { id: runId, status: { in: ["Draft", "Calculated"] } },
      data: {
        status: "Calculated",
        employeeCount: result.lines.length,
        // 28-c: total uang run disimpan TERENKRIPSI (enc:v1:n:…).
        totalBruto: tc.encryptMoney(result.totalBruto),
        totalDeduction: tc.encryptMoney(result.totalDeduction),
        totalTax: tc.encryptMoney(result.totalTax),
        totalNet: tc.encryptMoney(result.totalNet),
        calculatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new Error("Run yang sudah dikonfirmasi/dibayar tidak dapat dihitung ulang");
    }

    await tx.payrollRunLine.deleteMany({ where: { runId } });
    for (const line of result.lines) {
      const umk = umkWarnings.get(line.employeeId);
      const created = await tx.payrollRunLine.create({
        data: {
          runId,
          employeeId: line.employeeId,
          employeeNo: line.employeeNo,
          employeeName: line.employeeName,
          orgUnitName: line.orgUnitName,
          positionName: line.positionName,
          ptkpStatus: line.ptkpStatus,
          ptkpValue: line.ptkpValue,
          // 28-c: nilai uang line disimpan TERENKRIPSI (enc:v1:n:…).
          bruto: tc.encryptMoney(line.bruto),
          deduction: tc.encryptMoney(line.deduction),
          taxRegular: tc.encryptMoney(line.taxRegular),
          taxIrregular: tc.encryptMoney(line.taxIrregular),
          net: tc.encryptMoney(line.net),
          actualNetTax: tc.encryptMoney(line.actualNetTax),
          notes: line.notes,
          umkWarning: umk != null,
          umkJson: umk != null ? JSON.stringify(umk) : null,
        },
      });
      if (line.items.length) {
        await tx.payrollRunItem.createMany({
          data: line.items.map((it) => ({
            lineId: created.id,
            code: it.code, name: it.name, wageType: it.wageType, type: it.type,
            incomeTaxMethod: it.incomeTaxMethod, amount: tc.encryptMoney(it.amount), note: it.note, sortOrder: it.sortOrder,
          })),
        });
      }
    }

    await tx.activityLog.create({
      data: {
        action: "Calculated", entity: "PayrollRun", entityId: runId,
        detail: `Run ${run.runNo} dihitung (${result.lines.length} karyawan, total pajak ${result.totalTax.toLocaleString("id-ID")})`,
      },
    });

    // D-4: peringatan fallback TER dari engine → ActivityLog (ter-audit).
    for (const line of result.lines) {
      for (const w of line.warnings ?? []) {
        await tx.activityLog.create({
          data: {
            actorType: "system", action: "Warning", entity: "PayrollRun",
            entityId: runId, employeeId: line.employeeId, detail: w,
          },
        });
      }
    }

    // 26-b P0: rekap UMP/UMK → ActivityLog (satu baris rekap, ter-audit).
    if (umkWarnings.size > 0) {
      const contoh = [...umkWarnings.values()][0];
      await tx.activityLog.create({
        data: {
          actorType: "system", action: "Warning", entity: "PayrollRun", entityId: runId,
          detail:
            `Validasi UMP/UMK (PP 36/2021): ${umkWarnings.size} karyawan bergaji pokok di bawah upah minimum kantor penempatan ` +
            `(contoh: ${contoh.employeeNo} ${contoh.employeeName} Rp ${contoh.baseSalary.toLocaleString("id-ID")} < ${contoh.umk.label} Rp ${contoh.umk.amount.toLocaleString("id-ID")}) — warning edukatif, hitungan tetap sah`,
        },
      });
    }
  });

  return result;
}

// Konfirmasi run: kunci hasil + apply angsuran pinjaman (status Deducted).
export async function confirmRun(db: TenantDb, runId: string): Promise<void> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { items: true } }, period: true, processType: true },
  });
  if (!run) throw new Error("Run payroll tidak ditemukan");
  if (run.status !== "Calculated") throw new Error("Run harus berstatus Calculated sebelum dikonfirmasi");
  // 28-c: konteks dekripsi per-tenant — item run tersimpan terenkripsi.
  const tc = tenantCryptoForDb(db);

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

  // Fix audit 40 M-12 — sinkron potongan settlement PHK_POT_LOAN ke BUKU
  // EmployeeLoan saat run TERMINATION dikonfirmasi. Item PHK_POT_LOAN
  // (wageType Deduction — dibuat settlement-service dari sisa outstanding
  // pinjaman saat PA diproses, settlement-service.ts:363) dulu TIDAK pernah
  // menyentuh EmployeeLoan (bukan wageType "Loan") → piutang pinjaman tetap
  // outstanding meski uangnya sudah dipotong dari settlement → piutang
  // overstated. Identifikasi: referensi EKSPLISIT = letterNo pinjaman pada
  // notes EmployeeComponentAssignment settlement (period × processType run
  // ini — pola sama item LOAN "name includes letterNo"); bila tidak ada,
  // di-apply ke pinjaman outstanding karyawan OLDEST-FIRST sampai habis.
  // Nilai EmployeeLoan.paidAmount/outstanding adalah Float polos (bukan
  // terenkripsi — 28-c hanya gaji/komponen). Best-effort non-fatal (style
  // callback confirmRun lain) + ActivityLog.
  if (run.processType.code === "TERMINATION") {
    try {
      const phkLoanComp = await db.wageComponent.findUnique({ where: { code: "PHK_POT_LOAN" } });
      if (phkLoanComp) {
        for (const line of run.lines) {
          const items = line.items.filter((i) => i.code === "PHK_POT_LOAN" && i.wageType === "Deduction");
          if (items.length === 0) continue;
          // notes assignment settlement memuat daftar letterNo pinjaman yang dipotong
          const settlementAssignment = await db.employeeComponentAssignment.findFirst({
            where: {
              employeeId: line.employeeId, wageComponentId: phkLoanComp.id, kind: "Specific",
              periodId: run.periodId, processTypeId: run.processTypeId, active: true,
            },
            select: { notes: true },
          });
          const loans = await db.employeeLoan.findMany({
            where: { employeeId: line.employeeId, status: "Active" },
            orderBy: [{ loanDate: "asc" }, { letterNo: "asc" }],
          });
          if (loans.length === 0) continue;
          for (const item of items) {
            const amount = tc.decryptMoney(item.amount) ?? 0;
            if (amount <= 0) continue;
            const note = settlementAssignment?.notes ?? "";
            // pinjaman yang DIRUJUK note didahulukan (eksplisit), sisanya oldest-first
            const referenced = loans.filter((l) => l.letterNo && note.includes(l.letterNo));
            const ordered = [...new Map([...referenced, ...loans].map((l) => [l.id, l])).values()];
            let remaining = amount;
            const applied: string[] = [];
            for (const loan of ordered) {
              if (remaining <= 0.005) break;
              // baca ulang buku pinjaman (amankan terhadap mutasi paralel)
              const cur = await db.employeeLoan.findUnique({
                where: { id: loan.id },
                select: { paidAmount: true, outstanding: true },
              });
              const outstanding = Math.max(0, cur?.outstanding ?? 0);
              if (outstanding <= 0) continue;
              const pay = Math.min(remaining, outstanding);
              const paidAmount = (cur?.paidAmount ?? 0) + pay;
              const newOutstanding = Math.max(0, outstanding - pay);
              await db.employeeLoan.update({
                where: { id: loan.id },
                data: { paidAmount, outstanding: newOutstanding, status: newOutstanding <= 0 ? "PaidOff" : "Active" },
              });
              if (newOutstanding <= 0) {
                // angsuran Pending tidak akan pernah ditagih lagi → Skipped + jejak run
                await db.loanInstallment.updateMany({
                  where: { loanId: loan.id, status: "Pending" },
                  data: { status: "Skipped", periodCode: run.period.code, deductedRunNo: run.runNo },
                });
              }
              remaining -= pay;
              applied.push(`${loan.letterNo} Rp ${Math.round(pay).toLocaleString("id-ID")}`);
            }
            if (applied.length > 0) {
              await db.activityLog.create({
                data: {
                  action: "Updated", entity: "EmployeeLoan", entityId: line.employeeId, employeeId: line.employeeId,
                  detail:
                    `Sinkron potongan settlement ${run.runNo} (PHK_POT_LOAN) ke buku pinjaman: ${applied.join(", ")}` +
                    (remaining > 0.005
                      ? ` — sisa Rp ${Math.round(remaining).toLocaleString("id-ID")} tidak dapat diaplikasikan (outstanding pinjaman lebih kecil dari potongan settlement)`
                      : ""),
                },
              });
            }
          }
        }
      }
    } catch (e) {
      // non-fatal: konfirmasi run tetap sah; penyesuaian buku pinjaman manual
      try {
        await db.activityLog.create({
          data: {
            action: "Error", entity: "PayrollRun", entityId: runId,
            detail: `Gagal sinkron PHK_POT_LOAN ke buku EmployeeLoan (fix audit 40 M-12): ${e instanceof Error ? e.message : "unknown"}`,
          },
        });
      } catch { /* never */ }
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

  // Klaim benefit Scheduled pada period ini → Dibayar (P5 pay-in-payroll).
  try {
    await markClaimsPaidForRun(db, runId);
  } catch {
    // non-fatal: klaim dapat ditandai manual bila gagal
  }

  // Lembur Approved dalam window period (run salary) → Paid (modul attendance).
  try {
    await markOvertimePaidForRun(db, runId);
  } catch {
    // non-fatal: lembur dapat ditandai manual bila gagal
  }

  // Encashment cuti Transferred dalam window period → Paid (modul leave).
  try {
    await markEncashmentPaidForRun(db, runId);
  } catch {
    // non-fatal: encashment dapat ditandai manual bila gagal
  }

  // Klaim travel Transferred pada period run → Paid (modul travel).
  try {
    await markTravelPaidForRun(db, runId);
  } catch {
    // non-fatal: klaim travel dapat ditandai manual bila gagal
  }

  // Transfer medis (UMC) pada period run → Paid (modul medical).
  try {
    await markMedicalPaidForRun(db, runId);
  } catch {
    // non-fatal: transfer medis dapat ditandai manual bila gagal
  }

  // Posting jurnal otomatis (P4) — idempotent; hasil run sudah dikunci aman.
  try {
    const journal = await generateJournalForRun(db, runId);
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
export async function nextRunNo(db: TenantDb, periodCode: string, typeCode: string): Promise<string> {
  const prefix = `PR-${periodCode}-${typeCode.slice(0, 3).toUpperCase()}`;
  const count = await db.payrollRun.count({ where: { runNo: { startsWith: prefix } } });
  return `${prefix}-${String(count + 1).padStart(2, "0")}`;
}

// ============ VALIDASI UMP/UMK (26-b P0 — PP 36/2021) =====================
// Warning EDUKATIF non-bloking: gaji pokok (gabungan dasar, bukan prorata)
// di bawah upah minimum kantor penempatan karyawan. Prioritas pencocokan:
//   1. MinimumWage aktif tahun period (sptYear) + companyOfficeId sama
//   2. tahun sama + companyOfficeId null (default tenant)
//   3. entri aktif TERBARU apa pun tahunnya (fallback)
// Hasil: map employeeId → JSON snapshot (umk label/amount, kantor, gaji, selisih)
// — dipersist ke PayrollRunLine.umkWarning/umkJson + ActivityLog rekap.

export interface UmkSnapshot {
  employeeNo: string;
  employeeName: string;
  office: string | null;
  officeCode: string | null;
  baseSalary: number;
  umk: { label: string; amount: number };
  gap: number;
}

/** Cari entri upah minimum yang berlaku untuk satu kantor pada tahun run. */
export function pickMinimumWage(
  wages: { year: number; companyOfficeId: string | null; label: string; monthlyAmount: number }[],
  officeId: string | null,
  year: number,
): { label: string; monthlyAmount: number } | null {
  const active = wages; // pemanggil sudah menyaring active
  const exact = active.find((w) => w.year === year && w.companyOfficeId === officeId);
  if (exact) return { label: exact.label, monthlyAmount: exact.monthlyAmount };
  const fallbackDefault = active.find((w) => w.year === year && w.companyOfficeId === null);
  if (fallbackDefault) return { label: fallbackDefault.label, monthlyAmount: fallbackDefault.monthlyAmount };
  const latest = [...active].sort((a, b) => b.year - a.year)[0];
  return latest ? { label: latest.label, monthlyAmount: latest.monthlyAmount } : null;
}

/**
 * Hitung daftar karyawan di bawah UMP/UMK untuk satu run hasil kalkulasi.
 * Murni baca (tanpa mutasi) — dipanggil Fase 1 calculateAndSaveRun.
 */
export async function computeUmkWarnings(
  db: TenantDb,
  period: { sptYear: number; startDate: Date; endDate: Date },
  rows: EngineRow[],
): Promise<Map<string, UmkSnapshot>> {
  const out = new Map<string, UmkSnapshot>();
  try {
    const wages = await db.minimumWage.findMany({ where: { active: true } });
    if (wages.length === 0) return out;

    const employeeIds = rows.map((r) => r.employee.id);
    if (employeeIds.length === 0) return out;
    const emps = await db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, companyOfficeId: true, companyOffice: { select: { code: true, name: true } } },
    });
    const officeById = new Map(emps.map((e) => [e.id, e]));

    for (const row of rows) {
      const emp = officeById.get(row.employee.id);
      if (!emp) continue;
      const wage = pickMinimumWage(wages, emp.companyOfficeId, period.sptYear);
      if (!wage) continue;
      const base = row.employee.baseSalary;
      if (base > 0 && base < wage.monthlyAmount) {
        out.set(row.employee.id, {
          employeeNo: row.employee.employeeNo,
          employeeName: row.employee.fullName,
          office: emp.companyOffice?.name ?? null,
          officeCode: emp.companyOffice?.code ?? null,
          baseSalary: base,
          umk: { label: wage.label, amount: wage.monthlyAmount },
          gap: Math.round(wage.monthlyAmount - base),
        });
      }
    }
  } catch {
    // tabel MinimumWage belum termigrasi di tenant → skip senyap (bukan error payroll)
  }
  return out;
}
