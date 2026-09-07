import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";

// GET /api/ess/payslips — slip gaji milik sendiri (run Confirmed/Paid saja).
// ?id= → satu slip lengkap; tanpa param → daftar ringkas + items.
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const id = req.nextUrl.searchParams.get("id");

    const lines = await db.payrollRunLine.findMany({
      where: {
        employeeId,
        ...(id ? { id } : {}),
        run: { status: { in: ["Confirmed", "Paid"] } },
      },
      include: {
        run: {
          select: {
            runNo: true, status: true, paidAt: true, confirmedAt: true, calculatedAt: true,
            period: { select: { name: true, payType: true, startDate: true, endDate: true } },
            processType: { select: { name: true, code: true } },
          },
        },
        items: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { run: { period: { startDate: "desc" } } },
    });

    // identitas karyawan + perusahaan untuk kop slip
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        employeeNo: true, fullName: true, taxId: true,
        assignments: {
          where: { validTo: null }, take: 1,
          select: {
            position: { select: { title: true } },
            orgUnit: { select: { name: true } },
            employmentStatus: true,
          },
        },
        company: { select: { name: true, code: true } },
      },
    });

    const cur = emp?.assignments[0] ?? null;
    const ptkpValue = await db.payrollRunLine.findFirst({
      where: { employeeId },
      select: { ptkpValue: true, ptkpStatus: true },
    });

    const slips = lines.map((l) => ({
      id: l.id,
      runNo: l.run.runNo,
      periodName: l.run.period.name,
      payType: l.run.period.payType,
      processTypeName: l.run.processType.name,
      status: l.run.status,
      paidAt: l.run.paidAt,
      confirmedAt: l.run.confirmedAt,
      bruto: l.bruto,
      deduction: l.deduction,
      taxRegular: l.taxRegular,
      taxIrregular: l.taxIrregular,
      net: l.net,
      items: l.items.map((it) => ({
        code: it.code, name: it.name, type: it.type, wageType: it.wageType,
        amount: it.amount, note: it.note, sortOrder: it.sortOrder,
      })),
    }));

    return NextResponse.json({
      slips,
      employee: emp
        ? {
            employeeNo: emp.employeeNo,
            fullName: emp.fullName,
            position: cur?.position?.title ?? null,
            orgUnit: cur?.orgUnit?.name ?? null,
            employmentStatus: cur?.employmentStatus ?? null,
            taxId: emp.taxId,
            ptkpStatus: ptkpValue?.ptkpStatus ?? null,
            ptkpValue: ptkpValue?.ptkpValue ?? null,
            company: emp.company?.name ?? null,
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
