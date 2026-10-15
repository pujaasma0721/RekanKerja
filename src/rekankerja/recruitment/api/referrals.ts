import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listReferrals, updateRewardNote, referralErrStatus,
} from "@/rekankerja/recruitment/services/referral-service";

// ============================================================================
// RECRUITMENT B8 — API Referral register HR (referral tracker)
// DEVELOPMENT-PLAN-BACKLOG.md §4 B8 + §5 risiko "Insentif referral
// disalahpahami otomatis" (UI tegas "catatan manual — di luar payroll").
//   GET  ?q=&status=&rewardOnly=   → register SEMUA Applicant ber-perujuk
//        (perujuk + unit aktif, slot terakhir, status pipeline ringkas,
//        referralNote, referralRewardNote) + stats. VIEW-ONLY tanpa op
//        (pola settings) — guard menu recruitment:referral LIHAT.
//   POST {action:updateReward, applicantId, referralRewardNote}
//        → catat insentif MANUAL HR — op "reward"; trim, ≤500 char,
//        kosong → null; ActivityLog "ReferralRewardNote" per mutasi.
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:referral"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const sp = req.nextUrl.searchParams;
    const res = await listReferrals(m.db, m.actor, {
      q: sp.get("q"),
      status: sp.get("status"),
      rewardOnly: sp.get("rewardOnly") === "1" || sp.get("rewardOnly") === "true",
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");
    if (action !== "updateReward") {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${action || "(kosong)"}` }, { status: 400 });
    }
    // op menu "reward" — Mencatat insentif referral (manual — di luar payroll)
    const m = await requireMenuAction(req, "recruitment:referral", "op:reward");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const row = await updateRewardNote(m.db, m.actor, {
      applicantId: String(b.applicantId ?? ""),
      referralRewardNote: b.referralRewardNote == null ? null : String(b.referralRewardNote),
    });
    return NextResponse.json({ row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: referralErrStatus(e) });
  }
}
