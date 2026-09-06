// POST /api/onevity/ess/workoff — pengajuan izin tidak masuk untuk diri
// sendiri (kontrak T8-ESS-FRONTEND). Me-reuse submitWorkoff attendance-
// service → approval chain docType WorkOff.
// Body: { dateFrom, dateTo, halfDay?, paid, reason }
// halfDay=true → setengah hari (jam 08:00–12:00) pada tanggal mulai.
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { submitWorkoff } from "@/onevity/time-attendance/services/attendance-service";

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const dateFrom = String(b.dateFrom ?? "");
    const dateToRaw = String(b.dateTo ?? "");
    const halfDay = b.halfDay === true;
    const paid = b.paid === undefined ? true : b.paid === true;
    const reason = String(b.reason ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      return NextResponse.json({ error: "Tanggal mulai wajib format YYYY-MM-DD" }, { status: 400 });
    }
    if (dateToRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateToRaw)) {
      return NextResponse.json({ error: "Tanggal selesai wajib format YYYY-MM-DD" }, { status: 400 });
    }
    if (!reason.trim()) {
      return NextResponse.json({ error: "Alasan izin wajib diisi" }, { status: 400 });
    }

    const res = await submitWorkoff(db, {
      employeeId,
      dateFrom,
      dateTo: dateToRaw || dateFrom,
      allDay: !halfDay,
      timeFrom: halfDay ? "08:00" : null,
      timeTo: halfDay ? "12:00" : null,
      paid,
      reason,
      actorName: fullName,
    });

    // permit = baris WorkOffPermission yang baru dibuat (include docNo)
    const permit = res.permit as { docNo?: string } | null;
    return NextResponse.json({ docNo: permit?.docNo ?? "", status: "Pending" }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
