import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { toXlsx, xlsxResponse, exportFilename } from "@/onevity/shared/lib/export";

// GET /api/onevity/payroll-reports/bpjs?runId= — rekap iuran BPJS per karyawan
// untuk satu payroll run (T12-REPORTS).
//
//   • Sumber data: PayrollRunItem wageType "Jamsostek" (snapshot run —
//     komponen engine: JHT_C "BPJS JHT Perusahaan 3,7%", JHT_E "Potongan
//     BPJS JHT 2%", JP_C/JPK_C/JKK_C/JKM_C dst; lihat provisioning.ts).
//   • Klasifikasi program dari code+name (JPK=JKN Jaminan Kesehatan; urutan
//     cek JPK/JKK/JKM sebelum JP agar "JPK" tidak salah jatuh ke "JP").
//   • Arah iuran: item.type Earning = ditanggung perusahaan (p), Deduction =
//     dipotong dari pegawai (k).
//   • ?export=xlsx → stream XLSX (pola payroll-run-export.ts); tanpa param =
//     preview JSON (utk preview UI/tombol BpjsExportButton).
//
// Guard: requireMenuAction payroll:runs view (pola payroll-runs.ts).

export interface BpjsRow {
  employeeId: string;
  employeeNo: string;
  nik: string | null;
  fullName: string;
  orgUnitName: string | null;
  jhtCompany: number;
  jhtEmployee: number;
  jpCompany: number;
  jpEmployee: number;
  jkk: number;
  jkm: number;
  jknCompany: number;
  jknEmployee: number;
  totalCompany: number;
  totalEmployee: number;
}

interface BpjsBuckets {
  jhtC: number; jhtE: number; jpC: number; jpE: number;
  jkk: number; jkm: number; jknC: number; jknE: number;
}

const r0 = (n: number) => Math.round(n);

/** Klasifikasi program BPJS dari code+name (order matters: JPK/JKK/JKM sebelum JP). */
function basisOf(code: string, name: string): "JHT" | "JP" | "JKK" | "JKM" | "JKN" | null {
  const s = `${code} ${name}`.toUpperCase().replace(/\s+/g, "");
  if (s.includes("JHT")) return "JHT";
  if (s.includes("JPK") || s.includes("JKN") || s.includes("KESEHATAN")) return "JKN";
  if (s.includes("JKK")) return "JKK";
  if (s.includes("JKM")) return "JKM";
  if (s.includes("JP")) return "JP";
  return null;
}

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
        lines: {
          orderBy: { employeeNo: "asc" },
          include: { items: true, employee: { select: { nationalId: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status === "Draft" || run.status === "Cancelled") {
      return NextResponse.json(
        { error: `Run ${run.runNo} berstatus ${run.status} — hitung (calculate) payroll terlebih dahulu` },
        { status: 400 },
      );
    }

    const rows: BpjsRow[] = run.lines.map((l) => {
      const b: BpjsBuckets = { jhtC: 0, jhtE: 0, jpC: 0, jpE: 0, jkk: 0, jkm: 0, jknC: 0, jknE: 0 };
      for (const item of l.items) {
        if (item.wageType !== "Jamsostek") continue;
        const basis = basisOf(item.code, item.name);
        if (!basis) continue;
        // arah iuran: Earning = ditanggung perusahaan; Deduction = dipotong
        // dari pegawai (JKK/JKM/JKN-perusahaan tidak dipotong dari slip).
        const isCompany = item.type === "Earning";
        const key: keyof BpjsBuckets =
          basis === "JHT" ? (isCompany ? "jhtC" : "jhtE")
          : basis === "JP" ? (isCompany ? "jpC" : "jpE")
          : basis === "JKK" ? "jkk"
          : basis === "JKM" ? "jkm"
          : isCompany ? "jknC" : "jknE";
        b[key] += item.amount;
      }
      return {
        employeeId: l.employeeId,
        employeeNo: l.employeeNo,
        nik: l.employee?.nationalId ?? null,
        fullName: l.employeeName,
        orgUnitName: l.orgUnitName,
        jhtCompany: r0(b.jhtC), jhtEmployee: r0(b.jhtE),
        jpCompany: r0(b.jpC), jpEmployee: r0(b.jpE),
        jkk: r0(b.jkk), jkm: r0(b.jkm),
        jknCompany: r0(b.jknC), jknEmployee: r0(b.jknE),
        totalCompany: r0(b.jhtC + b.jpC + b.jkk + b.jkm + b.jknC),
        totalEmployee: r0(b.jhtE + b.jpE + b.jknE),
      };
    });

    const sum = (f: (r: BpjsRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totals = {
      employees: rows.length,
      jhtCompany: sum((r) => r.jhtCompany), jhtEmployee: sum((r) => r.jhtEmployee),
      jpCompany: sum((r) => r.jpCompany), jpEmployee: sum((r) => r.jpEmployee),
      jkk: sum((r) => r.jkk), jkm: sum((r) => r.jkm),
      jknCompany: sum((r) => r.jknCompany), jknEmployee: sum((r) => r.jknEmployee),
      totalCompany: sum((r) => r.totalCompany), totalEmployee: sum((r) => r.totalEmployee),
    };

    const meta = {
      runId: run.id,
      runNo: run.runNo,
      status: run.status,
      period: run.period.name,
      processType: run.processType.name,
      generatedAt: new Date().toISOString(),
    };

    if (req.nextUrl.searchParams.get("export") === "xlsx") {
      const columns = [
        { header: "NIK", width: 18 },
        { header: "No. Karyawan", width: 14 },
        { header: "Nama", width: 28 },
        { header: "Unit Kerja", width: 24 },
        { header: "JHT Perusahaan (3,7%)", width: 20 },
        { header: "JHT Pegawai (2%)", width: 18 },
        { header: "JP Perusahaan (2%)", width: 18 },
        { header: "JP Pegawai (1%)", width: 18 },
        { header: "JKK", width: 12 },
        { header: "JKM", width: 12 },
        { header: "JKN Perusahaan (4%)", width: 20 },
        { header: "JKN Pegawai (1%)", width: 18 },
        { header: "Total Perusahaan", width: 18 },
        { header: "Total Pegawai", width: 16 },
      ];
      const body = rows.map((r) => [
        r.nik ?? "", r.employeeNo, r.fullName, r.orgUnitName ?? "",
        r.jhtCompany, r.jhtEmployee, r.jpCompany, r.jpEmployee, r.jkk, r.jkm,
        r.jknCompany, r.jknEmployee, r.totalCompany, r.totalEmployee,
      ]);
      body.push([
        "", "", `TOTAL (${rows.length} karyawan)`, "",
        totals.jhtCompany, totals.jhtEmployee, totals.jpCompany, totals.jpEmployee, totals.jkk, totals.jkm,
        totals.jknCompany, totals.jknEmployee, totals.totalCompany, totals.totalEmployee,
      ]);
      const buf = await toXlsx("Rekap BPJS", columns, body, {
        title: `Rekap Iuran BPJS — ${run.runNo} · ${run.period.name} · ${run.processType.name}`,
      });
      await logExport(db, run.runNo, m.actor.appUserId);
      return xlsxResponse(buf, exportFilename("onevity-bpjs", "xlsx", run.runNo));
    }

    return NextResponse.json({ meta, rows, totals });
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
        detail: `Ekspor XLSX rekap BPJS run ${runNo}`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}
