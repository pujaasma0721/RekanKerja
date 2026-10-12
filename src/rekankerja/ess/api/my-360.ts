// P3-PERF — ESS 360 Saya (§14.3; §29-3): undangan yang harus saya isi
// (peer/subordinate/cross/upward) — isian anonim; AI assist komentar
// (identitas reviewer tak pernah dikirim ke model — D20).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { submit360 } from "@/rekankerja/performance/services/feedback360-service";
import { aiCompose, type AiTone } from "@/rekankerja/performance/services/ai-compose";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;
  try {
    const invites = await db.feedback360.findMany({
      where: { reviewerId: employeeId, status: { in: ["Invited"] } },
      include: {
        appraisal: {
          include: {
            employee: { select: { fullName: true } },
            cycle: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const expired = await db.feedback360.findMany({
      where: { reviewerId: employeeId, status: { in: ["Submitted", "Declined", "Expired"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    // kompetensi yang dinilai = milik peserta (dari view peserta)
    const out: {
      feedbackId: string; revieweeName: string; cycleCode: string; reviewerType: string;
      dueAt: string | null;
      comps: { competencyId: string; name: string; kind: string; levels: { level: number; label: string; descriptor: string }[] }[];
    }[] = [];
    for (const inv of invites) {
      const view = await (await import("@/rekankerja/performance/services/appraisal-service")).getAssessmentView(db, inv.appraisalId);
      out.push({
        feedbackId: inv.id,
        revieweeName: inv.appraisal.employee.fullName,
        cycleCode: inv.appraisal.cycle.code,
        reviewerType: inv.reviewerType,
        dueAt: inv.dueAt?.toISOString() ?? null,
        comps: view.comps.map((c) => ({
          competencyId: c.competencyId,
          name: c.name,
          kind: c.kind,
          levels: c.levels,
        })),
      });
    }
    return NextResponse.json({
      invites: out,
      historyCount: expired.length,
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
    const b = await req.json();
    // self-scope: undangan harus milik reviewer ini
    const inv = await db.feedback360.findUnique({ where: { id: String(b.feedbackId ?? "") } });
    if (!inv || inv.reviewerId !== employeeId) {
      return NextResponse.json({ error: "Undangan tidak ditemukan" }, { status: 404 });
    }
    if (b.action === "decline") {
      await db.feedback360.update({ where: { id: inv.id }, data: { status: "Declined" } });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "submit") {
      await submit360(db, {
        feedbackId: inv.id,
        answers: Array.isArray(b.answers) ? (b.answers as Record<string, unknown>[]).map((a) => ({
          competencyId: String(a.competencyId ?? ""),
          score: Number(a.score ?? 3),
          comment: a.comment != null ? String(a.comment) : undefined,
          aiAssisted: a.aiAssisted === true,
        })) : [],
      }, m.actor.fullName);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "aiCompose") {
      const res = await aiCompose(db, {
        appUserId: m.actor.appUserId ?? null,
        points: Array.isArray(b.points) ? b.points.map(String) : [],
        competencyName: b.competencyName != null ? String(b.competencyName) : undefined,
        contextLabel: "360 review",
        tone: (["neutral", "encouraging", "firm"].includes(String(b.tone))) ? (b.tone as AiTone) : "neutral",
        length: b.length === "medium" ? "medium" : "short",
        lang: b.lang === "en" ? "en" : "id",
      });
      return NextResponse.json(res);
    }
    return NextResponse.json({ error: `Aksi tidak dikenal: ${String(b.action ?? "")}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
