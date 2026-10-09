import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";

// GET /api/rekankerja/payroll-run?id= — detail run + lines + items
export async function GET(req: NextRequest) {
  try {
    // AUD-DEPLOY (2-a HIGH-3): guard menu — sebelumnya requireTenant saja,
    // seluruh detail run (gaji semua karyawan) terbaca anggota biasa.
    const m = await requireMenuViewAny(req, ["payroll:runs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

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
        // Task 63 — log kejadian run (parameter kurang/anomali) utk tab Log.
        logs: { orderBy: [{ level: "asc" }, { employeeNo: "asc" }] },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    // 28-c: dekripsi di batas serializer — response tetap berbentuk angka
    // (enc:v1:n:… → number, enc:v1:t:… → teks) sehingga frontend tidak berubah.
    // 45-b: gate vault uang — masked → enc:v1:n: → null (frontend render "—").
    const dec = (await moneyViewForReq(req, db)).json(run);

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
