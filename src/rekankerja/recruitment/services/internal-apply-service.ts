// ============================================================================
// RECRUITMENT F5 — Lamaran lowongan internal via ESS (oranHR §2.10
// MyJobOpportunity + MyEmpAppliedJobOpportunity).
//
// MyJobOpportunity: slot Posted+Open yang BELUM lewat lastAcceptDate —
// termasuk JO bermatra internal (internalOnly / dalam jendela
// internalFirstUntil — JO seperti ini TIDAK tayang di portal publik,
// lihat public-recruitment-service). Apply karyawan → JobCandidate source
// Internal (jalur F3 penuh: steps otomatis) + jejak EmpJobApplication.
// Withdraw → withdrawCandidate (tahap aktif dibatalkan) + withdrawnAt.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { nominateEmployee } from "@/rekankerja/recruitment/services/candidate-service";
import { withdrawCandidate } from "@/rekankerja/recruitment/services/selection-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

// ============ tipe baris (bentuk JSON API ESS) ============

export interface MyOpeningRow {
  slotId: string;
  joRefNo: string;
  joTitle: string;
  title: string; // titleToShow slot
  positionTitle: string | null;
  prNo: string;
  requiredNo: number;
  employmentStatus: string | null;
  workLocationName: string | null;
  city: string | null;
  salaryMin: number | null; // rentang gaji IKLAN — publik by design
  salaryMax: number | null;
  currency: string;
  salaryUnit: string;
  jobDescSummary: string | null;
  jobSpecSummary: string | null;
  closingDate: string | null; // lastAcceptDate JO
  internalOnly: boolean;
  internalFirstUntil: string | null; // jendela internal-first aktif bila > now
  postedAt: string | null;
  /** lamaran saya ke slot ini (null bila belum) */
  myApplication: { id: string; appliedAt: string; withdrawnAt: string | null } | null;
  canApply: boolean;
  reason: string | null; // alasan tidak bisa apply (dwibahasa di UI)
}

export interface MyAppliedRow {
  id: string;
  joRefNo: string;
  title: string;
  positionTitle: string | null;
  prNo: string;
  appliedAt: string;
  withdrawnAt: string | null;
  note: string | null;
  candidateStatus: string | null; // Nominated|InProcess|Passed|Failed|Withdrawn|Hired
  currentStep: string | null; // tahap berjalan (bila ada)
  currentStepDue: string | null;
}

// ============ query ============

/** MyJobOpportunity — lowongan aktif utk karyawan + status lamaran sendiri. */
export async function myJobOpportunities(
  db: TenantDb,
  employeeId: string,
): Promise<{ openings: MyOpeningRow[]; stats: { total: number; internalWindow: number; applied: number } }> {
  const now = new Date();
  const slots = await db.jobOpening.findMany({
    where: {
      status: "Open",
      jobOpportunity: {
        status: "Posted",
        OR: [{ lastAcceptDate: null }, { lastAcceptDate: { gte: now } }],
      },
    },
    include: {
      jobOpportunity: { select: { refNo: true, title: true, lastAcceptDate: true, internalOnly: true, internalFirstUntil: true } },
      pr: { select: { prNo: true, requiredNo: true, employmentStatus: true, position: { select: { title: true } } } },
      workLocation: { select: { name: true, city: true } },
      empApplications: { where: { employeeId }, select: { id: true, appliedAt: true, withdrawnAt: true } },
    },
    orderBy: { postedAt: "desc" },
    take: 50,
  });

  // PR tiap slot harus masih rekrutmen aktif (Approved/OnHold) agar bisa apply
  const prIds = [...new Set(slots.map((s) => s.prId))];
  const activePrs = prIds.length
    ? await db.personnelRequisition.findMany({ where: { id: { in: prIds }, status: { in: ["Approved", "OnHold"] } }, select: { id: true } })
    : [];
  const activePrSet = new Set(activePrs.map((p) => p.id));

  const openings: MyOpeningRow[] = [];
  for (const s of slots) {
    const jo = s.jobOpportunity;
    const mine = s.empApplications[0] ?? null;
    let canApply = true;
    let reason: string | null = null;
    if (mine && !mine.withdrawnAt) {
      canApply = false;
      reason = "Sudah melamar slot ini";
    } else if (mine && mine.withdrawnAt) {
      canApply = false;
      reason = "Lamaran ke slot ini sudah ditarik — hubungi HR untuk melamar ulang";
    } else if (!activePrSet.has(s.prId)) {
      canApply = false;
      reason = "Permintaan karyawan tidak lagi aktif";
    }
    openings.push({
      slotId: s.id,
      joRefNo: jo.refNo,
      joTitle: jo.title,
      title: s.titleToShow,
      positionTitle: s.pr.position?.title ?? null,
      prNo: s.pr.prNo,
      requiredNo: s.pr.requiredNo,
      employmentStatus: s.pr.employmentStatus,
      workLocationName: s.workLocation?.name ?? null,
      city: s.workLocation?.city ?? null,
      salaryMin: s.salaryMin ?? null,
      salaryMax: s.salaryMax ?? null,
      currency: s.currency,
      salaryUnit: s.salaryUnit,
      jobDescSummary: s.jobDescSummary,
      jobSpecSummary: s.jobSpecSummary,
      closingDate: jo.lastAcceptDate ? jo.lastAcceptDate.toISOString().slice(0, 10) : null,
      internalOnly: jo.internalOnly,
      internalFirstUntil: jo.internalFirstUntil && jo.internalFirstUntil > now ? jo.internalFirstUntil.toISOString() : null,
      postedAt: s.postedAt ? s.postedAt.toISOString() : null,
      myApplication: mine ? { id: mine.id, appliedAt: mine.appliedAt.toISOString(), withdrawnAt: mine.withdrawnAt ? mine.withdrawnAt.toISOString() : null } : null,
      canApply,
      reason,
    });
  }

  return {
    openings,
    stats: {
      total: openings.length,
      internalWindow: openings.filter((o) => o.internalOnly || o.internalFirstUntil).length,
      applied: openings.filter((o) => o.myApplication && !o.myApplication.withdrawnAt).length,
    },
  };
}

/** MyEmpAppliedJobOpportunity — riwayat lamaran internal + status kandidat. */
export async function myAppliedJobs(db: TenantDb, employeeId: string): Promise<MyAppliedRow[]> {
  const rows = await db.empJobApplication.findMany({
    where: { employeeId },
    include: {
      jobOpening: {
        select: {
          titleToShow: true,
          pr: { select: { prNo: true, position: { select: { title: true } } } },
          jobOpportunity: { select: { refNo: true } },
        },
      },
      candidate: {
        select: {
          status: true,
          selectionSteps: {
            where: { status: { in: ["Planned", "Acknowledged", "Performed"] } },
            select: { selectionProcess: { select: { name: true } }, dueDate: true },
            orderBy: { seqNo: "asc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { appliedAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    joRefNo: r.jobOpening.jobOpportunity.refNo,
    title: r.jobOpening.titleToShow,
    positionTitle: r.jobOpening.pr.position?.title ?? null,
    prNo: r.jobOpening.pr.prNo,
    appliedAt: r.appliedAt.toISOString(),
    withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
    note: r.note,
    candidateStatus: r.candidate?.status ?? null,
    currentStep: r.candidate?.selectionSteps[0]?.selectionProcess.name ?? null,
    currentStepDue: r.candidate?.selectionSteps[0]?.dueDate ? r.candidate.selectionSteps[0].dueDate!.toISOString() : null,
  }));
}

// ============ mutasi ============

/** Apply lowongan internal: guard + JobCandidate source Internal + jejak. */
export async function applyInternalJob(
  db: TenantDb,
  input: { employeeId: string; employeeNo?: string | null; jobOpeningId: string; note?: string | null; actorName?: string | null },
): Promise<{ applicationId: string; candidateId: string; stepsCreated: number; prNo: string; title: string }> {
  const slot = await db.jobOpening.findUnique({
    where: { id: input.jobOpeningId },
    include: {
      jobOpportunity: { select: { refNo: true, status: true, lastAcceptDate: true } },
      pr: { select: { id: true, prNo: true, status: true } },
    },
  });
  if (!slot) throw new Error("Slot lowongan tidak ditemukan");
  if (slot.jobOpportunity.status !== "Posted") {
    throw new Error(`Lowongan ${slot.jobOpportunity.refNo} tidak sedang tayang (${slot.jobOpportunity.status})`);
  }
  if (slot.status !== "Open") throw new Error("Slot lowongan sudah ditutup");
  if (slot.jobOpportunity.lastAcceptDate && slot.jobOpportunity.lastAcceptDate < new Date()) {
    throw new Error("Batas akhir penerimaan lamaran sudah lewat");
  }
  if (slot.pr.status !== "Approved" && slot.pr.status !== "OnHold") {
    throw new Error(`Permintaan karyawan ${slot.pr.prNo} tidak lagi menerima pelamar (${slot.pr.status})`);
  }

  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNo: true, fullName: true, status: true },
  });
  if (!employee) throw new Error("Data karyawan tidak ditemukan");
  if (employee.status !== "Active") throw new Error(`Karyawan ${employee.employeeNo} berstatus ${employee.status} — hanya karyawan Active yang bisa melamar`);

  const dupe = await db.empJobApplication.findUnique({
    where: { employeeId_jobOpeningId: { employeeId: input.employeeId, jobOpeningId: input.jobOpeningId } },
    select: { id: true, withdrawnAt: true },
  });
  if (dupe) {
    throw new Error(dupe.withdrawnAt
      ? "Anda sudah pernah melamar & menarik lamaran di slot ini — hubungi HR untuk melamar ulang"
      : "Anda sudah melamar slot ini");
  }

  // reuse JobCandidate internal aktif di PR yang sama (mis. dinominasi HR
  // sebelumnya) — 1 karyawan 1 jalur seleksi per PR
  let candidateId: string | null = await db.jobCandidate.findFirst({
    where: { prId: slot.pr.id, employeeId: input.employeeId, status: { in: ["Nominated", "InProcess"] } },
    select: { id: true },
  }).then((c) => c?.id ?? null);
  let stepsCreated = 0;
  if (!candidateId) {
    const res = await nominateEmployee(db, {
      prId: slot.pr.id,
      employeeId: input.employeeId,
      note: input.note?.trim() || null,
      nominatedById: input.employeeId, // self-nominate via ESS
      actorName: input.actorName ?? `${employee.fullName} (ESS)`,
    });
    candidateId = res.id;
    stepsCreated = res.stepsCreated;
  } else {
    await db.activityLog.create({
      data: {
        action: "Created", entity: "JobCandidate", entityId: slot.pr.prNo,
        detail: `Karyawan internal ${employee.employeeNo} "${employee.fullName}" melamar slot ${slot.jobOpportunity.refNo} via ESS — kandidat PR sudah ada (reuse)${input.actorName ? ` oleh ${input.actorName}` : ""}`,
      },
    });
  }

  const app = await db.empJobApplication.create({
    data: {
      employeeId: input.employeeId,
      jobOpeningId: input.jobOpeningId,
      candidateId,
      note: input.note?.trim() || null,
    },
  });

  // notifikasi in-app: officer PR → fallback Admin/HR
  void notifyEvent(db, {
    to: "admins", docType: "JobOpportunity", docNo: slot.jobOpportunity.refNo, docId: slot.jobOpportunityId,
    title: `Lamaran internal baru: ${employee.fullName}`,
    body: `${employee.employeeNo} melamar "${slot.titleToShow}" (${slot.jobOpportunity.refNo}, PR ${slot.pr.prNo}) via Portal Karyawan — kandidat internal siap diproses.`,
    kind: "recruitment", link: "recruitment:selection",
  }).catch(() => {});

  return { applicationId: app.id, candidateId, stepsCreated, prNo: slot.pr.prNo, title: slot.titleToShow };
}

/** Tarik lamaran internal (withdraw) — kandidat ikut Withdrawn bila belum hasil. */
export async function withdrawMyApplication(
  db: TenantDb,
  input: { employeeId: string; applicationId: string; note?: string | null; actorName?: string | null },
): Promise<void> {
  const app = await db.empJobApplication.findUnique({
    where: { id: input.applicationId },
    select: { id: true, employeeId: true, candidateId: true, note: true, jobOpening: { select: { titleToShow: true, jobOpportunity: { select: { refNo: true } } } } },
  });
  if (!app) throw new Error("Lamaran tidak ditemukan");
  if (app.employeeId !== input.employeeId) throw new Error("Lamaran ini bukan milik Anda");
  if (app.candidateId) {
    await withdrawCandidate(db, {
      candidateId: app.candidateId,
      note: input.note?.trim() || "Ditarik sendiri oleh kandidat via ESS",
      actorName: input.actorName ?? "(ESS)",
    });
  }
  await db.empJobApplication.update({
    where: { id: app.id },
    data: { withdrawnAt: new Date(), note: input.note?.trim() || app.note },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "EmpJobApplication", entityId: app.jobOpening.jobOpportunity.refNo,
      detail: `Lamaran internal slot "${app.jobOpening.titleToShow}" ditarik oleh kandidat via ESS`,
    },
  });
}
