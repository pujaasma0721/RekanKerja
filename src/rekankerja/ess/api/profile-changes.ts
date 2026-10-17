// P1.1-BM (D-BM1) — API ESS: ajukan perubahan data diri ====================
// ===========================================================================
// GET   /api/rekankerja/ess/profile-changes — nilai saat ini (whitelist) +
//       kontak darurat (telepon didekripsi di batas) + "Pengajuan Saya"
//       (status + catatan keputusan).
// POST  /api/rekankerja/ess/profile-changes — submit pengajuan {entries,
//       reason} → 201 {docNo}. Notifikasi in-app ke approver jenjang aktif
//       (pola ess/api/letters.ts — notifyEvent to:"nextApprover", tanpa
//       email: tidak ada template default yang cocok di email-defaults.ts).
// PATCH /api/rekankerja/ess/profile-changes {id} — batalkan pengajuan SENDIRI
//       selama masih Submitted (chain ikut dibatalkan).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import {
  submitChange, cancelChange, myRequests, currentProfile,
  ProfileChangeError, type PcEntryInput,
} from "@/rekankerja/human-resource/services/profile-change-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

// ================= GET =================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const [profile, requests] = await Promise.all([
      currentProfile(db, employeeId),
      myRequests(db, employeeId),
    ]);
    return NextResponse.json({ ...profile, requests });
  } catch (e) {
    if (e instanceof ProfileChangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST (submit) =================
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName, appUserId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const entries: PcEntryInput[] = Array.isArray(b.entries) ? (b.entries as PcEntryInput[]) : [];
    const reason = b.reason != null ? String(b.reason) : null;
    const res = await submitChange(db, { employeeId, entries, reason }, { appUserId, name: fullName });

    // kabari approver jenjang aktif (resolusi notifyEvent: chain Current step;
    // tanpa chain/approver karyawan → fallback Admin/HR maks 3 — anti diam).
    void notifyEvent(db, {
      to: "nextApprover",
      docType: "ProfileChange",
      docNo: res.docNo,
      docId: res.id,
      title: `Pengajuan ubah data diri ${res.docNo} menunggu keputusan`,
      body: `${fullName} mengajukan perubahan data diri (${res.entries.length} perubahan)${reason ? ` — alasan: ${reason}` : ""}.`,
      kind: "profile-change",
    });

    return NextResponse.json({ docNo: res.docNo, status: "Submitted" }, { status: 201 });
  } catch (e) {
    if (e instanceof ProfileChangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH (cancel own) =================
export async function PATCH(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const res = await cancelChange(db, { id: String(b.id), employeeId, actorName: fullName });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof ProfileChangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
