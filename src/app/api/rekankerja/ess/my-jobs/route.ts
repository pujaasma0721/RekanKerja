// ============================================================================
// RECRUITMENT F5 — ESS: Lowongan Internal (oranHR §2.10 MyJobOpportunity +
// MyEmpAppliedJobOpportunity).
//   GET  → { openings, stats, myApplications } — slot Posted+Open aktif +
//          riwayat lamaran sendiri + status kandidat.
//   POST { action: "apply", jobOpeningId, note? }      → apply (guard penuh:
//        JobCandidate source Internal via jalur F3 + steps + notifikasi HR)
//   POST { action: "withdraw", applicationId, note? }  → tarik lamaran.
// Guard: requireEss (akun tertaut karyawan — self-scope).
// ============================================================================
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { myJobOpportunities, myAppliedJobs, applyInternalJob, withdrawMyApplication } from "@/rekankerja/recruitment/services/internal-apply-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const [list, mine] = await Promise.all([
      myJobOpportunities(db, employeeId),
      myAppliedJobs(db, employeeId),
    ]);
    return NextResponse.json({ ...list, myApplications: mine });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = (await req.json().catch(() => ({}))) as { action?: string; jobOpeningId?: string; applicationId?: string; note?: string };
    const action = String(b.action ?? "apply");

    if (action === "apply") {
      if (!b.jobOpeningId) return NextResponse.json({ error: "jobOpeningId wajib" }, { status: 400 });
      const res = await applyInternalJob(db, {
        employeeId,
        jobOpeningId: String(b.jobOpeningId),
        note: b.note ?? null,
        actorName: `${fullName} (ESS)`,
      });
      // notifikasi ke karyawan sendiri (konfirmasi apply tercatat)
      void notifyEvent(db, {
        to: "employee", employeeId, docType: "EmpJobApplication", docNo: res.prNo,
        title: "Lamaran internal tercatat",
        body: `Lamaran Anda ke "${res.title}" (PR ${res.prNo}) berhasil dikirim — pantau progresnya di Seleksi Saya.`,
        kind: "recruitment",
      }).catch(() => {});
      return NextResponse.json(res);
    }

    if (action === "withdraw") {
      if (!b.applicationId) return NextResponse.json({ error: "applicationId wajib" }, { status: 400 });
      await withdrawMyApplication(db, {
        employeeId,
        applicationId: String(b.applicationId),
        note: b.note ?? null,
        actorName: `${fullName} (ESS)`,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
