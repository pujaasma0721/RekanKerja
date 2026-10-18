// P3.2-BM (D-BM24) — SKILLS FOUNDATION SERVICE ==================================
// ================================================================================
// Tiga tanggung jawab (satu sumber kebenaran, dipakai API + jembatan rekrutmen):
//   1. Validasi syarat keahlian posisi (Position.requiredSkillsJson) —
//      {skillId, level 1–5}, maks 15 entri, tanpa duplikat, skill harus
//      ada & aktif di SkillCatalog.
//   2. Analisis gap keahlian per posisi (deliverable D-BM24): pemegang posisi
//      vs requirement → met/total + ringkasan.
//   3. Jembatan keahlian pelamar → karyawan saat pengangkatan: label match
//      ApplicantSkill (master Skill rekrutmen) → SkillCatalog (case-insensitive,
//      trimmed) → EmployeeSkill level default 3. TIDAK ADA fabrikasi entri
//      katalog — keahlian tanpa match DILEWATI (skip).
// Catatan batas scope: ini katalog + level organisasi — BUKAN modul training
// (D-BM28 exclude permanen; tidak ada kursus/sesi/e-learning di sini).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Bentuk satu syarat keahlian posisi (disimpan di requiredSkillsJson). */
export interface SkillRequirement {
  skillId: string;
  level: number; // 1–5
}

/** Error layanan dengan status HTTP (pola PolicyError P2.5). */
export class SkillServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_POSITION_SKILL_REQUIREMENTS = 15;

/** Parse requiredSkillsJson → entri (bentuk salah → SkillServiceError 400). */
export function parseSkillRequirements(raw: string | null | undefined): SkillRequirement[] {
  if (raw == null || String(raw).trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new SkillServiceError(400, "requiredSkillsJson bukan JSON valid");
  }
  return normalizeRequirements(parsed);
}

/** Normalisasi + validasi bentuk array requirement (dipakai parse & input API). */
function normalizeRequirements(input: unknown): SkillRequirement[] {
  if (!Array.isArray(input)) {
    throw new SkillServiceError(400, "Syarat keahlian harus berupa array [{skillId, level}]");
  }
  if (input.length > MAX_POSITION_SKILL_REQUIREMENTS) {
    throw new SkillServiceError(
      400,
      `Maksimal ${MAX_POSITION_SKILL_REQUIREMENTS} syarat keahlian per posisi (dikirim ${input.length})`,
    );
  }
  const seen = new Set<string>();
  const out: SkillRequirement[] = [];
  for (const item of input) {
    const skillId =
      item != null && typeof item === "object" && "skillId" in item ? String((item as { skillId: unknown }).skillId ?? "") : "";
    const levelRaw =
      item != null && typeof item === "object" && "level" in item ? (item as { level: unknown }).level : undefined;
    const level = Number(levelRaw);
    if (!skillId) throw new SkillServiceError(400, "skillId syarat keahlian wajib diisi");
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw new SkillServiceError(400, `Level keahlian harus bilangan bulat 1–5 (dapat ${String(levelRaw)})`);
    }
    if (seen.has(skillId)) {
      throw new SkillServiceError(400, "Satu keahlian hanya boleh muncul sekali dalam syarat posisi (duplikat)");
    }
    seen.add(skillId);
    out.push({ skillId, level });
  }
  return out;
}

/**
 * Validasi penuh requirement posisi terhadap SkillCatalog: bentuk + skill
 * harus ADA & AKTIF. Mengembalikan entri ter-normalisasi siap simpan.
 */
export async function validatePositionRequirements(
  db: TenantDb,
  input: unknown,
): Promise<SkillRequirement[]> {
  const entries = normalizeRequirements(input);
  if (entries.length === 0) return [];
  const skills = await db.skillCatalog.findMany({
    where: { id: { in: entries.map((e) => e.skillId) } },
    select: { id: true, name: true, active: true },
  });
  const byId = new Map(skills.map((s) => [s.id, s]));
  for (const e of entries) {
    const s = byId.get(e.skillId);
    if (!s) throw new SkillServiceError(400, `Keahlian ${e.skillId} tidak ditemukan di katalog`);
    if (!s.active) throw new SkillServiceError(400, `Keahlian "${s.name}" sudah non-aktif — tidak bisa dipakai sebagai syarat posisi`);
  }
  return entries;
}

// ============ 2. GAP ANALYSIS (D-BM24) ============

export interface GapDetail {
  skillId: string;
  name: string;
  required: number;
  actual: number | null; // null = belum dinilai
  ok: boolean;
}

export interface GapEmployeeRow {
  employeeId: string;
  fullName: string;
  employeeNo: string;
  met: number;
  total: number;
  details: GapDetail[];
}

export interface GapAnalysis {
  position: { id: string; code: string; title: string };
  requirements: { skillId: string; name: string; level: number }[];
  employees: GapEmployeeRow[];
  summary: {
    employees: number;
    allMet: number; // memenuhi SELURUH syarat
    halfOrMore: number; // memenuhi ≥ setengah syarat
  };
}

/** Analisis gap keahlian satu posisi (read-only — deliverable D-BM24). */
export async function skillsGapForPosition(db: TenantDb, positionId: string): Promise<GapAnalysis> {
  const position = await db.position.findUnique({
    where: { id: positionId },
    select: { id: true, code: true, title: true, requiredSkillsJson: true },
  });
  if (!position) throw new SkillServiceError(404, "Posisi tidak ditemukan");

  const reqs = parseSkillRequirements(position.requiredSkillsJson);
  const catalog = reqs.length
    ? await db.skillCatalog.findMany({
        where: { id: { in: reqs.map((r) => r.skillId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(catalog.map((c) => [c.id, c.name]));
  const requirements = reqs.map((r) => ({ skillId: r.skillId, name: nameOf.get(r.skillId) ?? "—", level: r.level }));

  // pemegang posisi aktif = assignment aktif di posisi ini + karyawan Active
  const holders = await db.employeeAssignment.findMany({
    where: { positionId, validTo: null, employee: { status: "Active" } },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });

  const employees: GapEmployeeRow[] = [];
  if (holders.length > 0) {
    const empRows = await db.employee.findMany({
      where: { id: { in: holders.map((h) => h.employeeId) } },
      select: {
        id: true, fullName: true, employeeNo: true,
        skills: { where: { skillId: { in: reqs.map((r) => r.skillId) } }, select: { skillId: true, level: true } },
      },
      orderBy: { employeeNo: "asc" },
    });
    for (const e of empRows) {
      const levelOf = new Map(e.skills.map((s) => [s.skillId, s.level]));
      const details: GapDetail[] = reqs.map((r) => {
        const actual = levelOf.get(r.skillId) ?? null;
        return {
          skillId: r.skillId,
          name: nameOf.get(r.skillId) ?? "—",
          required: r.level,
          actual,
          ok: actual != null && actual >= r.level,
        };
      });
      employees.push({
        employeeId: e.id,
        fullName: e.fullName,
        employeeNo: e.employeeNo,
        met: details.filter((d) => d.ok).length,
        total: details.length,
        details,
      });
    }
  }

  return {
    position: { id: position.id, code: position.code, title: position.title },
    requirements,
    employees,
    summary: {
      employees: employees.length,
      allMet: employees.filter((e) => e.total === 0 || e.met === e.total).length,
      halfOrMore: employees.filter((e) => e.total === 0 || e.met * 2 >= e.total).length,
    },
  };
}

// ============ 3. JEMBATAN PELAMAR → KARYAWAN (D-BM24) ============

/**
 * Salin keahlian pelamar (ApplicantSkill → master Skill rekrutmen) menjadi
 * EmployeeSkill via LABEL MATCH pada SkillCatalog (case-insensitive, trimmed).
 * Match → EmployeeSkill level default 3 (evidence "Diimpor dari rekrutmen —
 * <tanggal>"); TANPA match → SKIP (tidak pernah memfabrikasi entri katalog).
 * Keahlian yang sudah dimiliki karyawan TIDAK ditimpa (skip — bukan upsert).
 * Mengembalikan jumlah keahlian yang dibuat (match).
 */
export async function importApplicantSkillsToEmployee(
  db: TenantDb,
  applicantId: string,
  employeeId: string,
): Promise<{ created: number; skippedNoMatch: number }> {
  const applicantSkills = await db.applicantSkill.findMany({
    where: { applicantId },
    select: { skill: { select: { name: true } } },
  });
  if (applicantSkills.length === 0) return { created: 0, skippedNoMatch: 0 };

  const catalog = await db.skillCatalog.findMany({ select: { id: true, name: true } });
  const catalogByName = new Map(catalog.map((c) => [c.name.trim().toLowerCase(), c.id]));

  // tanggal Indonesia utk jejak evidence (readable utk HR)
  const today = new Date();
  const tanggal = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const evidence = `Diimpor dari rekrutmen — ${tanggal}`;

  const matchedIds: string[] = [];
  let skippedNoMatch = 0;
  for (const a of applicantSkills) {
    const hit = catalogByName.get(a.skill.name.trim().toLowerCase());
    if (hit) matchedIds.push(hit);
    else skippedNoMatch++;
  }
  if (matchedIds.length === 0) return { created: 0, skippedNoMatch };

  // keahlian yang sudah dimiliki → jangan ditimpa (import tidak menghapus
  // penilaian manual HR yang mungkin sudah ada)
  const existing = await db.employeeSkill.findMany({
    where: { employeeId, skillId: { in: matchedIds } },
    select: { skillId: true },
  });
  const existingIds = new Set(existing.map((e) => e.skillId));
  const toCreate = matchedIds.filter((id) => !existingIds.has(id));
  if (toCreate.length > 0) {
    await db.employeeSkill.createMany({
      data: toCreate.map((skillId) => ({ employeeId, skillId, level: 3, evidence, assessedAt: today })),
    });
  }

  await db.activityLog.create({
    data: {
      action: "Created",
      entity: "EmployeeSkill",
      entityId: employeeId,
      employeeId,
      // format sesuai D-BM24: "Keahlian pelamar diimpor (n cocok)" — info
      // keahlian tanpa padanan ditulis SETELAH kurung penutup.
      detail: `Keahlian pelamar diimpor (${toCreate.length} cocok)${skippedNoMatch > 0 ? `, ${skippedNoMatch} tanpa padanan katalog dilewati` : ""}`,
    },
  });
  return { created: toCreate.length, skippedNoMatch };
}
