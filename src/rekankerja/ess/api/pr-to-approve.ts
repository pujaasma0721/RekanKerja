// GET  /api/rekankerja/ess/pr-to-approve — PR yang menunggu keputusan aktor
//       (padanan oranHR MyPersonnelRequisitionToApprove).
// PATCH — putuskan (approve|reject) via engine (otorisasi decide-time sama
//       dengan jalur admin: approver jenjang / delegasi aktif / admin).
import { NextResponse } from "next/server";
import { requireEss, essCanAdmin } from "@/rekankerja/ess/api/ess-auth";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import {
  DecisionConflictError, DecisionForbiddenError,
} from "@/rekankerja/shared/services/approval-engine";
import { decidePr, getPr, listPrsToApprove, PR_DOC_TYPE } from "@/rekankerja/recruitment/services/pr-service";

// GET — kotak approval PR saya (chain step Current = aktor).
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformRole, appUserRole } = m.actor;

  try {
    const adminRole =
      ["OWNER", "ADMIN", "HR"].includes(platformRole) ||
      ["Admin", "HR Manager", "HR Staff"].includes(appUserRole ?? "");
    const rows = await listPrsToApprove(db, { employeeId, isAdminRole: adminRole }, false);
    return NextResponse.json({
      requests: rows.map((r) => ({
        id: r.id, prNo: r.prNo, requestDate: r.requestDate.slice(0, 10),
        requesterName: r.requesterName, requesterNo: r.requesterNo,
        positionTitle: r.positionTitle, requiredNo: r.requiredNo,
        employmentStatus: r.employmentStatus, reason: r.reason,
        earliestDate: r.earliestDate ? r.earliestDate.slice(0, 10) : null,
        latestDate: r.latestDate ? r.latestDate.slice(0, 10) : null,
        approval: r.approval ? { level: r.approval.currentLevel, total: r.approval.totalLevels } : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — putuskan PR. Body: { id, action: approve|reject, note? }
export async function PATCH(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformRole, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const action = b.action === "reject" ? "reject" : "approve";
    if (action === "reject" && !String(b.note ?? "").trim()) {
      return NextResponse.json({ error: "Alasan penolakan wajib diisi" }, { status: 400 });
    }

    // otorisasi sesungguhnya di engine — role ESS diteruskan apa adanya
    // (bukan OWNER/ADMIN/HR → harus approver jenjang berjalan / delegasi aktif)
    const before = await getPr(db, String(b.id), false);
    const res = await decidePr(db, {
      id: String(b.id), action,
      note: b.note ? String(b.note) : undefined,
      actor: { role: essCanAdmin(m.actor) ? platformRole : "ESS", employeeId, name: fullName },
    });

    // notifikasi fire-and-forget — paritas jalur admin
    void (async () => {
      try {
        if (res.status === "Submitted") {
          await notifyEvent(db, {
            to: "nextApprover", docType: PR_DOC_TYPE, docNo: res.prNo,
            title: `Permintaan karyawan ${res.prNo} menunggu persetujuan Anda (jenjang berikutnya)`,
            body: `${before?.requesterName ?? "-"} — ${before?.positionTitle ?? "-"} (${before?.requiredNo ?? 1} orang)`,
            kind: "recruitment", link: "recruitment:pr-approval",
          });
          return;
        }
        await notifyEvent(db, {
          to: "employee", docType: PR_DOC_TYPE, docNo: res.prNo,
          employeeId: before?.requestedById ?? null,
          title: `Permintaan karyawan ${res.prNo} ${res.status === "Approved" ? "DISSETUJUI" : "DITOLAK"}`,
          body: `${before?.positionTitle ?? "-"} — keputusan oleh ${fullName}${b.note ? ` — catatan: ${String(b.note)}` : ""}`,
          kind: "recruitment", link: "recruitment:pr",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama */ }
    })();

    return NextResponse.json({
      prNo: res.prNo, status: res.status, final: res.final,
      approval: res.approval ? { level: res.approval.currentLevel, total: res.approval.totalLevels, currentApproverName: res.approval.currentApprover } : null,
    });
  } catch (e) {
    if (e instanceof DecisionConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({
        error: "Anda bukan approver jenjang berjalan untuk PR ini (atau keputusan sudah diproses) — muat ulang daftar.",
      }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
