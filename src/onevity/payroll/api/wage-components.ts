import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";

// GET /api/onevity/wage-components?type=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const type = req.nextUrl.searchParams.get("type");
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const where = {
      ...(type && type !== "all" ? { type } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}),
    };
    const components = await db.wageComponent.findMany({
      where,
      orderBy: [{ type: "asc" }, { code: "asc" }],
      // Task 32: jumlah aturan diferensiasi besaran per komponen.
      include: { _count: { select: { rules: true } } },
    });
    const counts = await db.wageComponent.groupBy({ by: ["type"], _count: true });
    const typeCounts: Record<string, number> = {};
    for (const c of counts) typeCounts[c.type] = c._count;
    return NextResponse.json({
      components: components.map((c) => {
        const { _count, ...rest } = c;
        return { ...rest, ruleCount: _count.rules };
      }),
      typeCounts,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/wage-components — T1-SECURITY: guard hak AKSI payroll:components (Baru).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:components", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode dan nama komponen wajib diisi" }, { status: 400 });
    const exists = await db.wageComponent.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode ${b.code} sudah dipakai` }, { status: 400 });

    const incomeTaxMethod = b.incomeTaxMethod ?? (b.taxable === false ? "NonTaxable" : "Regular");
    const comp = await db.wageComponent.create({
      data: {
        code: b.code, name: b.name,
        type: b.type ?? "Earning",
        wageType: b.wageType ?? "Compensation",
        calcMethod: b.calcMethod ?? "Fixed",
        amount: Number(b.amount ?? 0),
        formula: b.formula ?? null,
        incomeTaxMethod,
        processMethod: b.processMethod ?? "GrossToNet",
        roundingType: b.roundingType ?? "Nearest",
        roundingValue: Number(b.roundingValue ?? 1),
        prorated: b.prorated ?? false,
        // Task 64b — basis prorata: null/"Calendar" hari kalender, "WorkingDays" hari kerja jadwal.
        prorateBasis: b.prorateBasis === "WorkingDays" ? "WorkingDays" : null,
        taxable: incomeTaxMethod !== "NonTaxable",
        includeInBasicIncome: b.includeInBasicIncome ?? false,
        includeInTHP: b.includeInTHP ?? true,
        displayInPaySlip: b.displayInPaySlip ?? true,
        applyThrRules: b.applyThrRules ?? false,
        jamsostekBasis: b.jamsostekBasis ?? null,
        sptReference: b.sptReference ?? null,
        naturaType: b.naturaType ?? null,
        wageCodeBackPay: b.wageCodeBackPay ?? null,
        accountDebitCode: b.accountDebitCode || null,
        accountCreditCode: b.accountCreditCode || null,
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "WageComponent", entityId: comp.id, detail: `Komponen upah ${comp.name} (${comp.wageType}) dibuat` } });
    return NextResponse.json({ component: comp }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/wage-components — T1-SECURITY: guard hak AKSI payroll:components (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:components", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const incomeTaxMethod = b.incomeTaxMethod;
    const comp = await db.wageComponent.update({
      where: { id: b.id },
      data: {
        name: b.name,
        type: b.type,
        wageType: b.wageType,
        calcMethod: b.calcMethod,
        amount: b.amount != null ? Number(b.amount) : undefined,
        formula: b.formula,
        incomeTaxMethod,
        processMethod: b.processMethod,
        roundingType: b.roundingType,
        roundingValue: b.roundingValue != null ? Number(b.roundingValue) : undefined,
        prorated: b.prorated,
        // Task 64b — basis prorata (undefined = tidak diubah; null/"Calendar" = kalender).
        prorateBasis: b.prorateBasis === undefined ? undefined : (b.prorateBasis === "WorkingDays" ? "WorkingDays" : null),
        taxable: incomeTaxMethod != null ? incomeTaxMethod !== "NonTaxable" : b.taxable,
        includeInBasicIncome: b.includeInBasicIncome,
        includeInTHP: b.includeInTHP,
        displayInPaySlip: b.displayInPaySlip,
        applyThrRules: b.applyThrRules,
        jamsostekBasis: b.jamsostekBasis,
        sptReference: b.sptReference,
        naturaType: b.naturaType,
        wageCodeBackPay: b.wageCodeBackPay,
        accountDebitCode: b.accountDebitCode === undefined ? undefined : b.accountDebitCode || null,
        accountCreditCode: b.accountCreditCode === undefined ? undefined : b.accountCreditCode || null,
        active: b.active,
      },
    });
    return NextResponse.json({ component: comp });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/wage-components?id= — T1-SECURITY: guard hak AKSI payroll:components (Hapus).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:components", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    // Cegah hapus komponen yang dipakai template/assignment
    const usedInTemplate = await db.wageTemplateItem.count({ where: { wageComponentId: id } });
    const usedInAssignment = await db.employeeComponentAssignment.count({ where: { wageComponentId: id } });
    if (usedInTemplate + usedInAssignment > 0) {
      return NextResponse.json({ error: "Komponen masih dipakai template/assignment — non-aktifkan saja" }, { status: 400 });
    }
    await db.wageComponent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
