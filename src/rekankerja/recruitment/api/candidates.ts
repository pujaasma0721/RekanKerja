import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import {
  nominateApplicant, nominateEmployee, updateCandidateNote, deleteCandidate,
  nominationOptions,
} from "@/rekankerja/recruitment/services/candidate-service";
import { listCandidates, getCandidateDetail } from "@/rekankerja/recruitment/services/selection-service";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";

// ============================================================================
// RECRUITMENT F3 — API JobCandidate (transfer/nominasi kandidat PR).
//   GET    ?options=1                       → { prs, employees } (picker)
//   GET    ?prId=&status=                   → { rows }
//   GET    ?id=                            → { row } detail (PII penuh HR)
//   POST   { prId, applicantId|employeeId, note } → nominasi
//   PATCH  { id, action: "note"|"withdraw", note }
//   DELETE ?id=                            → hapus (belum ada tahap dilaksanakan)
// Guard: recruitment:candidates (view + op:nominate / op:withdraw).
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:candidates", "recruitment:selection"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    if (sp.get("options")) {
      return NextResponse.json(await nominationOptions(db));
    }
    const id = sp.get("id");
    if (id) {
      const mv = await moneyViewForReq(req, db);
      const row = await getCandidateDetail(db, id, mv.canSee);
      if (!row) return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row });
    }
    const res = await listCandidates(db, {
      prId: sp.get("prId"),
      status: sp.get("status"),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "recruitment:candidates", "op:nominate");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json()) as Record<string, unknown>;
    const prId = String(b.prId ?? "");
    const applicantId = b.applicantId ? String(b.applicantId) : null;
    const employeeId = b.employeeId ? String(b.employeeId) : null;
    const note = b.note ? String(b.note) : null;
    if (!prId) return NextResponse.json({ error: "PR wajib dipilih" }, { status: 400 });
    if (!applicantId && !employeeId) return NextResponse.json({ error: "Pilih pelamar talent pool atau karyawan internal" }, { status: 400 });

    const res = applicantId
      ? await nominateApplicant(db, {
          prId, applicantId, note,
          nominatedById: m.actor.employeeId ?? null, actorName: m.actor.name,
        })
      : await nominateEmployee(db, {
          prId, employeeId: employeeId!, note,
          nominatedById: m.actor.employeeId ?? null, actorName: m.actor.name,
        });

    // notifikasi officer PR / admin
    void notifyEvent(db, {
      to: "admins", docType: "RecruitmentSelection", docNo: res.prNo,
      title: `Kandidat baru — ${res.fullName}`,
      body: `${res.fullName} (${res.source}) dinominasikan ke proses seleksi — ${res.stepsCreated} tahap dibuat`,
      kind: "recruitment", link: "recruitment:selection",
    }).catch(() => {});

    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const id = String(b.id ?? "");
    const note = b.note ? String(b.note) : null;
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    if (action === "note") {
      const m = await requireMenuAction(req, "recruitment:candidates", "update");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      await updateCandidateNote(m.db, id, note, m.actor.name);
      return NextResponse.json({ ok: true });
    }
    if (action === "withdraw") {
      const m = await requireMenuAction(req, "recruitment:candidates", "op:withdraw");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const { withdrawCandidate } = await import("@/rekankerja/recruitment/services/selection-service");
      await withdrawCandidate(m.db, { candidateId: id, note, actorName: m.actor.name });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "recruitment:candidates", "op:withdraw");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await deleteCandidate(m.db, id, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
