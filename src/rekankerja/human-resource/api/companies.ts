import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// ============ API PERUSAHAAN (1 tenant, multi-Company, switcher) ============
// Model: satu company AKTIF per waktu — UI selector mengirim header
// `x-rekankerja-company` (id Company). GET menampilkan semua Company tenant
// (list untuk selector), POST membuat company baru, PATCH mengubah profil
// by-id. Guard hak akses menu hr:companies.

/** Id company aktif dari header (dipakai selector switcher UI). */
export function activeCompanyIdOf(req: NextRequest): string | null {
  const raw = req.headers.get("x-rekankerja-company");
  if (!raw) return null;
  const v = raw.trim();
  return /^[a-z0-9_-]{1,64}$/i.test(v) ? v : null;
}

/** Ambil company aktif utk request ini (header → fallback company pertama). */
export async function activeCompanyOf(req: NextRequest, db: TenantDb) {
  const wanted = activeCompanyIdOf(req);
  if (wanted) {
    try {
      const found = await db.company.findUnique({ where: { id: wanted } });
      if (found && found.active) return found;
    } catch { /* schema lama — fallback di bawah */ }
  }
  return db.company.findFirst({ orderBy: { createdAt: "asc" } });
}

// GET — daftar semua Company tenant (untuk selector) + company aktif +
// profil lengkap company aktif (kontrak halaman Organisasi › Perusahaan).
// QA-COMPANY-EDIT: field `company` (profil + stats) wajib tetap ada — dihapus
// saat refactor multi-company, membuat halaman profil kosong & PATCH gagal.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const companies = await db.company.findMany({
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true, code: true, name: true, shortName: true, active: true,
        _count: { select: { employees: true, orgUnits: true, companyOffices: true } },
      },
    });
    const activeCompany = await activeCompanyOf(req, db);
    const activeId = activeCompany?.id ?? companies[0]?.id ?? null;

    // Profil lengkap company AKTIF + stats (scope company, bukan tenant).
    let company = null;
    if (activeCompany) {
      const [activeEmployees, positions, orgUnitCount] = await Promise.all([
        db.employee.count({ where: { companyId: activeCompany.id, status: "Active" } }),
        db.position.count({ where: { active: true, orgUnit: { companyId: activeCompany.id } } }),
        db.orgUnit.count({ where: { companyId: activeCompany.id } }),
      ]);
      company = { ...activeCompany, activeEmployees, positions, orgUnitCount };
    }
    return NextResponse.json({
      companies,
      activeId,
      multi: companies.length > 1,
      company,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat Company baru (kode harus unik).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:companies", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.clone().json().catch(() => ({}));
    const code = String(b.code ?? "").trim().toUpperCase();
    const name = String(b.name ?? "").trim();
    if (code.length < 2 || code.length > 12) {
      return NextResponse.json({ error: "Kode perusahaan wajib 2-12 karakter (A-Z0-9)" }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "Nama perusahaan wajib diisi" }, { status: 400 });

    const clash = await db.company.findUnique({ where: { code }, select: { id: true } });
    if (clash) return NextResponse.json({ error: `Kode ${code} sudah dipakai company lain` }, { status: 409 });

    const created = await db.company.create({
      data: {
        code,
        name,
        shortName: String(b.shortName ?? "").trim() || code,
        taxId: b.taxId ? String(b.taxId) : null,
        address: b.address ? String(b.address) : null,
        city: b.city ? String(b.city) : null,
        phone: b.phone ? String(b.phone) : null,
        email: b.email ? String(b.email) : null,
        website: b.website ? String(b.website) : null,
        currency: String(b.currency ?? "IDR"),
        active: b.active !== false,
      },
    });
    return NextResponse.json({ company: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — ubah profil company by-id (bukan hanya pertama).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:companies", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id company wajib" }, { status: 400 });

    const data: Record<string, unknown> = {};
    // F-06 — jangan pernah biarkan nama kosong tersimpan (hazard menimpa data
    // valid dengan string kosong; klien sudah memvalidasi, ini guard server).
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return NextResponse.json({ error: "Nama perusahaan wajib diisi" }, { status: 400 });
      data.name = name;
    }
    if (b.shortName !== undefined) data.shortName = String(b.shortName).trim() || null;
    if (b.taxId !== undefined) data.taxId = b.taxId ? String(b.taxId) : null;
    if (b.address !== undefined) data.address = b.address ? String(b.address) : null;
    if (b.city !== undefined) data.city = b.city ? String(b.city) : null;
    if (b.phone !== undefined) data.phone = b.phone ? String(b.phone) : null;
    if (b.email !== undefined) data.email = b.email ? String(b.email) : null;
    if (b.website !== undefined) data.website = b.website ? String(b.website) : null;
    if (b.currency !== undefined) data.currency = String(b.currency);
    if (b.active !== undefined) data.active = b.active === true;

    // QA F-05 (P2025 "Record not found") → 404 dwibahasa, bukan 500.
    const updated = await db.company.update({ where: { id }, data }).catch((err: unknown) => {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2025") {
        return null;
      }
      throw err;
    });
    if (!updated) {
      return NextResponse.json(
        {
          error:
            "Company not found / Perusahaan tidak ditemukan — data mungkin sudah dihapus. Muat ulang daftar perusahaan.",
        },
        { status: 404 },
      );
    }
    // Audit trail (paritas implementasi pra-multi-company).
    await db.activityLog.create({
      data: { action: "Updated", entity: "Company", entityId: id, detail: `Profil perusahaan ${updated.code} diperbarui` },
    });
    return NextResponse.json({ company: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
