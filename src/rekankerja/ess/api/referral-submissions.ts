import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import {
  submitReferral, myReferralSubmissions, referralOpenings, referralSubmissionErrStatus,
} from "@/rekankerja/recruitment/services/referral-submission-service";

// ============================================================================
// ESS — P1.6 "Referral otomatis" (DEVELOPMENT-PLAN-BENCHMARK.md §4 P1.6):
//   GET  → { rows, stats, openings } — "Pengajuan Saya" SELF-SCOPE via
//          requireEss (anti-IDOR: hanya referrerEmployeeId = karyawan sesi;
//          TANPA email/phone kandidat — minimisasi) + opsi lowongan Posted
//          utk form ajukan (id + judul + refNo).
//   POST → ajukan kandidat referral (nama + email/WA + lowongan opsional +
//          catatan) → 201. Validasi service: nama ≥3 char; minimal satu
//          kontak; email valid; phone 8–15 digit; lowongan harus Posted;
//          anti-abuse ≥10 Submitted/bulan → 429; duplicate nama+email di
//          Submitted → 409. TIDAK ada PATCH (tanpa cancel — sederhana).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const [mine, openings] = await Promise.all([
      myReferralSubmissions(db, employeeId),
      referralOpenings(db),
    ]);
    return NextResponse.json({ ...mine, openings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const row = await submitReferral(db, {
      employeeId,
      jobOpeningId: b.jobOpeningId ? String(b.jobOpeningId) : null,
      candidateName: String(b.candidateName ?? ""),
      candidateEmail: b.candidateEmail == null ? null : String(b.candidateEmail),
      candidatePhone: b.candidatePhone == null ? null : String(b.candidatePhone),
      note: b.note == null ? null : String(b.note),
    }, { name: `${fullName} (ESS)` });
    return NextResponse.json({ row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: referralSubmissionErrStatus(e) });
  }
}
