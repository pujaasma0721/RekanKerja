// GET /api/rekankerja/ess/claims/travel + POST ajukan klaim/settlement travel (ESS).
// =====================================================================
// GET  — data form pengajuan: pengajuan dinas SAYA berstatus Approved yang
//        BELUM punya klaim aktif (dasar klaim + uang muka + jendela tanggal),
//        template aktif (klaim mandiri), dan daftar jenis biaya aktif.
// POST — ajukan klaim travel via travel-service createClaim: seluruh guard
//        jalur admin TETAP berlaku (request wajib Approved M-2, satu klaim
//        aktif per request K-2, tanggal biaya dalam rentang trip M-5,
//        formula settlement server B1/B2, approval berjenjang "TravelClaim").
//
// Lampiran kwitansi (Task 98 F1-5): ESS kini BOLEH mengunggah kwitansi via
// /api/rekankerja/attachments (guard requireEss + kepemilikan klaim) — draf
// di-rebind ke klaim saat POST (mirror jalur admin claims.ts); enforcement
// jenis biaya needDocs sama dgn admin.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { listTravelRequests, listTemplates, listExpenseTypes, createClaim } from "@/rekankerja/travel/services/travel-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import {
  bindDraftAttachments, countDraftAttachmentsByIds, deleteDraftAttachmentsByIds,
} from "@/rekankerja/shared/services/attachment-service";

// GET — form data klaim travel milik saya.
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformUserId, platformRole } = m.actor;

  try {
    // dasar klaim: request Approved milik saya TANPA klaim aktif (K-2).
    const [rows, templates, expenseTypes] = await Promise.all([
      listTravelRequests(db, { employeeId, status: "Approved" }),
      listTemplates(db),
      listExpenseTypes(db),
    ]);
    // 45-b: gerbang vault uang (aktor ESS) — advance masked → 0 (Task 56).
    const mv = await getMoneyView(db, { userId: platformUserId, membershipRole: platformRole });
    const requests = rows
      .filter((r) => !r.hasActiveClaim)
      .map((r) => ({
        requestId: r.id,
        docNo: r.docNo,
        dateFrom: new Date(r.dateFrom).toISOString().slice(0, 10),
        dateTo: new Date(r.dateTo).toISOString().slice(0, 10),
        days: r.days,
        purpose: r.purpose,
        destinations: r.destinations.map((d) => d.city),
        // Task 98 (F0-6/B7) — trip punya kaki luar negeri → jenis O-* diizinkan.
        overseas: r.destinations.some((d) => d.overseas),
        templateCode: r.templateCode,
        templateName: r.templateName,
        costCenter: r.costCenter,
        advanceAmount: mv.canSee ? r.advanceAmount : 0,
      }));
    return NextResponse.json({
      requests,
      templates: templates
        .filter((t) => t.active)
        .map((t) => ({ code: t.code, name: t.name, settlementMethod: t.settlementMethod })),
      expenseTypes: expenseTypes
        .filter((t) => t.active)
        .map((t) => ({
          code: t.code,
          name: t.name,
          kind: t.kind,
          needDocs: t.needDocs,
          limitAmount: t.limitAmount,
          unlimited: t.unlimited,
        })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan klaim/settlement travel untuk diri sendiri.
// Body: { requestId?, templateCode?, claimDate?, purpose?, remark?,
//         expenses: [{ expenseCode, expenseDate?, description?, amount, qty? }],
//         otherCompanyExp?, exchangeLoss? }
// requestId → template & jendela tanggal dari pengajuan dinas; tanpa request
// (klaim mandiri) → templateCode wajib dipilih sendiri.
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    if (!Array.isArray(b.expenses) || b.expenses.length === 0) {
      return NextResponse.json({ error: "Klaim wajib memuat minimal 1 baris biaya" }, { status: 400 });
    }
    for (const [i, e] of (b.expenses as Record<string, unknown>[]).entries()) {
      if (!String(e.expenseCode ?? "")) {
        return NextResponse.json({ error: `Baris ${i + 1}: jenis biaya wajib dipilih` }, { status: 400 });
      }
      if (!(Number(e.amount) > 0)) {
        return NextResponse.json({ error: `Baris ${i + 1}: nominal biaya wajib lebih dari 0` }, { status: 400 });
      }
    }

    // Task 98 (F1-5) — draf lampiran kwitansi pra-submit (mirror admin claims.ts):
    // enforcement jenis needDocs wajib minimal 1 file; rebind setelah create.
    const attachmentIds: string[] = Array.isArray(b.attachmentIds)
      ? (b.attachmentIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];
    if (attachmentIds.length > 0) {
      const draftCount = await countDraftAttachmentsByIds(db, "TravelClaim", attachmentIds);
      if (draftCount === 0) {
        return NextResponse.json(
          { error: "Lampiran tidak ditemukan/d sudah terpakai — unggah ulang kwitansi" },
          { status: 400 },
        );
      }
    } else {
      const needDocsTypes = await db.travelExpenseType.findMany({
        where: { code: { in: (b.expenses as { expenseCode?: string }[]).map((e) => String(e.expenseCode ?? "")) }, needDocs: true },
        select: { name: true },
      });
      if (needDocsTypes.length > 0) {
        return NextResponse.json(
          {
            error:
              `Jenis biaya ${needDocsTypes.map((t) => t.name).join(", ")} mewajibkan lampiran kwitansi — ` +
              "foto struk dari ponsel Anda lalu unggah (JPG/PNG/WEBP/PDF, maks 5 MB)",
          },
          { status: 400 },
        );
      }
    }

    const requestId = b.requestId ? String(b.requestId) : undefined;
    let templateCode = b.templateCode ? String(b.templateCode) : "";

    if (requestId) {
      // dasar klaim = pengajuan dinas milik SENDIRI (createClaim memvalidasi
      // kepemilikan + status Approved + satu klaim aktif) — template request
      // dipakai otomatis, input klien diabaikan.
      const reqRow = await db.travelRequest.findUnique({
        where: { id: requestId },
        select: { employeeId: true, status: true, template: { select: { code: true } } },
      });
      if (!reqRow || reqRow.employeeId !== employeeId) {
        return NextResponse.json({ error: "Pengajuan dinas tidak ditemukan / bukan milik Anda" }, { status: 400 });
      }
      if (reqRow.status !== "Approved") {
        return NextResponse.json({ error: `Klaim hanya bisa dibuat dari pengajuan Approved (status saat ini: ${reqRow.status})` }, { status: 400 });
      }
      templateCode = reqRow.template.code;
    } else if (!templateCode) {
      return NextResponse.json(
        { error: "Pilih pengajuan dinas sebagai dasar klaim, atau pilih template untuk klaim mandiri" },
        { status: 400 },
      );
    }

    const res = await createClaim(db, {
      requestId,
      employeeId,
      templateCode,
      claimDate: b.claimDate ? String(b.claimDate) : undefined,
      purpose: b.purpose ? String(b.purpose) : undefined,
      remark: b.remark ? String(b.remark) : undefined,
      expenses: (b.expenses as Record<string, unknown>[]).map((e) => ({
        expenseCode: String(e.expenseCode ?? ""),
        expenseDate: e.expenseDate ? String(e.expenseDate) : undefined,
        description: e.description ? String(e.description) : undefined,
        amount: Math.max(0, Number(e.amount ?? 0)),
        qty: e.qty ? Number(e.qty) : undefined,
        guestName: e.guestName ? String(e.guestName) : undefined,
      })),
      otherCompanyExp: Math.max(0, Number(b.otherCompanyExp ?? 0)),
      exchangeLoss: Math.max(0, Number(b.exchangeLoss ?? 0)),
      // b/c dihitung otoritatif server (B1/B2) — input klien diabaikan.
      payableEmployee: 0,
      payableCompany: 0,
      actorName: fullName,
    }).catch(async (e: unknown) => {
      // gagal membuat klaim → sapu draf lampiran yang dikirim (best-effort)
      if (attachmentIds.length > 0) await deleteDraftAttachmentsByIds(db, attachmentIds);
      throw e;
    });

    // Task 98 (F1-5) — rebind draf lampiran ESS ke klaim yang baru dibuat.
    let boundAttachments = 0;
    if (attachmentIds.length > 0) {
      const claimRow = await db.travelClaim.findUnique({ where: { docNo: res.docNo }, select: { id: true } });
      if (claimRow) {
        boundAttachments = await bindDraftAttachments(db, "TravelClaim", attachmentIds, claimRow.id);
      }
    }

    // ===== Notifikasi (mirror jalur admin travel/api/claims.ts POST) =====
    void (async () => {
      try {
        notifyEmailEvent(db, {
          event: "travel.claim.submitted",
          to: await approverEmailsOf(db, employeeId),
          data: {
            nama: fullName, docNo: res.docNo,
            jumlah: `Rp ${res.totalSettlement.toLocaleString("id-ID")}`,
            periode: b.claimDate ? String(b.claimDate) : "-",
          },
        });
        await notifyEvent(db, {
          to: "nextApprover", docType: "TravelClaim", docNo: res.docNo,
          title: `Klaim settlement ${res.docNo} menunggu persetujuan Anda`,
          body: `${fullName} — klaim travel Rp ${res.totalSettlement.toLocaleString("id-ID")} (diajukan via ESS — kwitansi fisik diverifikasi saat approval)${res.approvalLevels > 1 ? ` — approval ${res.approvalLevels} jenjang` : ""}`,
          kind: "travel", link: "travel:travel-claim-approval",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama ESS */ }
    })();
    void dispatchWebhookEvent(db, null, "travel.claim.submitted", {
      docNo: res.docNo, employeeId, employeeName: fullName,
      totalSettlement: res.totalSettlement, source: "ess",
    });

    return NextResponse.json(
      {
        ...res,
        attachmentCount: boundAttachments,
        receiptNote: boundAttachments > 0
          ? `${boundAttachments} kwitansi terlampir digital pada klaim ini.`
          : "Kwitansi asli tiap biaya tetap diserahkan ke HR/Finance untuk verifikasi sebelum klaim disetujui.",
      },
      { status: 201 },
    );
  } catch (e) {
    // validasi bisnis (rentang tanggal/biaya/jenis) → 400 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
