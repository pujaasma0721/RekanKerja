import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// ============================================================================
// RECRUITMENT — Service master rekrutmen (F0 — DEVELOPMENT-PLAN-RECRUITMENT.md)
// Pola mengikuti medical-service (Task 32-d): satu endpoint CRUD multi-tipe
// dengan validasi per tipe + ActivityLog di route. Tipe master & field-nya
// dikunci di sini (whitelist) — tidak ada passthrough kolom bebas.
// ============================================================================

/** Tipe master rekrutmen yang di-serve /api/rekankerja/recruitment/masters. */
export const MASTER_TYPES = [
  "method", "ad-media", "agency", "cost-item", "skill",
  "required-document", "eval-category", "eval-scale", "sla-group", "selection-process",
] as const;
export type MasterType = (typeof MASTER_TYPES)[number];

export function isMasterType(v: unknown): v is MasterType {
  return typeof v === "string" && (MASTER_TYPES as readonly string[]).includes(v);
}

// ---------- tipe baris hasil (union longgar — field opsional per tipe) ----------

export interface MasterRow {
  id: string;
  code: string;
  name?: string;          // semua kecuali RequiredDocument (title)
  title?: string;         // RequiredDocument
  scope?: string;         // method: Internal|External|Both
  description?: string;
  address?: string;       // agency
  contact?: string;       // agency
  note?: string;          // agency
  fileType?: string;      // required-document
  mandatory?: boolean;    // required-document
  ranking?: number;       // eval-scale
  days?: number;          // sla-group
  resultType?: string;    // selection-process: Quantitative|Qualitative
  processOrder?: number;  // selection-process
  slaDays?: number | null;// selection-process
  needAcknowledgement?: boolean; // selection-process
  appliesInternal?: boolean;    // selection-process
  appliesExternal?: boolean;    // selection-process
  minResultPass?: number | null;// selection-process
  active: boolean;
  sortOrder: number;
}

/** Daftar master per tipe (urut aktif → sortOrder → nama). */
export async function listMasters(db: TenantDb, type: MasterType): Promise<MasterRow[]> {
  // orderBy multi-kunci = bentuk array (konvensi proyek — form objek 3-kunci
  // ditolak runtime Prisma; lihat payroll/api/tax-parameters.ts).
  const byName = [{ active: "desc" as const }, { sortOrder: "asc" as const }, { name: "asc" as const }];
  switch (type) {
    case "method":
      return db.recruitmentMethod.findMany({ orderBy: byName });
    case "ad-media":
      return db.adMediaType.findMany({ orderBy: byName });
    case "agency":
      return db.employmentAgency.findMany({ orderBy: byName });
    case "cost-item":
      return db.recruitmentCostItem.findMany({ orderBy: byName });
    case "skill":
      return db.skill.findMany({ orderBy: byName });
    case "required-document":
      return db.requiredDocument.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { title: "asc" }] });
    case "eval-category":
      return db.evaluationCategory.findMany({ orderBy: byName });
    case "eval-scale":
      return db.evaluationScale.findMany({ orderBy: byName });
    case "sla-group":
      return db.slaGroup.findMany({ orderBy: byName });
    case "selection-process":
      return db.selectionProcess.findMany({ orderBy: [{ active: "desc" }, { processOrder: "asc" }] });
  }
}

/** Ringkasan jumlah baris semua tipe (dashboard overview F0). */
export async function countMasters(db: TenantDb): Promise<Record<MasterType, number>> {
  const [method, adMedia, agency, costItem, skill, requiredDocument, evalCategory, evalScale, slaGroup, selectionProcess] =
    await Promise.all([
      db.recruitmentMethod.count(),
      db.adMediaType.count(),
      db.employmentAgency.count(),
      db.recruitmentCostItem.count(),
      db.skill.count(),
      db.requiredDocument.count(),
      db.evaluationCategory.count(),
      db.evaluationScale.count(),
      db.slaGroup.count(),
      db.selectionProcess.count(),
    ]);
  return {
    method, "ad-media": adMedia, agency, "cost-item": costItem, skill,
    "required-document": requiredDocument, "eval-category": evalCategory,
    "eval-scale": evalScale, "sla-group": slaGroup, "selection-process": selectionProcess,
  };
}

// ---------- input upsert (field per tipe — di-sanitize eksplisit) ----------

export interface MasterUpsertInput {
  id?: string;
  code: string;
  name?: string;
  title?: string;
  scope?: string;
  description?: string;
  address?: string;
  contact?: string;
  note?: string;
  fileType?: string;
  mandatory?: boolean;
  ranking?: number;
  days?: number;
  resultType?: string;
  processOrder?: number;
  slaDays?: number | null;
  minResultPass?: number | null;
  needAcknowledgement?: boolean;
  appliesInternal?: boolean;
  appliesExternal?: boolean;
  mandatoryStep?: boolean; // SelectionProcess.mandatory (beda nama dari RequiredDocument.mandatory)
  active?: boolean;
  sortOrder?: number;
}

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/** Upsert master per tipe → id. Validasi: code wajib + unik, field wajib per tipe. */
export async function upsertMaster(db: TenantDb, type: MasterType, input: MasterUpsertInput): Promise<string> {
  const code = clean(input.code);
  if (!code) throw new Error("Kode master wajib diisi");
  const name = clean(input.name);
  const title = clean(input.title);

  // validasi field wajib per tipe
  if (type === "required-document" && !title) throw new Error("Nama dokumen (title) wajib diisi");
  if (type !== "required-document" && !name) throw new Error("Nama master wajib diisi");
  if (type === "method" && input.scope && !["Internal", "External", "Both"].includes(input.scope)) {
    throw new Error("Cakupan metode harus Internal / External / Both");
  }
  if (type === "selection-process" && input.resultType && !["Quantitative", "Qualitative"].includes(input.resultType)) {
    throw new Error("Tipe hasil tahap harus Quantitative / Qualitative");
  }

  const id = input.id;
  // cek duplikasi code (create; update tidak boleh ganti code — key stabil)
  if (!id) {
    const dup = await findIdByCode(db, type, code);
    if (dup) throw new Error(`Kode ${code} sudah dipakai di master ini`);
  }

  const active = input.active !== false;
  const sortOrder = Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0;

  switch (type) {
    case "method": {
      const data = { code, name: name!, scope: input.scope ?? "External", description: clean(input.description) ?? null, active, sortOrder };
      if (id) { const r = await db.recruitmentMethod.update({ where: { id }, data }); return r.id; }
      const r = await db.recruitmentMethod.create({ data }); return r.id;
    }
    case "ad-media": {
      const data = { code, name: name!, active, sortOrder };
      if (id) { const r = await db.adMediaType.update({ where: { id }, data }); return r.id; }
      const r = await db.adMediaType.create({ data }); return r.id;
    }
    case "agency": {
      const data = { code, name: name!, address: clean(input.address) ?? null, contact: clean(input.contact) ?? null, note: clean(input.note) ?? null, active, sortOrder };
      if (id) { const r = await db.employmentAgency.update({ where: { id }, data }); return r.id; }
      const r = await db.employmentAgency.create({ data }); return r.id;
    }
    case "cost-item": {
      const data = { code, name: name!, description: clean(input.description) ?? null, active, sortOrder };
      if (id) { const r = await db.recruitmentCostItem.update({ where: { id }, data }); return r.id; }
      const r = await db.recruitmentCostItem.create({ data }); return r.id;
    }
    case "skill": {
      const data = { code, name: name!, criteria: clean(input.description) ?? null, active, sortOrder };
      if (id) { const r = await db.skill.update({ where: { id }, data }); return r.id; }
      const r = await db.skill.create({ data }); return r.id;
    }
    case "required-document": {
      const data = { code, title: title!, fileType: clean(input.fileType) ?? null, mandatory: input.mandatory === true, active, sortOrder };
      if (id) { const r = await db.requiredDocument.update({ where: { id }, data }); return r.id; }
      const r = await db.requiredDocument.create({ data }); return r.id;
    }
    case "eval-category": {
      const data = { code, name: name!, description: clean(input.description) ?? null, active, sortOrder };
      if (id) { const r = await db.evaluationCategory.update({ where: { id }, data }); return r.id; }
      const r = await db.evaluationCategory.create({ data }); return r.id;
    }
    case "eval-scale": {
      const ranking = Number.isFinite(input.ranking) ? Math.round(Number(input.ranking)) : 1;
      if (ranking < 1 || ranking > 10) throw new Error("Ranking skala harus 1–10");
      const data = { code, name: name!, ranking, active, sortOrder };
      if (id) { const r = await db.evaluationScale.update({ where: { id }, data }); return r.id; }
      const r = await db.evaluationScale.create({ data }); return r.id;
    }
    case "sla-group": {
      const days = Number.isFinite(input.days) ? Math.round(Number(input.days)) : 30;
      if (days < 1 || days > 365) throw new Error("Jumlah hari SLA harus 1–365");
      const data = { code, name: name!, days, active, sortOrder };
      if (id) { const r = await db.slaGroup.update({ where: { id }, data }); return r.id; }
      const r = await db.slaGroup.create({ data }); return r.id;
    }
    case "selection-process": {
      const processOrder = Number.isFinite(input.processOrder) ? Math.max(1, Math.round(Number(input.processOrder))) : 1;
      const slaDays = Number.isFinite(input.slaDays) ? Math.max(1, Math.round(Number(input.slaDays))) : null;
      const minResultPass = Number.isFinite(input.minResultPass) ? Number(input.minResultPass) : null;
      const data = {
        code, name: name!, description: clean(input.description) ?? null,
        mandatory: input.mandatoryStep !== false,
        resultType: input.resultType ?? "Qualitative",
        appliesInternal: input.appliesInternal !== false,
        appliesExternal: input.appliesExternal !== false,
        minResultPass,
        processOrder,
        slaDays,
        needAcknowledgement: input.needAcknowledgement === true,
        active,
        sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : processOrder,
      };
      if (id) { const r = await db.selectionProcess.update({ where: { id }, data }); return r.id; }
      const r = await db.selectionProcess.create({ data }); return r.id;
    }
  }
}

async function findIdByCode(db: TenantDb, type: MasterType, code: string): Promise<string | null> {
  switch (type) {
    case "method": return (await db.recruitmentMethod.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "ad-media": return (await db.adMediaType.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "agency": return (await db.employmentAgency.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "cost-item": return (await db.recruitmentCostItem.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "skill": return (await db.skill.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "required-document": return (await db.requiredDocument.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "eval-category": return (await db.evaluationCategory.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "eval-scale": return (await db.evaluationScale.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "sla-group": return (await db.slaGroup.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    case "selection-process": return (await db.selectionProcess.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
  }
}

/** Hapus master per tipe (F0: belum ada pemakaian lintas — guard pemakaian
 *  menyusul F1–F3 saat relasi PR/kandidat/seleksi terbentuk). */
export async function deleteMaster(db: TenantDb, type: MasterType, id: string): Promise<void> {
  switch (type) {
    case "method": await db.recruitmentMethod.delete({ where: { id } }); return;
    case "ad-media": await db.adMediaType.delete({ where: { id } }); return;
    case "agency": await db.employmentAgency.delete({ where: { id } }); return;
    case "cost-item": await db.recruitmentCostItem.delete({ where: { id } }); return;
    case "skill": await db.skill.delete({ where: { id } }); return;
    case "required-document": await db.requiredDocument.delete({ where: { id } }); return;
    case "eval-category": await db.evaluationCategory.delete({ where: { id } }); return;
    case "eval-scale": await db.evaluationScale.delete({ where: { id } }); return;
    case "sla-group": await db.slaGroup.delete({ where: { id } }); return;
    case "selection-process": await db.selectionProcess.delete({ where: { id } }); return;
  }
}

/** Label entity utk ActivityLog. */
export function masterEntityOf(type: MasterType): string {
  switch (type) {
    case "method": return "RecruitmentMethod";
    case "ad-media": return "AdMediaType";
    case "agency": return "EmploymentAgency";
    case "cost-item": return "RecruitmentCostItem";
    case "skill": return "Skill";
    case "required-document": return "RequiredDocument";
    case "eval-category": return "EvaluationCategory";
    case "eval-scale": return "EvaluationScale";
    case "sla-group": return "SlaGroup";
    case "selection-process": return "SelectionProcess";
  }
}
