import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import { listTravelRequests, submitTravelRequest, decideTravelRequest } from "@/rekankerja/travel/services/travel-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

// GET /api/rekankerja/travel/requests?status=&employeeId= — daftar permintaan
// (padanan TravelRequest.jsp / TravelRequestToApprove.jsp).
// Audit 97 (Task 97): dulu requireTenant SAJA — anggota tenant tanpa hak menu
// travel (termasuk sesi ESS) bisa membaca seluruh permintaan + agregat uang
// muka (stats.advanceTotal). Kini par M-6: cukup salah satu menu yang memakai
// daftar ini — permintaan, persetujuan, atau klaim (dropdown "Klaim dari
// Permintaan" di view Klaim & Settlement).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["travel:travel-request", "travel:travel-approval", "travel:travel-claim"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const requests = await listTravelRequests(db, {
      status: sp.get("status") ?? "all",
      employeeId: sp.get("employeeId") ?? undefined,
      sortBy: sp.get("sortBy") ?? undefined,
      sortDir: sp.get("sortDir") ?? undefined,
    });
    const stats = {
      total: requests.length,
      submitted: requests.filter((r) => r.status === "Submitted").length,
      approved: requests.filter((r) => r.status === "Approved").length,
      rejected: requests.filter((r) => r.status === "Rejected").length,
      cancelled: requests.filter((r) => r.status === "Cancelled").length,
      withClaim: requests.filter((r) => r.claimCount > 0).length,
      overdueSettlement: requests.filter((r) => r.overdue).length,
      advanceTotal: requests.reduce((s, r) => s + r.advanceAmount, 0),
    };
    return NextResponse.json({ requests, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan permintaan travel (destinasi multi-kaki + uang muka).
// Task 25: guard mutasi — identitas pengaju tercatat pada jalur approval berjenjang.
// Task 32-d: guard hak AKSI menu — create pada menu travel:travel-request (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "travel:travel-request", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!Array.isArray(b.destinations) || b.destinations.length === 0) {
      return NextResponse.json({ error: "Minimal 1 destinasi wajib" }, { status: 400 });
    }
    const res = await submitTravelRequest(db, {
      employeeId: String(b.employeeId ?? ""),
      templateCode: String(b.templateCode ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      dateTo: String(b.dateTo ?? ""),
      purpose: String(b.purpose ?? ""),
      remark: b.remark ? String(b.remark) : undefined,
      costCenter: b.costCenter ? String(b.costCenter) : undefined,
      destinations: b.destinations.map((d: Record<string, unknown>) => ({
        dateFrom: String(d.dateFrom ?? ""),
        dateTo: String(d.dateTo ?? ""),
        city: String(d.city ?? ""),
        country: d.country ? String(d.country) : undefined,
        zoneCode: d.zoneCode ? String(d.zoneCode) : undefined,
        overseas: Boolean(d.overseas),
        note: d.note ? String(d.note) : undefined,
      })),
      advanceAmount: Math.max(0, Number(b.advanceAmount ?? 0)),
      advanceNote: b.advanceNote ? String(b.advanceNote) : undefined,
      actorName: m.actor.name,
    });

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    void (async () => {
      try {
        const emp = await db.employee.findUnique({
          where: { id: String(b.employeeId ?? "") },
          select: { fullName: true, email: true },
        });
        const cities = Array.isArray(b.destinations)
          ? (b.destinations as { city?: string }[]).map((d) => d.city ?? "-").filter(Boolean).join(", ")
          : "-";
        notifyEmailEvent(db, {
          event: "travel.submitted",
          to: await approverEmailsOf(db, String(b.employeeId ?? "")),
          data: {
            nama: emp?.fullName ?? "-", docNo: res.docNo, tujuan: cities || "-",
            periode: `${String(b.dateFrom ?? "-")} → ${String(b.dateTo ?? "-")}`,
            biaya: b.advanceAmount ? `Rp ${Number(b.advanceAmount).toLocaleString("id-ID")}` : "-",
          },
        });
        // ===== Notifikasi in-app (T11-NOTIF) — submit → approver jenjang pertama =====
        // Fix audit 40 M-8: link "actions:inbox" (kotak PA saja — approver travel tidak
        // bisa membuka dokumen) → "travel:travel-approval" (view Persetujuan di
        // TRAVEL_NAV — dokumen permintaan travel bisa dibuka dari notifikasi).
        await notifyEvent(db, {
          to: "nextApprover", docType: "Travel", docNo: res.docNo,
          title: `Pengajuan travel ${res.docNo} menunggu persetujuan Anda`,
          body: `${emp?.fullName ?? "Karyawan"} — ${cities || "-"}, ${String(b.dateFrom ?? "-")} → ${String(b.dateTo ?? "-")}`,
          kind: "travel", link: "travel:travel-approval",
        });
      } catch { /* never */ }
    })();

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan approval (padanan Operation: Approve | Reject | Cancel).
// 24-FIX-TRAVEL #7: guard mutasi — role VIEWER ditolak (403) dan
// identitas approver NYATA dari sesi (AppUser tenant → fallback platform userId)
// dicatat ke decidedById (sebelumnya selalu NULL).
// Task 32-d: guard hak AKSI menu per pengguna — approve/reject → op:approve pada
// travel:travel-approval; cancel → op:cancel pada travel:travel-request.
// Body dibaca SEKALI sebelum guard (aksi menentukan menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const m = b.action === "cancel"
      ? await requireMenuAction(req, "travel:travel-request", "op:cancel")
      : await requireMenuAction(req, "travel:travel-approval", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await decideTravelRequest(m.db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
      actorId: m.actor.appUserId ?? m.actor.userId,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
    });

    // ===== Notifikasi in-app (T11-NOTIF) — fire-and-forget =====
    // approve parsial (masih ada jenjang berikutnya) → approver jenjang berikut
    // Fix audit 40 M-8: link "actions:inbox" (PA-only) → "travel:travel-approval"
    // (view Persetujuan di TRAVEL_NAV).
    if (b.action === "approve" && res.approval) {
      void notifyEvent(m.db, {
        to: "nextApprover", docType: "Travel", docNo: res.docNo, docId: String(b.id),
        title: `Pengajuan travel ${res.docNo} menunggu persetujuan Anda (jenjang ${res.approval.currentLevel}/${res.approval.totalLevels})`,
        body: `Jenjang sebelumnya disetujui — menunggu keputusan ${res.approval.currentApprover ?? "approver berikutnya"}.`,
        kind: "travel", link: "travel:travel-approval",
      });
    }

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    if (b.action !== "cancel" && !res.approval) {
      void (async () => {
        try {
          const tr = await m.db.travelRequest.findUnique({
            where: { id: String(b.id) },
            select: { docNo: true, dateFrom: true, dateTo: true, employeeId: true, employee: { select: { fullName: true, email: true } }, destinations: { select: { city: true } } },
          });
          if (tr?.employee?.email) {
            notifyEmailEvent(m.db, {
              event: b.action === "approve" ? "travel.approved" : "travel.rejected",
              to: [{ email: tr.employee.email, name: tr.employee.fullName }],
              data: {
                nama: tr.employee.fullName, docNo: tr.docNo,
                tujuan: tr.destinations.map((d) => d.city).join(", ") || "-",
                periode: `${new Date(tr.dateFrom).toISOString().slice(0, 10)} → ${new Date(tr.dateTo).toISOString().slice(0, 10)}`,
                catatan: b.note ? String(b.note) : "-",
              },
            });
          }
          // ===== Notifikasi in-app (T11-NOTIF) — keputusan final → pengaju =====
          if (tr) {
            await notifyEvent(m.db, {
              to: "employee", docType: "Travel", docNo: res.docNo, docId: String(b.id), employeeId: tr.employeeId,
              title: b.action === "approve" ? `Pengajuan travel ${res.docNo} disetujui` : `Pengajuan travel ${res.docNo} ditolak`,
              body: `${tr.destinations.map((d) => d.city).join(", ") || "-"}, ${new Date(tr.dateFrom).toISOString().slice(0, 10)} → ${new Date(tr.dateTo).toISOString().slice(0, 10)}${b.note ? ` — catatan: ${String(b.note)}` : ""}`,
              kind: "travel", link: "travel:requests",
            });
          }
        } catch { /* never */ }
      })();
    }

    // ===== Webhook (fix audit 40 M-14) — travel.request.approved saat APPROVE
    // FINAL (jenjang teruntas), fire-and-forget, never-throw (mirror loans.ts). =====
    if (b.action === "approve" && !res.approval) {
      void (async () => {
        try {
          const tr = await m.db.travelRequest.findUnique({
            where: { id: String(b.id) },
            select: { docNo: true, status: true, employeeId: true, employee: { select: { fullName: true, employeeNo: true } }, destinations: { select: { city: true } } },
          });
          if (tr) {
            await dispatchWebhookEvent(m.db, null, "travel.request.approved", {
              docNo: tr.docNo, status: tr.status,
              employeeId: tr.employeeId, employeeName: tr.employee?.fullName, employeeNo: tr.employee?.employeeNo,
              destinations: tr.destinations.map((d) => d.city),
              source: "app",
            });
          }
        } catch { /* webhook tidak boleh mengganggu proses utama */ }
      })();
    }

    return NextResponse.json(res);
  } catch (e) {
    // Minor audit 40 §5-11 (mirror claims.ts:249-254): race double-decide → 409
    // ramah; aktor bukan approver jenjang (dan bukan delegate) → 403 — bukan 400
    // generik (pola leave/claims).
    if (e instanceof DecisionConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof DecisionForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
