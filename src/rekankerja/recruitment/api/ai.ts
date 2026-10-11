import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import {
  parseCvText, parseCvDocument, verifyCvParse, latestCvParse,
} from "@/rekankerja/recruitment/services/ai-cv-service";
import {
  saveRubric, getRubric, generateAiScore, latestScores,
} from "@/rekankerja/recruitment/services/ai-score-service";
import {
  aiSearch, copilotAction, COPILOT_ACTIONS,
} from "@/rekankerja/recruitment/services/ai-search-service";

// ============================================================================
// RECRUITMENT F6a — API CV Intelligence (parsing CV + human-verify).
// DEVELOPMENT-PLAN-RECRUITMENT.md §7 F6a (HRX B1).
//   GET  ?applicantId=                       → { parse: CvParseSerializer | null }
//   POST { action:"parse-text",    applicantId, text, mode? }     → { parse }
//   POST { action:"parse-document",applicantId, documentId, mode? } → { parse }
//   POST { action:"verify",        parseId }                      → { ok }
// Guard menu: recruitment:applicants — op:parse-cv (parse*) / update (verify).
// parse-text → sourceKind "paste"; parse-document → pdf|docx|txt (ekstraksi).
// mode: "auto" (default, AI→fallback simulated) | "simulated" | "ai".
//
// RECRUITMENT F6b — skor AI explainable (HRX B2).
//   GET  ?rubric=<prId>                            → { rubric }
//   POST { action:"score"|"save-rubric"|"latest-scores", … }  (op:score)
//
// RECRUITMENT F6c — pencarian NL + Recruiter Copilot + bias check (HRX B4/B5/B6).
//   GET  ?q=<query natural language>               → { mode, interpreted, rows, total }
//   POST { action:"copilot", params:{ action, … } }            → { mode, text }
//   POST { action:"draft-jd"|"summarize-candidate"|"interview-questions"
//        |"outreach"|"pipeline-qa"|"check-bias", params:{…} } → { mode, text }
// Guard menu: recruitment:applicants op:search-ai (GET ?q) /
//             recruitment:selection  op:copilot   (POST copilot*).
// ============================================================================

// GET /api/rekankerja/recruitment/ai
//   ?q=            → { mode, interpreted, rows, total }   (F6c — NL search)
//   ?applicantId=  → { parse: CvParseSerializer | null }  (F6a)
//   ?rubric=<prId>  → { rubric: RubricFactor[] }            (F6b)
export async function GET(req: NextRequest) {
  try {
    const qParam = req.nextUrl.searchParams.get("q");
    if (qParam !== null) {
      const m = await requireMenuAction(req, "recruitment:applicants", "op:search-ai");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const mv = await moneyViewForReq(req, m.db);
      try {
        const res = await aiSearch(m.db, {
          q: qParam,
          limit: Number(req.nextUrl.searchParams.get("limit") ?? 20),
          moneyVisible: mv.canSee,
        });
        return NextResponse.json(res);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    const rubricPrId = req.nextUrl.searchParams.get("rubric");
    if (rubricPrId) {
      const m = await requireMenuAction(req, "recruitment:selection", "op:score");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const rubric = await getRubric(m.db, rubricPrId);
      return NextResponse.json({ rubric });
    }

    const m = await requireMenuAction(req, "recruitment:applicants", "op:parse-cv");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const applicantId = req.nextUrl.searchParams.get("applicantId");
    if (!applicantId) return NextResponse.json({ error: "applicantId wajib" }, { status: 400 });
    const parse = await latestCvParse(m.db, applicantId);
    return NextResponse.json({ parse });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — parse teks / parse dokumen / verifikasi manusia (F6a)
//      + skor AI / rubrik / skor terbaru (F6b)
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");

    if (action === "parse-text" || action === "parse-document") {
      const m = await requireMenuAction(req, "recruitment:applicants", "op:parse-cv");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const applicantId = String(b.applicantId ?? "");
      if (!applicantId) return NextResponse.json({ error: "applicantId wajib" }, { status: 400 });
      const mode = b.mode === "simulated" ? "simulated" : b.mode === "ai" ? "ai" : "auto";

      if (action === "parse-text") {
        const text = typeof b.text === "string" ? b.text : "";
        if (!text.trim()) return NextResponse.json({ error: "Teks CV wajib diisi" }, { status: 400 });
        const parse = await parseCvText(m.db, { applicantId, sourceKind: "paste", text, mode });
        return NextResponse.json({ parse }, { status: 201 });
      }

      const documentId = String(b.documentId ?? "");
      if (!documentId) return NextResponse.json({ error: "documentId wajib" }, { status: 400 });
      try {
        const parse = await parseCvDocument(m.db, { applicantId, documentId, mode });
        return NextResponse.json({ parse }, { status: 201 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ error: msg }, { status: msg.includes("tidak ditemukan") ? 404 : 400 });
      }
    }

    if (action === "verify") {
      const m = await requireMenuAction(req, "recruitment:applicants", "update");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const parseId = String(b.parseId ?? "");
      if (!parseId) return NextResponse.json({ error: "parseId wajib" }, { status: 400 });
      if (!m.actor.employeeId) {
        return NextResponse.json(
          { error: "Akun Anda tidak terhubung ke profil karyawan — verifikasi CV butuh identitas karyawan" },
          { status: 400 },
        );
      }
      try {
        await verifyCvParse(m.db, { parseId, employeeId: m.actor.employeeId });
        return NextResponse.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ error: msg }, { status: msg.includes("tidak ditemukan") ? 404 : 400 });
      }
    }

    // ---- F6b: skor AI + rubrik (recruitment:selection — op:score) ----

    if (action === "score") {
      const m = await requireMenuAction(req, "recruitment:selection", "op:score");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const candidateId = String(b.candidateId ?? "");
      if (!candidateId) return NextResponse.json({ error: "candidateId wajib" }, { status: 400 });
      if (!m.actor.employeeId) {
        return NextResponse.json({ error: "Akun Anda tidak terhubung ke profil karyawan — generate skor butuh identitas karyawan" }, { status: 400 });
      }
      const mode = b.mode === "simulated" ? "simulated" : b.mode === "ai" ? "ai" : "auto";
      try {
        const score = await generateAiScore(m.db, {
          candidateId,
          mode,
          generatedById: m.actor.employeeId,
          generatedByName: m.actor.name,
        });
        return NextResponse.json({ score }, { status: 201 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ error: msg }, { status: msg.includes("tidak ditemukan") ? 404 : 400 });
      }
    }

    if (action === "save-rubric") {
      const m = await requireMenuAction(req, "recruitment:selection", "op:score");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const prId = String(b.prId ?? "");
      if (!prId) return NextResponse.json({ error: "prId wajib" }, { status: 400 });
      const raw = Array.isArray(b.factors) ? b.factors : [];
      const factors: { name: string; weight: number; guide?: string | null }[] = raw
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({
          name: String(f.name ?? ""),
          weight: Number(f.weight ?? 0),
          guide: f.guide != null ? String(f.guide) : null,
        }));
      try {
        const rubric = await saveRubric(m.db, prId, factors);
        return NextResponse.json({ rubric });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ error: msg }, { status: msg.includes("tidak ditemukan") ? 404 : 400 });
      }
    }

    if (action === "latest-scores") {
      const m = await requireMenuAction(req, "recruitment:selection", "op:score");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const prId = b.prId ? String(b.prId) : undefined;
      const candidateIds = Array.isArray(b.candidateIds) ? b.candidateIds.map((x: unknown) => String(x)).filter(Boolean) : undefined;
      if (!prId && (!candidateIds || candidateIds.length === 0)) {
        return NextResponse.json({ error: "prId atau candidateIds wajib" }, { status: 400 });
      }
      const scores = await latestScores(m.db, { prId, candidateIds });
      return NextResponse.json({ scores });
    }

    // ---- F6c: Recruiter Copilot (draft JD / ringkas / interview / outreach /
    // pipeline QA / check bias) — recruitment:selection op:copilot ----

    const isCopilotWrap = action === "copilot";
    const isCopilotDirect = (COPILOT_ACTIONS as readonly string[]).includes(action);
    if (isCopilotWrap || isCopilotDirect) {
      const m = await requireMenuAction(req, "recruitment:selection", "op:copilot");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      // dua bentuk body diterima:
      //   { action:"copilot", params:{ action:"draft-jd", prId, … } }  (wrapper)
      //   { action:"draft-jd", params:{ prId, … } }                      (langsung)
      const wrapParams = isCopilotWrap && b.params && typeof b.params === "object"
        ? (b.params as Record<string, unknown>)
        : null;
      const copAction = wrapParams ? String(wrapParams.action ?? "") : action;
      const copParams = wrapParams ?? (b.params && typeof b.params === "object" ? b.params : {});
      try {
        const res = await copilotAction(m.db, { action: copAction, params: copParams });
        return NextResponse.json(res);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({ error: msg }, { status: msg.includes("tidak ditemukan") ? 404 : 400 });
      }
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action || "(kosong)"}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
