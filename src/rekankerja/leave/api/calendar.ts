import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { leaveCalendarMonth, buildLeaveIcs } from "@/rekankerja/leave/services/leave-service";

// GET /api/rekankerja/leave/calendar?month=YYYY-MM&org=&format=ics —
// Task 99 (F1-1): kalender cuti bulanan (baris Approved/MassLeave, UI
// mengelompokkan per tanggal). Guard menu-view: salah satu menu leave yang
// memakai kalender — laporan, persetujuan, atau saldo (info).
// format=ics → feed RFC 5545 (Google/Outlook/Apple); org opsional = prefix
// nama unit kerja (filter tim, semantics service-side).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["leave:leave-reports", "leave:leave-approval", "leave:leave-info"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const month = sp.get("month") ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Parameter month harus format YYYY-MM" }, { status: 400 });
    }
    const org = sp.get("org")?.trim() || undefined;

    const cal = await leaveCalendarMonth(db, { month, orgUnitName: org });

    if (sp.get("format") === "ics") {
      const ics = buildLeaveIcs(cal.rows, `Kalender Cuti — RekanKerja`);
      return new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="leave-${month}.ics"`,
        },
      });
    }

    return NextResponse.json({ month: cal.month, from: cal.from, to: cal.to, rows: cal.rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
