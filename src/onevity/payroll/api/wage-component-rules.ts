import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import {
  RULE_PARAMS, parseConditions, parseMatchMode, parseRuleSpec, matchFirstRule, applyRuleAmount,
  validateConditions, isEmptyConditions, RuleValidationError, ComponentRuleLite, EntityRuleLite,
} from "@/onevity/payroll/services/component-rules";
import { evalFormula, workingDaysBetween, EngineRegulation } from "@/onevity/payroll/services/payroll-engine";
import { buildRuleParamDisplay } from "@/onevity/shared/services/employee-rule-context";

// Task 32 — API ATURAN DIFERENSIASI BESARAN KOMPONEN UPAH.
//   GET    /api/onevity/wage-component-rules?componentId=      → rules + opsi parameter
//   GET    /api/onevity/wage-component-rules?componentId=&preview=1 → + simulasi per karyawan
//   POST   /api/onevity/wage-component-rules                   → buat rule (payroll:components create)
//   PATCH  /api/onevity/wage-component-rules                   → ubah rule (update)
//   DELETE /api/onevity/wage-component-rules?id=               → hapus rule (delete)
//
// Guard aksi mengikuti menu payroll:components (sama dgn CRUD komponen).
const ACTIONS = new Set(["SetAmount", "AddAmount", "Multiply"]);

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const componentId = req.nextUrl.searchParams.get("componentId");
    const wantPreview = req.nextUrl.searchParams.get("preview") === "1";
    if (!componentId) return NextResponse.json({ error: "componentId wajib" }, { status: 400 });
    const component = await db.wageComponent.findUnique({ where: { id: componentId } });
    if (!component) return NextResponse.json({ error: "Komponen tidak ditemukan" }, { status: 404 });

    const rules = await db.wageComponentRule.findMany({
      where: { wageComponentId: componentId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    // ---- opsi parameter (master entity + nilai lookup + nilai distinkt data) ----
    const [orgUnits, positions, grades, positionLevels, offices, workLocations, companies, lookups, employees] =
      await Promise.all([
        db.orgUnit.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
        db.position.findMany({ where: { active: true }, select: { code: true, title: true }, orderBy: { code: "asc" } }),
        db.grade.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
        db.positionLevel.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
        db.companyOffice.findMany({ where: { active: true }, select: { code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.workLocation.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
        db.company.findMany({ select: { code: true, name: true, shortName: true }, orderBy: { code: "asc" } }),
        db.lookup.findMany({ where: { active: true }, select: { category: true, code: true, label: true }, orderBy: { sortOrder: "asc" } }),
        db.employee.findMany({
          where: { status: "Active" },
          select: {
            religion: true, maritalStatus: true, bloodType: true, city: true,
            assignments: {
              where: { validTo: null },
              orderBy: { validFrom: "desc" },
              select: { workShift: true, employmentStatus: true },
              take: 1,
            },
          },
        }),
      ]);

    // Nilai distinkt dari data aktual (teks) — digabung dgn label Lookup agar
    // pilihan UI persis mencakup nilai yang tersimpan di Employee.
    const distinct = (pick: (e: (typeof employees)[number]) => string | null | undefined) =>
      [...new Set(employees.map(pick).filter((v): v is string => !!v && v.trim() !== ""))].sort();
    const lookupLabels = (cat: string) => lookups.filter((l) => l.category === cat).map((l) => l.label);
    const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();

    const options = {
      orgUnits, positions, grades, positionLevels, offices, workLocations, companies,
      religion: union(distinct((e) => e.religion), lookupLabels("Religion")),
      maritalStatus: union(distinct((e) => e.maritalStatus), lookupLabels("MaritalStatus")),
      bloodType: union(distinct((e) => e.bloodType), lookupLabels("BloodType")),
      city: distinct((e) => e.city),
      workShift: union(distinct((e) => e.assignments[0]?.workShift), ["Regular"]),
      employmentStatus: union(distinct((e) => e.assignments[0]?.employmentStatus), ["Permanent", "Contract", "Probation", "Outsourcing"]),
    };

    const base = {
      component: {
        id: component.id, code: component.code, name: component.name,
        type: component.type, calcMethod: component.calcMethod,
        amount: component.amount, formula: component.formula,
      },
      rules: rules.map((r) => ({ ...r, conditions: parseConditions(r.conditions), matchMode: parseMatchMode(r.conditions) })),
      options,
      params: RULE_PARAMS,
    };
    if (!wantPreview) return NextResponse.json(base);

    // ---- simulasi per karyawan: besaran dasar → rule cocok → besaran final ----
    // 45-b: gerbang MoneyView — vault uang tertutup/tanpa grant → nilai gaji
    // dasar ter-mask (0) di pratinjau; tulis/validasi aturan tetap jalan.
    const mv = await moneyViewForReq(req, db);
    const [profiles, activeEmployees, regulation] = await Promise.all([
      db.employeePayrollProfile.findMany({ where: { active: true }, select: { employeeId: true, hasNpwp: true, taxStatus: true, dependents: true } }),
      db.employee.findMany({
        where: { status: "Active" },
        include: {
          assignments: {
            where: { validTo: null },
            orderBy: { validFrom: "desc" },
            include: {
              orgUnit: { select: { code: true, name: true } },
              position: { select: { code: true, title: true } },
              grade: { select: { code: true, name: true } },
              companyOffice: { select: { code: true, name: true } },
              workLocation: { select: { code: true, name: true } },
            },
            take: 1,
          },
          positionLevel: { select: { code: true, name: true } },
          company: { select: { code: true, name: true } },
        },
        orderBy: { employeeNo: "asc" },
      }),
      db.payrollRegulation.findFirst({ where: { active: true }, orderBy: { validFrom: "desc" } }),
    ]);
    const profileByEmp = new Map(profiles.map((p) => [p.employeeId, p]));

    const ruleLite: ComponentRuleLite[] = rules.map((r) => ({
      id: r.id, name: r.name, priority: r.priority, conditions: r.conditions,
      actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt,
    }));

    // Basis formula: regulasi aktif (fallback nilai baku BPJS/PPh) + hari kerja bulan berjalan.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const reg: EngineRegulation = regulation
      ? {
          biayaJabatanRate: regulation.biayaJabatanRate,
          biayaJabatanCapMonthly: regulation.biayaJabatanCapMonthly,
          jhtEmployeeRate: regulation.jhtEmployeeRate, jhtCompanyRate: regulation.jhtCompanyRate,
          jpEmployeeRate: regulation.jpEmployeeRate, jpCompanyRate: regulation.jpCompanyRate,
          jpSalaryCap: regulation.jpSalaryCap,
          jkkRate: regulation.jkkRate, jkmRate: regulation.jkmRate,
          jpkCompanyRate: regulation.jpkCompanyRate, jpkEmployeeRate: regulation.jpkEmployeeRate,
          jpkSalaryCap: regulation.jpkSalaryCap,
          jkpCompanyRate: regulation.jkpCompanyRate, jkpEmployeeRate: regulation.jkpEmployeeRate,
          jkpSalaryCap: regulation.jkpSalaryCap,
          nonNpwpSurcharge: regulation.nonNpwpSurcharge,
          useTer: regulation.useTer,
        }
      : {
          biayaJabatanRate: 0.05, biayaJabatanCapMonthly: 500_000 / 12,
          jhtEmployeeRate: 0.02, jhtCompanyRate: 0.037,
          jpEmployeeRate: 0.01, jpCompanyRate: 0.02, jpSalaryCap: 10_547_400,
          jkkRate: 0.0024, jkmRate: 0.003,
          jpkCompanyRate: 0.04, jpkEmployeeRate: 0.01, jpkSalaryCap: 12_000_000,
          jkpCompanyRate: 0.0022, jkpEmployeeRate: 0.0024, jkpSalaryCap: 5_000_000,
          nonNpwpSurcharge: 0.2, useTer: false,
        };

    const preview = activeEmployees.flatMap((emp) => {
      const assignment = emp.assignments[0];
      if (!assignment) return [];
      const profile = profileByEmp.get(emp.id);
      const baseSalary = mv.dec0(assignment.baseSalary);
      const yearsSince = (from: Date | null | undefined) =>
        from ? (now.getTime() - new Date(from).getTime()) / (365.25 * 86_400_000) : null;

      const ctx = {
        company: emp.company?.code ?? null,
        orgUnit: assignment.orgUnit?.code ?? null,
        position: assignment.position?.code ?? null,
        grade: assignment.grade?.code ?? null,
        positionLevel: emp.positionLevel?.code ?? null,
        office: assignment.companyOffice?.code ?? null,
        workLocation: assignment.workLocation?.code ?? null,
        employmentStatus: assignment.employmentStatus,
        workShift: assignment.workShift ?? null,
        tenureYears: yearsSince(emp.joinDate),
        employeeStatus: emp.status,
        gender: emp.gender ?? null,
        religion: emp.religion ?? null,
        maritalStatus: emp.maritalStatus ?? null,
        bloodType: emp.bloodType ?? null,
        city: emp.city ?? null,
        ageYears: yearsSince(emp.birthDate),
        taxStatus: profile?.taxStatus ?? "TK0",
        dependents: profile?.dependents ?? 0,
        hasNpwp: profile?.hasNpwp ?? true,
      };

      let baseAmount: number | null;
      if (component.calcMethod === "Fixed") {
        baseAmount = component.amount;
      } else {
        try {
          baseAmount = evalFormula(component.formula ?? "0", {
            BASE_SALARY: baseSalary, BPJS_BASE: baseSalary,
            JHT_BASE: baseSalary, JP_BASE: Math.min(baseSalary, reg.jpSalaryCap),
            JPK_BASE: Math.min(baseSalary, reg.jpkSalaryCap), JKK_BASE: baseSalary, JKM_BASE: baseSalary,
            JHT_RATE_CO: reg.jhtCompanyRate, JHT_RATE_EMP: reg.jhtEmployeeRate,
            JP_RATE_CO: reg.jpCompanyRate, JP_RATE_EMP: reg.jpEmployeeRate,
            JKK_RATE: reg.jkkRate, JKM_RATE: reg.jkmRate,
            JPK_RATE_CO: reg.jpkCompanyRate, JPK_RATE_EMP: reg.jpkEmployeeRate,
            // Task 52-c — variabel formula JKP (PP 6/2025).
            JKP_BASE: Math.min(baseSalary, reg.jkpSalaryCap),
            JKP_RATE_CO: reg.jkpCompanyRate, JKP_RATE_EMP: reg.jkpEmployeeRate,
            WORKING_DAYS: workingDaysBetween(monthStart, monthEnd), PRORATE: 1,
            PTKP_VALUE: 54_000_000,
          });
        } catch {
          baseAmount = null; // formula butuh variabel komponen lain → tak bisa disimulasikan
        }
      }

      const matched = ruleLite.length > 0 ? matchFirstRule(ruleLite as EntityRuleLite[], ctx) : null;
      let final: number | null = null;
      if (baseAmount != null) {
        final = matched
          ? applyRuleAmount(matched.rule.actionType, matched.rule.value, baseAmount)
          : baseAmount;
      }

      return [{
        employeeNo: emp.employeeNo,
        fullName: emp.fullName,
        orgUnitName: assignment.orgUnit?.name ?? null,
        positionName: assignment.position?.title ?? null,
        officeName: assignment.companyOffice?.name ?? null,
        workLocationName: assignment.workLocation?.name ?? null,
        employmentStatus: assignment.employmentStatus,
        gender: emp.gender ?? null,
        religion: emp.religion ?? null,
        maritalStatus: emp.maritalStatus ?? null,
        tenureYears: ctx.tenureYears != null ? Number(ctx.tenureYears.toFixed(1)) : null,
        base: baseAmount,
        // Task 37: param yang DIPAKAI rule pemenang + nilai param karyawan —
        // kolom "Parameter" simulasi kini mencerminkan kondisi rule sebenarnya.
        paramDisplay: buildRuleParamDisplay({ ...emp, payrollProfile: profile ?? null }, ctx),
        matchedRule: matched
          ? { id: matched.rule.id, name: matched.rule.name, actionType: matched.rule.actionType, amount: matched.rule.value, conditions: matched.conds }
          : null,
        final,
      }];
    });

    return NextResponse.json({ ...base, preview });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:components", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.componentId) return NextResponse.json({ error: "componentId wajib" }, { status: 400 });
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: "Nama rule wajib diisi" }, { status: 400 });
    const component = await db.wageComponent.findUnique({ where: { id: b.componentId } });
    if (!component) return NextResponse.json({ error: "Komponen tidak ditemukan" }, { status: 404 });

    const conditions = (() => {
      try { return validateConditions(b.conditions); }
      catch (e) { throw new RuleValidationError(e instanceof Error ? e.message : String(e)); }
    })();
    if (isEmptyConditions(conditions)) return NextResponse.json({ error: "Minimal satu kondisi parameter diperlukan" }, { status: 400 });
    const actionType = String(b.actionType ?? "SetAmount");
    if (!ACTIONS.has(actionType)) return NextResponse.json({ error: "actionType tidak valid" }, { status: 400 });
    const amount = Number(b.amount ?? 0);
    if (!isFinite(amount)) return NextResponse.json({ error: "Nilai harus angka" }, { status: 400 });
    if (actionType === "Multiply" && amount <= 0) return NextResponse.json({ error: "Faktor Multiply harus > 0" }, { status: 400 });

    const rule = await db.wageComponentRule.create({
      data: {
        wageComponentId: b.componentId,
        name: String(b.name).trim(),
        priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,
        conditions,
        actionType,
        amount,
        notes: b.notes ? String(b.notes) : null,
        active: b.active ?? true,
      },
    });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "WageComponentRule", entityId: rule.id,
        detail: `Aturan diferensiasi '${rule.name}' utk komponen ${component.code} dibuat (${parseRuleSpec(conditions).conditions.length} kondisi${parseMatchMode(conditions) === "any" ? ", ATAU" : ""})`,
      },
    });
    return NextResponse.json({ rule: { ...rule, conditions: parseConditions(rule.conditions), matchMode: parseMatchMode(rule.conditions) } }, { status: 201 });
  } catch (e) {
    if (e instanceof RuleValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:components", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.wageComponentRule.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Rule tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.name != null) {
      if (!String(b.name).trim()) return NextResponse.json({ error: "Nama rule wajib diisi" }, { status: 400 });
      data.name = String(b.name).trim();
    }
    if (b.priority != null) data.priority = Number(b.priority);
    if (b.conditions !== undefined) {
      try { data.conditions = validateConditions(b.conditions); }
      catch (e) { throw new RuleValidationError(e instanceof Error ? e.message : String(e)); }
    }
    if (b.actionType != null) {
      if (!ACTIONS.has(String(b.actionType))) return NextResponse.json({ error: "actionType tidak valid" }, { status: 400 });
      data.actionType = String(b.actionType);
    }
    if (b.amount != null) {
      const amount = Number(b.amount);
      if (!isFinite(amount)) return NextResponse.json({ error: "Nilai harus angka" }, { status: 400 });
      data.amount = amount;
    }
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null;
    if (b.active != null) data.active = !!b.active;

    const rule = await db.wageComponentRule.update({ where: { id: b.id }, data });
    return NextResponse.json({ rule: { ...rule, conditions: parseConditions(rule.conditions), matchMode: parseMatchMode(rule.conditions) } });
  } catch (e) {
    if (e instanceof RuleValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:components", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.wageComponentRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Rule tidak ditemukan" }, { status: 404 });
    await db.wageComponentRule.delete({ where: { id } });
    await db.activityLog.create({
      data: { action: "Deleted", entity: "WageComponentRule", entityId: id, detail: `Aturan diferensiasi '${existing.name}' dihapus` },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
