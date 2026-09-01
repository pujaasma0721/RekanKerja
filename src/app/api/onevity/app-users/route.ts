import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";

// GET — users with access groups + access groups with members
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const users = await db.appUser.findMany({
      include: { accessGroups: { include: { accessGroup: { select: { name: true, code: true } } } } },
      orderBy: { username: "asc" },
    });
    const groups = await db.accessGroup.findMany({
      include: { members: { include: { appUser: { select: { id: true, fullName: true, role: true } } } } },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id, username: u.username, fullName: u.fullName, email: u.email,
        role: u.role, active: u.active, lastLogin: u.lastLogin,
        groups: u.accessGroups.map((m) => m.accessGroup),
      })),
      groups: groups.map((g) => ({
        id: g.id, code: g.code, name: g.name, description: g.description,
        modules: JSON.parse(g.modulesJson) as { module: string; view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean }[],
        members: g.members.map((m) => ({ id: m.appUser.id, fullName: m.appUser.fullName, role: m.appUser.role, isApprover: m.isApprover })),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST create user (+optional group membership)
export async function POST(req: NextRequest | Request) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.username || !b.fullName) return NextResponse.json({ error: "Username & nama wajib" }, { status: 400 });
    const exists = await db.appUser.findUnique({ where: { username: b.username } });
    if (exists) return NextResponse.json({ error: `Username ${b.username} sudah dipakai` }, { status: 400 });
    const user = await db.appUser.create({
      data: {
        username: b.username, fullName: b.fullName, email: b.email ?? null,
        role: b.role ?? "Viewer", active: true,
        ...(b.accessGroupId ? { accessGroups: { create: { accessGroupId: b.accessGroupId } } } : {}),
      },
    });
    await db.activityLog.create({ data: { appUserId: user.id, action: "Created", entity: "AppUser", entityId: user.id, detail: `User ${user.username} dibuat` } });
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH update user
export async function PATCH(req: Request) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const user = await db.appUser.update({
      where: { id: b.id },
      data: {
        fullName: b.fullName, email: b.email, role: b.role, active: b.active,
        ...(b.accessGroupId !== undefined && b.accessGroupId
          ? { accessGroups: { deleteMany: {}, create: { accessGroupId: b.accessGroupId } } }
          : b.accessGroupId === "" ? { accessGroups: { deleteMany: {} } } : {}),
      },
    });
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE ?id=
export async function DELETE(req: Request) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const count = await db.appUser.count();
    if (count <= 1) return NextResponse.json({ error: "Minimal satu user harus tersisa" }, { status: 400 });
    await db.appUser.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
