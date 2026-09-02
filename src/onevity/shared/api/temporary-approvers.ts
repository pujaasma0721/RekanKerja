import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// ============ Temporary Approvers (Delegasi Approval) ============

// GET /api/onevity/temporary-approvers — with approver + delegate names
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const delegations = await db.temporaryApprover.findMany({
      include: {
        approver: { select: { id: true, username: true, fullName: true, role: true } },
        delegate: { select: { id: true, username: true, fullName: true, role: true } },
      },
      orderBy: { validFrom: "desc" },
    });
    const users = await db.appUser.findMany({
      select: { id: true, username: true, fullName: true, role: true, active: true },
      orderBy: { username: "asc" },
    });
    return NextResponse.json({ delegations, users });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/temporary-approvers { approverId, delegateId, docType, validFrom, validTo, reason, active }
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.approverId || !b.delegateId) return NextResponse.json({ error: "Approver asal dan pendelegasian wajib dipilih" }, { status: 400 });
    if (b.approverId === b.delegateId) return NextResponse.json({ error: "Approver dan delegate tidak boleh sama" }, { status: 400 });
    if (!b.validFrom || !b.validTo) return NextResponse.json({ error: "Rentang tanggal valid wajib diisi" }, { status: 400 });
    if (new Date(b.validTo) < new Date(b.validFrom)) return NextResponse.json({ error: "Tanggal selesai tidak boleh sebelum tanggal mulai" }, { status: 400 });

    const [approver, delegate] = await Promise.all([
      db.appUser.findUnique({ where: { id: String(b.approverId) } }),
      db.appUser.findUnique({ where: { id: String(b.delegateId) } }),
    ]);
    if (!approver || !delegate) return NextResponse.json({ error: "User approver/delegate tidak ditemukan" }, { status: 400 });

    const ta = await db.temporaryApprover.create({
      data: {
        approverId: approver.id,
        delegateId: delegate.id,
        docType: b.docType ?? "PersonnelAction",
        validFrom: new Date(b.validFrom),
        validTo: new Date(b.validTo),
        reason: b.reason ? String(b.reason) : null,
        active: b.active !== false,
      },
    });
    await db.activityLog.create({
      data: { action: "Created", entity: "TemporaryApprover", entityId: ta.id, detail: `Delegasi approval: ${approver.fullName} → ${delegate.fullName}` },
    });
    return NextResponse.json({ delegation: ta }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/temporary-approvers?id=...
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const b = await req.json().catch(() => ({}));
    const id = sp.get("id") ?? b.id;
    if (!id) return NextResponse.json({ error: "ID delegasi wajib disertakan" }, { status: 400 });
    const cur = await db.temporaryApprover.findUnique({ where: { id } });
    if (!cur) return NextResponse.json({ error: "Delegasi tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.approverId != null) data.approverId = String(b.approverId);
    if (b.delegateId != null) data.delegateId = String(b.delegateId);
    if (b.approverId != null && b.delegateId != null && b.approverId === b.delegateId) {
      return NextResponse.json({ error: "Approver dan delegate tidak boleh sama" }, { status: 400 });
    }
    if (b.docType != null) data.docType = String(b.docType);
    if (b.validFrom != null) data.validFrom = new Date(b.validFrom);
    if (b.validTo != null) data.validTo = new Date(b.validTo);
    if (b.reason != null) data.reason = b.reason ? String(b.reason) : null;
    if (b.active != null) data.active = !!b.active;

    const ta = await db.temporaryApprover.update({ where: { id }, data });
    await db.activityLog.create({ data: { action: "Updated", entity: "TemporaryApprover", entityId: id, detail: `Delegasi approval diperbarui` } });
    return NextResponse.json({ delegation: ta });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/temporary-approvers?id=...
export async function DELETE(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const b = await req.json().catch(() => ({}));
    const id = sp.get("id") ?? b.id;
    if (!id) return NextResponse.json({ error: "ID delegasi wajib disertakan" }, { status: 400 });
    const cur = await db.temporaryApprover.findUnique({ where: { id }, include: { approver: true, delegate: true } });
    if (!cur) return NextResponse.json({ error: "Delegasi tidak ditemukan" }, { status: 404 });
    await db.temporaryApprover.delete({ where: { id } });
    await db.activityLog.create({
      data: { action: "Deleted", entity: "TemporaryApprover", detail: `Delegasi ${cur.approver.fullName} → ${cur.delegate.fullName} dihapus` },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
