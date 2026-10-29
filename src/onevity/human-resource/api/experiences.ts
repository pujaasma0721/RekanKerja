import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";

// GET ?employeeId= | POST | PATCH | DELETE ?id=
// Task 32-d: mutasi dijaga hak AKSI menu hr:directory (per pengguna).
// Task 82-c: PATCH — ubah pengalaman kerja tanpa hapus+tambah (jejak utuh).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    const experiences = await db.employeeExperience.findMany({ where: { employeeId }, orderBy: { endDate: "desc" } });
    return NextResponse.json({ experiences });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.employeeId || !b.company || !b.position) return NextResponse.json({ error: "Perusahaan & posisi wajib diisi" }, { status: 400 });
    const exp = await db.employeeExperience.create({
      data: {
        employeeId: b.employeeId, company: b.company, position: b.position,
        startDate: b.startDate ? new Date(b.startDate) : null, endDate: b.endDate ? new Date(b.endDate) : null,
        notes: b.notes ?? null,
      },
    });
    return NextResponse.json({ experience: exp }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Task 82-c: guard aksi update (cermin POST/DELETE di file ini).
    const m = await requireMenuAction(req, "hr:directory", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    // validasi CERMIN POST: perusahaan & posisi wajib (bila dikirim, tak boleh kosong).
    const company = b.company !== undefined ? String(b.company).trim() : undefined;
    const position = b.position !== undefined ? String(b.position).trim() : undefined;
    if (company === "" || position === "") return NextResponse.json({ error: "Perusahaan & posisi wajib diisi" }, { status: 400 });
    // record milik employee yang valid — 404 bila tidak ada.
    const existing = await db.employeeExperience.findUnique({
      where: { id: String(b.id) },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Pengalaman kerja tidak ditemukan" }, { status: 404 });

    const exp = await db.employeeExperience.update({
      where: { id: existing.id },
      data: {
        ...(company !== undefined ? { company } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(b.startDate !== undefined ? { startDate: b.startDate ? new Date(b.startDate) : null } : {}),
        ...(b.endDate !== undefined ? { endDate: b.endDate ? new Date(b.endDate) : null } : {}),
        ...(b.notes !== undefined ? { notes: b.notes ?? null } : {}),
      },
    });
    return NextResponse.json({ experience: exp });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.employeeExperience.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
