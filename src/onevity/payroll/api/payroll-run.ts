import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

// GET /api/onevity/payroll-run?id= — detail run + lines + items
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: {
        period: true,
        processType: true,
        lines: {
          orderBy: { employeeNo: "asc" },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    // 28-c: dekripsi di batas serializer — response tetap berbentuk angka
    // (enc:v1:n:… → number, enc:v1:t:… → teks) sehingga frontend tidak berubah.
    const tc = tenantCryptoForDb(db);
    const dec = tc.decryptJson(run);

    // Overview payroll ringan: agregat komponen utama (utk kartu ringkasan).
    // (decryptJson mengembalikan number saat runtime; Number() = koersi tipe
    // null→0 / legacy plaintext numerik → angka — no-op runtime utk nilai terdekripsi.)
    const aggByCode = new Map<string, { code: string; name: string; type: string; wageType: string; total: number }>();
    for (const line of dec.lines) {
      for (const item of line.items) {
        const cur = aggByCode.get(item.code) ?? { code: item.code, name: item.name, type: item.type, wageType: item.wageType, total: 0 };
        cur.total += Number(item.amount) || 0;
        aggByCode.set(item.code, cur);
      }
    }
    return NextResponse.json({
      run: dec,
      componentTotals: [...aggByCode.values()].sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code)),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
