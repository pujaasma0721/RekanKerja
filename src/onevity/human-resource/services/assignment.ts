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
  if (!tcr) {
    throw new Error("[field-crypto] applyAssignmentChange dalam $transaction tanpa konteks kunci — berikan tc dari client luar (pola payroll-service 28-c)");
  }
  // Task 64-fix — perubahan BACKDATED (efektif di tengah rantai versi) harus
  // menyisip versi baru dengan NILAI YANG BERLAKU pada tanggal efektif — bukan
  // menggabungkan nilai versi terbuka terakhir yang bisa berupa perubahan
  // ber-future-date (gaji efektif Okt tidak boleh bocor ke PA eff pertengahan
  // Sep). Versi-versi SETELAH tanggal efektif dipertahankan apa adanya.
  const all = await db.employeeAssignment.findMany({
    where: { employeeId },
    orderBy: { validFrom: "asc" },
  });
  if (all.length === 0) throw new Error("Karyawan tidak memiliki penempatan aktif");
  const eff = opts.effectiveDate;
  let idx = -1;
  for (let i = 0; i < all.length; i++) {
    if (new Date(all[i].validFrom).getTime() <= eff.getTime()) idx = i;
    else break;
  }
  const base = idx >= 0 ? all[idx] : all[0];
  // 28-c: gaji pokok versi dasar terenkripsi — dekripsi untuk perbandingan.
  const baseBase = decryptBaseSalary(tcr, base.baseSalary);

  const merged = {
    orgUnitId: overrides.orgUnitId !== undefined && overrides.orgUnitId !== null ? overrides.orgUnitId : base.orgUnitId,
    positionId: overrides.positionId !== undefined && overrides.positionId !== null ? overrides.positionId : base.positionId,
    gradeId: overrides.gradeId !== undefined && overrides.gradeId !== null ? overrides.gradeId : base.gradeId,
    managerId: overrides.managerId !== undefined ? (overrides.managerId || null) : base.managerId,
    companyOfficeId: overrides.companyOfficeId !== undefined ? (overrides.companyOfficeId || null) : base.companyOfficeId,
    workLocationId: overrides.workLocationId !== undefined ? (overrides.workLocationId || null) : base.workLocationId,
    employmentStatus: overrides.employmentStatus ?? base.employmentStatus,
    workShift: overrides.workShift ?? base.workShift,
    baseSalary: overrides.baseSalary !== undefined ? overrides.baseSalary : baseBase,
  };

  const changed = (Object.keys(merged) as (keyof typeof merged)[]).some((k) =>
    merged[k] !== (k === "baseSalary" ? baseBase : base[k]));
  if (!changed) return { changed: false, assignment: base };

  const baseFrom = new Date(base.validFrom);
  if (eff.getTime() <= baseFrom.getTime()) {
    // Efektif tepat di mulai versi dasar → perbarui versi dasar apa adanya
    // (rentangnya dipertahankan; versi penerus tetap berlaku).
    const assignment = await db.employeeAssignment.update({
      where: { id: base.id },
      data: { ...merged, baseSalary: tcr.encryptMoney(merged.baseSalary) },
    });
    await syncEmployeePlacementSnapshot(db, employeeId);
    return { changed: true, assignment };
  }
  // Sisip versi baru pada eff: versi dasar ditutup di eff, versi baru mewarisi
  // batas akhir versi dasar (null = tetap terbuka; atau tanggal versi penerus
  // — rantai tetap utuh). run payroll membaca versi per tanggal → segmen
  // otomatis terbentuk di tanggal eff.
  await db.employeeAssignment.update({ where: { id: base.id }, data: { validTo: eff } });
  const assignment = await db.employeeAssignment.create({
    data: {
      employeeId,
      ...merged,
      // 28-c: gaji pokok disimpan TERENKRIPSI (enc:v1:n:…).
      baseSalary: tcr.encryptMoney(merged.baseSalary),
      validFrom: eff,
      validTo: base.validTo,
      changeReason: opts.reason,
      sourceDocNo: opts.sourceDocNo ?? null,
      notes: opts.notes ?? null,
    },
  });
  // Task 64-fix — patch-maju: override berlaku dari eff KEDepAN juga — versi
  // SETELAH base yang masih membawa nilai LAMA pada field yang di-override
  // diperbarui dengan nilai baru (versi penerus yang berbeda secara sengaja
  // dipertahankan). Contoh: transfer eff 12 Sep tetap berlaku di versi Okt
  // meskipun PA kenaikan gaji (eff 1 Okt) diproses lebih dulu.
  for (const later of all.slice(idx + 1)) {
    const laterData: Record<string, unknown> = {};
    if (overrides.orgUnitId != null && later.orgUnitId === base.orgUnitId && merged.orgUnitId !== later.orgUnitId) laterData.orgUnitId = merged.orgUnitId;
    if (overrides.positionId != null && later.positionId === base.positionId && merged.positionId !== later.positionId) laterData.positionId = merged.positionId;
    if (overrides.gradeId != null && later.gradeId === base.gradeId && merged.gradeId !== later.gradeId) laterData.gradeId = merged.gradeId;
    if (overrides.managerId !== undefined && later.managerId === base.managerId && merged.managerId !== later.managerId) laterData.managerId = merged.managerId;
    if (overrides.companyOfficeId !== undefined && later.companyOfficeId === base.companyOfficeId && merged.companyOfficeId !== later.companyOfficeId) laterData.companyOfficeId = merged.companyOfficeId;
    if (overrides.workLocationId !== undefined && later.workLocationId === base.workLocationId && merged.workLocationId !== later.workLocationId) laterData.workLocationId = merged.workLocationId;
    if (overrides.employmentStatus != null && later.employmentStatus === base.employmentStatus && merged.employmentStatus !== later.employmentStatus) laterData.employmentStatus = merged.employmentStatus;
    if (overrides.workShift != null && later.workShift === base.workShift && merged.workShift !== later.workShift) laterData.workShift = merged.workShift;
    if (overrides.baseSalary !== undefined && decryptBaseSalary(tcr, later.baseSalary) === baseBase && merged.baseSalary !== baseBase) {
      laterData.baseSalary = tcr.encryptMoney(merged.baseSalary);
    }
    if (Object.keys(laterData).length > 0) {
      await db.employeeAssignment.update({ where: { id: later.id }, data: laterData });
    }
  }
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

/**
 * Koreksi langsung SATU baris riwayat gaji (EmployeeAssignment) — untuk salah
 * ketik nilai/tanggal pada versi yang tidak punya movement proses di belakangnya
 * (bukan mengganti hasil PA/kenaikan — itu lewat Personnel Action).
 * Guard rantai: validFrom < validTo tetangga (null = terbuka) — mencegah
 * rantai versi rusak (validTo < validFrom) akibat edit tanggal.
 */
export async function correctAssignmentRow(
  db: DbOrTx,
  rowId: string,
  patch: { baseSalary?: number; validFrom?: Date; validTo?: Date | null; notes?: string | null },
  tcr: FieldCrypto,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.employeeAssignment.findUnique({ where: { id: rowId } });
  if (!row) return { ok: false, error: "Baris riwayat tidak ditemukan" };
  const all = await db.employeeAssignment.findMany({
    where: { employeeId: row.employeeId },
    orderBy: { validFrom: "asc" },
  });
  const i = all.findIndex((r) => r.id === rowId);
  const prev = i > 0 ? all[i - 1] : null;
  const next = i >= 0 && i < all.length - 1 ? all[i + 1] : null;

  const nf = patch.validFrom ?? new Date(row.validFrom);
  const nt = patch.validTo === undefined ? (row.validTo ? new Date(row.validTo) : null) : patch.validTo;
  if (nt && nt.getTime() <= nf.getTime()) return { ok: false, error: "Tanggal berakhir harus setelah tanggal mulai" };
  // validFrom tidak boleh menabrak versi sebelumnya (validTo prev eksklusif = nf berarti mulai keesokan harinya sah)
  if (prev && new Date(prev.validTo ?? nf).getTime() > nf.getTime())
    return { ok: false, error: "Tanggal mulai bentrok dengan versi sebelumnya" };
  // validTo tidak boleh melewati mulai versi berikutnya (eksklusif: = mulai next sah)
  if (next && nt && new Date(next.validFrom).getTime() < nt.getTime())
    return { ok: false, error: "Tanggal berakhir melewati awal versi berikutnya" };

  const data: Record<string, unknown> = {};
  if (patch.baseSalary !== undefined) data.baseSalary = tcr.encryptMoney(patch.baseSalary);
  if (patch.validFrom !== undefined) data.validFrom = nf;
  if (patch.validTo !== undefined) data.validTo = nt;
  if (patch.notes !== undefined) data.notes = patch.notes;
  await db.employeeAssignment.update({ where: { id: rowId }, data });
  return { ok: true };
}

/**
 * Koreksi langsung SATU baris riwayat PENEMPATAN (EmployeeAssignment) untuk field
 * pekerjaan non-upah — salah input posisi/unit/grade/atasan/status/shift pada
 * versi tanpa movement proses di belakangnya (human error, bukan pengganti
 * Personnel Action). Guard rantai sama dengan correctAssignmentRow; nilai baris
 * DILUAR patch dipertahankan apa adanya. Setiap koreksi meninggalkan ActivityLog
 * di pemanggil (API layer).
 */
export async function correctJobRow(
  db: DbOrTx,
  rowId: string,
  patch: {
    orgUnitId?: string | null; positionId?: string | null; gradeId?: string | null;
    managerId?: string | null; employmentStatus?: string; workShift?: string;
    validFrom?: Date; validTo?: Date | null; notes?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.employeeAssignment.findUnique({ where: { id: rowId } });
  if (!row) return { ok: false, error: "Baris riwayat tidak ditemukan" };
  const all = await db.employeeAssignment.findMany({
    where: { employeeId: row.employeeId },
    orderBy: { validFrom: "asc" },
  });
  const i = all.findIndex((r) => r.id === rowId);
  const prev = i > 0 ? all[i - 1] : null;
  const next = i >= 0 && i < all.length - 1 ? all[i + 1] : null;

  const nf = patch.validFrom ?? new Date(row.validFrom);
  const nt = patch.validTo === undefined ? (row.validTo ? new Date(row.validTo) : null) : patch.validTo;
  if (nt && nt.getTime() <= nf.getTime()) return { ok: false, error: "Tanggal berakhir harus setelah tanggal mulai" };
  if (prev && new Date(prev.validTo ?? nf).getTime() > nf.getTime())
    return { ok: false, error: "Tanggal mulai bentrok dengan versi sebelumnya" };
  if (next && nt && new Date(next.validFrom).getTime() < nt.getTime())
    return { ok: false, error: "Tanggal berakhir melewati awal versi berikutnya" };

  const data: Record<string, unknown> = {};
  if (patch.orgUnitId !== undefined) data.orgUnitId = patch.orgUnitId || null;
  if (patch.positionId !== undefined) data.positionId = patch.positionId || null;
  if (patch.gradeId !== undefined) data.gradeId = patch.gradeId || null;
  if (patch.managerId !== undefined) data.managerId = patch.managerId || null;
  if (patch.employmentStatus !== undefined) data.employmentStatus = patch.employmentStatus;
  if (patch.workShift !== undefined) data.workShift = patch.workShift;
  if (patch.validFrom !== undefined) data.validFrom = nf;
  if (patch.validTo !== undefined) data.validTo = nt;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (Object.keys(data).length === 0) return { ok: true };
  await db.employeeAssignment.update({ where: { id: rowId }, data });
  // snapshot penempatan Employee hanya relevan bila baris yang dikoreksi adalah
  // versi AKTIF (validTo null) — mirror applyAssignmentChange.
  if (row.validTo === null) await syncEmployeePlacementSnapshot(db, row.employeeId);
  return { ok: true };
}

/**
 * Koreksi langsung SATU baris riwayat template upah (EmployeeWageTemplateHistory)
 * — guard rantai sama dengan correctAssignmentRow.
 */
export async function correctTemplateHistoryRow(
  db: DbOrTx,
  rowId: string,
  patch: { wageTemplateId?: string | null; validFrom?: Date; validTo?: Date | null; notes?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.employeeWageTemplateHistory.findUnique({ where: { id: rowId } });
  if (!row) return { ok: false, error: "Baris riwayat tidak ditemukan" };
  const all = await db.employeeWageTemplateHistory.findMany({
    where: { employeeId: row.employeeId },
    orderBy: { validFrom: "asc" },
  });
  const i = all.findIndex((r) => r.id === rowId);
  const prev = i > 0 ? all[i - 1] : null;
  const next = i >= 0 && i < all.length - 1 ? all[i + 1] : null;

  const nf = patch.validFrom ?? new Date(row.validFrom);
  const nt = patch.validTo === undefined ? (row.validTo ? new Date(row.validTo) : null) : patch.validTo;
  if (nt && nt.getTime() <= nf.getTime()) return { ok: false, error: "Tanggal berakhir harus setelah tanggal mulai" };
  if (prev && new Date(prev.validTo ?? nf).getTime() > nf.getTime())
    return { ok: false, error: "Tanggal mulai bentrok dengan versi sebelumnya" };
  if (next && nt && new Date(next.validFrom).getTime() < nt.getTime())
    return { ok: false, error: "Tanggal berakhir melewati awal versi berikutnya" };

  const data: Record<string, unknown> = {};
  if (patch.wageTemplateId !== undefined) data.wageTemplateId = patch.wageTemplateId;
  if (patch.validFrom !== undefined) data.validFrom = nf;
  if (patch.validTo !== undefined) data.validTo = nt;
  if (patch.notes !== undefined) data.notes = patch.notes;
  await db.employeeWageTemplateHistory.update({ where: { id: rowId }, data });
  return { ok: true };
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
  // Task 64-fix — sisip effective-dated di tengah rantai: baris yang berlaku
  // pada tanggal efektif ditutup di eff, baris baru mewarisi batas akhirnya
  // (termasuk null). Baris ber-future-date SETELAH eff dipertahankan — ganti
  // template backdated tidak boleh menimpa/menabrak versi masa depan.
  const all = await db.employeeWageTemplateHistory.findMany({
    where: { employeeId },
    orderBy: { validFrom: "asc" },
  });
  if (all.length === 0) {
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
  let idx = -1;
  for (let i = 0; i < all.length; i++) {
    if (new Date(all[i].validFrom).getTime() <= eff.getTime()) idx = i;
    else break;
  }
  const base = idx >= 0 ? all[idx] : all[0];
  // Idempoten: template efektif pada tanggal tsb sudah sama → tidak ada perubahan.
  if (idx >= 0 && base.wageTemplateId === wageTemplateId) return { changed: false };
  if (idx < 0 || new Date(base.validFrom).getTime() >= eff.getTime()) {
    // Efektif ≤ mulai baris dasar (termasuk sebelum riwayat pertama) → perbarui
    // baris dasar apa adanya; versi penerus tetap berlaku.
    await db.employeeWageTemplateHistory.update({ where: { id: base.id }, data: { wageTemplateId } });
    return { changed: true };
  }
  const closeTo = new Date(eff.getTime() - 86_400_000);
  await db.employeeWageTemplateHistory.update({ where: { id: base.id }, data: { validTo: closeTo } });
  await db.employeeWageTemplateHistory.create({
    data: {
      employeeId,
      wageTemplateId,
      validFrom: eff,
      validTo: base.validTo,
      changeReason: opts.reason,
      sourceDocNo: opts.sourceDocNo ?? null,
      notes: opts.notes ?? null,
    },
  });
  return { changed: true };
}
