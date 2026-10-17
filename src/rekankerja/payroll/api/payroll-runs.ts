import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { nextRunNo, calculateAndSaveRun, confirmRun, recalcEmployeesForConfirmedRun, findRunConfirmStructure, startRunConfirmChain } from "@/rekankerja/payroll/services/payroll-service";
// P1.4-BM (D-BM8) — approval chain finalisasi run payroll.
import {
  getApprovalChain,
  decideApprovalChain,
  cancelApprovalChain,
  DecisionConflictError,
  DecisionForbiddenError,
} from "@/rekankerja/shared/services/approval-engine";
import { notifyEmailEvent, approverEmailsOf, sendPayslipEmail } from "@/rekankerja/shared/services/email-service";
import { sendWa } from "@/rekankerja/shared/services/wa-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import { buildPayslipPdfByLineId, fmtRupiah } from "@/rekankerja/payroll/services/payslip-pdf";

// GET /api/rekankerja/payroll-runs?periodId=&status=
export async function GET(req: NextRequest) {
  try {
    // AUD-DEPLOY (2-a HIGH-3): guard menu — sebelumnya requireTenant saja.
    const m = await requireMenuViewAny(req, ["payroll:runs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const periodId = req.nextUrl.searchParams.get("periodId");
    const status = req.nextUrl.searchParams.get("status");

    // Task 75 — sorting server-side (whitelist; kolom relasi via orderBy nested).
    // Default tetap createdAt desc (run terbaru dulu).
    const RUN_SORT = new Set(["runNo", "period", "type", "status", "employees", "bruto", "tax", "net", "createdAt"]);
    const sortByParam = req.nextUrl.searchParams.get("sortBy") ?? "";
    const sortDirParam = req.nextUrl.searchParams.get("sortDir") === "desc" ? "desc" : "asc";
    const dir = sortDirParam;
    let orderBy: Record<string, unknown>[] = [{ createdAt: "desc" }];
    if (RUN_SORT.has(sortByParam)) {
      switch (sortByParam) {
        case "period": orderBy = [{ period: { startDate: dir } }]; break;
        case "type": orderBy = [{ processType: { name: dir } }]; break;
        case "employees": orderBy = [{ lines: { _count: dir } }]; break;
        // total uang terenkripsi — tak bisa diurut DB; sort in-memory setelah decrypt
        case "bruto": case "tax": case "net": orderBy = [{ createdAt: "desc" }]; break;
        default: orderBy = [{ [sortByParam]: dir }, { createdAt: "desc" }];
      }
    }
    const needsMoneySort = sortByParam === "bruto" || sortByParam === "tax" || sortByParam === "net";

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
      orderBy,
    });
    // 28-c: dekripsi total uang run di batas serializer (angka utk frontend).
    // 45-b: gate vault (requireTenant → resolve via sesi; masked → null).
    const dec = (await moneyViewForReq(req, db)).json(runs) as (typeof runs);

    // Task 75 — sort kolom uang (in-memory atas nilai terdekripsi; masked → 0 paling bawah)
    if (needsMoneySort) {
      const moneyKey = (r: (typeof runs)[number]): number =>
        sortByParam === "bruto" ? Number(r.totalBruto) || 0
        : sortByParam === "tax" ? Number(r.totalTax) || 0
        : Number(r.totalNet) || 0;
      const cmpDir = sortDirParam === "desc" ? -1 : 1;
      dec.sort((x, y) => (moneyKey(x) - moneyKey(y)) * cmpDir
        || (x.runNo < y.runNo ? -1 : x.runNo > y.runNo ? 1 : 0));
    }
    return NextResponse.json({ runs: dec });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/payroll-runs — buat run baru (Draft)
//       ATAU aksi `send-slips` { runId | id } — kirim slip gaji PDF massal (T10).
// Task 32-d: guard hak AKSI menu — create pada payroll:runs (per pengguna);
// send-slips memakai op:export (Mengekspor slip & hasil) — sebangun unduh slip.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "send-slips") {
      const m = await requireMenuAction(req, "payroll:runs", "op:export");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      return handleSendSlips(req, m.db, m.actor, b.runId ?? b.id);
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

// PATCH /api/rekankerja/payroll-runs — action: calculate | confirm | confirmApprove |
//       confirmReject | markPaid | cancel | send-slips | recalcEmployees  { id | runId }
// Task 32-d: guard hak AKSI menu per pengguna — op:calculate / op:confirm /
// op:markPaid / op:cancel pada payroll:runs; send-slips → op:export (T10).
// Task 64j: recalcEmployees (hitung ulang parsial run Confirmed) → op:calculate
// (membutuhkan hak menghitung; hasil kembali ke status Calculated).
// P1.4-BM (D-BM8): confirmApprove/confirmReject → op:confirm (memutus jalur
// persetujuan finalisasi memakai hak finalisasi yang sama).
// Body dibaca SEKALI sebelum guard (aksi menentukan op menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!(b.id || b.runId) || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    if (!["calculate", "confirm", "confirmApprove", "confirmReject", "markPaid", "cancel", "send-slips", "recalcEmployees"].includes(b.action)) {
      return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
    const m = b.action === "calculate" || b.action === "recalcEmployees"
      ? await requireMenuAction(req, "payroll:runs", "op:calculate")
      : b.action === "confirm" || b.action === "confirmApprove" || b.action === "confirmReject"
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
        // Task 63 — ringkasan log kejadian langsung di response calculate
        // (UI menampilkan notifikasi + tab Log di detail run memuat detail).
        const logCounts = await db.payrollRunLog.groupBy({
          by: ["level"],
          _count: { _all: true },
          where: { runId },
        });
        const lc = Object.fromEntries(logCounts.map((c) => [c.level, c._count._all]));
        return NextResponse.json({
          ok: true,
          summary: {
            employees: result.lines.length,
            totalBruto: result.totalBruto,
            totalDeduction: result.totalDeduction,
            totalTax: result.totalTax,
            totalNet: result.totalNet,
          },
          logCounts: {
            error: lc["error"] ?? 0,
            warning: lc["warning"] ?? 0,
            info: lc["info"] ?? 0,
          },
        });
      }
      case "confirm": {
        // ===== P1.4-BM (D-BM8) — approval chain finalisasi (opsional per tenant).
        // Struktur AKTIF docType "PayrollRunConfirm" ada → "confirm" = MENYERAHKAN
        // run ke persetujuan berjenjang (status PendingConfirm), BUKAN langsung
        // mengeksekusi confirmRun. Tanpa struktur → jalur lama 1-klik di bawah
        // (backward-compat — default OFF).
        if (await findRunConfirmStructure(db)) {
          // RACE-SAFE: re-check status sebelum mutasi — hanya Calculated.
          if (run.status !== "Calculated") {
            return NextResponse.json(
              { error: `Run berstatus ${run.status} — hanya run Terhitung (Calculated) yang dapat diserahkan ke persetujuan finalisasi` },
              { status: 409 },
            );
          }
          // chain terminal lama (Rejected/Cancelled dari pengajuan sebelumnya)
          // → bersihkan supaya pengajuan ulang membentuk chain baru (pola merit;
          // jejak keputusan lama tetap ter-audit di ActivityLog + note step).
          const prevChain = await getApprovalChain(db, "PayrollRunConfirm", runId);
          if (prevChain && (prevChain.status === "Rejected" || prevChain.status === "Cancelled")) {
            await db.approvalChain.delete({ where: { docType_docId: { docType: "PayrollRunConfirm", docId: runId } } });
          }
          const chain = await startRunConfirmChain(db, { id: run.id, runNo: run.runNo }, {
            employeeId: actor.employeeId,
            appUserId: actor.appUserId,
            name: actor.name,
          });
          // flip status KONDISIONAL — dua klik confirm paralel hanya satu menang.
          const upd = await db.payrollRun.updateMany({
            where: { id: runId, status: "Calculated" },
            data: { status: "PendingConfirm" },
          });
          if (upd.count !== 1) {
            // kalah race — chain yang baru terbentuk dibatalkan agar tidak menggantung.
            if (chain.status === "InProgress") await cancelApprovalChain(db, "PayrollRunConfirm", runId);
            return NextResponse.json({ error: "Run sudah diproses permintaan lain — muat ulang daftar run" }, { status: 409 });
          }
          const firstApprover = chain.steps.find((s) => s.status === "Current")?.approverLabel ?? "-";
          await db.activityLog.create({
            data: {
              action: "Updated", entity: "PayrollRun", entityId: runId, appUserId: actor.appUserId ?? undefined,
              detail: `Run ${run.runNo} diserahkan ke persetujuan finalisasi (${chain.totalLevels} jenjang — menunggu: ${firstApprover}) oleh ${actor.name}`,
            },
          });
          // Notifikasi in-app approver jenjang aktif (NEVER-THROW). Template email
          // default TIDAK ada utk event ini → in-app saja (kebijakan D-BM8).
          void notifyEvent(db, {
            to: "nextApprover", docType: "PayrollRunConfirm", docNo: run.runNo, docId: runId,
            title: `Persetujuan Finalisasi Run ${run.runNo}`,
            body: `Run payroll periode ${run.period?.name ?? "-"} menunggu persetujuan finalisasi Anda (jenjang ${chain.currentLevel}/${chain.totalLevels}).`,
            kind: "payroll", link: "payroll:runs",
          });
          return NextResponse.json({ ok: true, status: "PendingConfirm", chain });
        }
        await confirmRun(db, b.id);
        // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
        firePostConfirmNotifications(db, m.actor.name, String(b.id));
        return NextResponse.json({ ok: true });
      }
      // P1.4-BM (D-BM8) — approver menyetujui SATU jenjang chain finalisasi;
      // jenjang terakhir (final) mengeksekusi confirmRun jalur lama.
      case "confirmApprove": {
        if (run.status !== "PendingConfirm") {
          return NextResponse.json(
            { error: `Run berstatus ${run.status} — persetujuan finalisasi hanya untuk run yang menunggu (PendingConfirm)` },
            { status: 409 },
          );
        }
        let decision;
        try {
          decision = await decideApprovalChain(db, {
            docType: "PayrollRunConfirm", docId: runId, action: "approve",
            note: typeof b.note === "string" && b.note.trim() ? b.note.trim() : undefined,
            actor: { role: actor.role, employeeId: actor.employeeId, name: actor.name, appUserId: actor.appUserId },
          });
        } catch (e) {
          if (e instanceof DecisionConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
          if (e instanceof DecisionForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
          throw e;
        }
        const approvedLevel = decision.final ? decision.chain.totalLevels : decision.chain.currentLevel - 1;
        await db.activityLog.create({
          data: {
            action: "Updated", entity: "PayrollRun", entityId: runId, appUserId: actor.appUserId ?? undefined,
            detail: `Persetujuan finalisasi jenjang ${approvedLevel}/${decision.chain.totalLevels} run ${run.runNo} oleh ${actor.name}${decision.final ? " — SEMUA jenjang selesai" : ""}`,
          },
        });
        if (!decision.final) {
          // jenjang berikutnya aktif → notif approver baru (in-app, NEVER-THROW).
          void notifyEvent(db, {
            to: "nextApprover", docType: "PayrollRunConfirm", docNo: run.runNo, docId: runId,
            title: `Persetujuan Finalisasi Run ${run.runNo}`,
            body: `Run payroll periode ${run.period?.name ?? "-"} menunggu persetujuan finalisasi Anda (jenjang ${decision.chain.currentLevel}/${decision.chain.totalLevels}).`,
            kind: "payroll", link: "payroll:runs",
          });
          return NextResponse.json({ ok: true, final: false, chain: decision.chain });
        }
        // FINAL — jalankan confirmRun (guard service menerima dari PendingConfirm;
        // run yang berubah status di celah race → error status jelas dari service).
        await confirmRun(db, runId);
        // Mirror notifikasi pasca-konfirmasi jalur lama (email + in-app + webhook).
        firePostConfirmNotifications(db, m.actor.name, runId);
        return NextResponse.json({ ok: true, final: true, chain: decision.chain });
      }
      // P1.4-BM (D-BM8) — approver menolak: run kembali ke Calculated (hasil
      // hitungan tetap utuh — bisa diperbaiki lalu diajukan ulang).
      case "confirmReject": {
        const note = typeof b.note === "string" ? b.note.trim() : "";
        if (!note) {
          return NextResponse.json({ error: "Alasan penolakan (note) wajib diisi" }, { status: 400 });
        }
        if (run.status !== "PendingConfirm") {
          return NextResponse.json(
            { error: `Run berstatus ${run.status} — penolakan finalisasi hanya untuk run yang menunggu (PendingConfirm)` },
            { status: 409 },
          );
        }
        let decision;
        try {
          decision = await decideApprovalChain(db, {
            docType: "PayrollRunConfirm", docId: runId, action: "reject", note,
            actor: { role: actor.role, employeeId: actor.employeeId, name: actor.name, appUserId: actor.appUserId },
          });
        } catch (e) {
          if (e instanceof DecisionConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
          if (e instanceof DecisionForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
          throw e;
        }
        // balikkan status run → Calculated (KONDISIONAL — race terhadap cancel
        // paralel; kalah race → run sudah Cancelled, dilaporkan apa adanya).
        const upd = await db.payrollRun.updateMany({
          where: { id: runId, status: "PendingConfirm" },
          data: { status: "Calculated" },
        });
        await db.activityLog.create({
          data: {
            action: "Updated", entity: "PayrollRun", entityId: runId, appUserId: actor.appUserId ?? undefined,
            detail: `Pengajuan finalisasi run ${run.runNo} DITOLAK oleh ${actor.name} — run kembali ke status Terhitung. Alasan: ${note}`,
          },
        });
        // notif tim Admin/HR (in-app) supaya pengaju tahu pengajuan ditolak.
        void notifyEvent(db, {
          to: "admins", docType: "PayrollRunConfirm", docNo: run.runNo, docId: runId,
          title: `Finalisasi Run ${run.runNo} Ditolak`,
          body: `Pengajuan finalisasi run payroll ${run.runNo} ditolak — run kembali ke status Terhitung. Alasan: ${note}`,
          kind: "payroll", link: "payroll:runs",
        });
        return NextResponse.json({ ok: true, status: upd.count === 1 ? "Calculated" : run.status, chain: decision.chain });
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
        // P1.4-BM (D-BM8): run menunggu persetujuan → hentikan chain-nya dulu
        // (chain InProgress → Cancelled, jejak tetap terbaca) sebelum batalkan.
        if (run.status === "PendingConfirm") {
          await cancelApprovalChain(db, "PayrollRunConfirm", runId, actor.name);
        }
        await db.payrollRun.update({ where: { id: runId }, data: { status: "Cancelled" } });
        await db.payrollRunLine.deleteMany({ where: { runId } });
        await db.activityLog.create({ data: { action: "Cancelled", entity: "PayrollRun", entityId: runId, appUserId: actor.appUserId ?? undefined, detail: `Run ${run.runNo} dibatalkan${run.status === "PendingConfirm" ? " (beserta pengajuan persetujuan finalisasi)" : ""}` } });
        return NextResponse.json({ ok: true });
      }
      case "send-slips": {
        return handleSendSlips(req, db, actor, run.id, b.slipPassword);
      }
      // Task 64j — hitung ulang PARSIAL: hanya karyawan terpilih pada run
      // Confirmed (belum Paid). Kembalikan ringkasan + daftar skip utk UI.
      case "recalcEmployees": {
        const ids: unknown = b.employeeIds;
        if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== "string" || !x.trim())) {
          return NextResponse.json({ error: "employeeIds (array id karyawan) wajib diisi" }, { status: 400 });
        }
        const res = await recalcEmployeesForConfirmedRun(db, run.id, ids as string[], actor.name);
        return NextResponse.json({ ok: true, ...res });
      }
      default:
        return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ---- P1.4-BM (D-BM8): notifikasi pasca-konfirmasi jalur lama — dipakai -----
// ---- BERSAMA oleh confirm langsung (tanpa struktur) DAN ujung approve -----
// ---- chain finalisasi (perilaku identik: email + in-app + webhook). --------
async function firePostConfirmNotifications(db: TenantDb, actorName: string, runId: string): Promise<void> {
  try {
    const fresh = await db.payrollRun.findUnique({
      where: { id: runId },
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
      runId, runNo: fresh?.runNo ?? null,
      period: fresh?.period?.name ?? null,
      employees: fresh?._count?.lines ?? 0,
      status: "Confirmed", confirmedBy: actorName,
    });
  } catch { /* never */ }
}

// ---- aksi send-slips (T10-PAYSLIP-PDF) --------------------------------
// Kirim email slip gaji (lampiran PDF) ke TIAP karyawan line run berstatus
// Confirmed/Paid. Email karyawan kosong → skip + log EmailLog (Skipped).
// Ringkasan hasil + ActivityLog "Slip terkirim {n} karyawan".
// 26-b P0 — slipPassword=true: PDF dienkripsi AES-256, userPassword = NIK
// karyawan (fallback employeeNo) — kirim massal slip tanpa risiko dibaca
// pihak lain di mailbox; flag dipersist ke run untuk kirim berikutnya.
// 45-b: aktor penuh (userId+role) — gerbang vault utk tampilan uang (net di
// email/WA + PDF via mv; NIK utk kata sandi tetap raw — PII bukan uang).
async function handleSendSlips(
  req: NextRequest,
  db: TenantDb,
  actor: { appUserId: string | null; name: string; userId: string; role: string },
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
  // 45-b: NIK tetap jalur env (PII — bukan uang); net via mv (masked → null →
  // "—" di email/WA; kirim massal tetap berjalan — bisnis tidak putus).
  const tc = tenantCryptoForDb(db);
  const mv = await getMoneyView(db, { userId: actor.userId, membershipRole: actor.role });
  const fmtRupiahDash = (n: number | null) => (n == null ? "—" : fmtRupiah(n));
  const linesDec = lines.map((l) => ({
    ...l,
    net: mv.canSee ? (mv.dec(l.net) ?? 0) : null,
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
      const built = await buildPayslipPdfByLineId(db, line.id, mv, { password: slipPwd, esignReq: req });
      if (!built) { skipped += 1; return; }
      const sendTask = sendPayslipEmail(db, {
        to: { email: line.employee?.email ?? "", name: line.employeeName },
        data: {
          nama: line.employeeName,
          periode: run.period.name,
          net: fmtRupiahDash(line.net),
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
          placeholders: { nama: line.employeeName, periode: run.period.name, net: fmtRupiahDash(line.net), runNo: run.runNo },
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

// DELETE /api/rekankerja/payroll-runs?id= — hanya Draft/Calculated
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
