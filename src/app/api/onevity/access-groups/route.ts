import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// ============ Access Groups (Security) ============

interface ModulePerm {
  module: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

// GET /api/onevity/access-groups — with members
export async function GET() {
  try {
    const groups = await db.accessGroup.findMany({
      include: { members: { include: { appUser: { select: { id: true, username: true, fullName: true, role: true } } } } },
      orderBy: { code: "asc" },
    });
    const users = await db.appUser.findMany({ select: { id: true, username: true, fullName: true, role: true, active: true }, orderBy: { username: "asc" } });
    const parsed = groups.map((g) => {
      let modules: ModulePerm[] = [];
      try { modules = JSON.parse(g.modulesJson) as ModulePerm[]; } catch { modules = []; }
      return { ...g, modules, members: g.members.map((m) => ({ id: m.id, isApprover: m.isApprover, user: m.appUser })) };
    });
    return NextResponse.json({ groups: parsed, users });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/access-groups { code, name, description, modules: ModulePerm[], memberIds?: string[] }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode dan nama grup wajib diisi" }, { status: 400 });
    const exists = await db.accessGroup.findUnique({ where: { code: String(b.code) } });
    if (exists) return NextResponse.json({ error: `Kode '${b.code}' sudah dipakai grup lain` }, { status: 400 });

    const modules = Array.isArray(b.modules) ? b.modules : [];
    const group = await db.accessGroup.create({
      data: {
        code: String(b.code),
        name: String(b.name),
        description: b.description ? String(b.description) : null,
        modulesJson: JSON.stringify(modules),
      },
    });
    if (Array.isArray(b.memberIds)) {
      for (const uid of b.memberIds) {
        const u = await db.appUser.findUnique({ where: { id: String(uid) } });
        if (u) await db.accessGroupMember.create({ data: { appUserId: u.id, accessGroupId: group.id, isApprover: !!b.isApprover } });
      }
    }
    await db.activityLog.create({ data: { action: "Created", entity: "AccessGroup", entityId: group.id, detail: `Access group ${group.code} (${group.name}) dibuat` } });
    return NextResponse.json({ group }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/access-groups?id=...
export async function PATCH(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const b = await req.json().catch(() => ({}));
    const id = sp.get("id") ?? b.id;
    if (!id) return NextResponse.json({ error: "ID grup wajib disertakan" }, { status: 400 });
    const cur = await db.accessGroup.findUnique({ where: { id } });
    if (!cur) return NextResponse.json({ error: "Access group tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.name != null) data.name = String(b.name);
    if (b.description != null) data.description = b.description ? String(b.description) : null;
    if (Array.isArray(b.modules)) data.modulesJson = JSON.stringify(b.modules);

    const group = await db.accessGroup.update({ where: { id }, data });

    if (Array.isArray(b.memberIds)) {
      await db.accessGroupMember.deleteMany({ where: { accessGroupId: id } });
      for (const uid of b.memberIds) {
        const u = await db.appUser.findUnique({ where: { id: String(uid) } });
        if (u) await db.accessGroupMember.create({ data: { appUserId: u.id, accessGroupId: id, isApprover: !!b.isApprover } });
      }
    }

    await db.activityLog.create({ data: { action: "Updated", entity: "AccessGroup", entityId: id, detail: `Access group ${group.code} diperbarui` } });
    return NextResponse.json({ group });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/access-groups?id=...
export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const b = await req.json().catch(() => ({}));
    const id = sp.get("id") ?? b.id;
    if (!id) return NextResponse.json({ error: "ID grup wajib disertakan" }, { status: 400 });
    const cur = await db.accessGroup.findUnique({ where: { id } });
    if (!cur) return NextResponse.json({ error: "Access group tidak ditemukan" }, { status: 404 });
    await db.accessGroup.delete({ where: { id } }); // members cascade
    await db.activityLog.create({ data: { action: "Deleted", entity: "AccessGroup", detail: `Access group ${cur.code} (${cur.name}) dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
