import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// GET — groups + accounts + posting events in one payload
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const [groups, accounts, postings] = await Promise.all([
      db.accountGroup.findMany({ include: { _count: { select: { accounts: true } } }, orderBy: { code: "asc" } }),
      db.account.findMany({ include: { accountGroup: { select: { name: true, code: true } } }, orderBy: { code: "asc" } }),
      db.postingEvent.findMany({ orderBy: { code: "asc" } }),
    ]);
    return NextResponse.json({
      groups: groups.map((g) => ({ ...g, accountCount: g._count.accounts })),
      accounts, postings,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST / PATCH / DELETE with body.kind: "account" | "group" | "posting"
// T1-SECURITY: guard hak AKSI menu payroll:accounting (Akun & Posting) per pengguna.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:accounting", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const kind = b.kind as string;
    if (kind === "group") {
      if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama grup wajib" }, { status: 400 });
      const g = await db.accountGroup.create({ data: { code: b.code, name: b.name, accountType: b.accountType ?? "Expense" } });
      return NextResponse.json({ group: g }, { status: 201 });
    }
    if (kind === "account") {
      if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama akun wajib" }, { status: 400 });
      const a = await db.account.create({ data: { code: b.code, name: b.name, accountGroupId: b.accountGroupId || null, balance: 0 } });
      return NextResponse.json({ account: a }, { status: 201 });
    }
    if (kind === "posting") {
      if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama event wajib" }, { status: 400 });
      const p = await db.postingEvent.create({ data: { code: b.code, name: b.name, trigger: b.trigger ?? "PayrollRun" } });
      return NextResponse.json({ posting: p }, { status: 201 });
    }
    return NextResponse.json({ error: "kind tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:accounting", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const { kind, id, ...rest } = b;
    if (kind === "group") {
      const g = await db.accountGroup.update({ where: { id }, data: { name: rest.name, accountType: rest.accountType } });
      return NextResponse.json({ group: g });
    }
    if (kind === "account") {
      const a = await db.account.update({ where: { id }, data: { name: rest.name, accountGroupId: rest.accountGroupId || null } });
      return NextResponse.json({ account: a });
    }
    if (kind === "posting") {
      const p = await db.postingEvent.update({ where: { id }, data: { name: rest.name, trigger: rest.trigger, active: rest.active } });
      return NextResponse.json({ posting: p });
    }
    return NextResponse.json({ error: "kind tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:accounting", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const kind = sp.get("kind");
    if (!id || !kind) return NextResponse.json({ error: "id & kind wajib" }, { status: 400 });
    if (kind === "group") {
      const count = await db.account.count({ where: { accountGroupId: id } });
      if (count > 0) return NextResponse.json({ error: `Grup masih memiliki ${count} akun` }, { status: 400 });
      await db.accountGroup.delete({ where: { id } });
    } else if (kind === "account") {
      await db.account.delete({ where: { id } });
    } else if (kind === "posting") {
      await db.postingEvent.delete({ where: { id } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
