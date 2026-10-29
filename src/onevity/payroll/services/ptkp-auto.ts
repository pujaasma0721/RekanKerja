// OneVity — PTKP OTOMATIS DARI DATA KELUARGA (Task 49) ====================
// ========================================================================
// Status PTKP karyawan diturunkan dari data keluarga (EmployeeFamily) yang
// tersimpan sebagai tanggungan, sesuai peraturan perpajakan Indonesia:
//
//   · UU PPh Pasal 7 ayat (1) + PMK 101/2016 (besaran PTKP — masih berlaku
//     s.d. TA 2026; PMK 168/2023 adalah aturan TEKNIS PPh21/TER, BUKAN
//     pengatur besaran PTKP — F-08 BPA-AUDIT-53):
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
//   · KEBIJAKAN SNAPSHOT TAHUNAN (Task 50, keputusan pemilik produk):
//     PTKP yang BERLAKU di payroll = hasil refresh tahunan (snapshot).
//     Penambahan/pengurangan pasangan atau tanggungan DI TENGAH TAHUN
//     TIDAK mengubah PTKP efektif — perubahan tersebut hanya diterapkan
//     pada refresh 1 Januari TAHUN BERIKUTNYA. Mutasi data keluarga
//     (family CRUD) karenanya TIDAK menulis taxStatus; ia hanya memperbarui
//     *saran* (dihitung on-the-fly saat GET). PTKP efektif hanya berubah
//     lewat: (1) refresh tahunan scheduler, (2) koreksi eksplisit admin
//     (tombol sinkron massal / PATCH manual), atau (3) pengisian awal saat
//     profil dibuat/diaktifkan ke mode "auto".
//
// SUMBER: profile.ptkpSource — "auto" (snapshot data keluarga saat refresh
// 1 Januari / aktivasi; saran keluarga dihitung ulang tiap GET untuk
// pratinjau tahun berikutnya) atau "manual" (ditetapkan admin; tidak
// pernah disentuh sinkronisasi).
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

/** Info perubahan PTKP TERTUNDA untuk satu karyawan (Task 50).
 *  Dihitung TANPA menulis DB — dipakai respons family API agar UI
 *  memberi tahu "berlaku 1 Jan tahun depan" saat keluarga berubah. */
export interface PtkpPendingInfo {
  source: "auto"; // hanya profil bersumber auto yang punya saran tertunda
  current: string; // PTKP efektif saat ini (snapshot — dipakai payroll)
  next: string; // saran data keluarga terkini (berlaku 1 Jan tahun depan)
  dependents: number; // tanggungan hasil derivasi (0..3)
  nextYear: number; // tahun pajak berikutnya (refresh 1 Jan)
}

/**
 * Hitung saran PTKP tertunda satu karyawan TANPA menulis DB (Task 50:
 * mutasi keluarga tidak mengubah PTKP efektif — perubahan berlaku pada
 * refresh 1 Januari tahun berikutnya). Profil "manual" / belum ada → null
 * (tidak ada saran tertunda). `next === current` berarti tidak ada
 * perubahan yang menunggu tahun depan.
 */
export async function ptkpPendingForEmployee(
  db: TenantDb,
  employeeId: string,
): Promise<PtkpPendingInfo | null> {
  const profile = await db.employeePayrollProfile.findUnique({
    where: { employeeId },
  });
  if (!profile || profile.ptkpSource !== "auto") return null;

  const suggestion = await suggestPtkpForEmployee(db, employeeId);
  if (!suggestion) return null;

  return {
    source: "auto",
    current: profile.taxStatus,
    next: suggestion.taxStatus,
    dependents: suggestion.dependents,
    nextYear: new Date().getFullYear() + 1,
  };
}

export interface PtkpBulkResult {
  employees: number; // karyawan aktif diperiksa
  changed: number; // berubah status
  changes: PtkpSyncResult[]; // hanya yang berubah
}

/** Sinkronkan SEMUA profil "auto" karyawan aktif — dipakai refresh tahunan
 * 1 Januari (scheduler) + koreksi eksplisit admin. Membaca ulang data
 * keluarga terkini dan menulis PTKP efektif baru (snapshot tahun ini). */
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
