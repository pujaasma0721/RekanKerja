// P3-PERF — service feedback 360 (§29-3; §37 anonimitas ≥3 reviewer):
// undang reviewer (peer/subordinate/cross/upward), isian anonim, agregasi.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

function bad(msg: string): never { throw new Error(msg); }

export async function inviteReviewers(
  db: TenantDb,
  input: { appraisalId: string; reviewers: { employeeId: string; reviewerType: string }[] },
  actor: string,
): Promise<{ invited: number }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: { cycle: { select: { code: true, status: true, feedback360: true, selfEnd: true, mgrEnd: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (!a.cycle.feedback360) bad(`360 tidak diaktifkan pada siklus ${a.cycle.code} (D3)`);
  if (a.cycle.status !== "Assessment") bad("Undangan 360 hanya saat fase Assessment");
  if (a.employeeId === undefined) bad("Peserta tidak valid");
  let invited = 0;
  for (const r of input.reviewers) {
    if (r.employeeId === a.employeeId) continue; // peserta tidak menilai diri via 360
    const dup = await db.feedback360.findUnique({
      where: { appraisalId_reviewerId_reviewerType: { appraisalId: input.appraisalId, reviewerId: r.employeeId, reviewerType: r.reviewerType } },
    });
    if (dup) continue;
    await db.feedback360.create({
      data: {
        appraisalId: input.appraisalId,
        reviewerId: r.employeeId,
        reviewerType: r.reviewerType,
        status: "Invited",
        dueAt: a.cycle.selfEnd ?? a.cycle.mgrEnd,
      },
    });
    invited++;
  }
  await db.activityLog.create({
    data: {
      action: "Created", entity: "Feedback360", entityId: input.appraisalId,
      detail: `${invited} reviewer 360 diundang untuk ${a.docNo} oleh ${actor}`,
    },
  });
  return { invited };
}

export async function submit360(
  db: TenantDb,
  input: { feedbackId: string; answers: { competencyId: string; score: number; comment?: string; aiAssisted?: boolean }[] },
  actor: string,
): Promise<void> {
  const f = await db.feedback360.findUnique({ where: { id: input.feedbackId }, include: { appraisal: { include: { cycle: { select: { code: true, status: true } } } } } });
  if (!f) bad("Undangan 360 tidak ditemukan");
  if (f.status === "Submitted") bad("Isian sudah disubmit");
  if (f.status === "Expired" || (f.dueAt && new Date() > f.dueAt)) bad("Undangan 360 sudah kedaluwarsa");
  if (f.appraisal.cycle.status !== "Assessment") bad("Siklus bukan di fase Assessment");
  for (const ans of input.answers) {
    if (!(ans.score >= 1 && ans.score <= 5)) bad("Skor 360 harus 1–5");
    await db.feedback360Answer.create({
      data: {
        feedbackId: input.feedbackId,
        competencyId: ans.competencyId,
        score: ans.score,
        comment: ans.comment ?? null,
        aiAssisted: ans.aiAssisted === true,
      },
    });
  }
  await db.feedback360.update({ where: { id: input.feedbackId }, data: { status: "Submitted", submittedAt: new Date() } });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "Feedback360", entityId: input.feedbackId,
      detail: `Isian 360 disubmit (${input.answers.length} kompetensi) untuk ${f.appraisal.docNo} — anonim`,
    },
  });
  void actor;
}
