import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { listTravelClaims, createClaim, decideClaim, previewClaim, getClaimDetail } from "@/onevity/travel/services/travel-service";
import { notifyEmailEvent, approverEmailsOf } from "@/onevity/shared/services/email-service";
// T16-ATTACH — lampiran kwitansi klaim (draft-upload → rebind saat submit;
// enforcement jenis biaya needDocs; metadata utk badge "lampiran n").
import {
  attachmentsByEntityIds, bindDraftAttachments, countDraftAttachmentsByIds,
  deleteAttachmentsByEntity, deleteDraftAttachmentsByIds,
} from "@/onevity/shared/services/attachment-service";

// GET /api/onevity/travel/claims?status=&employeeId= — daftar klaim
// (padanan TravelClaim.jsp / TravelClaimToApprove.jsp).
// GET ?requestId= — preview form klaim untuk request Approved.
// GET ?id= — detail klaim (rincian biaya).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const requestId = sp.get("requestId");
    if (requestId) {
      // 24-FIX-TRAVEL: error validasi preview (status ≠ Approved / sudah punya klaim aktif)
      // dibalas 400 (bukan 500) — error input pengguna, bukan error server.
      try {
        const res = await previewClaim(db, requestId);
        return NextResponse.json(res);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
      }
    }
    const id = sp.get("id");
    if (id) {
      const detail = await getClaimDetail(db, id);
      return NextResponse.json({ detail });
    }
    const claims = await listTravelClaims(db, {
      status: sp.get("status") ?? "all",
      employeeId: sp.get("employeeId") ?? undefined,
    });
    // T16-ATTACH: sertai metadata lampiran per klaim (badge "lampiran n" + preview).
    const attachMap = await attachmentsByEntityIds(db, "TravelClaim", claims.map((c) => c.id));
    const claimsWithAttachments = claims.map((c) => ({
      ...c,
      attachments: attachMap.get(c.id) ?? [],
      attachmentCount: attachMap.get(c.id)?.length ?? 0,
    }));
    const stats = {
      total: claims.length,
      submitted: claims.filter((c) => c.status === "Submitted").length,
      approved: claims.filter((c) => c.status === "Approved").length,
      transferred: claims.filter((c) => c.status === "Transferred").length,
      paid: claims.filter((c) => c.status === "Paid").length,
      rejected: claims.filter((c) => c.status === "Rejected").length,
      cancelled: claims.filter((c) => c.status === "Cancelled").length,
      totalSettlement: claims.reduce((s, c) => s + c.totalSettlement, 0),
      payableEmployee: claims.filter((c) => c.status === "Approved").reduce((s, c) => s + c.payableEmployee, 0),
      payableCompany: claims.filter((c) => c.status === "Approved").reduce((s, c) => s + c.payableCompany, 0),
    };
    return NextResponse.json({ claims: claimsWithAttachments, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat klaim / settlement (rincian biaya per jenis + formula (a)+(b)-(c)).
export async function POST(req: NextRequest) {
  try {
    // Task 32-d: guard hak AKSI menu — create pada travel:travel-claim (per pengguna).
    const m = await requireMenuAction(req, "travel:travel-claim", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!Array.isArray(b.expenses) || b.expenses.length === 0) {
      return NextResponse.json({ error: "Klaim wajib memuat minimal 1 baris biaya" }, { status: 400 });
    }
    // ===== T16-ATTACH: enforcement lampiran kwitansi =====
    // File diunggah PRA-submit ke /api/onevity/attachments dengan entityId
    // "draft:{uuid}"; klaim mengirim attachmentIds → dicek DI SINI (setelah file
    // tersimpan) lalu di-rebind ke klaim setelah createClaim sukses.
    const attachmentIds: string[] = Array.isArray(b.attachmentIds)
      ? (b.attachmentIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];
    const needDocsTypes = await db.travelExpenseType.findMany({
      where: { code: { in: b.expenses.map((e: { expenseCode?: string }) => String(e.expenseCode ?? "")) }, needDocs: true },
      select: { code: true, name: true },
    });
    // cek jumlah draf yang BENAR-BENAR siap di-rebind (bukan sekadar daftar id)
    const draftCount = await countDraftAttachmentsByIds(db, "TravelClaim", attachmentIds);
    if (needDocsTypes.length > 0 && draftCount === 0) {
      return NextResponse.json(
        {
          error:
            `Jenis biaya ${needDocsTypes.map((t) => t.name).join(", ")} mewajibkan lampiran kwitansi — ` +
            "unggah kwitansi (JPG/PNG/WEBP/PDF, maks 5 MB) sebelum mengajukan klaim",
        },
        { status: 400 },
      );
    }
    const res = await createClaim(db, {
      requestId: b.requestId ? String(b.requestId) : undefined,
      employeeId: String(b.employeeId ?? ""),
      templateCode: String(b.templateCode ?? ""),
      claimDate: b.claimDate ? String(b.claimDate) : undefined,
      costCenter: b.costCenter ? String(b.costCenter) : undefined,
      purpose: b.purpose ? String(b.purpose) : undefined,
      remark: b.remark ? String(b.remark) : undefined,
      voucherNo: b.voucherNo ? String(b.voucherNo) : undefined,
      settlementMethod: b.settlementMethod ? String(b.settlementMethod) : undefined,
      expenses: b.expenses.map((e: Record<string, unknown>) => ({
        expenseCode: String(e.expenseCode ?? ""),
        expenseDate: e.expenseDate ? String(e.expenseDate) : undefined,
        description: e.description ? String(e.description) : undefined,
        amount: Math.max(0, Number(e.amount ?? 0)),
        qty: e.qty ? Number(e.qty) : undefined,
        guestName: e.guestName ? String(e.guestName) : undefined,
      })),
      otherCompanyExp: Math.max(0, Number(b.otherCompanyExp ?? 0)),
      exchangeLoss: Math.max(0, Number(b.exchangeLoss ?? 0)),
      payableEmployee: Math.max(0, Number(b.payableEmployee ?? 0)),
      payableCompany: Math.max(0, Number(b.payableCompany ?? 0)),
    }).catch(async (e: unknown) => {
      // gagal membuat klaim → sapu draf lampiran yang dikirim (best-effort)
      if (attachmentIds.length > 0) await deleteDraftAttachmentsByIds(db, attachmentIds);
      throw e;
    });

    // T16-ATTACH — rebind draf lampiran ke klaim yang baru dibuat
    // (createClaim mengembalikan docNo unik → resolve id klaim).
    let boundAttachments = 0;
    if (attachmentIds.length > 0) {
      const claimRow = await db.travelClaim.findUnique({ where: { docNo: res.docNo }, select: { id: true } });
      if (claimRow) {
        boundAttachments = await bindDraftAttachments(db, "TravelClaim", attachmentIds, claimRow.id);
      }
    }

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    void (async () => {
      try {
        const emp = await db.employee.findUnique({
          where: { id: String(b.employeeId ?? "") },
          select: { fullName: true },
        });
        const total = Array.isArray(b.expenses)
          ? (b.expenses as { amount?: number }[]).reduce((s, e) => s + (Number(e.amount) || 0), 0)
          : 0;
        notifyEmailEvent(db, {
          event: "travel.claim.submitted",
          to: await approverEmailsOf(db, String(b.employeeId ?? "")),
          data: {
            nama: emp?.fullName ?? "-", docNo: res.docNo,
            jumlah: `Rp ${total.toLocaleString("id-ID")}`,
            periode: b.claimDate ? String(b.claimDate) : "-",
          },
        });
      } catch { /* never */ }
    })();

    return NextResponse.json({ ...res, attachmentCount: boundAttachments }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan klaim (Approve → jurnal otomatis | Reject | Cancel)
// (padanan TravelClaimToApprove Operation + Transfer terpisah di /transfer).
// 24-FIX-TRAVEL #7: guard mutasi requireMutator — role VIEWER ditolak (403) dan
// identitas approver NYATA dari sesi (AppUser tenant → fallback platform userId)
// dicatat ke decidedById (sebelumnya selalu NULL).
export async function PATCH(req: NextRequest) {
  try {
    // Task 32-d: body dibaca SEKALI sebelum guard (aksi menentukan menu yang dicek):
    // approve/reject → op:approve travel:travel-claim-approval; cancel → op:cancel travel:travel-claim.
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const m = b.action === "cancel"
      ? await requireMenuAction(req, "travel:travel-claim", "op:cancel")
      : await requireMenuAction(req, "travel:travel-claim-approval", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await decideClaim(m.db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
      actorId: m.actor.appUserId ?? m.actor.userId,
    });

    // T16-ATTACH — klaim dibatalkan → sapu file+baris lampirannya (best-effort).
    if (b.action === "cancel") {
      void deleteAttachmentsByEntity(m.db, "TravelClaim", String(b.id)).catch(() => undefined);
    }

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    if (b.action !== "cancel") {
      void (async () => {
        try {
          const cl = await m.db.travelClaim.findUnique({
            where: { id: String(b.id) },
            select: { docNo: true, claimDate: true, totalSettlement: true, employee: { select: { fullName: true, email: true } } },
          });
          if (cl?.employee?.email) {
            notifyEmailEvent(m.db, {
              event: b.action === "approve" ? "travel.claim.approved" : "travel.claim.rejected",
              to: [{ email: cl.employee.email, name: cl.employee.fullName }],
              data: {
                nama: cl.employee.fullName, docNo: cl.docNo,
                jumlah: `Rp ${(cl.totalSettlement ?? 0).toLocaleString("id-ID")}`,
                periode: cl.claimDate ? new Date(cl.claimDate).toISOString().slice(0, 10) : "-",
                catatan: b.note ? String(b.note) : "-",
              },
            });
          }
        } catch { /* never */ }
      })();
    }

    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
