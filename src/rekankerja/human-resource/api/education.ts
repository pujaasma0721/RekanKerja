import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// GET ?employeeId= | POST | PATCH | DELETE ?id=
// Task 32-d: mutasi dijaga hak AKSI menu hr:directory (per pengguna).
// Task 82-c: PATCH — ubah riwayat pendidikan tanpa hapus+tambah (jejak utuh).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    const education = await db.employeeEducation.findMany({ where: { employeeId }, orderBy: { endYear: "desc" } });
    return NextResponse.json({ education });
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
    if (!b.employeeId || !b.level || !b.institution) return NextResponse.json({ error: "Jenjang & institusi wajib diisi" }, { status: 400 });
    const edu = await db.employeeEducation.create({
      data: {
        employeeId: b.employeeId, level: b.level, institution: b.institution, major: b.major ?? null,
        startYear: b.startYear ? Number(b.startYear) : null, endYear: b.endYear ? Number(b.endYear) : null,
        gpa: b.gpa ? Number(b.gpa) : null,
      },
    });
    return NextResponse.json({ education: edu }, { status: 201 });
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
    // validasi CERMIN POST: jenjang & institusi wajib diisi (dialog edit
    // selalu mengirim seluruh field form).
    const level = b.level !== undefined ? String(b.level) : undefined;
    const institution = b.institution !== undefined ? String(b.institution).trim() : undefined;
    if (!level || !institution) return NextResponse.json({ error: "Jenjang & institusi wajib diisi" }, { status: 400 });
    // record milik employee yang valid — 404 bila tidak ada.
    const existing = await db.employeeEducation.findUnique({
      where: { id: String(b.id) },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Riwayat pendidikan tidak ditemukan" }, { status: 404 });

    const edu = await db.employeeEducation.update({
      where: { id: existing.id },
      data: {
        level,
        institution,
        ...(b.major !== undefined ? { major: b.major ?? null } : {}),
        ...(b.startYear !== undefined ? { startYear: b.startYear ? Number(b.startYear) : null } : {}),
        ...(b.endYear !== undefined ? { endYear: b.endYear ? Number(b.endYear) : null } : {}),
        ...(b.gpa !== undefined ? { gpa: b.gpa === "" || b.gpa === null ? null : Number(b.gpa) } : {}),
      },
    });
    return NextResponse.json({ education: edu });
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
    await db.employeeEducation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
