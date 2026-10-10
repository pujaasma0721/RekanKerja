import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { parseAdvSearchReq } from "@/rekankerja/shared/services/adv-search-server";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import {
  DecisionConflictError, DecisionForbiddenError,
} from "@/rekankerja/shared/services/approval-engine";
import {
  createPr, updatePr, duplicatePr, applyPr, decidePr, cancelPr, holdPr, closePr, deletePr,
  listPrs, getPr, PR_DOC_TYPE, type PrInput,
} from "@/rekankerja/recruitment/services/pr-service";

// ============================================================================
// RECRUITMENT F1 — API PersonnelRequisition (PR)
// DEVELOPMENT-PLAN-RECRUITMENT.md §5 (F0–F1) + §7 F1.
//   GET    ?status=&q=&adv=&sortBy=&sortDir=&limit=&offset=   → { rows, total, stats }
//   POST   { …field, submit? } | { duplicateOf: id }           → create / duplikat
//   PATCH  { id, action: apply|approve|reject|cancel|hold|close, note? }
//   DELETE ?id=                                                → hapus Draft
// Guard menu: recruitment:pr (view/create/update/delete + op:apply/cancel/
// hold/close/duplicate) & recruitment:pr-approval (op:approve). ActivityLog di
// service. Notifikasi in-app + email + webhook fire-and-forget SETELAH sukses.
// ============================================================================

// GET /api/rekankerja/recruitment/pr
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:pr", "recruitment:pr-approval"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const mv = await moneyViewForReq(req, db);

    if (id) {
      const row = await getPr(db, id, mv.canSee);
      if (!row) return NextResponse.json({ error: "PR tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row });
    }

    const res = await listPrs(db, {
      status: sp.get("status"),
      q: sp.get("q"),
      adv: parseAdvSearchReq(req),
      limit: Number(sp.get("limit") ?? 20),
      offset: Number(sp.get("offset") ?? 0),
      sortBy: sp.get("sortBy"),
      sortDir: sp.get("sortDir"),
      moneyVisible: mv.canSee,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/recruitment/pr — buat (Draft / langsung ajukan) atau duplikat
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    // body dibaca SEBELUM guard: duplikat pun butuh izin create
    const m = await requireMenuAction(req, "recruitment:pr", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    if (b.duplicateOf) {
      const res = await duplicatePr(db, String(b.duplicateOf), m.actor.name);
      return NextResponse.json(res, { status: 201 });
    }

    const input: PrInput = {
      requestDate: b.requestDate ?? null,
      requestedById: String(b.requestedById ?? ""),
      positionId: b.positionId || null,
      jobId: b.jobId || null,
      orgUnitId: b.orgUnitId || null,
      companyOfficeId: b.companyOfficeId || null,
      requiredNo: Number(b.requiredNo ?? 1),
      employmentStatus: String(b.employmentStatus ?? "Permanent"),
      preferredSource: b.preferredSource || null,
      earliestDate: b.earliestDate || null,
      latestDate: b.latestDate || null,
      recruitmentOfficerId: b.recruitmentOfficerId || null,
      reason: b.reason ?? null,
      miscSpec: b.miscSpec ?? null,
      additionalQualification: b.additionalQualification ?? null,
      salaryBudget: b.salaryBudget == null || b.salaryBudget === "" ? null : Number(b.salaryBudget),
      autoPostOpening: b.autoPostOpening === true,
      slaTargetDays: b.slaTargetDays == null || b.slaTargetDays === "" ? null : Number(b.slaTargetDays),
      replacedEmployeeId: b.replacedEmployeeId || null,
    };

    const submit = b.submit === true;
    const res = await createPr(db, input, { submit, actorName: m.actor.name });

    if (submit) {
      await fireSubmittedSideEffects(db, {
        prId: res.id, prNo: res.prNo, requesterId: input.requestedById,
        requesterName: m.actor.name, positionTitle: String(b.positionTitle ?? "-"),
        requiredNo: input.requiredNo, employmentStatus: input.employmentStatus, reason: input.reason ?? "",
      }, res.approvalLevels, res.firstApprover);
    }
    return NextResponse.json(res, { status: submit ? 201 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH /api/rekankerja/recruitment/pr — aksi state machine + update Draft
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "update");

    // guard berdasarkan aksi (body dibaca SEBELUM guard — pola leave requests.ts)
    const menuKey = action === "approve" || action === "reject" ? "recruitment:pr-approval" : "recruitment:pr";
    const op: string =
      action === "apply" ? "op:apply" :
      action === "cancel" ? "op:cancel" :
      action === "hold" ? "op:hold" :
      action === "close" ? "op:close" :
      action === "duplicate" ? "op:duplicate" :
      action === "approve" || action === "reject" ? "op:approve" :
      b.id ? "update" : "create";
    const m = await requireMenuAction(req, menuKey, op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const note = b.note ? String(b.note) : null;

    if (action === "update" && b.id) {
      const input: PrInput = {
        requestDate: b.requestDate ?? null,
        requestedById: String(b.requestedById ?? ""),
        positionId: b.positionId || null,
        jobId: b.jobId || null,
        orgUnitId: b.orgUnitId || null,
        companyOfficeId: b.companyOfficeId || null,
        requiredNo: Number(b.requiredNo ?? 1),
        employmentStatus: String(b.employmentStatus ?? "Permanent"),
        preferredSource: b.preferredSource || null,
        earliestDate: b.earliestDate || null,
        latestDate: b.latestDate || null,
        recruitmentOfficerId: b.recruitmentOfficerId || null,
        reason: b.reason ?? null,
        miscSpec: b.miscSpec ?? null,
        additionalQualification: b.additionalQualification ?? null,
        salaryBudget: b.salaryBudget == null || b.salaryBudget === "" ? null : Number(b.salaryBudget),
        autoPostOpening: b.autoPostOpening === true,
        slaTargetDays: b.slaTargetDays == null || b.slaTargetDays === "" ? null : Number(b.slaTargetDays),
        replacedEmployeeId: b.replacedEmployeeId || null,
      };
      const res = await updatePr(db, String(b.id), input, m.actor.name);
      return NextResponse.json(res);
    }

    if (action === "apply") {
      const res = await applyPr(db, String(b.id), m.actor.name);
      const detail = await getPr(db, String(b.id), true);
      await fireSubmittedSideEffects(db, {
        prId: String(b.id), prNo: res.prNo, requesterId: detail?.requestedById ?? "",
        requesterName: detail?.requesterName ?? m.actor.name, positionTitle: detail?.positionTitle ?? "-",
        requiredNo: detail?.requiredNo ?? 1, employmentStatus: detail?.employmentStatus ?? "Permanent",
        reason: detail?.reason ?? "",
      }, res.approvalLevels, res.firstApprover);
      return NextResponse.json({ prNo: res.prNo, status: "Submitted", approvalLevels: res.approvalLevels, firstApprover: res.firstApprover });
    }

    if (action === "approve" || action === "reject") {
      const before = await getPr(db, String(b.id), false);
      const res = await decidePr(db, {
        id: String(b.id), action, note, actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
      });
      if (before) {
        await fireDecidedSideEffects(db, {
          prNo: res.prNo, status: res.status, action, note, actorName: m.actor.name,
          requesterId: before.requestedById, requesterName: before.requesterName,
          positionTitle: before.positionTitle ?? "-", requiredNo: before.requiredNo,
        });
      }
      return NextResponse.json(res);
    }

    if (action === "cancel") {
      const res = await cancelPr(db, { id: String(b.id), note, actorName: m.actor.name });
      void notifyEvent(db, {
        to: "admins", docType: PR_DOC_TYPE, docNo: res.prNo,
        title: `Permintaan karyawan ${res.prNo} dibatalkan`,
        body: `${m.actor.name} membatalkan PR ${res.prNo}${note ? ` — catatan: ${note}` : ""}`,
        kind: "recruitment", link: "recruitment:pr",
      }).catch(() => {});
      return NextResponse.json(res);
    }

    if (action === "hold") {
      const res = await holdPr(db, { id: String(b.id), note, actorName: m.actor.name });
      return NextResponse.json(res);
    }

    if (action === "close") {
      const res = await closePr(db, { id: String(b.id), note, actorName: m.actor.name });
      void notifyEvent(db, {
        to: "admins", docType: PR_DOC_TYPE, docNo: res.prNo,
        title: `Permintaan karyawan ${res.prNo} ditutup`,
        body: `${m.actor.name} menutup PR ${res.prNo}${note ? ` — catatan: ${note}` : ""}`,
        kind: "recruitment", link: "recruitment:pr",
      }).catch(() => {});
      return NextResponse.json(res);
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    if (e instanceof DecisionConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof DecisionForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/recruitment/pr?id= — hapus Draft
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:pr", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await deletePr(m.db, id);
    return NextResponse.json({ ok: true, prNo: res.prNo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// ============ notifikasi fire-and-forget (pola leave/api/requests.ts) ============

interface SubmitCtx {
  prId: string; prNo: string; requesterId: string; requesterName: string;
  positionTitle: string; requiredNo: number; employmentStatus: string; reason: string;
}

async function fireSubmittedSideEffects(
  db: Parameters<typeof notifyEvent>[0], ctx: SubmitCtx, approvalLevels: number, firstApprover: string | null,
): Promise<void> {
  void (async () => {
    try {
      // in-app → approver jenjang pertama (link ke kotak approval PR)
      await notifyEvent(db, {
        to: "nextApprover", docType: PR_DOC_TYPE, docNo: ctx.prNo, docId: ctx.prId,
        title: `Permintaan karyawan ${ctx.prNo} menunggu persetujuan Anda`,
        body: `${ctx.requesterName} — ${ctx.positionTitle} (${ctx.requiredNo} orang, ${ctx.employmentStatus})`,
        kind: "recruitment", link: "recruitment:pr-approval",
      });
      // email → approver (fallback Admin/HR — pola leave Task 64m-b)
      notifyEmailEvent(db, {
        event: "recruitment.pr.submitted",
        to: await approverEmailsOf(db, ctx.requesterId),
        data: {
          nama: ctx.requesterName, docNo: ctx.prNo, posisi: ctx.positionTitle,
          jumlahOrang: String(ctx.requiredNo), statusKerja: ctx.employmentStatus,
          alasan: ctx.reason || "-",
          ...(firstApprover ? { approver: firstApprover } : {}),
        },
      });
      dispatchWebhookEvent(db, null, "recruitment.pr.submitted", {
        prNo: ctx.prNo, position: ctx.positionTitle, requiredNo: ctx.requiredNo,
        employmentStatus: ctx.employmentStatus, requester: ctx.requesterName,
        approvalLevels,
      }).catch(() => { /* never */ });
    } catch { /* notifikasi tidak boleh mengganggu proses utama */ }
  })();
}

interface DecidedCtx {
  prNo: string; status: string; action: "approve" | "reject";
  note: string | null; actorName: string;
  requesterId: string; requesterName: string;
  positionTitle: string; requiredNo: number;
}

async function fireDecidedSideEffects(db: Parameters<typeof notifyEvent>[0], ctx: DecidedCtx): Promise<void> {
  void (async () => {
    try {
      // approve parsial (jenjang berikutnya) → hanya approver berikutnya
      if (ctx.status === "Submitted") {
        await notifyEvent(db, {
          to: "nextApprover", docType: PR_DOC_TYPE, docNo: ctx.prNo,
          title: `Permintaan karyawan ${ctx.prNo} menunggu persetujuan Anda (jenjang berikutnya)`,
          body: `${ctx.requesterName} — ${ctx.positionTitle} (${ctx.requiredNo} orang)`,
          kind: "recruitment", link: "recruitment:pr-approval",
        });
        return;
      }
      // keputusan FINAL → requester (pola leave) + email + webhook
      const label = ctx.status === "Approved" ? "DISSETUJUI" : "DITOLAK";
      await notifyEvent(db, {
        to: "employee", docType: PR_DOC_TYPE, docNo: ctx.prNo, employeeId: ctx.requesterId,
        title: `Permintaan karyawan ${ctx.prNo} ${label}`,
        body: `${ctx.positionTitle} (${ctx.requiredNo} orang) — keputusan oleh ${ctx.actorName}${ctx.note ? ` — catatan: ${ctx.note}` : ""}`,
        kind: "recruitment", link: "recruitment:pr",
      });
      notifyEmailEvent(db, {
        event: ctx.status === "Approved" ? "recruitment.pr.approved" : "recruitment.pr.rejected",
        to: await approverEmailsOf(db, null),
        data: {
          nama: ctx.requesterName, docNo: ctx.prNo, posisi: ctx.positionTitle,
          jumlahOrang: String(ctx.requiredNo), catatan: ctx.note || "-",
        },
      });
      dispatchWebhookEvent(db, null, ctx.status === "Approved" ? "recruitment.pr.approved" : "recruitment.pr.rejected", {
        prNo: ctx.prNo, status: ctx.status, decidedBy: ctx.actorName, note: ctx.note ?? null,
      }).catch(() => { /* never */ });
    } catch { /* notifikasi tidak boleh mengganggu proses utama */ }
  })();
}
