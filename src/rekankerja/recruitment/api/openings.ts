import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { parseAdvSearchReq } from "@/rekankerja/shared/services/adv-search-server";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import {
  listJos, getJo, createJo, updateJo, addSlot, updateSlot, postJo, closeJo, obsoleteJo, closeSlot,
  upsertMethod, deleteMethod,
  type JoInput, type SlotInput, type MethodInput,
} from "@/rekankerja/recruitment/services/opening-service";

// ============================================================================
// RECRUITMENT F2 — API JobOpportunity (lowongan) + slot + kanal biaya
// DEVELOPMENT-PLAN-RECRUITMENT.md §5 (F2) + §7 F2.
//   GET    ?id= | ?status=&q=&adv=&sortBy=&sortDir=&limit=&offset=  → { rows|row, total, stats }
//   POST   { …header, postNow?, slots: [...] }                      → buat JO
//   PATCH  { action: update|post|close|obsolete|add-slot|update-slot|close-slot
//           |upsert-method|delete-method, … }                        → transisi/aksi
//   DELETE ?methodId=                                               → hapus kanal
// Guard menu: recruitment:openings (view/create/update/delete +
// op:post/close/obsolete). ActivityLog di service. Notifikasi in-app saat
// JO dipublikasikan (link recruitment:openings).
// ============================================================================

// GET /api/rekankerja/recruitment/openings
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:openings", "recruitment:pr"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const mv = await moneyViewForReq(req, db);

    if (id) {
      const row = await getJo(db, id, mv.canSee);
      if (!row) return NextResponse.json({ error: "Lowongan tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row });
    }

    const res = await listJos(db, {
      status: sp.get("status"),
      q: sp.get("q"),
      adv: parseAdvSearchReq(req),
      limit: Number(sp.get("limit") ?? 20),
      offset: Number(sp.get("offset") ?? 0),
      sortBy: sp.get("sortBy"),
      sortDir: sp.get("sortDir"),
      moneyVisible: mv.canSee,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/recruitment/openings — buat JO (Draft / langsung Posted)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const m = await requireMenuAction(req, "recruitment:openings", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const input: JoInput = {
      title: String(b.title ?? ""),
      contactPerson: b.contactPerson || null,
      lastAcceptDate: b.lastAcceptDate || null,
      content: b.content || null,
      preparedById: b.preparedById || m.actor.employeeId || null,
      postNow: b.postNow === true,
      slots: Array.isArray(b.slots) ? b.slots.map((s: Record<string, unknown>) => ({
        prId: String(s.prId ?? ""),
        titleToShow: s.titleToShow ? String(s.titleToShow) : undefined,
        workLocationId: s.workLocationId ? String(s.workLocationId) : null,
        salaryMin: s.salaryMin != null && s.salaryMin !== "" ? Number(s.salaryMin) : null,
        salaryMax: s.salaryMax != null && s.salaryMax !== "" ? Number(s.salaryMax) : null,
        jobDescSummary: s.jobDescSummary || null,
        jobSpecSummary: s.jobSpecSummary || null,
      })) : [],
    };
    const row = await createJo(db, input, m.actor.name);

    if (row.status === "Posted") {
      void notifyEvent(db, {
        to: "admins", docType: "JobOpportunity", docNo: row.refNo, docId: row.id,
        title: `Lowongan ${row.refNo} dipublikasikan`,
        body: `${row.title} — ${row.slots.length} slot aktif di portal karir`,
        kind: "recruitment", link: "recruitment:openings",
      }).catch(() => {});
    }
    return NextResponse.json({ row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH /api/rekankerja/recruitment/openings — aksi + update
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "update");
    const op: MenuActionRef =
      action === "post" ? "op:post" :
      action === "close" ? "op:close" :
      action === "obsolete" ? "op:obsolete" :
      b.id ? "update" : "create";
    const m = await requireMenuAction(req, "recruitment:openings", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const note = b.note ? String(b.note) : null;

    if (action === "update" && b.id) {
      const row = await updateJo(db, String(b.id), {
        title: b.title != null ? String(b.title) : undefined,
        contactPerson: b.contactPerson !== undefined ? (b.contactPerson || null) : undefined,
        lastAcceptDate: b.lastAcceptDate !== undefined ? (b.lastAcceptDate || null) : undefined,
        content: b.content !== undefined ? (b.content || null) : undefined,
      }, m.actor.name);
      return NextResponse.json({ row });
    }

    if (action === "post") {
      const res = await postJo(db, String(b.id), m.actor.name);
      const row = await getJo(db, String(b.id), true);
      void notifyEvent(db, {
        to: "admins", docType: "JobOpportunity", docNo: res.refNo, docId: String(b.id),
        title: `Lowongan ${res.refNo} dipublikasikan`,
        body: `${row?.title ?? ""} — slot aktif tampil di portal karir`,
        kind: "recruitment", link: "recruitment:openings",
      }).catch(() => {});
      return NextResponse.json(res);
    }

    if (action === "close") {
      const res = await closeJo(db, String(b.id), note, m.actor.name);
      void notifyEvent(db, {
        to: "admins", docType: "JobOpportunity", docNo: res.refNo,
        title: `Lowongan ${res.refNo} ditutup`,
        body: note ? `Catatan: ${note}` : "Slot lowongan ditutup dari portal karir.",
        kind: "recruitment", link: "recruitment:openings",
      }).catch(() => {});
      return NextResponse.json(res);
    }

    if (action === "obsolete") {
      const res = await obsoleteJo(db, String(b.id), note, m.actor.name);
      return NextResponse.json(res);
    }

    if (action === "add-slot" && b.id) {
      const slot: SlotInput = {
        prId: String(b.prId ?? ""),
        titleToShow: b.titleToShow ? String(b.titleToShow) : undefined,
        workLocationId: b.workLocationId || null,
        salaryMin: b.salaryMin != null && b.salaryMin !== "" ? Number(b.salaryMin) : null,
        salaryMax: b.salaryMax != null && b.salaryMax !== "" ? Number(b.salaryMax) : null,
        jobDescSummary: b.jobDescSummary || null,
        jobSpecSummary: b.jobSpecSummary || null,
      };
      const row = await addSlot(db, String(b.id), slot, m.actor.name);
      return NextResponse.json({ row });
    }

    if (action === "update-slot" && b.slotId) {
      await updateSlot(db, String(b.slotId), {
        titleToShow: b.titleToShow != null ? String(b.titleToShow) : undefined,
        workLocationId: b.workLocationId !== undefined ? (b.workLocationId || null) : undefined,
        salaryMin: b.salaryMin !== undefined ? (b.salaryMin === "" || b.salaryMin == null ? null : Number(b.salaryMin)) : undefined,
        salaryMax: b.salaryMax !== undefined ? (b.salaryMax === "" || b.salaryMax == null ? null : Number(b.salaryMax)) : undefined,
        jobDescSummary: b.jobDescSummary !== undefined ? (b.jobDescSummary || null) : undefined,
        jobSpecSummary: b.jobSpecSummary !== undefined ? (b.jobSpecSummary || null) : undefined,
      }, m.actor.name);
      return NextResponse.json({ ok: true });
    }

    if (action === "close-slot" && b.slotId) {
      await closeSlot(db, String(b.slotId), m.actor.name);
      return NextResponse.json({ ok: true });
    }

    if (action === "upsert-method") {
      const input: MethodInput = {
        id: b.id ? String(b.id) : undefined,
        jobOpportunityId: b.jobOpportunityId ? String(b.jobOpportunityId) : undefined,
        methodId: String(b.methodId ?? ""),
        adMediaTypeId: b.adMediaTypeId || null,
        agencyId: b.agencyId || null,
        costItemId: b.costItemId || null,
        plannedCost: b.plannedCost != null && b.plannedCost !== "" ? Number(b.plannedCost) : null,
        actualCost: b.actualCost != null && b.actualCost !== "" ? Number(b.actualCost) : null,
        datePosted: b.datePosted || null,
        note: b.note || null,
      };
      await upsertMethod(db, input, m.actor.name);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete-method" && b.id) {
      await deleteMethod(db, String(b.id), m.actor.name);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/recruitment/openings?methodId= — hapus kanal biaya
export async function DELETE(req: NextRequest) {
  try {
    const methodId = req.nextUrl.searchParams.get("methodId");
    if (!methodId) return NextResponse.json({ error: "methodId wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:openings", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    await deleteMethod(m.db, methodId, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
