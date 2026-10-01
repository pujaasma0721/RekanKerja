// GET /api/rekankerja/ess/payslips/detail?lineId= — rincian slip gaji saya
// (kontrak T8-ESS-FRONTEND). 403 bila baris bukan milik karyawan aktor.
// kind income/deduction dari klasifikasi komponen snapshot PayrollRunItem
// (type Earning|Deduction|Informational — wageType mapping payroll engine).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformUserId, platformRole } = m.actor;

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
    // 45-b: gerbang vault uang (aktor ESS) — masked → null (frontend "—").
    const mv = await getMoneyView(db, { userId: platformUserId, membershipRole: platformRole });
    return NextResponse.json({
      periodName: line.run.period.name,
      runStatus: line.run.status,
      employeeName: line.employeeName,
      items: line.items.map((it) => ({
        name: it.name,
        kind: it.type === "Deduction" ? "deduction" : "income",
        amount: mv.dec(it.amount),
      })),
      gross: mv.dec(line.bruto),
      totalDeductions: mv.dec(line.deduction),
      net: mv.dec(line.net),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
