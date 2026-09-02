import { NextRequest, NextResponse } from "next/server";
import { requireMutator } from "@/onevity/shared/lib/tenant-db";
import { transferUnusedToPayroll } from "@/onevity/medical/services/medical-service";

// POST /api/onevity/medical/transfer — sisa saldo jenis CASH akhir tahun →
// komponen Specific UMC (padanan oranHR "Paid to employee in cash at end of
// period with Wage Code"). Idempoten per period.
// Guard (fix audit K-2b): menolak bila masih ada klaim Submitted/Approved atas
// jenis CASH tahun tsb; requireMutator (VIEWER 403 + aktor sesi).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.periodId || !b.year) {
      return NextResponse.json({ error: "periodId & year wajib" }, { status: 400 });
    }
    const res = await transferUnusedToPayroll(m.db, {
      periodId: String(b.periodId),
      year: Number(b.year),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
