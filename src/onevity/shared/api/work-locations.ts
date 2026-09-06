import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";

// ============ WORK LOCATION (lokasi kerja) ============

// GET /api/onevity/work-locations
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const locations = await db.workLocation.findMany({
      include: {
        office: { select: { code: true, name: true } },
        _count: { select: { employees: { where: { status: "Active" } }, approvalStructures: true } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      locations: locations.map((l) => ({
        id: l.id, code: l.code, name: l.name, address: l.address, city: l.city, active: l.active,
        officeId: l.officeId, office: l.office,
        employeeCount: l._count.employees,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/work-locations — T6-MISC: guard hak AKSI menu hr:offices
// (Kantor & Lokasi Kerja) — pola sama dgn org-units (T1-SECURITY).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offices", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama lokasi wajib diisi" }, { status: 400 });
    const company = await db.company.findFirst({ select: { id: true } });
    if (!company) return NextResponse.json({ error: "Data perusahaan belum di-setup" }, { status: 400 });
    const exists = await db.workLocation.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode lokasi ${b.code} sudah dipakai` }, { status: 400 });
    if (b.officeId) {
      const office = await db.companyOffice.findUnique({ where: { id: b.officeId } });
      if (!office) return NextResponse.json({ error: "Kantor induk tidak ditemukan" }, { status: 400 });
    }

    const loc = await db.workLocation.create({
      data: {
        code: b.code, name: b.name, companyId: company.id,
        officeId: b.officeId || null, address: b.address ?? null, city: b.city ?? null,
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "WorkLocation", entityId: loc.id, detail: `Lokasi kerja ${loc.code} — ${loc.name} dibuat` } });
    return NextResponse.json({ location: loc }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/work-locations — T6-MISC: guard aksi Ubah hr:offices.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offices", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (b.name != null) data.name = String(b.name);
    if (b.officeId !== undefined) data.officeId = b.officeId || null;
    if (b.address !== undefined) data.address = b.address || null;
    if (b.city !== undefined) data.city = b.city || null;
    if (b.active != null) data.active = !!b.active;
    const loc = await db.workLocation.update({ where: { id: b.id }, data });
    return NextResponse.json({ location: loc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/work-locations?id= — T6-MISC: guard aksi Hapus hr:offices.
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offices", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const used = await db.approvalStructure.count({ where: { workLocationId: id } });
    if (used > 0) return NextResponse.json({ error: `Lokasi dipakai ${used} struktur approval — hapus referensi dulu` }, { status: 400 });
    const loc = await db.workLocation.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "WorkLocation", entityId: id, detail: `Lokasi kerja ${loc.code} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
