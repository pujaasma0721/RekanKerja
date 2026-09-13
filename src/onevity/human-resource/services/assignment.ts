// OneVity — helper penempatan kerja (server-side)
// Semua data pekerjaan karyawan hidup di EmployeeAssignment (riwayat berperiode).
// Assignment aktif = validTo null. Endpoint API mem-flatten assignment aktif ke
// bentuk lama (orgUnit/position/grade/employmentStatus/…) agar kontrak frontend stabil.
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb, TENANT_SCHEMA_BRAND, type FieldCrypto } from "@/onevity/shared/lib/field-crypto";

/** Handle DB: client tenant penuh ATAU transaksi interaktif Prisma ($transaction). */
export type DbOrTx = TenantDb | Prisma.TransactionClient;

export type AssignmentOverrides = Partial<{
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  managerId: string | null;
  companyOfficeId: string | null;
  workLocationId: string | null;
  employmentStatus: string;
  workShift: string;
  baseSalary: number;
}>;

// include nested untuk mengambil assignment aktif bersama relasinya
export const CURRENT_ASSIGNMENT_INCLUDE = {
  assignments: {
    where: { validTo: null },
    orderBy: { validFrom: "desc" },
    take: 1,
    include: {
      orgUnit: { select: { name: true, code: true } },
      position: { select: { title: true, code: true, positionLevelId: true, positionLevel: { select: { code: true, name: true } } } },
      grade: { select: { code: true, name: true } },
      companyOffice: { select: { code: true, name: true, city: true } },
      workLocation: { select: { code: true, name: true, city: true } },
    },
  },
} as const;

type CurAssign = {
  orgUnitId: string | null; positionId: string | null; gradeId: string | null; managerId: string | null;
  companyOfficeId: string | null; workLocationId: string | null;
  employmentStatus: string; workShift: string; baseSalary: string | null; // 28-c: terenkripsi
  orgUnit: { name: string; code: string } | null;
  position: { title: string; code: string; positionLevelId: string | null; positionLevel: { code: string; name: string } | null } | null;
  grade: { code: string; name: string } | null;
  companyOffice: { code: string; name: string; city: string | null } | null;
  workLocation: { code: string; name: string; city: string | null } | null;
};

/** Dekripsi gaji pokok assignment (28-c — tersimpan enc:v1:n:…). */
export function decryptBaseSalary(tc: FieldCrypto, stored: string | null): number {
  return tc.decryptMoney(stored) ?? 0;
}

/**
 * Flatten employee + assignments[] → objek dengan field pekerjaan lama (untuk
 * response API). 28-c: baseSalary + NIK/NPWP/rekening assignment TERENKRIPSI —
 * berikan tc agar terdekripsi (baseSalary → number, identitas → teks asli);
 * tanpa tc: nilai mentah string — hanya utk pemakaian internal yang
 * mengenkripsi ulang.
 */
export function flattenEmployee<T extends { assignments?: unknown[] }>(emp: T, tc?: FieldCrypto) {
  const cur = (emp.assignments as unknown as CurAssign[] | undefined)?.[0] ?? null;
  const { assignments, ...rest } = emp as Record<string, unknown>;
  return {
    ...rest,
    // 28-c: identitas sensitif terenkripsi di DB — dekripsi di batas serializer
    // (decryptText meloloskan plaintext legacy apa adanya).
    // Task 52-d: no. BPJS ikut terenkripsi (migrate-encrypt-pii).
    nationalId: tc ? tc.decryptText((rest.nationalId as string | null) ?? null) : (rest.nationalId ?? null),
    taxId: tc ? tc.decryptText((rest.taxId as string | null) ?? null) : (rest.taxId ?? null),
    bankAccount: tc ? tc.decryptText((rest.bankAccount as string | null) ?? null) : (rest.bankAccount ?? null),
    bpjsHealth: tc ? tc.decryptText((rest.bpjsHealth as string | null) ?? null) : (rest.bpjsHealth ?? null),
    bpjsEmpSkill: tc ? tc.decryptText((rest.bpjsEmpSkill as string | null) ?? null) : (rest.bpjsEmpSkill ?? null),
    orgUnitId: cur?.orgUnitId ?? null,
    positionId: cur?.positionId ?? null,
    gradeId: cur?.gradeId ?? null,
    managerId: cur?.managerId ?? null,
    companyOfficeId: cur?.companyOfficeId ?? null,
    workLocationId: cur?.workLocationId ?? null,
    employmentStatus: cur?.employmentStatus ?? "Permanent",
    workShift: cur?.workShift ?? "Regular",
    baseSalary: cur ? (tc ? decryptBaseSalary(tc, cur.baseSalary) : (cur.baseSalary as unknown as number)) : 0,
    orgUnit: cur?.orgUnit ?? null,
    position: cur?.position ?? null,
    grade: cur?.grade ?? null,
    companyOffice: cur?.companyOffice ?? null,
    workLocation: cur?.workLocation ?? null,
    positionLevel: cur?.position?.positionLevel ?? null,
  } as unknown as Omit<T, "assignments"> & {
    orgUnitId: string | null; positionId: string | null; gradeId: string | null; managerId: string | null;
    companyOfficeId: string | null; workLocationId: string | null;
    employmentStatus: string; workShift: string; baseSalary: number;
    orgUnit: { name: string; code: string } | null;
    position: { title: string; code: string; positionLevelId: string | null; positionLevel: { code: string; name: string } | null } | null;
    grade: { code: string; name: string } | null;
    companyOffice: { code: string; name: string; city: string | null } | null;
    workLocation: { code: string; name: string; city: string | null } | null;
    positionLevel: { code: string; name: string } | null;
  };
}

/** Ambil assignment aktif seorang karyawan. */
export async function getCurrentAssignment(db: DbOrTx, employeeId: string) {
  return db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
  });
}

/**
 * Sinkronkan snapshot parameter penempatan pada Employee (orgUnit/posisi/grade/
 * level jabatan/kantor/lokasi) dari assignment aktif — parameter inilah yang
 * dipakai mesin approval berjenjang mencocokkan struktur (Task 25).
 */
export async function syncEmployeePlacementSnapshot(db: DbOrTx, employeeId: string): Promise<void> {
  const assignment = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: {
      orgUnitId: true, positionId: true, gradeId: true,
      companyOfficeId: true, workLocationId: true,
      position: { select: { positionLevelId: true } },
    },
  });
  if (!assignment) return;
  await db.employee.update({
    where: { id: employeeId },
    data: {
      orgUnitId: assignment.orgUnitId,
      positionId: assignment.positionId,
      gradeId: assignment.gradeId,
      positionLevelId: assignment.position?.positionLevelId ?? null,
      companyOfficeId: assignment.companyOfficeId,
      workLocationId: assignment.workLocationId,
    },
  });
}

/**
 * Terapkan perubahan data pekerjaan: tutup assignment aktif (validTo = effectiveDate),
 * buka assignment baru berisi gabungan data lama + perubahan. Perubahan tercatat sebagai riwayat.
 * Jika tidak ada field yang benar-benar berubah, tidak dibuat riwayat baru (idempotent).
 * 28-c: tc = konteks enkripsi per-tenant (baseSalary tersimpan terenkripsi) —
 * WAJIB diberikan bila db adalah client transaksi ($transaction) karena client
 * transaksi tidak membawa brand schema; untuk TenantDb penuh tc opsional
 * (diambil otomatis dari brand).
 */
export async function applyAssignmentChange(
  db: DbOrTx,
  employeeId: string,
  overrides: AssignmentOverrides,
  opts: { reason: string; effectiveDate: Date; sourceDocNo?: string | null; notes?: string | null },
  tc?: FieldCrypto,
) {
  const tcr = tc ?? (TENANT_SCHEMA_BRAND in (db as object) ? tenantCryptoForDb(db as TenantDb) : undefined);
  const current = await getCurrentAssignment(db, employeeId);
  if (!current) throw new Error("Karyawan tidak memiliki penempatan aktif");
  if (!tcr) {
    throw new Error("[field-crypto] applyAssignmentChange dalam $transaction tanpa konteks kunci — berikan tc dari client luar (pola payroll-service 28-c)");
  }
  // 28-c: gaji pokok lama terenkripsi — dekripsi untuk perbandingan.
  const currentBase = decryptBaseSalary(tcr, current.baseSalary);

  const merged = {
    orgUnitId: overrides.orgUnitId !== undefined && overrides.orgUnitId !== null ? overrides.orgUnitId : current.orgUnitId,
    positionId: overrides.positionId !== undefined && overrides.positionId !== null ? overrides.positionId : current.positionId,
    gradeId: overrides.gradeId !== undefined && overrides.gradeId !== null ? overrides.gradeId : current.gradeId,
    managerId: overrides.managerId !== undefined ? (overrides.managerId || null) : current.managerId,
    companyOfficeId: overrides.companyOfficeId !== undefined ? (overrides.companyOfficeId || null) : current.companyOfficeId,
    workLocationId: overrides.workLocationId !== undefined ? (overrides.workLocationId || null) : current.workLocationId,
    employmentStatus: overrides.employmentStatus ?? current.employmentStatus,
    workShift: overrides.workShift ?? current.workShift,
    baseSalary: overrides.baseSalary !== undefined ? overrides.baseSalary : currentBase,
  };

  const changed = (Object.keys(merged) as (keyof typeof merged)[]).some((k) =>
    merged[k] !== (k === "baseSalary" ? currentBase : current[k]));
  if (!changed) return { changed: false, assignment: current };

  const eff = opts.effectiveDate;
  await db.employeeAssignment.update({ where: { id: current.id }, data: { validTo: eff } });
  const assignment = await db.employeeAssignment.create({
    data: {
      employeeId,
      ...merged,
      // 28-c: gaji pokok disimpan TERENKRIPSI (enc:v1:n:…).
      baseSalary: tcr.encryptMoney(merged.baseSalary),
      validFrom: eff,
      validTo: null,
      changeReason: opts.reason,
      sourceDocNo: opts.sourceDocNo ?? null,
      notes: opts.notes ?? null,
    },
  });
  // dorong snapshot parameter penempatan pada Employee (dimensi approval berjenjang)
  await syncEmployeePlacementSnapshot(db, employeeId);
  return { changed: true, assignment };
}

/** Tutup assignment aktif (offboarding / penghentian). */
export async function closeCurrentAssignment(db: DbOrTx, employeeId: string, validTo: Date) {
  await db.employeeAssignment.updateMany({
    where: { employeeId, validTo: null },
    data: { validTo },
  });
}

export const CHANGE_REASON_LABEL: Record<string, string> = {
  Initial: "Penempatan Awal",
  Promotion: "Promosi",
  Demotion: "Demosi",
  Transfer: "Transfer",
  Mutation: "Mutasi",
  SalaryAdjustment: "Penyesuaian Upah",
  ChangeStatus: "Perubahan Status",
  ContractRenewal: "Perpanjangan Kontrak",
  ExtendProbation: "Perpanjangan Probation",
  ManualEdit: "Perubahan Manual",
};

// ============ Task 64 — riwayat template upah effective-dated ============

/**
 * Tulis pergantian template upah karyawan sebagai riwayat berperiode: baris
 * aktif lama ditutup (validTo = efektif − 1 hari — validTo EKSKLUSIF seperti
 * EmployeeAssignment) dan baris baru dibuka (validFrom = efektif). Idempoten:
 * bila template efektif pada tanggal tsb sudah sama, tidak menulis apa pun.
 * `eff` boleh backdated (retroaktif) — pembacaan run payroll selalu menilai
 * versi berdasarkan rentang [validFrom, validTo).
 */
export async function applyWageTemplateChange(
  db: DbOrTx,
  employeeId: string,
  wageTemplateId: string | null,
  opts: { effectiveDate: Date; reason: string; sourceDocNo?: string | null; notes?: string | null },
): Promise<{ changed: boolean }> {
  const eff = new Date(opts.effectiveDate);
  eff.setHours(0, 0, 0, 0);
  const open = await db.employeeWageTemplateHistory.findFirst({
    where: { employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
  });
  if (open) {
    const openFrom = new Date(open.validFrom);
    openFrom.setHours(0, 0, 0, 0);
    // Idempoten: template efektif sudah sama → tidak ada perubahan.
    if (open.wageTemplateId === wageTemplateId && openFrom.getTime() <= eff.getTime()) return { changed: false };
    // Jangan tutup bila efektif ≤ mulai baris aktif (data anomali/backdate
    // sebelum baris aktif) — hindari validTo < validFrom.
    if (eff > openFrom) {
      const closeTo = new Date(eff.getTime() - 86_400_000);
      await db.employeeWageTemplateHistory.update({ where: { id: open.id }, data: { validTo: closeTo } });
    }
  }
  await db.employeeWageTemplateHistory.create({
    data: {
      employeeId,
      wageTemplateId,
      validFrom: eff,
      changeReason: opts.reason,
      sourceDocNo: opts.sourceDocNo ?? null,
      notes: opts.notes ?? null,
    },
  });
  return { changed: true };
}
