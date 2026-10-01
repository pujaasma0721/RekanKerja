// RekanKerja — Task 33: KONTEKS PARAMETER KARYAWAN utk evaluasi rule lintas modul.
// Satu sumber kebenaran bentuk data employee (include Prisma) + builder ctx —
// dipakai: payroll-service (run), wage-component-rules preview, leave-service
// (entitlement), medical-service (plafon), travel-service (limit biaya),
// benefit-service (limit klaim), entity-rules API (simulasi).
//
// Server-side (butuh TenantDb). Murni builder — tanpa efek samping.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { RuleContext } from "@/rekankerja/shared/lib/parameter-rules";

/** Include Prisma lengkap utk membangun konteks rule (assignment aktif pertama). */
export const EMPLOYEE_RULE_INCLUDE = {
  assignments: {
    where: { validTo: null },
    orderBy: { validFrom: "desc" as const },
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
  payrollProfile: { select: { hasNpwp: true, taxStatus: true, dependents: true } },
} as const;

/** Bentuk hasil include (loose — cukup utk builder). */
export type EmployeeRuleRecord = {
  id: string;
  status: string;
  gender: string | null;
  religion: string | null;
  maritalStatus: string | null;
  bloodType: string | null;
  city: string | null;
  joinDate: Date;
  birthDate: Date | null;
  assignments: {
    employmentStatus: string;
    workShift: string;
    orgUnit: { code: string; name: string } | null;
    position: { code: string; title: string } | null;
    grade: { code: string; name: string } | null;
    companyOffice: { code: string; name: string } | null;
    workLocation: { code: string; name: string } | null;
  }[];
  positionLevel: { code: string; name: string } | null;
  company: { code: string; name: string } | null;
  payrollProfile: { hasNpwp: boolean; taxStatus: string; dependents: number } | null;
};

const yearsBetween = (from: Date | null | undefined, to: Date): number | null =>
  from != null ? (to.getTime() - new Date(from).getTime()) / (365.25 * 86_400_000) : null;

/**
 * Bangun konteks rule dari record employee (dgn EMPLOYEE_RULE_INCLUDE).
 * `asOf` = tanggal acuan umur/masa kerja (akhir period payroll / tanggal klaim /
 * hari ini utk simulasi).
 */
export function buildEmployeeRuleContext(emp: EmployeeRuleRecord, asOf: Date): RuleContext {
  const assignment = emp.assignments[0];
  return {
    company: emp.company?.code ?? null,
    orgUnit: assignment?.orgUnit?.code ?? null,
    position: assignment?.position?.code ?? null,
    grade: assignment?.grade?.code ?? null,
    positionLevel: emp.positionLevel?.code ?? null,
    office: assignment?.companyOffice?.code ?? null,
    workLocation: assignment?.workLocation?.code ?? null,
    employmentStatus: assignment?.employmentStatus ?? "Permanent",
    workShift: assignment?.workShift ?? null,
    tenureYears: yearsBetween(emp.joinDate, asOf),
    employeeStatus: emp.status,
    gender: emp.gender ?? null,
    religion: emp.religion ?? null,
    maritalStatus: emp.maritalStatus ?? null,
    bloodType: emp.bloodType ?? null,
    city: emp.city ?? null,
    ageYears: yearsBetween(emp.birthDate, asOf),
    taxStatus: emp.payrollProfile?.taxStatus ?? "TK0",
    dependents: emp.payrollProfile?.dependents ?? 0,
    hasNpwp: emp.payrollProfile?.hasNpwp ?? true,
  };
}

/** Konteks rule satu karyawan (fetch lengkap) — null bila tidak ditemukan. */
export async function ruleContextForEmployee(
  db: Pick<TenantDb, "employee">,
  employeeId: string,
  asOf: Date = new Date(),
): Promise<RuleContext | null> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    include: EMPLOYEE_RULE_INCLUDE,
  });
  if (!emp) return null;
  return buildEmployeeRuleContext(emp as unknown as EmployeeRuleRecord, asOf);
}

/** Map konteks semua karyawan aktif — utk loop batch (list saldo/generate). */
export async function ruleContextMap(
  db: Pick<TenantDb, "employee">,
  asOf: Date = new Date(),
): Promise<Map<string, RuleContext>> {
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    include: EMPLOYEE_RULE_INCLUDE,
  });
  const map = new Map<string, RuleContext>();
  for (const emp of employees) {
    map.set(emp.id, buildEmployeeRuleContext(emp as unknown as EmployeeRuleRecord, asOf));
  }
  return map;
}

// ============ DISPLAY PARAMETER (simulasi / preview) =====================
// Task 37: map paramKey → nilai RAMAH utk kolom "Parameter" simulasi rule.
// ctx menyimpan CODE utk param entity (orgUnit="HO", office="MII"…) — utk
// tampilan user kita kirim NAME/TITLE. Param personal & angka pakai nilai ctx.

/** Bentuk longgar record employee utk display (subset EMPLOYEE_RULE_INCLUDE). */
export type RuleParamDisplayRecord = {
  company?: { code: string; name: string } | null;
  positionLevel?: { code: string; name: string } | null;
  assignments?: {
    orgUnit?: { code: string; name: string } | null;
    position?: { code: string; title: string } | null;
    grade?: { code: string; name: string } | null;
    companyOffice?: { code: string; name: string } | null;
    workLocation?: { code: string; name: string } | null;
  }[];
  payrollProfile?: { hasNpwp: boolean; taxStatus: string; dependents: number } | null;
};

const strOrNull = (v: string | number | boolean | null | undefined): string | null =>
  v == null || String(v).trim() === "" ? null : String(v);
const num1 = (v: number | null | undefined): string | null =>
  v == null || !isFinite(v) ? null : String(Number(v.toFixed(1)));

/**
 * Nilai display SEMUA 20 parameter utk satu karyawan (dari record + ctx rule).
 * Key = RULE_PARAMS.key → nilai ramah (nama entity, teks personal, angka 1 desimal,
 * boolean "true"/"false" — label Ya/Tidak & enum dipetakan client-side bilingual).
 */
export function buildRuleParamDisplay(emp: RuleParamDisplayRecord, ctx: RuleContext): Record<string, string | null> {
  const a = emp.assignments?.[0];
  return {
    company: strOrNull(emp.company?.name),
    orgUnit: strOrNull(a?.orgUnit?.name),
    position: strOrNull(a?.position?.title),
    grade: strOrNull(a?.grade?.name),
    positionLevel: strOrNull(emp.positionLevel?.name),
    office: strOrNull(a?.companyOffice?.name),
    workLocation: strOrNull(a?.workLocation?.name),
    employmentStatus: strOrNull(ctx.employmentStatus),
    workShift: strOrNull(ctx.workShift),
    tenureYears: num1(ctx.tenureYears as number | null),
    employeeStatus: strOrNull(ctx.employeeStatus),
    gender: strOrNull(ctx.gender),
    religion: strOrNull(ctx.religion),
    maritalStatus: strOrNull(ctx.maritalStatus),
    bloodType: strOrNull(ctx.bloodType),
    city: strOrNull(ctx.city),
    ageYears: num1(ctx.ageYears as number | null),
    taxStatus: strOrNull(ctx.taxStatus),
    dependents: strOrNull(ctx.dependents),
    hasNpwp: ctx.hasNpwp == null ? null : String(ctx.hasNpwp),
  };
}
