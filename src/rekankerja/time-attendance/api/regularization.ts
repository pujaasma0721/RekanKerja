// RekanKerja — API REGULARISASI ABSENSI (admin) — P1.3 (D-BM7).
// ============================================================================
// GET   /api/rekankerja/attendance/regularization?status=&employeeId=&orgUnit=
//       &dateFrom=&dateTo= — daftar pengajuan karyawan (guard VIEW menu
//       attendance:regularization) + jam rekap SAAT INI (diff) + lampiran.
// PATCH — keputusan approval: { id, action: "approve"|"reject", note? }
//       (guard AKSI op:approve menu attendance:regularization — pola leave/
//       overtime: reject memakai hak keputusan yang sama). Approve jenjang
//       terakhir → auto-apply override rekap + regen (service).
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import {
  listRegularizations, decideRegularization, RegError, REG_MONTHLY_ACTIVE_CAP,
} from "@/rekankerja/time-attendance/services/regularization-service";

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:regularization"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const sp = req.nextUrl.searchParams;
    const res = await listRegularizations(m.db, {
      status: sp.get("status") ?? undefined,
      employeeId: sp.get("employeeId") ?? undefined,
      orgUnit: sp.get("orgUnit") ?? undefined,
      dateFrom: sp.get("dateFrom") ?? undefined,
      dateTo: sp.get("dateTo") ?? undefined,
    });
    return NextResponse.json({ ...res, capPerMonth: REG_MONTHLY_ACTIVE_CAP });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:regularization", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json().catch(() => ({}));
    if (!b.id || !["approve", "reject"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject) wajib" }, { status: 400 });
    }
    const res = await decideRegularization(m.db, {
      id: String(b.id),
      action: b.action,
      note: b.note != null ? String(b.note) : undefined,
      actor: {
        appUserId: m.actor.appUserId ?? m.actor.userId,
        employeeId: m.actor.employeeId,
        name: m.actor.name,
      },
    });

    // ===== notifikasi in-app (fire-and-forget) =====
    // approve parsial → approver jenjang berikutnya; keputusan final → pengaju.
    const docNo = res.docNo;
    if (b.action === "approve" && res.approval) {
      void notifyEvent(m.db, {
        to: "nextApprover", docType: "AttendanceReg", docNo, docId: String(b.id),
        title: `Regularisasi absensi ${docNo} menunggu persetujuan Anda (jenjang ${res.approval.currentLevel}/${res.approval.totalLevels})`,
        body: `Jenjang sebelumnya disetujui — menunggu keputusan ${res.approval.currentApprover ?? "approver berikutnya"}.`,
        kind: "attendance", link: "attendance:regularization",
      }).catch(() => { /* never */ });
    }
    if (!res.approval) {
      void (async () => {
        try {
          const req = await m.db.attendanceRegularizationRequest.findUnique({
            where: { id: String(b.id) },
            select: { employeeId: true, workDate: true },
          });
          if (req) {
            await notifyEvent(m.db, {
              to: "employee", docType: "AttendanceReg", docNo, docId: String(b.id), employeeId: req.employeeId,
              title: b.action === "approve"
                ? `Pengajuan regularisasi ${docNo} disetujui — rekap absensi dikoreksi`
                : `Pengajuan regularisasi ${docNo} ditolak`,
              body: b.action === "approve"
                ? `Rekap absensi Anda untuk tanggal tersebut telah diperbarui sesuai jam yang diajukan.`
                : `Catatan penolakan: ${b.note ? String(b.note) : "—"}`,
              kind: "attendance", link: "attendance:regularization",
            });
          }
        } catch { /* never */ }
      })();
    }

    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof DecisionConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof RegError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
