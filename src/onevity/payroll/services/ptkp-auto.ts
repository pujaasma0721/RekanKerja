// OneVity — PTKP OTOMATIS DARI DATA KELUARGA (Task 49) ====================
// ========================================================================
// Status PTKP karyawan diturunkan dari data keluarga (EmployeeFamily) yang
// tersimpan sebagai tanggungan, sesuai peraturan perpajakan Indonesia:
//
//   · UU PPh Pasal 7 ayat (1) + PMK 168/2023 (berlaku sejak TA 2024):
//     - PTKP diri WP: Rp 54.000.000 (TK/0)
//     - Kawin (suami/istri tanggungan): +Rp 4.500.000 → K/0
//     - Setiap tanggungan: +Rp 4.500.000, PALING BANYAK 3 ORANG.
//   · Tanggungan = "anggota keluarga sedarah dan keluarga semenda dalam
//     garis keturunan lurus serta anak angkat yang menjadi tanggungan" —
//     dalam model EmployeeFamily (Spouse|Child|Parent|Sibling) yang
//     memenuhi: Child (garis lurus ke bawah) & Parent (garis lurus ke
//     atas). Sibling TIDAK termasuk (garis samping). Anak angkat
//     dimodelkan sebagai Child.
//   · Status kawin ditentukan oleh: ada record keluarga relasi "Spouse"
//     ATAU Employee.maritalStatus = "Menikah" (status kawin adalah fakta
//     catatan sipil — tidak bergantung kelengkapan record keluarga di HRIS).
//   · K/I (kawin, penghasilan pasangan digabung — huruf c, +Rp 54jt utk
//     pasangan) TIDAK dapat diturunkan otomatis: bergantung pilihan
//     penggabungan penghasilan pasangan → profil K/I tetap "manual".
//   · UU PPh Pasal 7 ayat (2): perubahan status kawin/tanggungan berlaku
//     untuk pemotongan bulanan sejak bulan BERIKUTNYA setelah perubahan.
//     Sinkronisasi di HRIS memperbarui profil segera saat data keluarga
//     berubah; pemotongan pajak memakai status profil saat payroll run
//     berjalan (admin menjaga cut-off data).
//   · REFRESH TAHUNAN (permintaan pemilik produk): seluruh profil "auto"
//     dihitung ulang setiap awal tahun pajak (1 Januari) oleh job
//     scheduler "ptkp-tahunan" (marker ActivityLog per tahun).
//
// SUMBER: profile.ptkpSource — "auto" (turunan data keluarga; disinkronkan
// saat family CRUD + refresh 1 Januari + sinkronisasi manual admin) atau
// "manual" (ditetapkan admin; tidak pernah disentuh sinkronisasi).
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

/** Bentuk minimal record EmployeeFamily yang dipakai derivasi. */
export interface PtkpFamilyInput {
  relation: string;
  isDependent: boolean;
}

/** Hasil derivasi PTKP dari data keluarga. */
export interface PtkpDerived {
  taxStatus: string; // TK0..TK3 | K0..K3 (tidak pernah KI* — manual)
  dependents: number; // 0..3 (dibatasi aturan)
  spouse: boolean; // ada pasangan (record Spouse / marital Menikah)
  tanggungan: number; // jumlah tanggungan nyata sebelum clamp 3
}

/** Relasi EmployeeFamily yang menghitung sebagai TANGGUNGAN PTKP
 *  (keluarga sedarah/semenda garis keturunan LURUS; Sibling dikecualikan). */
const TANGGUNGAN_RELATIONS = new Set(["Child", "Parent"]);

/** Derivasi status PTKP dari data keluarga + status perkawinan karyawan. */
export function derivePtkpFromFamily(
  family: PtkpFamilyInput[],
  maritalStatus?: string | null,
): PtkpDerived {
  const spouse =
    family.some((f) => f.relation === "Spouse") || maritalStatus === "Menikah";
  const tanggungan = family.filter(
    (f) => f.isDependent && TANGGUNGAN_RELATIONS.has(f.relation),
  ).length;
  const dependents = Math.min(3, tanggungan);
  const taxStatus = `${spouse ? "K" : "TK"}${dependents}`;
  return { taxStatus, dependents, spouse, tanggungan };
}

/** Saran PTKP satu karyawan (data keluarga + marital) — tanpa menulis DB. */
export async function suggestPtkpForEmployee(
  db: TenantDb,
  employeeId: string,
): Promise<PtkpDerived | null> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { maritalStatus: true, family: { select: { relation: true, isDependent: true } } },
  });
  if (!emp) return null;
  return derivePtkpFromFamily(emp.family, emp.maritalStatus);
}

export interface PtkpSyncResult {
  employeeId: string;
  employeeName: string;
  changed: boolean;
  from: string;
  to: string;
}

/**
 * Sinkronkan SATU karyawan (profil bersumber "auto" saja): hitung ulang
 * taxStatus + dependents dari data keluarga terkini, tulis bila berubah
 * (+ ActivityLog jejak audit). Profil "manual" / belum ada → null (tidak
 * disentuh). Kembalikan hasil untuk respons API / toast UI.
 */
export async function syncEmployeePtkpAuto(
  db: TenantDb,
  employeeId: string,
): Promise<PtkpSyncResult | null> {
  const profile = await db.employeePayrollProfile.findUnique({ where: { employeeId } });
  if (!profile || profile.ptkpSource !== "auto") return null;

  const suggestion = await suggestPtkpForEmployee(db, employeeId);
  if (!suggestion) return null;

  const changed =
    profile.taxStatus !== suggestion.taxStatus || profile.dependents !== suggestion.dependents;
  if (changed) {
    await db.employeePayrollProfile.update({
      where: { employeeId },
      data: { taxStatus: suggestion.taxStatus, dependents: suggestion.dependents },
    });
    await db.activityLog.create({
      data: {
        actorType: "system",
        action: "Updated",
        entity: "EmployeePayrollProfile",
        entityId: profile.id,
        employeeId,
        detail: `PTKP otomatis dari data keluarga: ${profile.taxStatus} → ${suggestion.taxStatus} (pasangan: ${suggestion.spouse ? "ya" : "tidak"}, tanggungan: ${suggestion.tanggungan})`,
      },
    });
  }
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { fullName: true },
  });
  return {
    employeeId,
    employeeName: emp?.fullName ?? employeeId,
    changed,
    from: profile.taxStatus,
    to: suggestion.taxStatus,
  };
}

export interface PtkpBulkResult {
  employees: number; // karyawan aktif diperiksa
  changed: number; // berubah status
  changes: PtkpSyncResult[]; // hanya yang berubah
}

/** Sinkronkan SEMUA profil "auto" karyawan aktif (dipakai refresh tahunan
 *  + tombol sinkron admin). Membaca ulang data keluarga terkini. */
export async function syncAllPtkpAuto(db: TenantDb): Promise<PtkpBulkResult> {
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    select: {
      id: true,
      fullName: true,
      maritalStatus: true,
      family: { select: { relation: true, isDependent: true } },
      payrollProfile: { select: { id: true, taxStatus: true, dependents: true, ptkpSource: true } },
    },
    orderBy: { employeeNo: "asc" },
  });
  const changes: PtkpSyncResult[] = [];
  let checked = 0;
  for (const emp of employees) {
    const p = emp.payrollProfile;
    if (!p || p.ptkpSource !== "auto") continue;
    checked++;
    const suggestion = derivePtkpFromFamily(emp.family, emp.maritalStatus);
    if (p.taxStatus !== suggestion.taxStatus || p.dependents !== suggestion.dependents) {
      await db.employeePayrollProfile.update({
        where: { employeeId: emp.id },
        data: { taxStatus: suggestion.taxStatus, dependents: suggestion.dependents },
      });
      await db.activityLog.create({
        data: {
          actorType: "system",
          action: "Updated",
          entity: "EmployeePayrollProfile",
          entityId: p.id,
          employeeId: emp.id,
          detail: `PTKP otomatis dari data keluarga: ${p.taxStatus} → ${suggestion.taxStatus} (pasangan: ${suggestion.spouse ? "ya" : "tidak"}, tanggungan: ${suggestion.tanggungan})`,
        },
      });
      changes.push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        changed: true,
        from: p.taxStatus,
        to: suggestion.taxStatus,
      });
    }
  }
  return { employees: checked, changed: changes.length, changes };
}

export interface PtkpBulkApplyResult extends PtkpBulkResult {
  autoEnabled: number; // profil yang dialihkan manual → auto
  preservedKi: string[]; // nama karyawan K/I yang DIBIARKAN manual (by design)
}

/**
 * Ops-in massal "Sinkronkan Semua dari Data Keluarga" (tombol admin):
 *   1. alihkan ptkpSource → "auto" untuk SEMUA profil aktif KECUALI K/I
 *      (KI0..KI3 — penggabungan penghasilan pasangan adalah pilihan manual,
 *      tidak dapat diturunkan dari data keluarga);
 *   2. sinkronkan seluruh profil auto dari data keluarga terkini.
 * dryRun=true → hanya hitung rencana (UI pratinjau), TANPA menulis.
 */
export async function applyPtkpAutoToAll(
  db: TenantDb,
  dryRun = false,
): Promise<PtkpBulkApplyResult> {
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    select: {
      id: true,
      fullName: true,
      maritalStatus: true,
      family: { select: { relation: true, isDependent: true } },
      payrollProfile: { select: { id: true, taxStatus: true, dependents: true, ptkpSource: true } },
    },
    orderBy: { employeeNo: "asc" },
  });
  let autoEnabled = 0;
  const preservedKi: string[] = [];
  const changes: PtkpSyncResult[] = [];
  let checked = 0;
  for (const emp of employees) {
    const p = emp.payrollProfile;
    if (!p) continue;
    if (/^KI[0-3]$/.test(p.taxStatus) && p.ptkpSource !== "auto") {
      // K/I manual by design — jangan dialihkan otomatis.
      preservedKi.push(emp.fullName);
      continue;
    }
    const willBeAuto = true; // semua non-KI dialihkan auto
    const suggestion = derivePtkpFromFamily(emp.family, emp.maritalStatus);
    if (!dryRun) {
      const data: { ptkpSource: string; taxStatus?: string; dependents?: number } = {
        ptkpSource: "auto",
      };
      const changed =
        p.taxStatus !== suggestion.taxStatus || p.dependents !== suggestion.dependents;
      if (changed) {
        data.taxStatus = suggestion.taxStatus;
        data.dependents = suggestion.dependents;
      }
      if (p.ptkpSource !== "auto" || changed) {
        await db.employeePayrollProfile.update({ where: { employeeId: emp.id }, data });
      }
      if (p.ptkpSource !== "auto") autoEnabled++;
      if (changed) {
        await db.activityLog.create({
          data: {
            actorType: "system",
            action: "Updated",
            entity: "EmployeePayrollProfile",
            entityId: p.id,
            employeeId: emp.id,
            detail: `PTKP otomatis dari data keluarga: ${p.taxStatus} → ${suggestion.taxStatus} (pasangan: ${suggestion.spouse ? "ya" : "tidak"}, tanggungan: ${suggestion.tanggungan})`,
          },
        });
      }
    } else {
      if (p.ptkpSource !== "auto") autoEnabled++;
    }
    checked++;
    if (p.taxStatus !== suggestion.taxStatus || p.dependents !== suggestion.dependents) {
      changes.push({
        employeeId: emp.id,
        employeeName: emp.fullName,
        changed: true,
        from: p.taxStatus,
        to: suggestion.taxStatus,
      });
    }
    void willBeAuto;
  }
  return { employees: checked, changed: changes.length, changes, autoEnabled, preservedKi };
}
