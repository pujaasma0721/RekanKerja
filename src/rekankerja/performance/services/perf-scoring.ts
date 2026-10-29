// P3-PERF — formula penilaian otoritatif server (DEVELOPMENT-PLAN-PERFORMANCE.md
// §16): skorKpiItem (Higher/Lower/Boolean + stretch 120), skor komponen,
// managerScore (wKPI×kpi + wKomp×komp + wCore×core), finalRating lookup
// RatingScale, penalti kritis Boolean (§4.5), dan estimasi dampak STATELESS
// (AMANDEMEN 3 §18.12: tanpa nominal Rp — D21).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { parseWeights, ratingOfScore } from "./perf-service";

/** Skor satu item KPI (§16) — clamp 0..120 (120 hanya bila stretch terdefinisi). */
export function scoreKpiItem(k: {
  polarity: string;
  thresholdMin: number | null;
  target: number;
  stretchValue: number | null;
  finalActual: number | null;
}): number | null {
  if (k.finalActual == null) return null;
  const A = k.finalActual;
  if (k.polarity === "Boolean") return A >= 1 ? 100 : 0;
  const F = k.thresholdMin ?? 0;
  const T = k.target;
  if (k.polarity === "Lower") {
    const s = T === F ? (A <= T ? 100 : 0) : ((F - A) / (F - T)) * 100;
    return clamp(s, 0, 100);
  }
  // Higher
  if (T === F) return A >= T ? 100 : 0;
  const s = ((A - F) / (T - F)) * 100;
  if (s >= 100 && k.stretchValue != null && k.stretchValue > T) {
    const s2 = 100 + ((A - T) / (k.stretchValue - T)) * 20;
    return clamp(s2, 0, 120);
  }
  return clamp(s, 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface KpiLike {
  polarity: string; thresholdMin: number | null; target: number; stretchValue: number | null;
  finalActual: number | null; weight: number; isCritical: boolean;
}
export interface CompLike {
  score: number; selfScore?: number | null; weight: number; kind?: string;
}

/** Skor komponen KPI = Σ skor × bobot ÷ Σ bobot. */
export function scoreKpiComponent(kpis: KpiLike[]): number | null {
  const valid = kpis.filter((k) => k.weight > 0);
  if (valid.length === 0) return null;
  let sum = 0;
  let wsum = 0;
  for (const k of valid) {
    const s = scoreKpiItem(k);
    if (s == null) continue; // masih belum lengkap → komponen belum final
    sum += s * k.weight;
    wsum += k.weight;
  }
  if (wsum === 0) return null;
  return sum / wsum;
}

/** Skor kompetensi (dinilai atasan; 1..5 → 0..100). */
export function scoreCompComponent(comps: { score: number; weight: number }[]): number | null {
  const valid = comps.filter((c) => c.weight > 0);
  if (valid.length === 0) return null;
  let sum = 0;
  let wsum = 0;
  for (const c of valid) {
    sum += (c.score / 5) * 100 * c.weight;
    wsum += c.weight;
  }
  if (wsum === 0) return null;
  return sum / wsum;
}

/** managerScore = wKPI×kpi + wKomp×komp + wCore×core (§16). null bila komponen belum lengkap. */
export function managerScoreOf(
  kpis: KpiLike[],
  comps: { score: number; weight: number; kind: string }[],
  weightsJson: string | null,
): { score: number | null; kpiScore: number | null; compScore: number | null; coreScore: number | null; kritisGagal: boolean } {
  const w = parseWeights(weightsJson);
  const kpiScore = scoreKpiComponent(kpis);
  const compItems = comps.filter((c) => c.kind !== "CoreValue");
  const coreItems = comps.filter((c) => c.kind === "CoreValue");
  const compScore = scoreCompComponent(compItems);
  const coreScore = scoreCompComponent(coreItems);
  const kritisGagal = kpis.some((k) => k.isCritical && k.polarity === "Boolean" && (k.finalActual ?? 0) < 1);
  let score: number | null = null;
  if (kpiScore != null && compScore != null && coreScore != null) {
    score = (w.kpi * kpiScore + w.competency * compScore + w.core * coreScore) / 100;
  }
  return { score, kpiScore, compScore, coreScore, kritisGagal };
}

/** Estimasi dampak STATELESS (§18.12, D21): draf nilai → {pScore, pRating, bonusMonths, raisePct}. */
export async function previewImpactCompute(
  db: TenantDb,
  input: {
    kpis: KpiLike[];
    comps: { score: number; weight: number; kind: string }[];
    weightsJson: string | null;
  },
): Promise<{
  pScore: number | null;
  pRating: { value: number; labelId: string; labelEn: string; color: string } | null;
  bonusMonths: number | null;
  raisePct: [number, number] | null;
  kpiScore: number | null;
  compScore: number | null;
  coreScore: number | null;
  kritisGagal: boolean;
  completeness: { kpiFilled: number; kpiTotal: number; compFilled: number; compTotal: number };
}> {
  const { score, kpiScore, compScore, coreScore, kritisGagal } = managerScoreOf(input.kpis, input.comps, input.weightsJson);
  const filled = input.kpis.filter((k) => k.finalActual != null).length;
  const compFilled = input.comps.filter((c) => c.score != null).length;
  let pRating: { value: number; labelId: string; labelEn: string; color: string } | null = null;
  let bonusMonths: number | null = null;
  let raisePct: [number, number] | null = null;
  if (score != null) {
    let rating = await ratingOfScore(db, score);
    if (rating && kritisGagal && rating.value > 2) {
      rating = await ratingOfScore(db, 69.99); // penalti kritis: rating maks 2 (§4.5)
    }
    pRating = rating;
    if (rating) {
      const matrix = await db.meritMatrix.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
      if (matrix) {
        try {
          const grid = JSON.parse(matrix.gridJson) as Record<string, { bonusMonths?: number; raisePct?: [number, number] }>;
          const cell = grid[String(rating.value)];
          if (cell) {
            bonusMonths = cell.bonusMonths ?? null;
            if (Array.isArray(cell.raisePct) && cell.raisePct.length === 2) raisePct = cell.raisePct;
          }
        } catch { /* grid tidak valid → kosong */ }
      }
    }
  }
  return {
    pScore: score,
    pRating,
    bonusMonths,
    raisePct,
    kpiScore,
    compScore,
    coreScore,
    kritisGagal,
    completeness: { kpiFilled: filled, kpiTotal: input.kpis.length, compFilled, compTotal: input.comps.length },
  };
}
