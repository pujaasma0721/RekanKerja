import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { inviteReviewers, submit360 } from "@/rekankerja/performance/services/feedback360-service";
import { aiCompose, type AiTone } from "@/rekankerja/performance/services/ai-compose";

// ============================================================================
// PERFORMANCE — API feedback 360 (P3 — §17; §29-3; anonimitas §37).
//   GET  ?cycleId         → undangan & status reviewer per peserta (HR/atasan)
//   POST {action:invite}   → undang reviewer (peer|subordinate|crossTeam|upward)
//   POST {action:submit}   → isian reviewer (dipakai jalur ESS my-360 utk self-scope)
//   POST {action:aiCompose}→ AI assist komentar 360 (identitas reviewer tak dikirim — D20)
// Guard: performance:appraisals.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:appraisals", "performance:calibration"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const cycleId = req.nextUrl.searchParams.get("cycleId") ?? "";
    if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
    const rows = await db.feedback360.findMany({
      where: { appraisal: { cycleId } },
      include: {
        reviewer: { select: { employeeNo: true, fullName: true } },
        appraisal: { include: { employee: { select: { employeeNo: true, fullName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({
      rows: rows.map((f) => ({
        id: f.id,
        appraisalId: f.appraisalId,
        employeeName: f.appraisal.employee.fullName,
        reviewerName: f.reviewer.fullName,
        reviewerNo: f.reviewer.employeeNo,
        reviewerType: f.reviewerType,
        status: f.status,
        dueAt: f.dueAt?.toISOString() ?? null,
        submittedAt: f.submittedAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "");
    if (action === "aiCompose") {
      const m = await requireMenuAction(req, "performance:appraisals", "op:aiCompose");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const res = await aiCompose(m.db, {
        appUserId: m.actor.appUserId ?? null,
        points: Array.isArray(b.points) ? b.points.map(String) : [],
        competencyName: b.competencyName != null ? String(b.competencyName) : undefined,
        contextLabel: b.contextLabel != null ? String(b.contextLabel) : undefined,
        tone: (["neutral", "encouraging", "firm"].includes(String(b.tone))) ? (b.tone as AiTone) : "neutral",
        length: b.length === "medium" ? "medium" : "short",
        lang: b.lang === "en" ? "en" : "id",
      });
      return NextResponse.json(res);
    }
    const m = await requireMenuAction(req, "performance:appraisals", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    switch (action) {
      case "invite": {
        const res = await inviteReviewers(db, {
          appraisalId: String(b.appraisalId ?? ""),
          reviewers: Array.isArray(b.reviewers) ? (b.reviewers as Record<string, unknown>[]).map((r) => ({
            employeeId: String(r.employeeId ?? ""),
            reviewerType: String(r.reviewerType ?? "Peer"),
          })) : [],
        }, m.actor.name);
        return NextResponse.json(res);
      }
      case "submit": {
        await submit360(db, {
          feedbackId: String(b.feedbackId ?? ""),
          answers: Array.isArray(b.answers) ? (b.answers as Record<string, unknown>[]).map((a) => ({
            competencyId: String(a.competencyId ?? ""),
            score: Number(a.score ?? 3),
            comment: a.comment != null ? String(a.comment) : undefined,
            aiAssisted: a.aiAssisted === true,
          })) : [],
        }, m.actor.name);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
