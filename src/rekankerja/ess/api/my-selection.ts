// GET /api/rekankerja/ess/my-selection — MySelectionProcess (§2.10):
// tahapan seleksi milik karyawan ESS sebagai kandidat INTERNAL (JobCandidate
// via employeeId — status Nominated|InProcess;Passed/Failed tetap tampil utk
// riwayat). POST — acknowledge tahap sendiri (needAcknowledgement).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { acknowledgeStep, STEP_STATUSES } from "@/rekankerja/recruitment/services/selection-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const candidates = await db.jobCandidate.findMany({
      where: { employeeId },
      include: {
        pr: { select: { prNo: true, position: { select: { title: true } }, requiredNo: true } },
        selectionSteps: {
          include: {
            selectionProcess: { select: { name: true, resultType: true, minResultPass: true, slaDays: true, needAcknowledgement: true, processOrder: true } },
            performedBy: { select: { fullName: true } },
            letters: { select: { id: true, letterNo: true, kind: true, issuedAt: true }, orderBy: { issuedAt: "desc" } },
          },
          orderBy: { seqNo: "asc" },
        },
      },
      orderBy: { nominatedAt: "desc" },
      take: 20,
    });

    const TERMINAL = ["Passed", "Failed", "Cancelled"];
    return NextResponse.json({
      processes: candidates.map((c) => {
        const cur = c.selectionSteps.find((s) => !TERMINAL.includes(s.status)) ?? null;
        return {
          id: c.id,
          status: c.status, // Nominated|InProcess|Passed|Failed|Withdrawn
          source: c.source,
          prNo: c.pr.prNo,
          positionTitle: c.pr.position?.title ?? null,
          nominatedAt: c.nominatedAt.toISOString(),
          note: c.note,
          currentStep: cur
            ? {
                id: cur.id,
                stageName: cur.selectionProcess.name,
                planDate: cur.planDate ? cur.planDate.toISOString() : null,
                dueDate: cur.dueDate ? cur.dueDate.toISOString() : null,
                status: cur.status as (typeof STEP_STATUSES)[number],
                needAck: cur.selectionProcess.needAcknowledgement,
                acknowledgedAt: cur.acknowledgedAt ? cur.acknowledgedAt.toISOString() : null,
                overdue: !!cur.dueDate && cur.dueDate.getTime() < Date.now(),
                evaluatorName: cur.performedBy?.fullName ?? null,
                resultType: cur.selectionProcess.resultType,
                minResultPass: cur.selectionProcess.minResultPass,
                invitationLetterNo: cur.letterNo,
              }
            : null,
          steps: c.selectionSteps.map((s) => ({
            id: s.id,
            stageName: s.selectionProcess.name,
            planDate: s.planDate ? s.planDate.toISOString() : null,
            performedAt: s.performedAt ? s.performedAt.toISOString() : null,
            status: s.status as (typeof STEP_STATUSES)[number],
            score: s.score,
            result: s.result,
            comment: s.comment,
            needAck: s.selectionProcess.needAcknowledgement,
            acknowledgedAt: s.acknowledgedAt ? s.acknowledgedAt.toISOString() : null,
            evaluatorName: s.performedBy?.fullName ?? null,
            invitationLetterNo: s.letters[0]?.letterNo ?? null,
          })),
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST { stepId } — acknowledge tahap sendiri (jadwal dikonfirmasi kandidat).
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = (await req.json()) as { stepId?: string };
    const stepId = String(b.stepId ?? "");
    if (!stepId) return NextResponse.json({ error: "stepId wajib" }, { status: 400 });

    // pastikan tahap milik kandidat internal karyawan ini
    const step = await db.candidateSelectionStep.findUnique({
      where: { id: stepId },
      select: { id: true, candidate: { select: { id: true, employeeId: true, fullName: true } } },
    });
    if (!step || step.candidate.employeeId !== employeeId) {
      return NextResponse.json({ error: "Tahap seleksi tidak ditemukan" }, { status: 404 });
    }

    await acknowledgeStep(db, { stepId, actorName: `${fullName} (ESS)` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
