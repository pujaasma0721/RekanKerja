import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { listEncashments, submitEncashment, decideEncashment } from "@/rekankerja/leave/services/leave-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

// GET /api/rekankerja/leave/encashment?status= — uang pengganti cuti
// (padanan LeaveEncashment.jsp + LeaveEncashmentToApprove.jsp).
// Task 99: guard menu-view — view Uang Pengganti Cuti.
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["leave:leave-encashment"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi).
    const rows = await listEncashments(db, { status }, await moneyViewForReq(req, db));
    const stats = {
      total: rows.length,
      submitted: rows.filter((r) => r.status === "Submitted").length,
      approved: rows.filter((r) => r.status === "Approved").length,
      transferred: rows.filter((r) => r.status === "Transferred").length,
      paid: rows.filter((r) => r.status === "Paid").length,
      totalDays: Math.round(rows.filter((r) => ["Approved", "Transferred", "Paid"].includes(r.status)).reduce((s, r) => s + r.days, 0) * 100) / 100,
      // 45-b: amount nullable saat masked — sum ?? 0 (bebas NaN).
      totalAmount: rows.filter((r) => ["Approved", "Transferred", "Paid"].includes(r.status)).reduce((s, r) => s + (r.amount ?? 0), 0),
    };
    return NextResponse.json({ encashments: rows, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan encashment (saldo → uang)
// Task 82-T4: guard hak aksi menu (dulu hanya requireTenant — VIEWER/akun
// tanpa hak bisa memicu pengajuan). Admin HR mengajukan atas nama karyawan.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "leave:leave-encashment", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.employeeId || !b.leaveTypeId || !b.year || !b.days) {
      return NextResponse.json({ error: "employeeId, leaveTypeId, year & days wajib" }, { status: 400 });
    }
    const res = await submitEncashment(db, {
      employeeId: String(b.employeeId),
      leaveTypeId: String(b.leaveTypeId),
      year: parseInt(b.year, 10),
      days: Number(b.days),
      paymentDate: b.paymentDate ? String(b.paymentDate) : undefined,
      note: b.note ? String(b.note) : undefined,
    });

    // Task 99 (G13) — notifikasi in-app → Admin/HR: pengajuan menunggu
    // persetujuan (encashment sebelumnya tanpa notifikasi sama sekali).
    void (async () => {
      try {
        const emp = await db.employee.findUnique({
          where: { id: String(b.employeeId) },
          select: { fullName: true },
        });
        await notifyEvent(db, {
          to: "admins", docType: "Leave", docNo: res.docNo,
          title: `Pengajuan uang pengganti cuti ${res.docNo} menunggu persetujuan`,
          body: `${emp?.fullName ?? "Karyawan"} — ${Number(b.days)} hari (≈ Rp ${res.amount.toLocaleString("id-ID")})`,
          kind: "leave", link: "leave:leave-encashment",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama */ }
    })();

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan approval (approve | reject | cancel).
// L-05: guard mutasi — role VIEWER ditolak (403) dan identitas
// approver NYATA dari sesi dicatat ke decidedById (sebelumnya selalu NULL).
// Task 32-d: guard hak AKSI menu per pengguna — approve/reject → op:approve pada
// leave:leave-encashment; cancel → update pada leave:leave-encashment.
// Body dibaca SEKALI sebelum guard (aksi menentukan aksi menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const m = b.action === "cancel"
      ? await requireMenuAction(req, "leave:leave-encashment", "update")
      : await requireMenuAction(req, "leave:leave-encashment", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await decideEncashment(m.db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
      actorId: m.actor.appUserId ?? m.actor.userId,
    });

    // Task 99 (G13) — notifikasi in-app → KARYAWAN untuk keputusan final
    // approve/reject (bukan cancel): ESS melihat lonceng notifikasi.
    if ((b.action === "approve" || b.action === "reject") && (res.status === "Approved" || res.status === "Rejected")) {
      void (async () => {
        try {
          const enc = await m.db.leaveEncashment.findUnique({
            where: { id: String(b.id) },
            select: { employeeId: true, days: true },
          });
          if (enc) {
            await notifyEvent(m.db, {
              to: "employee", docType: "Leave", docNo: res.docNo, employeeId: enc.employeeId,
              title: `Uang pengganti cuti ${res.docNo} ${res.status === "Approved" ? "disetujui" : "ditolak"}`,
              body: `${enc.days} hari${b.note ? ` — catatan: ${String(b.note)}` : ""}`,
              kind: "leave", link: "leave:leave-encashment",
            });
          }
        } catch { /* notifikasi tidak boleh mengganggu proses utama */ }
      })();
    }

    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
