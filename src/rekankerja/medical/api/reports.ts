import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toCsv, csvResponse, exportFilename, type ExportCell } from "@/rekankerja/shared/lib/export";
import { type Lang } from "@/rekankerja/shared/lib/i18n-core";
import { claimReport, medicalStats } from "@/rekankerja/medical/services/medical-service";

// GET /api/rekankerja/medical/reports?from=&to=&employeeId=&year= — laporan klaim
// rentang (padanan MedicalBenefitSummaryEmployee) + rekap per jenis (SummaryType).
// Task 82-c: ?export=csv → unduh CSV klaim pada rentang (cermin pola T12-REPORTS
// leave/api/reports.ts — data sama dgn JSON, tanpa logika service baru).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["medical:medical-reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") ?? new Date().getFullYear());
    const from = sp.get("from") ?? `${year}-01-01`;
    const to = sp.get("to") ?? `${year}-12-31`;
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi; sekali utk kedua builder).
    const mv = await moneyViewForReq(req, db);
    const [rows, stats, employees] = await Promise.all([
      claimReport(db, {
        from,
        to,
        employeeId: sp.get("employeeId") ?? undefined,
      }, mv),
      medicalStats(db, year, mv),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    // Task 82-c: mode export — CSV daftar klaim rentang (kolom uang sudah
    // digate claimReport via MoneyView: masked → null → dikosongkan di CSV).
    if (sp.get("export") === "csv") {
      // BL-5 (tier-2 export): bahasa header CSV — default EN (pola BL-4;
      // baris data tetap apa adanya — toCsv hanya menerjemahkan header).
      const lang: Lang = sp.get("lang") === "id" ? "id" : "en";
      // provider (rumah sakit/klinik) dari rincian perawatan — digabung per
      // klaim (query baca murni di route, service tidak diubah).
      const docNos = rows.map((r) => r.docNo);
      const providerByDoc = new Map<string, string>();
      if (docNos.length) {
        const lineRows = await db.medicalClaimLine.findMany({
          where: { claim: { docNo: { in: docNos } } },
          select: { hospital: true, claim: { select: { docNo: true } } },
        });
        for (const l of lineRows) {
          if (!l.hospital) continue;
          const cur = providerByDoc.get(l.claim.docNo);
          if (!cur) providerByDoc.set(l.claim.docNo, l.hospital);
          else if (!cur.split("; ").includes(l.hospital)) providerByDoc.set(l.claim.docNo, `${cur}; ${l.hospital}`);
        }
      }
      const columns = [
        { header: "No. Dokumen", width: 16 },
        { header: "No. Karyawan", width: 14 },
        { header: "Nama Karyawan", width: 28 },
        { header: "Jenis Benefit", width: 22 },
        { header: "Provider", width: 28 },
        { header: "Tanggal Klaim", width: 12 },
        { header: "Total Tagihan", width: 16 },
        { header: "Total Approved", width: 16 },
        { header: "Status", width: 12 },
        { header: "Pool", width: 14 },
      ];
      const lines: ExportCell[][] = rows.map((r) => [
        r.docNo, r.employeeNo, r.fullName, `${r.typeCode} — ${r.typeName}`,
        providerByDoc.get(r.docNo) ?? "",
        new Date(r.claimDate).toISOString().slice(0, 10),
        r.totalBill ?? "",
        r.totalApproved ?? "",
        r.state,
        r.forDependent ? "Dependent" : "Karyawan",
      ]);
      // baris TOTAL — hanya menjumlah nilai yang terlihat (masked → kosong).
      const billSum = rows.every((r) => r.totalBill == null)
        ? ""
        : rows.reduce((s, r) => s + (r.totalBill ?? 0), 0);
      const approvedSum = rows.every((r) => r.totalApproved == null)
        ? ""
        : rows.reduce((s, r) => s + (r.totalApproved ?? 0), 0);
      lines.push(["", "", `TOTAL (${rows.length} klaim)`, "", "", "", billSum, approvedSum, "", ""]);
      return csvResponse(
        toCsv(columns, lines, lang),
        exportFilename("rekankerja-medical", "csv", `${from}_${to}`),
      );
    }
    // W2-6 (fix G-9 BPA-medical): byEmployee = rekap beban per karyawan
    // (padoran SummaryEmployee) ikut dikirim utk kartu baru UI laporan.
    return NextResponse.json({ rows, byType: stats.byType, byEmployee: stats.byEmployee, year, employees });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
