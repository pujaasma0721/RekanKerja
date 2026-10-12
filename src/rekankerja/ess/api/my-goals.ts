// P1-PERF — ESS Target Saya (§14.3; §26-4 mode MBO: usulan KPI karyawan;
// §18.3 AMANDEMEN 1: tab "Periode lalu" read-only + tombol "Usulkan KPI yang
// sama dengan periode lalu"). Self-scope: hanya appraisal milik karyawan ini.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { proposeGoals, type KpiRowInput } from "@/rekankerja/performance/services/goals-service";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

interface KpiClient {
  kpiDefId?: string | null; title: string; polarity: string; unit: string;
  thresholdMin?: number | null; target: number; stretchValue?: number | null;
  weight: number; isCritical?: boolean;
}

async function myAppraisal(db: TenantDb, employeeId: string) {
  return db.appraisalRecord.findFirst({
    where: {
      employeeId,
      cycle: { status: { in: ["GoalSetting", "Ongoing", "Assessment", "Calibration", "Published"] } },
    },
    include: { cycle: true },
    orderBy: { docNo: "desc" },
  });
}

// GET /api/rekankerja/ess/my-goals — target periode aktif + progress + periode lalu
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const me = await myAppraisal(db, employeeId);
    if (!me) {
      return NextResponse.json({ active: null, note: "Belum terdaftar di siklus penilaian aktif." });
    }
    const kpis = await db.appraisalKpi.findMany({
      where: { appraisalId: me.id },
      orderBy: { createdAt: "asc" },
    });
    // tab periode lalu (§18.3): siklus terdahulu terdekat yang terkunci
    const past = await db.appraisalRecord.findFirst({
      where: {
        employeeId,
        id: { not: me.id },
        status: { in: ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"] },
        cycle: { periodEnd: { lt: me.cycle.periodStart } },
      },
      include: { cycle: { select: { code: true, name: true } }, kpis: { orderBy: { createdAt: "asc" } } },
      orderBy: { docNo: "desc" },
    });
    const canPropose = me.cycle.status === "GoalSetting" && !["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"].includes(me.status);
    return NextResponse.json({
      active: {
        appraisalId: me.id,
        docNo: me.docNo,
        status: me.status,
        cycle: { code: me.cycle.code, name: me.cycle.name, goalEnd: me.cycle.goalEnd?.toISOString() ?? null, status: me.cycle.status },
        kpis: kpis.map((k) => ({
          id: k.id, title: k.title, polarity: k.polarity, unit: k.unit,
          thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
          weight: k.weight, dataSource: k.dataSource, proposedBy: k.proposedBy, origin: k.origin,
          midActual: k.midActual,
        })),
        goalsCopiedFrom: me.goalsCopiedFrom,
      },
      past: past ? {
        cycleCode: past.cycle.code,
        finalScore: past.finalScore, finalRating: past.finalRating,
        kpis: past.kpis.map((k) => ({ id: k.id, title: k.title, target: k.target, weight: k.weight, finalActual: k.finalActual })),
      } : null,
      canPropose,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/ess/my-goals — {action: propose} usulan MBO (§26-4)
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = await req.json();
    if (b.action !== "propose") {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${String(b.action ?? "")}` }, { status: 400 });
    }
    const me = await myAppraisal(db, employeeId);
    if (!me) return NextResponse.json({ error: "Anda belum terdaftar di siklus aktif" }, { status: 404 });
    const kpis = (Array.isArray(b.kpis) ? b.kpis : []) as KpiClient[];
    if (kpis.length === 0) return NextResponse.json({ error: "Usulan kosong — tambahkan minimal 1 KPI" }, { status: 400 });
    const mapped: KpiRowInput[] = kpis.map((k) => ({
      kpiDefId: k.kpiDefId ?? null,
      title: String(k.title ?? ""),
      polarity: String(k.polarity ?? "Higher"),
      unit: String(k.unit ?? ""),
      thresholdMin: k.thresholdMin == null ? null : Number(k.thresholdMin),
      target: Number(k.target ?? 0),
      stretchValue: k.stretchValue == null ? null : Number(k.stretchValue),
      weight: Number(k.weight ?? 0),
      isCritical: k.isCritical === true,
      dataSource: "Manual",
      sourceKey: null,
    }));
    await proposeGoals(db, { appraisalId: me.id, kpis: mapped }, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
