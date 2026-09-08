// OneVity — Task 33: PARAMETER RULE ENGINE BERSAMA (lintas modul) ==========
// ==========================================================================
// Core murni (tanpa IO — aman server & client) dipakai BERSAMA oleh:
//   · payroll  — WageComponentRule      (komponen upah)      [Task 32]
//   · leave    — LeaveTypeRule          (entitlement cuti)   [Task 33]
//   · medical  — MedicalBenefitTypeRule (plafon benefit)     [Task 33]
//   · travel   — TravelExpenseTypeRule  (limit jenis biaya)  [Task 33]
//   · benefit  — BenefitTypeRule        (limit klaim siklus) [Task 33]
//
// Katalog parameter + evaluator kondisi identik di semua modul — hanya
// semantic nilai (action) yang berbeda per domain (lihat entity-rule-domains).
//
// Semantik evaluasi (konsisten semua domain):
//   1. Rule aktif diurut priority ASC (tie-break createdAt ASC).
//   2. Rule PERTAMA yang cocok → menang. Cocok = mode kombinasi kondisi:
//      "all" (DAN — semua kondisi harus cocok) atau "any" (ATAU — cukup
//      satu kondisi cocok). Mode "any" hanya relevan bila kondisi ≥ 2.
//   3. Tanpa kecocokan → nilai dasar entitas dipakai.
//   4. Rule tanpa kondisi TIDAK dievaluasi (guard — cegah rule serakah).
//
// Kondisi: { param, op, values } — op:
//   in | not_in  → daftar (cocok case-insensitive utk teks; numerik utk angka)
//   gt|gte|lt|lte → numerik (values[0] sebagai pembanding)
//   is_empty | not_empty → nilai kosong/null
//
// Format penyimpanan JSON `conditions` (Task 36):
//   Baru  : { "mode": "all" | "any", "conditions": [ RuleCondition, ... ] }
//   Lama  : [ RuleCondition, ... ]  (array polos) → dibaca mode "all" (DAN)
//   — 100% backward-compatible: semua rule Task 32–35 tetap dievaluasi AND.

// ============ TIPE ============

export interface RuleCondition {
  param: string;
  op: "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "not_empty";
  values: string[];
}

/** Mode kombinasi ANTAR kondisi dalam satu rule:
 *  "all" = DAN (semua kondisi harus cocok) — default & format lama.
 *  "any" = ATAU (cukup satu kondisi cocok). */
export type RuleMatchMode = "all" | "any";

export interface RuleSpec {
  mode: RuleMatchMode;
  conditions: RuleCondition[];
}

export type RuleContext = Record<string, string | number | boolean | null | undefined>;

export interface RuleParamDef {
  key: string;
  label: string;
  labelEn: string;
  group: "job" | "personal";
  kind: "entity" | "text" | "enum" | "number" | "boolean";
  /** utk kind=entity: master mana opsi-nya diambil (key opsi API). */
  optionsKey?: string;
  /** utk kind=enum/text yang punya nilai baku — saran opsi statis. */
  staticOptions?: { value: string; label: string; labelEn?: string }[];
  desc?: string;
  descEn?: string;
}

/** Rule generik per entitas — bentuk lite (serializable) utk matcher.
 *  `value` = days (leave) atau amount (uang) sesuai domain. */
export interface EntityRuleLite {
  id: string;
  name: string;
  priority: number;
  conditions: string; // JSON array RuleCondition
  actionType: string; // SetDays|AddDays|Multiply | SetLimit|AddLimit|Multiply | SetAmount|AddAmount|Multiply
  value: number;
  active: boolean;
  createdAt: Date | string;
}

/** Kompatibilitas Task 32 — alias bentuk wage. */
export type ComponentRuleLite = EntityRuleLite;

// ============ KATALOG PARAMETER (pekerjaan + personal) ============

export const RULE_PARAMS: RuleParamDef[] = [
  // ----- PARAMETER PEKERJAAN -----
  { key: "company", label: "Perusahaan", labelEn: "Company", group: "job", kind: "entity", optionsKey: "companies", desc: "Badan usaha tempat karyawan terdaftar", descEn: "Legal entity the employee belongs to" },
  { key: "orgUnit", label: "Organisasi / Unit", labelEn: "Org Unit", group: "job", kind: "entity", optionsKey: "orgUnits", desc: "Unit kerja penempatan aktif", descEn: "Active placement org unit" },
  { key: "position", label: "Posisi / Jabatan", labelEn: "Position", group: "job", kind: "entity", optionsKey: "positions", desc: "Posisi pada penempatan aktif", descEn: "Position in active assignment" },
  { key: "grade", label: "Grade", labelEn: "Grade", group: "job", kind: "entity", optionsKey: "grades", desc: "Grade kepegawaian", descEn: "Employment grade" },
  { key: "positionLevel", label: "Level Jabatan", labelEn: "Position Level", group: "job", kind: "entity", optionsKey: "positionLevels", desc: "Officer s.d. Director", descEn: "Officer up to Director" },
  { key: "office", label: "Kantor (Office)", labelEn: "Office", group: "job", kind: "entity", optionsKey: "offices", desc: "Kantor penempatan aktif", descEn: "Active assignment office" },
  { key: "workLocation", label: "Lokasi Kerja", labelEn: "Work Location", group: "job", kind: "entity", optionsKey: "workLocations", desc: "Site/plant penempatan aktif", descEn: "Active assignment site/plant" },
  {
    key: "employmentStatus", label: "Status Kepegawaian", labelEn: "Employment Type", group: "job", kind: "enum",
    staticOptions: [
      { value: "Permanent", label: "Permanent (PKWTT)" },
      { value: "Contract", label: "Contract (PKWT)" },
      { value: "Probation", label: "Probation" },
      { value: "Outsourcing", label: "Outsourcing" },
    ],
    desc: "Type karyawan pada penempatan aktif", descEn: "Employment type in active assignment",
  },
  {
    key: "workShift", label: "Shift Kerja", labelEn: "Work Shift", group: "job", kind: "text", optionsKey: "workShift",
    staticOptions: [
      { value: "Regular", label: "Regular (Non-Shift)", labelEn: "Regular (Non-Shift)" },
      { value: "Shift 1", label: "Shift 1" },
      { value: "Shift 2", label: "Shift 2" },
      { value: "Shift 3", label: "Shift 3" },
    ],
    desc: "Pola shift penempatan — opsi mengikuti data aktual", descEn: "Assignment shift pattern — options follow actual data",
  },
  { key: "tenureYears", label: "Masa Kerja (tahun)", labelEn: "Tenure (years)", group: "job", kind: "number", desc: "Sejak join date s.d. tanggal acuan", descEn: "From join date to reference date" },
  {
    key: "employeeStatus", label: "Status Karyawan", labelEn: "Employee Status", group: "job", kind: "enum",
    staticOptions: [
      { value: "Active", label: "Active" },
      { value: "Resigned", label: "Resigned" },
      { value: "Terminated", label: "Terminated" },
      { value: "Blacklisted", label: "Blacklisted" },
    ],
  },
  // ----- PARAMETER PERSONAL -----
  {
    key: "gender", label: "Jenis Kelamin", labelEn: "Gender", group: "personal", kind: "enum",
    staticOptions: [
      { value: "M", label: "Laki-laki", labelEn: "Male" },
      { value: "F", label: "Perempuan", labelEn: "Female" },
    ],
  },
  // teks dgn opsi terkendali: chips dari data aktual (optionsKey) digabung opsi baku
  {
    key: "religion", label: "Agama", labelEn: "Religion", group: "personal", kind: "text", optionsKey: "religion",
    staticOptions: [
      { value: "Islam", label: "Islam" },
      { value: "Kristen Protestan", label: "Kristen Protestan", labelEn: "Protestant" },
      { value: "Katolik", label: "Katolik", labelEn: "Catholic" },
      { value: "Hindu", label: "Hindu" },
      { value: "Buddha", label: "Buddha" },
      { value: "Konghucu", label: "Konghucu", labelEn: "Confucian" },
    ],
    desc: "Sesuai data kepegawaian", descEn: "As per employee master data",
  },
  {
    key: "maritalStatus", label: "Status Pernikahan", labelEn: "Marital Status", group: "personal", kind: "text", optionsKey: "maritalStatus",
    staticOptions: [
      { value: "Belum Menikah", label: "Belum Menikah", labelEn: "Single" },
      { value: "Menikah", label: "Menikah", labelEn: "Married" },
      { value: "Cerai", label: "Cerai", labelEn: "Divorced" },
      { value: "Janda/Duda", label: "Janda/Duda", labelEn: "Widowed" },
    ],
  },
  {
    key: "bloodType", label: "Golongan Darah", labelEn: "Blood Type", group: "personal", kind: "text", optionsKey: "bloodType",
    staticOptions: [
      { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "AB", label: "AB" }, { value: "O", label: "O" },
    ],
  },
  { key: "city", label: "Kota Domisili", labelEn: "City of Residence", group: "personal", kind: "text", optionsKey: "city", desc: "Pilihan kota dari data karyawan aktual", descEn: "Options are actual cities from employee data" },
  { key: "ageYears", label: "Usia (tahun)", labelEn: "Age (years)", group: "personal", kind: "number" },
  {
    key: "taxStatus", label: "Status PPh21 (PTKP)", labelEn: "Tax Status (PTKP)", group: "personal", kind: "enum",
    staticOptions: [
      { value: "TK0", label: "TK/0" }, { value: "TK1", label: "TK/1" }, { value: "TK2", label: "TK/2" }, { value: "TK3", label: "TK/3" },
      { value: "K0", label: "K/0" }, { value: "K1", label: "K/1" }, { value: "K2", label: "K/2" }, { value: "K3", label: "K/3" },
      { value: "KI0", label: "K/I/0" }, { value: "KI1", label: "K/I/1" }, { value: "KI2", label: "K/I/2" }, { value: "KI3", label: "K/I/3" },
    ],
  },
  { key: "dependents", label: "Jumlah Tanggungan", labelEn: "Dependents", group: "personal", kind: "number" },
  {
    key: "hasNpwp", label: "Punya NPWP", labelEn: "Has NPWP", group: "personal", kind: "boolean",
    staticOptions: [
      { value: "true", label: "Ya", labelEn: "Yes" },
      { value: "false", label: "Tidak", labelEn: "No" },
    ],
  },
];

export const RULE_PARAM_BY_KEY = new Map(RULE_PARAMS.map((p) => [p.key, p]));

export const RULE_OP_LABEL: Record<RuleCondition["op"], { label: string; labelEn: string; numericOnly?: boolean; noValues?: boolean }> = {
  in: { label: "Adalah salah satu dari", labelEn: "is one of" },
  not_in: { label: "Bukan salah satu dari", labelEn: "is none of" },
  gt: { label: "Lebih dari", labelEn: "greater than", numericOnly: true },
  gte: { label: "Lebih dari / sama dengan", labelEn: "greater or equal", numericOnly: true },
  lt: { label: "Kurang dari", labelEn: "less than", numericOnly: true },
  lte: { label: "Kurang dari / sama dengan", labelEn: "less or equal", numericOnly: true },
  is_empty: { label: "Tidak diisi / tidak ada", labelEn: "is empty", noValues: true },
  not_empty: { label: "Ada isinya", labelEn: "is not empty", noValues: true },
};

/** Label singkat mode kombinasi (badge UI). */
export const RULE_MODE_LABEL: Record<RuleMatchMode, { label: string; labelEn: string }> = {
  all: { label: "DAN — semua kondisi cocok", labelEn: "AND — all conditions match" },
  any: { label: "ATAU — salah satu cukup", labelEn: "OR — any one matches" },
};

// ============ PARSER & MATCHER (murni) ============

/** Normalisasi array kondisi mentah → RuleCondition[] valid (best-effort). */
const sanitizeConditions = (arr: unknown[]): RuleCondition[] =>
  arr
    .filter((c) => c && typeof c === "object" && typeof (c as Record<string, unknown>).param === "string" && typeof (c as Record<string, unknown>).op === "string")
    .map((c) => {
      const cc = c as Record<string, unknown>;
      return {
        param: String(cc.param),
        op: cc.op as RuleCondition["op"],
        values: Array.isArray(cc.values) ? cc.values.map(String) : [],
      };
    });

/** Parse JSON spesifikasi rule secara aman (kedua format) → { mode, conditions }.
 *  Format lama (array polos) → mode "all" (DAN). Output tidak pernah throw. */
export function parseRuleSpec(json: string | null | undefined): RuleSpec {
  const empty: RuleSpec = { mode: "all", conditions: [] };
  if (!json) return empty;
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return { mode: "all", conditions: sanitizeConditions(parsed) };
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const mode: RuleMatchMode = obj.mode === "any" ? "any" : "all";
      return { mode, conditions: Array.isArray(obj.conditions) ? sanitizeConditions(obj.conditions) : [] };
    }
    return empty;
  } catch {
    return empty;
  }
}

/** Kondisi ter-parse dari JSON rule (abaikan mode — utk response API/UI). */
export function parseConditions(json: string | null | undefined): RuleCondition[] {
  return parseRuleSpec(json).conditions;
}

/** Mode kombinasi kondisi rule ("all" = DAN, "any" = ATAU). */
export function parseMatchMode(json: string | null | undefined): RuleMatchMode {
  return parseRuleSpec(json).mode;
}

const norm = (v: unknown): string => (v == null ? "" : String(v).trim().toLowerCase());
const num = (v: unknown): number | null => {
  if (typeof v === "number" && isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(",", "."));
  return isFinite(n) ? n : null;
};

/** Kondisi tunggal terhadap konteks (nilai = param key). */
export function matchCondition(cond: RuleCondition, ctx: RuleContext): boolean {
  const def = RULE_PARAM_BY_KEY.get(cond.param);
  const raw = ctx[cond.param];

  switch (cond.op) {
    case "is_empty":
      return norm(raw) === "";
    case "not_empty":
      return norm(raw) !== "";
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const lhs = num(raw);
      const rhs = num(cond.values[0]);
      if (lhs == null || rhs == null) return false;
      if (cond.op === "gt") return lhs > rhs;
      if (cond.op === "gte") return lhs >= rhs;
      if (cond.op === "lt") return lhs < rhs;
      return lhs <= rhs;
    }
    case "in":
    case "not_in": {
      if (def?.kind === "boolean") {
        const target = raw === true || norm(raw) === "true";
        const want = cond.values.map(norm);
        const hit = want.includes(String(target));
        return cond.op === "in" ? hit : !hit;
      }
      const lhsNum = num(raw);
      if (def?.kind === "number" && lhsNum != null) {
        const hits = cond.values.some((v) => {
          const r = num(v);
          return r != null && r === lhsNum;
        });
        return cond.op === "in" ? hits : !hits;
      }
      const target = norm(raw);
      const hits = cond.values.some((v) => norm(v) === target);
      return cond.op === "in" ? hits : !hits;
    }
    default:
      return false;
  }
}

/** Kombinasi kondisi sesuai mode: "all" = DAN (semua), "any" = ATAU (salah satu).
 *  Kondisi tunggal: mode tidak berefek. */
export function matchConditions(conds: RuleCondition[], ctx: RuleContext, mode: RuleMatchMode = "all"): boolean {
  return mode === "any" ? conds.some((c) => matchCondition(c, ctx)) : conds.every((c) => matchCondition(c, ctx));
}

/**
 * Rule pertama yang cocok (priority ASC, createdAt ASC, hanya aktif).
 * Mode kombinasi kondisi (DAN/ATAU) ikut dibaca dari JSON rule.
 * Mengembalikan rule + kondisi ter-parse + mode (hemat parse berulang).
 */
export function matchFirstRule(
  rules: EntityRuleLite[],
  ctx: RuleContext,
): { rule: EntityRuleLite; conds: RuleCondition[]; mode: RuleMatchMode } | null {
  const sorted = [...rules]
    .filter((r) => r.active)
    .sort((a, b) => (a.priority - b.priority) || (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  for (const rule of sorted) {
    const spec = parseRuleSpec(rule.conditions);
    if (spec.conditions.length === 0) continue; // rule tanpa kondisi = tidak dievaluasi (guard)
    if (matchConditions(spec.conditions, ctx, spec.mode)) return { rule, conds: spec.conditions, mode: spec.mode };
  }
  return null;
}

/**
 * Terapkan action rule terhadap nilai dasar (generik semua domain):
 *   Set*   → nilai = rule.value
 *   Add*   → nilai = dasar + rule.value (boleh negatif)
 *   Multiply → nilai = dasar × rule.value
 */
export function applyRuleValue(actionType: string, value: number, base: number): number {
  if (actionType.startsWith("Set")) return value;
  if (actionType.startsWith("Add")) return base + value;
  if (actionType === "Multiply") return base * value;
  return base;
}

/** Kompatibilitas Task 32 — nama lama (payroll). */
export const applyRuleAmount = applyRuleValue;

/** Label ramah utk satu nilai kondisi (map enum → label, sisanya raw). */
export function describeConditionValue(param: string, value: string, t: (id: string, en: string) => string): string {
  const def = RULE_PARAM_BY_KEY.get(param);
  const so = def?.staticOptions?.find((o) => o.value === value);
  return so ? t(so.label, so.labelEn ?? so.label) : value;
}

/** Ringkasan human-readable satu kondisi (utk tabel/tooltip UI). */
export function describeCondition(cond: RuleCondition, t: (id: string, en: string) => string): string {
  const def = RULE_PARAM_BY_KEY.get(cond.param);
  const op = RULE_OP_LABEL[cond.op];
  const paramLabel = def ? t(def.label, def.labelEn) : cond.param;
  if (op.noValues) return `${paramLabel} ${t(op.label, op.labelEn)}`;
  if (op.numericOnly) return `${paramLabel} ${t(op.label, op.labelEn)} ${cond.values[0] ?? ""}`;
  return `${paramLabel} ${t(op.label, op.labelEn)} [${cond.values.map((v) => describeConditionValue(cond.param, v, t)).join(", ")}]`;
}

// ============ VALIDASI PAYLOAD KONDISI (dipakai API semua domain) ============

const OPS = new Set(["in", "not_in", "gt", "gte", "lt", "lte", "is_empty", "not_empty"]);

/** Error validasi payload → HTTP 400 (bukan 500). */
export class RuleValidationError extends Error {}

/** Bentuk payload yang diterima (Task 36):
 *  · array polos RuleCondition[]                      → mode "all" (kompatibilitas lama)
 *  · { mode: "all"|"any", conditions: RuleCondition[] } → mode eksplisit
 *  Output JSON string SELALU format baru { mode, conditions }.
 *  Mode "any" hanya berguna bila kondisi ≥ 2 — bila kurang, dinormalisasi "all". */
export function validateConditions(input: unknown): string {
  let mode: RuleMatchMode = "all";
  let rawList: unknown[];

  if (input == null) {
    rawList = [];
  } else if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new RuleValidationError("conditions bukan JSON valid");
    }
    return validateConditions(parsed);
  } else if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (obj.mode != null && obj.mode !== "all" && obj.mode !== "any") {
      throw new RuleValidationError("mode kombinasi harus 'all' (DAN) atau 'any' (ATAU)");
    }
    mode = obj.mode === "any" ? "any" : "all";
    if (!Array.isArray(obj.conditions)) throw new RuleValidationError("conditions harus array");
    rawList = obj.conditions;
  } else {
    throw new RuleValidationError("conditions harus array");
  }

  const out: RuleCondition[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== "object") throw new RuleValidationError("kondisi tidak valid");
    const c = raw as Record<string, unknown>;
    const param = String(c.param ?? "");
    const op = String(c.op ?? "");
    const def = RULE_PARAM_BY_KEY.get(param);
    if (!def) throw new RuleValidationError(`parameter '${param}' tidak dikenal`);
    if (!OPS.has(op)) throw new RuleValidationError(`operator '${op}' tidak dikenal`);
    const values = Array.isArray(c.values) ? c.values.map((v) => String(v).trim()).filter(Boolean) : [];
    const noValues = op === "is_empty" || op === "not_empty";
    if (!noValues && values.length === 0) throw new RuleValidationError(`kondisi '${param}' belum memiliki nilai`);
    if (noValues && values.length > 0) throw new RuleValidationError(`operator '${op}' tidak memakai nilai`);
    if (["gt", "gte", "lt", "lte"].includes(op)) {
      const n = Number(values[0].replace(",", "."));
      if (!isFinite(n)) throw new RuleValidationError(`operator '${op}' membutuhkan nilai angka`);
    }
    out.push({ param, op: op as RuleCondition["op"], values: noValues ? [] : values });
  }

  // mode ATAU hanya relevan utk ≥ 2 kondisi — cegah data membingungkan
  const finalMode: RuleMatchMode = out.length >= 2 ? mode : "all";
  return JSON.stringify({ mode: finalMode, conditions: out });
}

/** Hasil validateConditions kosong kondisi? (guard "minimal satu kondisi" API). */
export function isEmptyConditions(json: string): boolean {
  return parseRuleSpec(json).conditions.length === 0;
}
