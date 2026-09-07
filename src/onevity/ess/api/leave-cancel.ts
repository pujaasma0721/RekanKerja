import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { cancelApprovalChain } from "@/onevity/shared/services/approval-engine";

// POST /api/ess/leave/cancel — batalkan pengajuan cuti MILIK SENDIRI
// yang masih menunggu (Submitted). Hanya pemohon yang boleh — bukan
// approver/role apa pun (otorisasi: employeeId dokumen === sesi).
export async function POST(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId, actor } = m;

    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const lr = await db.leaveRequest.findUnique({
      where: { id },
      include: { employee: { select: { fullName: true } }, leaveType: { select: { name: true } } },
    });
    if (!lr) return NextResponse.json({ error: "Permintaan tidak ditemukan" }, { status: 404 });
    if (lr.employeeId !== employeeId) {
      return NextResponse.json({ error: "Akses ditolak: hanya pemohon yang dapat membatalkan pengajuan ini." }, { status: 403 });
    }
    if (lr.status !== "Submitted") {
      return NextResponse.json({ error: `Pengajuan sudah berstatus ${lr.status} — tidak bisa dibatalkan.` }, { status: 409 });
    }

    // hentikan jalur approval + set dokumen Cancelled (transisi atomik berurutan)
    await cancelApprovalChain(db, "Leave", id, actor.name);
    const upd = await db.leaveRequest.updateMany({
      where: { id, status: "Submitted" },
      data: {
        status: "Cancelled",
        decidedById: actor.appUserId ?? null,
        decidedAt: new Date(),
        decisionNote: `Dibatalkan oleh karyawan melalui Portal Karyawan${b.note ? ` — ${String(b.note)}` : ""}`,
      },
    });
    if (upd.count === 0) {
      return NextResponse.json({ error: "Pengajuan sudah diproses pengguna lain — muat ulang." }, { status: 409 });
    }

    await db.activityLog.create({
      data: {
        action: "Cancelled", entity: "LeaveRequest", entityId: lr.docNo, employeeId,
        detail: `${lr.docNo} (${lr.employee.fullName}, ${lr.leaveType.name}) dibatalkan karyawan via ESS`,
      },
    });

    return NextResponse.json({ ok: true, docNo: lr.docNo, status: "Cancelled" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
