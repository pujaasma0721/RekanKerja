import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";

// ============ COMPANY OFFICE (kantor perusahaan) ============

// GET /api/onevity/company-offices
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const offices = await db.companyOffice.findMany({
      include: {
        _count: { select: { employees: { where: { status: "Active" } }, workLocations: true, approvalStructures: true } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      offices: offices.map((o) => ({
        id: o.id, code: o.code, name: o.name, address: o.address, city: o.city, phone: o.phone, npwp: o.npwp, active: o.active,
        employeeCount: o._count.employees, locationCount: o._count.workLocations,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/company-offices — T6-MISC: guard hak AKSI menu hr:offices
// (Kantor & Lokasi Kerja) — pola sama dgn org-units (T1-SECURITY).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offices", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama kantor wajib diisi" }, { status: 400 });
    const company = await db.company.findFirst({ select: { id: true } });
    if (!company) return NextResponse.json({ error: "Data perusahaan belum di-setup" }, { status: 400 });
    const exists = await db.companyOffice.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode kantor ${b.code} sudah dipakai` }, { status: 400 });

    const office = await db.companyOffice.create({
      data: {
        code: b.code, name: b.name, companyId: company.id,
        address: b.address ?? null, city: b.city ?? null, phone: b.phone ?? null,
        npwp: b.npwp ? String(b.npwp).trim() : null, // NPWP kantor — beda per kantor utk pelaporan pajak
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "CompanyOffice", entityId: office.id, detail: `Kantor ${office.code} — ${office.name} dibuat` } });
    return NextResponse.json({ office }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/company-offices — T6-MISC: guard aksi Ubah hr:offices.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offices", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (b.name != null) data.name = String(b.name);
    if (b.address !== undefined) data.address = b.address || null;
    if (b.city !== undefined) data.city = b.city || null;
    if (b.phone !== undefined) data.phone = b.phone || null;
    if (b.npwp !== undefined) data.npwp = b.npwp ? String(b.npwp).trim() : null;
    if (b.active != null) data.active = !!b.active;
    const office = await db.companyOffice.update({ where: { id: b.id }, data });
    return NextResponse.json({ office });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/company-offices?id= — T6-MISC: guard aksi Hapus hr:offices.
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offices", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const used = await db.approvalStructure.count({ where: { companyOfficeId: id } });
    if (used > 0) return NextResponse.json({ error: `Kantor dipakai ${used} struktur approval — hapus referensi dulu` }, { status: 400 });
    const office = await db.companyOffice.delete({ where: { id } }).catch((e: unknown) => {
      throw new Error("Kantor masih memiliki lokasi kerja terhubung — pindahkan/hapus lokasi dahulu");
    });
    await db.activityLog.create({ data: { action: "Deleted", entity: "CompanyOffice", entityId: id, detail: `Kantor ${office.code} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
