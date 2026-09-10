import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { nextRunNo, calculateAndSaveRun, confirmRun } from "@/onevity/payroll/services/payroll-service";
import { notifyEmailEvent, approverEmailsOf, sendPayslipEmail } from "@/onevity/shared/services/email-service";
import { sendWa } from "@/onevity/shared/services/wa-service";
import { notifyEvent } from "@/onevity/shared/services/notification-service";
import { dispatchWebhookEvent } from "@/onevity/shared/services/webhook-service";
import { buildPayslipPdfByLineId, fmtRupiah } from "@/onevity/payroll/services/payslip-pdf";

// GET /api/onevity/payroll-runs?periodId=&status=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const periodId = req.nextUrl.searchParams.get("periodId");
    const status = req.nextUrl.searchParams.get("status");
    const runs = await db.payrollRun.findMany({
      where: {
        ...(periodId ? { periodId } : {}),
        ...(status && status !== "all" ? { status } : {}),
      },
      include: {
        period: true,
        processType: true,
        _count: { select: { lines: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    // 28-c: dekripsi total uang run di batas serializer (angka utk frontend).
    return NextResponse.json({ runs: tenantCryptoForDb(db).decryptJson(runs) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/payroll-runs — buat run baru (Draft)
//       ATAU aksi `send-slips` { runId | id } — kirim slip gaji PDF massal (T10).
// Task 32-d: guard hak AKSI menu — create pada payroll:runs (per pengguna);
// send-slips memakai op:export (Mengekspor slip & hasil) — sebangun unduh slip.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "send-slips") {
      const m = await requireMenuAction(req, "payroll:runs", "op:export");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      return handleSendSlips(m.db, m.actor, b.runId ?? b.id);
    }
    const m = await requireMenuAction(req, "payroll:runs", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    if (!b.periodId || !b.processTypeId) {
      return NextResponse.json({ error: "Period & jenis proses wajib dipilih" }, { status: 400 });
    }
    const period = await db.payrollPeriod.findUnique({ where: { id: b.periodId } });
    if (!period) return NextResponse.json({ error: "Period tidak ditemukan" }, { status: 404 });
    if (period.status === "Closed" || period.status === "Locked") {
      return NextResponse.json({ error: `Period ${period.name} sudah ${period.status === "Closed" ? "ditutup" : "terkunci"}` }, { status: 400 });
    }
    const processType = await db.processType.findUnique({ where: { id: b.processTypeId } });
    if (!processType) return NextResponse.json({ error: "Jenis proses tidak ditemukan" }, { status: 404 });

    // M-20 (audit 42): cegah run ganda — period+type aktif (Draft/Calculated/
    // Confirmed/Paid). Pre-check friendly 409 (pesan utk user); jaring pengaman
    // terakhir tetap partial unique index DB "uniq_payrollrun_active"
    // (scripts/migrate-task43-indexes.ts) yang menutup race dua POST paralel —
    // konflik DB dipetakan ke 409 di catch create di bawah.
    const existing = await db.payrollRun.findFirst({
      where: { periodId: b.periodId, processTypeId: b.processTypeId, status: { not: "Cancelled" } },
    });
    if (existing) {
      return NextResponse.json(
        {
          error:
            `Run aktif untuk period+jenis sudah ada: run ${existing.runNo} (${existing.status}) ` +
            `untuk ${period.name} × ${processType.name} — batalkan run tersebut lebih dulu bila ingin membuat ulang`,
        },
        { status: 409 }
      );
    }

    const runNo = await nextRunNo(db, period.code, processType.code);
    let run;
    try {
      run = await db.payrollRun.create({
        data: {
          runNo,
          periodId: b.periodId,
          processTypeId: b.processTypeId,
          calculateTax: b.calculateTax ?? processType.calculateTax,
          allEmployee: b.allEmployee ?? true,
          notes: b.notes ?? null,
        },
        include: { period: true, processType: true },
      });
    } catch (e) {
      // P2002 = pelanggaran unique (race paralel lewat pre-check — uniq_payrollrun_active)
      if (e instanceof Error && /P2002|unique/i.test(e.message)) {
        return NextResponse.json(
          { error: `Run aktif untuk period+jenis sudah ada (${period.name} × ${processType.name}) — konflik terdeteksi, muat ulang daftar run` },
          { status: 409 }
        );
      }
      throw e;
    }
    await db.activityLog.create({ data: { action: "Created", entity: "PayrollRun", entityId: run.id, detail: `Run payroll ${runNo} dibuat (${period.name} × ${processType.name})` } });
    return NextResponse.json({ run }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/payroll-runs — action: calculate | confirm | markPaid |
//       cancel | send-slips  { id | runId }
// Task 32-d: guard hak AKSI menu per pengguna — op:calculate / op:confirm /
// op:markPaid / op:cancel pada payroll:runs; send-slips → op:export (T10).
// Body dibaca SEKALI sebelum guard (aksi menentukan op menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!(b.id || b.runId) || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    if (!["calculate", "confirm", "markPaid", "cancel", "send-slips"].includes(b.action)) {
      return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
    const m = b.action === "calculate"
      ? await requireMenuAction(req, "payroll:runs", "op:calculate")
      : b.action === "confirm"
        ? await requireMenuAction(req, "payroll:runs", "op:confirm")
        : b.action === "markPaid"
          ? await requireMenuAction(req, "payroll:runs", "op:markPaid")
          : b.action === "send-slips"
            ? await requireMenuAction(req, "payroll:runs", "op:export")
            : await requireMenuAction(req, "payroll:runs", "op:cancel");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const runId = b.id ?? b.runId;
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    switch (b.action) {
      case "calculate": {
        const result = await calculateAndSaveRun(db, runId);
        return NextResponse.json({
          ok: true,
          summary: {
            employees: result.lines.length,
            totalBruto: result.totalBruto,
            totalDeduction: result.totalDeduction,
            totalTax: result.totalTax,
            totalNet: result.totalNet,
          },
        });
      }
      case "confirm": {
        await confirmRun(db, b.id);
        // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
        void (async () => {
          try {
            const fresh = await db.payrollRun.findUnique({
              where: { id: b.id },
              select: { runNo: true, period: { select: { name: true } }, _count: { select: { lines: true } } },
            });
            notifyEmailEvent(db, {
              event: "payroll.run.confirmed",
              to: await approverEmailsOf(db),
              data: {
                runNo: fresh?.runNo ?? "-", periode: fresh?.period?.name ?? "-",
                jumlah: String(fresh?._count?.lines ?? 0), total: "-",
              },
            });
            // ===== Notifikasi in-app (T11-NOTIF) — "Run {no} Confirmed" ke
            // semua AppUser Admin/HR aktif (maks 5) =====
            if (fresh) {
              await notifyEvent(db, {
                to: "admins", docType: "PayrollRun", docNo: fresh.runNo,
                title: `Run ${fresh.runNo} Confirmed`,
                body: `Run payroll periode ${fresh.period?.name ?? "-"} (${fresh._count?.lines ?? 0} karyawan) dikonfirmasi — jurnal terpasang, siap ditandai dibayar.`,
                kind: "payroll", link: "payroll:runs",
              });
            }
            // ===== Webhook (T18-API) — payroll.confirmed, fire-and-forget =====
            await dispatchWebhookEvent(db, null, "payroll.confirmed", {
              runId: String(b.id), runNo: fresh?.runNo ?? null,
              period: fresh?.period?.name ?? null,
              employees: fresh?._count?.lines ?? 0,
              status: "Confirmed", confirmedBy: m.actor.name,
            });
          } catch { /* never */ }
        })();
        return NextResponse.json({ ok: true });
      }
      case "markPaid": {
        if (run.status !== "Confirmed") {
          return NextResponse.json({ error: "Run harus Confirmed sebelum ditandai dibayar" }, { status: 400 });
        }
        await db.payrollRun.update({ where: { id: b.id }, data: { status: "Paid", paidAt: new Date() } });
        await db.activityLog.create({ data: { action: "Updated", entity: "PayrollRun", entityId: b.id, appUserId: actor.appUserId ?? undefined, detail: `Run ${run.runNo} ditandai DIBAYAR` } });
        // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
        void (async () => {
          try {
            notifyEmailEvent(db, {
              event: "payroll.run.paid",
              to: await approverEmailsOf(db),
              data: { runNo: run.runNo, periode: "-", total: "-" },
            });
          } catch { /* never */ }
        })();
        // ===== Notifikasi in-app (T11-NOTIF) — "Run {no} Paid" ke semua
        // AppUser Admin/HR aktif (maks 5) =====
        void (async () => {
          const fresh = await db.payrollRun
            .findUnique({
              where: { id: b.id },
              select: { period: { select: { name: true } }, _count: { select: { lines: true } } },
            })
            .catch(() => null);
          await notifyEvent(db, {
            to: "admins", docType: "PayrollRun", docNo: run.runNo,
            title: `Run ${run.runNo} Paid`,
            body: `Run payroll periode ${fresh?.period?.name ?? "-"} (${fresh?._count?.lines ?? 0} karyawan) ditandai DIBAYAR.`,
            kind: "payroll", link: "payroll:runs",
          });
          // ===== Webhook (T18-API) — payroll.paid, fire-and-forget =====
          await dispatchWebhookEvent(db, null, "payroll.paid", {
            runId: String(b.id), runNo: run.runNo,
            period: fresh?.period?.name ?? null,
            employees: fresh?._count?.lines ?? 0,
            status: "Paid", paidAt: new Date().toISOString(), markedPaidBy: m.actor.name,
          });
        })();
        return NextResponse.json({ ok: true });
      }
      case "cancel": {
        if (run.status === "Paid") return NextResponse.json({ error: "Run yang sudah dibayar tidak bisa dibatalkan" }, { status: 400 });
        // K-2 (KRITIS): konfirmasi run sudah mengeksekusi efek samping yang tidak
        // dibalikkan oleh cancel — jurnal Posted + mutasi saldo COA, cicilan
        // pinjaman → Deducted, klaim/lembur/encashment/travel/medical → Paid,
        // period → Processed. Menerima cancel = jurnal & potongan dobel saat run
        // dibuat ulang. Reversi penuh harus dilakukan manual oleh admin.
        if (run.status === "Confirmed") {
          return NextResponse.json(
            { error: "Run sudah dikonfirmasi — jurnal/cicilan terpasang; buat run koreksi/rapel, atau hubungi admin untuk reversi manual" },
            { status: 409 }
          );
        }
        await db.payrollRun.update({ where: { id: runId }, data: { status: "Cancelled" } });
        await db.payrollRunLine.deleteMany({ where: { runId } });
        await db.activityLog.create({ data: { action: "Cancelled", entity: "PayrollRun", entityId: runId, appUserId: actor.appUserId ?? undefined, detail: `Run ${run.runNo} dibatalkan` } });
        return NextResponse.json({ ok: true });
      }
      case "send-slips": {
        return handleSendSlips(db, actor, run.id, b.slipPassword);
      }
      default:
        return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ---- aksi send-slips (T10-PAYSLIP-PDF) --------------------------------
// Kirim email slip gaji (lampiran PDF) ke TIAP karyawan line run berstatus
// Confirmed/Paid. Email karyawan kosong → skip + log EmailLog (Skipped).
// Ringkasan hasil + ActivityLog "Slip terkirim {n} karyawan".
// 26-b P0 — slipPassword=true: PDF dienkripsi AES-256, userPassword = NIK
// karyawan (fallback employeeNo) — kirim massal slip tanpa risiko dibaca
// pihak lain di mailbox; flag dipersist ke run untuk kirim berikutnya.
async function handleSendSlips(
  db: TenantDb,
  actor: { appUserId: string | null; name: string },
  runId: unknown,
  slipPassword?: unknown,
): Promise<NextResponse> {
  const id = typeof runId === "string" ? runId : "";
  if (!id) return NextResponse.json({ error: "runId wajib" }, { status: 400 });
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: { period: { select: { name: true } }, processType: { select: { name: true } } },
  });
  if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
  if (run.status !== "Confirmed" && run.status !== "Paid") {
    return NextResponse.json(
      { error: "Slip hanya bisa dikirim untuk run Confirmed/Paid" },
      { status: 400 }
    );
  }

  // persist preferensi proteksi pada run (default: nilai tersimpan / false)
  const protect = slipPassword === true || (slipPassword === undefined && run.slipPassword);
  if (protect !== run.slipPassword) {
    await db.payrollRun.update({ where: { id }, data: { slipPassword: protect } });
  }

  const lines = await db.payrollRunLine.findMany({
    where: { runId: id },
    orderBy: { employeeNo: "asc" },
    select: { id: true, employeeId: true, employeeNo: true, employeeName: true, net: true, employee: { select: { email: true, nationalId: true, phone: true } } },
  });
  if (lines.length === 0) {
    return NextResponse.json({ error: "Run tidak memiliki baris hasil" }, { status: 400 });
  }

  // 28-c: net + NIK tersimpan terenkripsi — dekripsi utk email & kata sandi slip
  // (password slip = NIK karyawan; nilai TERDEKRIPSI tidak pernah masuk log).
  const tc = tenantCryptoForDb(db);
  const linesDec = lines.map((l) => ({
    ...l,
    net: tc.decryptMoney(l.net) ?? 0,
    employeeNik: tc.decryptText(l.employee?.nationalId),
  }));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let disabled = 0;
  // M-18 (audit 42) — kirim massal TIDAK LAGI STRICTLY-SERIAL per karyawan
  // (500 karyawan × [build PDF + SMTP] di satu request HTTP → menit-menit →
  // gateway timeout tanpa umpan balik parsial). Fix pragmatis TAHAP 1 (tanpa
  // mengubah semantik/shape respons):
  //   1. PARALEL per BATCH 10 baris (Promise.all per slice, slice berurutan) —
  //      build PDF (CPU-ish, pdf-lib murni JS) + SMTP (IO) aman dijalankan
  //      10-sekaligus; pool koneksi Prisma per-tenant (limit 3) mengantrekan
  //      kueri sisanya.
  //   2. TIMEOUT per kirim 25 detik (Promise.race) → SMTP yang menggantung
  //      dihitung "failed" dan TIDAK memblokir sisa batch.
  //   3. Kegagalan build PDF tetap dihitung "skipped" (perilaku lama).
  // Counter (sent/skipped/failed/disabled) increment konkuren aman (JS
  // single-threaded); ActivityLog & respons { ok, total, sent, skipped,
  // failed, disabled, protected } TIDAK berubah.
  //
  // ==== TAHAP 2 (DEFERRED — Task 44): desain queue penuh ====
  // Arsitektur target: tabel job (PayrollEmailJob) + worker background
  // (PM2/scheduler) yang mengirim per batch dgn retry + backoff, progres
  // dipolling frontend (bar "120/500 terkirim"), dan request HTTP hanya
  // MENGANTRE job (respons instan { queued: n }). Termasuk: resume job
  // terputus, dedupe per run, dan penguncian advisory per run. Menunggu
  // migrasi schema — jangan implement di fix batch ini.
  const SEND_SLIP_BATCH = 10;
  const SEND_SLIP_TIMEOUT_MS = 25_000;
  for (let i = 0; i < linesDec.length; i += SEND_SLIP_BATCH) {
    const batch = linesDec.slice(i, i + SEND_SLIP_BATCH);
    await Promise.all(batch.map(async (line) => {
      // 26-b — kata sandi slip = NIK (fallback employeeNo), hanya saat proteksi aktif
      const slipPwd = protect ? (line.employeeNik?.trim() || line.employeeNo) : null;
      const built = await buildPayslipPdfByLineId(db, line.id, { password: slipPwd });
      if (!built) { skipped += 1; return; }
      const sendTask = sendPayslipEmail(db, {
        to: { email: line.employee?.email ?? "", name: line.employeeName },
        data: {
          nama: line.employeeName,
          periode: run.period.name,
          net: fmtRupiah(line.net),
          runNo: run.runNo,
        },
        attachment: { filename: built.filename, content: Buffer.from(built.bytes), contentType: "application/pdf" },
      });
      // M-18: race 25s — SMTP lambat/hang dihitung failed; promise yang
      // kalah tetap berjalan (EmailLog-nya tetap tercatat belakangan) dan
      // rejection-nya di-swallow supaya tidak jadi unhandled rejection.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"Timeout">((resolve) => {
        timer = setTimeout(() => resolve("Timeout"), SEND_SLIP_TIMEOUT_MS);
      });
      let status: Awaited<ReturnType<typeof sendPayslipEmail>> | "Timeout";
      try {
        status = await Promise.race([sendTask, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      sendTask.catch(() => undefined); // kalah race & reject belakangan → swallow
      if (status === "Sent") {
        sent += 1;
        // Task 28-a — notifikasi WhatsApp "slip terkirim" (fire-and-forget,
        // never-throw) — hanya saat email benar-benar terkirim (pesan template
        // menyebut pengiriman email).
        void sendWa(db, {
          event: "payslip.sent",
          toPhone: line.employee?.phone ?? null,
          placeholders: { nama: line.employeeName, periode: run.period.name, net: fmtRupiah(line.net), runNo: run.runNo },
        });
      }
      else if (status === "Failed" || status === "Timeout") failed += 1;
      else if (status === "Disabled") disabled += 1;
      else skipped += 1;
    }));
  }

  await db.activityLog.create({
    data: {
      action: "Updated",
      entity: "PayrollRun",
      entityId: run.id,
      appUserId: actor.appUserId ?? undefined,
      detail: `Slip terkirim ${sent} karyawan (run ${run.runNo} · ${run.period.name}) oleh ${actor.name}${protect ? " — PDF berpassword (sandi NIK karyawan)" : ""}; ${skipped} dilewati, ${failed} gagal`,
    },
  });

  return NextResponse.json({ ok: true, total: lines.length, sent, skipped, failed, disabled, protected: protect });
}

// DELETE /api/onevity/payroll-runs?id= — hanya Draft/Calculated
// Task 32-d: guard hak AKSI menu — delete pada payroll:runs (per pengguna).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:runs", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status === "Confirmed" || run.status === "Paid") {
      return NextResponse.json({ error: "Run yang sudah dikonfirmasi/dibayar tidak dapat dihapus" }, { status: 400 });
    }
    await db.payrollRun.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "PayrollRun", entityId: id, detail: `Run ${run.runNo} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
