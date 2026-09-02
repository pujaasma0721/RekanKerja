import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// GET — approval templates + temporary approvers
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const templates = await db.approvalTemplate.findMany({ orderBy: { code: "asc" } });
    const delegations = await db.temporaryApprover.findMany({
      include: {
        approver: { select: { id: true, fullName: true, role: true } },
        delegate: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { validFrom: "desc" },
    });
    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id, code: t.code, name: t.name, docType: t.docType,
        layers: JSON.parse(t.layersJson) as { layer: number; role: string }[],
        autoApprove: t.autoApprove, active: t.active,
      })),
      delegations: delegations.map((d) => {
        const now = new Date();
        const expired = new Date(d.validTo) < now;
        const upcoming = new Date(d.validFrom) > now;
        return {
          id: d.id, docType: d.docType, validFrom: d.validFrom, validTo: d.validTo, reason: d.reason, active: d.active,
          approver: d.approver, delegate: d.delegate,
          state: expired ? "Kedaluwarsa" : upcoming ? "Akan Datang" : "Aktif",
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (b.kind === "template") {
      if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama template wajib" }, { status: 400 });
      const t = await db.approvalTemplate.create({
        data: {
          code: b.code, name: b.name, docType: b.docType ?? "PersonnelAction",
          layersJson: JSON.stringify(b.layers ?? [{ layer: 1, role: "HR Manager" }]),
          autoApprove: b.autoApprove ?? false,
        },
      });
      return NextResponse.json({ template: t }, { status: 201 });
    }
    if (b.kind === "delegation") {
      if (!b.approverId || !b.delegateId) return NextResponse.json({ error: "Approver & delegate wajib" }, { status: 400 });
      if (b.approverId === b.delegateId) return NextResponse.json({ error: "Approver dan delegate tidak boleh sama" }, { status: 400 });
      const d = await db.temporaryApprover.create({
        data: {
          approverId: b.approverId, delegateId: b.delegateId,
          docType: b.docType ?? "PersonnelAction",
          validFrom: new Date(b.validFrom), validTo: new Date(b.validTo),
          reason: b.reason ?? null,
        },
      });
      await db.activityLog.create({ data: { action: "Created", entity: "TemporaryApprover", entityId: d.id, detail: "Delegasi approval dibuat" } });
      return NextResponse.json({ delegation: d }, { status: 201 });
    }
    return NextResponse.json({ error: "kind tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const kind = sp.get("kind");
    if (!id || !kind) return NextResponse.json({ error: "id & kind wajib" }, { status: 400 });
    if (kind === "template") await db.approvalTemplate.delete({ where: { id } });
    if (kind === "delegation") await db.temporaryApprover.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
