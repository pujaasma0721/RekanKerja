// ============================================================================
// RekanKerja — ADVANCE SEARCH (Task adv-search) — library murni ============
// ============================================================================
// Fitur pencarian lanjutan untuk SEMUA view list:
//   • Tombol kecil "Advance Search" (AdvSearchButton) → popup (AdvSearchDialog)
//     di tiap list — pelajari adv-search.tsx (UI) & adv-search-server.ts (API).
//   • Kombinasi field: beberapa kondisi digabung DAN (all) / ATAU (any).
//   • Operator per tipe field:
//       text   : pola & (default), mengandung, awalan, akhiran, sama persis,
//                tidak sama, kosong, tidak kosong
//       number : = ≠ > ≥ < ≤ di antara, kosong, tidak kosong
//       date   : pada, setelah, sebelum, pada/setelah, sampai/sebelum,
//                di antara, kosong, tidak kosong
//       select : sama, tidak sama, kosong, tidak kosong
//
// POLA KARAKTER UNIK "&" (permintaan pengguna — cermin habbit LIKE SQL '%'):
//   "&rahman"  → semua yang BERAKHIRAN "rahman"   (…rahman)
//   "Andi&"    → semua yang BERAWALAN  "Andi"     (Andi…)
//   "&kay&"    → semua yang MENGANDUNG  "kay"     (…kay…)
//   "Budi"     → tanpa & = mengandung (perilaku pencarian biasa)
//   "&" hanya diakui di AWAL dan/atau AKHIR token — & di tengah (mis. "R&D")
//   tetap literal, jadi teks yang memuat & tetap bisa dicari normal.
//
// Modul ini bebas React (bisa dipakai client & server):
//   - parseAmpPattern() : string → {op, value}
//   - rowMatchesAdv()  : filter array baris di client (pola (b) & (c) view)
//   - sanitizeAdv()/encodeAdvParam()/decodeAdvParam() : jembatan URL param
//   - txt/num/dt/sel   : definisi field ringkas per view
// ============================================================================

// ============ tipe ============

export type AdvOp =
  | "pattern" | "contains" | "startsWith" | "endsWith" | "eq" | "ne"
  | "gt" | "gte" | "lt" | "lte" | "between" | "empty" | "notEmpty";

export type AdvFieldType = "text" | "number" | "date" | "select";

export interface AdvFieldOption {
  value: string;
  label: string;
  labelEn: string;
}

export interface AdvFieldDef<R = Record<string, unknown>> {
  /** kunci stabil kondisi (dipakai client `get` default row[key] & server map). */
  key: string;
  label: string;
  labelEn: string;
  type: AdvFieldType;
  /** pilihan utk tipe select (label dwibahasa). */
  options?: AdvFieldOption[];
  /** aksesor nilai baris (client-side); default: (row) => row[key]. */
  get?: (row: R) => unknown;
}

export interface AdvCond {
  field: string;
  op: AdvOp;
  value?: string;
  /** nilai kedua utk operator "between". */
  value2?: string;
}

export interface AdvSearch {
  /** all = DAN semua kondisi; any = salah satu (ATAU). */
  match: "all" | "any";
  conds: AdvCond[];
}

// ============ definisi field ringkas (helper per view) ============

type Tuple3 = [value: string, label: string, labelEn: string];

export function txt<R>(key: string, label: string, labelEn: string, get?: (row: R) => unknown): AdvFieldDef<R> {
  return { key, label, labelEn, type: "text", get };
}
export function num<R>(key: string, label: string, labelEn: string, get?: (row: R) => unknown): AdvFieldDef<R> {
  return { key, label, labelEn, type: "number", get };
}
export function dt<R>(key: string, label: string, labelEn: string, get?: (row: R) => unknown): AdvFieldDef<R> {
  return { key, label, labelEn, type: "date", get };
}
export function sel<R>(key: string, label: string, labelEn: string, options: Tuple3[], get?: (row: R) => unknown): AdvFieldDef<R> {
  return { key, label, labelEn, type: "select", options: options.map(([value, l, lEn]) => ({ value, label: l, labelEn: lEn })), get };
}

// ============ pola karakter unik "&" ============

/**
 * Parse nilai pola "&": "&x" akhiran, "x&" awalan, "&x&" mengandung,
 * tanpa & → mengandung (default). & di tengah tetap literal (mis. "R&D").
 * Nilai kosong sesudah buang & → mengandung string mentah (fallback aman).
 */
export function parseAmpPattern(v: string): { op: "contains" | "startsWith" | "endsWith"; value: string } {
  const raw = v ?? "";
  const lead = raw.startsWith("&");
  const trail = raw.endsWith("&");
  const core = raw.replace(/^&+/, "").replace(/&+$/, "");
  if (lead && trail) return { op: "contains", value: core };
  if (lead) return { op: "endsWith", value: core };
  if (trail) return { op: "startsWith", value: core };
  return { op: "contains", value: raw };
}

// ============ sanitasi & serialisasi ============

const OPS: AdvOp[] = ["pattern", "contains", "startsWith", "endsWith", "eq", "ne", "gt", "gte", "lt", "lte", "between", "empty", "notEmpty"];
const VALUELESS: AdvOp[] = ["empty", "notEmpty"];

/** Validasi + normalisasi input arbitrer (URL param / payload) → AdvSearch aman; null bila tidak layak. */
export function sanitizeAdv(input: unknown): AdvSearch | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Partial<AdvSearch> & { conds?: unknown };
  const conds: AdvCond[] = [];
  if (Array.isArray(o.conds)) {
    for (const raw of o.conds) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Partial<AdvCond>;
      if (typeof c.field !== "string" || !c.field) continue;
      const op = OPS.includes(c.op as AdvOp) ? (c.op as AdvOp) : "pattern";
      if (VALUELESS.includes(op)) { conds.push({ field: c.field, op }); continue; }
      const value = typeof c.value === "string" ? c.value : "";
      if (!value.trim()) continue; // kondisi tanpa nilai diabaikan
      const cond: AdvCond = { field: c.field, op, value };
      if (op === "between" && typeof c.value2 === "string" && c.value2.trim()) cond.value2 = c.value2;
      if (op === "between") cond.value2 = cond.value2 ?? value; // between tanpa batas atas → batas = bawah
      conds.push(cond);
    }
  }
  if (conds.length === 0) return null;
  return { match: o.match === "any" ? "any" : "all", conds: conds.slice(0, 12) }; // maks 12 kondisi
}

/** Serialize → nilai siap utk query param `adv` (encodeURIComponent). "" bila kosong. */
export function encodeAdvParam(adv: AdvSearch | null | undefined): string {
  const s = sanitizeAdv(adv);
  return s ? encodeURIComponent(JSON.stringify(s)) : "";
}

/** Baca query param `adv` (string DEKODED dari URLSearchParams.get) → AdvSearch | null.
 *  Robust terhadap double-encoding: pemanggil kadang men-set param dengan nilai
 *  yang SUDAH encodeURIComponent sebelum masuk URLSearchParams (yang men-encode
 *  sekali lagi) → setelah satu putaran decode masih tersisa "%7B…" — coba
 *  decode satu putaran lagi sebelum menyerah. */
export function decodeAdvParam(raw: string | null | undefined): AdvSearch | null {
  if (!raw) return null;
  try { return sanitizeAdv(JSON.parse(raw)); } catch { /* coba fallback di bawah */ }
  try { return sanitizeAdv(JSON.parse(decodeURIComponent(raw))); } catch { return null; }
}

/** Jumlah kondisi aktif (utk badge tombol). */
export function advCount(adv: AdvSearch | null | undefined): number {
  return sanitizeAdv(adv)?.conds.length ?? 0;
}

// ============ pencocokan client-side (filter baris lengkap di memori) ============

/** Index hari UTC — perbandingan tanggal per HARI (abaikan jam). */
function dayOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 86_400_000);
}

function condMatches<R>(row: R, cond: AdvCond, field: AdvFieldDef<R> | undefined): boolean {
  if (!field) return true; // field tak dikenal → kondisi diabaikan (fail-open client)

  // operator tanpa nilai
  if (cond.op === "empty") {
    const v = field.get ? field.get(row) : (row as Record<string, unknown>)?.[field.key];
    return v == null || v === "";
  }
  if (cond.op === "notEmpty") {
    const v = field.get ? field.get(row) : (row as Record<string, unknown>)?.[field.key];
    return !(v == null || v === "");
  }

  const val = (cond.value ?? "").trim();
  if (!val) return true; // nilai kosong → kondisi diabaikan

  // ---- number ----
  if (field.type === "number") {
    const v = field.get ? field.get(row) : (row as Record<string, unknown>)?.[field.key];
    const nv = typeof v === "number" ? v : Number(v);
    if (typeof nv !== "number" || !Number.isFinite(nv)) return false;
    const cv = Number(val);
    if (!Number.isFinite(cv)) return false;
    switch (cond.op) {
      case "eq": return nv === cv;
      case "ne": return nv !== cv;
      case "gt": return nv > cv;
      case "gte": return nv >= cv;
      case "lt": return nv < cv;
      case "lte": return nv <= cv;
      case "between": {
        const cv2 = Number(cond.value2 ?? val);
        if (!Number.isFinite(cv2)) return nv === cv;
        const lo = Math.min(cv, cv2), hi = Math.max(cv, cv2);
        return nv >= lo && nv <= hi;
      }
      default: return true;
    }
  }

  // ---- date (granularitas hari) ----
  if (field.type === "date") {
    const v = field.get ? field.get(row) : (row as Record<string, unknown>)?.[field.key];
    const dv = dayOf(v);
    const cv = dayOf(val);
    if (dv == null || cv == null) return false;
    switch (cond.op) {
      case "eq": return dv === cv;
      case "ne": return dv !== cv;
      case "gt": return dv > cv;
      case "gte": return dv >= cv;
      case "lt": return dv < cv;
      case "lte": return dv <= cv;
      case "between": {
        const cv2 = dayOf(cond.value2 ?? val) ?? cv;
        const lo = Math.min(cv, cv2), hi = Math.max(cv, cv2);
        return dv >= lo && dv <= hi;
      }
      default: return true;
    }
  }

  // ---- text / select (case-insensitive) ----
  const v = field.get ? field.get(row) : (row as Record<string, unknown>)?.[field.key];
  const sv = String(v ?? "").toLowerCase();
  const cvv = val.toLowerCase();
  switch (cond.op) {
    case "pattern": {
      const p = parseAmpPattern(cvv);
      if (!p.value) return true;
      return p.op === "contains" ? sv.includes(p.value) : p.op === "startsWith" ? sv.startsWith(p.value) : sv.endsWith(p.value);
    }
    case "contains": return sv.includes(cvv);
    case "startsWith": return sv.startsWith(cvv);
    case "endsWith": return sv.endsWith(cvv);
    case "eq": return sv === cvv;
    case "ne": return sv !== cvv;
    default: return true;
  }
}

/** Apakah satu baris lolos seluruh/atau kondisi Advance Search? (null/empty adv → true) */
export function rowMatchesAdv<R>(row: R, search: AdvSearch | null | undefined, fields: AdvFieldDef<R>[]): boolean {
  const s = sanitizeAdv(search);
  if (!s) return true;
  const map = new Map(fields.map((f) => [f.key, f]));
  const results = s.conds.map((c) => condMatches(row, c, map.get(c.field)));
  return s.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** Filter array baris (pola pemakaian: useMemo di view list). */
export function filterRowsByAdv<R>(rows: R[], search: AdvSearch | null | undefined, fields: AdvFieldDef<R>[]): R[] {
  const s = sanitizeAdv(search);
  if (!s) return rows;
  return rows.filter((r) => rowMatchesAdv(r, s, fields));
}
