import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { syncEmployeePtkpAuto } from "@/onevity/payroll/services/ptkp-auto";

// GET ?employeeId= | POST | DELETE ?id=
// Task 32-d: mutasi dijaga hak AKSI menu hr:directory (per pengguna).
// Task 49: mutasi keluarga → sinkronkan PTKP otomatis (profil bersumber
// "auto") — status pajak karyawan mengikuti data keluarga terkini.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    const family = await db.employeeFamily.findMany({ where: { employeeId }, orderBy: { birthDate: "asc" } });
    return NextResponse.json({ family });
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
    if (!b.employeeId || !b.name || !b.relation) return NextResponse.json({ error: "Nama & hubungan wajib diisi" }, { status: 400 });
    const fam = await db.employeeFamily.create({
      data: {
        employeeId: b.employeeId, relation: b.relation, name: b.name, gender: b.gender ?? "M",
        birthDate: b.birthDate ? new Date(b.birthDate) : null,
        occupation: b.occupation ?? null, isDependent: b.isDependent ?? true,
      },
    });
    // Task 49: PTKP otomatis — recompute bila profil bersumber "auto".
    const ptkpSync = await syncEmployeePtkpAuto(db, b.employeeId);
    return NextResponse.json({ family: fam, ptkpSync }, { status: 201 });
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
    // Task 49: tangkap employeeId SEBELUM baris terhapus (hook sinkron PTKP).
    const fam = await db.employeeFamily.findUnique({ where: { id }, select: { employeeId: true } });
    await db.employeeFamily.delete({ where: { id } });
    const ptkpSync = fam ? await syncEmployeePtkpAuto(db, fam.employeeId) : null;
    return NextResponse.json({ ok: true, ptkpSync });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
