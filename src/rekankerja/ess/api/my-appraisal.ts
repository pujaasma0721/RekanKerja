import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import {
  mySelfAssessment, myPublishedResult, submitSelf, aiCompose,
  type SubmitSelfInput, type AiComposeInput,
} from "@/rekankerja/performance/services/perf-appraisal-service";
import {
  acknowledge, appeal, withdrawAppeal,
} from "@/rekankerja/performance/services/perf-results-service";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";
import { trFor, locReportFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

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
//   POST {action: acknowledge|appeal|withdrawAppeal, appraisalId} → P4 §31:
//        konfirmasi menerima hasil (bukan persetujuan isi) + banding D6
//        (jendela appealDays sejak publishAt) + tarik banding (self-scope).
// Guard: requireEss (self-scope anti-IDOR).
// P6 — respons diperluas `pips`: program PIP milik sendiri (§33-3 karyawan
// melihat progresnya sendiri — read-only; SK PIP terbit saat draf dibuat).
// ============================================================================

/** PIP milik karyawan (§33-3 — read-only di ESS). Anti-IDOR: self-scope
 * employeeId dari sesi ESS. */
async function myPips(db: TenantDb, employeeId: string) {
  const rows = await db.pipPlan.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (rows.length === 0) return [];
  const reviewerIds = [...new Set(rows.map((r) => r.reviewerId))];
  const reviewers = await db.employee.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, fullName: true } });
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.fullName]));
  const cps = await db.pipCheckpoint.findMany({
    where: { pipId: { in: rows.map((r) => r.id) } },
    orderBy: { seq: "asc" },
  });
  return rows.map((r) => {
    let targets: { title: string; metric: string; target: string; weight: number }[] = [];
    try { targets = JSON.parse(r.targetsJson) as typeof targets; } catch { targets = []; }
    return {
      id: r.id,
      docNo: r.docNo,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      status: r.status,
      reviewerName: reviewerName.get(r.reviewerId) ?? null,
      targets,
      checkpoints: cps
        .filter((c) => c.pipId === r.id)
        .map((c) => ({
          seq: c.seq, dueDate: c.dueDate.toISOString(), achievementPct: c.achievementPct,
          status: c.status, notes: c.notes,
        })),
      outcomeNotes: r.outcomeNotes,
    };
  });
}

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
    if (!appraisals.length) return NextResponse.json({ current: null, published: null, previous: [], pips: await myPips(db, employeeId) });

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
      pips: await myPips(db, employeeId),
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

    // ===== P4 §31: acknowledge + banding (self-scope; hasil Published) =====
    if (action === "acknowledge") {
      const out = await acknowledge(db, employeeId, String(b.appraisalId ?? ""));
      return NextResponse.json(out);
    }

    if (action === "appeal") {
      const out = await appeal(db, employeeId, String(b.appraisalId ?? ""), {
        note: String(b.note ?? ""),
        evidence: b.evidence != null ? String(b.evidence) : null,
      });
      return NextResponse.json(out, { status: 201 });
    }

    if (action === "withdrawAppeal") {
      const out = await withdrawAppeal(db, employeeId, String(b.appraisalId ?? ""));
      return NextResponse.json(out);
    }

    // ===== P8 §7.2 PP 35/2021: EKSPOR RIWAYAT PENILAIAN SENDIRI (self-scope
    // anti-IDOR — employeeId HANYA dari sesi ESS; bukti konversi PKWT). =====
    if (action === "exportHistory") {
      const lang: Lang = b.lang === "id" ? "id" : "en";
      const me = await db.employee.findFirst({
        where: { id: employeeId },
        select: { employeeNo: true, fullName: true },
      });
      if (!me) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });

      const rows = await db.appraisalRecord.findMany({
        where: { employeeId },
        include: { cycle: { select: { code: true, periodStart: true, periodEnd: true } } },
        orderBy: [{ cycle: { periodStart: "asc" } }, { docNo: "asc" }],
        take: 100,
      });
      const apprIds = rows.map((r) => r.id);
      const decisions = apprIds.length > 0
        ? await db.calibrationDecision.findMany({ where: { appraisalId: { in: apprIds } }, orderBy: { decidedAt: "asc" }, take: 500 })
        : [];
      const nOf = new Map<string, number>();
      for (const d of decisions) nOf.set(d.appraisalId, (nOf.get(d.appraisalId) ?? 0) + 1);

      const fmtD = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
      const ratingLabel = new Map<number, string>();
      for (const s of await db.ratingScale.findMany()) ratingLabel.set(s.value, lang === "id" ? s.labelId : s.labelEn);

      const periodLabel = rows.length > 0
        ? `${rows[0].cycle.periodStart.getFullYear()}–${rows[rows.length - 1].cycle.periodEnd.getFullYear()}`
        : `${new Date().getFullYear()}`;
      const title = `${trFor(lang, "Riwayat Penilaian")} — ${me.employeeNo} ${me.fullName} · ${locReportFor(lang, periodLabel)}`;

      const sNum = (v: number | null) => (v == null ? "—" : v);
      const sheets: ExportSheet[] = [
        {
          name: trFor(lang, "Riwayat Penilaian"),
          title,
          columns: [
            { header: trFor(lang, "No. Dokumen"), width: 16 },
            { header: trFor(lang, "Siklus"), width: 14 },
            { header: trFor(lang, "Periode"), width: 22 },
            { header: trFor(lang, "Status"), width: 16 },
            { header: trFor(lang, "Skor Diri"), width: 10 },
            { header: trFor(lang, "Skor Atasan"), width: 12 },
            { header: trFor(lang, "Skor Final"), width: 10 },
            { header: trFor(lang, "Rating"), width: 14 },
            { header: trFor(lang, "Tanda Terima"), width: 12 },
            { header: trFor(lang, "Banding"), width: 14 },
            { header: trFor(lang, "Jml Kalibrasi"), width: 12 },
          ],
          rows: rows.map((r) => [
            r.docNo, r.cycle.code,
            `${r.cycle.periodStart.toISOString().slice(0, 10)} → ${r.cycle.periodEnd.toISOString().slice(0, 10)}`,
            r.status, sNum(r.selfScore), sNum(r.managerScore), sNum(r.finalScore),
            r.finalRating == null ? "—" : `${r.finalRating} — ${ratingLabel.get(r.finalRating) ?? ""}`.trim(),
            r.acknowledgedAt ? fmtD(r.acknowledgedAt) : "—",
            r.appealStatus ?? "—",
            nOf.get(r.id) ?? 0,
          ]),
        },
        {
          name: trFor(lang, "Jejak Kalibrasi"),
          title,
          columns: [
            { header: trFor(lang, "No. Dokumen"), width: 16 },
            { header: trFor(lang, "Siklus"), width: 14 },
            { header: trFor(lang, "Skor dari"), width: 10 },
            { header: trFor(lang, "Skor ke"), width: 10 },
            { header: trFor(lang, "Rating dari"), width: 11 },
            { header: trFor(lang, "Rating ke"), width: 11 },
            { header: trFor(lang, "Alasan"), width: 48 },
            { header: trFor(lang, "Diputus oleh"), width: 18 },
            { header: trFor(lang, "Waktu"), width: 12 },
          ],
          rows: decisions.map((d) => {
            const ap = rows.find((r) => r.id === d.appraisalId);
            return [
              ap?.docNo ?? "—", ap?.cycle.code ?? "—",
              sNum(d.oldScore), sNum(d.newScore),
              sNum(d.oldRating), sNum(d.newRating),
              d.reason, d.decidedBy, fmtD(d.decidedAt),
            ];
          }),
        },
      ];
      const buf = await toXlsxMulti(sheets, { lang });
      try {
        await db.activityLog.create({
          data: {
            employeeId,
            action: "Exported", entity: "PerformanceReportDocument",
            detail: `Ekspor XLSX riwayat penilaian sendiri (${rows.length} siklus · PP 35/2021 §7.2 — ${me.employeeNo})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-perf-history-${me.employeeNo}`, "xlsx"));
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
