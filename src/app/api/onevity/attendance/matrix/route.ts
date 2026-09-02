import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { resolveDayType, addDays } from "@/lib/onevity/attendance-service";

// GET /api/onevity/attendance/matrix?from=YYYY-MM-DD — matriks karyawan × 7 hari
// (padanan Employee Schedule Matrix): day type efektif per hari per karyawan.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const fromParam = req.nextUrl.searchParams.get("from");
    const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? new Date(`${fromParam}T00:00:00`)
      : (() => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dow); return d; })();

    const employees = await db.employee.findMany({
      where: { status: "Active" },
      select: {
        id: true, employeeNo: true, fullName: true,
        assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
        scheduleAssignments: { where: { validTo: null }, orderBy: { validFrom: "desc" }, take: 1, select: { id: true, clockingRequired: true } },
      },
      orderBy: { employeeNo: "asc" },
    });

    const days: { date: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      days.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" }),
      });
    }

    const rows = await Promise.all(
      employees.map(async (emp) => {
        const cells = await Promise.all(
          days.map(async (d) => {
            const date = new Date(`${d.date}T00:00:00`);
            const { dayType } = await resolveDayType(db, emp.id, date);
            return {
              date: d.date,
              code: dayType?.code ?? null,
              name: dayType?.name ?? null,
              color: dayType?.color ?? null,
              category: dayType?.category ?? null,
            };
          }),
        );
        return {
          employeeId: emp.id,
          employeeNo: emp.employeeNo,
          fullName: emp.fullName,
          orgUnitName: emp.assignments[0]?.orgUnit?.name ?? null,
          assigned: emp.scheduleAssignments.length > 0,
          clockingRequired: emp.scheduleAssignments[0]?.clockingRequired ?? true,
          cells,
        };
      }),
    );

    return NextResponse.json({ from: from.toISOString().slice(0, 10), days, rows, total: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
