import { NextRequest, NextResponse } from "next/server";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { attachChainSummaries, DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import { submitOvertimeOrder, decideOvertimeOrder } from "@/rekankerja/time-attendance/services/attendance-service";
import { overtimePayFor, getRule, otBasisContext, otBasisFor } from "@/rekankerja/time-attendance/services/attendance-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";

// GET /api/rekankerja/attendance/overtime?status= — daftar perintah lembur + statistik
// (padanan EmpOvertimeWrit.jsp + approval berjenjang T15-CHAIN-EXT).
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:overtime (dulu
// requireTenant: daftar lembur + estimasi upah terbaca tanpa hak LIHAT).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:overtime"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const status = req.nextUrl.searchParams.get("status");
    // Task 76 — sort server-side (whitelist; default terbaru dulu)
    const sortByParam = req.nextUrl.searchParams.get("sortBy") ?? "";
    const sortDirParam = req.nextUrl.searchParams.get("sortDir") === "desc" ? "desc" : "asc";
    const dir = sortDirParam;
    const OT_SORT: Record<string, Record<string, unknown>[]> = {
      order: [{ orderNo: dir }],
      employee: [{ employee: { fullName: dir } }],
      date: [{ overtimeDate: dir }, { orderNo: dir }],
      category: [{ dayCategory: dir }],
      plan: [{ planMinutes: dir }],
      actual: [{ actualMinutes: dir }],
      verified: [{ verifiedMinutes: dir }],
      status: [{ status: dir }],
    };
    const rule = await getRule(db);
    const orders = await db.overtimeOrder.findMany({
      where: status && status !== "all" ? { status } : {},
      include: {
        employee: {
          select: {
            employeeNo: true, fullName: true,
            assignments: { where: { validTo: null }, select: { baseSalary: true, orgUnit: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: OT_SORT[sortByParam] ?? [{ overtimeDate: "desc" }, { orderNo: "desc" }],
    });

    // AUD-OT (PP 35/2021 Ps.32): dasar upah lembur dibangun SEKALI utk semua
    // order — gaji pokok, atau pokok + tunjangan tetap bila BASE_FIXED.
    const otBasisCtx = await otBasisContext(db, [...new Set(orders.map((o) => o.employeeId))]);
    const workweekDays = rule.otWorkweekDays === 6 ? 6 : 5;

    // T15-CHAIN-EXT: ringkasan approval berjenjang per order (badge "Jenjang X/Y"
    // + approver menunggu) — satu query batch (pola workoffs).
    const chainMap = await attachChainSummaries(db, "Overtime", orders.map((o) => ({ id: o.id })));

    // 45-b: gerbang vault uang — baseSalary & estPay DISPLAY digate (masked →
    // null); perhitungan estPay tetap atas gaji RAW (konsisten rekap/transfer).
    const mv = await moneyViewForReq(req, db);
    const all = orders.map((o) => {
      // 28-c: baseSalary terenkripsi — dekripsi utk perhitungan uang lembur.
      const baseSalary = tenantCryptoForDb(db).decryptMoney(o.employee.assignments[0]?.baseSalary) ?? 0;
      // AUD-OT (Ps.32): dasar upah = pokok (BASE) / pokok + tunjangan tetap
      // (BASE_FIXED) — estimasi konsisten dgn rekap & transfer payroll.
      const otBasis = otBasisFor(otBasisCtx, baseSalary, o.employeeId);
      // fix M-7: order yang sudah disetujui tanpa bukti clock → jam efektif = verified/actual
      // (bukan plan) — konsisten dengan rekap uang; Pending menampilkan rencana (plan).
      const minutes = o.status === "Pending"
        ? o.planMinutes
        : o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes;
      const estPay = ["Approved", "Paid"].includes(o.status)
        ? overtimePayFor(otBasis, minutes, o.dayCategory, {
            roundingMinutes: rule.overtimeRoundingMinutes, minMinutes: rule.minOvertimeMinutes,
            workweekDays,
          })
        : 0;
      return {
        ...o,
        baseSalary: mv.canSee ? baseSalary : null,
        otBasis: mv.canSee ? otBasis : null,
        orgUnitName: o.employee.assignments[0]?.orgUnit?.name ?? null,
        estPay: mv.canSee ? estPay : null,
        effectiveMinutes: minutes,
        approval: chainMap.get(o.id) ?? null,
      };
    });

    const stats = {
      total: all.length,
      pending: all.filter((o) => o.status === "Pending").length,
      approved: all.filter((o) => o.status === "Approved").length,
      paid: all.filter((o) => o.status === "Paid").length,
      rejected: all.filter((o) => o.status === "Rejected").length,
      paidMinutes: all.filter((o) => o.status === "Paid").reduce((s, o) => s + o.verifiedMinutes, 0),
      // 45-b: estPay nullable saat masked — sum ?? 0 (bebas NaN).
      approvedPay: all.filter((o) => o.status === "Approved").reduce((s, o) => s + (o.estPay ?? 0), 0),
    };
    return NextResponse.json({ orders: all, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan perintah lembur (Plan). Guard VIEWER + aktor sesi.
// Task 32-d: guard hak AKSI menu — create pada attendance:overtime (per pengguna).
// T15-CHAIN-EXT: chain "Overtime" dibangun service; notifikasi submit kini
// tertuju ke approver JENJANG PERTAMA (resolusi chain), bukan fallback Admin/HR.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:overtime", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const res = await submitOvertimeOrder(m.db, {
      employeeId: String(b.employeeId ?? ""),
      overtimeDate: String(b.overtimeDate ?? ""),
      timeFrom: String(b.timeFrom ?? ""),
      timeTo: String(b.timeTo ?? ""),
      planMinutes: b.planMinutes ? Number(b.planMinutes) : undefined,
      letterNo: b.letterNo ?? null,
      reason: b.reason ?? null,
      actorName: m.actor.name,
      // AUD-OT (PP 35/2021 Ps.28): persetujuan karyawan — jalur admin wajib
      // mengonfirmasi (checkbox UI); absent/false = tolak 400.
      consentConfirmed: b.consentConfirmed !== false,
    });

    // ===== Notifikasi in-app (T11-NOTIF) + email approver (T15, pola leave) —
    // fire-and-forget; submit → approver jenjang pertama (chain resolution). =====
    const order = res.order as
      | { id: string; orderNo: string; employeeId: string; overtimeDate: Date; planMinutes: number; employee: { fullName: string } | null }
      | null;
    if (order) {
      void notifyEvent(m.db, {
        to: "nextApprover", docType: "Overtime", docNo: order.orderNo, docId: order.id,
        title: `Perintah lembur ${order.orderNo} menunggu persetujuan Anda`,
        body: `${order.employee?.fullName ?? "Karyawan"} — lembur ${new Date(order.overtimeDate).toISOString().slice(0, 10)} (rencana ${order.planMinutes} menit)`,
        // Fix audit 40 M-8 — link notifikasi approver ke view modul Lembur
        // ("actions:inbox" hanya memuat dokumen PA — approver TA tidak bisa
        // membuka dokumen lembur dari sana; "attendance:overtime" = section:view
        // valid yang dinavigasi bell).
        kind: "attendance", link: "attendance:overtime",
      });
      void (async () => {
        try {
          notifyEmailEvent(m.db, {
            event: "overtime.submitted",
            to: await approverEmailsOf(m.db, order.employeeId),
            data: {
              nama: order.employee?.fullName ?? "-", docNo: order.orderNo,
              tanggal: new Date(order.overtimeDate).toISOString().slice(0, 10),
              jumlahJam: `${Math.round(order.planMinutes / 60 * 10) / 10}`,
              alasan: b.reason ? String(b.reason) : "-",
            },
          });
        } catch { /* never */ }
      })();
    }

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — approve | reject | verify | cancel. Guard VIEWER + aktor sesi;
// approve tanggal masa depan ditolak 400 (fix M-7); approve melebihi cap
// 4 jam/hari (PP 35/2021, T15) ditolak 400.
// Task 32-d: guard hak AKSI menu — op:approve pada attendance:overtime (per pengguna).
// T15-CHAIN-EXT: approve jenjang menengah → order tetap Pending (res membawa
// field `approval`); otorisasi per jenjang oleh engine (aktor sesi + delegasi
// TemporaryApprover); race double-decide → 409, akses ditolak → 403.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:overtime", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json().catch(() => ({}));

    // ===== Task 100 F1 (G25) — op:"bulk": putuskan banyak dokumen sekaligus ====
    // body { ids: string[] (maks 50), action: "approve"|"reject", reason? } →
    // loop decideOvertimeOrder PERSIS seperti op tunggal (service yang sama,
    // validasi cap PP 35/2021 + approval berjenjang tetap jalan per dokumen);
    // dokumen yang sudah diputuskan proses lain gagal per-id (race-safe) tanpa
    // membatalkan sisa batch.
    if (b.op === "bulk") {
      // unknown[] dulu supaya Set ter-infer string[] (new Set(any) → Set<unknown>)
      const rawIds: unknown[] = Array.isArray(b.ids) ? b.ids : [];
      const ids = [...new Set(rawIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
      if (ids.length === 0) return NextResponse.json({ error: "ids wajib diisi (array nomor/id dokumen)" }, { status: 400 });
      if (ids.length > 50) {
        return NextResponse.json({ error: `Maksimal 50 dokumen per operasi massal (diminta ${ids.length})` }, { status: 400 });
      }
      const actionStr = String(b.action ?? "");
      if (actionStr !== "approve" && actionStr !== "reject") {
        return NextResponse.json({ error: "action wajib approve|reject untuk operasi massal" }, { status: 400 });
      }
      const action: "approve" | "reject" = actionStr;
      const note = b.reason != null ? String(b.reason).slice(0, 300) : undefined;

      const results: Array<{ id: string; ok: boolean; status?: string | null; error?: string }> = [];
      for (const id of ids) {
        try {
          const res = await decideOvertimeOrder(m.db, id, action, {
            approver: m.actor.name,
            note,
            actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name, appUserId: m.actor.appUserId },
          });
          const order = res.order as
            | { orderNo: string; employeeId: string; status: string; overtimeDate: Date }
            | null;
          // notifikasi per dokumen — mirror op tunggal (fire-and-forget)
          if (action === "approve" && res.approval) {
            void notifyEvent(m.db, {
              to: "nextApprover", docType: "Overtime", docNo: order?.orderNo ?? id, docId: id,
              title: `Perintah lembur ${order?.orderNo ?? "-"} menunggu persetujuan Anda (jenjang ${res.approval.currentLevel}/${res.approval.totalLevels})`,
              body: `Jenjang sebelumnya disetujui — menunggu keputusan ${res.approval.currentApprover ?? "approver berikutnya"}.`,
              kind: "attendance", link: "attendance:overtime",
            });
          }
          if (order && !res.approval && (order.status === "Approved" || order.status === "Rejected")) {
            void notifyEvent(m.db, {
              to: "employee", docType: "Overtime", docNo: order.orderNo, docId: id, employeeId: order.employeeId,
              title: action === "approve" ? `Perintah lembur ${order.orderNo} disetujui` : `Perintah lembur ${order.orderNo} ditolak`,
              body: note ? `Catatan: ${note}` : res.note,
              kind: "attendance", link: "attendance:overtime",
            });
            if (action === "approve") {
              void (async () => {
                try {
                  await dispatchWebhookEvent(m.db, null, "overtime.approved", {
                    docNo: order.orderNo,
                    employeeId: order.employeeId,
                    overtimeDate: new Date(order.overtimeDate).toISOString().slice(0, 10),
                    status: order.status,
                    source: "bulk",
                  });
                } catch { /* webhook tidak boleh mengganggu proses utama */ }
              })();
            }
          }
          results.push({ id, ok: true, status: order?.status ?? null });
        } catch (e) {
          // race double-decide / cap lembur / akses jenjang → gagal per-id
          results.push({ id, ok: false, error: e instanceof Error ? e.message : "unknown" });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      return NextResponse.json({ results, okCount, failCount: results.length - okCount });
    }

    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    const res = await decideOvertimeOrder(m.db, b.id, b.action, {
      approver: b.approver ?? m.actor.name,
      note: b.note,
      verifiedMinutes: b.verifiedMinutes ? Number(b.verifiedMinutes) : undefined,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name, appUserId: m.actor.appUserId },
    });

    // ===== Notifikasi in-app (T11-NOTIF) — fire-and-forget =====
    // approve parsial (masih ada jenjang berikutnya) → approver jenjang berikut
    if (b.action === "approve" && res.approval) {
      const order = res.order as { orderNo: string } | null;
      void notifyEvent(m.db, {
        to: "nextApprover", docType: "Overtime", docNo: order?.orderNo ?? String(b.id), docId: String(b.id),
        title: `Perintah lembur ${order?.orderNo ?? "-"} menunggu persetujuan Anda (jenjang ${res.approval.currentLevel}/${res.approval.totalLevels})`,
        body: `Jenjang sebelumnya disetujui — menunggu keputusan ${res.approval.currentApprover ?? "approver berikutnya"}.`,
        // Fix audit 40 M-8 — link notifikasi approver ke view modul Lembur
        // ("actions:inbox" hanya memuat dokumen PA — approver TA tidak bisa
        // membuka dokumen lembur dari sana; "attendance:overtime" = section:view
        // valid yang dinavigasi bell).
        kind: "attendance", link: "attendance:overtime",
      });
    }

    // ===== Keputusan FINAL (approve/reject) → pengaju (pola workoff) =====
    if (b.action === "approve" || b.action === "reject") {
      const order = res.order as
        | { orderNo: string; employeeId: string; status: string; overtimeDate: Date }
        | null;
      if (order && !res.approval && (order.status === "Approved" || order.status === "Rejected")) {
        void notifyEvent(m.db, {
          to: "employee", docType: "Overtime", docNo: order.orderNo, docId: String(b.id), employeeId: order.employeeId,
          title: b.action === "approve" ? `Perintah lembur ${order.orderNo} disetujui` : `Perintah lembur ${order.orderNo} ditolak`,
          body: res.note,
          kind: "attendance", link: "attendance:overtime",
        });
        // ===== Webhook (fix audit 40 M-14) — overtime.approved saat approve
        // FINAL, fire-and-forget, never-throw (mirror loans.ts). =====
        if (b.action === "approve") {
          void (async () => {
            try {
              await dispatchWebhookEvent(m.db, null, "overtime.approved", {
                docNo: order.orderNo,
                employeeId: order.employeeId,
                overtimeDate: new Date(order.overtimeDate).toISOString().slice(0, 10),
                status: order.status,
                source: "app",
              });
            } catch { /* webhook tidak boleh mengganggu proses utama */ }
          })();
        }
      }
    }

    return NextResponse.json(res);
  } catch (e) {
    // T15-CHAIN-EXT: race double-decide → 409 ramah; aktor bukan approver
    // jenjang (dan bukan delegate) → 403 — bukan 400 generik (pola leave).
    if (e instanceof DecisionConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
