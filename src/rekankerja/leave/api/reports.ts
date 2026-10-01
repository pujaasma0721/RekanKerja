import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { listOnLeave, typeUsageSummary } from "@/rekankerja/leave/services/leave-service";
import { toCsv, csvResponse, exportFilename } from "@/rekankerja/shared/lib/export";

// GET /api/rekankerja/leave/reports?from=&to=&year= — laporan:
//   onLeave (padanan Query - Employee on Leave) + typeUsage (Summary Based on Leave Type)
// T12-REPORTS: ?export=csv → unduh CSV karyawan cuti pada rentang
// (data sama dgn JSON — tanpa perubahan logika service).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ? Number(sp.get("year")) : new Date().getFullYear();
    const now = new Date();
    const from = sp.get("from") ? new Date(sp.get("from") + "T00:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = sp.get("to") ? new Date(sp.get("to") + "T00:00:00") : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const [onLeave, typeUsage] = await Promise.all([
      listOnLeave(db, from, to),
      typeUsageSummary(db, year),
    ]);

    // mode export — CSV karyawan cuti (rentang) + ringkasan per jenis
    if (sp.get("export") === "csv") {
      const columns = [
        { header: "No. Dokumen", width: 16 },
        { header: "No. Karyawan", width: 14 },
        { header: "Nama", width: 28 },
        { header: "Unit Kerja", width: 24 },
        { header: "Jenis Cuti", width: 20 },
        { header: "Dibayar", width: 10 },
        { header: "Dari", width: 12 },
        { header: "Sampai", width: 12 },
        { header: "Hari Kerja", width: 12 },
        { header: "Status", width: 12 },
        { header: "Alasan", width: 32 },
      ];
      const rows = onLeave.map((r) => [
        r.docNo, r.employeeNo, r.fullName, r.orgUnitName ?? "", r.leaveTypeName,
        r.paid ? "Ya" : "Tidak",
        new Date(r.dateFrom).toISOString().slice(0, 10),
        new Date(r.dateTo).toISOString().slice(0, 10),
        r.workingDays, r.status, r.reason ?? "",
      ]);
      rows.push(["", "", `TOTAL (${onLeave.length} cuti)`, "", "", "", "", "", onLeave.reduce((s, r) => s + r.workingDays, 0), "", ""]);
      rows.push([]);
      rows.push(["Ringkasan per jenis", String(year), "", "", "", "", "", "", "", "", ""]);
      for (const ty of typeUsage) {
        rows.push(["", ty.code, ty.name, "", "", "", "", "", ty.taken, ty.unit, `${ty.employees} karyawan`]);
      }
      return csvResponse(
        toCsv(columns, rows),
        exportFilename("rekankerja-leave", "csv", `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`),
      );
    }
    return NextResponse.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      year,
      onLeave,
      typeUsage,
      onLeaveToday: onLeave.filter((r) => r.dateFrom <= now && r.dateTo >= now).length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
