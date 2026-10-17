import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  offerOptions, listOffers, getOffer, createOffer, updateOffer, deleteOffer,
  sendOffer, decideOfferApproval, markViewed, respondOffer, counterOffer,
  offerFunnel, fmtMoneyId,
  OFFER_DOC_TYPE, OfferConflictError,
} from "@/rekankerja/recruitment/services/offer-service";
import {
  appointmentContext, appoint, continueToOnboarding,
} from "@/rekankerja/recruitment/services/appointment-service";
import { letterPdf } from "@/rekankerja/recruitment/services/selection-service";
import { getApprovalChain } from "@/rekankerja/shared/services/approval-engine";

// ============================================================================
// RECRUITMENT F4 — API offer & pengangkatan (DEVELOPMENT-PLAN-RECRUITMENT.md
// §7 F4). Guard: menu recruitment:offers (view + op:create/op:send/op:respond/
// op:appoint + create/update/delete standar).
//   GET  ?options=1                     → PR offerable + kandidat + guidance
//   GET  ?list=1[&prId=][&status=]       → { rows, stats }
//   GET  ?offerId=                      → detail (+ appointment + approval)
//   GET  ?approvals=1                   → offer menunggu approval (inbox)
//   GET  ?context=OFFERID               → prefill dialog pengangkatan
//   GET  ?funnel=1[&prId=]              → funnel Applied→…→Hired
//   GET  ?letterPdf=ID                  → PDF surat (offer/pengangkatan/
//                                          penolakan — stream, reuse F3)
//   POST { action: create|update|delete|send|approve|reject-approval|viewed|
//          accept|decline|counter|appoint|to-onboarding }
//   P2.4: action "counter" {id, edits} — nego offer Sent/Viewed kembali Draft
//         (guard update); accept/decline race → OfferConflictError 409.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:offers"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const mv = await moneyViewForReq(req, db);

    // PDF surat rekrutmen (response stream — bukan JSON)
    const letterId = sp.get("letterPdf");
    if (letterId) {
      const bytes = await letterPdf(db, letterId);
      if (!bytes) return NextResponse.json({ error: "Surat tidak ditemukan" }, { status: 404 });
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="surat-rekrutmen-${letterId}.pdf"`,
        },
      });
    }

    if (sp.get("options")) {
      const res = await offerOptions(db);
      return NextResponse.json(res);
    }

    const offerId = sp.get("offerId");
    if (offerId) {
      const row = await getOffer(db, offerId, mv.canSee);
      if (!row) return NextResponse.json({ error: "Offer tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row, moneyVisible: mv.canSee });
    }

    const contextOfferId = sp.get("context");
    if (contextOfferId) {
      const ctx = await appointmentContext(db, contextOfferId);
      if (!ctx) return NextResponse.json({ error: "Offer tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ context: ctx, moneyVisible: mv.canSee });
    }

    if (sp.get("approvals")) {
      // inbox approval offer — chain InProgress utk RecruitmentOffer
      const tc = tenantCryptoForDb(db);
      const pending = await db.candidateOffer.findMany({
        where: { status: "PendingApproval" },
        include: {
          candidate: { select: { fullName: true } },
          pr: { select: { prNo: true, position: { select: { title: true } } } },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      const rows: {
        id: string; offerNo: string; candidateName: string; prNo: string;
        positionTitle: string | null; salary: string | null; approval: Awaited<ReturnType<typeof getApprovalChain>>;
      }[] = [];
      for (const o of pending) {
        const chain = await getApprovalChain(db, OFFER_DOC_TYPE, o.id);
        rows.push({
          id: o.id,
          offerNo: o.offerNo,
          candidateName: o.candidate.fullName,
          prNo: o.pr.prNo,
          positionTitle: o.pr.position?.title ?? null,
          salary: mv.canSee ? fmtMoneyId(tc.decryptMoney(o.salary)) : null,
          approval: chain,
        });
      }
      return NextResponse.json({ rows });
    }

    if (sp.get("funnel")) {
      const prId = sp.get("prId");
      const funnel = await offerFunnel(db, prId || null);
      return NextResponse.json({ funnel });
    }

    // default: list
    const res = await listOffers(db, {
      prId: sp.get("prId"),
      status: sp.get("status"),
    }, mv.canSee);
    return NextResponse.json({ ...res, moneyVisible: mv.canSee });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  class GuardError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  try {
    const b = await req.json();
    const action = String(b.action ?? "");

    const guard = async (op: MenuActionRef) => {
      const m = await requireMenuAction(req, "recruitment:offers", op);
      if (!m.ok) throw new GuardError(m.status, m.error);
      return m;
    };

    switch (action) {
      case "create": {
        const m = await guard("create");
        const res = await createOffer(m.db, {
          prId: String(b.prId ?? ""),
          candidateId: String(b.candidateId ?? ""),
          jobOpeningId: b.jobOpeningId ? String(b.jobOpeningId) : null,
          salary: b.salary != null && b.salary !== "" ? Number(b.salary) : null,
          currency: b.currency ? String(b.currency) : null,
          salaryUnit: b.salaryUnit ? String(b.salaryUnit) : null,
          startDate: b.startDate ? String(b.startDate) : null,
          expiryDate: b.expiryDate ? String(b.expiryDate) : null,
          note: b.note ? String(b.note) : null,
        }, { id: m.actor.employeeId ?? null, name: m.actor.name });
        return NextResponse.json(res, { status: 201 });
      }
      case "update": {
        const m = await guard("update");
        await updateOffer(m.db, String(b.id ?? ""), {
          jobOpeningId: b.jobOpeningId !== undefined ? (b.jobOpeningId ? String(b.jobOpeningId) : null) : undefined,
          salary: b.salary !== undefined ? (b.salary === null || b.salary === "" ? null : Number(b.salary)) : undefined,
          currency: b.currency !== undefined ? String(b.currency) : undefined,
          salaryUnit: b.salaryUnit !== undefined ? String(b.salaryUnit) : undefined,
          startDate: b.startDate !== undefined ? (b.startDate ? String(b.startDate) : null) : undefined,
          expiryDate: b.expiryDate !== undefined ? (b.expiryDate ? String(b.expiryDate) : null) : undefined,
          note: b.note !== undefined ? (b.note ? String(b.note) : null) : undefined,
        }, m.actor.name);
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        const m = await guard("delete");
        const res = await deleteOffer(m.db, String(b.id ?? ""));
        return NextResponse.json(res);
      }
      case "send": {
        const m = await guard("op:send");
        const res = await sendOffer(m.db, {
          id: String(b.id ?? ""),
          actorId: m.actor.employeeId ?? null,
          actorName: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "approve":
      case "reject-approval": {
        const m = await guard("op:send");
        const res = await decideOfferApproval(m.db, {
          id: String(b.id ?? ""),
          action: action === "approve" ? "approve" : "reject",
          note: b.note ? String(b.note) : null,
          actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
        });
        return NextResponse.json(res);
      }
      case "viewed": {
        const m = await guard("op:respond");
        const res = await markViewed(m.db, { id: String(b.id ?? ""), actorName: m.actor.name });
        return NextResponse.json(res);
      }
      case "accept":
      case "decline": {
        const m = await guard("op:respond");
        const res = await respondOffer(m.db, {
          id: String(b.id ?? ""),
          action: action === "accept" ? "accept" : "decline",
          note: b.note ? String(b.note) : null,
          actorName: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "counter": {
        const m = await guard("update");
        const res = await counterOffer(m.db, {
          id: String(b.id ?? ""),
          edits: {
            jobOpeningId: b.edits?.jobOpeningId !== undefined ? (b.edits.jobOpeningId ? String(b.edits.jobOpeningId) : null) : undefined,
            salary: b.edits?.salary !== undefined ? (b.edits.salary === null || b.edits.salary === "" ? null : Number(b.edits.salary)) : undefined,
            currency: b.edits?.currency !== undefined ? String(b.edits.currency) : undefined,
            salaryUnit: b.edits?.salaryUnit !== undefined ? String(b.edits.salaryUnit) : undefined,
            startDate: b.edits?.startDate !== undefined ? (b.edits.startDate ? String(b.edits.startDate) : null) : undefined,
            expiryDate: b.edits?.expiryDate !== undefined ? (b.edits.expiryDate ? String(b.edits.expiryDate) : null) : undefined,
            note: b.edits?.note !== undefined ? (b.edits.note ? String(b.edits.note) : null) : undefined,
          },
          actor: { id: m.actor.employeeId ?? null, name: m.actor.name },
        });
        return NextResponse.json(res);
      }
      case "appoint": {
        const m = await guard("op:appoint");
        const res = await appoint(m.db, {
          offerId: String(b.offerId ?? ""),
          appointmentDate: String(b.appointmentDate ?? ""),
          positionId: b.positionId ? String(b.positionId) : null,
          orgUnitId: b.orgUnitId ? String(b.orgUnitId) : null,
          companyOfficeId: b.companyOfficeId ? String(b.companyOfficeId) : null,
          workLocationId: b.workLocationId ? String(b.workLocationId) : null,
          supervisorId: b.supervisorId ? String(b.supervisorId) : null,
          gradeId: b.gradeId ? String(b.gradeId) : null,
          employmentStatus: b.employmentStatus ? String(b.employmentStatus) : null,
          workShift: b.workShift ? String(b.workShift) : null,
          note: b.note ? String(b.note) : null,
        }, { id: m.actor.employeeId ?? null, name: m.actor.name });
        return NextResponse.json(res);
      }
      case "to-onboarding": {
        const m = await guard("op:appoint");
        const res = await continueToOnboarding(m.db, {
          appointmentId: String(b.appointmentId ?? ""),
          actor: { id: m.actor.employeeId ?? null, name: m.actor.name },
          req,
        });
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    // P2.4 — race-guard respondOffer/counterOffer (double-click portal/HR):
    // OfferConflictError membawa status readonly 409 → dipetakan eksplisit.
    if (e instanceof OfferConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof Error && "status" in e && typeof (e as { status?: unknown }).status === "number") {
      return NextResponse.json({ error: e.message }, { status: (e as unknown as { status: number }).status });
    }
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa kembali isian" }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
