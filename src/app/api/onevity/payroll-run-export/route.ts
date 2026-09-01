import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/payroll-run/export?id= — CSV transfer bank / rekap payroll
// Format: kolom ringkas siap upload manual ke internet banking (BCA/Mandiri/BNI umum).
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: {
        period: true,
        processType: true,
        lines: {
          orderBy: { employeeNo: "asc" },
          include: { employee: { include: { payrollProfile: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status !== "Confirmed" && run.status !== "Paid") {
      return NextResponse.json({ error: "Ekspor hanya untuk run yang sudah dikonfirmasi" }, { status: 400 });
    }

    const header = [
      "NO", "EMPLOYEE_ID", "NAMA", "UNIT", "BANK", "NO_REKENING", "BRUTO", "POTONGAN", "PPh21", "NETTO",
    ].join(";");
    const rows = run.lines.map((l, i) => {
      const bank = l.employee?.payrollProfile?.bankName ?? l.employee?.bankName ?? "";
      const account = l.employee?.payrollProfile?.bankAccount ?? l.employee?.bankAccount ?? "";
      return [
        i + 1,
        l.employeeNo,
        `"${l.employeeName}"`,
        `"${l.orgUnitName ?? ""}"`,
        bank,
        account,
        Math.round(l.bruto),
        Math.round(l.deduction),
        Math.round(l.taxRegular + l.taxIrregular),
        Math.round(l.net),
      ].join(";");
    });
    const totals = ["", "", `"TOTAL (${run.employeeCount} karyawan)"`, "", "", "", Math.round(run.totalBruto), Math.round(run.totalDeduction), Math.round(run.totalTax), Math.round(run.totalNet)].join(";");
    const csv = [`OneVity Payroll Transfer — ${run.runNo} (${run.period.name} / ${run.processType.name})`, header, ...rows, totals].join("\n");

    await db.activityLog.create({ data: { action: "Exported", entity: "PayrollRun", entityId: run.id, detail: `Ekspor CSV run ${run.runNo}` } });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="onevity-transfer-${run.runNo}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
