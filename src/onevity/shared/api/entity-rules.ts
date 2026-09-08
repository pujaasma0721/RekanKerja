import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import {
  RULE_PARAMS, EntityRuleLite, parseConditions, parseMatchMode, parseRuleSpec, matchFirstRule, applyRuleValue,
  validateConditions, isEmptyConditions, RuleValidationError,
} from "@/onevity/shared/lib/parameter-rules";
import { ENTITY_RULE_DOMAINS, isRuleDomain } from "@/onevity/shared/lib/entity-rule-domains";
import { EMPLOYEE_RULE_INCLUDE, buildEmployeeRuleContext, EmployeeRuleRecord } from "@/onevity/shared/services/employee-rule-context";
import { benefitLimitFor } from "@/onevity/medical/services/medical-service";

// OneVity — Task 33: API ATURAN PARAMETER GENERIK (leave/medical/travel/benefit).
//   GET    /api/onevity/entity-rules?domain=&entityId=        → rules + opsi + entity ringkas
//   GET    /api/onevity/entity-rules?domain=&entityId=&preview=1 → + simulasi per karyawan
//   POST   /api/onevity/entity-rules { domain, entityId, ... } → buat rule
//   PATCH  /api/onevity/entity-rules { id, domain, ... }       → ubah rule
//   DELETE /api/onevity/entity-rules?domain=&id=               → hapus rule
//
// Guard aksi per domain mengikuti menu master modul terkait
// (ENTITY_RULE_DOMAINS.menuKey) — identik dgn CRUD masternya.
// Domain "wage" TIDAK di sini (API khusus payroll dgn formula preview).

const ACTIONS = new Set(["SetDays", "AddDays", "SetLimit", "AddLimit", "Multiply"]);

type DomainApi = {
  // muat entitas + rules + opsi (dipakai GET; preview menambah simulasi)
  loadEntity: (db: import("@/onevity/shared/lib/tenant-db").TenantDb, entityId: string) => Promise<{
    entity: Record<string, unknown> | null;
    baseValue: number | null; // nilai dasar utk header/preview (null = tak berlaku/tanpa limit)
    baseLabel: string;
  }>;
  loadRules: (db: import("@/onevity/shared/lib/tenant-db").TenantDb, entityId: string) => Promise<{ rows: Record<string, unknown>[]; toLite: () => EntityRuleLite[] }>;
};

function domainApi(domain: string): DomainApi | null {
  switch (domain) {
    case "leave":
      return {
        loadEntity: async (db, id) => {
          const t = await db.leaveType.findUnique({ where: { id } });
          if (!t) return { entity: null, baseValue: null, baseLabel: "" };
          return {
            entity: { id: t.id, code: t.code, name: t.name, entitlement: t.entitlement, unit: t.unit, maxPerRequest: t.maxPerRequest },
            baseValue: t.entitlement,
            baseLabel: `${t.entitlement} ${t.unit === "MONTH" ? "bulan" : "hari"}`,
          };
        },
        loadRules: async (db, id) => {
          const rows = await db.leaveTypeRule.findMany({ where: { leaveTypeId: id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
          return {
            rows,
            toLite: () => rows.map((r) => ({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.days, active: r.active, createdAt: r.createdAt })),
          };
        },
      };
    case "medical":
      return {
        loadEntity: async (db, id) => {
          const t = await db.medicalBenefitType.findUnique({ where: { id } });
          if (!t) return { entity: null, baseValue: null, baseLabel: "" };
          const base = t.limitRule === "UNLIMITED" ? null : t.limitValue;
          return {
            entity: { id: t.id, code: t.code, name: t.name, limitRule: t.limitRule, limitValue: t.limitValue, wageCode: t.wageCode, dependentEnabled: t.dependentEnabled },
            baseValue: base,
            baseLabel: t.limitRule === "UNLIMITED" ? "∞ (tanpa limit)" : t.limitRule === "FACTOR" ? `${t.limitValue} × gaji pokok` : t.limitRule === "WAGE_COMPONENT" ? "gaji pokok" : `${t.limitValue}`,
          };
        },
        loadRules: async (db, id) => {
          const rows = await db.medicalBenefitTypeRule.findMany({ where: { medicalBenefitTypeId: id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
          return {
            rows,
            toLite: () => rows.map((r) => ({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt })),
          };
        },
      };
    case "travel":
      return {
        loadEntity: async (db, id) => {
          const t = await db.travelExpenseType.findUnique({ where: { id } });
          if (!t) return { entity: null, baseValue: null, baseLabel: "" };
          const base = t.unlimited ? null : t.limitAmount;
          return {
            entity: { id: t.id, code: t.code, name: t.name, kind: t.kind, limitAmount: t.limitAmount, unlimited: t.unlimited, currency: t.currency },
            baseValue: base,
            baseLabel: t.unlimited ? "∞ (tanpa limit)" : t.limitAmount > 0 ? `${t.limitAmount}` : "0 (tanpa limit)",
          };
        },
        loadRules: async (db, id) => {
          const rows = await db.travelExpenseTypeRule.findMany({ where: { travelExpenseTypeId: id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
          return {
            rows,
            toLite: () => rows.map((r) => ({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt })),
          };
        },
      };
    case "benefit":
      return {
        loadEntity: async (db, id) => {
          const t = await db.benefitType.findUnique({ where: { id } });
          if (!t) return { entity: null, baseValue: null, baseLabel: "" };
          const base = t.unlimited || t.maxClaimAmount <= 0 ? null : t.maxClaimAmount;
          return {
            entity: { id: t.id, code: t.code, name: t.name, category: t.category, maxClaimAmount: t.maxClaimAmount, unlimited: t.unlimited, resetPeriod: t.resetPeriod, entitleFor: t.entitleFor },
            baseValue: base,
            baseLabel: t.unlimited || t.maxClaimAmount <= 0 ? "tanpa limit" : `${t.maxClaimAmount}`,
          };
        },
        loadRules: async (db, id) => {
          const rows = await db.benefitTypeRule.findMany({ where: { benefitTypeId: id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
          return {
            rows,
            toLite: () => rows.map((r) => ({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt })),
          };
        },
      };
    default:
      return null;
  }
}

/** Opsi parameter (master entity + lookup + nilai distinkt data aktual). */
async function optionsPayload(db: import("@/onevity/shared/lib/tenant-db").TenantDb) {
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
          assignments: { where: { validTo: null }, select: { workShift: true, employmentStatus: true }, take: 1 },
        },
      }),
    ]);
  const distinct = (pick: (e: (typeof employees)[number]) => string | null | undefined) =>
    [...new Set(employees.map(pick).filter((v): v is string => !!v && v.trim() !== ""))].sort();
  const lookupLabels = (cat: string) => lookups.filter((l) => l.category === cat).map((l) => l.label);
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();
  return {
    orgUnits, positions, grades, positionLevels, offices, workLocations, companies,
    religion: union(distinct((e) => e.religion), lookupLabels("Religion")),
    maritalStatus: union(distinct((e) => e.maritalStatus), lookupLabels("MaritalStatus")),
    bloodType: union(distinct((e) => e.bloodType), lookupLabels("BloodType")),
    city: distinct((e) => e.city),
    workShift: union(distinct((e) => e.assignments[0]?.workShift), ["Regular"]),
    employmentStatus: union(distinct((e) => e.assignments[0]?.employmentStatus), ["Permanent", "Contract", "Probation", "Outsourcing"]),
  };
}

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const domain = req.nextUrl.searchParams.get("domain") ?? "";
    const entityId = req.nextUrl.searchParams.get("entityId");
    const wantPreview = req.nextUrl.searchParams.get("preview") === "1";
    if (!isRuleDomain(domain)) return NextResponse.json({ error: "domain tidak valid (leave|medical|travel|benefit)" }, { status: 400 });
    if (!entityId) return NextResponse.json({ error: "entityId wajib" }, { status: 400 });

    const api = domainApi(domain)!;
    const { entity, baseValue, baseLabel } = await api.loadEntity(db, entityId);
    if (!entity) return NextResponse.json({ error: `${ENTITY_RULE_DOMAINS[domain].entityLabel} tidak ditemukan` }, { status: 404 });
    const ruleRows = await api.loadRules(db, entityId);
    const options = await optionsPayload(db);

    const def = ENTITY_RULE_DOMAINS[domain];
    const base = {
      domain,
      domainDef: def,
      entity,
      baseLabel,
      rules: ruleRows.rows.map((r) => ({
        ...r,
        [def.valueField]: (r as Record<string, unknown>)[def.valueField],
        conditions: parseConditions((r as Record<string, unknown>).conditions as string),
        matchMode: parseMatchMode((r as Record<string, unknown>).conditions as string),
      })),
      options,
      params: RULE_PARAMS,
    };
    if (!wantPreview) return NextResponse.json(base);

    // ---- simulasi per karyawan aktif ----
    const now = new Date();
    const employees = await db.employee.findMany({
      where: { status: "Active" },
      include: EMPLOYEE_RULE_INCLUDE,
      orderBy: { employeeNo: "asc" },
    });
    const tc = tenantCryptoForDb(db);
    const ruleLite = ruleRows.toLite();

    const preview = employees.flatMap((empRec) => {
      const emp = empRec as unknown as EmployeeRuleRecord & { id: string; employeeNo: string; fullName: string; assignments: { baseSalary: string | null }[] };
      const assignment = emp.assignments[0];
      if (!assignment) return [];
      const ctx = buildEmployeeRuleContext(emp, now);

      // nilai dasar domain per karyawan (medical FACTOR/WAGE_COMPONENT butuh gaji)
      let empBase: number | null = baseValue;
      if (domain === "medical") {
        const ent = entity as { limitRule: string; limitValue: number };
        if (ent.limitRule === "UNLIMITED") empBase = null;
        else {
          const salary = tc.decryptMoney(assignment.baseSalary) ?? 0;
          empBase = benefitLimitFor({ limitRule: ent.limitRule, limitValue: ent.limitValue }, salary);
        }
      }

      const matched = ruleLite.length > 0 ? matchFirstRule(ruleLite, ctx) : null;
      const final = empBase != null && matched ? applyRuleValue(matched.rule.actionType, matched.rule.value, empBase) : empBase;

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
        tenureYears: ctx.tenureYears != null ? Number(Number(ctx.tenureYears).toFixed(1)) : null,
        base: empBase,
        matchedRule: matched ? { id: matched.rule.id, name: matched.rule.name, actionType: matched.rule.actionType, value: matched.rule.value } : null,
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
    const domain = await readDomain(req);
    if (!isRuleDomain(domain)) return NextResponse.json({ error: "domain tidak valid" }, { status: 400 });
    const def = ENTITY_RULE_DOMAINS[domain];
    const m = await requireMenuAction(req, def.menuKey, "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.entityId) return NextResponse.json({ error: "entityId wajib" }, { status: 400 });
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: "Nama rule wajib diisi" }, { status: 400 });

    const conditions = (() => {
      try { return validateConditions(b.conditions); }
      catch (e) { throw new RuleValidationError(e instanceof Error ? e.message : String(e)); }
    })();
    if (isEmptyConditions(conditions)) return NextResponse.json({ error: "Minimal satu kondisi parameter diperlukan" }, { status: 400 });
    const actionType = String(b.actionType ?? def.actions[0].value);
    if (!ACTIONS.has(actionType)) return NextResponse.json({ error: "actionType tidak valid" }, { status: 400 });
    const value = Number(b.value ?? b[def.valueField] ?? 0);
    if (!isFinite(value)) return NextResponse.json({ error: "Nilai harus angka" }, { status: 400 });
    if (actionType === "Multiply" && value <= 0) return NextResponse.json({ error: "Faktor Multiply harus > 0" }, { status: 400 });

    const data = {
      name: String(b.name).trim(),
      priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,
      conditions,
      actionType,
      [def.valueField]: value,
      notes: b.notes ? String(b.notes) : null,
      active: b.active ?? true,
    };

    let rule;
    switch (domain) {
      case "leave": {
        const t = await db.leaveType.findUnique({ where: { id: b.entityId } });
        if (!t) return NextResponse.json({ error: "Jenis cuti tidak ditemukan" }, { status: 404 });
        rule = await db.leaveTypeRule.create({ data: { leaveTypeId: b.entityId, ...data } });
        break;
      }
      case "medical": {
        const t = await db.medicalBenefitType.findUnique({ where: { id: b.entityId } });
        if (!t) return NextResponse.json({ error: "Jenis benefit medis tidak ditemukan" }, { status: 404 });
        rule = await db.medicalBenefitTypeRule.create({ data: { medicalBenefitTypeId: b.entityId, ...data } });
        break;
      }
      case "travel": {
        const t = await db.travelExpenseType.findUnique({ where: { id: b.entityId } });
        if (!t) return NextResponse.json({ error: "Jenis biaya travel tidak ditemukan" }, { status: 404 });
        rule = await db.travelExpenseTypeRule.create({ data: { travelExpenseTypeId: b.entityId, ...data } });
        break;
      }
      default: {
        const t = await db.benefitType.findUnique({ where: { id: b.entityId } });
        if (!t) return NextResponse.json({ error: "Jenis benefit tidak ditemukan" }, { status: 404 });
        rule = await db.benefitTypeRule.create({ data: { benefitTypeId: b.entityId, ...data } });
        break;
      }
    }
    await db.activityLog.create({
      data: {
        action: "Created", entity: `${def.key}Rule`, entityId: rule.id,
        detail: `Aturan diferensiasi '${rule.name}' utk ${def.entityLabel} dibuat (${parseRuleSpec(conditions).conditions.length} kondisi${parseMatchMode(conditions) === "any" ? ", ATAU" : ""})`,
      },
    });
    return NextResponse.json({
      rule: {
        ...rule,
        conditions: parseConditions((rule as Record<string, unknown>).conditions as string),
        matchMode: parseMatchMode((rule as Record<string, unknown>).conditions as string),
      },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof RuleValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const domain = await readDomain(req);
    if (!isRuleDomain(domain)) return NextResponse.json({ error: "domain tidak valid" }, { status: 400 });
    const def = ENTITY_RULE_DOMAINS[domain];
    const m = await requireMenuAction(req, def.menuKey, "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

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
    if (b.value != null || b[def.valueField] != null) {
      const value = Number(b.value ?? b[def.valueField]);
      if (!isFinite(value)) return NextResponse.json({ error: "Nilai harus angka" }, { status: 400 });
      data[def.valueField] = value;
    }
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null;
    if (b.active != null) data.active = !!b.active;

    let rule;
    switch (domain) {
      case "leave": rule = await db.leaveTypeRule.update({ where: { id: b.id }, data }); break;
      case "medical": rule = await db.medicalBenefitTypeRule.update({ where: { id: b.id }, data }); break;
      case "travel": rule = await db.travelExpenseTypeRule.update({ where: { id: b.id }, data }); break;
      default: rule = await db.benefitTypeRule.update({ where: { id: b.id }, data }); break;
    }
    return NextResponse.json({
      rule: {
        ...rule,
        conditions: parseConditions((rule as Record<string, unknown>).conditions as string),
        matchMode: parseMatchMode((rule as Record<string, unknown>).conditions as string),
      },
    });
  } catch (e) {
    if (e instanceof RuleValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const domain = req.nextUrl.searchParams.get("domain") ?? "";
    if (!isRuleDomain(domain)) return NextResponse.json({ error: "domain tidak valid" }, { status: 400 });
    const def = ENTITY_RULE_DOMAINS[domain];
    const m = await requireMenuAction(req, def.menuKey, "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    let existing: { id: string; name: string } | null = null;
    switch (domain) {
      case "leave": existing = await db.leaveTypeRule.findUnique({ where: { id }, select: { id: true, name: true } }); break;
      case "medical": existing = await db.medicalBenefitTypeRule.findUnique({ where: { id }, select: { id: true, name: true } }); break;
      case "travel": existing = await db.travelExpenseTypeRule.findUnique({ where: { id }, select: { id: true, name: true } }); break;
      default: existing = await db.benefitTypeRule.findUnique({ where: { id }, select: { id: true, name: true } }); break;
    }
    if (!existing) return NextResponse.json({ error: "Rule tidak ditemukan" }, { status: 404 });

    switch (domain) {
      case "leave": await db.leaveTypeRule.delete({ where: { id } }); break;
      case "medical": await db.medicalBenefitTypeRule.delete({ where: { id } }); break;
      case "travel": await db.travelExpenseTypeRule.delete({ where: { id } }); break;
      default: await db.benefitTypeRule.delete({ where: { id } }); break;
    }
    await db.activityLog.create({
      data: { action: "Deleted", entity: `${def.key}Rule`, entityId: id, detail: `Aturan diferensiasi '${existing.name}' dihapus` },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

/** Domain dari query (DELETE) atau body (POST/PATCH). */
async function readDomain(req: NextRequest): Promise<string> {
  const q = req.nextUrl.searchParams.get("domain");
  if (q) return q;
  try {
    const b = await req.clone().json();
    return String(b?.domain ?? "");
  } catch {
    return "";
  }
}
