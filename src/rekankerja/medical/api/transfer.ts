import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { transferUnusedToPayroll } from "@/rekankerja/medical/services/medical-service";

// POST /api/rekankerja/medical/transfer — sisa saldo jenis CASH akhir tahun →
// komponen Specific UMC (padanan "Paid to employee in cash at end of
// period with Wage Code"). Idempoten per period.
// Guard (fix audit K-2b): menolak bila masih ada klaim Submitted/Approved atas
// jenis CASH tahun tsb. Guard (fix audit 40 M-7): period dengan run
// Confirmed/Paid ditolak (saldo hangus diam-diam — mirror guard travel).
// Task 32-d / fix audit 40 §5: requireMutator longgar → requireMenuAction —
// op "settle" pada medical:medical-approval (katalog medical tidak punya op
// "transfer"; dialog transfer UMC berada di view Persetujuan & Settlement —
// op terdekat yang semantiknya memuat aksi pencairan sisa saldo).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "medical:medical-approval", "op:settle");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.periodId || !b.year) {
      return NextResponse.json({ error: "periodId & year wajib" }, { status: 400 });
    }
    const res = await transferUnusedToPayroll(m.db, {
      periodId: String(b.periodId),
      year: Number(b.year),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
      // Fix audit 40 M-05 — aktor transfer tercatat di ActivityLog
      actor: { name: m.actor.name, appUserId: m.actor.appUserId },
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
