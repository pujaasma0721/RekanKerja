import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { DecisionConflictError, DecisionForbiddenError } from "@/onevity/shared/services/approval-engine";
import { listRequests, submitRequest, decideRequest, previewRequest } from "@/onevity/leave/services/leave-service";
import { notifyEmailEvent, approverEmailsOf, employeeEmailOf } from "@/onevity/shared/services/email-service";

// GET /api/onevity/leave/requests?status=&employeeId=&year= — daftar permintaan
// (padanan LeaveRequest.jsp / LeaveRequestToApprove.jsp).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "all";
    const requests = await listRequests(db, {
      status,
      employeeId: sp.get("employeeId") ?? undefined,
      year: sp.get("year") ? Number(sp.get("year")) : undefined,
    });
    const stats = {
      total: requests.length,
      submitted: requests.filter((r) => r.status === "Submitted").length,
      approved: requests.filter((r) => r.status === "Approved").length,
      rejected: requests.filter((r) => r.status === "Rejected").length,
      cancelled: requests.filter((r) => r.status === "Cancelled").length,
      massLeave: requests.filter((r) => r.status === "MassLeave").length,
      pendingDays: Math.round(requests.filter((r) => r.status === "Submitted").reduce((s, r) => s + r.workingDays, 0) * 100) / 100,
      approvedDays: Math.round(requests.filter((r) => r.status === "Approved" || r.status === "MassLeave").reduce((s, r) => s + r.workingDays, 0) * 100) / 100,
    };
    return NextResponse.json({ requests, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan permintaan cuti (preview: true → hitung saja, tanpa simpan)
// Task 25: guard mutasi — identitas pengaju tercatat pada jalur approval berjenjang.
// Task 32-d: guard hak AKSI menu — create pada menu leave:leave-request (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "leave:leave-request", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const input = {
      employeeId: String(b.employeeId ?? ""),
      leaveTypeId: String(b.leaveTypeId ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      sessionFrom: b.sessionFrom === "PM" ? ("PM" as const) : ("AM" as const),
      dateTo: String(b.dateTo ?? ""),
      sessionTo: b.sessionTo === "AM" ? ("AM" as const) : ("PM" as const),
      reason: String(b.reason ?? ""),
      note: b.note ? String(b.note) : undefined,
      source: b.source ? String(b.source) : undefined,
      actorName: m.actor.name,
    };
    if (b.preview) {
      const res = await previewRequest(db, input);
      return NextResponse.json(res);
    }
    const res = await submitRequest(db, input);

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    void (async () => {
      try {
        const [emp, type] = await Promise.all([
          db.employee.findUnique({ where: { id: input.employeeId }, select: { fullName: true } }),
          db.leaveType.findUnique({ where: { id: input.leaveTypeId }, select: { name: true } }),
        ]);
        notifyEmailEvent(db, {
          event: "leave.submitted",
          to: await approverEmailsOf(db, input.employeeId),
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

// PATCH — keputusan approval (padanan Operation: Approve | Reject | Cancel).
// L-05: guard mutasi — role VIEWER ditolak (403) dan identitas
// approver NYATA dari sesi (AppUser tenant → fallback platform userId) dicatat
// ke decidedById (sebelumnya selalu NULL).
// Task 32-d: guard hak AKSI menu per pengguna — approve/reject → op:approve pada
// leave:leave-approval; cancel → op:cancel pada leave:leave-request.
// Body dibaca SEKALI sebelum guard (aksi menentukan menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const m = b.action === "cancel"
      ? await requireMenuAction(req, "leave:leave-request", "op:cancel")
      : await requireMenuAction(req, "leave:leave-approval", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await decideRequest(m.db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
      actorId: m.actor.appUserId ?? m.actor.userId,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
    });

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    // Hanya keputusan FINAL (status Approved/Rejected) yang memicu email ke
    // pengaju; approve jenjang menengah tetap menunggu (ada field approval).
    if (b.action !== "cancel" && !res.approval) {
      void (async () => {
        try {
          const lr = await m.db.leaveRequest.findUnique({
            where: { id: String(b.id) },
            select: { employeeId: true, docNo: true, dateFrom: true, dateTo: true, leaveType: { select: { name: true } }, employee: { select: { fullName: true } } },
          });
          const emp = lr ? await employeeEmailOf(m.db, lr.employeeId) : null;
          if (lr && emp) {
            notifyEmailEvent(m.db, {
              event: b.action === "approve" ? "leave.approved" : "leave.rejected",
              to: [emp],
              data: {
                nama: lr.employee?.fullName ?? "-", docNo: lr.docNo,
                jenisCuti: lr.leaveType?.name ?? "-",
                periode: `${new Date(lr.dateFrom).toISOString().slice(0, 10)} → ${new Date(lr.dateTo).toISOString().slice(0, 10)}`,
                jumlahHari: String(res.regeneratedDays ?? "-"),
                catatan: b.note ? String(b.note) : "-",
              },
            });
          }
        } catch { /* never */ }
      })();
    }

    return NextResponse.json(res);
  } catch (e) {
    // race double-decide (dua approver klik bersamaan) → 409 ramah; akses
    // ditolak engine (aktor bukan approver/delegate) → 403 — bukan 400 generik
    if (e instanceof DecisionConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
