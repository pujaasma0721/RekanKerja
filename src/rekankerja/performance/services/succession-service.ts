// ============================================================================
// B4-BL — SUCCESSION PLANNING (DEVELOPMENT-PLAN-BACKLOG.md §4 B4; D-BL13…D-BL15).
// Register peran kritis per Position + kandidat penerus di atas penempatan
// 9-box siklus Published/Closed TERAKHIR per karyawan:
//   • D-BL13 — kandidat di-seed dari saran 9-box (finalRating × potentialBand,
//     mapping sel IDENTIK dgn results page & laporan pf43: perf band rating
//     ≤2→1 / =3→2 / ≥4→3 × band potensi 1–3); readiness ReadyNow|Ready1yr|
//     Ready23yr|Development = keputusan MANUAL HR di atas saran sistem.
//   • D-BL14 — model: SuccessionPosition (flag kritis + targetSuccessors) +
//     SuccessorCandidate (readiness + devNotes TEKS — BUKAN modul training).
//   • flightRisk = snapshot skor heuristik D-BL10 saat ditambahkan, refresh
//     on-demand — SATU sumber logika: attritionRiskOf dari talent-service
//     (tidak ada duplikasi faktor).
//   • D-BL15 — laporan XLSX dwibahasa: coverage per peran + daftar kandidat.
// AKSES "sama D-BL12" (di atas menu guard performance:talent yang admin-only):
// baca = HR/admin atau Direksi (judul posisi — data strategis perusahaan,
// cakupan tim atasan TIDAK berlaku utk succession); mutasi = HR/admin saja
// (register & readiness adalah keputusan HR — D-BL13). Semua mutasi
// ter-ActivityLog (Created/Updated/Deleted × SuccessionPosition/
// SuccessorCandidate).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  attritionRiskOf, isDirectorTitle, talentHrActor,
} from "@/rekankerja/performance/services/talent-service";
import { toXlsxMulti, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";

// ============ error bermuatan status (pola okr/talent-service) ============

/** Error service succession — bawa status HTTP (403/404/409/400). */
export class SuccessionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Map error service → HTTP status (dipakai api/talent.ts). */
export function successionErrStatus(e: unknown): number {
  if (e instanceof SuccessionError) return e.status;
  return 400;
}

// ============ aktor & akses (D-BL12 — di atas menu guard admin-only) ============

export interface SuccessionActor {
  name: string;
  /** employeeId aktor — null = akun HR tanpa data karyawan. */
  employeeId: string | null;
  /** true = HR/admin (talentHrActor — OWNER/ADMIN/HR platform / AppUser Admin/HR Manager/HR Staff). */
  isHr: boolean;
}

/** Aktor HR/admin (helper re-export utk API). */
export function successionHrActor(role: string | null | undefined, appUserRole: string | null | undefined): boolean {
  return talentHrActor(role, appUserRole);
}

/** Judul posisi assignment aktif aktor tergolong Direksi (D-BL12). */
async function isDirectorActor(db: TenantDb, employeeId: string): Promise<boolean> {
  const myAsg = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    select: { position: { select: { title: true } } },
    orderBy: { validFrom: "desc" },
  });
  return isDirectorTitle(myAsg?.position?.title);
}

/** Baca data succession: HR/admin ATAU Direksi (D-BL12 — data strategis;
 * cakupan tim atasan TIDAK berlaku utk register peran perusahaan). */
async function assertViewer(db: TenantDb, actor: SuccessionActor): Promise<void> {
  if (actor.isHr) return;
  if (actor.employeeId && (await isDirectorActor(db, actor.employeeId))) return;
  throw new SuccessionError(
    "Data succession (peran kritis & penerus) hanya untuk HR/admin atau Direksi — D-BL12. Cakupan tim atasan tidak berlaku untuk register strategis perusahaan.",
    403,
  );
}

/** Mutasi register succession: HR/admin saja (D-BL13 — keputusan manual HR). */
function assertMutator(actor: SuccessionActor): void {
  if (!actor.isHr) {
    throw new SuccessionError(
      "Perubahan register succession (peran kritis, kandidat, readiness) hanya oleh HR/admin — D-BL13. Direksi dapat melihat (read-only).",
      403,
    );
  }
}

// ============ konstanta domain ============

/** Nilai readiness (D-BL13 — keputusan manual HR di atas saran sistem). */
export const READINESS_VALUES = ["ReadyNow", "Ready1yr", "Ready23yr", "Development"] as const;
export type Readiness = (typeof READINESS_VALUES)[number];

/** Urutan kualitas saran (utk sorting saran kandidat). */
const READINESS_RANK: Record<string, number> = { ReadyNow: 0, Ready1yr: 1, Ready23yr: 2, Development: 3 };

/** Label sel 9-box — IDENTIK dgn laporan pf43 (performance-report-documents.ts):
 * kunci "perf-potential"; label ID = kanonik snapshot; EN utk UI/export. */
export const NINE_BOX_LABELS: Record<string, { id: string; en: string }> = {
  "3-3": { id: "Bintang", en: "Stars" },
  "3-2": { id: "Performa Tinggi", en: "High Performer" },
  "3-1": { id: "Ahli Andal", en: "Trusted Expert" },
  "2-3": { id: "Potensi Tinggi", en: "High Potential" },
  "2-2": { id: "Pemain Inti", en: "Core Player" },
  "2-1": { id: "Efektif", en: "Effective" },
  "1-3": { id: "Permata Mentah", en: "Rough Diamond" },
  "1-2": { id: "Tidak Konsisten", en: "Inconsistent" },
  "1-1": { id: "Perlu Perbaikan", en: "Underperformer" },
};

/** Band performa dari rating — IDENTIK perf-results-service/perfBandOf:
 * 1–2 rendah, 3 memenuhi, 4–5 tinggi. */
function perfBandOf(rating: number): 1 | 2 | 3 {
  if (rating <= 2) return 1;
  if (rating === 3) return 2;
  return 3;
}

/** Snapshot saran 9-box (D-BL13) — mis. "4/5 — Bintang"; null bila belum terpetakan. */
export function suggested9BoxOf(rating: number | null, potential: number | null): string | null {
  if (rating == null || potential == null) return null;
  const b = Math.min(3, Math.max(1, potential)) as 1 | 2 | 3;
  const key = `${perfBandOf(rating)}-${b}`;
  const label = NINE_BOX_LABELS[key]?.id ?? `${perfBandOf(rating)}×${b}`;
  return `${rating}/5 — ${label}`;
}

/** Saran readiness DEFAULT (D-BL13): rating≥4 & potensi 3 → ReadyNow;
 * (rating≥4 & potensi 2) ATAU (rating 3 & potensi 3) → Ready1yr;
 * (rating 3 & potensi 2) → Ready23yr; lainnya/null → Development. */
export function suggestedReadinessOf(rating: number | null, potential: number | null): Readiness {
  if (rating == null || potential == null) return "Development";
  const p = Math.min(3, Math.max(1, potential));
  if (rating >= 4 && p === 3) return "ReadyNow";
  if ((rating >= 4 && p === 2) || (rating === 3 && p === 3)) return "Ready1yr";
  if (rating === 3 && p === 2) return "Ready23yr";
  return "Development";
}

// status appraisal terhitung "terpublikasi" (hasil final karyawan)
const PUBLISHED_STATUSES = ["Published", "Closed"];

// ============ tipe baris (mirror UI) ============

export interface SuccessionCandidateRow {
  id: string;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  unitName: string | null;
  readiness: string;
  suggested9Box: string | null;
  flightRisk: number | null;
  devNotes: string | null;
}

export interface SuccessionPositionRow {
  id: string;
  positionId: string;
  positionTitle: string;
  positionCode: string;
  unitName: string | null;
  incumbentName: string | null;
  incumbentNo: string | null;
  critical: boolean;
  targetSuccessors: number;
  note: string | null;
  candidates: SuccessionCandidateRow[];
  readyNowCount: number;
  coverage: { readyNow: number; target: number; ok: boolean };
}

export interface SuccessionListResult {
  positions: SuccessionPositionRow[];
  stats: { positions: number; candidates: number; uncovered: number };
  /** aktor HR/admin (Direksi read-only — tombol mutasi disembunyikan). */
  viewer: { isHr: boolean };
}

// ============ daftar register (baca) ============

/** Register succession lengkap: peran + pemegang + kandidat + coverage (D-BL15). */
export async function listSuccession(db: TenantDb, actor: SuccessionActor): Promise<SuccessionListResult> {
  await assertViewer(db, actor);

  const rows = await db.successionPosition.findMany({
    include: {
      position: { select: { id: true, code: true, title: true, orgUnit: { select: { name: true } } } },
      candidates: {
        include: {
          employee: { select: { id: true, employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
        },
      },
    },
  });

  // pemegang jabatan saat ini per posisi (assignment aktif — batch 1 query)
  const positionIds = rows.map((r) => r.positionId);
  const incumbents = positionIds.length
    ? await db.employeeAssignment.findMany({
        where: { positionId: { in: positionIds }, validTo: null },
        select: { positionId: true, employee: { select: { employeeNo: true, fullName: true } } },
        orderBy: { validFrom: "desc" },
      })
    : [];
  const incumbentByPos = new Map<string, { employeeNo: string; fullName: string }>();
  for (const inc of incumbents) {
    if (inc.positionId != null && !incumbentByPos.has(inc.positionId)) {
      incumbentByPos.set(inc.positionId, inc.employee);
    }
  }

  const positions: SuccessionPositionRow[] = rows.map((r) => {
    const readyNow = r.candidates.filter((c) => c.readiness === "ReadyNow").length;
    const inc = incumbentByPos.get(r.positionId) ?? null;
    return {
      id: r.id,
      positionId: r.positionId,
      positionTitle: r.position.title,
      positionCode: r.position.code,
      unitName: r.position.orgUnit?.name ?? null,
      incumbentName: inc?.fullName ?? null,
      incumbentNo: inc?.employeeNo ?? null,
      critical: r.critical,
      targetSuccessors: r.targetSuccessors,
      note: r.note,
      candidates: r.candidates
        .map((c): SuccessionCandidateRow => ({
          id: c.id,
          employeeId: c.employeeId,
          employeeNo: c.employee.employeeNo,
          fullName: c.employee.fullName,
          unitName: c.employee.orgUnit?.name ?? null,
          readiness: c.readiness,
          suggested9Box: c.suggested9Box,
          flightRisk: c.flightRisk,
          devNotes: c.devNotes,
        }))
        .sort((a, b) =>
          (READINESS_RANK[a.readiness] ?? 9) - (READINESS_RANK[b.readiness] ?? 9) ||
          a.fullName.localeCompare(b.fullName)),
      readyNowCount: readyNow,
      coverage: { readyNow, target: r.targetSuccessors, ok: readyNow >= r.targetSuccessors },
    };
  }).sort((a, b) => a.positionTitle.localeCompare(b.positionTitle));

  return {
    positions,
    stats: {
      positions: positions.length,
      candidates: positions.reduce((s, p) => s + p.candidates.length, 0),
      // peran TANPA satu pun penerus siap (ReadyNow = 0) — sinyal risiko tertinggi
      uncovered: positions.filter((p) => p.readyNowCount === 0).length,
    },
    viewer: { isHr: actor.isHr },
  };
}

/** Ringkasan ringkas utk overview (GET talent) — 3 angka server-side. */
export async function successionSummary(db: TenantDb): Promise<{
  positions: number;
  candidates: number;
  uncovered: number;
}> {
  const [positions, candidates] = await Promise.all([
    db.successionPosition.findMany({
      select: { id: true, targetSuccessors: true, candidates: { select: { readiness: true } } },
    }),
    db.successorCandidate.count(),
  ]);
  return {
    positions: positions.length,
    candidates,
    uncovered: positions.filter((p) => !p.candidates.some((c) => c.readiness === "ReadyNow")).length,
  };
}

/** Apakah aktor boleh melihat data succession (HR/admin/Direksi)? */
export async function successionViewerOk(db: TenantDb, actor: SuccessionActor): Promise<boolean> {
  if (actor.isHr) return true;
  if (actor.employeeId && (await isDirectorActor(db, actor.employeeId))) return true;
  return false;
}

/** Picker posisi utk dialog tambah peran: semua Position aktif + unit +
 * pemegang bila ada + flag sudah terdaftar succession (urut judul). */
export async function positionsForPicker(db: TenantDb, actor: SuccessionActor): Promise<{
  positions: {
    id: string; code: string; title: string; unitName: string | null;
    incumbentName: string | null; inSuccession: boolean;
  }[];
}> {
  await assertViewer(db, actor);
  const [rows, incumbents, registered] = await Promise.all([
    db.position.findMany({
      where: { active: true },
      select: { id: true, code: true, title: true, orgUnit: { select: { name: true } } },
      orderBy: { title: "asc" },
    }),
    db.employeeAssignment.findMany({
      where: { validTo: null, positionId: { not: null } },
      select: { positionId: true, employee: { select: { fullName: true } } },
      orderBy: { validFrom: "desc" },
    }),
    db.successionPosition.findMany({ select: { positionId: true } }),
  ]);
  const incumbentByPos = new Map<string, string>();
  for (const inc of incumbents) {
    if (inc.positionId && !incumbentByPos.has(inc.positionId)) {
      incumbentByPos.set(inc.positionId, inc.employee.fullName);
    }
  }
  const registeredSet = new Set(registered.map((r) => r.positionId));
  return {
    positions: rows.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      unitName: p.orgUnit?.name ?? null,
      incumbentName: incumbentByPos.get(p.id) ?? null,
      inSuccession: registeredSet.has(p.id),
    })),
  };
}

// ============ saran kandidat (D-BL13 — dari 9-box siklus terakhir) ============

export interface SuggestedCandidateRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  unitName: string | null;
  rating: number | null;
  potentialBand: number | null;
  suggested9Box: string | null;
  suggestedReadiness: Readiness;
  flightRisk: number | null;
}

/** Saran kandidat penerus utk satu peran: karyawan Active BUKAN pemegang
 * jabatan; 9-box dari appraisal Published/Closed TERAKHIR per karyawan;
 * readiness saran (D-BL13) + flightRisk (D-BL10 on-demand). Maks 20 baris. */
export async function suggestCandidates(
  db: TenantDb,
  actor: SuccessionActor,
  positionId: string,
  q?: string,
): Promise<{ position: { id: string; title: string }; rows: SuggestedCandidateRow[] }> {
  await assertViewer(db, actor);
  const position = await db.position.findUnique({ where: { id: positionId }, select: { id: true, title: true } });
  if (!position) throw new SuccessionError("Posisi tidak ditemukan", 404);

  // pemegang jabatan peran ini (assignment aktif TERBARU — dikecualikan dari saran)
  const incumbentId = await incumbentEmployeeIdOf(db, positionId);
  const incumbentIds = new Set(incumbentId ? [incumbentId] : []);

  const filters: Record<string, unknown>[] = [{ status: "Active" }];
  if (q) {
    filters.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { employeeNo: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  const employees = await db.employee.findMany({
    where: { AND: filters } as never,
    select: {
      id: true, employeeNo: true, fullName: true,
      orgUnit: { select: { name: true } },
      assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
    },
    orderBy: { employeeNo: "asc" },
    take: 300,
  });

  // appraisal Published/Closed TERAKHIR per karyawan (periodEnd desc)
  const empIds = employees.filter((e) => !incumbentIds.has(e.id)).map((e) => e.id);
  const appraisals = empIds.length
    ? await db.appraisalRecord.findMany({
        where: { employeeId: { in: empIds }, status: { in: PUBLISHED_STATUSES } },
        select: { employeeId: true, finalRating: true, potentialBand: true },
        orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
      })
    : [];
  const latestByEmp = new Map<string, { finalRating: number | null; potentialBand: number | null }>();
  for (const a of appraisals) {
    if (!latestByEmp.has(a.employeeId)) {
      latestByEmp.set(a.employeeId, { finalRating: a.finalRating, potentialBand: a.potentialBand });
    }
  }

  const base = employees
    .filter((e) => !incumbentIds.has(e.id))
    .map((e) => {
      const apr = latestByEmp.get(e.id) ?? null;
      return {
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        unitName: e.assignments[0]?.orgUnit?.name ?? e.orgUnit?.name ?? null,
        rating: apr?.finalRating ?? null,
        potentialBand: apr?.potentialBand ?? null,
        suggested9Box: suggested9BoxOf(apr?.finalRating ?? null, apr?.potentialBand ?? null),
        suggestedReadiness: suggestedReadinessOf(apr?.finalRating ?? null, apr?.potentialBand ?? null),
        flightRisk: null as number | null,
      };
    });

  // urut: saran terbaik dulu (readiness → rating → nama), ambil 20, baru hitung flightRisk
  base.sort((a, b) =>
    (READINESS_RANK[a.suggestedReadiness] ?? 9) - (READINESS_RANK[b.suggestedReadiness] ?? 9) ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.fullName.localeCompare(b.fullName));
  const top = base.slice(0, 20);
  for (const row of top) {
    const risk = await attritionRiskOf(db, row.employeeId);
    row.flightRisk = risk?.score ?? null;
  }
  return { position: { id: position.id, title: position.title }, rows: top };
}

/** Muat SATU baris register succession (dipakai upsertPosition agar tak
 * memuat seluruh register dua kali). */
async function loadRow(db: TenantDb, id: string): Promise<SuccessionPositionRow | null> {
  const r = await db.successionPosition.findUnique({
    where: { id },
    include: {
      position: { select: { id: true, code: true, title: true, orgUnit: { select: { name: true } } } },
      candidates: {
        include: { employee: { select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } } },
      },
    },
  });
  if (!r) return null;
  const inc = await db.employeeAssignment.findFirst({
    where: { positionId: r.positionId, validTo: null },
    select: { employee: { select: { employeeNo: true, fullName: true } } },
    orderBy: { validFrom: "desc" },
  });
  const readyNow = r.candidates.filter((c) => c.readiness === "ReadyNow").length;
  return {
    id: r.id,
    positionId: r.positionId,
    positionTitle: r.position.title,
    positionCode: r.position.code,
    unitName: r.position.orgUnit?.name ?? null,
    incumbentName: inc?.employee.fullName ?? null,
    incumbentNo: inc?.employee.employeeNo ?? null,
    critical: r.critical,
    targetSuccessors: r.targetSuccessors,
    note: r.note,
    candidates: r.candidates
      .map((c): SuccessionCandidateRow => ({
        id: c.id,
        employeeId: c.employeeId,
        employeeNo: c.employee.employeeNo,
        fullName: c.employee.fullName,
        unitName: c.employee.orgUnit?.name ?? null,
        readiness: c.readiness,
        suggested9Box: c.suggested9Box,
        flightRisk: c.flightRisk,
        devNotes: c.devNotes,
      }))
      .sort((a, b) =>
        (READINESS_RANK[a.readiness] ?? 9) - (READINESS_RANK[b.readiness] ?? 9) ||
        a.fullName.localeCompare(b.fullName)),
    readyNowCount: readyNow,
    coverage: { readyNow, target: r.targetSuccessors, ok: readyNow >= r.targetSuccessors },
  };
}

// ============ mutasi register peran ============

/** Tambah (id=null) / ubah register peran kritis. Buat baru: positionId wajib
 * unik (duplikat 409), Position wajib aktif; ubah: positionId diabaikan. */
export async function upsertPosition(
  db: TenantDb,
  actor: SuccessionActor,
  input: { id?: string; positionId?: string; critical?: boolean; targetSuccessors?: number; note?: string | null },
): Promise<SuccessionPositionRow> {
  assertMutator(actor);
  const critical = input.critical ?? true;
  const target = input.targetSuccessors ?? 2;
  if (!Number.isInteger(target) || target < 1 || target > 10) {
    throw new SuccessionError("Target penerus harus bilangan bulat 1–10 (D-BL14: default 2)", 400);
  }
  const note = input.note == null ? null : String(input.note).trim() || null;

  if (input.id) {
    // ---- ubah register (positionId tidak berubah) ----
    const existing = await db.successionPosition.findUnique({ where: { id: input.id }, include: { position: true } });
    if (!existing) throw new SuccessionError("Register succession tidak ditemukan", 404);
    const updated = await db.successionPosition.update({
      where: { id: existing.id },
      data: { critical, targetSuccessors: target, note },
    });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "SuccessionPosition", entityId: updated.id,
        detail: `Register succession "${existing.position.title}" diubah oleh ${actor.name}: kritis=${critical ? "ya" : "tidak"}, target penerus=${target}${note ? `, catatan "${note.slice(0, 120)}"` : ""} (D-BL14)`,
      },
    });
    const row = await loadRow(db, updated.id);
    if (!row) throw new SuccessionError("Register tidak ditemukan pasca-ubah", 500);
    return row;
  }

  // ---- buat register baru ----
  if (!input.positionId) throw new SuccessionError("Posisi wajib dipilih utk mendaftarkan peran kritis", 400);
  const position = await db.position.findUnique({ where: { id: input.positionId } });
  if (!position) throw new SuccessionError("Posisi tidak ditemukan", 404);
  if (!position.active) throw new SuccessionError("Posisi harus aktif utk didaftarkan sebagai peran kritis", 400);
  const dupe = await db.successionPosition.findUnique({ where: { positionId: position.id } });
  if (dupe) {
    throw new SuccessionError(`Posisi "${position.title}" sudah terdaftar sebagai peran succession (satu register per posisi) — ubah register yang ada`, 409);
  }

  const created = await db.successionPosition.create({
    data: { positionId: position.id, critical, targetSuccessors: target, note },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "SuccessionPosition", entityId: created.id,
      detail: `Register succession "${position.title}" dibuat oleh ${actor.name}: kritis=${critical ? "ya" : "tidak"}, target penerus=${target}${note ? `, catatan "${note.slice(0, 120)}"` : ""} (D-BL13/D-BL14)`,
    },
  });
  const row = await loadRow(db, created.id);
  if (!row) throw new SuccessionError("Register gagal dimuat pasca-dibuat", 500);
  return row;
}

/** Hapus register peran — DITOLAK 409 bila masih ada kandidat (eksplisit lebih
 * aman daripada cascade diam-diam; hapus kandidat dahulu). */
export async function deletePosition(db: TenantDb, actor: SuccessionActor, id: string): Promise<{ id: string }> {
  assertMutator(actor);
  const existing = await db.successionPosition.findUnique({
    where: { id },
    include: { position: { select: { title: true } }, candidates: { select: { id: true } } },
  });
  if (!existing) throw new SuccessionError("Register succession tidak ditemukan", 404);
  if (existing.candidates.length > 0) {
    throw new SuccessionError(
      `Register "${existing.position.title}" masih memiliki ${existing.candidates.length} kandidat — hapus kandidat dahulu sebelum menghapus peran (guard eksplisit, bukan cascade)`,
      409,
    );
  }
  await db.successionPosition.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "SuccessionPosition", entityId: id,
      detail: `Register succession "${existing.position.title}" dihapus oleh ${actor.name} (tanpa kandidat tersisa)`,
    },
  });
  return { id };
}

// ============ mutasi kandidat ============

/** Tambah kandidat: guard duplikat 409, guard pemegang jabatan 400, snapshot
 * suggested9Box + flightRisk otomatis saat ditambahkan (D-BL13/D-BL14). */
export async function addCandidate(
  db: TenantDb,
  actor: SuccessionActor,
  input: { successionPositionId: string; employeeId: string; readiness?: string; devNotes?: string | null },
): Promise<{ id: string; readiness: string; suggested9Box: string | null; flightRisk: number | null }> {
  assertMutator(actor);
  const succ = await db.successionPosition.findUnique({
    where: { id: input.successionPositionId },
    include: { position: { select: { id: true, title: true } } },
  });
  if (!succ) throw new SuccessionError("Register succession tidak ditemukan", 404);

  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, employeeNo: true, fullName: true, status: true } });
  if (!employee) throw new SuccessionError("Karyawan tidak ditemukan", 404);
  if (employee.status !== "Active") throw new SuccessionError("Kandidat harus karyawan ber-status Active", 400);

  // guard: karyawan TIDAK boleh pemegang jabatan peran itu sendiri
  // (pemegang aktif TERBARU — lihat incumbentEmployeeIdOf)
  const incumbentId = await incumbentEmployeeIdOf(db, succ.positionId);
  if (incumbentId === employee.id) {
    throw new SuccessionError(
      `${employee.fullName} adalah pemegang jabatan "${succ.position.title}" saat ini — tidak bisa menjadi kandidat penerus perannya sendiri`,
      400,
    );
  }

  // guard duplikat (unique successionPositionId+employeeId)
  const dupe = await db.successorCandidate.findFirst({
    where: { successionPositionId: succ.id, employeeId: employee.id },
    select: { id: true },
  });
  if (dupe) {
    throw new SuccessionError(`${employee.fullName} sudah terdaftar sebagai kandidat pada "${succ.position.title}"`, 409);
  }

  // readiness: keputusan manual HR; default = saran sistem (D-BL13)
  let readiness = input.readiness ?? null;
  if (readiness == null || readiness === "") {
    const apr = await latestPublishedOf(db, employee.id);
    readiness = suggestedReadinessOf(apr?.finalRating ?? null, apr?.potentialBand ?? null);
  }
  if (!(READINESS_VALUES as readonly string[]).includes(readiness)) {
    throw new SuccessionError(`Readiness harus salah satu dari ${READINESS_VALUES.join(" | ")}`, 400);
  }

  // snapshot saat ditambahkan (D-BL13 saran 9-box + D-BL10 flightRisk)
  const apr = await latestPublishedOf(db, employee.id);
  const suggested9Box = suggested9BoxOf(apr?.finalRating ?? null, apr?.potentialBand ?? null);
  const risk = await attritionRiskOf(db, employee.id);
  const devNotes = input.devNotes == null ? null : String(input.devNotes).trim() || null;

  const created = await db.successorCandidate.create({
    data: {
      successionPositionId: succ.id,
      employeeId: employee.id,
      readiness,
      suggested9Box,
      flightRisk: risk?.score ?? null,
      devNotes,
      addedById: actor.employeeId,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "SuccessorCandidate", entityId: created.id, employeeId: employee.id,
      detail: `Kandidat penerus ${employee.fullName} (${employee.employeeNo}) ditambahkan pada "${succ.position.title}" oleh ${actor.name}: readiness ${readiness} (saran 9-box: ${suggested9Box ?? "belum terpetakan"}, flightRisk ${risk?.score ?? "—"})${devNotes ? ` — dev: "${devNotes.slice(0, 120)}"` : ""} (D-BL13)`,
    },
  });
  return { id: created.id, readiness, suggested9Box, flightRisk: created.flightRisk };
}

/** Ubah kandidat: readiness/devNotes (keputusan manual HR) + refreshRisk=true
 * → hitung ulang flightRisk SEKARANG (snapshot on-demand). */
export async function updateCandidate(
  db: TenantDb,
  actor: SuccessionActor,
  input: { id: string; readiness?: string; devNotes?: string | null; refreshRisk?: boolean },
): Promise<{ id: string; readiness: string; devNotes: string | null; flightRisk: number | null }> {
  assertMutator(actor);
  const existing = await db.successorCandidate.findUnique({
    where: { id: input.id },
    include: {
      employee: { select: { id: true, fullName: true } },
      successionPosition: { include: { position: { select: { title: true } } } },
    },
  });
  if (!existing) throw new SuccessionError("Kandidat tidak ditemukan", 404);

  if (input.readiness != null && !(READINESS_VALUES as readonly string[]).includes(input.readiness)) {
    throw new SuccessionError(`Readiness harus salah satu dari ${READINESS_VALUES.join(" | ")}`, 400);
  }

  let flightRisk = existing.flightRisk;
  if (input.refreshRisk) {
    const risk = await attritionRiskOf(db, existing.employeeId);
    flightRisk = risk?.score ?? null;
  }

  const updated = await db.successorCandidate.update({
    where: { id: existing.id },
    data: {
      readiness: input.readiness ?? undefined,
      devNotes: input.devNotes === undefined ? undefined : (String(input.devNotes).trim() || null),
      flightRisk,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "SuccessorCandidate", entityId: updated.id, employeeId: existing.employeeId,
      detail: `Kandidat ${existing.employee.fullName} pada "${existing.successionPosition.position.title}" diubah oleh ${actor.name}: ${[
        input.readiness != null ? `readiness ${existing.readiness} → ${input.readiness}` : null,
        input.devNotes !== undefined ? "catatan pengembangan diperbarui" : null,
        input.refreshRisk ? `flightRisk di-refresh → ${updated.flightRisk ?? "—"}` : null,
      ].filter(Boolean).join(" · ") || "tanpa perubahan"} (D-BL13/D-BL14)`,
    },
  });
  return { id: updated.id, readiness: updated.readiness, devNotes: updated.devNotes, flightRisk: updated.flightRisk };
}

/** Hapus kandidat dari register. */
export async function removeCandidate(db: TenantDb, actor: SuccessionActor, id: string): Promise<{ id: string }> {
  assertMutator(actor);
  const existing = await db.successorCandidate.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true } },
      successionPosition: { include: { position: { select: { title: true } } } },
    },
  });
  if (!existing) throw new SuccessionError("Kandidat tidak ditemukan", 404);
  await db.successorCandidate.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "SuccessorCandidate", entityId: id, employeeId: existing.employeeId,
      detail: `Kandidat ${existing.employee.fullName} dihapus dari "${existing.successionPosition.position.title}" oleh ${actor.name}`,
    },
  });
  return { id };
}

/** Refresh flightRisk SEMUA kandidat satu peran sekaligus (on-demand). */
export async function refreshAllRisk(
  db: TenantDb,
  actor: SuccessionActor,
  successionPositionId: string,
): Promise<{ refreshed: number }> {
  assertMutator(actor);
  const succ = await db.successionPosition.findUnique({
    where: { id: successionPositionId },
    include: { position: { select: { title: true } }, candidates: { select: { id: true, employeeId: true } } },
  });
  if (!succ) throw new SuccessionError("Register succession tidak ditemukan", 404);
  let refreshed = 0;
  for (const c of succ.candidates) {
    const risk = await attritionRiskOf(db, c.employeeId);
    await db.successorCandidate.update({
      where: { id: c.id },
      data: { flightRisk: risk?.score ?? null },
    });
    refreshed++;
  }
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "SuccessionPosition", entityId: succ.id,
      detail: `FlightRisk ${refreshed} kandidat pada "${succ.position.title}" di-refresh oleh ${actor.name} (heuristik D-BL10 — skor heuristik dihitung ulang on-demand)`,
    },
  });
  return { refreshed };
}

// ============ helper internal ============

/** Pemegang jabatan (incumbent) sebuah posisi = pemegang assignment AKTIF
 * TERBARU (validFrom desc). Demo data dapat punya >1 assignment aktif
 * serentak (headcount >1) — “pemegang jabatan saat ini” diartikan yang
 * terbaru; pemegang lain tetap bisa menjadi kandidat penerus. */
async function incumbentEmployeeIdOf(db: TenantDb, positionId: string): Promise<string | null> {
  const inc = await db.employeeAssignment.findFirst({
    where: { positionId, validTo: null },
    select: { employeeId: true },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
  });
  return inc?.employeeId ?? null;
}

/** Appraisal Published/Closed TERAKHIR satu karyawan (periodEnd desc). */
async function latestPublishedOf(
  db: TenantDb,
  employeeId: string,
): Promise<{ finalRating: number | null; potentialBand: number | null } | null> {
  const apr = await db.appraisalRecord.findFirst({
    where: { employeeId, status: { in: PUBLISHED_STATUSES } },
    select: { finalRating: true, potentialBand: true },
    orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
  });
  return apr;
}

// ============ laporan XLSX dwibahasa (D-BL15) ============

/** Label readiness dwibahasa utk export & UI. */
export const READINESS_LABELS: Record<string, { id: string; en: string }> = {
  ReadyNow: { id: "Siap Sekarang", en: "Ready Now" },
  Ready1yr: { id: "Siap 1 Tahun", en: "Ready in 1 Year" },
  Ready23yr: { id: "Siap 2–3 Tahun", en: "Ready in 2–3 Years" },
  Development: { id: "Pengembangan", en: "Development" },
};

/** Terjemahkan snapshot suggested9Box ("4/5 — Bintang") ke bahasa aktif —
 * rating netral bahasa, label sel via peta NINE_BOX_LABELS. */
export function localize9BoxSnapshot(snapshot: string | null, lang: Lang): string | null {
  if (!snapshot) return null;
  if (lang !== "en") return snapshot;
  const idx = snapshot.indexOf("—");
  if (idx < 0) return snapshot;
  const rating = snapshot.slice(0, idx).trim();
  const label = snapshot.slice(idx + 1).trim();
  for (const v of Object.values(NINE_BOX_LABELS)) {
    if (v.id === label) return `${rating} — ${v.en}`;
  }
  return snapshot;
}

/** Laporan XLSX succession dwibahasa (D-BL15): Sheet "Rencana Suksesi"
 * (coverage per peran) + Sheet "Kandidat" (daftar penerus). */
export async function exportSuccessionXlsx(
  db: TenantDb,
  actor: SuccessionActor,
  lang: Lang,
): Promise<{ buffer: Buffer; filename: string }> {
  const { positions } = await listSuccession(db, actor);
  const L = <T,>(id: T, en: T): T => (lang === "en" ? en : id);
  const yn = (b: boolean) => (b ? L("Ya", "Yes") : L("Tidak", "No"));

  // Sheet 1 — Rencana Suksesi (coverage per peran — D-BL15)
  const planSheet: ExportSheet = {
    name: L("Rencana Suksesi", "Succession Plan"),
    title: L(
      `Rencana Suksesi — ${positions.length} peran · ${positions.reduce((s, p) => s + p.candidates.length, 0)} kandidat`,
      `Succession Plan — ${positions.length} positions · ${positions.reduce((s, p) => s + p.candidates.length, 0)} candidates`,
    ),
    columns: [
      { header: L("Peran", "Position"), width: 26 },
      { header: L("Unit", "Unit"), width: 22 },
      { header: L("Pemegang Jabatan", "Incumbent"), width: 22 },
      { header: L("Kritis", "Critical"), width: 9 },
      { header: L("Target", "Target"), width: 8 },
      { header: L("Siap (ReadyNow)", "Ready (ReadyNow)"), width: 14 },
      { header: L("Status Coverage", "Coverage Status"), width: 16 },
      { header: L("Catatan", "Note"), width: 36 },
    ],
    rows: positions.map((p) => [
      p.positionTitle,
      p.unitName ?? "—",
      p.incumbentName ?? "—",
      yn(p.critical),
      p.targetSuccessors,
      p.readyNowCount,
      p.coverage.ok
        ? L("Terpenuhi", "Covered")
        : p.readyNowCount === 0
          ? L("Tanpa penerus siap", "No ready successor")
          : L("Belum terpenuhi", "Below target"),
      p.note ?? "—",
    ]),
  };

  // Sheet 2 — Kandidat (daftar penerus per peran)
  const candSheet: ExportSheet = {
    name: L("Kandidat", "Candidates"),
    columns: [
      { header: L("Peran", "Position"), width: 26 },
      { header: L("Kandidat", "Candidate"), width: 22 },
      { header: L("No. Karyawan", "Employee No."), width: 14 },
      { header: L("Unit", "Unit"), width: 20 },
      { header: L("Readiness", "Readiness"), width: 16 },
      { header: L("9-Box (saat ditambahkan)", "9-Box (at add time)"), width: 24 },
      { header: L("Flight Risk", "Flight Risk"), width: 12 },
      { header: L("Catatan Pengembangan", "Development Notes"), width: 42 },
    ],
    rows: positions.flatMap((p) =>
      p.candidates.map((c) => [
        p.positionTitle,
        c.fullName,
        c.employeeNo,
        c.unitName ?? "—",
        READINESS_LABELS[c.readiness] ? L(READINESS_LABELS[c.readiness].id, READINESS_LABELS[c.readiness].en) : c.readiness,
        localize9BoxSnapshot(c.suggested9Box, lang) ?? "—",
        c.flightRisk ?? "—",
        c.devNotes ?? "—",
      ]),
    ),
  };

  const buffer = await toXlsxMulti([planSheet, candSheet], { lang });
  await db.activityLog.create({
    data: {
      action: "Exported", entity: "SuccessionPosition",
      detail: `Ekspor XLSX Rencana Suksesi (${lang === "en" ? "EN" : "ID"}) — ${positions.length} peran, ${positions.reduce((s, p) => s + p.candidates.length, 0)} kandidat (D-BL15)`,
    },
  }).catch(() => { /* ActivityLog opsional */ });
  return { buffer, filename: exportFilename("rekankerja-succession-plan", "xlsx") };
}
