// GET /api/rekankerja/ess/leave/calendar?month=YYYY-MM&format=ics —
// Task 99 (F1-2): kalender cuti TIM (satu unit kerja) untuk ESS.
// Scope = unit kerja aktor sendiri (prefix nama unit diterapkan service —
// listOnLeave), jadi karyawan melihat rekan satu tim yang sedang cuti,
// TANPA alasan (privacy: field reason dihapus dari semua baris keluar).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { leaveCalendarMonth, buildLeaveIcs } from "@/rekankerja/leave/services/leave-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const url = new URL(req.url);
    const now = new Date();
    const month =
      url.searchParams.get("month") ??
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Parameter month harus format YYYY-MM" }, { status: 400 });
    }

    // Unit kerja aktor → scope tim (assignment aktif pertama).
    const me = await db.employee.findUnique({
      where: { id: employeeId },
      select: { assignments: { where: { validTo: null }, take: 1, select: { orgUnit: { select: { name: true } } } } },
    });
    const org = me?.assignments[0]?.orgUnit?.name ?? null;

    const cal = await leaveCalendarMonth(db, { month, orgUnitName: org ?? undefined });
    // Privacy — alasan cuti tidak dibagikan ke rekan satu tim.
    const rows = cal.rows.map(({ reason: _reason, ...rest }) => rest);

    // format=ics — feed kalender (RFC 5545) utk Google/Outlook/Apple.
    if (url.searchParams.get("format") === "ics") {
      const ics = buildLeaveIcs(rows, `Cuti Tim — RekanKerja`);
      return new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="leave-team-${month}.ics"`,
        },
      });
    }

    return NextResponse.json({ month: cal.month, from: cal.from, to: cal.to, rows, orgUnitName: org });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
