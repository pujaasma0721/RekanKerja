// P3-PERF — tarikan data otomatis antar-modul (DEVELOPMENT-PLAN-PERFORMANCE.md
// §16 binding + §18.6 AMANDEMEN 2: pratinjau sebelum diterapkan; bukti
// autoValueJson = sumber+periode+nilai+waktu — penilaian bisa direplay).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

function bad(msg: string): never { throw new Error(msg); }

export interface AutoPullResult {
  kpiId: string;
  title: string;
  sourceKey: string;
  value: number | null;
  evidence: string;
  error?: string;
}

/** Tarik nilai satu KPI ber-sumber untuk periode siklus (read-only lintas modul §19). */
export async function pullAutoValue(
  db: TenantDb,
  input: { employeeId: string; sourceKey: string; periodStart: Date; periodEnd: Date },
): Promise<{ value: number | null; evidence: string }> {
  const { employeeId, sourceKey, periodStart, periodEnd } = input;
  switch (sourceKey) {
    case "attendance_presence_pct": {
      const rows = await db.attendanceDaily.findMany({
        where: { employeeId, workDate: { gte: periodStart, lte: periodEnd }, status: { not: "Off" } },
        select: { status: true },
      });
      if (rows.length === 0) return { value: null, evidence: "Tidak ada hari terjadwal pada periode" };
      const present = rows.filter((r) => r.status === "Present" || r.status === "Late").length;
      const pct = (present / rows.length) * 100;
      return { value: Math.round(pct * 10) / 10, evidence: `Hadir ${present} ÷ terjadwal ${rows.length} hari × 100 (AttendanceDaily)` };
    }
    case "attendance_late_minutes": {
      const agg = await db.attendanceDaily.aggregate({
        where: { employeeId, workDate: { gte: periodStart, lte: periodEnd } },
        _sum: { lateMinutes: true },
      });
      return { value: agg._sum.lateMinutes ?? 0, evidence: `Σ menit telat (AttendanceDaily) = ${agg._sum.lateMinutes ?? 0}` };
    }
    case "overtime_verified_hours": {
      const rows = await db.overtimeOrder.findMany({
        where: { employeeId, overtimeDate: { gte: periodStart, lte: periodEnd }, status: "Paid" },
        select: { verifiedMinutes: true },
      });
      const totalMin = rows.reduce((s, r) => s + (r.verifiedMinutes ?? 0), 0);
      return { value: Math.round((totalMin / 60) * 10) / 10, evidence: `Σ ${rows.length} order lembur Paid · ${totalMin} menit terverifikasi ÷ 60 (OvertimeOrder)` };
    }
    case "leave_unplanned_days": {
      // cuti non-rencana = selain cuti tahunan (CT-THN) yang disetujui
      const annual = await db.leaveType.findFirst({ where: { code: "CT-THN" }, select: { id: true } });
      const rows = await db.leaveRequest.findMany({
        where: {
          employeeId,
          dateFrom: { gte: periodStart, lte: periodEnd },
          status: "Approved",
          ...(annual ? { leaveTypeId: { not: annual.id } } : {}),
        },
        select: { workingDays: true, leaveTypeId: true },
      });
      const days = rows.reduce((s, r) => s + (r.workingDays ?? 0), 0);
      return { value: days, evidence: `Σ ${rows.length} pengajuan cuti non-tahunan disetujui = ${days} hari kerja (LeaveRequest)` };
    }
    case "recruitment_time_to_fill": {
      // MetricSnapshot time_to_fill periode terdekat (rekruter/HR officer)
      const snap = await db.metricSnapshot.findFirst({
        where: { metric: "time_to_fill" },
        orderBy: { period: "desc" },
        select: { value: true, period: true },
      });
      return { value: snap?.value ?? null, evidence: `MetricSnapshot time_to_fill periode ${snap?.period ?? "-"} = ${snap?.value ?? "—"}` };
    }
    case "recruitment_fulfilled_h": {
      // Σ empD ÷ Σ targetA rencana aktif dalam periode × 100 (RecruitmentPlan)
      const plans = await db.recruitmentPlan.findMany({
        where: { status: "Approved" },
        select: { targetA: true, empD: true },
      });
      const targetSum = plans.reduce((s, p) => s + (p.targetA ?? 0), 0);
      const filledSum = plans.reduce((s, p) => s + (p.empD ?? 0), 0);
      if (targetSum === 0) return { value: null, evidence: "Belum ada rencana MPP approved (RecruitmentPlan)" };
      return { value: Math.round((filledSum / targetSum) * 1000) / 10, evidence: `Σ filled ${filledSum} ÷ Σ target ${targetSum} × 100 (RecruitmentPlan approved)` };
    }
    default:
      bad(`Binding sumber otomatis tidak dikenal: ${sourceKey} (§16)`);
  }
}

/** Tarik semua KPI ber-sumber satu peserta → hasil per baris (pratinjau §18.6). */
export async function pullAutoSourcesFor(
  db: TenantDb,
  input: { appraisalId: string; apply: boolean },
): Promise<{ rows: AutoPullResult[]; applied: number }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: {
      cycle: { select: { code: true, status: true, periodStart: true, periodEnd: true } },
      kpis: true,
    },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status !== "Assessment") {
    bad(`Tarikan otomatis hanya saat fase Assessment (siklus ${a.cycle.code} saat ini ${a.cycle.status})`);
  }
  const sourced = a.kpis.filter((k) => k.dataSource !== "Manual" && k.sourceKey);
  const out: AutoPullResult[] = [];
  let applied = 0;
  for (const k of sourced) {
    const res = await pullAutoValue(db, {
      employeeId: a.employeeId,
      sourceKey: k.sourceKey as string,
      periodStart: a.cycle.periodStart,
      periodEnd: a.cycle.periodEnd,
    });
    out.push({
      kpiId: k.id,
      title: k.title,
      sourceKey: k.sourceKey as string,
      value: res.value,
      evidence: res.evidence,
      error: res.value == null ? "perlu input manual" : undefined,
    });
    if (input.apply && res.value != null) {
      const autoValueJson = JSON.stringify({
        source: k.dataSource,
        sourceKey: k.sourceKey,
        periodStart: a.cycle.periodStart.toISOString().slice(0, 10),
        periodEnd: a.cycle.periodEnd.toISOString().slice(0, 10),
        value: res.value,
        pulledAt: new Date().toISOString(),
        evidence: res.evidence,
      });
      await db.appraisalKpi.update({
        where: { id: k.id },
        data: { finalActual: res.value, autoValueJson },
      });
      applied++;
    }
  }
  return { rows: out, applied };
}
