// ============================================================================
// RECRUITMENT F5 — ESS: Rencana Rekrutmen milik sendiri (oranHR §2.10
// MysRecruitmentPlanning). Baris plan berstatus Applied — TANPA anggaran
// gaji (salaryBudget disembunyikan di ESS; hanya formula a–h + rekonsiliasi
// PR ringkas). Guard: requireEss.
// ============================================================================
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { listPlans } from "@/rekankerja/recruitment/services/planning-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db } = m.actor;

  try {
    // ESS: hanya plan Applied, tanpa uang (moneyVisible=false)
    const res = await listPlans(db, { status: "Applied", moneyVisible: false });
    return NextResponse.json({
      rows: res.rows.map((r) => ({
        id: r.id,
        period: r.period,
        seqNo: r.seqNo,
        positionTitle: r.positionTitle,
        officeName: r.officeName,
        targetA: r.targetA,
        adjustB: r.adjustB,
        totalC: r.totalC,
        empD: r.empD,
        inE: r.inE,
        outF: r.outF,
        resultedG: r.resultedG,
        toRecruitH: r.toRecruitH,
        basePeriod: r.basePeriod,
        note: r.note,
        appliedAt: r.appliedAt,
        recon: r.recon,
      })),
      stats: { applied: res.stats.applied, periods: res.stats.periods },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
