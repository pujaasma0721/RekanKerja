// RekanKerja Leave Entitlement Helper (fix audit 40 M-5) ========================
// =============================================================================
// ENTITLEMENT EFEKTIF BERSAMA (rule-aware, Task 33) — satu sumber kebenaran
// untuk kalkulasi hak cuti efektif per karyawan:
//   dasar LeaveType.entitlement  →  bila ada LeaveTypeRule aktif yang cocok
//   konteks parameter karyawan (rule PERTAMA yang cocok menang)  →  nilai rule.
//
// Fix audit 40 M-5 (entitlement drift): sebelumnya hanya leave-service yang
// memakai hasil LeaveTypeRule; mirror lokal lain (uang cuti settlement PHK /
// guard izin workoff) masih memakai entitlement DASAR → bila rule aktif
// (mis. tenure ≥ 5 tahun → 14 hari) settlement membayar terlalu kecil & guard
// salah ketat. Helper ini diekspor supaya semua call-site memakai logika yang
// sama:
//   · leave-service.ts (availableForRequest — refactor minimal)
//   · settlement-service.ts (uang pengganti cuti CUTI_CASH saat PHK/resign)
//   · attendance-service.ts (annualAvailability guard workoff — wiring oleh
//     orchestrator/agent lain; JANGAN dipanggil langsung dari situ sebelum
//     koordinasi — file milik agent lain)
//
// Semantik evaluasi identik leave-service lama (dipindah ke sini):
//   · rule aktif diurut priority ASC (tie-break createdAt ASC — urutan query);
//   · rule pertama yang cocok menang; tanpa kecocokan/konteks → entitlement
//     dasar; rule tanpa kondisi tidak dievaluasi (guard parameter-rules).
// =============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  EntityRuleLite, RuleContext, matchFirstRule, applyRuleValue,
} from "@/rekankerja/shared/lib/parameter-rules";
import { buildEmployeeRuleContext, type EmployeeRuleRecord } from "@/rekankerja/shared/services/employee-rule-context";

/** Subset db yang dibutuhkan (kompatibel dgn db utama MAUPUN client transaksi). */
type EntitlementDb = Pick<TenantDb, "employee" | "leaveType" | "leaveTypeRule">;

/** Muat rule entitlement semua jenis cuti terlibat (map typeId → lite).
 *  (Dipindah dari leave-service.ts — call-site internal file itu tetap
 *  memanggil fungsi ini via import supaya logika tunggal.) */
export async function leaveTypeRules(
  db: Pick<TenantDb, "leaveTypeRule">,
  typeIds: string[],
): Promise<Map<string, EntityRuleLite[]>> {
  const map = new Map<string, EntityRuleLite[]>();
  if (typeIds.length === 0) return map;
  const rows = await db.leaveTypeRule.findMany({
    where: { leaveTypeId: { in: typeIds }, active: true },
  });
  for (const r of rows) {
    const arr = map.get(r.leaveTypeId) ?? [];
    arr.push({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.days, active: r.active, createdAt: r.createdAt });
    map.set(r.leaveTypeId, arr);
  }
  return map;
}

/** Entitlement efektif karyawan: rule cocok pertama menang, tanpa rule/konteks → dasar.
 *  (Dipindah dari leave-service.ts — murni, tanpa IO.) */
export function entitlementFor(
  base: number,
  rules: EntityRuleLite[] | undefined,
  ctx: RuleContext | undefined | null,
): number {
  if (!rules || rules.length === 0 || !ctx) return base;
  const matched = matchFirstRule(rules, ctx);
  return matched ? applyRuleValue(matched.rule.actionType, matched.rule.value, base) : base;
}

/**
 * effectiveEntitlement — entitlement EFEKTIF satu karyawan utk satu jenis cuti
 * pada tahun saldo tertentu (fix audit 40 M-5).
 *
 * @param db        TenantDb (atau client transaksi Prisma — subset Pick).
 * @param employeeId karyawan yang dinilai.
 * @param leaveTypeId jenis cuti (id LeaveType).
 * @param year      tahun saldo periode (CALENDAR = tahun berjalan; dipakai sbg
 *                  tanggal acuan default bila `asOf` tidak dikirim: tahun
 *                  lampau → dievaluasi per 31 Des tahun tsb, tahun berjalan /
 *                  mendatang → hari ini — mirror asOf = new Date() listBalances).
 * @param asOf      tanggal acuan konteks rule (tenure/umur) — opsional; pemanggil
 *                  point-in-time WAJIB mengirim ini (mis. settlement mengirim
 *                  tanggal efektif keluar) supaya rule tenure dievaluasi pada
 *                  momen yang benar.
 * @return jumlah hari entitlement efektif (number; dasar bila jenis cuti tidak
 *         ditemukan → 0; karyawan tidak ditemukan → entitlement dasar jenis).
 */
export async function effectiveEntitlement(
  db: EntitlementDb,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  asOf?: Date,
): Promise<number> {
  const [type, rules, emp] = await Promise.all([
    db.leaveType.findUnique({ where: { id: leaveTypeId }, select: { entitlement: true } }),
    leaveTypeRules(db, [leaveTypeId]),
    db.employee.findUnique({ where: { id: employeeId }, include: EMPLOYEE_LATEST_ASSIGNMENT_INCLUDE }),
  ]);
  const base = type?.entitlement ?? 0;
  if (!type || !emp) return base; // jenis hilang → 0; karyawan hilang → dasar (konservatif)
  // Fix audit 40 K-2/M-5: assignment TERAKHIR (bukan hanya validTo null) —
  // settlement dihitung SETELAH PA menutup assignment leaver; rule kondisi
  // entity (orgUnit/position/grade/…) tetap ter evaluasi dari penempatan
  // terakhirnya, bukan null.
  const ctx = buildEmployeeRuleContext(emp as unknown as EmployeeRuleRecord, asOf ?? defaultAsOfFor(year));
  return entitlementFor(base, rules.get(leaveTypeId), ctx);
}

/** Tanggal acuan default konteks rule utk tahun saldo (dokumentasi semantik). */
function defaultAsOfFor(year: number): Date {
  const now = new Date();
  return year < now.getFullYear() ? new Date(year, 11, 31) : now;
}

/** Include employee utk konteks rule — assignment TERAKHIR tanpa filter validTo
 *  (leaver-aware, lihat catatan effectiveEntitlement). */
const EMPLOYEE_LATEST_ASSIGNMENT_INCLUDE = {
  assignments: {
    orderBy: { validFrom: "desc" as const },
    take: 1,
    include: {
      orgUnit: { select: { code: true, name: true } },
      position: { select: { code: true, title: true } },
      grade: { select: { code: true, name: true } },
      companyOffice: { select: { code: true, name: true } },
      workLocation: { select: { code: true, name: true } },
    },
  },
  positionLevel: { select: { code: true, name: true } },
  company: { select: { code: true, name: true } },
  payrollProfile: { select: { hasNpwp: true, taxStatus: true, dependents: true } },
} as const;
