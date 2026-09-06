import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";

// GET /api/onevity/companies — first company + stats
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const company = await db.company.findFirst({
      include: { _count: { select: { employees: true, orgUnits: true } } },
    });
    if (!company) return NextResponse.json({ error: "Perusahaan belum di-setup" }, { status: 404 });
    const [activeEmployees, positions] = await Promise.all([
      db.employee.count({ where: { companyId: company.id, status: "Active" } }),
      db.position.count({ where: { active: true } }),
    ]);
    return NextResponse.json({
      company: {
        ...company,
        activeEmployees, positions, orgUnitCount: company._count.orgUnits,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH update company profile — T1-SECURITY: guard hak AKSI menu hr:companies (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:companies", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const company = await db.company.findFirst();
    if (!company) return NextResponse.json({ error: "Perusahaan tidak ditemukan" }, { status: 404 });
    const updated = await db.company.update({
      where: { id: company.id },
      data: {
        name: b.name, shortName: b.shortName, taxId: b.taxId, address: b.address,
        city: b.city, phone: b.phone, email: b.email, website: b.website,
      },
    });
    await db.activityLog.create({ data: { action: "Updated", entity: "Company", entityId: company.id, detail: `Profil perusahaan diperbarui` } });
    return NextResponse.json({ company: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
