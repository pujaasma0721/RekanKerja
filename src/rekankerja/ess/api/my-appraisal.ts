// P3-PERF — ESS Penilaian Saya (§14.3; §29-2): status fase + self-assessment
// (AI assist §18.11) + hasil terpublikasi. Estimator dampak TIDAK ada di ESS
// (karyawan tidak melihat — D21; guard §35-31 menolak via menu guard admin).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { submitSelf, getAssessmentView } from "@/rekankerja/performance/services/appraisal-service";
import { APPEAL_WINDOW_DAYS } from "@/rekankerja/performance/services/calibration-service";
import { aiCompose, type AiTone } from "@/rekankerja/performance/services/ai-compose";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

async function myAppraisal(db: TenantDb, employeeId: string) {
  return db.appraisalRecord.findFirst({
    where: { employeeId, cycle: { status: { in: ["GoalSetting", "Ongoing", "Assessment", "Calibration", "Published"] } } },
    orderBy: { docNo: "desc" },
  });
}

/** Jendela banding D6 (7 hari sejak publish) — null bila siklus belum terpublikasi. */
async function appealWindowEnd(db: TenantDb, cycleId: string): Promise<Date | null> {
  const c = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { publishAt: true } });
  if (!c?.publishAt) return null;
  return new Date(c.publishAt.getTime() + APPEAL_WINDOW_DAYS * 24 * 3600 * 1000);
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
        // hasil terpublikasi (Alur 7 §31) — satu-satunya sumber kebenaran;
        // karyawan melihat: skor per KPI, kompetensi, ringkasan 360, rating.
        published: ["Published", "Appealed", "Closed"].includes(view.appraisal.status)
          ? {
              managerScore: view.appraisal.managerScore, selfScore: view.appraisal.selfScore,
              finalScore: me.finalScore, finalRating: me.finalRating,
              acknowledgedAt: me.acknowledgedAt?.toISOString() ?? null,
              appealStatus: me.appealStatus ?? null,
              appealWindowEnd: await appealWindowEnd(db, me.cycleId),
              kpiScores: view.kpis.map((k) => ({
                title: k.title, unit: k.unit, target: k.target,
                finalActual: k.finalActual, dataSource: k.dataSource,
              })),
              compScores: view.comps.map((c) => ({
                name: c.name, kind: c.kind, managerScore: c.score, comment: c.comment,
                selfScore: c.selfScore,
              })),
              f360summary: view.f360summary,
            }
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
    if (b.action === "acknowledge") {
      // §31-2 — bukti telah dikomunikasikan (bukan persetujuan isi)
      if (me.status !== "Published" && me.status !== "Appealed") {
        return NextResponse.json({ error: "Hasil belum dipublikasikan" }, { status: 409 });
      }
      if (me.acknowledgedAt) return NextResponse.json({ error: "Sudah acknowledge" }, { status: 409 });
      await db.appraisalRecord.update({ where: { id: me.id }, data: { acknowledgedAt: new Date() } });
      await db.activityLog.create({
        data: { action: "Processed", entity: "AppraisalRecord", entityId: me.id, detail: `Karyawan acknowledge hasil ${me.docNo} (bukti dikomunikasikan)` },
      });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "submitAppeal") {
      // §31-3 — banding D6: alasan + bukti tambahan; jendela 7 hari sejak publish
      const note = String(b.note ?? "").trim();
      if (me.status !== "Published") {
        return NextResponse.json({ error: `Hasil berstatus ${me.status} — banding tidak bisa diajukan` }, { status: 409 });
      }
      if (me.appealStatus === "Submitted") return NextResponse.json({ error: "Banding sudah diajukan — menunggu keputusan HR" }, { status: 409 });
      if (note.length < 20) return NextResponse.json({ error: "Alasan banding wajib ≥20 karakter (sertakan bukti tambahan bila ada)" }, { status: 400 });
      const end = await appealWindowEnd(db, me.cycleId);
      if (end && new Date() > end) {
        return NextResponse.json({ error: `Jendela banding sudah tutup (${end.toLocaleDateString("id-ID")} — D6 7 hari)` }, { status: 409 });
      }
      await db.appraisalRecord.update({
        where: { id: me.id },
        data: { appealNote: note, appealStatus: "Submitted", status: "Appealed" },
      });
      await db.activityLog.create({
        data: { action: "Submitted", entity: "AppraisalRecord", entityId: me.id, detail: `BANDING diajukan utk ${me.docNo}: "${note.slice(0, 120)}"` },
      });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "withdrawAppeal") {
      if (me.appealStatus !== "Submitted") return NextResponse.json({ error: "Tidak ada banding aktif" }, { status: 409 });
      await db.appraisalRecord.update({
        where: { id: me.id },
        data: { appealStatus: "Withdrawn", appealDecidedBy: m.actor.fullName, appealDecidedAt: new Date(), status: "Published" },
      });
      await db.activityLog.create({
        data: { action: "Processed", entity: "AppraisalRecord", entityId: me.id, detail: `Banding ${me.docNo} DITARIK pengaju` },
      });
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
