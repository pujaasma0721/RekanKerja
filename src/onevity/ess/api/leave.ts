// GET /api/onevity/ess/leave + POST ajukan cuti (kontrak T8-ESS-FRONTEND).
// POST me-reuse leave-service submitRequest (validasi identik jalur admin:
// saldo, bentrok, backdate guard, maks per permintaan, waiting period).
import { NextResponse } from "next/server";
import { requireEss, fmtIsoDate } from "@/onevity/ess/api/ess-auth";
import { listBalances, listRequests, submitRequest } from "@/onevity/leave/services/leave-service";
import { dispatchWebhookEvent } from "@/onevity/shared/services/webhook-service";

// GET — saldo cuti tahun berjalan + riwayat permintaan saya.
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const year = new Date().getFullYear();
    const [balances, requests] = await Promise.all([
      listBalances(db, { employeeId, year }),
      listRequests(db, { employeeId, limit: 50 }),
    ]);

    return NextResponse.json({
      balances: balances.map((b) => ({
        typeId: b.leaveTypeId,
        code: b.leaveTypeCode,
        name: b.leaveTypeName,
        entitlement: b.entitlement,
        taken: b.taken,
        applied: b.applied,
        available: b.remaining,
      })),
      requests: requests.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        typeName: r.leaveTypeName,
        dateFrom: fmtIsoDate(r.dateFrom),
        dateTo: fmtIsoDate(r.dateTo),
        days: r.workingDays,
        status: r.status,
        approval:
          r.approval && r.approval.status === "InProgress"
            ? {
                level: r.approval.currentLevel,
                total: r.approval.totalLevels,
                currentApproverName: r.approval.currentApprover,
              }
            : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan cuti untuk DIRI SENDIRI.
// Body: { typeId, dateFrom, dateTo, halfDay?, reason }
// halfDay=true → sesi akhir AM (setengah hari terakhir; satu tanggal = setengah hari).
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const typeId = String(b.typeId ?? "");
    const dateFrom = String(b.dateFrom ?? "");
    const dateTo = String(b.dateTo ?? "");
    const reason = String(b.reason ?? "");
    const halfDay = b.halfDay === true;

    if (!typeId) return NextResponse.json({ error: "Jenis cuti wajib dipilih" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return NextResponse.json({ error: "Tanggal mulai/selesai wajib format YYYY-MM-DD" }, { status: 400 });
    }
    if (!reason.trim()) return NextResponse.json({ error: "Alasan cuti wajib diisi" }, { status: 400 });

    const res = await submitRequest(db, {
      employeeId,
      leaveTypeId: typeId,
      dateFrom,
      sessionFrom: "AM",
      dateTo,
      sessionTo: halfDay ? "AM" : "PM",
      reason,
      source: "ESS",
      actorName: fullName,
    });

    // G5: ESS leave juga memicu webhook leave.submitted (konsistensi event lintas jalur)
    void dispatchWebhookEvent(db, null, "leave.submitted", {
      docNo: res.docNo, employeeId, dateFrom, dateTo, reason, source: "ESS",
    });
    return NextResponse.json({ docNo: res.docNo, status: "Submitted" }, { status: 201 });
  } catch (e) {
    // validasi bisnis leave-service (saldo/bentrok/backdate/maks) → 400 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
