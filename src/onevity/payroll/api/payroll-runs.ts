import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { nextRunNo, calculateAndSaveRun, confirmRun } from "@/onevity/payroll/services/payroll-service";
import { notifyEmailEvent, approverEmailsOf, sendPayslipEmail } from "@/onevity/shared/services/email-service";
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
    return NextResponse.json({ runs });
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

    // Cegah run ganda: period+type aktif (Draft/Calculated/Confirmed/Paid)
    const existing = await db.payrollRun.findFirst({
      where: { periodId: b.periodId, processTypeId: b.processTypeId, status: { not: "Cancelled" } },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Run ${existing.runNo} (${existing.status}) sudah ada untuk ${period.name} × ${processType.name}` },
        { status: 400 }
      );
    }

    const runNo = await nextRunNo(db, period.code, processType.code);
    const run = await db.payrollRun.create({
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
    select: { id: true, employeeId: true, employeeNo: true, employeeName: true, net: true, employee: { select: { email: true, nationalId: true } } },
  });
  if (lines.length === 0) {
    return NextResponse.json({ error: "Run tidak memiliki baris hasil" }, { status: 400 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let disabled = 0;
  for (const line of lines) {
    // 26-b — kata sandi slip = NIK (fallback employeeNo), hanya saat proteksi aktif
    const slipPwd = protect ? (line.employee?.nationalId?.trim() || line.employeeNo) : null;
    const built = await buildPayslipPdfByLineId(db, line.id, { password: slipPwd });
    if (!built) { skipped += 1; continue; }
    const status = await sendPayslipEmail(db, {
      to: { email: line.employee?.email ?? "", name: line.employeeName },
      data: {
        nama: line.employeeName,
        periode: run.period.name,
        net: fmtRupiah(line.net),
        runNo: run.runNo,
      },
      attachment: { filename: built.filename, content: Buffer.from(built.bytes), contentType: "application/pdf" },
    });
    if (status === "Sent") sent += 1;
    else if (status === "Failed") failed += 1;
    else if (status === "Disabled") disabled += 1;
    else skipped += 1;
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
