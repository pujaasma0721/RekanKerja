import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/onevity/shared/services/menu-access";
import { listTemplates, listExpenseTypes, listZones, upsertTemplate, upsertExpenseType } from "@/onevity/travel/services/travel-service";

// GET /api/onevity/travel/templates — master: template + jenis biaya + zona
// + karyawan aktif (padanan General Setting: ClaimTmpl + ExpenseDefinition +
// DomesticZone; employees utk picker form).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["travel:travel-templates", "travel:travel-request", "travel:travel-claim", "travel:travel-reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
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
// T41-M2: guard hak AKSI menu travel:travel-templates — UPSERT, aksi
// mengikuti body (b.id → Ubah, tanpa id → Baru); sebelumnya requireTenant
// saja (VIEWER bisa mengubah template/limit biaya yang dipakai validasi klaim).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json(); // dibaca SEKALI sebelum guard (aksi tergantung body)
    const m = await requireMenuAction(req, "travel:travel-templates", b.id ? "update" : "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
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
