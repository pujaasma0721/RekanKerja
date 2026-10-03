// ESS — ICS jadwal shift SENDIRI (Task 100 F1 G26) =========================
// =====================================================================
// GET /api/rekankerja/ess/attendance/ics — feed RFC 5545 jadwal shift 60
// hari ke depan utk karyawan sesi (self-scoped requireEss). Builder & pola
// respons dibagi dgn api admin time-attendance/api/schedule-ics.ts.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { buildScheduleIcsForEmployee, icsResponse } from "@/rekankerja/time-attendance/api/schedule-ics";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const built = await buildScheduleIcsForEmployee(db, employeeId);
    if (!built) {
      // sesi valid tapi data karyawan hilang (edge) — 403 pola ESS_NO_EMPLOYEE
      return NextResponse.json({ error: "Akun tidak terhubung data karyawan" }, { status: 403 });
    }
    return icsResponse(built.ics, built.employeeNo);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
