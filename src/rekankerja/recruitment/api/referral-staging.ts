import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listReferralSubmissions, verifyReferralSubmission, rejectReferralSubmission,
  referralSubmissionErrStatus,
} from "@/rekankerja/recruitment/services/referral-submission-service";

// ============================================================================
// RECRUITMENT P1.6 — API staging pengajuan referral (HR inbox — "ala public
// staging ringan"). DEVELOPMENT-PLAN-BENCHMARK.md §4 P1.6 (D-BM15).
//   GET   ?status=&q=&jobOpeningId= → { rows, stats } — semua pengajuan referral
//         karyawan ESS (perujuk + kandidat + lowongan + status + verifyNote).
//   PATCH { action: "verify" | "reject", id, note? }
//         verify → Applicant BARU (source Referral + referralEmployeeId —
//                  register B8 mengambil alih) / Duplicate bila email kandidat
//                  cocok blind-index pelamar existing (TIDAK membuat baru).
//         reject → alasan WAJIB ≥10 char (diberitahukan ke perujuk).
//
// Guard menu: recruitment:referral — GET view-only (pola register B8); PATCH
// aksi "update" (menu-perms "recruitment:referral" hanya punya op khusus
// "reward" — tidak ada op verify/approve; CRUD update dipakai sesuai spec).
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:referral"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const sp = req.nextUrl.searchParams;
    const res = await listReferralSubmissions(m.db, {
      status: sp.get("status"),
      q: sp.get("q"),
      jobOpeningId: sp.get("jobOpeningId"),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");
    if (action !== "verify" && action !== "reject") {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${action || "(kosong)"}` }, { status: 400 });
    }
    // op menu "verify" tidak ada di "recruitment:referral" (hanya "reward") —
    // pakai aksi CRUD "update" (pola spec P1.6; menu-perms TIDAK diubah).
    const m = await requireMenuAction(req, "recruitment:referral", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const actor = { employeeId: m.actor.employeeId, name: m.actor.name };

    if (action === "verify") {
      const res = await verifyReferralSubmission(m.db, {
        id: String(b.id ?? ""),
        actor,
        createApplicant: true,
      });
      return NextResponse.json(res);
    }
    const res = await rejectReferralSubmission(m.db, {
      id: String(b.id ?? ""),
      note: b.note == null ? null : String(b.note),
      actor,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: referralSubmissionErrStatus(e) });
  }
}
