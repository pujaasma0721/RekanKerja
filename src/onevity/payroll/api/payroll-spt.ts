import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { buildAnnualSpt, buildEsptA1Csv } from "@/onevity/payroll/services/payroll-spt";

// GET /api/onevity/payroll-spt?year=2026                → laporan tahunan per karyawan
// GET /api/onevity/payroll-spt?year=2026&export=a1      → CSV rekap 1721-A1
// GET /api/onevity/payroll-spt?year=2026&export=espt    → CSV e-SPT 1721-A1 format DJP
//                                                        (39 kolom template impor e-Bupot
//                                                        21/26 sheet A1 — siap tempel/upload)
// GET /api/onevity/payroll-spt?periodId=..&export=coretax → CSV bukti potong bulanan (Coretax)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const exportMode = sp.get("export");

    // --- Bukti potong PPh21 bulanan (siap upload Coretax) ---
    if (exportMode === "coretax") {
      const periodId = sp.get("periodId");
      if (!periodId) return NextResponse.json({ error: "periodId wajib untuk ekspor coretax" }, { status: 400 });
      const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
      if (!period) return NextResponse.json({ error: "Period tidak ditemukan" }, { status: 404 });
      const runs = await db.payrollRun.findMany({
        where: { periodId, status: { in: ["Confirmed", "Paid"] } },
        include: { lines: { include: { employee: { include: { payrollProfile: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      // Jumlahkan lintas run (gaji + THR + rapel) per karyawan utk bukti potong 1 masa pajak.
      const byEmp = new Map<string, { employeeNo: string; name: string; npwp: string | null; bruto: number; tax: number; net: number }>();
      for (const run of runs) {
        for (const l of run.lines) {
          const cur = byEmp.get(l.employeeId) ?? {
            employeeNo: l.employeeNo, name: l.employeeName,
            npwp: l.employee?.payrollProfile?.npwp ?? l.employee?.taxId ?? null,
            bruto: 0, tax: 0, net: 0,
          };
          cur.bruto += l.bruto;
          cur.tax += l.taxRegular + l.taxIrregular;
          cur.net += l.net;
          byEmp.set(l.employeeId, cur);
        }
      }
      const rows = [...byEmp.values()].sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
      const header = ["MASA_PAJAK", "TAHUN_PAJAK", "NPWP", "NIK", "NAMA", "JUMLAH_BRUTO", "PPh21_DIPOTONG", "NETTO"];
      const lines = rows.map((r) => [
        period.sptMonth, period.sptYear, r.npwp ?? "", r.employeeNo, `"${r.name}"`,
        Math.round(r.bruto), Math.round(r.tax), Math.round(r.net),
      ].join(";"));
      const totals = ["", "", "", "", `"TOTAL (${rows.length} pegawai)"`,
        Math.round(rows.reduce((s, r) => s + r.bruto, 0)),
        Math.round(rows.reduce((s, r) => s + r.tax, 0)),
        Math.round(rows.reduce((s, r) => s + r.net, 0))].join(";");
      const csv = [`OneVity Bukti Potong PPh21 Masa ${period.sptMonth}/${period.sptYear} (${period.name})`, header.join(";"), ...lines, totals].join("\n");
      await db.activityLog.create({ data: { action: "Exported", entity: "PayrollPeriod", entityId: period.id, detail: `Ekspor Coretax bulanan ${period.name} (${rows.length} pegawai)` } });
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="onevity-coretax-${period.code}.csv"`,
        },
      });
    }

    const year = parseInt(sp.get("year") ?? String(new Date().getFullYear()), 10);
    const report = await buildAnnualSpt(db, year);

    // --- CSV rekap tahunan (format ringkas 1721-A1) ---
    if (exportMode === "a1") {
      const header = [
        "NO", "NPWP", "NIK", "NAMA", "STATUS_PTKP", "PTKP_TAHUNAN",
        "BRUTO_REGULER", "BRUTO_IRREGULER", "BIAYA_JABATAN", "IURAN_JSTK", "NETO",
        "PKP", "PPh21_SETAHUN", "PPh21_DIPOTONG", "KURANG_LEBIH_BAYAR",
      ].join(";");
      const lines = report.employees.map((r, i) => [
        i + 1, r.npwp ?? "", r.employeeNo, `"${r.employeeName}"`, r.taxStatus, Math.round(r.ptkpAnnual),
        Math.round(r.incomeRegular), Math.round(r.incomeIrregular), Math.round(r.biayaJabatan),
        Math.round(r.iuranJstk), Math.round(r.neto), Math.round(r.pkp),
        Math.round(r.pph21Annual), Math.round(r.taxWithheld), Math.round(r.delta),
      ].join(";"));
      const t = report.totals;
      const totals = ["", "", "", `"TOTAL (${t.employees} pegawai)"`, "", "",
        Math.round(t.brutoTaxable - report.employees.reduce((s, r) => s + r.incomeIrregular, 0)),
        Math.round(report.employees.reduce((s, r) => s + r.incomeIrregular, 0)),
        Math.round(t.biayaJabatan), Math.round(t.iuranJstk), Math.round(t.neto), "",
        Math.round(t.pph21Annual), Math.round(t.taxWithheld), Math.round(t.delta)].join(";");
      const csv = [
        `OneVity Rekap PPh21 Tahunan (SPT 1721-A1) — Tahun Pajak ${year}`,
        `Biaya jabatan ${report.regulation.biayaJabatanRate * 100}% (cap Rp ${(report.regulation.biayaJabatanCapAnnual).toLocaleString("id-ID")}/thn) · progresif Pasal 17`,
        header, ...lines, totals,
      ].join("\n");
      await db.activityLog.create({ data: { action: "Exported", entity: "SptReport", entityId: String(year), detail: `Ekspor 1721-A1 tahun ${year} (${report.employees.length} pegawai)` } });
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="onevity-spt1721a1-${year}.csv"`,
        },
      });
    }

    // --- CSV e-SPT 1721-A1 format resmi DJP (27-c) ---
    // 39 kolom Template Impor Excel TAHUNAN sheet A1 e-Bupot 21/26 v1.4 —
    // struktur sama dgn isian BP A1 Coretax. Guard mengikuti endpoint SPT
    // existing (requireTenant — sesi valid), activity log tercatat.
    if (exportMode === "espt") {
      const company = await db.company.findFirst({ select: { code: true, name: true, taxId: true } });
      const csv = buildEsptA1Csv(report, {
        tenantCode: company?.code ?? "ONEVITY",
        companyName: company?.name ?? "OneVity",
        companyNpwp: company?.taxId ?? null,
      });
      await db.activityLog.create({ data: { action: "Exported", entity: "SptReport", entityId: String(year), detail: `Ekspor e-SPT 1721-A1 format DJP tahun ${year} (${report.employees.length} pegawai)` } });
      const tenant = (company?.code ?? "ONEVITY").replace(/[^A-Za-z0-9]+/g, "");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="eSPT_1721A1_${year}_${tenant}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
