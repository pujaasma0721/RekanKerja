// POST /api/rekankerja/ess/overtime — pengajuan perintah lembur untuk diri
// sendiri (kontrak T8-ESS-FRONTEND). Me-reuse submitOvertimeOrder
// attendance-service (status Pending → menunggu approve HR).
// Body: { date, planStart, planEnd, reason }
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { submitOvertimeOrder } from "@/rekankerja/time-attendance/services/attendance-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

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
      // Fix audit 40 minor #2 — aktor ESS (AppUser → Employee.fullName) dipass
      // supaya chain/ActivityLog mencatat pengaju (parity jalur admin
      // time-attendance/api/overtime.ts:94-123).
      actorName: fullName,
    });
    const order = res.order as
      | { id: string; orderNo: string; employeeId: string; overtimeDate: Date; planMinutes: number; employee: { fullName: string } | null }
      | null;

    // Fix audit 40 minor #2 — notifikasi approver JENJANG PERTAMA (resolusi
    // chain) kini terkirim dari ESS (dulu hanya jalur admin); link modul
    // "attendance:overtime" (fix audit 40 M-8) — fire-and-forget, never-throw.
    if (order) {
      void notifyEvent(db, {
        to: "nextApprover", docType: "Overtime", docNo: order.orderNo, docId: order.id,
        title: `Perintah lembur ${order.orderNo} menunggu persetujuan Anda`,
        body: `${order.employee?.fullName ?? fullName} — lembur ${date} (rencana ${order.planMinutes} menit)`,
        kind: "attendance", link: "attendance:overtime",
      });
    }

    return NextResponse.json({ docNo: order?.orderNo ?? "", status: "Pending" }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
