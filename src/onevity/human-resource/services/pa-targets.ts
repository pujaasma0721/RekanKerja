// OneVity — resolusi target struktural Personnel Action dari detailJson (fix audit K-01).
// Kontrak BARU (dialog create/edit): detail memuat ID — positionId / orgUnitId / gradeId —
// sekaligus KODE (toPosition / toUnit / newGrade) untuk kebutuhan display.
// Kontrak LAMA (data demo/seed sebelum fix): hanya berisi KODE → fallback resolve code→id
// supaya PA lama tetap bisa diproses tanpa migrasi data.
// ID/kode yang tidak resoluble di master → error ramah (400 di handler), bukan 500/diam-diam.
import type { DbOrTx } from "@/onevity/human-resource/services/assignment";

export interface StructuralTargets {
  positionId?: string;
  orgUnitId?: string;
  gradeId?: string;
  // Task 64 — target penempatan fisik utk Transfer/Mutation: pindah office/
  // lokasi menengah bulan mencipta segmen prorate di run payroll.
  companyOfficeId?: string;
  workLocationId?: string;
}

export interface GradeRange {
  minSalary: number;
  maxSalary: number;
}

const nonEmpty = (v: unknown): string | null =>
  v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim();

/** Error validasi target — handler memetakan ke HTTP 400 dengan pesan ramah. */
export class PATargetError extends Error {}

/**
 * Resolve target posisi/unit/grade dari detail PA.
 * Urutan: ID eksplisit (positionId/orgUnitId/gradeId) → fallback KODE lama
 * (toPosition/toUnit/newGrade). Throws PATargetError bila nilai tidak resoluble.
 */
export async function resolveStructuralTargets(
  db: DbOrTx,
  detail: Record<string, unknown>,
  opts: { requireTarget?: boolean } = {},
): Promise<StructuralTargets> {
  const targets: StructuralTargets = {};

  // ---- posisi ----
  const posId = nonEmpty(detail.positionId);
  if (posId) {
    const p = await db.position.findUnique({ where: { id: posId }, select: { id: true, code: true } });
    if (!p) throw new PATargetError(`Posisi tujuan tidak dikenal (id "${posId}") — periksa kembali detail dokumen`);
    targets.positionId = p.id;
  } else {
    const posCode = nonEmpty(detail.toPosition);
    if (posCode) {
      const p = await db.position.findUnique({ where: { code: posCode }, select: { id: true } });
      if (!p) throw new PATargetError(`Kode posisi "${posCode}" tidak ditemukan di master posisi`);
      targets.positionId = p.id;
    }
  }

  // ---- unit organisasi ----
  const unitId = nonEmpty(detail.orgUnitId);
  if (unitId) {
    const u = await db.orgUnit.findUnique({ where: { id: unitId }, select: { id: true, code: true } });
    if (!u) throw new PATargetError(`Unit organisasi tujuan tidak dikenal (id "${unitId}") — periksa kembali detail dokumen`);
    targets.orgUnitId = u.id;
  } else {
    const unitCode = nonEmpty(detail.toUnit);
    if (unitCode) {
      const u = await db.orgUnit.findUnique({ where: { code: unitCode }, select: { id: true } });
      if (!u) throw new PATargetError(`Kode unit organisasi "${unitCode}" tidak ditemukan di master unit`);
      targets.orgUnitId = u.id;
    }
  }

  // ---- grade ----
  const gradeId = nonEmpty(detail.gradeId);
  if (gradeId) {
    const g = await db.grade.findUnique({ where: { id: gradeId }, select: { id: true, code: true } });
    if (!g) throw new PATargetError(`Grade tujuan tidak dikenal (id "${gradeId}") — periksa kembali detail dokumen`);
    targets.gradeId = g.id;
  } else {
    const gradeCode = nonEmpty(detail.newGrade);
    if (gradeCode) {
      const g = await db.grade.findUnique({ where: { code: gradeCode }, select: { id: true } });
      if (!g) throw new PATargetError(`Kode grade "${gradeCode}" tidak ditemukan di master grade`);
      targets.gradeId = g.id;
    }
  }

  // ---- Task 64 — office / lokasi kerja (Transfer/Mutation) ----
  const officeId = nonEmpty(detail.companyOfficeId);
  if (officeId) {
    const o = await db.companyOffice.findUnique({ where: { id: officeId }, select: { id: true } });
    if (!o) throw new PATargetError(`Kantor tujuan tidak dikenal (id "${officeId}") — periksa kembali detail dokumen`);
    targets.companyOfficeId = o.id;
  }
  const locId = nonEmpty(detail.workLocationId);
  if (locId) {
    const l = await db.workLocation.findUnique({ where: { id: locId }, select: { id: true } });
    if (!l) throw new PATargetError(`Lokasi kerja tujuan tidak dikenal (id "${locId}") — periksa kembali detail dokumen`);
    targets.workLocationId = l.id;
  }

  // deteksi no-op (K-01): PA struktural wajib punya minimal satu target valid —
  // tolak keras saat process, jangan tandai Processed diam-diam tanpa efek.
  if (opts.requireTarget && !targets.positionId && !targets.orgUnitId && !targets.gradeId && !targets.companyOfficeId && !targets.workLocationId) {
    throw new PATargetError(
      "Perubahan struktural tanpa target: dokumen Promotion/Demotion/Transfer/Mutation wajib memiliki posisi, unit, grade, kantor, atau lokasi tujuan yang valid sebelum diproses",
    );
  }

  return targets;
}

/**
 * Validasi gaji baru terhadap rentang min/max grade (fix audit M-05/M-06).
 * Grade yang dipakai = grade TUJUAN bila ada (gradeId/newGrade), selain itu grade saat ini
 * (assignment aktif karyawan). Grade tanpa rentang (maxSalary ≤ 0) dianggap tidak
 * mendefinisikan range → dilewati.
 */
export async function validateSalaryAgainstGrade(
  db: DbOrTx,
  newSalary: number,
  detail: Record<string, unknown>,
  employeeId: string,
): Promise<void> {
  if (!Number.isFinite(newSalary) || newSalary <= 0) {
    throw new PATargetError("Gaji pokok baru harus berupa angka lebih dari 0");
  }
  let grade: { minSalary: number; maxSalary: number; code: string } | null = null;
  const gradeId = nonEmpty(detail.gradeId);
  const gradeCode = nonEmpty(detail.newGrade);
  if (gradeId) {
    grade = await db.grade.findUnique({ where: { id: gradeId }, select: { minSalary: true, maxSalary: true, code: true } });
    if (!grade) throw new PATargetError(`Grade tujuan tidak dikenal (id "${gradeId}") — periksa kembali detail dokumen`);
  } else if (gradeCode) {
    grade = await db.grade.findUnique({ where: { code: gradeCode }, select: { minSalary: true, maxSalary: true, code: true } });
    if (!grade) throw new PATargetError(`Kode grade "${gradeCode}" tidak ditemukan di master grade`);
  } else {
    const cur = await db.employeeAssignment.findFirst({
      where: { employeeId, validTo: null },
      orderBy: { validFrom: "desc" },
      select: { grade: { select: { minSalary: true, maxSalary: true, code: true } } },
    });
    grade = cur?.grade ?? null;
  }
  if (!grade || grade.maxSalary <= 0) return; // grade tidak mendefinisikan rentang
  if (newSalary < grade.minSalary || newSalary > grade.maxSalary) {
    throw new PATargetError(
      `Gaji pokok baru (${newSalary.toLocaleString("id-ID")}) di luar rentang grade ${grade.code} (Rp ${grade.minSalary.toLocaleString("id-ID")} – Rp ${grade.maxSalary.toLocaleString("id-ID")})`,
    );
  }
}
