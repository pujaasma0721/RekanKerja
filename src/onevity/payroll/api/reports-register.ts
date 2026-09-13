import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { getMoneyView } from "@/onevity/shared/lib/money-view";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { toXlsx, xlsxResponse, exportFilename } from "@/onevity/shared/lib/export";

// GET /api/onevity/payroll-reports/register?runId= — payroll register
// (rekap gaji per unit kerja) untuk satu run (T12-REPORTS):
//   • per UNIT KERJA: jumlah karyawan, total gross, total potongan, total net;
//   • baris per karyawan: unit, no. karyawan, nama, gross, potongan, net.
//   Gross = PayrollRunLine.bruto (THP), potongan = deduction (BPJS pegawai +
//   PPh21 + lainnya), net = THP — snapshot run (PayrollRunLine).
//   ?export=xlsx → stream XLSX (pola payroll-run-export.ts); tanpa param =
//     preview JSON. Guard: requireMenuAction payroll:runs view.
const r0 = (n: number) => Math.round(n);

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:runs", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });

    const run = await db.payrollRun.findUnique({
      where: { id: runId },
      include: {
        period: true,
        processType: true,
        lines: { orderBy: [{ orgUnitName: "asc" }, { employeeNo: "asc" }] },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status === "Draft" || run.status === "Cancelled") {
      return NextResponse.json(
        { error: `Run ${run.runNo} berstatus ${run.status} — hitung (calculate) payroll terlebih dahulu` },
        { status: 400 },
      );
    }

    // 28-c: uang line/total run tersimpan terenkripsi — dekripsi di sini.
    // 45-b: gate vault (aktor requireMenuAction) — register = tampilan/ekspor
    // internal. 56: dec0 — vault tertutup → 0 utk SEMUA kolom (keputusan
    // pemilik produk: konsisten dgn UI payroll "belum buka brankas → Rp 0").
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    const dm = (v: string | null) => mv.dec0(v);

    // kelompokkan per unit kerja (null → "Tanpa Unit")
    const unitOf = (u: string | null) => u?.trim() || "Tanpa Unit";
    const groups = new Map<string, { unit: string; employees: { employeeId: string; employeeNo: string; fullName: string; gross: number; deduction: number; net: number }[] }>();
    for (const l of run.lines) {
      const unit = unitOf(l.orgUnitName);
      const g = groups.get(unit) ?? { unit, employees: [] };
      g.employees.push({
        employeeId: l.employeeId,
        employeeNo: l.employeeNo,
        fullName: l.employeeName,
        gross: r0(dm(l.bruto)),
        deduction: r0(dm(l.deduction)),
        net: r0(dm(l.net)),
      });
      groups.set(unit, g);
    }

    const byUnit = [...groups.values()]
      .map((g) => {
        const sum = (f: (e: (typeof g.employees)[number]) => number) =>
          g.employees.reduce((s, e) => s + f(e), 0);
        return {
          unit: g.unit,
          employees: g.employees.length,
          totalGross: r0(sum((e) => e.gross)),
          totalDeduction: r0(sum((e) => e.deduction)),
          totalNet: r0(sum((e) => e.net)),
          rows: g.employees,
        };
      })
      .sort((a, b) => b.totalNet - a.totalNet || a.unit.localeCompare(b.unit));

    const meta = {
      runId: run.id,
      runNo: run.runNo,
      status: run.status,
      period: run.period.name,
      processType: run.processType.name,
      generatedAt: new Date().toISOString(),
    };
    const totals = {
      employees: run.lines.length,
      totalGross: r0(dm(run.totalBruto) ?? 0),
      totalDeduction: r0(dm(run.totalDeduction) ?? 0),
      totalTax: r0(dm(run.totalTax) ?? 0),
      totalNet: r0(dm(run.totalNet) ?? 0),
    };

    if (req.nextUrl.searchParams.get("export") === "xlsx") {
      const columns = [
        { header: "Unit Kerja", width: 24 },
        { header: "No.", width: 6 },
        { header: "No. Karyawan", width: 14 },
        { header: "Nama", width: 28 },
        { header: "Gross", width: 16 },
        { header: "Potongan", width: 16 },
        { header: "NET", width: 16 },
      ];
      const body: (number | string)[][] = [];
      let no = 0;
      for (const g of byUnit) {
        // sub-header unit + ringkasan unit
        body.push([g.unit, "", "", `${g.employees} karyawan`, g.totalGross, g.totalDeduction, g.totalNet]);
        for (const e of g.rows) {
          no += 1;
          body.push([g.unit, no, e.employeeNo, e.fullName, e.gross, e.deduction, e.net]);
        }
        body.push([`Subtotal ${g.unit}`, "", "", "", g.totalGross, g.totalDeduction, g.totalNet]);
      }
      body.push(["GRAND TOTAL", "", "", `${no} karyawan`, totals.totalGross, totals.totalDeduction, totals.totalNet]);
      const buf = await toXlsx("Register", columns, body, {
        title: `Payroll Register — ${run.runNo} · ${run.period.name} · ${run.processType.name}`,
      });
      await logExport(db, run.runNo, m.actor.appUserId);
      return xlsxResponse(buf, exportFilename("onevity-register", "xlsx", run.runNo));
    }

    return NextResponse.json({ meta, byUnit, totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

async function logExport(db: TenantDb, runNo: string, appUserId: string | null) {
  try {
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "PayrollRun",
        ...(appUserId ? { appUserId } : {}),
        detail: `Ekspor XLSX payroll register run ${runNo}`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}
