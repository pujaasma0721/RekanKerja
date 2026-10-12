// P0-PERF — layanan bersama modul Performance: penomoran dokumen + helper
// bobot/skala (DEVELOPMENT-PLAN-PERFORMANCE.md §13 penomoran: PER|PRB|PIP|MER
// per tenant di PerformanceSetting; §16 formula otoritatif server).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

export type PerfDocKind = "appraisal" | "probation" | "pip" | "merit";

const KIND_PREFIX: Record<PerfDocKind, string> = {
  appraisal: "PER",
  probation: "PRB",
  pip: "PIP",
  merit: "MER",
};

/**
 * Nomor dokumen berikutnya pola {PREFIX}-{TAHUN}-{NNNN} (PER-2026-0001).
 * Prefix dasar dari PerformanceSetting.docPrefixes (urutan PER|PRB|PIP|MER),
 * bisa dioverride tenant. Delete-safe: scan max suffix yang ada.
 */
export async function nextPerfDocNo(db: TenantDb, kind: PerfDocKind, year = new Date().getFullYear()): Promise<string> {
  const setting = await db.performanceSetting.findFirst({ select: { docPrefixes: true } });
  const parts = (setting?.docPrefixes ?? "PER|PRB|PIP|MER").split("|");
  const fallback: Record<PerfDocKind, string> = { appraisal: "PER", probation: "PRB", pip: "PIP", merit: "MER" };
  const order: PerfDocKind[] = ["appraisal", "probation", "pip", "merit"];
  const idx = order.indexOf(kind);
  const prefix = (parts[idx] ?? fallback[kind] ?? KIND_PREFIX[kind]).trim() || KIND_PREFIX[kind];

  const like = `${prefix}-${year}-`;
  const scan = async (table: "AppraisalRecord" | "ProbationEvaluation" | "PipPlan" | "MeritRecommendation"): Promise<string> => {
    // scan max suffix via findFirst prefix match (kode pendek — aman)
    let max = 0;
    if (table === "AppraisalRecord") {
      const rows = await db.appraisalRecord.findMany({ where: { docNo: { startsWith: like } }, select: { docNo: true } });
      max = maxSuffix(rows.map((r) => r.docNo), like);
    } else if (table === "ProbationEvaluation") {
      const rows = await db.probationEvaluation.findMany({ where: { docNo: { startsWith: like } }, select: { docNo: true } });
      max = maxSuffix(rows.map((r) => r.docNo), like);
    } else if (table === "PipPlan") {
      const rows = await db.pipPlan.findMany({ where: { docNo: { startsWith: like } }, select: { docNo: true } });
      max = maxSuffix(rows.map((r) => r.docNo), like);
    } else {
      const rows = await db.meritRecommendation.findMany({ where: { docNo: { startsWith: like } }, select: { docNo: true } });
      max = maxSuffix(rows.map((r) => r.docNo), like);
    }
    return `${like}${String(max + 1).padStart(4, "0")}`;
  };
  if (kind === "appraisal") return scan("AppraisalRecord");
  if (kind === "probation") return scan("ProbationEvaluation");
  if (kind === "pip") return scan("PipPlan");
  return scan("MeritRecommendation");
}

function maxSuffix(values: string[], like: string): number {
  let max = 0;
  for (const v of values) {
    const suffix = Number(v.slice(like.length));
    if (Number.isFinite(suffix) && suffix > max) max = suffix;
  }
  return max;
}

/** Parse bobot "wKPI|wKomp|wCore" (default 70|20|10) — dipakai siklus & template. */
export function parseWeights(weightsJsonOrString: string | null | undefined): { kpi: number; competency: number; core: number } {
  if (!weightsJsonOrString) return { kpi: 70, competency: 20, core: 10 };
  const s = weightsJsonOrString.trim();
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as Record<string, number>;
      return { kpi: o.kpi ?? 70, competency: o.competency ?? 20, core: o.core ?? 10 };
    } catch { /* jatuh ke default */ }
  }
  const parts = s.split("|").map((x) => Number(x));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return { kpi: parts[0], competency: parts[1], core: parts[2] };
  }
  return { kpi: 70, competency: 20, core: 10 };
}

/** Lookup rating dari skor via RatingScale (otoritatif server — §16). */
export async function ratingOfScore(
  db: TenantDb,
  score: number,
): Promise<{ value: number; labelId: string; labelEn: string; color: string } | null> {
  const scales = await db.ratingScale.findMany({ orderBy: { minScore: "desc" } });
  for (const sc of scales) {
    if (score >= sc.minScore) return { value: sc.value, labelId: sc.labelId, labelEn: sc.labelEn, color: sc.color };
  }
  const last = scales[scales.length - 1];
  return last ? { value: last.value, labelId: last.labelId, labelEn: last.labelEn, color: last.color } : null;
}
