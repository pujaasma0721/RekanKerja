import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// GET /api/onevity/meta — sinyal agregat untuk shell (badge, widget hidup menu).
// Field baru (Task D-2, desain menu ★): pendingApprovers, payrollDays,
// payrollPeriodEnd, emailActive. Query baru dibungkus .catch() agar environment
// yang belum termigrasi penuh tidak mematikan endpoint meta secara keseluruhan.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const [pendingActions, activeEmployees, companies, payrollDraftRuns, benefitPendingClaims, recentPending, openPeriod, emailCfg] = await Promise.all([
      db.personnelAction.count({ where: { status: "Submitted" } }),
      db.employee.count({ where: { status: "Active" } }),
      db.company.findFirst({ where: { active: true } }),
      db.payrollRun.count({ where: { status: { in: ["Draft", "Calculated"] } } }),
      db.benefitClaim.count({ where: { status: "Pending" } }),
      db.personnelAction
        .findMany({
          where: { status: "Submitted" },
          include: { employee: { select: { fullName: true } } },
          orderBy: { submittedAt: "desc" },
          take: 3,
        })
        .catch(() => [] as never[]),
      db.payrollPeriod.findFirst({ where: { status: "Open" }, orderBy: { endDate: "desc" } }).catch(() => null),
      db.emailConfig.findFirst().catch(() => null),
    ]);

    // Widget ring gajian: hari menuju akhir periode payroll aktif (fallback processDate).
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const processDate = openPeriod?.processDate ?? null;
    const endDate = openPeriod?.endDate ?? null;
    const target =
      processDate && processDate.getTime() > startToday.getTime()
        ? processDate
        : endDate && endDate.getTime() > startToday.getTime()
          ? endDate
          : null;
    const payrollDays = target ? Math.ceil((target.getTime() - startToday.getTime()) / 86_400_000) : null;

    return NextResponse.json({
      pendingActions,
      activeEmployees,
      company: companies,
      payrollDraftRuns,
      benefitPendingClaims,
      // widget hidup menu (opsi B — hanya sinyal nyata)
      pendingApprovers: recentPending.map((r) => r.employee.fullName),
      payrollDays,
      payrollPeriodEnd: target ? target.toISOString() : null,
      emailActive: !!(emailCfg?.active && emailCfg?.smtpHost),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
