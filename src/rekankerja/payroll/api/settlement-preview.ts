import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { computeTerminationSettlement, normalizeSettlementParams } from "@/rekankerja/payroll/services/settlement-service";

// POST /api/rekankerja/settlement-preview — preview Final Settlement PHK (T19)
// =====================================================================
// Body: { employeeId, effectiveDate, pesangonMultiplier?, uangPisahPct?,
//         includeBonusProRata? }
// Kalkulasi MURNI (tanpa mutasi) — dipakai dialog preview di detail PA
// Termination SEBELUM dokumen diproses; penerapan (assignment + ActivityLog)
// terjadi otomatis saat PA Termination diproses (settlement-service).
// Guard: hr:all view (dialog hidup di halaman detail personnel action).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:all", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json().catch(() => ({}));
    if (!b.employeeId || !b.effectiveDate) {
      return NextResponse.json({ error: "employeeId & effectiveDate wajib diisi" }, { status: 400 });
    }
    const effectiveDate = new Date(b.effectiveDate);
    if (Number.isNaN(effectiveDate.getTime())) {
      return NextResponse.json({ error: "Tanggal efektif tidak valid" }, { status: 400 });
    }
    const employee = await db.employee.findUnique({ where: { id: b.employeeId }, select: { id: true, status: true, joinDate: true } });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    if (effectiveDate.getTime() < employee.joinDate.getTime()) {
      return NextResponse.json(
        { error: `Tanggal efektif tidak boleh mendahului tanggal bergabung (${employee.joinDate.toISOString().slice(0, 10)})` },
        { status: 400 },
      );
    }

    const params = normalizeSettlementParams({
      pesangonMultiplier: b.pesangonMultiplier,
      uangPisahPct: b.uangPisahPct,
      includeBonusProRata: b.includeBonusProRata,
    });

    const result = await computeTerminationSettlement(db, b.employeeId, effectiveDate, params, b.reason ?? null);
    return NextResponse.json({ settlement: result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
