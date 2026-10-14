import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { myInvitations, declineInvitation, submit360, type Answer360Input } from "@/rekankerja/performance/services/perf-360-service";
import { aiCompose } from "@/rekankerja/performance/services/perf-appraisal-service";

// ============================================================================
// PERFORMANCE — ESS "360 Saya" (P3 — §17 ess/my-360, Alur 5 §29-3, §37 PDP):
//   GET  → undangan saya (status Invited) + yang sudah submit (read-only view)
//   POST {action: decline, id}            → tolak undangan sendiri
//   POST {action: submit, id, answers}    → isian kompetensi 1–5 + komentar
//        (ANONIM: identitas reviewer tidak pernah keluar — agregat ≥3 §37)
//   POST {action: aiCompose, scope:"360"} → AI assist komentar reviewer (AM3
//        §18.11 — identitas reviewer tak pernah dikirim ke model, D20).
// Guard: requireEss (self-scope anti-IDOR — hanya undangan milik reviewer).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  try {
    const rows = await myInvitations(m.actor.db, m.actor.employeeId);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");

    if (action === "decline") {
      await declineInvitation(db, employeeId, String(b.id ?? ""));
      await db.activityLog.create({
        data: {
          employeeId,
          action: "Cancelled", entity: "Feedback360", entityId: String(b.id ?? ""),
          detail: "Reviewer menolak undangan 360 (Declined)",
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "submit") {
      const answers = (Array.isArray(b.answers) ? b.answers : []) as Answer360Input[];
      const out = await submit360(db, employeeId, String(b.id ?? ""), answers);
      await db.activityLog.create({
        data: {
          // ANONIMITAS: log ESS hanya mencatat jumlah baris — bukan isi komentar
          employeeId,
          action: "Submitted", entity: "Feedback360", entityId: String(b.id ?? ""),
          detail: `Isian 360 submitted: ${out.answered} kompetensi (identitas dirahasiakan §37)`,
        },
      });
      return NextResponse.json(out, { status: 201 });
    }

    if (action === "aiCompose") {
      const out = await aiCompose(
        db,
        { employeeId, superAdmin: false },
        `ess:${employeeId}`,
        {
          scope: "360",
          appraisalId: String(b.appraisalId ?? ""),
          competencyId: b.competencyId != null ? String(b.competencyId) : undefined,
          points: (Array.isArray(b.points) ? b.points : []).map(String),
          tone: (b.tone === "encouraging" || b.tone === "firm" ? b.tone : "neutral"),
          length: b.length === "medium" ? "medium" : "short",
          lang: b.lang === "en" ? "en" : "id",
        },
      );
      return NextResponse.json(out); // unavailable → 200 + flag (kegagalan tenang)
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
