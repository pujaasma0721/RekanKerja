import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { listInsuranceReceivables, decideInsurance } from "@/rekankerja/medical/services/medical-service";

// W4-1 (fix G-3 BPA-medical) — piutang asuransi (padanan oranHR
// "Reimbursement Employee: Paid By Insurance %").
//
// GET /api/rekankerja/medical/insurance — daftar piutang klaim Settled pada
//   jenis pctInsurance > 0: status siklus (NONE → SUBMITTED → PAID/WRITTEN_OFF),
//   sisa piutang, usia, rekap per perusahaan asuransi, total outstanding.
//   Guard view: persetujuan & settlement (domain settlement) ATAU klaim/laporan.
// POST — aksi { id, action: submit|paid|writeoff, insRefNo?, paidAmount?, note? }
//   Guard aksi: medical:medical-approval op:settle (sama dgn settle klaim —
//   siklus piutang bagian dari settlement).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, [
      "medical:medical-approval", "medical:medical-claim", "medical:medical-reports",
    ]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    // 45-b: gerbang vault uang — masked → uang null (UI render "—").
    const mv = await moneyViewForReq(req, m.db);
    const result = await listInsuranceReceivables(m.db, mv);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b.id || !["submit", "paid", "writeoff"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (submit|paid|writeoff) wajib" }, { status: 400 });
    }
    const m = await requireMenuAction(req, "medical:medical-approval", "op:settle");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await decideInsurance(m.db, {
      claimId: String(b.id),
      action: b.action,
      insRefNo: b.insRefNo !== undefined && b.insRefNo !== null ? String(b.insRefNo) : undefined,
      paidAmount: b.paidAmount != null ? Number(b.paidAmount) : undefined,
      note: b.note ? String(b.note) : undefined,
      // Fix audit 40 M-05: aktor sesi ikut tercatat di ActivityLog.
      actor: { appUserId: m.actor.appUserId, employeeId: m.actor.employeeId, name: m.actor.name },
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
