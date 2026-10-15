// ============================================================================
// B5-BL — BENCHMARK PASAR GAJI (DEVELOPMENT-PLAN-BACKLOG.md §4 B5; D-BL16/D-BL17).
// Master benchmark gaji eksternal manual HR (impor XLSX survei / CRUD):
//   • D-BL16 — CRUD master: tahun, label sumber, kunci Grade ATAU Position,
//     p25/p50/p75. Impor XLSX ≤2MB ≤500 baris, pratinjau VALIDASI PER SEL
//     (pola D16 — baris kotor ditolak per sel dgn alasan, TIDAK membatalkan
//     baris lain; commit HANYA baris valid).
//   • D-BL17 — kompa-ratio: gaji pokok karyawan (decrypt server-side via
//     tenantCryptoForDb) vs p50 benchmark — match urut grade → position →
//     fallback TIDAK ADA (chip "belum ada benchmark", TIDAK difabrikasi).
//     Band: ratio < p25/p50 → "Below p25"; ratio > p75/p50 → "Above p75";
//     selain itu "Within band". Nominal gaji hanya di-serialize bila aktor
//     punya money-view (vault gate) — null saat masked → UI "—".
//   • AKSES (di atas menu guard payroll:benchmark yang admin-only): baca =
//     HR/admin (talentHrActor) ATAU Direksi (judul posisi assignment aktif —
//     isDirectorTitle); ESS tidak pernah sampai sini (menu guard lebih dulu).
//     MUTASI + impor + hapus = HR/admin SAJA (Direksi read-only).
//   • Mitigasi risiko §5 "Benchmark bocor ke karyawan": UI banner disclaimer
//     amber — benchmark = data eksternal manual HR; kompa-ratio alat analisis,
//     BUKAN dasar otomatis kenaikan gaji.
// Semua mutasi ter-ActivityLog (pola B1: Created/Updated/Deleted/Processed/
// Exported × entity "SalaryBenchmark" — konsisten pola payroll existing).
// Catatan PG: @@unique 3-kolom nullable NULL-distinct → guard duplikat
// NULL-AWARE di service (findFirst dengan null = IS NULL) → 409.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  talentHrActor, isDirectorTitle,
} from "@/rekankerja/performance/services/talent-service";
import { toXlsxMulti, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";

// ============ error bermuatan status (pola succession-service B4) ============

/** Error service benchmark — bawa status HTTP (400/403/404/409). */
export class BenchmarkError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Map error service → HTTP status (dipakai api/benchmark.ts). */
export function benchmarkErrStatus(e: unknown): number {
  if (e instanceof BenchmarkError) return e.status;
  return 400;
}

// ============ aktor & akses (pola D-BL12 di atas menu guard admin-only) ============

export interface BenchmarkActor {
  name: string;
  /** employeeId aktor — null = akun HR tanpa data karyawan. */
  employeeId: string | null;
  /** true = HR/admin (talentHrActor: OWNER/ADMIN/HR platform / AppUser Admin/HR Manager/HR Staff). */
  isHr: boolean;
}

/** Aktor HR/admin (helper utk API — reuse talentHrActor B3). */
export function benchmarkHrActor(role: string | null | undefined, appUserRole: string | null | undefined): boolean {
  return talentHrActor(role, appUserRole);
}

/** Judul posisi assignment aktif aktor tergolong Direksi (pola B3/B4). */
async function isDirectorActor(db: TenantDb, employeeId: string): Promise<boolean> {
  const myAsg = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    select: { position: { select: { title: true } } },
    orderBy: { validFrom: "desc" },
  });
  return isDirectorTitle(myAsg?.position?.title);
}

/** Baca data benchmark: HR/admin ATAU Direksi (data kompensasi strategis). */
async function assertViewer(db: TenantDb, actor: BenchmarkActor): Promise<void> {
  if (actor.isHr) return;
  if (actor.employeeId && (await isDirectorActor(db, actor.employeeId))) return;
  throw new BenchmarkError(
    "Data benchmark pasar gaji hanya untuk HR/admin atau Direksi (D-BL17). ESS tidak melihat benchmark.",
    403,
  );
}

/** Mutasi master benchmark (CRUD/impor/hapus): HR/admin saja — Direksi read-only. */
function assertMutator(actor: BenchmarkActor): void {
  if (!actor.isHr) {
    throw new BenchmarkError(
      "Perubahan master benchmark gaji hanya oleh HR/admin — Direksi dapat melihat (read-only).",
      403,
    );
  }
}

// ============ batas impor (pola D16 §18.5 — sama goals target) ============

export const BENCHMARK_IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const BENCHMARK_IMPORT_MAX_ROWS = 500;

// ============ tipe baris ============

/** Satu baris register benchmark (mirror UI). */
export interface BenchmarkRow {
  id: string;
  year: number;
  sourceLabel: string;
  gradeCode: string | null;
  positionId: string | null;
  positionCode: string | null;
  positionTitle: string | null;
  currency: string;
  p25: number;
  p50: number;
  p75: number;
  updatedAt: string;
}

export interface BenchmarkListResult {
  rows: BenchmarkRow[];
  viewer: { isHr: boolean };
}

/** ============ CRUD master (D-BL16) ============ */

/** Validasi bersama upsert manual & impor: kunci tunggal + p25≤p50≤p75>0. */
async function validateInput(
  db: TenantDb,
  input: { year: number; sourceLabel: string; gradeCode?: string | null; positionId?: string | null; currency?: string; p25: number; p50: number; p75: number },
): Promise<{ gradeCode: string | null; positionId: string | null; currency: string }> {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new BenchmarkError("Tahun harus bilangan bulat 2000–2100", 400);
  }
  const sourceLabel = String(input.sourceLabel ?? "").trim();
  if (!sourceLabel) throw new BenchmarkError("Label sumber wajib diisi (mis. \"Survei Gaji Nusantara 2026\")", 400);
  if (sourceLabel.length > 120) throw new BenchmarkError("Label sumber maksimal 120 karakter", 400);

  // kunci TUNGGAL: tepat satu dari gradeCode / positionId (D-BL16)
  const hasGrade = input.gradeCode != null && String(input.gradeCode).trim() !== "";
  const hasPos = input.positionId != null && String(input.positionId).trim() !== "";
  if (hasGrade && hasPos) {
    throw new BenchmarkError("Pilih TEPAT SATU kunci: kode grade ATAU posisi (keduanya terisi)", 400);
  }
  if (!hasGrade && !hasPos) {
    throw new BenchmarkError("Kunci wajib dipilih: kode grade ATAU kode posisi (keduanya kosong)", 400);
  }
  let gradeCode: string | null = null;
  let positionId: string | null = null;
  if (hasGrade) {
    const code = String(input.gradeCode).trim();
    const grade = await db.grade.findFirst({ where: { code }, select: { code: true, active: true } });
    if (!grade || !grade.active) {
      throw new BenchmarkError(`Kode grade tidak ada di master (aktif): "${code}"`, 400);
    }
    gradeCode = grade.code;
  } else {
    const pid = String(input.positionId).trim();
    const position = await db.position.findUnique({ where: { id: pid }, select: { id: true, active: true } });
    if (!position) throw new BenchmarkError("Posisi tidak ditemukan — pilih ulang posisi", 404);
    if (!position.active) throw new BenchmarkError("Posisi harus aktif untuk dijadikan kunci benchmark", 400);
    positionId = position.id;
  }

  const currency = (String(input.currency ?? "").trim() || "IDR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BenchmarkError("Mata uang harus kode 3 huruf (mis. IDR, USD)", 400);
  }
  const { p25, p50, p75 } = input;
  for (const [label, v] of [["p25", p25], ["p50", p50], ["p75", p75]] as const) {
    if (!Number.isFinite(v) || v <= 0) throw new BenchmarkError(`${label} harus angka positif > 0`, 400);
  }
  if (p25 > p50 || p50 > p75) {
    throw new BenchmarkError("Persentil harus berurut: p25 ≤ p50 ≤ p75", 400);
  }
  return { gradeCode, positionId, currency };
}

/** Guard duplikat NULL-AWARE (unique 3-kolom nullable PG NULL-distinct → 409). */
async function assertNoDuplicate(
  db: TenantDb,
  year: number, sourceLabel: string, gradeCode: string | null, positionId: string | null, excludeId?: string,
): Promise<void> {
  // Prisma where null = IS NULL → null-aware (berbeda dari unique index PG).
  const dupe = await db.salaryBenchmark.findFirst({
    where: { year, sourceLabel, gradeCode, positionId },
    select: { id: true },
  });
  if (dupe && dupe.id !== excludeId) {
    const key = gradeCode ?? "(posisi)";
    throw new BenchmarkError(
      `Sudah ada benchmark tahun ${year} sumber "${sourceLabel}" kunci ${key} — ubah entri yang ada (kunci & tahun & sumber harus unik)`,
      409,
    );
  }
}

async function toRow(db: TenantDb, b: {
  id: string; year: number; sourceLabel: string; gradeCode: string | null; positionId: string | null;
  currency: string; p25: number; p50: number; p75: number; updatedAt: Date;
}): Promise<BenchmarkRow> {
  let positionCode: string | null = null;
  let positionTitle: string | null = null;
  if (b.positionId) {
    const p = await db.position.findUnique({ where: { id: b.positionId }, select: { code: true, title: true } });
    positionCode = p?.code ?? null;
    positionTitle = p?.title ?? null;
  }
  return {
    id: b.id, year: b.year, sourceLabel: b.sourceLabel,
    gradeCode: b.gradeCode, positionId: b.positionId, positionCode, positionTitle,
    currency: b.currency, p25: b.p25, p50: b.p50, p75: b.p75,
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** Tambah (id=null) / ubah master benchmark. Duplikat tahun+sumber+kunci → 409. */
export async function upsertBenchmark(
  db: TenantDb,
  actor: BenchmarkActor,
  input: { id?: string; year: number; sourceLabel: string; gradeCode?: string | null; positionId?: string | null; currency?: string; p25: number; p50: number; p75: number },
): Promise<BenchmarkRow> {
  assertMutator(actor);
  const v = await validateInput(db, input);
  await assertNoDuplicate(db, input.year, String(input.sourceLabel).trim(), v.gradeCode, v.positionId, input.id);

  if (input.id) {
    const existing = await db.salaryBenchmark.findUnique({ where: { id: input.id } });
    if (!existing) throw new BenchmarkError("Entri benchmark tidak ditemukan", 404);
    const updated = await db.salaryBenchmark.update({
      where: { id: existing.id },
      data: {
        year: input.year, sourceLabel: String(input.sourceLabel).trim(),
        gradeCode: v.gradeCode, positionId: v.positionId, currency: v.currency,
        p25: input.p25, p50: input.p50, p75: input.p75,
      },
    });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "SalaryBenchmark", entityId: updated.id,
        detail: `Benchmark gaji ${updated.year} "${updated.sourceLabel}" kunci ${updated.gradeCode ?? "(posisi)"} diubah oleh ${actor.name}: p25=${updated.p25} · p50=${updated.p50} · p75=${updated.p75} ${updated.currency} (D-BL16)`,
      },
    });
    return toRow(db, updated);
  }

  const created = await db.salaryBenchmark.create({
    data: {
      year: input.year, sourceLabel: String(input.sourceLabel).trim(),
      gradeCode: v.gradeCode, positionId: v.positionId, currency: v.currency,
      p25: input.p25, p50: input.p50, p75: input.p75,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "SalaryBenchmark", entityId: created.id,
      detail: `Benchmark gaji ${created.year} "${created.sourceLabel}" kunci ${created.gradeCode ?? "(posisi)"} ditambahkan oleh ${actor.name}: p25=${created.p25} · p50=${created.p50} · p75=${created.p75} ${created.currency} (D-BL16)`,
    },
  });
  return toRow(db, created);
}

/** Hapus satu entri master benchmark. */
export async function deleteBenchmark(db: TenantDb, actor: BenchmarkActor, id: string): Promise<{ id: string }> {
  assertMutator(actor);
  const existing = await db.salaryBenchmark.findUnique({ where: { id } });
  if (!existing) throw new BenchmarkError("Entri benchmark tidak ditemukan", 404);
  await db.salaryBenchmark.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "SalaryBenchmark", entityId: id,
      detail: `Benchmark gaji ${existing.year} "${existing.sourceLabel}" kunci ${existing.gradeCode ?? "(posisi)"} dihapus oleh ${actor.name}`,
    },
  });
  return { id };
}

/** Register master benchmark — urut tahun desc, sumber, kode grade/posisi. */
export async function listBenchmarks(
  db: TenantDb,
  actor: BenchmarkActor,
  opt: { year?: number; sourceLabel?: string } = {},
): Promise<BenchmarkListResult> {
  await assertViewer(db, actor);
  const rows = await db.salaryBenchmark.findMany({
    where: {
      ...(opt.year != null ? { year: opt.year } : {}),
      ...(opt.sourceLabel ? { sourceLabel: opt.sourceLabel } : {}),
    },
    orderBy: [{ year: "desc" }, { sourceLabel: "asc" }, { gradeCode: "asc" }, { positionId: "asc" }],
  });
  // resolusi kode posisi batch (1 query — hindari N+1)
  const posIds = [...new Set(rows.map((r) => r.positionId).filter((p): p is string => !!p))];
  const positions = posIds.length
    ? await db.position.findMany({ where: { id: { in: posIds } }, select: { id: true, code: true, title: true } })
    : [];
  const posById = new Map(positions.map((p) => [p.id, p]));
  return {
    rows: rows.map((r): BenchmarkRow => ({
      id: r.id, year: r.year, sourceLabel: r.sourceLabel,
      gradeCode: r.gradeCode, positionId: r.positionId,
      positionCode: r.positionId ? posById.get(r.positionId)?.code ?? null : null,
      positionTitle: r.positionId ? posById.get(r.positionId)?.title ?? null : null,
      currency: r.currency, p25: r.p25, p50: r.p50, p75: r.p75,
      updatedAt: r.updatedAt.toISOString(),
    })),
    viewer: { isHr: actor.isHr },
  };
}

/** Daftar {year, sourceLabel} unik utk selector konteks (tahun desc, sumber). */
export async function listSources(db: TenantDb, actor: BenchmarkActor): Promise<{
  sources: { year: number; sourceLabel: string }[];
}> {
  await assertViewer(db, actor);
  const rows = await db.salaryBenchmark.findMany({
    distinct: ["year", "sourceLabel"],
    orderBy: [{ year: "desc" }, { sourceLabel: "asc" }],
    select: { year: true, sourceLabel: true },
  });
  return { sources: rows };
}

/** Picker posisi aktif utk dialog upsert kunci posisi (urut kode). */
export async function positionsForPicker(db: TenantDb, actor: BenchmarkActor): Promise<{
  positions: { id: string; code: string; title: string }[];
}> {
  await assertViewer(db, actor);
  const rows = await db.position.findMany({
    where: { active: true },
    select: { id: true, code: true, title: true },
    orderBy: { code: "asc" },
  });
  return { positions: rows };
}

// ============ template impor (D-BL16 — pola buildTargetTemplateXlsx D16) ============

/** Kolom template dwibahasa (parser impor menerima keduanya). */
const TEMPLATE_COLUMNS: { key: string; id: string; en: string; width: number }[] = [
  { key: "year", id: "Tahun", en: "Year", width: 10 },
  { key: "sourceLabel", id: "Label Sumber", en: "Source Label", width: 30 },
  { key: "gradeCode", id: "Kode Grade", en: "Grade Code", width: 14 },
  { key: "positionCode", id: "Kode Posisi", en: "Position Code", width: 16 },
  { key: "p25", id: "p25", en: "p25", width: 14 },
  { key: "p50", id: "p50", en: "p50", width: 14 },
  { key: "p75", id: "p75", en: "p75", width: 14 },
  { key: "currency", id: "Mata Uang", en: "Currency", width: 12 },
];

/** Buat workbook template .xlsx dwibahasa (sheet Data + Petunjuk/Cara Pakai). */
export async function buildBenchmarkTemplateXlsx(lang: Lang): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RekanKerja HRIS";

  const L = <T,>(id: T, en: T): T => (lang === "en" ? en : id);

  const instr = wb.addWorksheet(L("Petunjuk", "How to Use"));
  instr.columns = [{ width: 4 }, { width: 110 }];
  instr.addRow({ 1: "", 2: L("TEMPLATE IMPOR BENCHMARK GAJI PASAR", "SALARY MARKET BENCHMARK IMPORT TEMPLATE") });
  // langkah instruksi pasangan dwibahasa [ID, EN] — konvensi R3 audit
  const INSTR_STEPS: Record<string, [string, string]> = {
    s1: [
      "1. Isi sheet \"Data\" — maksimal 500 baris; hanya kolom A–H yang boleh diisi.",
      "1. Fill the \"Data\" sheet — max 500 rows; only columns A–H.",
    ],
    s2: [
      "2. Kunci benchmark TEPAT SATU: kolom \"Kode Grade\" ATAU \"Kode Posisi\" (keduanya terisi / keduanya kosong = baris ditolak).",
      "2. Exactly ONE key: fill \"Grade Code\" OR \"Position Code\" (both filled / both empty = row rejected).",
    ],
    s3: [
      "3. Persentil harus berurut positif: p25 ≤ p50 ≤ p75 (angka > 0).",
      "3. Percentiles must be ordered positive: p25 ≤ p50 ≤ p75 (numbers > 0).",
    ],
    s4: [
      "4. Mata uang opsional kode 3 huruf (kosong = IDR).",
      "4. Currency optional, a 3-letter code (empty = IDR).",
    ],
    s5: [
      "5. Baris yang tidak valid TIDAK membatalkan baris lain — perbaiki baris merah lalu unggah ulang.",
      "5. Invalid rows never cancel other rows — fix the red rows and re-upload.",
    ],
    s6: [
      "6. Kompa-ratio karyawan dihitung dari p50: cocokkan grade assignment → posisi → tanpa fallback.",
      "6. Employee compa-ratio uses p50: match assignment grade → position → no fallback.",
    ],
  };
  for (const steps of Object.values(INSTR_STEPS)) {
    instr.addRow({ 1: "", 2: steps[0] });
    instr.addRow({ 1: "", 2: steps[1] });
  }
  instr.addRow({ 1: "", 2: "" });
  instr.getRow(1).font = { bold: true, size: 13 };

  const data = wb.addWorksheet(L("Data", "Data"));
  data.columns = TEMPLATE_COLUMNS.map((c) => ({
    header: lang === "en" ? c.en : c.id,
    width: c.width,
  }));
  data.getRow(1).font = { bold: true };
  data.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  // baris contoh (kunci grade G1 — abu miring); label contoh = data template,
  // bukan string display UI (contoh isi spreadsheet — di luar konvensi t()).
  const exampleSource = "Survei Gaji Nusantara 2026";
  data.addRow([2026, exampleSource, "G1", "", 5000000, 7000000, 9500000, "IDR"]);
  data.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ============ impor XLSX (D16 — pratinjau per sel + commit baris valid) ============

/** Sel hasil parse satu baris (string mentah — mirror pratinjau UI). */
export interface BenchmarkImportCells {
  year: string;
  sourceLabel: string;
  gradeCode: string;
  positionCode: string;
  p25: string;
  p50: string;
  p75: string;
  currency: string;
}

export interface BenchmarkImportRow {
  rowNo: number;
  cells: BenchmarkImportCells;
  valid: boolean;
  errors: { col: string; reason: string }[];
  /** terisi server saat valid (dipakai commit): */
  positionId?: string;
  dup?: string | null; // penanda baris duplikat (alasan — tampil kuning, TIDAK di-commit)
}

export interface BenchmarkImportPreview {
  rows: BenchmarkImportRow[];
  summary: { valid: number; error: number; dup: number };
}

/** Normalisasi header seluler (pola machine-import goals — kamus teknis parser). */
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_KEYS: Record<string, string[]> = {
  year: "tahun year".split(" "),
  sourceLabel: "labelsumber sourcelabel sumber source".split(" "),
  gradeCode: "kodegrade gradecode grade".split(" "),
  positionCode: "kodeposisi positioncode posisi position".split(" "),
  p25: ["p25"],
  p50: ["p50"],
  p75: ["p75"],
  currency: "matauang currency".split(" "),
};

const numOrNull = (s: string): number | null => {
  if (s === "") return null;
  const n = Number(String(s).replace(/,/g, ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Pratinjau impor: parse .xlsx + validasi PER SEL (D16 — duplikat vs file & db
 * ditandai per baris; baris kotor tidak membatalkan baris lain). */
export async function importBenchmarkPreview(
  db: TenantDb, actor: BenchmarkActor,
  file: { buffer: Buffer; name: string; type: string },
): Promise<BenchmarkImportPreview> {
  assertMutator(actor);
  if (file.buffer.byteLength > BENCHMARK_IMPORT_MAX_BYTES) throw new BenchmarkError("Ukuran file melebihi 2 MB (D16)", 400);
  if (!/\.xlsx$/i.test(file.name) && file.type !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    throw new BenchmarkError("Hanya file .xlsx yang diterima (D16)", 400);
  }
  if (file.buffer.length < 4 || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    throw new BenchmarkError("Berkas bukan .xlsx yang sah (magic number)", 400);
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Data") ?? wb.worksheets[wb.worksheets.length - 1];
  if (!ws) throw new BenchmarkError("Sheet \"Data\" tidak ditemukan");

  // peta header (baris 1) — dwibahasa via kata kunci
  const headerRow = ws.getRow(1);
  const colOf: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = norm(String(cell.text ?? ""));
    for (const [key, words] of Object.entries(HEADER_KEYS)) {
      if (colOf[key]) continue;
      if (words.some((w) => h === w || h.includes(w))) colOf[key] = col;
    }
  });
  for (const k of ["year", "sourceLabel", "p25", "p50", "p75"]) {
    if (!colOf[k]) throw new BenchmarkError(`Kolom wajib tidak ditemukan: ${k} — gunakan template resmi (Unduh Template)`, 400);
  }

  // master lookup (validasi cepat kode)
  const grades = await db.grade.findMany({ where: { active: true }, select: { code: true } });
  const gradeSet = new Set(grades.map((g) => g.code.toUpperCase()));
  const positions = await db.position.findMany({ select: { id: true, code: true, active: true } });
  const posByCode = new Map(positions.filter((p) => p.active).map((p) => [p.code.toUpperCase(), p]));
  const existing = await db.salaryBenchmark.findMany({ select: { year: true, sourceLabel: true, gradeCode: true, positionId: true } });
  const dbKeys = new Set(existing.map((b) => `${b.year}|${b.sourceLabel.trim().toLowerCase()}|${(b.gradeCode ?? "").toUpperCase()}|${b.positionId ?? ""}`));

  const rows: BenchmarkImportRow[] = [];
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1 || rn > BENCHMARK_IMPORT_MAX_ROWS + 2) return;
    const get = (key: string): string => colOf[key] ? String(row.getCell(colOf[key]).text ?? "").trim() : "";
    const cells: BenchmarkImportCells = {
      year: get("year"), sourceLabel: get("sourceLabel"), gradeCode: get("gradeCode"), positionCode: get("positionCode"),
      p25: get("p25"), p50: get("p50"), p75: get("p75"), currency: get("currency"),
    };
    if (!cells.year && !cells.sourceLabel && !cells.gradeCode && !cells.positionCode && !cells.p25 && !cells.p50 && !cells.p75 && !cells.currency) {
      return; // baris kosong dilewati
    }
    const r: BenchmarkImportRow = { rowNo: rn, cells, valid: true, errors: [], dup: null };
    const err = (col: string, reason: string) => { r.valid = false; r.errors.push({ col, reason }); };

    // 1 — tahun (2000–2100)
    const year = numOrNull(cells.year);
    if (cells.year === "") err("year", "Tahun kosong");
    else if (year == null || !Number.isInteger(year)) err("year", `Tahun bukan angka: "${cells.year}"`);
    else if (year < 2000 || year > 2100) err("year", `Tahun harus 2000–2100: "${cells.year}"`);

    // 2 — label sumber
    if (cells.sourceLabel === "") err("sourceLabel", "Label sumber kosong");
    else if (cells.sourceLabel.length > 120) err("sourceLabel", "Label sumber maksimal 120 karakter");

    // 3 — kunci tunggal (grade ATAU posisi)
    const hasGrade = cells.gradeCode !== "";
    const hasPos = cells.positionCode !== "";
    if (hasGrade && hasPos) err("kunci", "Pilih TEPAT SATU kunci: kode grade ATAU kode posisi (keduanya terisi)");
    if (!hasGrade && !hasPos) err("kunci", "Kode grade dan kode posisi kosong — pilih salah satu kunci");
    if (hasGrade && !gradeSet.has(cells.gradeCode.toUpperCase())) {
      err("gradeCode", `Kode grade tidak ada di master (aktif): "${cells.gradeCode}"`);
    }
    if (hasPos && !posByCode.has(cells.positionCode.toUpperCase())) {
      err("positionCode", `Kode posisi tidak ada di master: "${cells.positionCode}"`);
    } else if (hasPos && posByCode.has(cells.positionCode.toUpperCase())) {
      r.positionId = posByCode.get(cells.positionCode.toUpperCase())?.id;
    }

    // 4 — persentil (positif, berurut)
    const p25 = numOrNull(cells.p25);
    const p50 = numOrNull(cells.p50);
    const p75 = numOrNull(cells.p75);
    if (cells.p25 === "") err("p25", "p25 kosong");
    else if (p25 == null) err("p25", `p25 bukan angka: "${cells.p25}"`);
    else if (p25 <= 0) err("p25", `p25 harus > 0: "${cells.p25}"`);
    if (cells.p50 === "") err("p50", "p50 kosong");
    else if (p50 == null) err("p50", `p50 bukan angka: "${cells.p50}"`);
    else if (p50 <= 0) err("p50", `p50 harus > 0: "${cells.p50}"`);
    if (cells.p75 === "") err("p75", "p75 kosong");
    else if (p75 == null) err("p75", `p75 bukan angka: "${cells.p75}"`);
    else if (p75 <= 0) err("p75", `p75 harus > 0: "${cells.p75}"`);
    if (p25 != null && p50 != null && p25 > p50) err("p25", `p25 (${cells.p25}) lebih besar dari p50 (${cells.p50}) — harus p25 ≤ p50`);
    if (p50 != null && p75 != null && p50 > p75) err("p50", `p50 (${cells.p50}) lebih besar dari p75 (${cells.p75}) — harus p50 ≤ p75`);

    // 5 — mata uang (opsional, 3 huruf)
    const cur = cells.currency.toUpperCase();
    if (cells.currency !== "" && !/^[A-Z]{3}$/.test(cur)) {
      err("currency", `Mata uang harus kode 3 huruf (mis. IDR): "${cells.currency}"`);
    }

    // 6 — duplikat (dalam file & vs database) — ditandai per baris
    const dkey = `${year ?? cells.year}|${cells.sourceLabel.toLowerCase()}|${cells.gradeCode.toUpperCase()}|${r.positionId ?? ""}`;
    if (seen.has(dkey)) {
      r.dup = "Duplikat dalam file (tahun+sumber+kunci sama sudah ada di baris atas)";
      r.valid = false;
      r.errors.push({ col: "kunci", reason: r.dup });
    } else {
      seen.add(dkey);
      if (dbKeys.has(dkey)) {
        r.dup = "Sudah ada di database (tahun+sumber+kunci sama) — ubah lewat menu edit";
        r.valid = false;
        r.errors.push({ col: "kunci", reason: r.dup });
      }
    }
    rows.push(r);
  });
  if (rows.length > BENCHMARK_IMPORT_MAX_ROWS) {
    throw new BenchmarkError(`Maksimal ${BENCHMARK_IMPORT_MAX_ROWS} baris per file (D16)`, 400);
  }

  const summary = {
    valid: rows.filter((r) => r.valid).length,
    error: rows.filter((r) => !r.valid && !r.dup).length,
    dup: rows.filter((r) => !!r.dup).length,
  };
  return { rows, summary };
}

/** Commit impor — HANYA baris valid (re-validasi server; duplikat race → skip). */
export async function importBenchmarkCommit(
  db: TenantDb, actor: BenchmarkActor,
  rows: (BenchmarkImportCells & { rowNo?: number })[],
): Promise<{ inserted: number; skipped: number }> {
  assertMutator(actor);
  if (rows.length > BENCHMARK_IMPORT_MAX_ROWS) {
    throw new BenchmarkError(`Maksimal ${BENCHMARK_IMPORT_MAX_ROWS} baris (D16)`, 400);
  }
  const positions = await db.position.findMany({ select: { id: true, code: true, active: true } });
  const posByCode = new Map(positions.filter((p) => p.active).map((p) => [p.code.toUpperCase(), p]));
  const grades = await db.grade.findMany({ where: { active: true }, select: { code: true } });
  const gradeSet = new Set(grades.map((g) => g.code.toUpperCase()));
  const existing = await db.salaryBenchmark.findMany({ select: { year: true, sourceLabel: true, gradeCode: true, positionId: true } });
  const dbKeys = new Set(existing.map((b) => `${b.year}|${b.sourceLabel.trim().toLowerCase()}|${(b.gradeCode ?? "").toUpperCase()}|${b.positionId ?? ""}`));

  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const year = numOrNull(String(r.year ?? ""));
    const p25 = numOrNull(String(r.p25 ?? ""));
    const p50 = numOrNull(String(r.p50 ?? ""));
    const p75 = numOrNull(String(r.p75 ?? ""));
    const sourceLabel = String(r.sourceLabel ?? "").trim();
    const gradeCode = String(r.gradeCode ?? "").trim();
    const positionCode = String(r.positionCode ?? "").trim();
    const currency = (String(r.currency ?? "").trim() || "IDR").toUpperCase();
    const positionId = positionCode ? posByCode.get(positionCode.toUpperCase())?.id ?? null : null;

    // re-validasi keras (jangan percaya body klien — pola D16 commit)
    const gradeOk = gradeCode === "" || gradeSet.has(gradeCode.toUpperCase());
    const posOk = positionCode === "" || positionId != null;
    const keyOk = (gradeCode === "") !== (positionCode === ""); // tepat satu terisi
    const numsOk = p25 != null && p50 != null && p75 != null
      && p25 > 0 && p50 > 0 && p75 > 0 && p25 <= p50 && p50 <= p75;
    if (
      year == null || !Number.isInteger(year) || year < 2000 || year > 2100
      || !sourceLabel || !gradeOk || !posOk || !keyOk || !numsOk
      || !/^[A-Z]{3}$/.test(currency)
    ) { skipped++; continue; }
    const gradeKey = gradeCode ? gradeCode.toUpperCase() : "";
    const dkey = `${year}|${sourceLabel.toLowerCase()}|${gradeKey}|${positionId ?? ""}`;
    if (dbKeys.has(dkey)) { skipped++; continue; }
    dbKeys.add(dkey); // cegah duplikat antar-baris commit yang sama

    await db.salaryBenchmark.create({
      data: {
        year, sourceLabel,
        gradeCode: gradeCode ? gradeCode.toUpperCase() : null,
        positionId, currency, p25, p50, p75,
      },
    });
    inserted++;
  }
  if (inserted > 0) {
    await db.activityLog.create({
      data: {
        action: "Created", entity: "SalaryBenchmark",
        detail: `Impor benchmark gaji oleh ${actor.name}: ${inserted} baris dimasukkan, ${skipped} lompat (D-BL16/D16 — hanya baris valid)`,
      },
    });
  }
  return { inserted, skipped };
}

// ============ kompa-ratio (D-BL17) ============

/** Money view minimal utk serializer nominal (vault gate — D-BL17). */
export interface BenchmarkMoneyView {
  canSee: boolean;
  dec(v: string | null | undefined): number | null;
}

export type CompaBand = "below" | "within" | "above";

export interface CompaRow {
  employeeNo: string;
  fullName: string;
  unit: string | null;
  positionTitle: string | null;
  gradeCode: string | null;
  /** ratio = gaji pokok / p50 (2 desimal) — null = tak ada benchmark / gaji kosong. */
  ratio: number | null;
  /** band: below (ratio < p25/p50) | within | above (ratio > p75/p50) — null tanpa benchmark. */
  band: CompaBand | null;
  p50: number | null;
  matchedKey: "grade" | "position" | null;
  /** nominal gaji pokok — HANYA di-serialize bila money-view canSee (else null → UI "—"). */
  baseSalaryNominal: number | null;
}

export interface CompaDashboardResult {
  stats: { below: number; within: number; above: number; avgRatio: number | null; noBenchmark: number; total: number };
  rows: CompaRow[];
  context: { year: number | null; sourceLabel: string | null; sources: { year: number; sourceLabel: string }[] };
}

/** Band final (D-BL17): ratio < p25/p50 → below; ratio > p75/p50 → above; else within. */
export function bandOf(ratio: number, p25: number, p50: number, p75: number): CompaBand {
  if (ratio < p25 / p50) return "below";
  if (ratio > p75 / p50) return "above";
  return "within";
}

/** Dashboard kompa-ratio seluruh karyawan Active (D-BL17):
 * match p50 urut grade → position → TANPA fallback (ratio null, tidak difabrikasi). */
export async function compaDashboard(
  db: TenantDb,
  actor: BenchmarkActor,
  opt: { year?: number; sourceLabel?: string } = {},
  mv: BenchmarkMoneyView,
): Promise<CompaDashboardResult> {
  await assertViewer(db, actor);

  // ---- konteks: tahun + sumber terpilih pemirsa; default year max + sumber terbaru ----
  const allSources = await db.salaryBenchmark.findMany({
    distinct: ["year", "sourceLabel"],
    orderBy: [{ year: "desc" }, { sourceLabel: "asc" }],
    select: { year: true, sourceLabel: true },
  });
  let year: number | null = null;
  let sourceLabel: string | null = null;
  if (opt.year != null) {
    year = opt.year;
    if (opt.sourceLabel) {
      sourceLabel = opt.sourceLabel;
    } else if (allSources.some((s) => s.year === opt.year)) {
      // sumber TERBARU (createdAt desc) pada tahun terpilih
      const latest = await db.salaryBenchmark.findFirst({
        where: { year },
        orderBy: { createdAt: "desc" },
        select: { sourceLabel: true },
      });
      sourceLabel = latest?.sourceLabel ?? null;
    }
  } else if (allSources.length > 0) {
    year = allSources[0].year; // tahun maksimum
    const latest = await db.salaryBenchmark.findFirst({
      where: { year },
      orderBy: { createdAt: "desc" },
      select: { sourceLabel: true },
    });
    sourceLabel = latest?.sourceLabel ?? allSources[0].sourceLabel;
  }

  // ---- benchmark terpilih (peta kunci grade & posisi) ----
  const benchmarks = year != null && sourceLabel
    ? await db.salaryBenchmark.findMany({ where: { year, sourceLabel }, select: { gradeCode: true, positionId: true, p25: true, p50: true, p75: true } })
    : [];
  const byGrade = new Map<string, { p25: number; p50: number; p75: number }>();
  const byPosition = new Map<string, { p25: number; p50: number; p75: number }>();
  for (const b of benchmarks) {
    if (b.gradeCode != null) byGrade.set(b.gradeCode.toUpperCase(), b);
    if (b.positionId != null) byPosition.set(b.positionId, b);
  }

  // ---- populasi karyawan Active + assignment aktif ----
  const tc = tenantCryptoForDb(db);
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    select: {
      employeeNo: true, fullName: true,
      assignments: {
        where: { validTo: null },
        orderBy: { validFrom: "desc" },
        select: {
          baseSalary: true,
          orgUnit: { select: { name: true } },
          position: { select: { id: true, title: true } },
          grade: { select: { code: true } },
        },
      },
    },
    orderBy: { employeeNo: "asc" },
  });

  const rows: CompaRow[] = employees.map((e) => {
    const active = e.assignments[0] ?? null;
    const gradeCode = active?.grade?.code ?? null;
    const positionId = active?.position?.id ?? null;
    // match urut (D-BL17): grade → position → TIDAK ADA fallback
    let match: { p25: number; p50: number; p75: number } | null = null;
    let matchedKey: "grade" | "position" | null = null;
    if (gradeCode && byGrade.has(gradeCode.toUpperCase())) {
      match = byGrade.get(gradeCode.toUpperCase())!;
      matchedKey = "grade";
    } else if (positionId && byPosition.has(positionId)) {
      match = byPosition.get(positionId)!;
      matchedKey = "position";
    }
    const base = active ? tc.decryptMoney(active.baseSalary) : null;
    const ratio = match && base != null && match.p50 > 0
      ? Math.round((base / match.p50) * 100) / 100
      : null;
    const band = match && ratio != null ? bandOf(ratio, match.p25, match.p50, match.p75) : null;
    return {
      employeeNo: e.employeeNo,
      fullName: e.fullName,
      unit: active?.orgUnit?.name ?? null,
      positionTitle: active?.position?.title ?? null,
      gradeCode,
      ratio,
      band,
      p50: match?.p50 ?? null,
      matchedKey,
      // nominal hanya utk aktor money-view (D-BL17 — vault gate); else null → "—"
      baseSalaryNominal: mv.canSee ? (active ? mv.dec(active.baseSalary) : null) : null,
    };
  });

  const withRatio = rows.filter((r) => r.ratio != null);
  const stats = {
    below: rows.filter((r) => r.band === "below").length,
    within: rows.filter((r) => r.band === "within").length,
    above: rows.filter((r) => r.band === "above").length,
    avgRatio: withRatio.length
      ? Math.round((withRatio.reduce((s, r) => s + (r.ratio ?? 0), 0) / withRatio.length) * 100) / 100
      : null,
    noBenchmark: rows.filter((r) => r.matchedKey == null).length,
    total: rows.length,
  };
  return { stats, rows, context: { year, sourceLabel, sources: allSources } };
}

// ============ laporan XLSX dwibahasa (pola D-BL15 succession) ============

/** Label band dwibahasa (utk UI & export). */
export const BAND_LABELS: Record<CompaBand, { id: string; en: string }> = {
  below: { id: "Di bawah p25", en: "Below p25" },
  within: { id: "Dalam rentang", en: "Within band" },
  above: { id: "Di atas p75", en: "Above p75" },
};

/** Laporan XLSX benchmark dwibahasa: Sheet "Ringkasan Kompa-Ratio" (per
 * karyawan) + Sheet "Master Benchmark" (register). Kolom nominal gaji hanya
 * utk aktor canSee (di-omit saat masked — D-BL17). */
export async function exportBenchmarkXlsx(
  db: TenantDb,
  actor: BenchmarkActor,
  lang: Lang,
  mv: BenchmarkMoneyView,
  opt: { year?: number; sourceLabel?: string } = {},
): Promise<{ buffer: Buffer; filename: string }> {
  const { rows, context } = await compaDashboard(db, actor, opt, mv);
  const { rows: master } = await listBenchmarks(db, actor, {});
  const L = <T,>(id: T, en: T): T => (lang === "en" ? en : id);

  // Sheet 1 — Ringkasan Kompa-Ratio (per karyawan)
  const compaCols = [
    { header: L("No. Karyawan", "Employee No."), width: 14 },
    { header: L("Nama", "Name"), width: 24 },
    { header: L("Unit", "Unit"), width: 20 },
    { header: L("Posisi", "Position"), width: 26 },
    { header: L("Grade", "Grade"), width: 8 },
    { header: L("Kompa-Ratio", "Compa-Ratio"), width: 12 },
    { header: L("Band", "Band"), width: 14 },
    { header: L("Kunci Match", "Match Key"), width: 12 },
    { header: L("p50 Benchmark", "Benchmark p50"), width: 16 },
  ];
  if (mv.canSee) compaCols.push({ header: L("Gaji Pokok (nominal)", "Base Salary (nominal)"), width: 20 });
  const compaSheet: ExportSheet = {
    name: L("Ringkasan Kompa-Ratio", "Compa-Ratio Summary"),
    title: L(
      `Ringkasan Kompa-Ratio — ${context.year ?? "—"} · ${context.sourceLabel ?? "—"}`,
      `Compa-Ratio Summary — ${context.year ?? "—"} · ${context.sourceLabel ?? "—"}`,
    ),
    columns: compaCols,
    rows: rows.map((r) => {
      const base = [
        r.employeeNo,
        r.fullName,
        r.unit ?? "—",
        r.positionTitle ?? "—",
        r.gradeCode ?? "—",
        r.ratio ?? "—",
        r.band ? L(BAND_LABELS[r.band].id, BAND_LABELS[r.band].en) : L("belum ada benchmark", "no benchmark yet"),
        r.matchedKey === "grade" ? L("Grade", "Grade") : r.matchedKey === "position" ? L("Posisi", "Position") : "—",
        r.p50 ?? "—",
      ];
      if (mv.canSee) base.push(r.baseSalaryNominal ?? "—");
      return base;
    }),
  };

  // Sheet 2 — Master Benchmark (register)
  const masterSheet: ExportSheet = {
    name: L("Master Benchmark", "Benchmark Master"),
    title: L(
      `Master Benchmark — ${master.length} entri`,
      `Benchmark Master — ${master.length} entries`,
    ),
    columns: [
      { header: L("Tahun", "Year"), width: 8 },
      { header: L("Label Sumber", "Source Label"), width: 30 },
      { header: L("Kunci (Grade / Posisi)", "Key (Grade / Position)"), width: 24 },
      { header: "p25", width: 14 },
      { header: "p50", width: 14 },
      { header: "p75", width: 14 },
      { header: L("Mata Uang", "Currency"), width: 10 },
    ],
    rows: master.map((m) => [
      m.year,
      m.sourceLabel,
      m.gradeCode ?? (m.positionCode ? `${L("posisi", "position")} ${m.positionCode}` : "—"),
      m.p25,
      m.p50,
      m.p75,
      m.currency,
    ]),
  };

  const buffer = await toXlsxMulti([compaSheet, masterSheet], { lang });
  await db.activityLog.create({
    data: {
      action: "Exported", entity: "SalaryBenchmark",
      detail: `Ekspor XLSX benchmark gaji (${lang === "en" ? "EN" : "ID"}) — ${rows.length} karyawan, ${master.length} entri master (D-BL17)`,
    },
  }).catch(() => { /* ActivityLog opsional */ });
  return { buffer, filename: exportFilename("rekankerja-salary-benchmark", "xlsx") };
}
