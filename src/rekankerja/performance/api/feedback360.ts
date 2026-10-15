import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  inviteReviewers, listInvitations, remindReviewer, listFlaggedAnswers, moderateAnswer, aiBiasScan,
  type InviteInput,
} from "@/rekankerja/performance/services/perf-360-service";

// ============================================================================
// PERFORMANCE — API 360-degree feedback admin (P3 — §17 feedback360):
//   GET  ?cycleId   → daftar undangan per siklus (kelola dari halaman Penilaian —
//                     TANPA menu key baru, pakai performance:appraisals §14.2)
//   GET  ?flagged=1&cycleId= → B2-BL antrean moderasi komentar ter-flag
//                     (Pending — D-BL7b; HR-only; TANPA identitas reviewer)
//   POST {action: invite|remind}
//   POST {action: moderate, answerId, decision} → B2-BL keputusan HR
//                     Setujui/Redaksi komentar ter-flag (HR-only, D-BL7b)
//   POST {action: aiScan, answerId, lang} → B2-BL deep-scan AI advisori atas
//                     komentar Pending (HR-only, D-BL8 rate-limit 20/jam)
// Submit/decline reviewer via ESS ess/my-360 (anonim §37).
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:appraisals", "performance:cycles"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const sp = req.nextUrl.searchParams;

    // B2-BL — antrean moderasi HR (komentar Pending). HR-only (superAdmin):
    // isi komentar belum keputusan HR tidak boleh dibaca atasan/manajer.
    if (sp.get("flagged") === "1") {
      const actor = goalActorOf(m.actor);
      if (!actor.superAdmin) {
        return NextResponse.json({ error: "Antrean moderasi komentar 360 hanya untuk HR (D-BL7b)" }, { status: 403 });
      }
      const rows = await listFlaggedAnswers(m.db, sp.get("cycleId") ?? undefined);
      return NextResponse.json({ rows });
    }

    const cycleId = sp.get("cycleId");
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
    // kunci rate-limit AI per pengguna (pola appraisals.ts aiCompose)
    const actorKey = m.actor.appUserId ?? m.actor.employeeId ?? m.actor.userId;

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
      case "moderate": {
        // B2-BL (D-BL7b) — HR only (superAdmin; service melempar 403-map).
        const decision = b.decision === "Redacted" ? "Redacted" : b.decision === "Approved" ? "Approved" : "";
        if (!decision) return NextResponse.json({ error: "Keputusan moderasi harus Approved atau Redacted" }, { status: 400 });
        const out = await moderateAnswer(m.db, actor, String(b.answerId ?? ""), decision);
        return NextResponse.json(out);
      }
      case "aiScan": {
        // B2-BL (D-BL8) — deep-scan AI advisori HR; kegagalan TENANG (200+flag)
        const out = await aiBiasScan(m.db, actorKey, m.actor.employeeId, String(b.answerId ?? ""), b.lang === "en" ? "en" : "id");
        return NextResponse.json(out);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    // guard HR-only → 403 eksplisit (pola menu-access; bukan 400)
    if (e instanceof Error && /hanya oleh HR/i.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
