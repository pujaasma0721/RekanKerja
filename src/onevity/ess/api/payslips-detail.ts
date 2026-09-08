// GET /api/onevity/ess/payslips/detail?lineId= — rincian slip gaji saya
// (kontrak T8-ESS-FRONTEND). 403 bila baris bukan milik karyawan aktor.
// kind income/deduction dari klasifikasi komponen snapshot PayrollRunItem
// (type Earning|Deduction|Informational — wageType mapping payroll engine).
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const lineId = new URL(req.url).searchParams.get("lineId") ?? "";
    if (!lineId) return NextResponse.json({ error: "lineId wajib diisi" }, { status: 400 });

    const line = await db.payrollRunLine.findUnique({
      where: { id: lineId },
      include: {
        run: { select: { status: true, period: { select: { name: true } } } },
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!line) return NextResponse.json({ error: "Slip gaji tidak ditemukan" }, { status: 404 });
    if (line.employeeId !== employeeId) {
      return NextResponse.json({ error: "Slip gaji ini bukan milik Anda" }, { status: 403 });
    }

    // 28-c: nilai uang terenkripsi di DB — dekripsi di batas serializer.
    const tc = tenantCryptoForDb(db);
    return NextResponse.json({
      periodName: line.run.period.name,
      runStatus: line.run.status,
      employeeName: line.employeeName,
      items: line.items.map((it) => ({
        name: it.name,
        kind: it.type === "Deduction" ? "deduction" : "income",
        amount: tc.decryptMoney(it.amount),
      })),
      gross: tc.decryptMoney(line.bruto),
      totalDeductions: tc.decryptMoney(line.deduction),
      net: tc.decryptMoney(line.net),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
