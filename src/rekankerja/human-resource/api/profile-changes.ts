// P1.1-BM (D-BM1) — API ADMIN: register pengajuan ubah data diri ESS =======
// ===========================================================================
// GET   /api/rekankerja/hr/profile-changes?status=&employeeId=&q=&from=&to=
//       — daftar pengajuan (docNo, karyawan, status, tanggal, alasan, entri
//         before/after, ringkasan chain) + stats (pending count utk badge).
// PATCH /api/rekankerja/hr/profile-changes {id, action: approve|reject, note}
//       — keputusan HR (op:approve menu hr:profile-changes). Reject wajib
//         catatan. Approval FINAL = patch otomatis (service) + notifikasi
//         in-app ke karyawan (tidak ada template email default yang cocok —
//         cek email-defaults.ts: hanya leave/travel/medical/pa/payroll/rec;
//         keputusan ini in-app notify saja).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import {
  listRequests, decideChange, ProfileChangeError,
} from "@/rekankerja/human-resource/services/profile-change-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["hr:profile-changes"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const rows = await listRequests(db, {
      status: sp.get("status") ?? undefined,
      employeeId: sp.get("employeeId") ?? undefined,
      q: sp.get("q") ?? undefined,
      dateFrom: sp.get("from") ?? undefined,
      dateTo: sp.get("to") ?? undefined,
    });
    return NextResponse.json({
      rows,
      stats: {
        total: rows.length,
        submitted: rows.filter((r) => r.status === "Submitted").length,
        approved: rows.filter((r) => r.status === "Approved").length,
        rejected: rows.filter((r) => r.status === "Rejected").length,
        cancelled: rows.filter((r) => r.status === "Cancelled").length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.id || !["approve", "reject"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject) wajib" }, { status: 400 });
    }
    const m = await requireMenuAction(req, "hr:profile-changes", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const note = b.note ? String(b.note) : null;
    if (b.action === "reject" && (!note || note.trim().length < 5)) {
      return NextResponse.json(
        { error: "Alasan penolakan wajib diisi (minimal 5 karakter) agar karyawan memahami keputusannya" },
        { status: 400 },
      );
    }
    const res = await decideChange(db, {
      id: String(b.id),
      action: b.action,
      note,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name, appUserId: m.actor.appUserId },
    });

    // keputusan FINAL → kabari karyawan (in-app; tanpa template email default
    // yang cocok — email-defaults.ts tidak punya event profile change).
    if (!res.approval) {
      const row = await db.employeeProfileChangeRequest.findUnique({
        where: { id: String(b.id) },
        select: { employeeId: true },
      });
      if (row) {
        void notifyEvent(db, {
          to: "employee",
          docType: "ProfileChange",
          docNo: res.docNo,
          docId: String(b.id),
          employeeId: row.employeeId,
          title: b.action === "approve"
            ? `Pengajuan ubah data ${res.docNo} disetujui & diterapkan`
            : `Pengajuan ubah data ${res.docNo} ditolak`,
          body: b.action === "approve"
            ? `Perubahan data diri Anda telah diterapkan${note ? ` — catatan HR: ${note}` : ""}.`
            : `Alasan penolakan: ${note ?? "-"}. Silakan ajukan ulang bila diperlukan.`,
          kind: "profile-change",
        });
      }
    }
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof ProfileChangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof DecisionConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
