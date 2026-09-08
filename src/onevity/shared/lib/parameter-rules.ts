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
//   2. Rule PERTAMA yang seluruh kondisinya cocok (AND) → menang.
//   3. Tanpa kecocokan → nilai dasar entitas dipakai.
//   4. Rule tanpa kondisi TIDAK dievaluasi (guard — cegah rule serakah).
//
// Kondisi: { param, op, values } — op:
//   in | not_in  → daftar (cocok case-insensitive utk teks; numerik utk angka)
//   gt|gte|lt|lte → numerik (values[0] sebagai pembanding)
//   is_empty | not_empty → nilai kosong/null

// ============ TIPE ============

export interface RuleCondition {
  param: string;
  op: "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "not_empty";
  values: string[];
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
  { key: "workShift", label: "Shift Kerja", labelEn: "Work Shift", group: "job", kind: "text", staticOptions: [{ value: "Regular", label: "Regular" }], desc: "Pola shift penempatan", descEn: "Assignment shift pattern" },
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
  { key: "religion", label: "Agama", labelEn: "Religion", group: "personal", kind: "text", desc: "Sesuai data kepegawaian", descEn: "As per employee master data" },
  { key: "maritalStatus", label: "Status Pernikahan", labelEn: "Marital Status", group: "personal", kind: "text" },
  { key: "bloodType", label: "Golongan Darah", labelEn: "Blood Type", group: "personal", kind: "text" },
  { key: "city", label: "Kota Domisili", labelEn: "City of Residence", group: "personal", kind: "text" },
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

// ============ PARSER & MATCHER (murni) ============

/** Parse JSON kondisi secara aman — array kosong bila rusak. */
export function parseConditions(json: string | null | undefined): RuleCondition[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.param === "string" && typeof c.op === "string")
      .map((c) => ({
        param: String(c.param),
        op: c.op as RuleCondition["op"],
        values: Array.isArray(c.values) ? c.values.map(String) : [],
      }));
  } catch {
    return [];
  }
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

/** Semua kondisi harus cocok (AND). */
export function matchConditions(conds: RuleCondition[], ctx: RuleContext): boolean {
  return conds.every((c) => matchCondition(c, ctx));
}

/**
 * Rule pertama yang cocok (priority ASC, createdAt ASC, hanya aktif).
 * Mengembalikan rule + kondisi ter-parse (hemat parse berulang).
 */
export function matchFirstRule(
  rules: EntityRuleLite[],
  ctx: RuleContext,
): { rule: EntityRuleLite; conds: RuleCondition[] } | null {
  const sorted = [...rules]
    .filter((r) => r.active)
    .sort((a, b) => (a.priority - b.priority) || (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  for (const rule of sorted) {
    const conds = parseConditions(rule.conditions);
    if (conds.length === 0) continue; // rule tanpa kondisi = tidak dievaluasi (guard)
    if (matchConditions(conds, ctx)) return { rule, conds };
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

/** Ringkasan human-readable satu kondisi (utk tabel/tooltip UI). */
export function describeCondition(cond: RuleCondition, t: (id: string, en: string) => string): string {
  const def = RULE_PARAM_BY_KEY.get(cond.param);
  const op = RULE_OP_LABEL[cond.op];
  const paramLabel = def ? t(def.label, def.labelEn) : cond.param;
  if (op.noValues) return `${paramLabel} ${t(op.label, op.labelEn)}`;
  if (op.numericOnly) return `${paramLabel} ${t(op.label, op.labelEn)} ${cond.values[0] ?? ""}`;
  return `${paramLabel} ${t(op.label, op.labelEn)} [${cond.values.join(", ")}]`;
}

// ============ VALIDASI PAYLOAD KONDISI (dipakai API semua domain) ============

const OPS = new Set(["in", "not_in", "gt", "gte", "lt", "lte", "is_empty", "not_empty"]);

/** Error validasi payload → HTTP 400 (bukan 500). */
export class RuleValidationError extends Error {}

/** Validasi + normalisasi payload kondisi → JSON string; throw RuleValidationError bila tidak valid. */
export function validateConditions(input: unknown): string {
  if (input == null) return "[]";
  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new RuleValidationError("conditions bukan JSON valid");
    }
    return validateConditions(parsed);
  }
  if (!Array.isArray(input)) throw new RuleValidationError("conditions harus array");
  const out: RuleCondition[] = [];
  for (const raw of input) {
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
  return JSON.stringify(out);
}
