// RekanKerja ESS — API REGULARISASI ABSENSI MANDIRI (P1.3 / D-BM7).
// ============================================================================
// GET   /api/rekankerja/ess/regularization — daftar pengajuan MILIK SENDIRI
//       (self-scope via requireEss — anti-IDOR) + sisa kuota bulan berjalan.
// POST  — ajukan koreksi absensi (lupa absen / jam salah): validasi penuh di
//       service (tanggal ≤30 hari ke belakang & bukan masa depan, kind↔jam,
//       alasan ≥10 karakter, cap 4 aktif/bulan → 429). Lampiran opsional
//       diunggah PRA-submit ke /api/rekankerja/attachments (entityType
//       "AttendanceRegularization", entityId "draft:uuid") lalu dikirim via
//       attachmentIds → di-rebind ke dokumen oleh service.
// PATCH — tarik pengajuan sendiri yang masih Submitted ({ id, note? }).
// ============================================================================
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import {
  submitRegularization, cancelOwnRegularization, myRegularizations, RegError,
  REG_MAX_BACKDATE_DAYS,
} from "@/rekankerja/time-attendance/services/regularization-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const res = await myRegularizations(db, employeeId);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName, appUserId, platformUserId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const attachmentIds: string[] = Array.isArray(b.attachmentIds)
      ? (b.attachmentIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];

    const res = await submitRegularization(db, {
      employeeId,
      workDate: String(b.workDate ?? ""),
      kind: String(b.kind ?? ""),
      clockIn: b.clockIn != null ? String(b.clockIn) : undefined,
      clockOut: b.clockOut != null ? String(b.clockOut) : undefined,
      reason: String(b.reason ?? ""),
      attachmentIds,
      actorName: fullName,
      actorAppUserId: appUserId,
      actorEmployeeId: employeeId,
    });

    // notifikasi in-app approver jenjang pertama (fire-and-forget — pola ess/leave).
    void notifyEvent(db, {
      to: "nextApprover", docType: "AttendanceReg", docNo: res.docNo, docId: res.id,
      title: `Pengajuan regularisasi absensi ${res.docNo} menunggu persetujuan Anda`,
      body: `${fullName} — ${String(b.workDate ?? "-")} (${String(b.kind ?? "-")})${b.clockIn ? ` in ${String(b.clockIn)}` : ""}${b.clockOut ? ` out ${String(b.clockOut)}` : ""}`,
      kind: "attendance", link: "attendance:regularization",
    }).catch(() => { /* never */ });

    return NextResponse.json(
      { ...res, maxBackdateDays: REG_MAX_BACKDATE_DAYS },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof RegError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const res = await cancelOwnRegularization(db, {
      id: String(b.id),
      employeeId,
      note: b.note != null ? String(b.note) : undefined,
      actorName: fullName,
    });

    // informasikan admin/HR (fire-and-forget) — pengajuan ditarik pemohon.
    void notifyEvent(db, {
      to: "admins", docType: "AttendanceReg", docNo: res.docNo, docId: String(b.id),
      title: `Pengajuan regularisasi ${res.docNo} ditarik pemohon`,
      body: `${fullName} menarik pengajuan regularisasi absensinya${b.note ? ` — catatan: ${String(b.note)}` : ""}`,
      kind: "attendance", link: "attendance:regularization",
    }).catch(() => { /* never */ });

    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof RegError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
