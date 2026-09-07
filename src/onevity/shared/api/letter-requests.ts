import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { issueLetter } from "@/onevity/shared/services/letter-service";
import { notifyEvent } from "@/onevity/shared/services/notification-service";

// PERMINTAAN SURAT KARYAWAN (ESS → HR) — Task 26-a:
//   · GET   /api/onevity/letter-requests?status= — daftar permintaan surat
//     (Pending dulu, terbaru) + data karyawan + nama template + pemutus.
//     Guard hr:templates view (menu Dokumen & Surat → Template Surat).
//   · PATCH /api/onevity/letter-requests — keputusan HR:
//       { id, action: "issue" }  → Setujui & Terbitkan: render snapshot →
//         LetterDocument (refNo 001/HR-ES/…) + status Issued + notifikasi ke
//         karyawan + ActivityLog. Idempoten (sudah Issued → kembalikan existing).
//       { id, action: "reject", reason } → Tolak: status Rejected + alasan +
//         notifikasi + ActivityLog.
//     Guard hr:templates op:decide (katalog MENU_OPS — per pengguna).

// ================= GET list =================
export async function listLetterRequests(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:templates", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const status = req.nextUrl.searchParams.get("status");
    const rows = await db.letterRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        employee: {
          select: {
            id: true, fullName: true, employeeNo: true, photoUrl: true,
            position: { select: { title: true } },
            orgUnit: { select: { name: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }], // Pending < Rejected < Issued (alfabet) — Pending duluan
      take: 200,
    });

    // resolusi nama template (tanpa FK — join manual by key) + pemutus
    const templateKeys = Array.from(new Set(rows.map((r) => r.templateKey)));
    const templates = templateKeys.length
      ? await db.letterTemplate.findMany({ where: { key: { in: templateKeys } }, select: { key: true, name: true } })
      : [];
    const templateName = new Map(templates.map((t) => [t.key, t.name]));
    const decidedByIds = Array.from(new Set(rows.map((r) => r.decidedById).filter((x): x is string => !!x)));
    const deciders = decidedByIds.length
      ? await db.appUser.findMany({ where: { id: { in: decidedByIds } }, select: { id: true, fullName: true } })
      : [];
    const deciderName = new Map(deciders.map((d) => [d.id, d.fullName]));

    return NextResponse.json({
      requests: rows.map((r) => ({
        id: r.id,
        reqNo: r.reqNo,
        templateKey: r.templateKey,
        templateName: templateName.get(r.templateKey) ?? r.templateKey,
        purpose: r.purpose,
        notes: r.notes,
        status: r.status,
        rejectReason: r.rejectReason,
        decidedAt: r.decidedAt,
        decidedBy: r.decidedById ? deciderName.get(r.decidedById) ?? null : null,
        letterDocumentId: r.letterDocumentId,
        createdAt: r.createdAt,
        employee: {
          id: r.employee.id,
          fullName: r.employee.fullName,
          employeeNo: r.employee.employeeNo,
          photoUrl: r.employee.photoUrl,
          positionTitle: r.employee.position?.title ?? null,
          orgUnitName: r.employee.orgUnit?.name ?? null,
        },
      })),
      counts: {
        pending: rows.filter((r) => r.status === "Pending").length,
        issued: rows.filter((r) => r.status === "Issued").length,
        rejected: rows.filter((r) => r.status === "Rejected").length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH decide (issue | reject) =================
export async function decideLetterRequest(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:templates", "op:decide");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");
    const action = String(b.action ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    if (action !== "issue" && action !== "reject") {
      return NextResponse.json({ error: "action harus issue atau reject" }, { status: 400 });
    }

    const reqRow = await db.letterRequest.findUnique({
      where: { id },
      include: { employee: { select: { id: true, fullName: true } } },
    });
    if (!reqRow) return NextResponse.json({ error: "Permintaan surat tidak ditemukan" }, { status: 404 });

    const reason = typeof b.reason === "string" ? b.reason.trim() : "";

    // ---- Tolak ----
    if (action === "reject") {
      if (reqRow.status !== "Pending") {
        return NextResponse.json({ error: `Permintaan sudah diputuskan (${reqRow.status})` }, { status: 400 });
      }
      if (!reason) return NextResponse.json({ error: "Alasan penolakan wajib diisi" }, { status: 400 });

      const updated = await db.letterRequest.update({
        where: { id },
        data: { status: "Rejected", rejectReason: reason, decidedById: actor.appUserId, decidedAt: new Date() },
      });
      await db.activityLog.create({
        data: {
          action: "Rejected", entity: "LetterRequest", entityId: id,
          employeeId: reqRow.employeeId,
          appUserId: actor.appUserId ?? undefined,
          detail: `Permintaan surat ${reqRow.reqNo} (${reqRow.templateKey}) ditolak — ${reason}`,
        },
      }).catch(() => { /* audit tidak boleh menggagalkan keputusan */ });
      void notifyEvent(db, {
        to: "employee",
        employeeId: reqRow.employeeId,
        docType: "LetterRequest",
        docNo: reqRow.reqNo,
        title: `Permintaan surat ${reqRow.reqNo} ditolak`,
        body: `Alasan: ${reason}`,
        kind: "letters",
      });
      return NextResponse.json({ request: updated });
    }

    // ---- Setujui & Terbitkan ----
    if (reqRow.status === "Issued" && reqRow.letterDocumentId) {
      // idempoten: klik dua kali → kembalikan surat yang sama
      const existing = await db.letterDocument.findUnique({ where: { id: reqRow.letterDocumentId } });
      if (existing) {
        return NextResponse.json({
          request: reqRow,
          letter: {
            id: existing.id, refNo: existing.refNo, subject: existing.subject,
            body: existing.body, issuedAt: existing.issuedAt,
            templateName: reqRow.templateKey, employeeName: reqRow.employee.fullName,
          },
        });
      }
    }
    if (reqRow.status !== "Pending") {
      return NextResponse.json({ error: `Permintaan sudah diputuskan (${reqRow.status})` }, { status: 400 });
    }

    // validasi template masih aktif sebelum terbit (issueLetter melempar pesan ramah)
    const letter = await issueLetter(db, {
      category: "EmployeeService",
      templateKey: reqRow.templateKey,
      employeeId: reqRow.employeeId,
      actorId: actor.appUserId,
      purpose: reqRow.purpose,
    });

    const updated = await db.letterRequest.update({
      where: { id },
      data: { status: "Issued", letterDocumentId: letter.id, decidedById: actor.appUserId, decidedAt: new Date() },
    });
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "LetterRequest", entityId: id,
        employeeId: reqRow.employeeId,
        appUserId: actor.appUserId ?? undefined,
        detail: `Permintaan surat ${reqRow.reqNo} disetujui — surat ${letter.refNo} diterbitkan`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan keputusan */ });
    void notifyEvent(db, {
      to: "employee",
      employeeId: reqRow.employeeId,
      docType: "LetterRequest",
      docNo: reqRow.reqNo,
      title: `Permintaan surat ${reqRow.reqNo} diterbitkan`,
      body: `Surat ${letter.refNo} siap diunduh pada menu Surat.`,
      kind: "letters",
    });

    return NextResponse.json({ request: updated, letter: { ...letter, employeeName: reqRow.employee.fullName } });
  } catch (e) {
    // issueLetter sudah melempar pesan ramah (template nonaktif dst.)
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
