// OneVity — Report Builder service (Task 28-b) ============================
// =====================================================================
// Mesin laporan ad-hoc kustom (gap P2 report builder):
//   · KATALOG entity whitelisted server-side (employees, payroll_lines,
//     attendance, leave_requests, travel_claims, medical_claims) — field
//     key/label/tipe/filterable + path Prisma (relasi to-one diresolve
//     menjadi kolom datar lewat include). Field & relasi dibaca LANGSUNG
//     dari prisma/schema-tenant.prisma (Position punya `title`, bukan
//     `name`; saldo hari cuti = LeaveRequest.workingDays; klaim medis
//     TIDAK punya relasi provider → pakai type.name).
//   · FILTER ENGINE: ops eq|neq|contains|in|gt|gte|lt|lte|empty|notEmpty
//     dengan validasi nilai per tipe (string/number/date/boolean); field
//     relasi to-one → where nested { relasi: { field: value } }; tanggal
//     dibandingkan sebagai Date (eq = rentang satu hari UTC).
//   · RUN: findMany take 500 (page) + count total → { rows, total,
//     truncated }; order by field terpilih pertama asc (fallback default
//     per entity: employeeNo / docNo / workDate).
//   · EXPORT: CSV + XLSX via shared/lib/export.ts (toCsv/toXlsx — angka
//     tetap numerik di Excel, tanggal "dd MMM yyyy", boolean Ya/Tidak).
// Dipakai route src/app/api/onevity/custom-reports/** (run, export,
// catalog, CRUD laporan tersimpan — model CustomReport RPT-KUSTOM-%04d).
import type { TenantDb } from "../lib/tenant-db";
import { tenantCryptoForDb, isEncrypted } from "../lib/field-crypto";
import type { MoneyView } from "../lib/money-view";
import { exportFilename, toCsv, toXlsx, type ExportCell, type ExportColumn } from "../lib/export";

// ================= TIPE DASAR =================

export type FieldType = "string" | "number" | "date" | "boolean";
export type FilterOp =
  | "eq" | "neq" | "contains" | "in" | "gt" | "gte" | "lt" | "lte" | "empty" | "notEmpty";

/** Error validasi spesifikasi laporan — route memetakan ke HTTP 400. */
export class ReportSpecError extends Error {}

export interface ReportFieldDef {
  key: string;
  /** label Indonesia (kolom utama di UI & file ekspor). */
  label: string;
  labelEn: string;
  type: FieldType;
  filterable: boolean;
  /** grup di field picker UI (Identitas / Penempatan / Upah & Pajak / …). */
  group: string;
  /** jalur Prisma — ["employeeNo"] atau ["orgUnit","name"] (relasi to-one). */
  path: string[];
  /**
   * 28-c: field uang terenkripsi di DB (enc:v1:n:…) — TIDAK bisa difilter /
   * diurutkan di SQL (ciphertext). Filter gt/gte/lt/lte/eq/neq/in diterapkan
   * IN-APP setelah dekripsi (fetch → decrypt → filter JS); urutan field ini
   * juga di-sort di JS. Pelajari catatan di runReport.
   */
  encrypted?: boolean;
}

export interface ReportEntityDef {
  key: string;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  /** delegate Prisma pada TenantDb (db.employee, db.payrollRunLine, …). */
  model: string;
  /** field order fallback bila tak ada field terpilih (tak terjadi — min 1). */
  defaultField: string;
  fields: ReportFieldDef[];
}

export interface ReportFilterInput {
  field?: unknown;
  op?: unknown;
  value?: unknown;
}

export interface NormalizedFilter {
  field: string;
  op: FilterOp;
  /** nilai ter-tipe; null untuk op empty/notEmpty; array untuk op "in". */
  value: string | number | boolean | Date | (string | number | boolean | Date)[] | null;
  def: ReportFieldDef;
}

// ================= OPERATOR FILTER =================

export const FILTER_OPS: Record<FilterOp, { label: string; labelEn: string }> = {
  eq: { label: "sama dengan", labelEn: "equals" },
  neq: { label: "tidak sama dengan", labelEn: "not equal" },
  contains: { label: "mengandung", labelEn: "contains" },
  in: { label: "salah satu dari", labelEn: "one of" },
  gt: { label: "lebih dari", labelEn: "greater than" },
  gte: { label: "lebih dari / sama", labelEn: "greater or equal" },
  lt: { label: "kurang dari", labelEn: "less than" },
  lte: { label: "kurang dari / sama", labelEn: "less or equal" },
  empty: { label: "kosong", labelEn: "is empty" },
  notEmpty: { label: "tidak kosong", labelEn: "is not empty" },
};

/** Operator yang berlaku per tipe field (in: string/number saja; tanggal
 *  dibandingkan per hari; boolean hanya eq/neq/null-check). */
export const OPS_BY_TYPE: Record<FieldType, FilterOp[]> = {
  string: ["eq", "neq", "contains", "in", "empty", "notEmpty"],
  number: ["eq", "neq", "in", "gt", "gte", "lt", "lte", "empty", "notEmpty"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"],
  boolean: ["eq", "neq", "empty", "notEmpty"],
};

// ================= BATAS =================

export const LIMITS = {
  maxFields: 25,
  maxFilters: 10,
  runPageSize: 500,
  exportRows: 5000,
  maxTextLength: 200,
};

// ================= KATALOG ENTITY (whitelist server-side) =================

const F = (
  key: string,
  label: string,
  labelEn: string,
  type: FieldType,
  path: string,
  group: string,
  filterable = true,
  encrypted = false,
): ReportFieldDef => ({ key, label, labelEn, type, filterable, group, path: path.split("."), ...(encrypted ? { encrypted: true } : {}) });

export const REPORT_ENTITIES: ReportEntityDef[] = [
  {
    key: "employees",
    label: "Karyawan",
    labelEn: "Employees",
    description: "Data pokok, penempatan & lifecycle kontrak karyawan (direktori HR).",
    descriptionEn: "Employee master, placement & contract lifecycle (HR directory).",
    model: "employee",
    defaultField: "employeeNo",
    fields: [
      // Catatan: Employee TIDAK punya kolom employmentStatus (ada di
      // EmployeeAssignment) — lifecycle diwakili status + field kontrak PKWT.
      F("employeeNo", "NIK", "Employee No", "string", "employeeNo", "Identitas"),
      F("fullName", "Nama Lengkap", "Full Name", "string", "fullName", "Identitas"),
      F("gender", "Jenis Kelamin", "Gender", "string", "gender", "Identitas"),
      F("birthDate", "Tanggal Lahir", "Birth Date", "date", "birthDate", "Identitas"),
      F("joinDate", "Tanggal Masuk", "Join Date", "date", "joinDate", "Kepegawaian"),
      F("endDate", "Tanggal Keluar", "End Date", "date", "endDate", "Kepegawaian"),
      F("status", "Status Karyawan", "Employment Status", "string", "status", "Kepegawaian"),
      F("renewalCount", "Jml Perpanjangan PKWT", "PKWT Renewals", "number", "renewalCount", "Kontrak PKWT"),
      F("contractStart", "Mulai Kontrak", "Contract Start", "date", "contractStart", "Kontrak PKWT"),
      F("contractEnd", "Akhir Kontrak", "Contract End", "date", "contractEnd", "Kontrak PKWT"),
      F("email", "Email", "Email", "string", "email", "Kontak"),
      F("phone", "Telepon", "Phone", "string", "phone", "Kontak"),
      F("city", "Kota", "City", "string", "city", "Kontak"),
      F("address", "Alamat", "Address", "string", "address", "Kontak"),
      F("orgUnitName", "Unit Organisasi", "Org Unit", "string", "orgUnit.name", "Penempatan"),
      F("positionName", "Jabatan", "Position", "string", "position.title", "Penempatan"),
      F("gradeCode", "Grade", "Grade", "string", "grade.code", "Penempatan"),
      F("levelCode", "Level Jabatan", "Position Level", "string", "positionLevel.code", "Penempatan"),
      F("officeName", "Kantor", "Office", "string", "companyOffice.name", "Penempatan"),
      F("locationName", "Lokasi Kerja", "Work Location", "string", "workLocation.name", "Penempatan"),
    ],
  },
  {
    key: "payroll_lines",
    label: "Baris Payroll",
    labelEn: "Payroll Lines",
    description: "Baris hasil kalkulasi payroll per karyawan per run (bruto, potongan, PPh 21, net).",
    descriptionEn: "Payroll calculation lines per employee per run (gross, deductions, tax, net).",
    model: "payrollRunLine",
    defaultField: "runNo",
    fields: [
      F("runNo", "No. Run", "Run No", "string", "run.runNo", "Run"),
      F("periodLabel", "Periode", "Period", "string", "run.period.name", "Run"),
      F("processTypeName", "Jenis Proses", "Process Type", "string", "run.processType.name", "Run"),
      F("runStatus", "Status Run", "Run Status", "string", "run.status", "Run"),
      F("employeeNo", "NIK", "Employee No", "string", "employeeNo", "Karyawan"),
      F("employeeName", "Nama Karyawan", "Employee Name", "string", "employeeName", "Karyawan"),
      F("orgUnitName", "Unit Organisasi", "Org Unit", "string", "orgUnitName", "Karyawan"),
      F("ptkpStatus", "Status PTKP", "PTKP Status", "string", "ptkpStatus", "Upah & Pajak"),
      F("bruto", "Bruto", "Gross", "number", "bruto", "Upah & Pajak", true, true),
      F("deduction", "Potongan", "Deduction", "number", "deduction", "Upah & Pajak", true, true),
      F("taxRegular", "PPh 21 Regular", "Regular Income Tax", "number", "taxRegular", "Upah & Pajak", true, true),
      F("taxIrregular", "PPh 21 Irregular", "Irregular Income Tax", "number", "taxIrregular", "Upah & Pajak", true, true),
      F("net", "Net (THP)", "Net", "number", "net", "Upah & Pajak", true, true),
      F("umkWarning", "Peringatan UMK", "UMK Warning", "boolean", "umkWarning", "Upah & Pajak"),
      F("notes", "Catatan", "Notes", "string", "notes", "Lainnya"),
    ],
  },
  {
    key: "attendance",
    label: "Rekap Kehadiran Harian",
    labelEn: "Daily Attendance",
    description: "Rekap kehadiran harian per karyawan (clock in/out, menit kerja, lembur, dibayar).",
    descriptionEn: "Daily attendance recap per employee (clock in/out, minutes, overtime, paid).",
    model: "attendanceDaily",
    defaultField: "workDate",
    fields: [
      F("workDate", "Tanggal Kerja", "Work Date", "date", "workDate", "Waktu"),
      F("checkIn", "Jam Masuk", "Clock In", "date", "checkIn", "Waktu"),
      F("checkOut", "Jam Pulang", "Clock Out", "date", "checkOut", "Waktu"),
      F("employeeNo", "NIK", "Employee No", "string", "employee.employeeNo", "Karyawan"),
      F("employeeName", "Nama Karyawan", "Employee Name", "string", "employee.fullName", "Karyawan"),
      F("status", "Status Kehadiran", "Attendance Status", "string", "status", "Rekap"),
      F("lateMinutes", "Telat (menit)", "Late (minutes)", "number", "lateMinutes", "Rekap"),
      F("earlyMinutes", "Pulang Awal (menit)", "Early Leave (minutes)", "number", "earlyMinutes", "Rekap"),
      F("workMinutes", "Total Kerja (menit)", "Worked (minutes)", "number", "workMinutes", "Rekap"),
      F("normalMinutes", "Jam Normal (menit)", "Normal (minutes)", "number", "normalMinutes", "Rekap"),
      F("overtimeMinutes", "Lembur (menit)", "Overtime (minutes)", "number", "overtimeMinutes", "Rekap"),
      F("paidFlag", "Dibayar", "Paid", "boolean", "paidFlag", "Rekap"),
      F("notes", "Catatan", "Notes", "string", "notes", "Rekap"),
    ],
  },
  {
    key: "leave_requests",
    label: "Permintaan Cuti",
    labelEn: "Leave Requests",
    description: "Permintaan cuti per karyawan (jenis, rentang tanggal, hari kerja terpakai).",
    descriptionEn: "Leave requests per employee (type, date range, working days taken).",
    model: "leaveRequest",
    defaultField: "docNo",
    fields: [
      F("docNo", "No. Dokumen", "Doc No", "string", "docNo", "Dokumen"),
      F("status", "Status", "Status", "string", "status", "Dokumen"),
      F("employeeNo", "NIK", "Employee No", "string", "employee.employeeNo", "Karyawan"),
      F("employeeName", "Nama Karyawan", "Employee Name", "string", "employee.fullName", "Karyawan"),
      F("typeName", "Jenis Cuti", "Leave Type", "string", "leaveType.name", "Cuti"),
      F("dateFrom", "Mulai", "From", "date", "dateFrom", "Cuti"),
      F("dateTo", "Sampai", "To", "date", "dateTo", "Cuti"),
      F("workingDays", "Hari Kerja Terpakai", "Working Days", "number", "workingDays", "Cuti"),
      F("reason", "Alasan", "Reason", "string", "reason", "Cuti"),
    ],
  },
  {
    key: "travel_claims",
    label: "Klaim Perjalanan Dinas",
    labelEn: "Travel Claims",
    description: "Klaim perjalanan dinas (settlement, dibayar ke karyawan / kembali ke perusahaan).",
    descriptionEn: "Travel claims (settlement, payable to employee / back to company).",
    model: "travelClaim",
    defaultField: "docNo",
    fields: [
      F("docNo", "No. Dokumen", "Doc No", "string", "docNo", "Dokumen"),
      F("status", "Status", "Status", "string", "status", "Dokumen"),
      F("claimDate", "Tanggal Klaim", "Claim Date", "date", "claimDate", "Dokumen"),
      F("employeeNo", "NIK", "Employee No", "string", "employee.employeeNo", "Karyawan"),
      F("employeeName", "Nama Karyawan", "Employee Name", "string", "employee.fullName", "Karyawan"),
      // 44-d (M-8): nilai uang TravelClaim TERENKRIPSI — flag encrypted supaya
      // sel XLSX/CSV + filter memakai nilai TERDEKRIPSI (bukan ciphertext).
      F("totalSettlement", "Total Settlement", "Total Settlement", "number", "totalSettlement", "Nilai", true, true),
      F("payableEmployee", "Dibayar ke Karyawan", "Payable to Employee", "number", "payableEmployee", "Nilai", true, true),
      F("payableCompany", "Kembali ke Perusahaan", "Payable to Company", "number", "payableCompany", "Nilai", true, true),
    ],
  },
  {
    key: "medical_claims",
    label: "Klaim Medis",
    labelEn: "Medical Claims",
    description: "Klaim medis per karyawan (jenis manfaat, tagihan, reimburse, disetujui).",
    descriptionEn: "Medical claims per employee (benefit type, bill, reimbursement, approved).",
    model: "medicalClaim",
    defaultField: "docNo",
    fields: [
      // Catatan: MedicalClaim TIDAK punya relasi provider (diperiksa schema —
      // hanya employee/type/lines) → padanan lookup adalah jenis manfaat (type.name).
      F("docNo", "No. Dokumen", "Doc No", "string", "docNo", "Dokumen"),
      F("state", "Status", "Status", "string", "state", "Dokumen"),
      F("claimDate", "Tanggal Klaim", "Claim Date", "date", "claimDate", "Dokumen"),
      F("employeeNo", "NIK", "Employee No", "string", "employee.employeeNo", "Karyawan"),
      F("employeeName", "Nama Karyawan", "Employee Name", "string", "employee.fullName", "Karyawan"),
      F("typeName", "Jenis Manfaat", "Benefit Type", "string", "type.name", "Klaim"),
      // 44-c (M-8): nilai uang MedicalClaim TERENKRIPSI — flag encrypted supaya
      // sel XLSX/CSV + filter memakai nilai TERDEKRIPSI (bukan ciphertext).
      F("totalBill", "Total Tagihan", "Total Bill", "number", "totalBill", "Nilai", true, true),
      F("totalReimburse", "Total Reimburse", "Total Reimbursement", "number", "totalReimburse", "Nilai", true, true),
      F("totalApproved", "Total Disetujui", "Total Approved", "number", "totalApproved", "Nilai", true, true),
    ],
  },
];

export function entityOf(key: string): ReportEntityDef | null {
  return REPORT_ENTITIES.find((e) => e.key === key) ?? null;
}

/** Katalog utk UI (tanpa path Prisma — labels/tipe/filterable saja). */
export function catalogPayload() {
  return {
    entities: REPORT_ENTITIES.map((e) => ({
      key: e.key,
      label: e.label,
      labelEn: e.labelEn,
      description: e.description,
      descriptionEn: e.descriptionEn,
      fields: e.fields.map((f) => ({
        key: f.key, label: f.label, labelEn: f.labelEn, type: f.type, filterable: f.filterable, group: f.group,
      })),
    })),
    ops: FILTER_OPS,
    opsByType: OPS_BY_TYPE,
    limits: LIMITS,
  };
}

// ================= VALIDASI SPESIFIKASI =================

export interface ValidatedSpec {
  entity: ReportEntityDef;
  fields: ReportFieldDef[];
  filters: NormalizedFilter[];
}

/** Parse nilai tanggal: "YYYY-MM-DD" → UTC midnight (kolom date-only Prisma
 *  disimpan midnight UTC); string ISO penuh dipakai apa adanya. */
function parseDateValue(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseScalar(type: FieldType, raw: string): string | number | boolean | Date {
  switch (type) {
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ReportSpecError(`Nilai angka tidak valid: "${raw}"`);
      return n;
    }
    case "date": {
      const d = parseDateValue(raw);
      if (!d) throw new ReportSpecError(`Tanggal tidak valid (format YYYY-MM-DD): "${raw}"`);
      return d;
    }
    case "boolean": {
      if (raw === "true" || raw === "True" || raw === "1") return true;
      if (raw === "false" || raw === "False" || raw === "0") return false;
      throw new ReportSpecError(`Nilai Ya/Tidak tidak valid: "${raw}"`);
    }
    default: {
      const s = raw.trim();
      if (!s) throw new ReportSpecError("Nilai filter wajib diisi");
      if (s.length > LIMITS.maxTextLength) {
        throw new ReportSpecError(`Nilai filter maksimal ${LIMITS.maxTextLength} karakter`);
      }
      return s;
    }
  }
}

function normalizeFilters(ent: ReportEntityDef, inputs: unknown): NormalizedFilter[] {
  if (inputs == null) return [];
  if (!Array.isArray(inputs)) throw new ReportSpecError("filters harus berupa array");
  if (inputs.length > LIMITS.maxFilters) {
    throw new ReportSpecError(`Maksimal ${LIMITS.maxFilters} filter per laporan`);
  }
  const out: NormalizedFilter[] = [];
  for (const item of inputs) {
    const raw = (item ?? {}) as ReportFilterInput;
    const fieldKey = String(raw.field ?? "");
    const def = ent.fields.find((f) => f.key === fieldKey);
    if (!def) throw new ReportSpecError(`Field filter "${fieldKey}" tidak dikenal pada entity ${ent.label}`);
    if (!def.filterable) throw new ReportSpecError(`Field "${def.label}" tidak dapat difilter`);
    const op = String(raw.op ?? "") as FilterOp;
    if (!FILTER_OPS[op]) throw new ReportSpecError(`Operator filter "${String(raw.op ?? "")}" tidak dikenal`);
    if (!OPS_BY_TYPE[def.type].includes(op)) {
      throw new ReportSpecError(
        `Operator "${FILTER_OPS[op].label}" tidak berlaku utk field "${def.label}" (tipe ${def.type})`,
      );
    }
    let value: NormalizedFilter["value"] = null;
    if (op !== "empty" && op !== "notEmpty") {
      const v = raw.value;
      if (v === undefined || v === null || String(v).trim() === "") {
        throw new ReportSpecError(`Nilai filter utk "${def.label}" wajib diisi`);
      }
      if (op === "in") {
        const parts = String(v).split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) throw new ReportSpecError(`Nilai "salah satu dari" utk "${def.label}" wajib diisi`);
        if (parts.length > 50) throw new ReportSpecError(`Daftar nilai maksimal 50 item`);
        value = parts.map((p) => parseScalar(def.type, p));
      } else {
        value = parseScalar(def.type, String(v));
      }
    }
    out.push({ field: fieldKey, op, value, def });
  }
  return out;
}

/** Validasi + normalisasi payload {entity, fields, filters} — lempar
 *  ReportSpecError dgn pesan ID utk response 400. */
export function validateSpec(input: { entity?: unknown; fields?: unknown; filters?: unknown }): ValidatedSpec {
  const entityKey = String(input.entity ?? "");
  const ent = entityOf(entityKey);
  if (!ent) throw new ReportSpecError(`Entity laporan tidak dikenal: "${entityKey}"`);
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    throw new ReportSpecError("Minimal 1 field harus dipilih");
  }
  if (input.fields.length > LIMITS.maxFields) {
    throw new ReportSpecError(`Maksimal ${LIMITS.maxFields} field per laporan`);
  }
  const seen = new Set<string>();
  const fields: ReportFieldDef[] = [];
  for (const raw of input.fields) {
    const key = String(raw);
    const def = ent.fields.find((f) => f.key === key);
    if (!def) throw new ReportSpecError(`Field "${key}" tidak dikenal pada entity ${ent.label}`);
    if (!seen.has(key)) {
      seen.add(key);
      fields.push(def);
    }
  }
  const filters = normalizeFilters(ent, input.filters);
  return { entity: ent, fields, filters };
}

// ================= ENGINE → PRISMA =================

/** Bangun objek bersarang dari path + leaf (utk where/orderBy). */
function nested(path: string[], leaf: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let cur = out;
  for (let i = 0; i < path.length; i++) {
    if (i === path.length - 1) cur[path[i]!] = leaf;
    else {
      const next: Record<string, unknown> = {};
      cur[path[i]!] = next;
      cur = next;
    }
  }
  return out;
}

/** Rentang satu hari UTC — eq/neq tanggal berarti "pada hari itu". */
function dayRange(d: Date): { gte: Date; lt: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}

/** Bangun Prisma where dari filter ternormalisasi (AND semua baris).
 *  Field relasi to-one → nested { relasi: { field: … } }; neq & notEmpty
 *  pada relasi → top-level NOT (baris tanpa relasi tetap terhitung). */
export function buildWhere(filters: NormalizedFilter[]): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  for (const { def, op, value } of filters) {
    const isRelation = def.path.length > 1;
    if (op === "empty") {
      // relasi to-one: null di RELASINYA ({ orgUnit: null }), bukan di field —
      // path ["run","period","name"] → { run: { period: null } }.
      and.push(isRelation ? nested(def.path.slice(0, -1), null) : nested(def.path, null));
      continue;
    }
    if (op === "notEmpty") {
      and.push(
        isRelation
          ? { NOT: nested(def.path.slice(0, -1), null) }
          : nested(def.path, { not: null }),
      );
      continue;
    }
    const eqLeaf = def.type === "date" ? dayRange(value as Date) : value;
    if (op === "eq") {
      and.push(nested(def.path, eqLeaf));
      continue;
    }
    if (op === "neq") {
      and.push(isRelation ? { NOT: nested(def.path, eqLeaf) } : nested(def.path, { not: eqLeaf }));
      continue;
    }
    const leaf: Record<string, unknown> =
      op === "contains"
        ? { contains: value, mode: "insensitive" }
        : op === "in"
          ? { in: value }
          : { [op]: value };
    and.push(nested(def.path, leaf));
  }
  return and.length > 0 ? { AND: and } : {};
}

/** Bangun Prisma select dari field terpilih (relasi → { select: { … } }). */
export function buildSelect(fields: ReportFieldDef[]): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  for (const f of fields) {
    let node: Record<string, unknown> = select;
    for (let i = 0; i < f.path.length; i++) {
      const seg = f.path[i]!;
      if (i === f.path.length - 1) {
        node[seg] = true;
      } else {
        const existing = node[seg];
        let wrapper: { select: Record<string, unknown> };
        if (typeof existing === "object" && existing !== null && "select" in (existing as Record<string, unknown>)) {
          wrapper = existing as { select: Record<string, unknown> };
        } else {
          wrapper = { select: {} };
          node[seg] = wrapper;
        }
        node = wrapper.select;
      }
    }
  }
  return select;
}

/** Baca nilai dari baris hasil query mengikuti path (relasi → kolom datar). */
function readPath(row: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = row;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg] ?? null;
  }
  return cur ?? null;
}

/** Delegate Prisma dinamis (db[model]) — terisolasi dalam satu helper. */
function delegateOf(db: TenantDb, model: string) {
  const d = (db as unknown as Record<string, { findMany: (a: never) => Promise<Record<string, unknown>[]>; count: (a: never) => Promise<number> }>)[model];
  if (!d) throw new Error(`Model Prisma "${model}" tidak tersedia pada client tenant`);
  return d;
}

/** Urutan: field terpilih PERTAMA asc (fallback default entity).
 *  28-c: field terenkripsi tidak bisa diurutkan SQL (ciphertext) → urutan
 *  diterapkan IN-APP setelah dekripsi; SQL memakai fallback default. */
function orderByOf(ent: ReportEntityDef, fields: ReportFieldDef[]): { sql: Record<string, unknown>[]; appSortKey: string | null } {
  const first = fields[0] ?? ent.fields.find((f) => f.key === ent.defaultField) ?? ent.fields[0]!;
  if (first.encrypted) {
    return { sql: [nested(ent.fields.find((f) => f.key === ent.defaultField)?.path ?? ["employeeNo"], "asc")], appSortKey: first.key };
  }
  return { sql: [nested(first.path, "asc")], appSortKey: null };
}

/** Bandingkan nilai utk filter IN-APP pada field terenkripsi (number/string). */
function appMatch(op: FilterOp, actual: unknown, value: unknown): boolean {
  if (op === "empty") return actual == null || actual === "";
  if (op === "notEmpty") return !(actual == null || actual === "");
  const a = typeof actual === "number" ? actual : String(actual ?? "").toLowerCase();
  const b = typeof value === "number" ? value : String(value ?? "").toLowerCase();
  switch (op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "contains": return String(a).includes(String(b));
    case "in": return Array.isArray(value) && value.some((v) => (typeof v === "number" ? v === actual : String(v).toLowerCase() === String(a)));
    case "gt": return (a as number) > (b as number);
    case "gte": return (a as number) >= (b as number);
    case "lt": return (a as number) < (b as number);
    case "lte": return (a as number) <= (b as number);
    default: return true;
  }
}

// ================= RUN =================

export interface RunResult {
  entity: string;
  columns: { key: string; label: string; labelEn: string; type: FieldType }[];
  /** nilai mentah (tanggal = ISO string — diformat di UI; uang terenkripsi
   *  sudah terdekripsi menjadi number). */
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  truncated: boolean;
  /** 28-c: true bila ada filter pada field uang terenkripsi — filter
   *  diterapkan IN-APP (post-dekripsi), total = hasil filter JS (batas aman
   *  baris yang dibaca = exportRows). */
  inAppFiltered?: boolean;
}

/** 45-b: mv (MoneyView) WAJIB — gerbang vault uang: field terenkripsi (uang)
 *  → null saat masked; angka polos & tanggal tetap lewat (pola dm lama). */
export async function runReport(
  db: TenantDb,
  input: { entity?: unknown; fields?: unknown; filters?: unknown; page?: unknown },
  mv: MoneyView,
): Promise<RunResult> {
  const { entity: ent, fields, filters } = validateSpec(input);
  const page = Math.max(1, Math.trunc(Number(input.page ?? 1)) || 1);
  // 28-c: pisahkan filter SQL vs filter field TERENKRIPSI (uang payroll).
  // Filter terenkripsi tidak dapat dievaluasi database (random-IV ciphertext,
  // bukan angka) → fetch baris (cap LIMITS.exportRows) → dekripsi → filter JS.
  const sqlFilters = filters.filter((f) => !f.def.encrypted);
  const appFilters = filters.filter((f) => f.def.encrypted);
  const inApp = appFilters.length > 0;
  const where = buildWhere(sqlFilters);
  const select = buildSelect(fields);
  const { sql: orderBy, appSortKey } = orderByOf(ent, fields);
  const dl = delegateOf(db, ent.model);
  const tc = tenantCryptoForDb(db);
  // 45-b: enc:v1:n saat masked → null (vault uang); plaintext/angka tetap.
  const dm = (v: unknown): unknown => {
    if (v == null) return null;
    if (!mv.canSee && isEncrypted(String(v))) return null;
    return isEncrypted(String(v)) ? tc.decryptMoney(String(v)) : Number(v);
  };

  if (!inApp) {
    const [rawRows, total] = await Promise.all([
      dl.findMany({ where, select, orderBy, take: LIMITS.runPageSize, skip: (page - 1) * LIMITS.runPageSize } as never),
      dl.count({ where } as never),
    ]);
    const rows = rawRows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const f of fields) o[f.key] = f.encrypted ? dm(readPath(r, f.path)) : readPath(r, f.path);
      return o;
    });
    return {
      entity: ent.key,
      columns: fields.map((f) => ({ key: f.key, label: f.label, labelEn: f.labelEn, type: f.type })),
      rows,
      total,
      page,
      pageSize: LIMITS.runPageSize,
      truncated: total > page * LIMITS.runPageSize,
    };
  }

  // jalur filter in-app: baca hingga cap exportRows, filter JS, halaman manual.
  const rawRows = await dl.findMany({ where, select, orderBy, take: LIMITS.exportRows } as never);
  let rows = rawRows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const f of fields) o[f.key] = f.encrypted ? dm(readPath(r, f.path)) : readPath(r, f.path);
    return o;
  });
  for (const f of appFilters) {
    rows = rows.filter((row) => appMatch(f.op, row[f.field], f.value));
  }
  if (appSortKey) {
    rows.sort((a, b) => {
      const av = a[appSortKey], bv = b[appSortKey];
      const an = typeof av === "number" ? av : Number(av);
      const bn = typeof bv === "number" ? bv : Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return String(av ?? "").localeCompare(String(bv ?? ""));
    });
  }
  const total = rows.length;
  const start = (page - 1) * LIMITS.runPageSize;
  const paged = rows.slice(start, start + LIMITS.runPageSize);
  return {
    entity: ent.key,
    columns: fields.map((f) => ({ key: f.key, label: f.label, labelEn: f.labelEn, type: f.type })),
    rows: paged,
    total,
    page,
    pageSize: LIMITS.runPageSize,
    truncated: total > page * LIMITS.runPageSize,
    inAppFiltered: true,
  };
}

// ================= EXPORT (CSV / XLSX) =================

export type ExportFormat = "csv" | "xlsx";

export interface ExportFile {
  body: Buffer | string;
  filename: string;
  contentType: string;
  rowCount: number;
  entityKey: string;
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "dd MMM yyyy" (bulan ID) — + "HH:mm" bila ada komponen waktu (clock in/out). */
function fmtExportDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${p(d.getUTCDate())} ${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
    ? base
    : `${base} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function toCell(v: unknown, type: FieldType): ExportCell {
  if (v == null) return null;
  if (type === "date" && v instanceof Date) return fmtExportDate(v);
  if (type === "boolean") return v ? "Ya" : "Tidak";
  if (type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : String(v);
  }
  return String(v);
}

const widthOf = (f: ReportFieldDef): number =>
  f.type === "number" ? 14 : f.type === "date" ? 15 : f.type === "boolean" ? 12 : Math.min(34, Math.max(14, f.label.length + 8));

/** Bangun file ekspor dari spesifikasi inline (validasi sama dgn run).
 *  Baris dibatasi LIMITS.exportRows (melindungi server). */
export async function buildReportFile(
  db: TenantDb,
  input: { entity?: unknown; fields?: unknown; filters?: unknown; format?: unknown; name?: string },
  mv: MoneyView,
): Promise<ExportFile> {
  const { entity: ent, fields, filters } = validateSpec(input);
  const format = input.format === "xlsx" ? "xlsx" : input.format === "csv" ? "csv" : null;
  if (!format) throw new ReportSpecError("Format ekspor harus csv atau xlsx");
  // 28-c: filter field terenkripsi diterapkan IN-APP (pola runReport).
  const sqlFilters = filters.filter((f) => !f.def.encrypted);
  const appFilters = filters.filter((f) => f.def.encrypted);
  const where = buildWhere(sqlFilters);
  const select = buildSelect(fields);
  const { sql: orderBy } = orderByOf(ent, fields);
  const dl = delegateOf(db, ent.model);
  const rawRows = await dl.findMany({
    where, select, orderBy, take: LIMITS.exportRows,
  } as never);
  // 28-c: dekripsi field uang terenkripsi → number (sebelum masuk sel ekspor).
  // 45-b: enc:v1:n saat masked → null (sel CSV/XLSX kosong — vault uang).
  const tc = tenantCryptoForDb(db);
  const dm = (v: unknown): unknown => {
    if (v == null) return null;
    if (!mv.canSee && isEncrypted(String(v))) return null;
    return isEncrypted(String(v)) ? tc.decryptMoney(String(v)) : Number(v);
  };
  const decRows = rawRows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const f of fields) o[f.key] = f.encrypted ? dm(readPath(r, f.path)) : readPath(r, f.path);
    return o;
  });
  const filtered = appFilters.length > 0
    ? appFilters.reduce((acc, f) => acc.filter((row) => appMatch(f.op, row[f.field], f.value)), decRows)
    : decRows;
  const columns: ExportColumn[] = fields.map((f) => ({ header: f.label, width: widthOf(f) }));
  const rows: ExportCell[][] = filtered.map((r) => fields.map((f) => toCell(r[f.key], f.type)));
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : ent.label;
  const filename = exportFilename(name, format);
  if (format === "csv") {
    return { body: toCsv(columns, rows), filename, contentType: "text/csv; charset=utf-8", rowCount: rows.length, entityKey: ent.key };
  }
  const buf = await toXlsx(ent.label.slice(0, 28) || "Laporan", columns, rows, { title: name });
  return {
    body: buf,
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rowCount: rows.length,
    entityKey: ent.key,
  };
}

// ================= LAPORAN TERSIMPAN (model CustomReport) =================

export interface SavedReportRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  entity: string;
  fields: string[];
  filters: { field: string; op: string; value: string }[];
  createdAt: string;
  updatedAt: string;
}

/** Serialisasi baris CustomReport → row UI (fieldsJson/filtersJson diparse
 *  aman — baris korup di-skip datanya, bukan crash). */
export function serializeSaved(r: {
  id: string; code: string; name: string; description: string | null;
  entity: string; fieldsJson: string; filtersJson: string | null;
  createdAt: Date; updatedAt: Date;
}): SavedReportRow {
  let fields: string[] = [];
  let filters: { field: string; op: string; value: string }[] = [];
  try {
    const parsed = JSON.parse(r.fieldsJson);
    if (Array.isArray(parsed)) fields = parsed.map(String);
  } catch { /* korup → kosong */ }
  try {
    const parsed = r.filtersJson ? JSON.parse(r.filtersJson) : [];
    if (Array.isArray(parsed)) {
      filters = parsed
        .filter((x) => x && typeof x === "object")
        .map((x) => ({ field: String(x.field ?? ""), op: String(x.op ?? ""), value: String(x.value ?? "") }));
    }
  } catch { /* korup → kosong */ }
  return {
    id: r.id, code: r.code, name: r.name, description: r.description, entity: r.entity,
    fields, filters,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

/** Kode unik RPT-KUSTOM-%04d (tahan tabrakan dgn data luar migrasi —
 *  pola announcements PGM-%04d). */
export async function nextReportCode(db: TenantDb): Promise<string> {
  const count = await db.customReport.count();
  let code = `RPT-KUSTOM-${String(count + 1).padStart(4, "0")}`;
  for (let i = 0; i < 100; i++) {
    const clash = await db.customReport.findUnique({ where: { code }, select: { id: true } });
    if (!clash) break;
    code = `RPT-KUSTOM-${String(count + 2 + i).padStart(4, "0")}`;
  }
  return code;
}
