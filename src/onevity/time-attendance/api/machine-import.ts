// 27-a P0 — Import log mesin absen (sidik jari / face recognition).
// ====================================================================
// POST /api/onevity/attendance/machine-import (multipart/form-data):
//   file: .csv (teks) atau .xlsx (exceljs) · dryRun: "true"|"false"
// GET /api/onevity/attendance/machine-import — 20 batch terakhir.
//
// Parser fleksibel: kolom karyawan (employeeNo|nik|pin|id), kolom tanggal+jam
// TERPISAH (date|tanggal + time|jam) ATAU digabung (datetime|timestamp), dan
// kolom arah (direction|status|jenis → in/masuk/check-in = IN; out/keluar/
// check-out = OUT). Timestamp ISO / "DD/MM/YYYY HH:mm" / "YYYY-MM-DD HH:mm:ss".
//
// Klasifikasi baris: ok / duplicate (AttendanceClockLog employeeId+timestamp+
// direction sudah ada — dicek bulk satu window) / unknown-employee (employeeNo
// atau NIK tidak ditemukan / non-Active) / invalid (format rusak).
// dryRun → preview tanpa tulis; commit → insert source "Machine" +
// regenerateDaily per (karyawan, tanggal) + MachineImportBatch + ActivityLog.
// Idempoten: import ulang file sama → semua baris duplikat, 0 sisipan.
import { NextRequest, NextResponse } from "next/server";
import * as ExcelJS from "exceljs";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { dayStart, addDays, regenerateDaily } from "@/onevity/time-attendance/services/attendance-service";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;
const PREVIEW_ROWS = 50;

// ============ tipe internal ============

type RowStatus = "ok" | "duplicate" | "unknown" | "invalid";

interface ParsedRow {
  rowNo: number;
  /** id mentah dari file (employeeNo atau NIK). */
  rawId: string;
  timestamp: Date | null;
  direction: "IN" | "OUT" | null;
  status: RowStatus;
  /** pesan error utk baris invalid/unknown (ID tak dikenal). */
  message?: string;
  employeeId?: string;
  employeeNo?: string;
  fullName?: string;
}

interface TableData {
  rows: ParsedRow[];
  headerFound: boolean;
  missingHint: string | null;
}

// ============ normalisasi & deteksi kolom ============

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const ID_KEYS = ["employeeno", "employee", "idkaryawan", "karyawan", "nik", "pin", "empid", "id", "no"];
const DATE_KEYS = ["date", "tanggal", "tgl", "tanggaldate"];
const TIME_KEYS = ["time", "jam", "clock", "waktu"];
const DATETIME_KEYS = ["datetime", "timestamp", "tanggaldanjam", "tanggaljam", "waktutimestamp"];
const DIR_KEYS = ["direction", "arah", "status", "jenis", "type", "tipe", "scan", "verifikasi"];

function findKey(headers: string[], keys: string[]): number {
  for (const k of keys) {
    const idx = headers.findIndex((h) => h === k);
    if (idx >= 0) return idx;
  }
  for (const k of keys) {
    const idx = headers.findIndex((h) => h.includes(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ============ parsing nilai ============

/** Arah clock dari teks bebas: in/masuk/check-in → IN; out/keluar/pulang → OUT. */
function parseDirection(raw: string): "IN" | "OUT" | null {
  const s = norm(raw);
  if (!s) return null;
  if (s.includes("out") || s.includes("keluar") || s.includes("pulang") || s.includes("checkout")) return "OUT";
  if (s.includes("in") || s.includes("masuk") || s.includes("datang") || s.includes("checkin")) return "IN";
  return null;
}

/** Parse tanggal "YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY" — bagian waktu (bila ada) diabaikan. */
function parseDatePart(raw: string): { y: number; m: number; d: number } | null {
  const s = raw.trim().split(/\s+/)[0] ?? "";
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] }; // DD/MM/YYYY
  return null;
}

/** Parse "HH:mm[:ss]" (null = gagal). */
function parseTimePart(raw: string): { h: number; mi: number; s: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  return { h, mi, s };
}

/** Gabung date+time lokal (semua Date OneVity = waktu lokal server). */
function combine(d: { y: number; m: number; d: number }, t: { h: number; mi: number; s: number }): Date {
  return new Date(d.y, d.m - 1, d.d, t.h, t.mi, t.s, 0);
}

/** Parse satu nilai timestamp gabungan: ISO / "DD?/?/?/YYYY HH:mm[:ss]". */
function parseDateTime(raw: string): Date | null {
  const s = raw.trim().replace("T", " ");
  if (!s) return null;
  // ISO lengkap / "YYYY-MM-DD HH:mm[:ss]"
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (iso) return combine({ y: +iso[1], m: +iso[2], d: +iso[3] }, { h: +iso[4], mi: +iso[5], s: iso[6] ? +iso[6] : 0 });
  // "DD/MM/YYYY HH:mm[:ss]" / "DD-MM-YYYY HH:mm[:ss]"
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (dmy) return combine({ y: +dmy[3], m: +dmy[2], d: +dmy[1] }, { h: +dmy[4], mi: +dmy[5], s: dmy[6] ? +dmy[6] : 0 });
  // ISO penuh dengan zona (parse & shift lokal) — cek validitas menit/detik
  if (/^\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}/.test(s)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Teks sel Excel (Date / rich text / formula → string). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  if (typeof v === "object") {
    if ("text" in v && v.text != null) return String(v.text).trim();
    if ("result" in v && v.result != null) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("").trim();
    return "";
  }
  return String(v).trim();
}

// ============ parser CSV (dukung quote & koma/titik-koma) ============

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === delim && !inQuote) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelim(line: string): string {
  const semi = (line.match(/;/g) ?? []).length;
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  if (tab > 0 && tab >= semi && tab >= comma) return "\t";
  return semi > comma ? ";" : ",";
}

// ============ pipeline klasifikasi (dipakai dryRun & commit) ============

interface ClassifyInput {
  db: import("@/onevity/shared/lib/tenant-db").TenantDb;
  rows: ParsedRow[];
}

interface Classified {
  summary: { total: number; ok: number; duplicate: number; unknown: number; invalid: number };
  unknownIds: string[];
  dateFrom: Date | null;
  dateTo: Date | null;
}

/** Resolve karyawan (employeeNo ATAU NIK, Active saja) + dedupe window bulk. */
async function classifyRows({ db, rows }: ClassifyInput): Promise<Classified> {
  // --- resolve karyawan ---
  // 28-c (follow-up 43-b): NIK tersimpan TERENKRIPSI (enc:v1:t:…, IV acak) —
  // SQL `nationalId IN (plaintext)` tidak akan pernah cocok dengan baris
  // terenkripsi (karyawan yang di-tulis/patch pasca 43-b). Kandidat diambil
  // luas (employeeNo cocok ATAU punya NIK — tabel Employee per tenant kecil,
  // satuan-ribuan baris), lalu NIK dicocokkan via dekripsi di JS (pola nikSet
  // dedupe import Excel, employees.ts; decryptText meloloskan plaintext
  // legacy apa adanya).
  const ids = [...new Set(rows.map((r) => r.rawId).filter(Boolean))];
  const employees = ids.length
    ? await db.employee.findMany({
        where: { status: "Active", OR: [{ employeeNo: { in: ids } }, { nationalId: { not: null } }] },
        select: { id: true, employeeNo: true, fullName: true, nationalId: true },
      })
    : [];
  const tc = tenantCryptoForDb(db);
  const byKey = new Map<string, { id: string; employeeNo: string; fullName: string }>();
  for (const e of employees) {
    byKey.set(e.employeeNo, { id: e.id, employeeNo: e.employeeNo, fullName: e.fullName });
    const nik = e.nationalId ? tc.decryptText(e.nationalId) : null;
    if (nik && !byKey.has(nik)) byKey.set(nik, { id: e.id, employeeNo: e.employeeNo, fullName: e.fullName });
  }

  // --- dedupe: satu query bulk untuk window tanggal seluruh baris ---
  const stamped = rows.filter((r) => r.timestamp != null);
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  for (const r of stamped) {
    const ts = r.timestamp as Date;
    if (!minDate || ts < minDate) minDate = ts;
    if (!maxDate || ts > maxDate) maxDate = ts;
  }
  const dbKeys = new Set<string>();
  // hanya karyawan yang benar-benar cocok (bukan seluruh kandidat ber-NIK)
  const empIds = [...new Set([...byKey.values()].map((e) => e.id))];
  if (minDate && maxDate && empIds.length) {
    const existing = await db.attendanceClockLog.findMany({
      where: {
        employeeId: { in: empIds },
        timestamp: { gte: dayStart(minDate), lt: addDays(dayStart(maxDate), 1) },
      },
      select: { employeeId: true, timestamp: true, direction: true },
    });
    for (const l of existing) dbKeys.add(`${l.employeeId}|${l.timestamp.getTime()}|${l.direction}`);
  }

  // --- klasifikasi per baris (duplikat dalam-file juga terdeteksi) ---
  const seenInFile = new Set<string>();
  const unknownSet = new Set<string>();
  let ok = 0, dup = 0, unknown = 0, invalid = 0;
  for (const r of rows) {
    const emp = r.rawId ? byKey.get(r.rawId) : undefined;
    if (!r.rawId) { r.status = "invalid"; r.message = "kolom karyawan kosong"; invalid++; continue; }
    if (!r.timestamp || !r.direction) {
      r.status = "invalid";
      r.message = !r.timestamp
        ? "timestamp tidak terbaca (format didukung: DD/MM/YYYY HH:mm atau YYYY-MM-DD HH:mm:ss)"
        : "arah tidak dikenali (isi IN/masuk atau OUT/keluar)";
      invalid++;
      continue;
    }
    if (!emp) { r.status = "unknown"; r.message = "karyawan tidak ditemukan / tidak aktif"; unknownSet.add(r.rawId); unknown++; continue; }
    r.employeeId = emp.id; r.employeeNo = emp.employeeNo; r.fullName = emp.fullName;
    const key = `${emp.id}|${r.timestamp.getTime()}|${r.direction}`;
    if (dbKeys.has(key) || seenInFile.has(key)) {
      r.status = "duplicate"; r.message = "log sudah ada (karyawan + waktu + arah)"; dup++;
    } else {
      r.status = "ok"; r.message = undefined; ok++; seenInFile.add(key);
    }
  }
  return {
    summary: { total: rows.length, ok, duplicate: dup, unknown, invalid },
    unknownIds: [...unknownSet],
    dateFrom: minDate,
    dateTo: maxDate,
  };
}

// ============ parsing file → ParsedRow[] ============

function rowsFromMatrix(data: string[][]): TableData {
  // cari baris header (≤5 baris pertama) yang memuat kolom id + waktu
  let headerIdx = -1;
  let idCol = -1, dateCol = -1, timeCol = -1, dtCol = -1, dirCol = -1;
  const missingHint: string[] = [];
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const headers = (data[i] ?? []).map(norm);
    idCol = findKey(headers, ID_KEYS);
    dateCol = findKey(headers, DATE_KEYS);
    timeCol = findKey(headers, TIME_KEYS);
    dtCol = findKey(headers, DATETIME_KEYS);
    dirCol = findKey(headers, DIR_KEYS);
    if (idCol >= 0 && (dtCol >= 0 || (dateCol >= 0 && timeCol >= 0))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    // header terbaik utk pesan error
    const headers = (data[0] ?? []).map(norm);
    idCol = findKey(headers, ID_KEYS);
    dateCol = findKey(headers, DATE_KEYS);
    timeCol = findKey(headers, TIME_KEYS);
    dtCol = findKey(headers, DATETIME_KEYS);
    dirCol = findKey(headers, DIR_KEYS);
    if (idCol < 0) missingHint.push("kolom karyawan (employeeNo / nik / pin)");
    if (dtCol < 0 && dateCol < 0) missingHint.push("kolom tanggal (date / tanggal)");
    if (dtCol < 0 && timeCol < 0) missingHint.push("kolom jam (time / jam) atau datetime gabungan");
    return { rows: [], headerFound: false, missingHint: missingHint.join(", ") || "header tidak dikenali" };
  }

  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < data.length; i++) {
    const line = data[i];
    if (!line || line.every((c) => c === "")) continue; // baris kosong
    if (rows.length >= MAX_ROWS) break;
    const rawId = (line[idCol] ?? "").trim();

    let direction: "IN" | "OUT" | null = null;
    let timestamp: Date | null = null;
    if (dtCol >= 0) {
      // kolom datetime gabungan
      timestamp = parseDateTime(line[dtCol] ?? "");
      direction = parseDirection(dirCol >= 0 ? (line[dirCol] ?? "") : "");
    } else if (dateCol >= 0 && timeCol >= 0) {
      const dateVal = (line[dateCol] ?? "").trim();
      let timeVal = (line[timeCol] ?? "").trim();
      let dirVal = dirCol >= 0 ? (line[dirCol] ?? "").trim() : "";
      // baris 3-kolom (datetime gabungan): kolom jam ternyata berisi arah,
      // arah asli kosong → geser (mis. "MII00039,2026-09-30 17:24,OUT").
      if (!dirVal && timeVal && !parseTimePart(timeVal) && parseDirection(timeVal)) {
        dirVal = timeVal;
        timeVal = "";
      }
      direction = parseDirection(dirVal);
      // token tanggal: "YYYY-MM-DD HH:mm[:ss]" → tanggal + jam tempelan
      const toks = dateVal.split(/\s+/);
      const dp = parseDatePart(toks[0] ?? "");
      const embedded = toks.length > 1 ? parseTimePart(toks.slice(1).join(" ")) : null;
      const tp = parseTimePart(timeVal) ?? embedded;
      if (dp && tp) timestamp = combine(dp, tp);
      else if (dp) timestamp = combine(dp, { h: 0, mi: 0, s: 0 });
      else timestamp = parseDateTime(dateVal);
    } else {
      direction = parseDirection(dirCol >= 0 ? (line[dirCol] ?? "") : "");
    }

    rows.push({
      rowNo: i + 1, // nomor baris file (1-based, header termasuk)
      rawId,
      timestamp,
      direction,
      status: "invalid",
    });
  }
  return { rows, headerFound: true, missingHint: null };
}

async function parseFile(file: File): Promise<TableData> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return { rows: [], headerFound: false, missingHint: "file kosong" };
    const delim = detectDelim(lines[0]);
    const data = lines.map((l) => splitCsvLine(l, delim));
    return rowsFromMatrix(data);
  }
  // XLSX via exceljs
  const wb = await new ExcelJS.Workbook().xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find((w) => w.rowCount > 0) ?? wb.worksheets[0];
  if (!ws || ws.rowCount < 1) return { rows: [], headerFound: false, missingHint: "sheet data tidak ditemukan" };
  const data: string[][] = [];
  for (let r = 1; r <= Math.min(ws.rowCount, MAX_ROWS + 10); r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      while (cells.length < col - 1) cells.push("");
      // sel date/time Excel dikonversi cellText ke "YYYY-MM-DD HH:mm:ss" teks
      cells.push(cellText(cell.value));
    });
    data.push(cells);
  }
  // kolom XLSX bertipe Date asli → cellText mengubah ke "YYYY-MM-DD HH:mm:ss"
  // sehingga parser teks (parseDateTime / parseDatePart) tetap bekerja.
  return rowsFromMatrix(data);
}

// ============ GET: riwayat batch ============

export async function machineImportGet(req: NextRequest): Promise<NextResponse> {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const batches = await db.machineImportBatch.findMany({
      orderBy: { importedAt: "desc" },
      take: 20,
    });
    return NextResponse.json({
      batches: batches.map((b) => ({
        id: b.id,
        fileName: b.fileName,
        rowCount: b.rowCount,
        inserted: b.inserted,
        skipped: b.skipped,
        unknownEmployees: b.unknownEmployees,
        dateFrom: b.dateFrom,
        dateTo: b.dateTo,
        importedAt: b.importedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST: dryRun / commit ============

export async function machineImportPost(req: NextRequest): Promise<NextResponse> {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Body harus multipart/form-data dengan field file + dryRun" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "File log wajib dilampirkan (field \"file\")" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File terlalu besar (${(file.size / 1024 / 1024).toFixed(2)} MB) — maksimum 5 MB` }, { status: 413 });
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt") && !lower.endsWith(".xlsx")) {
      return NextResponse.json({ error: "Hanya file .csv atau .xlsx yang didukung" }, { status: 400 });
    }
    const dryRun = ["true", "1", "yes"].includes(String(form.get("dryRun") ?? "").toLowerCase());

    // preview (dryRun) = requireTenant; commit = op:import attendance:machine-import
    if (dryRun) {
      const db = await requireTenant(req);
      if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
      return await handleParsed(db, file, dryRun, null);
    }
    const m = await requireMenuAction(req, "attendance:machine-import", "op:import");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    return await handleParsed(m.db, file, dryRun, m.actor.appUserId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

async function handleParsed(
  db: import("@/onevity/shared/lib/tenant-db").TenantDb,
  file: File,
  dryRun: boolean,
  appUserId: string | null,
): Promise<NextResponse> {
  let table: TableData;
  try {
    table = await parseFile(file);
  } catch {
    return NextResponse.json({ error: "File tidak terbaca (rusak / bukan CSV-Excel) — periksa format file" }, { status: 400 });
  }
  if (!table.headerFound) {
    return NextResponse.json(
      { error: `Header tidak dikenali — butuh ${table.missingHint}. Contoh header: employeeNo,date,time,direction` },
      { status: 400 },
    );
  }
  if (table.rows.length === 0) {
    return NextResponse.json({ error: "Tidak ada baris data terbaca di bawah header" }, { status: 400 });
  }

  const { summary, unknownIds, dateFrom, dateTo } = await classifyRows({ db, rows: table.rows });

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      file: file.name,
      summary,
      unknownIds,
      dateFrom,
      dateTo,
      preview: table.rows.slice(0, PREVIEW_ROWS).map((r) => ({
        row: r.rowNo,
        employeeNo: r.employeeNo ?? r.rawId,
        fullName: r.fullName ?? null,
        timestamp: r.timestamp ? r.timestamp.toISOString() : null,
        direction: r.direction,
        status: r.status,
        message: r.message ?? null,
      })),
    });
  }

  // ===== commit: insert baris OK (source "Machine") =====
  const okRows = table.rows.filter((r) => r.status === "ok" && r.employeeId && r.timestamp);
  if (okRows.length > 0) {
    await db.attendanceClockLog.createMany({
      data: okRows.map((r) => ({
        employeeId: r.employeeId as string,
        timestamp: r.timestamp as Date,
        direction: r.direction as string,
        source: "Machine",
      })),
    });
    // rekap harian dihitung ulang per (karyawan, tanggal) unik
    const done = new Set<string>();
    for (const r of okRows) {
      const day = dayStart(r.timestamp as Date);
      const key = `${r.employeeId}|${day.getTime()}`;
      if (done.has(key)) continue;
      done.add(key);
      await regenerateDaily(db, day, r.employeeId as string);
    }
  }

  const skipped = summary.duplicate + summary.unknown + summary.invalid;
  const batch = await db.machineImportBatch.create({
    data: {
      fileName: file.name,
      rowCount: table.rows.length,
      inserted: okRows.length,
      skipped,
      unknownEmployees: unknownIds.length ? unknownIds.slice(0, 50).join(", ").slice(0, 500) : null,
      dateFrom,
      dateTo,
      importedById: appUserId,
    },
  });
  try {
    await db.activityLog.create({
      data: {
        appUserId,
        action: "Imported",
        entity: "AttendanceClockLog",
        entityId: batch.id,
        detail:
          `Import mesin absen ${file.name}: ${okRows.length} log disisipkan, ${skipped} dilewati ` +
          `(duplikat ${summary.duplicate}, tak dikenal ${summary.unknown}, tak valid ${summary.invalid})`,
      },
    });
  } catch { /* audit best-effort */ }

  return NextResponse.json({
    dryRun: false,
    file: file.name,
    summary: { ...summary, ok: okRows.length },
    unknownIds,
    dateFrom,
    dateTo,
    batchId: batch.id,
  });
}
