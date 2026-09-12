import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { ptkpPendingForEmployee } from "@/onevity/payroll/services/ptkp-auto";

// GET ?employeeId= | POST | DELETE ?id=
// Task 32-d: mutasi dijaga hak AKSI menu hr:directory (per pengguna).
// Task 49: PTKP karyawan bersumber "auto" mengikuti data keluarga.
// Task 50: mutasi keluarga TIDAK lagi menulis PTKP efektif — PTKP payroll
// = snapshot hasil refresh tahunan; perubahan keluarga (tambah/hapus
// pasangan/tanggungan) hanya berlaku pada refresh 1 Januari TAHUN
// BERIKUTNYA. Respons membawa "ptkpPending" (tanpa tulis DB) supaya UI
// bisa memberi tahu perubahan yang tertunda.
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
    // Task 50: PTKP tertunda — saran dari data keluarga BARU, tanpa menulis
    // (berlaku 1 Januari tahun depan; PTKP efektif tahun ini tidak berubah).
    const ptkpPending = await ptkpPendingForEmployee(db, b.employeeId);
    return NextResponse.json({ family: fam, ptkpPending }, { status: 201 });
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
    // Task 50: tangkap employeeId SEBELUM baris terhapus — hitung saran
    // PTKP tertunda TANPA menulis (perubahan berlaku 1 Jan tahun depan).
    const fam = await db.employeeFamily.findUnique({ where: { id }, select: { employeeId: true } });
    await db.employeeFamily.delete({ where: { id } });
    const ptkpPending = fam ? await ptkpPendingForEmployee(db, fam.employeeId) : null;
    return NextResponse.json({ ok: true, ptkpPending });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
