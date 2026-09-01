import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const jobs = await db.job.findMany({
      include: { _count: { select: { positions: true } } },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({ jobs: jobs.map((j) => ({ ...j, positionCount: j._count.positions })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.code || !b.title) return NextResponse.json({ error: "Kode dan judul job wajib diisi" }, { status: 400 });
    const exists = await db.job.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode job ${b.code} sudah dipakai` }, { status: 400 });
    const job = await db.job.create({ data: { code: b.code, title: b.title, category: b.category ?? "Staff", description: b.description } });
    await db.activityLog.create({ data: { action: "Created", entity: "Job", entityId: job.id, detail: `Job ${job.title} dibuat` } });
    return NextResponse.json({ job }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const job = await db.job.update({ where: { id: b.id }, data: { title: b.title, category: b.category, description: b.description, active: b.active } });
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const count = await db.position.count({ where: { jobId: id } });
    if (count > 0) return NextResponse.json({ error: `Job masih dipakai ${count} posisi` }, { status: 400 });
    await db.job.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
