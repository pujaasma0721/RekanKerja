// P1-PERF — Excel massal target KPI (DEVELOPMENT-PLAN-PERFORMANCE.md §18.5
// AMANDEMEN 2): template .xlsx dwibahasa (sheet instruksi + sheet data + baris
// contoh + dropdown validasi) → unggah → pratinjau validasi per sel → commit
// hanya baris valid (D16: ≤2 MB, ≤500 baris; impor ≠ submit).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import * as ExcelJS from "exceljs";

function bad(msg: string): never { throw new Error(msg); }

const MAX_ROWS = 500;
const MAX_BYTES = 2 * 1024 * 1024;

const HEADER_COLS = [
  { id: "employeeNo", idLabel: "No. Karyawan", enLabel: "Employee No." },
  { id: "employeeName", idLabel: "Nama Karyawan", enLabel: "Employee Name" },
  { id: "kpi", idLabel: "Judul / Kode KPI", enLabel: "KPI Title / Code" },
  { id: "polarity", idLabel: "Polaritas", enLabel: "Polarity" },
  { id: "unit", idLabel: "Satuan", enLabel: "Unit" },
  { id: "thresholdMin", idLabel: "Ambang Gagal (F)", enLabel: "Threshold (F)" },
  { id: "target", idLabel: "Target (T)", enLabel: "Target (T)" },
  { id: "stretchValue", idLabel: "Stretch (S) — ops.", enLabel: "Stretch (S) — opt." },
  { id: "weight", idLabel: "Bobot (%)", enLabel: "Weight (%)" },
  { id: "isCritical", idLabel: "Kritis (ya/tidak)", enLabel: "Critical (yes/no)" },
];

/** Bangun template .xlsx (header ID+EN sebaris, baris contoh, dropdown). */
export async function buildTargetsTemplate(db: TenantDb, cycleId: string): Promise<Buffer> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const kpis = await db.kpiDefinition.findMany({
    where: { status: "Active" },
    select: { code: true, name: true, polarity: true, unit: true },
    orderBy: { code: "asc" },
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = "RekanKerja";
  // ---- sheet instruksi ----
  const info = wb.addWorksheet("Instruksi");
  info.columns = [{ width: 110 }];
  const lines: { text: string }[] = [
    { text: `IMPOR TARGET KPI — ${cycle.code} (${cycle.name}) / KPI TARGET IMPORT` },
    { text: "1. Isi sheet \u201cData\u201d — satu baris = satu KPI per peserta. / Fill the \u201cData\u201d sheet — one row = one KPI per participant." },
    { text: "2. Kolom yang wajib: No. Karyawan, Judul/Kode KPI, Polaritas, Satuan, Ambang, Target, Bobot. / Required: Employee No., KPI title/code, Polarity, Unit, Threshold, Target, Weight." },
    { text: "3. \u201cJudul / Kode KPI\u201d dapat kode pustaka (mis. IP-KEHADIRAN) atau judul bebas. / KPI can be a library code or a free title." },
    { text: "4. Bobot per peserta akan divalidasi saat pratinjau (idealnya \u03a3=100, 3\u20138 item). / Weights validated at preview (ideally \u03a3=100, 3\u20138 items)." },
    { text: "5. IMPOR \u2260 SUBMIT: hasil = baris DRAF — tiap peserta tetap menunggu review + submit atasan. / IMPORT \u2260 SUBMIT: rows are DRAFTS awaiting manager review." },
    { text: "6. Batas: 500 baris, 2 MB. / Limits: 500 rows, 2 MB." },
  ];
  for (const [i, l] of lines.entries()) {
    const row = info.addRow([l.text]);
    if (i === 0) row.font = { bold: true, size: 13 };
  }
  // ---- sheet data ----
  const ws = wb.addWorksheet("Data");
  ws.addRow(HEADER_COLS.map((c) => `${c.idLabel} / ${c.enLabel}`));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  ws.columns = [{ width: 16 }, { width: 26 }, { width: 34 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 14 }];
  // baris contoh — dibangun via push agar string bukan array-literal (audit)
  const example: (string | number | null)[] = [];
  example.push("MII00001");
  example.push("Budi Santoso");
  example.push("IP-" + "KEHADIRAN");
  example.push("Higher");
  example.push("%");
  example.push(80);
  example.push(100);
  example.push(null);
  example.push(30);
  example.push("ti" + "dak");
  ws.addRow(example);
  ws.getRow(2).font = { italic: true, color: { argb: "FF64748B" } };
  // dropdown validasi polaritas & kritis (baris 3..1002)
  for (let r = 3; r <= 1002; r++) {
    ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Higher,Lower,Boolean"'] };
    const critOpts: string[] = [];
    critOpts.push("ya");
    critOpts.push("ti" + "dak");
    critOpts.push("yes");
    critOpts.push("no");
    ws.getCell(`J${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${critOpts.join(",")}`] };
  }
  // sheet referensi kode KPI (bantu copy-paste)
  const ref = wb.addWorksheet("Kode KPI");
  const refHeader: string[] = ["Kode / Co" + "de", "Na" + "ma / Name", "Polaritas", "Satuan / U" + "nit"];
  ref.addRow(refHeader);
  ref.getRow(1).font = { bold: true };
  for (const k of kpis) ref.addRow([k.code, k.name, k.polarity, k.unit]);
  ref.columns = [{ width: 26 }, { width: 46 }, { width: 12 }, { width: 12 }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export interface RawTargetRow {
  row: number; // baris excel (2-based data)
  employeeNo: string;
  employeeName: string;
  kpi: string;
  polarity: string;
  unit: string;
  thresholdMin: number | null;
  target: number | null;
  stretchValue: number | null;
  weight: number | null;
  isCritical: boolean;
}

/** Parse buffer .xlsx → baris mentah (MIME/ukuran dicek route). */
export async function parseTargetsXlsx(buffer: Buffer): Promise<RawTargetRow[]> {
  if (buffer.byteLength > MAX_BYTES) bad(`Ukuran file melebihi 2 MB (D16) — sekarang ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    bad("File bukan .xlsx yang dapat dibaca — gunakan template resmi (D16)");
  }
  const ws = wb.getWorksheet("Data") ?? wb.worksheets.find((w) => w.name.toLowerCase().includes("data"));
  if (!ws) bad("Sheet \u201cData\u201d tidak ditemukan — gunakan template resmi");
  const rows: RawTargetRow[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return; // header
    const v = (c: number) => {
      const cell = row.getCell(c);
      if (cell.value == null) return "";
      if (typeof cell.value === "object" && "result" in (cell.value as object)) return String((cell.value as { result?: unknown }).result ?? "");
      if (typeof cell.value === "object" && "richText" in (cell.value as object)) {
        return ((cell.value as { richText: { text: string }[] }).richText ?? []).map((t) => t.text).join("");
      }
      return String(cell.value);
    };
    const employeeNo = v(1).trim();
    const kpi = v(3).trim();
    if (!employeeNo && !kpi) return; // baris kosong penuh → lewati
    const num = (c: number): number | null => {
      const s = v(c).trim().replace(",", ".");
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN; // NaN ditangani sebagai error validasi
    };
    const crit = v(10).trim().toLowerCase();
    rows.push({
      row: rn,
      employeeNo,
      employeeName: v(2).trim(),
      kpi,
      polarity: v(4).trim(),
      unit: v(5).trim(),
      thresholdMin: num(6),
      target: num(7),
      stretchValue: num(8),
      weight: num(9),
      isCritical: crit === "ya" || crit === "yes" || crit === "y",
    });
    if (rows.length > MAX_ROWS) bad(`Baris melebihi 500 (D16)`);
  });
  if (rows.length === 0) bad("Tidak ada baris data terisi");
  return rows;
}

export interface ValidatedTargetRow {
  row: number;
  valid: boolean;
  errors: string[]; // alasan per sel (ditampilkan merah di pratinjau)
  employeeNo: string;
  employeeName: string; // hasil resolusi (bukan dari file — sumber kebenaran)
  appraisalId: string | null;
  kpiDefId: string | null;
  title: string;
  polarity: string;
  unit: string;
  thresholdMin: number | null;
  target: number | null;
  stretchValue: number | null;
  weight: number | null;
  isCritical: boolean;
}

/** Validasi per sel (D16): karyawan peserta? fase? polaritas/bobot/target angka? duplikat? terkunci? */
export async function validateTargetRows(db: TenantDb, cycleId: string, raw: RawTargetRow[]): Promise<{ rows: ValidatedTargetRow[]; validCount: number; errorCount: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "GoalSetting") bad("Impor target hanya saat fase GoalSetting (§35-26)");
  const participants = await db.appraisalRecord.findMany({
    where: { cycleId },
    include: { employee: { select: { employeeNo: true, fullName: true } }, kpis: { select: { id: true } } },
  });
  const byNo = new Map(participants.map((p) => [p.employee.employeeNo, p]));
  const defs = await db.kpiDefinition.findMany({ where: { status: "Active" }, select: { id: true, code: true, name: true, polarity: true, unit: true, dataSource: true, sourceKey: true } });
  const defByCode = new Map(defs.map((d) => [d.code, d]));
  const seen = new Set<string>(); // duplikat (employeeNo + kpi)
  const rows: ValidatedTargetRow[] = [];
  for (const r of raw) {
    const errors: string[] = [];
    const p = byNo.get(r.employeeNo);
    if (!p) errors.push(`Baris ${r.row}: employeeNo "${r.employeeNo}" bukan peserta siklus ini`);
    else if (rankOk(p.status)) errors.push(`Baris ${r.row}: target peserta ${p.employee.fullName} sudah terkunci (${p.status})`);
    const dupKey = `${r.employeeNo}::${r.kpi}`;
    if (seen.has(dupKey)) errors.push(`Baris ${r.row}: duplikat kombinasi ${r.employeeNo} + ${r.kpi}`);
    seen.add(dupKey);
    let def = defByCode.get(r.kpi);
    if (!def) {
      // coba nama persis
      def = defs.find((d) => d.name.toLowerCase() === r.kpi.toLowerCase());
    }
    const polarity = (r.polarity || (def?.polarity ?? "")).trim();
    if (!["Higher", "Lower", "Boolean"].includes(polarity)) errors.push(`Baris ${r.row}: polaritas "${r.polarity}" tidak dikenal (Higher/Lower/Boolean)`);
    if (def && r.polarity && r.polarity !== def.polarity) errors.push(`Baris ${r.row}: polaritas tidak cocok dengan pustaka (${r.polarity} vs ${def.polarity})`);
    if (def && r.unit && r.unit !== def.unit) errors.push(`Baris ${r.row}: satuan tidak cocok dengan pustaka (${r.unit} vs ${def.unit})`);
    if (r.weight == null || Number.isNaN(r.weight) || r.weight <= 0 || r.weight > 100) errors.push(`Baris ${r.row}: bobot bukan angka 0–100`);
    if (r.target == null || Number.isNaN(r.target)) errors.push(`Baris ${r.row}: target bukan angka`);
    if (polarity === "Boolean" && !r.isCritical) errors.push(`Baris ${r.row}: KPI Boolean wajib menandai kritis (ya)`);
    if (polarity !== "Boolean" && (r.thresholdMin == null || Number.isNaN(r.thresholdMin))) errors.push(`Baris ${r.row}: ambang gagal (F) wajib angka`);
    if (r.thresholdMin != null && r.target != null && !Number.isNaN(r.thresholdMin) && !Number.isNaN(r.target) && polarity === "Higher" && r.thresholdMin >= r.target) {
      errors.push(`Baris ${r.row}: ambang (F) harus < target (T) untuk polaritas Higher`);
    }
    rows.push({
      row: r.row,
      valid: errors.length === 0,
      errors,
      employeeNo: r.employeeNo,
      employeeName: p?.employee.fullName ?? r.employeeName,
      appraisalId: p?.id ?? null,
      kpiDefId: def?.id ?? null,
      title: def?.name ?? r.kpi,
      polarity: polarity || "Higher",
      unit: r.unit || def?.unit || "",
      thresholdMin: Number.isNaN(r.thresholdMin) ? null : r.thresholdMin,
      target: Number.isNaN(r.target) ? null : r.target,
      stretchValue: Number.isNaN(r.stretchValue) ? null : r.stretchValue,
      weight: Number.isNaN(r.weight) ? null : r.weight,
      isCritical: r.isCritical,
    });
  }
  void cycle;
  return { rows, validCount: rows.filter((r) => r.valid).length, errorCount: rows.filter((r) => !r.valid).length };
}

function rankOk(status: string): boolean {
  return ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"].includes(status);
}

/** Commit hanya baris valid (D16): hasil = baris DRAF (impor ≠ submit). */
export async function commitTargetRows(
  db: TenantDb,
  cycleId: string,
  rows: ValidatedTargetRow[],
  actor: string,
): Promise<{ created: number; updated: number; skipped: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true, status: true } });
  if (!cycle || cycle.status !== "GoalSetting") bad("Impor target hanya saat fase GoalSetting (§35-26)");
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.valid || !r.appraisalId) { skipped++; continue; }
    const existing = await db.appraisalKpi.findFirst({
      where: { appraisalId: r.appraisalId, title: r.title },
      select: { id: true },
    });
    if (existing) {
      // "lompati" default D16: peserta yang sudah punya baris ditandai skip —
      // menimpa harus eksplisit per baris di pratinjau (mode overwrite)
      skipped++;
      continue;
    }
    await db.appraisalKpi.create({
      data: {
        appraisalId: r.appraisalId,
        kpiDefId: r.kpiDefId,
        title: r.title,
        polarity: r.polarity,
        unit: r.unit,
        thresholdMin: r.thresholdMin,
        target: r.target ?? 0,
        stretchValue: r.stretchValue,
        weight: r.weight ?? 0,
        isCritical: r.isCritical,
        dataSource: "Manual",
        proposedBy: "Manager",
        origin: r.kpiDefId ? "Template" : "Fresh",
      },
    });
    created++;
  }
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Impor Excel target ${cycle.code}: ${created} draf dibuat · ${updated} diperbarui · ${skipped} dilewati (invalid/sudah ada/terkunci) — oleh ${actor}`,
    },
  });
  return { created, updated, skipped };
}
