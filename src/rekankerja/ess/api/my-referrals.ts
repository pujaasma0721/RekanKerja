import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { myReferrals } from "@/rekankerja/recruitment/services/referral-service";

// ============================================================================
// ESS — "Referral Saya" (B8 — DEVELOPMENT-PLAN-BACKLOG.md §4 B8):
//   GET → daftar Applicant yang saya rujuk (self-scope via requireEss —
//         anti-IDOR: hanya referralEmployeeId = karyawan sesi) + stats
//         count per status. READ-ONLY — ESS tidak bisa mengubah apa pun.
//         referralRewardNote SENGAJA TIDAK diekspos (catatan internal HR —
//         insentif manual di luar payroll; silakan tanya HR).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const res = await myReferrals(db, employeeId);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
