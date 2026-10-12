// P3-PERF — ESS Penilaian Saya (§14.3; §29-2): status fase + self-assessment
// (AI assist §18.11) + hasil terpublikasi. Estimator dampak TIDAK ada di ESS
// (karyawan tidak melihat — D21; guard §35-31 menolak via menu guard admin).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { submitSelf, getAssessmentView } from "@/rekankerja/performance/services/appraisal-service";
import { aiCompose, type AiTone } from "@/rekankerja/performance/services/ai-compose";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

async function myAppraisal(db: TenantDb, employeeId: string) {
  return db.appraisalRecord.findFirst({
    where: { employeeId, cycle: { status: { in: ["GoalSetting", "Ongoing", "Assessment", "Calibration", "Published"] } } },
    orderBy: { docNo: "desc" },
  });
}

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;
  try {
    const me = await myAppraisal(db, employeeId);
    if (!me) return NextResponse.json({ active: null });
    const view = await getAssessmentView(db, me.id);
    return NextResponse.json({
      active: {
        appraisalId: view.appraisal.id,
        docNo: view.appraisal.docNo,
        status: view.appraisal.status,
        cycle: view.appraisal.cycle,
        employee: view.appraisal.employee,
        kpis: view.kpis.map((k) => ({
          id: k.id, title: k.title, polarity: k.polarity, unit: k.unit,
          thresholdMin: k.thresholdMin, target: k.target, finalActual: k.finalActual,
          midActual: k.midActual, dataSource: k.dataSource,
        })),
        comps: view.comps.map((c) => ({
          competencyId: c.competencyId, name: c.name, kind: c.kind, levels: c.levels,
          selfScore: c.selfScore, selfComment: c.selfComment,
        })),
        // hasil terpublikasi (Alur 7) — satu-satunya sumber kebenaran
        published: ["Published", "Closed"].includes(view.appraisal.status)
          ? { managerScore: view.appraisal.managerScore, selfScore: view.appraisal.selfScore }
          : null,
      },
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
    const me = await myAppraisal(db, employeeId);
    if (!me) return NextResponse.json({ error: "Anda belum terdaftar di siklus aktif" }, { status: 404 });
    if (b.action === "submitSelf") {
      await submitSelf(db, {
        appraisalId: me.id,
        compScores: Array.isArray(b.compScores) ? (b.compScores as Record<string, unknown>[]).map((c) => ({
          competencyId: String(c.competencyId ?? ""),
          score: Number(c.score ?? 3),
          comment: c.comment != null ? String(c.comment) : undefined,
        })) : [],
      }, m.actor.fullName);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "aiCompose") {
      const res = await aiCompose(db, {
        appUserId: m.actor.appUserId ?? null,
        points: Array.isArray(b.points) ? b.points.map(String) : [],
        competencyName: b.competencyName != null ? String(b.competencyName) : undefined,
        contextLabel: "Self-assessment",
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
