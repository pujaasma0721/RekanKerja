// POST /api/onevity/ess/overtime — pengajuan perintah lembur untuk diri
// sendiri (kontrak T8-ESS-FRONTEND). Me-reuse submitOvertimeOrder
// attendance-service (status Pending → menunggu approve HR).
// Body: { date, planStart, planEnd, reason }
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { submitOvertimeOrder } from "@/onevity/time-attendance/services/attendance-service";

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const date = String(b.date ?? "");
    const planStart = String(b.planStart ?? "");
    const planEnd = String(b.planEnd ?? "");
    const reason = String(b.reason ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Tanggal lembur wajib format YYYY-MM-DD" }, { status: 400 });
    }
    // jam valid 00:00–23:59 (tolak "25:99" dsb sebelum sentuh service)
    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!TIME_RE.test(planStart) || !TIME_RE.test(planEnd)) {
      return NextResponse.json({ error: "Jam mulai/selesai wajib format HH:MM (00:00–23:59)" }, { status: 400 });
    }
    if (!reason.trim()) {
      return NextResponse.json({ error: "Alasan lembur wajib diisi" }, { status: 400 });
    }

    const res = await submitOvertimeOrder(db, {
      employeeId,
      overtimeDate: date,
      timeFrom: planStart,
      timeTo: planEnd,
      reason,
    });
    const order = res.order as { orderNo?: string } | null;

    return NextResponse.json({ docNo: order?.orderNo ?? "", status: "Pending" }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
