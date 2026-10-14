import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import { inviteReviewers, listInvitations, remindReviewer, type InviteInput } from "@/rekankerja/performance/services/perf-360-service";

// ============================================================================
// PERFORMANCE — API 360-degree feedback admin (P3 — §17 feedback360):
//   GET  ?cycleId   → daftar undangan per siklus (kelola dari halaman Penilaian —
//                     TANPA menu key baru, pakai performance:appraisals §14.2)
//   POST {action: invite|remind}
// Submit/decline reviewer via ESS ess/my-360 (anonim §37).
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:appraisals", "performance:cycles"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const cycleId = req.nextUrl.searchParams.get("cycleId");
    if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
    const rows = await listInvitations(m.db, cycleId);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const m = await requireMenuAction(req, "performance:appraisals", action === "invite" ? "update" : "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const actor = goalActorOf(m.actor);

    switch (action) {
      case "invite": {
        const reviewers = (Array.isArray(b.reviewers) ? b.reviewers : []) as InviteInput[];
        const out = await inviteReviewers(m.db, actor, String(b.appraisalId ?? ""), reviewers, b.dueAt);
        await m.db.activityLog.create({
          data: {
            action: "Created", entity: "Feedback360", entityId: String(b.appraisalId ?? ""),
            detail: `Undang reviewer 360: ${out.invited.length} terkirim · ${out.skippedDuplicate.length} duplikat · ${out.skippedSelf.length} peserta sendiri (§29-3)`,
          },
        });
        return NextResponse.json({ report: out });
      }
      case "remind": {
        const out = await remindReviewer(m.db, actor, String(b.id ?? ""));
        await m.db.activityLog.create({
          data: {
            action: "Nudged", entity: "Feedback360", entityId: String(b.id ?? ""),
            detail: `Pengingat 360 in-app terkirim ke reviewer (bukan nudge formal — §B-7)`,
          },
        }).catch(() => { /* best effort */ });
        return NextResponse.json(out);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
