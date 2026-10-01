import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";

// UMP/UMK PER KANTOR (26-b P0 — PP 36/2021) ================================
// =====================================================================
// Master upah minimum per tahun × CompanyOffice (companyOfficeId null =
// kebijakan default tenant). Dipakai payroll engine menandai baris run
// dengan gaji pokok di bawah upah minimum kantor penempatan.
//
//   GET    ?year=          daftar + katalog kantor + ringkasan per tahun
//   POST   {year, companyOfficeId?, label, monthlyAmount}
//   PATCH  {id, label?, monthlyAmount?, active?}
//   DELETE ?id=
//
// Guard: menu payroll:parameters (view / create / update / delete — Task 32).
// Catatan Postgres: unique(year, companyOfficeId) tidak menolak NULL ganda
// → cek duplikat default-tenant dilakukan manual sebelum insert.

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const year = Number(req.nextUrl.searchParams.get("year") ?? 0) || undefined;
    const [wages, offices] = await Promise.all([
      db.minimumWage.findMany({
        where: year ? { year } : {},
        include: { companyOffice: { select: { code: true, name: true, city: true } } },
        orderBy: [{ year: "desc" }, { companyOfficeId: "asc" }],
      }),
      db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
    ]);
    const years = [...new Set(wages.map((w) => w.year))].sort((a, b) => b - a);
    return NextResponse.json({ wages, offices, years });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:parameters", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    const year = Number(b.year);
    const amount = Number(b.monthlyAmount);
    const label = String(b.label ?? "").trim();
    const officeId = b.companyOfficeId ? String(b.companyOfficeId) : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Tahun wajib valid (2000–2100)" }, { status: 400 });
    }
    if (!label) return NextResponse.json({ error: "Label wajib diisi (mis. UMK DKI Jakarta 2026)" }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Jumlah upah minimum per bulan harus angka positif" }, { status: 400 });
    }
    if (officeId) {
      const office = await db.companyOffice.findUnique({ where: { id: officeId }, select: { code: true, name: true } });
      if (!office) return NextResponse.json({ error: "Kantor tidak dikenal — pilih ulang kantor" }, { status: 400 });
    }

    // cek duplikat (IS NOT DISTINCT FROM menutup celah NULL unik ganda)
    const dup = await db.minimumWage.findFirst({ where: { year, companyOfficeId: officeId } });
    if (dup) {
      return NextResponse.json(
        { error: `Sudah ada entri tahun ${year} untuk ${officeId ? "kantor ini" : "default tenant (tanpa kantor)"} — ubah entri yang ada` },
        { status: 400 },
      );
    }

    const wage = await db.minimumWage.create({ data: { year, companyOfficeId: officeId, label, monthlyAmount: amount } });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "MinimumWage", entityId: wage.id, appUserId: actor.appUserId ?? undefined,
        detail: `UMP/UMK ${label} tahun ${year} (Rp ${amount.toLocaleString("id-ID")}) ditambahkan${officeId ? " untuk kantor terpilih" : " sebagai default tenant"} oleh ${actor.appUsername ?? actor.name}`,
      },
    });
    return NextResponse.json({ wage }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:parameters", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const wage = await db.minimumWage.findUnique({ where: { id: String(b.id) } });
    if (!wage) return NextResponse.json({ error: "Entri UMP/UMK tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (typeof b.label === "string" && b.label.trim()) data.label = b.label.trim();
    if (b.monthlyAmount !== undefined) {
      const amount = Number(b.monthlyAmount);
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Jumlah harus angka positif" }, { status: 400 });
      data.monthlyAmount = amount;
    }
    if (typeof b.active === "boolean") data.active = b.active;
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });

    const updated = await db.minimumWage.update({ where: { id: wage.id }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "MinimumWage", entityId: wage.id, appUserId: actor.appUserId ?? undefined,
        detail: `UMP/UMK ${updated.label} (${updated.year}) diperbarui oleh ${actor.appUsername ?? actor.name}`,
      },
    });
    return NextResponse.json({ wage: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:parameters", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const wage = await db.minimumWage.findUnique({ where: { id } });
    if (!wage) return NextResponse.json({ error: "Entri UMP/UMK tidak ditemukan" }, { status: 404 });

    await db.minimumWage.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        action: "Deleted", entity: "MinimumWage", entityId: id, appUserId: actor.appUserId ?? undefined,
        detail: `UMP/UMK ${wage.label} (${wage.year}) dihapus oleh ${actor.appUsername ?? actor.name}`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
