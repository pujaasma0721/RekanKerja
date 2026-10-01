// GET /api/rekankerja/ess/leave + POST ajukan cuti (kontrak T8-ESS-FRONTEND).
// POST me-reuse leave-service submitRequest (validasi identik jalur admin:
// saldo, bentrok, backdate guard, maks per permintaan, waiting period).
import { NextResponse } from "next/server";
import { requireEss, fmtIsoDate } from "@/rekankerja/ess/api/ess-auth";
import { listBalances, listRequests, submitRequest, FEMALE_ONLY_LEAVE } from "@/rekankerja/leave/services/leave-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";

// GET — saldo cuti tahun berjalan + riwayat permintaan saya.
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const year = new Date().getFullYear();
    const [balances, requests, me] = await Promise.all([
      listBalances(db, { employeeId, year }),
      listRequests(db, { employeeId, limit: 50 }),
      // Task 52-a — jenis cuti khusus perempuan disembunyikan dari pekerja laki-laki.
      db.employee.findUnique({ where: { id: employeeId }, select: { gender: true } }),
    ]);
    const visible = balances.filter(
      (b) => me?.gender === "F" || !FEMALE_ONLY_LEAVE.has(b.leaveTypeCode),
    );
    // Task 52-a — jenis cuti EVENT aktif (nikah/melahirkan/haids… — tanpa
    // prorata/carry/cashable/anniversary) tetap tampil meski belum ada baris
    // saldo: saldo dibuat otomatis saat pengajuan (ensureBalance) dan hak
    // event tidak bergantung baris tahunan. Jenis perempuan-only tetap
    // disembunyikan dari pekerja laki-laki.
    const haveIds = new Set(visible.map((b) => b.leaveTypeId));
    const activeTypes = await db.leaveType.findMany({ where: { active: true } });
    const female = me?.gender === "F";
    const synth = activeTypes
      .filter(
        (t) =>
          !haveIds.has(t.id) &&
          !t.prorateMonthly &&
          !(t.carryOverMax > 0) &&
          !t.cashable &&
          t.periodMode !== "ANNIVERSARY" &&
          (female || !FEMALE_ONLY_LEAVE.has(t.code)),
      )
      .map((t) => ({
        typeId: t.id,
        code: t.code,
        name: t.name,
        unit: t.unit,
        entitlement: t.entitlement,
        taken: 0,
        applied: 0,
        available: t.entitlement,
      }));

    return NextResponse.json({
      balances: [...visible.map((b) => ({
        typeId: b.leaveTypeId,
        code: b.leaveTypeCode,
        name: b.leaveTypeName,
        unit: b.unit,
        entitlement: b.entitlement,
        taken: b.taken,
        applied: b.applied,
        available: b.remaining,
      })), ...synth],
      requests: requests.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        typeName: r.leaveTypeName,
        dateFrom: fmtIsoDate(r.dateFrom),
        dateTo: fmtIsoDate(r.dateTo),
        days: r.workingDays,
        status: r.status,
        approval:
          r.approval && r.approval.status === "InProgress"
            ? {
                level: r.approval.currentLevel,
                total: r.approval.totalLevels,
                currentApproverName: r.approval.currentApprover,
              }
            : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan cuti untuk DIRI SENDIRI.
// Body: { typeId, dateFrom, dateTo, halfDay?, reason }
// halfDay=true → sesi akhir AM (setengah hari terakhir; satu tanggal = setengah hari).
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const typeId = String(b.typeId ?? "");
    const dateFrom = String(b.dateFrom ?? "");
    const dateTo = String(b.dateTo ?? "");
    const reason = String(b.reason ?? "");
    const halfDay = b.halfDay === true;

    if (!typeId) return NextResponse.json({ error: "Jenis cuti wajib dipilih" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return NextResponse.json({ error: "Tanggal mulai/selesai wajib format YYYY-MM-DD" }, { status: 400 });
    }
    if (!reason.trim()) return NextResponse.json({ error: "Alasan cuti wajib diisi" }, { status: 400 });

    const res = await submitRequest(db, {
      employeeId,
      leaveTypeId: typeId,
      dateFrom,
      sessionFrom: "AM",
      dateTo,
      sessionTo: halfDay ? "AM" : "PM",
      reason,
      source: "ESS",
      // Fix audit 40 §5 minor#2 — identitas pengaju ESS (AppUser→Employee.fullName
      // dari sesi requireEss) diteruskan sebagai actorName → chain.createdBy +
      // ActivityLog submit mencatat aktor NYATA (parity jalur admin
      // leave/api/requests.ts POST yang mempassing m.actor.name).
      actorName: fullName,
    });

    // Fix audit 40 §5 minor#2 — paritas jalur admin: approver jenjang PERTAMA
    // dinotifikasi in-app saat cuti diajukan dari ESS (sebelumnya hanya webhook
    // leave.submitted — approver tidak menerima notifikasi sama sekali). Link ke
    // Persetujuan modul leave, bukan "actions:inbox" yang PA-only (audit M-8).
    void (async () => {
      try {
        const type = await db.leaveType.findUnique({ where: { id: typeId }, select: { name: true } });
        // Task 64m-b — paritas EMAIL dgn jalur admin (leave/api/requests.ts):
        // submit dari ESS kini juga mengirim email ke approver (Task 34).
        // Sebelumnya ESS hanya in-app + webhook → approver tanpa email.
        notifyEmailEvent(db, {
          event: "leave.submitted",
          to: await approverEmailsOf(db, employeeId),
          data: {
            nama: fullName, docNo: res.docNo, jenisCuti: type?.name ?? "-",
            periode: `${dateFrom} → ${dateTo}`, jumlahHari: String(res.workingDays),
            alasan: reason || "-",
          },
        });
        await notifyEvent(db, {
          to: "nextApprover", docType: "Leave", docNo: res.docNo,
          title: `Pengajuan cuti ${res.docNo} menunggu persetujuan Anda`,
          body: `${fullName} — ${type?.name ?? "cuti"} ${dateFrom} → ${dateTo} (${res.workingDays} hari kerja)`,
          kind: "leave", link: "leave:leave-approval",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama ESS */ }
    })();

    // G5: ESS leave juga memicu webhook leave.submitted (konsistensi event lintas jalur)
    void dispatchWebhookEvent(db, null, "leave.submitted", {
      docNo: res.docNo, employeeId, dateFrom, dateTo, reason, source: "ESS",
    });
    return NextResponse.json({ docNo: res.docNo, status: "Submitted" }, { status: 201 });
  } catch (e) {
    // validasi bisnis leave-service (saldo/bentrok/backdate/maks) → 400 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
