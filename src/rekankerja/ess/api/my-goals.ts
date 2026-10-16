import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { proposeMbo, type KpiItemInput } from "@/rekankerja/performance/services/perf-goal-service";
import { APPRAISAL_LOCKED } from "@/rekankerja/performance/services/perf-cycle-service";

// ============================================================================
// PERFORMANCE — ESS "Target Saya" (P1 — §17 ess/my-goals, §18.3):
//   GET  → target siklus AKTIF milik karyawan (terlihat setelah GoalApproved
//          — §26-6; sebelum itu status saja tanpa rincian) + tab "Periode
//          lalu" (riwayat KPI siklus terdahulu, read-only).
//   POST {action: propose, appraisalId, items} → usulan KPI MBO (§26-4,
//          guard §35-4: fase GoalSetting & belum GoalApproved; status →
//          GoalProposed; atasan menyetujui/mengubah/menolak di sisi atasan).
// Guard: requireEss (self-scope anti-IDOR — hanya data karyawan sendiri).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const appraisals = await db.appraisalRecord.findMany({
      where: { employeeId },
      include: {
        cycle: { select: { id: true, code: true, name: true, status: true, periodStart: true, periodEnd: true, goalEnd: true } },
        kpis: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    if (!appraisals.length) return NextResponse.json({ current: null, previous: [] });

    // siklus aktif = status siklus belum Published/Closed; sisanya riwayat
    const current = appraisals.find((a) => !["Published", "Closed"].includes(a.cycle.status)) ?? null;
    const previous = appraisals.filter((a) => a.id !== current?.id && (APPRAISAL_LOCKED as readonly string[]).includes(a.status));

    const shape = (a: (typeof appraisals)[number], reveal: boolean) => ({
      appraisalId: a.id,
      docNo: a.docNo,
      status: a.status,
      cycle: {
        code: a.cycle.code, name: a.cycle.name, status: a.cycle.status,
        periodStart: a.cycle.periodStart.toISOString().slice(0, 10),
        periodEnd: a.cycle.periodEnd.toISOString().slice(0, 10),
      },
      goalsCopiedFrom: a.goalsCopiedFrom,
      // rincian target hanya setelah dikunci atasan (§26-6 — draf atasan+HR
      // sebelum submit tidak terlihat karyawan)
      kpis: reveal ? a.kpis.map((k) => ({
        id: k.id, title: k.title, polarity: k.polarity, unit: k.unit,
        description: k.description, measureMode: k.measureMode, metricLevelsJson: k.metricLevelsJson,
        thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
        weight: k.weight, isCritical: k.isCritical,
        origin: k.origin, proposedBy: k.proposedBy,
      })) : [],
      proposalOpen: a.status === "Enrolled" && a.cycle.status === "GoalSetting",
      canPropose: a.cycle.status === "GoalSetting" && !(APPRAISAL_LOCKED as readonly string[]).includes(a.status),
      // ringkasan capaian utk tab periode lalu (hasil akhir ringkas §18.3)
      finalScore: a.finalScore, finalRating: a.finalRating,
      finalActuals: reveal ? a.kpis.map((k) => ({ title: k.title, finalActual: k.finalActual, midActual: k.midActual, unit: k.unit, weight: k.weight })) : [],
    });

    return NextResponse.json({
      current: current ? shape(current, (APPRAISAL_LOCKED as readonly string[]).includes(current.status)) : null,
      previous: previous.map((a) => shape(a, true)),
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
    if (action !== "propose") {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
    const items = (Array.isArray(b.items) ? b.items : []) as KpiItemInput[];
    if (!items.length) return NextResponse.json({ error: "Usulan kosong — tambahkan minimal satu KPI" }, { status: 400 });
    const out = await proposeMbo(db, employeeId, String(b.appraisalId ?? ""), items);
    await db.activityLog.create({
      data: {
        action: "Submitted", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
        detail: `Usulan KPI karyawan (MBO): ${out.created} baris — menunggu keputusan atasan (§26-4, guard §35-4)`,
      },
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
