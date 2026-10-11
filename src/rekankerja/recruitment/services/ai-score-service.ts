// ============================================================================
// RECRUITMENT F6b — AI Scoring service (HRX B2 — skor explainable).
// DEVELOPMENT-PLAN-RECRUITMENT.md §7 F6b + §4.3.
//
// Rubrik no-code per PR (PersonnelRequisition.rubricJson — [{name, weight,
// guide}]) → snapshot ke setiap CandidateAiScore saat generate. Skor = Σ
// (bobot ternormalisasi × skor faktor 0–100) — REKOMENDASI saja, keputusan
// tetap manusia (P2). Mode hasil eksplisit:
//   • "ai"        — faktor dinilai LLM via aiComplete (satu-satunya gerbang,
//                   aturan §2.4 — tidak pernah import SDK langsung);
//   • "simulated" — heuristik deterministik dari profil pelamar (berlabel,
//                   TIDAK pernah mengklaim AI — D7);
//   • "auto"      — coba AI, gagal/timeout → fallback simulated.
// Setiap faktor WAJIB punya evidence (kutipan bukti) — tidak ada black-box.
// ============================================================================

import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { aiComplete } from "@/rekankerja/shared/services/ai-provider";

// ============ kontrak serializer (dipakai UI board/detail F6) ============

/** Satu faktor rubrik (no-code — disimpan di PR.rubricJson). */
export interface RubricFactor {
  name: string;
  /** bobot relatif 0–1 — dinormalisasi service saat generate. */
  weight: number;
  guide?: string | null;
}

/** Satu faktor hasil skor (factorsJson CandidateAiScore). */
export interface ScoreFactor {
  factor: string;
  weight: number;
  score: number; // 0–100
  contribution: number; // weight × score (porsi total)
  evidence: string;
}

export interface AiScoreSerializer {
  id: string;
  candidateId: string;
  candidateName: string;
  prNo: string;
  total: number; // 0–100
  mode: string; // ai|simulated
  model: string | null;
  generatedAt: string;
  generatedByName: string | null;
  factors: ScoreFactor[];
}

/** Rubrik default bila PR belum punya rubricJson (3 faktor generik). */
export const DEFAULT_RUBRIC: RubricFactor[] = [
  { name: "Pendidikan & Sertifikasi", weight: 0.3, guide: "Relevansi jenjang & bidang studi dengan kebutuhan posisi" },
  { name: "Relevansi Pengalaman", weight: 0.4, guide: "Lama & kedekatan pengalaman kerja dengan peran yang dilamar" },
  { name: "Keahlian Teknis", weight: 0.3, guide: "Penguasaan tools/metode kunci posisi" },
];

const MAX_FACTORS = 8;

// ============ rubrik (no-code per PR) ============

/** Simpan rubrik PR — validasi + normalisasi bobot proporsional Σ=1. */
export async function saveRubric(db: TenantDb, prId: string, factors: { name: string; weight: number; guide?: string | null }[]): Promise<RubricFactor[]> {
  const pr = await db.personnelRequisition.findUnique({ where: { id: prId }, select: { prNo: true } });
  if (!pr) throw new Error("PR tidak ditemukan");

  const cleaned: RubricFactor[] = [];
  const seen = new Set<string>();
  for (const f of factors) {
    const name = f.name?.trim() ?? "";
    if (name.length < 3) throw new Error("Nama faktor rubrik minimal 3 karakter");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Faktor rubrik duplikat: "${name}"`);
    seen.add(key);
    const w = Number(f.weight);
    if (!Number.isFinite(w) || w < 0) throw new Error(`Bobot faktor "${name}" harus angka ≥ 0`);
    cleaned.push({ name: name.slice(0, 80), weight: Math.round(w * 1000) / 1000, guide: f.guide?.trim()?.slice(0, 300) || null });
  }
  if (cleaned.length < 1 || cleaned.length > MAX_FACTORS) throw new Error(`Rubrik harus 1–${MAX_FACTORS} faktor`);
  if (cleaned.every((c) => c.weight === 0)) cleaned.forEach((c) => { c.weight = 1; }); // semua nol → rata
  const sum = cleaned.reduce((s, c) => s + c.weight, 0);
  const norm = cleaned.map((c) => ({ ...c, weight: Math.round((c.weight / sum) * 1000) / 1000 }));

  await db.personnelRequisition.update({ where: { id: prId }, data: { rubricJson: JSON.stringify(norm) } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PersonnelRequisition", entityId: pr.prNo,
      detail: `Rubrik skor AI ${pr.prNo} disimpan: ${norm.length} faktor (${norm.map((n) => `${n.name} ${(n.weight * 100).toFixed(0)}%`).join(", ")})`,
    },
  });
  return norm;
}

/** Baca rubrik PR (fallback DEFAULT_RUBRIC bila belum di-set / rusak). */
export async function getRubric(db: TenantDb, prId: string): Promise<RubricFactor[]> {
  const pr = await db.personnelRequisition.findUnique({ where: { id: prId }, select: { rubricJson: true } });
  return parseRubric(pr?.rubricJson);
}

function parseRubric(json: string | null | undefined): RubricFactor[] {
  if (!json) return DEFAULT_RUBRIC.map((f) => ({ ...f }));
  try {
    const arr = JSON.parse(json) as { name?: unknown; weight?: unknown; guide?: unknown }[];
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_RUBRIC.map((f) => ({ ...f }));
    const out: RubricFactor[] = [];
    for (const f of arr.slice(0, MAX_FACTORS)) {
      const name = typeof f.name === "string" ? f.name.trim() : "";
      const w = Number(f.weight);
      if (!name || !Number.isFinite(w) || w < 0) continue;
      out.push({ name: name.slice(0, 80), weight: w, guide: typeof f.guide === "string" ? f.guide : null });
    }
    if (out.length === 0) return DEFAULT_RUBRIC.map((f) => ({ ...f }));
    const sum = out.reduce((s, c) => s + c.weight, 0) || 1;
    return out.map((c) => ({ ...c, weight: c.weight / sum }));
  } catch {
    return DEFAULT_RUBRIC.map((f) => ({ ...f }));
  }
}

// ============ profil kandidat (bahan penilaian) ============

interface CandidateProfile {
  candidateName: string;
  source: string; // External|Internal
  prNo: string;
  positionTitle: string | null;
  jobDesc: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  expectedSalary: number | null;
  education: { level: string; fieldOfStudy: string | null; institution: string | null; graduationYear: number | null; gpa: number | null }[];
  experiences: { position: string | null; company: string | null; years: number | null }[];
  skills: string[];
  totalExpYears: number;
}

async function buildProfile(db: TenantDb, candidateId: string): Promise<{ profile: CandidateProfile; prId: string; candidateRow: { id: string; fullName: string; status: string } }> {
  const c = await db.jobCandidate.findUnique({
    where: { id: candidateId },
    include: {
      pr: {
        select: {
          id: true, prNo: true, position: { select: { title: true } },
          openings: { select: { salaryMin: true, salaryMax: true, jobDescSummary: true, jobSpecSummary: true }, take: 1 },
        },
      },
      applicant: {
        select: {
          expectedSalary: true, totalExpMonths: true,
          educations: { orderBy: { graduationYear: "desc" } },
          experiences: true,
          skills: { include: { skill: { select: { name: true } } } },
        },
      },
    },
  });
  if (!c) throw new Error("Kandidat tidak ditemukan");

  const slot = c.pr.openings[0];
  // dekripsi ekspektasi gaji pelamar (vault uang — string cipher enc:v1:n:…)
  let expectedSalary: number | null = null;
  if (c.applicant?.expectedSalary) {
    const { tenantCryptoForDb } = await import("@/rekankerja/shared/lib/field-crypto");
    try {
      expectedSalary = tenantCryptoForDb(db).decryptMoney(String(c.applicant.expectedSalary)) ?? null;
    } catch { expectedSalary = null; }
  }

  const experiences = (c.applicant?.experiences ?? []).map((e) => {
    const years = e.months != null && e.months > 0
      ? Math.round((e.months / 12) * 10) / 10
      : e.startYear ? Math.max(0, (e.endYear ?? new Date().getFullYear()) - e.startYear) : null;
    return { position: e.position, company: e.company, years };
  });
  const totalExpYears = Math.round(((c.applicant?.totalExpMonths ?? 0) / 12) * 10) / 10
    || experiences.reduce((s, e) => s + (e.years ?? 0), 0);

  return {
    prId: c.pr.id,
    candidateRow: { id: c.id, fullName: c.fullName, status: c.status },
    profile: {
      candidateName: c.fullName,
      source: c.source,
      prNo: c.pr.prNo,
      positionTitle: c.pr.position?.title ?? null,
      jobDesc: slot?.jobDescSummary ?? slot?.jobSpecSummary ?? null,
      salaryMin: slot?.salaryMin ?? null,
      salaryMax: slot?.salaryMax ?? null,
      expectedSalary,
      education: (c.applicant?.educations ?? []).map((e) => ({
        level: e.level, fieldOfStudy: e.fieldOfStudy, institution: e.institution, graduationYear: e.graduationYear, gpa: e.gpa,
      })),
      experiences,
      skills: (c.applicant?.skills ?? []).map((s) => s.skill?.name).filter((n): n is string => !!n),
      totalExpYears,
    },
  };
}

// ============ heuristik simulated (deterministik, berlabel) ============

/** Token kata ≥ 4 huruf utk ukur relevansi teks. */
function tokens(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4) out.add(w);
  }
  return out;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function eduScore(p: CandidateProfile): { score: number; evidence: string } {
  const LEVEL: Record<string, number> = { SMP: 30, SMA: 40, SMK: 45, D3: 60, S1: 70, S2: 82, S3: 92, PROF: 85 };
  const posTok = tokens(p.positionTitle);
  const best = p.education[0];
  if (!best) {
    return {
      score: p.source === "Internal" ? 55 : 35,
      evidence: p.source === "Internal"
        ? "Kandidat internal — riwayat pendidikan tidak terdata di modul pelamar (dinilai dari data kepegawaian)"
        : "Riwayat pendidikan belum terisi pada profil pelamar",
    };
  }
  let score = LEVEL[best.level.toUpperCase()] ?? 50;
  const eduTxt = `${best.fieldOfStudy ?? ""} ${best.institution ?? ""}`;
  const rel = overlapCount(tokens(eduTxt), posTok);
  if (rel > 0) score += 20; // bidang studi relevan dgn judul posisi
  if (best.gpa != null && best.gpa > 2.5) score += Math.min(15, Math.round((best.gpa - 2.5) * 10)); // IPK ≥3.5 → +10..15
  score = Math.min(100, Math.max(0, score));
  const parts = [
    `${best.level}${best.fieldOfStudy ? ` ${best.fieldOfStudy}` : ""}${best.institution ? ` — ${best.institution}` : ""}`,
    best.graduationYear ? `lulus ${best.graduationYear}` : null,
    best.gpa != null ? `IPK ${best.gpa.toFixed(2)}` : null,
    rel > 0 ? `bidang studi relevan dengan posisi ${p.positionTitle ?? "-"}` : null,
  ].filter(Boolean);
  return { score, evidence: parts.join(" · ") };
}

function expScore(p: CandidateProfile): { score: number; evidence: string } {
  const posTok = tokens(p.positionTitle);
  let relevant = 0;
  for (const e of p.experiences) {
    if (overlapCount(tokens(e.position ?? ""), posTok) > 0) relevant++;
  }
  let score = Math.min(95, 20 + Math.round(p.totalExpYears * 7));
  if (relevant > 0) score = Math.min(100, score + 15);
  if (p.experiences.length === 0) {
    return {
      score: p.source === "Internal" ? 55 : 25,
      evidence: p.source === "Internal"
        ? "Kandidat internal — riwayat di luar kepegawaian tidak terdata (dinilai netral)"
        : "Belum ada riwayat pengalaman kerja tercatat",
    };
  }
  const last = p.experiences[0]!;
  const evidence = `±${p.totalExpYears} tahun total — terakhir ${last.position ?? "-"}${last.company ? ` (${last.company})` : ""}${relevant > 0 ? ` · ${relevant} pengalaman relevan posisi ${p.positionTitle ?? "-"}` : ""}`;
  return { score, evidence };
}

function skillScore(p: CandidateProfile): { score: number; evidence: string } {
  const posTok = tokens(`${p.positionTitle ?? ""} ${p.jobDesc ?? ""}`);
  const relevant = p.skills.filter((s) => overlapCount(tokens(s), posTok) > 0);
  if (p.skills.length === 0) {
    return {
      score: p.source === "Internal" ? 55 : 30,
      evidence: p.source === "Internal"
        ? "Keahlian internal dinilai dari data kepegawaian (belum terdata di profil pelamar)"
        : "Belum ada keahlian terdaftar pada profil pelamar",
    };
  }
  const score = Math.min(95, 25 + relevant.length * 18 + (p.skills.length - relevant.length) * 6);
  return {
    score,
    evidence: `${p.skills.length} keahlian terdaftar (${relevant.length} relevan posisi): ${p.skills.slice(0, 6).join(", ")}${p.skills.length > 6 ? "…" : ""}`,
  };
}

function salaryScore(p: CandidateProfile): { score: number; evidence: string } {
  if (p.expectedSalary == null || p.expectedSalary <= 0) {
    return { score: 70, evidence: "Ekspektasi gaji belum diisi — dinilai netral" };
  }
  const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
  if (p.salaryMin != null && p.salaryMax != null && p.salaryMax > 0) {
    if (p.expectedSalary <= p.salaryMax && p.expectedSalary >= p.salaryMin) {
      return { score: 90, evidence: `Ekspektasi ${rp(p.expectedSalary)} di dalam rentang iklan ${rp(p.salaryMin)}–${rp(p.salaryMax)}` };
    }
    if (p.expectedSalary < p.salaryMin) {
      return { score: 85, evidence: `Ekspektasi ${rp(p.expectedSalary)} di bawah rentang iklan (mulai ${rp(p.salaryMin)})` };
    }
    const ratio = p.expectedSalary / p.salaryMax;
    if (ratio <= 1.25) return { score: 70, evidence: `Ekspektasi ${rp(p.expectedSalary)} +${Math.round((ratio - 1) * 100)}% di atas rentang iklan maks ${rp(p.salaryMax)}` };
    if (ratio <= 1.5) return { score: 55, evidence: `Ekspektasi ${rp(p.expectedSalary)} +${Math.round((ratio - 1) * 100)}% di atas rentang iklan maks ${rp(p.salaryMax)}` };
    return { score: 35, evidence: `Ekspektasi ${rp(p.expectedSalary)} jauh di atas rentang iklan maks ${rp(p.salaryMax)} (+${Math.round((ratio - 1) * 100)}%)` };
  }
  return { score: 70, evidence: `Ekspektasi ${rp(p.expectedSalary)} — slot tanpa rentang gaji iklan (dinilai netral)` };
}

/** Skor simulated satu faktor — deteksi kategori dari NAMA faktor (rubrik bebas). */
function simulateFactor(f: RubricFactor, p: CandidateProfile): { score: number; evidence: string } {
  const n = f.name.toLowerCase();
  if (/pendidikan|educat|akadem|sertifik/.test(n)) return eduScore(p);
  if (/pengalaman|experience|karier|karir|senior/.test(n)) return expScore(p);
  if (/keahlian|skill|teknis|technical|kompeten/.test(n)) return skillScore(p);
  if (/gaji|salary|kompensasi|motivas|kesesuaian/.test(n)) return salaryScore(p);
  return { score: 50, evidence: "Faktor dinilai netral — heuristik simulasi belum memodelkan faktor ini (atur rubrik ke kategori baku: pendidikan/pengalaman/keahlian/gaji)" };
}

// ============ prompt AI (mode ai) ============

const SCORE_SYSTEM_PROMPT = [
  "Kau adalah penilai kandidat RekanKerja. Nilai kandidat terhadap RUBRIK yang diberikan — objektif, berbasis bukti, tanpa bias apapun.",
  "Balas HANYA JSON VALID — tanpa penjelasan tambahan, tanpa markdown:",
  '{"factors":[{"name":"<nama faktor PERSIS dari rubrik>","score":<0-100>,"evidence":"<kutipan bukti singkat dari profil>"}]}',
  "Aturan: score = angka bulat 0–100 (semua faktor rubrik WAJIB dinilai); evidence = 1 kalimat yang MENYEBUT data faktual dari profil (jangan mengarang); jangan menilai hal di luar rubrik; bila data untuk faktor tidak tersedia, beri score 50 dan evidence menjelaskan datanya kosong.",
].join("\n");

function factorsFromAiText(raw: string, rubric: RubricFactor[]): { factor: string; score: number; evidence: string }[] | null {
  let t = (raw ?? "").trim();
  if (!t) return null;
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = parsed as { factors?: unknown };
  if (!o || !Array.isArray(o.factors)) return null;
  const byName = new Map<string, { factor: string; score: number; evidence: string }>();
  for (const f of o.factors as Record<string, unknown>[]) {
    const name = typeof f?.name === "string" ? f.name.trim() : "";
    const scoreNum = Number(f?.score);
    if (!name || !Number.isFinite(scoreNum)) continue;
    byName.set(name.toLowerCase(), {
      factor: name.slice(0, 80),
      score: Math.min(100, Math.max(0, Math.round(scoreNum))),
      evidence: typeof f?.evidence === "string" ? f.evidence.trim().slice(0, 400) : "",
    });
  }
  // SEMUA faktor rubrik harus terisi — kalau kurang → tolak (fallback simulated)
  const out = rubric.map((r) => {
    const hit = byName.get(r.name.toLowerCase());
    if (!hit) return null;
    return { factor: r.name, score: hit.score, evidence: hit.evidence };
  });
  return out.every(Boolean) ? out : null;
}

// ============ generate skor ============

export async function generateAiScore(
  db: TenantDb,
  input: { candidateId: string; mode?: "auto" | "ai" | "simulated"; generatedById: string; generatedByName?: string | null },
): Promise<AiScoreSerializer> {
  const { profile, prId, candidateRow } = await buildProfile(db, input.candidateId);
  const rubric = await getRubric(db, prId);
  const wantAi = (input.mode ?? "auto") !== "simulated";

  let factorScores: { factor: string; score: number; evidence: string }[] | null = null;
  let mode = "simulated";
  let model: string | null = null;

  if (wantAi) {
    try {
      const ai = await aiComplete(db, {
        system: SCORE_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: JSON.stringify({
            rubrik: rubric.map((r) => ({ name: r.name, bobot: r.weight, panduan: r.guide ?? undefined })),
            posisi_dilamar: profile.positionTitle,
            deskripsi_lowongan: profile.jobDesc,
            profil_kandidat: {
              nama: profile.candidateName,
              sumber: profile.source,
              pendidikan: profile.education,
              pengalaman: profile.experiences,
              total_tahun_pengalaman: profile.totalExpYears,
              keahlian: profile.skills,
              ekspektasi_gaji_per_bulan: profile.expectedSalary,
            },
          }),
        }],
        temperature: 0.2,
        maxTokens: 1500,
      });
      factorScores = factorsFromAiText(ai.text, rubric);
      if (factorScores) {
        mode = "ai";
        model = ai.provider;
      }
    } catch {
      factorScores = null; // AI gagal → fallback simulated (tidak boleh lempar error)
    }
  }

  if (!factorScores) {
    factorScores = rubric.map((r) => {
      const s = simulateFactor(r, profile);
      return { factor: r.name, score: s.score, evidence: s.evidence };
    });
    mode = "simulated";
    model = null;
  }

  // total = Σ bobot ternormalisasi × skor — selalu dihitung ulang dari faktor
  const factors: ScoreFactor[] = rubric.map((r, i) => {
    const f = factorScores![i]!;
    return {
      factor: f.factor,
      weight: Math.round(r.weight * 1000) / 1000,
      score: f.score,
      contribution: Math.round(r.weight * f.score * 10) / 10,
      evidence: f.evidence,
    };
  });
  const total = Math.round(factors.reduce((s, f) => s + f.contribution, 0) * 10) / 10;

  const row = await db.candidateAiScore.create({
    data: {
      candidateId: input.candidateId,
      rubricJson: JSON.stringify(rubric),
      total,
      factorsJson: JSON.stringify(factors),
      mode,
      model,
      generatedById: input.generatedById,
    },
  });
  await db.activityLog.create({
    data: {
      action: "AiScored", entity: "CandidateAiScore", entityId: profile.prNo, employeeId: input.generatedById,
      detail: `Skor AI (${mode}) kandidat ${profile.candidateName} ${profile.prNo}: total ${total.toFixed(1)}/100 — ${factors.map((f) => `${f.factor} ${f.score}`).join(", ")}`,
    },
  });

  return {
    id: row.id,
    candidateId: row.candidateId,
    candidateName: profile.candidateName,
    prNo: profile.prNo,
    total,
    mode,
    model,
    generatedAt: row.generatedAt.toISOString(),
    generatedByName: input.generatedByName ?? null,
    factors,
  };
}

// ============ baca skor ============

function serializeScore(
  row: { id: string; candidateId: string; total: number; mode: string; model: string | null; factorsJson: string; generatedAt: Date; generatedBy: { fullName: string | null } | null },
  extra: { candidateName: string; prNo: string },
): AiScoreSerializer {
  let factors: ScoreFactor[] = [];
  try {
    factors = JSON.parse(row.factorsJson) as ScoreFactor[];
  } catch { factors = []; }
  return {
    id: row.id,
    candidateId: row.candidateId,
    candidateName: extra.candidateName,
    prNo: extra.prNo,
    total: row.total,
    mode: row.mode,
    model: row.model,
    generatedAt: row.generatedAt.toISOString(),
    generatedByName: row.generatedBy?.fullName ?? null,
    factors,
  };
}

/** Skor TERBARU per kandidat — by prId (board) atau candidateIds eksplisit (detail). */
export async function latestScores(
  db: TenantDb,
  input: { prId?: string; candidateIds?: string[] },
): Promise<AiScoreSerializer[]> {
  let ids = input.candidateIds ?? null;
  let names = new Map<string, { candidateName: string; prNo: string }>();
  if (input.prId) {
    const cands = await db.jobCandidate.findMany({
      where: { prId: input.prId },
      select: { id: true, fullName: true, pr: { select: { prNo: true } } },
    });
    ids = cands.map((c) => c.id);
    names = new Map(cands.map((c) => [c.id, { candidateName: c.fullName, prNo: c.pr.prNo }]));
  }
  if (!ids || ids.length === 0) return [];

  const rows = await db.candidateAiScore.findMany({
    where: { candidateId: { in: ids } },
    include: { generatedBy: { select: { fullName: true } } },
    orderBy: { generatedAt: "desc" },
    take: 200,
  });
  // histori → ambil terbaru per kandidat
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!latest.has(r.candidateId)) latest.set(r.candidateId, r);
  }
  const out: AiScoreSerializer[] = [];
  for (const [cid, r] of latest) {
    const meta = names.get(cid) ?? { candidateName: "", prNo: "" };
    if (!meta.candidateName) {
      const c = await db.jobCandidate.findUnique({ where: { id: cid }, select: { fullName: true, pr: { select: { prNo: true } } } });
      meta.candidateName = c?.fullName ?? "";
      meta.prNo = c?.pr.prNo ?? "";
    }
    out.push(serializeScore(r, meta));
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Satu skor by id (detail histori). */
export async function getScore(db: TenantDb, scoreId: string): Promise<AiScoreSerializer | null> {
  const row = await db.candidateAiScore.findUnique({
    where: { id: scoreId },
    include: { candidate: { select: { fullName: true, pr: { select: { prNo: true } } } }, generatedBy: { select: { fullName: true } } },
  });
  if (!row) return null;
  return serializeScore(row, { candidateName: row.candidate.fullName, prNo: row.candidate.pr.prNo });
}
