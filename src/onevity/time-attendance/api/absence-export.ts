import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { recapPeriod } from "@/onevity/time-attendance/services/attendance-service";
import { toCsv, csvResponse, exportFilename } from "@/onevity/shared/lib/export";

// GET /api/onevity/attendance/absence-export?from=&to= — rekap absensi per
// karyawan dalam rentang → CSV (T12-REPORTS).
// Route BARU terpisah dari /attendance/absence (file absence.ts dikerjakan
// agen paralel T5 — logika inti TIDAK diduplikasi di sini): handler ini
// memanggil service recapPeriod() READ-ONLY, tanpa regenerasi/transfer.
// CSV: BOM UTF-8 + delimiter ";" (pola shared/lib/export.ts) + baris TOTAL.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const now = new Date();
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? new Date(`${fromParam}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? new Date(`${toParam}T00:00:00`) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const recap = await recapPeriod(db, from, to);

    const columns = [
      { header: "No. Karyawan", width: 14 },
      { header: "Nama", width: 28 },
      { header: "Unit Kerja", width: 24 },
      { header: "Gaji Pokok", width: 14 },
      { header: "Hari Terjadwal", width: 14 },
      { header: "Hari Hadir", width: 12 },
      { header: "Terlambat (x)", width: 12 },
      { header: "Menit Terlambat", width: 14 },
      { header: "Hari Tidak Masuk", width: 14 },
      { header: "Izin Dibayar (hari)", width: 18 },
      { header: "Izin Tidak Dibayar (hari)", width: 20 },
      { header: "Cuti Dibayar (hari)", width: 16 },
      { header: "Cuti Tidak Dibayar (hari)", width: 18 },
      { header: "Menit Lembur", width: 14 },
      { header: "Upah Lembur", width: 14 },
      { header: "Potongan Terlambat", width: 16 },
      { header: "Potongan Absen", width: 14 },
      { header: "Tunjangan Kehadiran", width: 18 },
    ];
    const rows = recap.map((r) => [
      r.employeeNo, r.fullName, r.orgUnitName ?? "", Math.round(r.baseSalary),
      r.scheduledDays, r.presentDays, r.lateCount, r.lateMinutes, r.absentDays,
      r.workoffPaidDays, r.workoffUnpaidDays, r.leavePaidDays, r.leaveUnpaidDays,
      r.overtimeMinutes, Math.round(r.overtimePay), Math.round(r.lateDeduction),
      Math.round(r.absenceDeduction), Math.round(r.attendanceAllowance),
    ]);
    const sum = (f: (r: (typeof recap)[number]) => number) => recap.reduce((s, r) => s + f(r), 0);
    rows.push([
      "", `TOTAL (${recap.length} karyawan)`, "", "",
      sum((r) => r.scheduledDays), sum((r) => r.presentDays), sum((r) => r.lateCount), sum((r) => r.lateMinutes),
      sum((r) => r.absentDays), sum((r) => r.workoffPaidDays), sum((r) => r.workoffUnpaidDays),
      sum((r) => r.leavePaidDays), sum((r) => r.leaveUnpaidDays), sum((r) => r.overtimeMinutes),
      Math.round(sum((r) => r.overtimePay)), Math.round(sum((r) => r.lateDeduction)),
      Math.round(sum((r) => r.absenceDeduction)), Math.round(sum((r) => r.attendanceAllowance)),
    ]);

    return csvResponse(
      toCsv(columns, rows),
      exportFilename("onevity-absence", "csv", `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`),
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
