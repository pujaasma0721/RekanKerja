// ============================================================================
// RekanKerja — ADVANCE SEARCH (server) — query param → Prisma where =========
// ============================================================================
// Dipakai endpoint list TER-PAGINASI (data terlalu besar utk difilter di
// client tanpa merusak pagination): employees, activity-logs, esign chain.
// Endpoint lain memfilter di client (filterRowsByAdv — adv-search.ts) karena
// datanya diambil array penuh.
//
// Pola di route:
//   const adv = parseAdvSearchReq(req);                    // ?adv=<json>
//   const aw = advPrismaWhere(adv, EMPLOYEE_ADV_FIELDS);   // null bila kosong
//   // gabungkan: where.AND = [...(where.AND ?? []), aw]
//
// Semantik DIJAMIN sama dengan versi client (adv-search.ts):
//   • text: pattern (@) / contains / startsWith / endsWith / eq / ne —
//     mode "insensitive" (PostgreSQL);
//   • number: = ≠ > ≥ < ≤ / between {gte,lte};
//   • date: granularitas HARI (eq = satu hari penuh, gt = lewat tengah malam
//     hari tsb, dst.) — konversi lokal "YYYY-MM-DD" → batas [start,end);
//   • empty → {path: null}, notEmpty → {path: {not: null}};
//   • match all → AND, any → OR;
//   • field HARUS terdaftar di peta server (whitelist — jangan percaya key
//     apa pun dari client: field tak dikenal → kondisi DIBUANG, bukan error).
// ============================================================================

import type { Prisma } from "@/generated/tenant";
import { decodeAdvParam, type AdvSearch, type AdvFieldType } from "@/rekankerja/shared/lib/adv-search";

export interface AdvServerField {
  /** path kolom Prisma — dukung relasi bertitik ("position.title") dan
   *  kuantifier relasi via segmen "[]" ("assignments[].position.title"
   *  → { assignments: { some: { position: … } } }). */
  path: string;
  type: AdvFieldType;
}

/** Baca query param `adv` dari request → AdvSearch ternormalisasi | null. */
export function parseAdvSearchReq(req: Request): AdvSearch | null {
  let raw: string | null = null;
  try {
    raw = new URL(req.url).searchParams.get("adv");
  } catch {
    return null;
  }
  return decodeAdvParam(raw);
}

/** Tulis fragment Prisma di path bertitik: setPath({}, "position.title", v) → {position:{title:v}} */
function setPath(obj: Record<string, unknown>, path: string, fragment: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const raw = parts[i]!;
    if (raw.endsWith("[]")) {
      // kuantifier relasi: "assignments[]" → { assignments: { some: { … } } }
      const k = raw.slice(0, -2);
      const nested: Record<string, unknown> = {};
      setPath(nested, parts.slice(i + 1).join("."), fragment);
      cur[k] = { some: nested };
      return;
    }
    const k = raw;
    if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = fragment;
}

/** batas hari [start, end) dari "YYYY-MM-DD" (string tanggal lokal user). */
function dayRange(v: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const start = new Date(`${v}T00:00:00.000Z`);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** Fragment where Prisma utk SATU kondisi; null bila kondisi tidak layak. */
function condWhere(cond: { field: string; op: string; value?: string; value2?: string }, fields: Record<string, AdvServerField>): Record<string, unknown> | null {
  const f = fields[cond.field];
  if (!f) return null; // whitelist — field tak dikenal dibuang
  const op = cond.op;
  const val = (cond.value ?? "").trim();

  if (op === "empty") { const o: Record<string, unknown> = {}; setPath(o, f.path, null); return o; }
  if (op === "notEmpty") { const o: Record<string, unknown> = {}; setPath(o, f.path, { not: null }); return o; }
  if (!val) return null;

  // ---- number ----
  if (f.type === "number") {
    const cv = Number(val);
    if (!Number.isFinite(cv)) return null;
    const o: Record<string, unknown> = {};
    switch (op) {
      case "eq": setPath(o, f.path, cv); break;
      case "ne": setPath(o, f.path, { not: cv }); break;
      case "gt": setPath(o, f.path, { gt: cv }); break;
      case "gte": setPath(o, f.path, { gte: cv }); break;
      case "lt": setPath(o, f.path, { lt: cv }); break;
      case "lte": setPath(o, f.path, { lte: cv }); break;
      case "between": {
        const cv2 = Number((cond.value2 ?? val).trim());
        const lo = Number.isFinite(cv2) ? Math.min(cv, cv2) : cv;
        const hi = Number.isFinite(cv2) ? Math.max(cv, cv2) : cv;
        setPath(o, f.path, { gte: lo, lte: hi });
        break;
      }
      default: return null;
    }
    return o;
  }

  // ---- date (granularitas hari) ----
  if (f.type === "date") {
    const r = dayRange(val);
    if (!r) return null;
    const r2 = cond.value2?.trim() ? dayRange(cond.value2.trim()) : null;
    const o: Record<string, unknown> = {};
    switch (op) {
      case "eq": setPath(o, f.path, { gte: r.start, lt: r.end }); break;
      case "ne": setPath(o, f.path, { NOT: { gte: r.start, lt: r.end } } as never); break;
      case "gt": setPath(o, f.path, { gte: r.end }); break;          // setelah hari tsb
      case "gte": setPath(o, f.path, { gte: r.start }); break;      // hari tsb & seterusnya
      case "lt": setPath(o, f.path, { lt: r.start }); break;       // sebelum hari tsb
      case "lte": setPath(o, f.path, { lt: r.end }); break;         // sampai & termasuk hari tsb
      case "between": {
        const b = r2 ?? r;
        const lo = r.start <= b.start ? r : b;
        const hi = r.start <= b.start ? b : r;
        setPath(o, f.path, { gte: lo.start, lt: hi.end });
        break;
      }
      default: return null;
    }
    return o;
  }

  // ---- text / select ----
  const cvv = val.toLowerCase();
  const o: Record<string, unknown> = {};
  switch (op) {
    case "pattern": {
      // pola "@": mirror parseAtPattern client — "@x" ends, "x@" starts, "@x@" contains
      const lead = val.startsWith("@");
      const trail = val.endsWith("@");
      const core = val.replace(/^@+/, "").replace(/@+$/, "");
      if (!core) return null;
      if (lead && trail) setPath(o, f.path, { contains: core, mode: "insensitive" });
      else if (lead) setPath(o, f.path, { endsWith: core, mode: "insensitive" });
      else if (trail) setPath(o, f.path, { startsWith: core, mode: "insensitive" });
      else setPath(o, f.path, { contains: core, mode: "insensitive" });
      break;
    }
    case "contains": setPath(o, f.path, { contains: cvv, mode: "insensitive" }); break;
    case "startsWith": setPath(o, f.path, { startsWith: cvv, mode: "insensitive" }); break;
    case "endsWith": setPath(o, f.path, { endsWith: cvv, mode: "insensitive" }); break;
    case "eq": setPath(o, f.path, { equals: cvv, mode: "insensitive" }); break;
    case "ne": setPath(o, f.path, { not: { equals: cvv, mode: "insensitive" } } as never); break;
    default: return null;
  }
  return o;
}

/**
 * Advance Search → fragment Prisma where (siap di-AND-kan ke where utama).
 * Return null bila tidak ada kondisi layak (pemanggil cukup skip).
 */
export function advPrismaWhere(
  search: AdvSearch | null,
  fields: Record<string, AdvServerField>,
): Prisma.EmployeeWhereInput | Record<string, unknown> | null {
  if (!search || !Array.isArray(search.conds) || search.conds.length === 0) return null;
  const conds = search.conds
    .map((c) => condWhere(c, fields))
    .filter((c): c is Record<string, unknown> => c != null);
  if (conds.length === 0) return null;
  return search.match === "any" ? { OR: conds } : { AND: conds };
}
