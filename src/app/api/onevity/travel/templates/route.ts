import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { listTemplates, listExpenseTypes, listZones, upsertTemplate, upsertExpenseType } from "@/lib/onevity/travel-service";

// GET /api/onevity/travel/templates — master: template + jenis biaya + zona
// + karyawan aktif (padanan General Setting: ClaimTmpl + ExpenseDefinition +
// DomesticZone; employees utk picker form).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const [templates, expenseTypes, zones, employees] = await Promise.all([
      listTemplates(db),
      listExpenseTypes(db),
      listZones(db),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    return NextResponse.json({ templates, expenseTypes, zones, employees });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ubah/buat master: kind=template | expense.
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    const kind = String(b.kind ?? "");
    if (kind === "template") {
      const code = String(b.code ?? "").trim().toUpperCase();
      const name = String(b.name ?? "").trim();
      if (!b.id && (!code || !name)) return NextResponse.json({ error: "Kode & nama template wajib diisi" }, { status: 400 });
      if (b.isDefault) {
        // hanya 1 default — pastikan minimal valid
        const templates = await db.travelTemplate.count();
        if (!b.id && templates === 0) {
          // template pertama boleh langsung default
        }
      }
      const id = await upsertTemplate(db, {
        id: b.id ? String(b.id) : undefined,
        code, name,
        description: b.description ? String(b.description) : undefined,
        settlementDay: Math.max(0, parseInt(b.settlementDay ?? 14, 10) || 0),
        settlementMethod: b.settlementMethod === "Payroll" ? "Payroll" : "Kas",
        isDefault: Boolean(b.isDefault),
      });
      return NextResponse.json({ id, kind }, { status: 201 });
    }
    if (kind === "expense") {
      const code = String(b.code ?? "").trim().toUpperCase();
      const name = String(b.name ?? "").trim();
      if (!b.id && (!code || !name)) return NextResponse.json({ error: "Kode & nama jenis biaya wajib diisi" }, { status: 400 });
      const id = await upsertExpenseType(db, {
        id: b.id ? String(b.id) : undefined,
        code, name,
        kind: String(b.expenseKind ?? "GENERAL"),
        description: b.description ? String(b.description) : undefined,
        limitAmount: Math.max(0, Number(b.limitAmount ?? 0)),
        unlimited: Boolean(b.unlimited),
        needDocs: Boolean(b.needDocs),
        debitAccount: b.debitAccount ? String(b.debitAccount) : undefined,
        creditAccount: b.creditAccount ? String(b.creditAccount) : undefined,
        compWageCode: b.compWageCode ? String(b.compWageCode) : undefined,
      });
      return NextResponse.json({ id, kind }, { status: 201 });
    }
    return NextResponse.json({ error: "kind harus template | expense" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
