import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import {
  mySelfAssessment, myPublishedResult, submitSelf, aiCompose,
  type SubmitSelfInput, type AiComposeInput,
} from "@/rekankerja/performance/services/perf-appraisal-service";

// ============================================================================
// PERFORMANCE — ESS "Penilaian Saya" (P3 — §17 ess/my-appraisal, Alur 5 §29-2):
//   GET  ?type=current|previous|published → fase Assessment: kompetensi utk
//        self-assessment + KPI manual utk usulan finalActual + jendela + status;
//        fase Published/Closed: hasil final read-only (acknowledge = P4).
//   POST {action: submitSelf, appraisalId, selfScores, selfComments,
//        selfAiAssistedIds, manualActuals, evidence}  → submit sekali di akhir
//        (autosave = mirror lokal form-kit §18.7 — tidak ada kolom draf server)
//   POST {action: aiCompose, scope:"self", ...} → AI assist ulasan diri (AM3
//        §18.11 — compose-only; estimator dampak TIDAK ada di ESS, D21).
// Guard: requireEss (self-scope anti-IDOR).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const sp = new URL(req.url).searchParams;
    const appraisals = await db.appraisalRecord.findMany({
      where: { employeeId },
      include: { cycle: { select: { code: true, status: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    if (!appraisals.length) return NextResponse.json({ current: null, published: null, previous: [] });

    // siklus aktif = belum Published/Closed; hasil final = sudah
    const current = appraisals.find((a) => !["Published", "Closed"].includes(a.cycle.status)) ?? null;
    const finals = appraisals.filter((a) => a.id !== current?.id);
    const published = finals.find((a) => ["Published", "Closed"].includes(a.cycle.status) && a.cycle.status !== "Closed") ?? null;
    const previous = finals.filter((a) => ["Published", "Closed"].includes(a.cycle.status));

    return NextResponse.json({
      current: current && current.cycle.status === "Assessment"
        ? await mySelfAssessment(db, employeeId, current.id)
        : current
          ? { appraisalId: current.id, docNo: current.docNo, status: current.status, cycleCode: current.cycle.code, phase: current.cycle.status, waiting: true }
          : null,
      published: published ? await myPublishedResult(db, employeeId, published.id) : null,
      previous: (await Promise.all(previous.map((a) => myPublishedResult(db, employeeId, a.id))))
        .map((r) => ({
          appraisalId: r.appraisal.id, docNo: r.appraisal.docNo,
          cycleCode: r.cycle.code, periodStart: r.cycle.periodStart, periodEnd: r.cycle.periodEnd,
          selfScore: r.appraisal.selfScore, managerScore: r.appraisal.managerScore,
          finalScore: r.appraisal.finalScore, finalRating: r.appraisal.finalRating,
          rating: r.rating,
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");

    if (action === "submitSelf") {
      const input: SubmitSelfInput = {
        selfScores: (Array.isArray(b.selfScores) ? b.selfScores : []) as SubmitSelfInput["selfScores"],
        selfComments: (Array.isArray(b.selfComments) ? b.selfComments : []) as SubmitSelfInput["selfComments"],
        selfAiAssistedIds: (Array.isArray(b.selfAiAssistedIds) ? b.selfAiAssistedIds : []).map(String),
        manualActuals: (Array.isArray(b.manualActuals) ? b.manualActuals : []) as SubmitSelfInput["manualActuals"],
        evidence: (Array.isArray(b.evidence) ? b.evidence : []) as SubmitSelfInput["evidence"],
      };
      const out = await submitSelf(db, employeeId, String(b.appraisalId ?? ""), input);
      await db.activityLog.create({
        data: {
          employeeId,
          action: "Submitted", entity: "AppraisalRecord", entityId: String(b.appraisalId ?? ""),
          detail: `Self-assessment ESS submitted: ${out.compCount} kompetensi · skor ${out.selfScore} (§35-7)`,
        },
      });
      return NextResponse.json(out, { status: 201 });
    }

    if (action === "aiCompose") {
      const input = {
        scope: "self" as const,
        appraisalId: String(b.appraisalId ?? ""),
        competencyId: b.competencyId != null ? String(b.competencyId) : undefined,
        points: (Array.isArray(b.points) ? b.points : []).map(String),
        tone: (b.tone === "encouraging" || b.tone === "firm" ? b.tone : "neutral") as AiComposeInput["tone"],
        length: b.length === "medium" ? ("medium" as const) : ("short" as const),
        lang: b.lang === "en" ? ("en" as const) : ("id" as const),
      };
      const out = await aiCompose(db, { employeeId, superAdmin: false }, `ess:${employeeId}`, input);
      return NextResponse.json(out); // unavailable → 200 + flag (kegagalan tenang)
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
