// ============================================================================
// RECRUITMENT F3 — JobCandidate service (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F3):
// transfer pelamar talent pool → kandidat PR (padanan "Transfer To Job
// Candidate") + kandidat INTERNAL (employee — HRX A4): mutasi/promosi ikut
// jalur seleksi yang sama. Rantai tahap dibuat selection-service
// (ensureStepsForCandidate — difilter appliesInternal/appliesExternal).
//
// Guard:
//   · PR harus Approved/OnHold (rekrutmen berjalan);
//   · pelamar eksternal harus Active (bukan Rejected/Outdated/Employed);
//   · karyawan internal harus Active;
//   · satu pelamar hanya sekali per PR (unique [prId, applicantId]);
//   · ApplicantApplication ke slot PR ini otomatis Screening (jejak lamaran).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { ensureStepsForCandidate, type CandidateSource } from "@/rekankerja/recruitment/services/selection-service";

// ============ tipe ============

export interface NominateResult {
  id: string;
  prNo: string;
  fullName: string;
  source: CandidateSource;
  stepsCreated: number;
}

// ============ helper ============

async function assertPrOpen(db: TenantDb, prId: string) {
  const pr = await db.personnelRequisition.findUnique({
    where: { id: prId },
    select: { id: true, prNo: true, status: true, position: { select: { title: true } } },
  });
  if (!pr) throw new Error("Permintaan karyawan (PR) tidak ditemukan");
  if (pr.status !== "Approved" && pr.status !== "OnHold") {
    throw new Error(`PR ${pr.prNo} berstatus ${pr.status} — hanya PR Approved/OnHold yang bisa menerima kandidat`);
  }
  return pr;
}

// ============ transfer pelamar eksternal ============

export async function nominateApplicant(
  db: TenantDb,
  input: { prId: string; applicantId: string; note?: string | null; nominatedById?: string | null; actorName?: string | null },
): Promise<NominateResult> {
  const pr = await assertPrOpen(db, input.prId);

  const applicant = await db.applicant.findUnique({
    where: { id: input.applicantId },
    select: { id: true, applicantNo: true, firstName: true, middleName: true, lastName: true, displayName: true, status: true },
  });
  if (!applicant) throw new Error("Pelamar tidak ditemukan");
  if (applicant.status !== "Active") {
    throw new Error(`Pelamar ${applicant.applicantNo} berstatus ${applicant.status} — hanya pelamar Active yang bisa dinominasikan`);
  }

  const dupe = await db.jobCandidate.findFirst({ where: { prId: input.prId, applicantId: input.applicantId }, select: { id: true } });
  if (dupe) throw new Error(`Pelamar ${applicant.applicantNo} sudah menjadi kandidat di PR ${pr.prNo}`);

  const fullName = applicant.displayName?.trim() || [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(" ");

  const candidate = await db.jobCandidate.create({
    data: {
      prId: input.prId,
      applicantId: input.applicantId,
      source: "External",
      status: "Nominated",
      fullName,
      nominatedById: input.nominatedById ?? null,
      note: input.note?.trim() || null,
    },
  });

  const stepsCreated = await ensureStepsForCandidate(db, { id: candidate.id, source: "External", prId: input.prId });

  // jejak: lamaran pelamar ke slot PR ini → Screening
  await db.applicantApplication.updateMany({
    where: { applicantId: input.applicantId, jobOpening: { prId: input.prId }, status: "Received" },
    data: { status: "Screening" },
  });

  await db.activityLog.create({
    data: {
      action: "Created", entity: "JobCandidate", entityId: pr.prNo,
      detail: `Pelamar ${applicant.applicantNo} "${fullName}" ditransfer sebagai kandidat PR ${pr.prNo}${pr.position?.title ? ` (${pr.position.title})` : ""} — ${stepsCreated} tahap seleksi dibuat${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
  return { id: candidate.id, prNo: pr.prNo, fullName, source: "External", stepsCreated };
}

// ============ nominasi kandidat internal (employee — HRX A4) ============

export async function nominateEmployee(
  db: TenantDb,
  input: { prId: string; employeeId: string; note?: string | null; nominatedById?: string | null; actorName?: string | null },
): Promise<NominateResult> {
  const pr = await assertPrOpen(db, input.prId);

  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNo: true, fullName: true, status: true, position: { select: { title: true } } },
  });
  if (!employee) throw new Error("Karyawan tidak ditemukan");
  if (employee.status !== "Active") throw new Error(`Karyawan ${employee.employeeNo} berstatus ${employee.status} — hanya karyawan Active yang bisa dinominasikan`);

  const dupe = await db.jobCandidate.findFirst({ where: { prId: input.prId, employeeId: input.employeeId }, select: { id: true } });
  if (dupe) throw new Error(`Karyawan ${employee.employeeNo} sudah menjadi kandidat di PR ${pr.prNo}`);

  const candidate = await db.jobCandidate.create({
    data: {
      prId: input.prId,
      employeeId: input.employeeId,
      source: "Internal",
      status: "Nominated",
      fullName: employee.fullName,
      nominatedById: input.nominatedById ?? null,
      note: input.note?.trim() || null,
    },
  });

  const stepsCreated = await ensureStepsForCandidate(db, { id: candidate.id, source: "Internal", prId: input.prId });

  await db.activityLog.create({
    data: {
      action: "Created", entity: "JobCandidate", entityId: pr.prNo,
      detail: `Karyawan internal ${employee.employeeNo} "${employee.fullName}"${employee.position?.title ? ` (${employee.position.title})` : ""} dinominasikan ke PR ${pr.prNo} — ${stepsCreated} tahap seleksi dibuat${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
  return { id: candidate.id, prNo: pr.prNo, fullName: employee.fullName, source: "Internal", stepsCreated };
}

// ============ utilitas ============

/** Ubah catatan kandidat. */
export async function updateCandidateNote(db: TenantDb, id: string, note: string | null, actorName?: string | null): Promise<void> {
  const c = await db.jobCandidate.findUnique({ where: { id }, select: { id: true, pr: { select: { prNo: true } } } });
  if (!c) throw new Error("Kandidat tidak ditemukan");
  await db.jobCandidate.update({ where: { id }, data: { note: note?.trim() || null } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "JobCandidate", entityId: c.pr.prNo,
      detail: `Catatan kandidat diperbarui${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}

/** Hapus kandidat — hanya bila BELUM ada tahap yang dilaksanakan (salah transfer). */
export async function deleteCandidate(db: TenantDb, id: string, actorName?: string | null): Promise<void> {
  const c = await db.jobCandidate.findUnique({
    where: { id },
    select: { id: true, fullName: true, pr: { select: { prNo: true } }, selectionSteps: { select: { performedAt: true, status: true } } },
  });
  if (!c) throw new Error("Kandidat tidak ditemukan");
  const performed = c.selectionSteps.some((s) => s.performedAt != null || s.status === "Passed" || s.status === "Failed");
  if (performed) throw new Error("Kandidat sudah menjalani proses seleksi — gunakan Tarik Kandidat (Withdrawn) agar jejak tetap utuh");
  await db.jobCandidate.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "JobCandidate", entityId: c.pr.prNo,
      detail: `Kandidat ${c.fullName} dihapus dari PR ${c.pr.prNo} (belum ada tahap dilaksanakan)${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}

/** Opsi picker: PR Approved/OnHold + pelamar Active + karyawan Active (utk dialog transfer). */
export async function nominationOptions(db: TenantDb): Promise<{
  prs: { id: string; prNo: string; positionTitle: string | null; requiredNo: number; status: string }[];
  employees: { id: string; employeeNo: string; fullName: string; positionTitle: string | null }[];
}> {
  const [prs, employees] = await Promise.all([
    db.personnelRequisition.findMany({
      where: { status: { in: ["Approved", "OnHold"] } },
      select: { id: true, prNo: true, requiredNo: true, status: true, position: { select: { title: true } } },
      orderBy: { prNo: "desc" }, take: 100,
    }),
    db.employee.findMany({
      where: { status: "Active" },
      select: { id: true, employeeNo: true, fullName: true, position: { select: { title: true } } },
      orderBy: { fullName: "asc" }, take: 300,
    }),
  ]);
  return {
    prs: prs.map((p) => ({ id: p.id, prNo: p.prNo, positionTitle: p.position?.title ?? null, requiredNo: p.requiredNo, status: p.status })),
    employees: employees.map((e) => ({ id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, positionTitle: e.position?.title ?? null })),
  };
}
