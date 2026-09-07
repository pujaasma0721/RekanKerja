import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { previewRequest, submitRequest } from "@/onevity/leave/services/leave-service";
import { notifyEmailEvent, approverEmailsOf } from "@/onevity/shared/services/email-service";

// POST /api/ess/leave/request — ajukan cuti dari portal karyawan.
// Body: { leaveTypeId, dateFrom, sessionFrom, dateTo, sessionTo, reason, note?, preview? }
// employeeId SELALU dari sesi (self-scoped); source "ESS" tercatat di dokumen.
// preview=true → hitung hari/saldo saja (untuk panel pratinjau live di form).
export async function POST(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId, actor } = m;

    const b = await req.json().catch(() => ({}));
    const input = {
      employeeId,
      leaveTypeId: String(b.leaveTypeId ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      sessionFrom: b.sessionFrom === "PM" ? ("PM" as const) : ("AM" as const),
      dateTo: String(b.dateTo ?? ""),
      sessionTo: b.sessionTo === "AM" ? ("AM" as const) : ("PM" as const),
      reason: String(b.reason ?? ""),
      note: b.note ? String(b.note) : undefined,
      source: "ESS" as const,
      actorName: actor.name,
    };

    if (b.preview) {
      const res = await previewRequest(db, input);
      return NextResponse.json(res);
    }
    if (!input.reason.trim()) {
      return NextResponse.json({ error: "Alasan wajib diisi" }, { status: 400 });
    }

    const res = await submitRequest(db, input);

    // ===== Notifikasi email otomatis (perilaku identik jalur admin) =====
    void (async () => {
      try {
        const [emp, type] = await Promise.all([
          db.employee.findUnique({ where: { id: employeeId }, select: { fullName: true } }),
          db.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { name: true } }),
        ]);
        notifyEmailEvent(db, {
          event: "leave.submitted",
          to: await approverEmailsOf(db, employeeId),
          data: {
            nama: emp?.fullName ?? "-", docNo: res.docNo, jenisCuti: type?.name ?? "-",
            periode: `${input.dateFrom} → ${input.dateTo}`, jumlahHari: String(res.workingDays),
            alasan: input.reason || "-",
          },
        });
      } catch { /* notifikasi tidak pernah mengganggu proses utama */ }
    })();

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
