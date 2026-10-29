// P8-PERF — ESS Riwayat Kinerja Saya (PP 35/2021 §7.2): ekspor XLSX penuh ====
// riwayat penilaian karyawan atas DIRINYA sendiri lintas siklus — enrollments,
// target+aktual+skor KPI, skor kompetensi, hasil final, PIP, merit. Guard:
// requireEss (employeeId dari SESI — bukan parameter — karyawan tidak bisa
// mengekspor milik orang lain). Sheet builder dipakai bersama dgn API admin
// employee-history (report-documents.ts).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { toXlsxMulti, xlsxResponse, exportFilename } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";
import { buildEmployeeHistorySheets } from "@/rekankerja/performance/api/report-documents";

// GET /api/rekankerja/ess/my-history?export=xlsx&lang=id|en
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("export") !== "xlsx") {
      return NextResponse.json({ error: "Riwayat hanya tersedia sebagai ekspor XLSX (?export=xlsx)" }, { status: 400 });
    }
    const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { employeeNo: true, fullName: true } });
    if (!emp) return NextResponse.json({ error: "Data karyawan tidak ditemukan" }, { status: 404 });
    const lang: Lang = url.searchParams.get("lang") === "en" ? "en" : "id";
    const sheets = await buildEmployeeHistorySheets(db, employeeId, lang);
    const buf = await toXlsxMulti(sheets, { lang });
    try {
      await db.activityLog.create({
        data: {
          action: "Exported", entity: "AppraisalRecord", employeeId,
          detail: `Karyawan mengekspor riwayat kinerjanya sendiri (XLSX — PP 35/2021 §7.2): ${emp.employeeNo}`,
        },
      });
    } catch { /* ActivityLog opsional */ }
    return xlsxResponse(buf, exportFilename(`rekankerja-riwayat-saya-${emp.employeeNo}`, "xlsx"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
