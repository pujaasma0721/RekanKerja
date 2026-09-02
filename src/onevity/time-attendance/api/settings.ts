import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { getRule } from "@/onevity/time-attendance/services/attendance-service";

// GET /api/onevity/attendance/settings — aturan singleton (padanan Overtime
// Specified + User Defined Rounding + Absence Wage Rules).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const rule = await getRule(db);
    const components = await db.wageComponent.findMany({
      where: { code: { in: [rule.overtimeComponentCode, rule.lateDeductionComponentCode, rule.absenceDeductionComponentCode, rule.attendanceAllowanceComponentCode] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });
    const allComponents = await db.wageComponent.findMany({
      where: { active: true },
      select: { code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({ rule, components, allComponents });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — perbarui aturan
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    const existing = await getRule(db);

    const data: Record<string, unknown> = {};
    if (b.roundingMinutes !== undefined) data.roundingMinutes = Math.max(1, Math.min(60, parseInt(b.roundingMinutes, 10) || 5));
    if (b.minOvertimeMinutes !== undefined) data.minOvertimeMinutes = Math.max(0, parseInt(b.minOvertimeMinutes, 10) || 0);
    if (b.overtimeRoundingMinutes !== undefined) data.overtimeRoundingMinutes = Math.max(1, Math.min(60, parseInt(b.overtimeRoundingMinutes, 10) || 30));
    if (b.nonClockingPolicy !== undefined && ["AssumeNormal", "ByHours", "ByDays"].includes(b.nonClockingPolicy)) data.nonClockingPolicy = b.nonClockingPolicy;
    for (const key of ["overtimeComponentCode", "lateDeductionComponentCode", "absenceDeductionComponentCode", "attendanceAllowanceComponentCode"] as const) {
      if (b[key] !== undefined) {
        const code = String(b[key]).trim().toUpperCase();
        if (code) {
          const comp = await db.wageComponent.findUnique({ where: { code } });
          if (!comp) return NextResponse.json({ error: `Komponen gaji ${code} tidak ditemukan` }, { status: 400 });
          data[key] = code;
        }
      }
    }
    if (b.attendanceAllowanceAmount !== undefined) data.attendanceAllowanceAmount = Math.max(0, Number(b.attendanceAllowanceAmount) || 0);
    if (b.lateDeductionPerHour !== undefined) data.lateDeductionPerHour = Math.max(0, Number(b.lateDeductionPerHour) || 0);
    if (b.absenceDeductionPerDay !== undefined) data.absenceDeductionPerDay = Math.max(0, Number(b.absenceDeductionPerDay) || 0);

    const rule = await db.attendanceRule.update({ where: { id: existing.id }, data });
    return NextResponse.json({ rule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
