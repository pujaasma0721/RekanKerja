import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
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
// T41-M2: guard hak AKSI menu attendance:templates-schedule (Ubah) — aturan
// presensi (cap lembur/geofence/pembulatan) menggerakkan payroll & lembur;
// sebelumnya requireTenant saja (VIEWER bisa mengubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:templates-schedule", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const existing = await getRule(db);

    const data: Record<string, unknown> = {};
    if (b.roundingMinutes !== undefined) data.roundingMinutes = Math.max(1, Math.min(60, parseInt(b.roundingMinutes, 10) || 5));
    if (b.minOvertimeMinutes !== undefined) data.minOvertimeMinutes = Math.max(0, parseInt(b.minOvertimeMinutes, 10) || 0);
    if (b.overtimeRoundingMinutes !== undefined) data.overtimeRoundingMinutes = Math.max(1, Math.min(60, parseInt(b.overtimeRoundingMinutes, 10) || 30));
    // T15-CHAIN-EXT: cap lembur PP 35/2021 — override per tenant (jam/hari 1–8,
    // cap bulanan opsional; 0/null = tanpa cap bulanan).
    if (b.maxOvertimeHours !== undefined) data.maxOvertimeHours = Math.max(1, Math.min(8, parseInt(b.maxOvertimeHours, 10) || 4));
    if (b.maxOvertimeHoursMonthly !== undefined) {
      const monthly = parseInt(b.maxOvertimeHoursMonthly, 10);
      data.maxOvertimeHoursMonthly = Number.isFinite(monthly) && monthly > 0 ? Math.min(200, monthly) : null;
    }
    if (b.nonClockingPolicy !== undefined && ["AssumeNormal", "ByHours", "ByDays"].includes(b.nonClockingPolicy)) data.nonClockingPolicy = b.nonClockingPolicy;
    // 27-a P0: mode geofencing presensi (Off|Warn|Strict) — validasi nilai.
    if (b.geofenceMode !== undefined) {
      const mode = String(b.geofenceMode);
      if (!["Off", "Warn", "Strict"].includes(mode)) {
        return NextResponse.json({ error: "geofenceMode harus Off, Warn, atau Strict" }, { status: 400 });
      }
      data.geofenceMode = mode;
    }
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
