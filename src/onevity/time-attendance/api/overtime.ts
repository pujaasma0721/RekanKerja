import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { attachChainSummaries, DecisionConflictError, DecisionForbiddenError } from "@/onevity/shared/services/approval-engine";
import { submitOvertimeOrder, decideOvertimeOrder } from "@/onevity/time-attendance/services/attendance-service";
import { overtimePayFor, getRule } from "@/onevity/time-attendance/services/attendance-service";
import { notifyEvent } from "@/onevity/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/onevity/shared/services/email-service";

// GET /api/onevity/attendance/overtime?status= — daftar perintah lembur + statistik
// (padanan EmpOvertimeWrit.jsp + approval berjenjang T15-CHAIN-EXT).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const status = req.nextUrl.searchParams.get("status");
    // T5-TA-FIX (D-6a): estimasi upah memakai rule (minimum + rounding interval),
    // konsisten dgn rekap uang recapPeriod/transfer — bukan hardcode 30 menit.
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
      orderBy: [{ overtimeDate: "desc" }, { orderNo: "desc" }],
    });

    // T15-CHAIN-EXT: ringkasan approval berjenjang per order (badge "Jenjang X/Y"
    // + approver menunggu) — satu query batch (pola workoffs).
    const chainMap = await attachChainSummaries(db, "Overtime", orders.map((o) => ({ id: o.id })));

    const all = orders.map((o) => {
      // 28-c: baseSalary terenkripsi — dekripsi utk perhitungan uang lembur.
      const baseSalary = tenantCryptoForDb(db).decryptMoney(o.employee.assignments[0]?.baseSalary) ?? 0;
      // fix M-7: order yang sudah disetujui tanpa bukti clock → jam efektif = verified/actual
      // (bukan plan) — konsisten dengan rekap uang; Pending menampilkan rencana (plan).
      const minutes = o.status === "Pending"
        ? o.planMinutes
        : o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes;
      const estPay = ["Approved", "Paid"].includes(o.status)
        ? overtimePayFor(baseSalary, minutes, o.dayCategory, {
            roundingMinutes: rule.overtimeRoundingMinutes, minMinutes: rule.minOvertimeMinutes,
          })
        : 0;
      return {
        ...o,
        baseSalary,
        orgUnitName: o.employee.assignments[0]?.orgUnit?.name ?? null,
        estPay,
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
      approvedPay: all.filter((o) => o.status === "Approved").reduce((s, o) => s + o.estPay, 0),
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
        kind: "attendance", link: "actions:inbox",
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
    const b = await req.json();
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
        kind: "attendance", link: "actions:inbox",
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
