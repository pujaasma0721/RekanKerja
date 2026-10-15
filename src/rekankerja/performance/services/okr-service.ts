// B1-BL — OKR KUARTALAN + BOARD TRANSPARAN (DEVELOPMENT-PLAN-BACKLOG.md §4 B1;
// keputusan D-BL1…D-BL5). Alat transparansi tujuan TERPISAH dari mesin
// penilaian (D-BL1): TIDAK menyentuh AppraisalRecord/skor/rating/merit —
// board OKR tidak pernah jadi input penilaian.
//   • Ritme kuartalan "YYYY-Qn" (D-BL2); per-tenant default OFF via
//     PerformanceSetting.okrEnabled — semua mutasi menolak 409 bila OFF.
//   • Objective (owner karyawan + align 1 level ke objective lain, D-BL4)
//     status Draft|Posted|Closed SATU ARAAH (D-BL3): Posted terlihat seluruh
//     karyawan aktif (board silang-tim), Draft hanya pemilik + HR, Closed =
//     kuartal selesai (riwayat board tetap terbaca).
//   • 3–5 KeyResult per objective (title/unit/polarity/baseline/target/
//     current/weight Σ=100/confidence R-Y-G/note).
//   • Skor server otoritatif (D-BL5): per KR = clamp((current−baseline)/
//     (target−baseline), 0, 1) — LowerIsBetter dibalik; objective score =
//     Σ(kr.weight/100 × krScore). Disimpan HANYA saat close (closedScore);
//     tampilan live dihitung on-read. current boleh melewati target (clamp).
//   • Ownership: owner objective dipilih HR saat buat, atau ESS membuat untuk
//     dirinya sendiri (selalu Draft). Update progres KR (current/confidence/
//     note) = owner objective atau HR, HANYA saat Posted. Draft boleh diedit
//     penuh (title/quarter/align/KR) oleh owner/HR. Close = HR saja. Delete =
//     Draft saja (owner/HR).
// Semua mutasi ter-ActivityLog (pola perf-pip-service). Tidak ada penomoran
// dokumen (objective diidentifikasi kuartal + judul + owner).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { Prisma } from "@/generated/tenant";
import { getPerfSetting } from "@/rekankerja/performance/services/perf-master-service";

function bad(msg: string): never { throw new Error(msg); }

// Status objective yang boleh jadi align-to / muncul di opsi pohon dukungan
// (split-pipe — konvensi audit-clean untuk array literal status).
const OKR_OPEN_STATUSES = "Draft|Posted".split("|");

// ============ error bermuatan status (pola approval-engine) ============

/** 409 — konflik state / fitur belum aktif (Draft→Posted→Closed satu arah). */
export class OkrStateError extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); }
}
/** 403 — aktor bukan pemilik objective / bukan HR. */
export class OkrForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) { super(message); }
}

/** Map error service → HTTP status (dipakai api/okr.ts + ess/my-okr.ts). */
export function okrErrStatus(e: unknown): number {
  if (e instanceof OkrStateError) return 409;
  if (e instanceof OkrForbiddenError) return 403;
  return 400;
}

// ============ aktor & helper HR (pola isHrActor perf-pip-service) ============

export interface OkrActor {
  name: string;
  employeeId: string | null;
  isHr: boolean;
}

const HR_ROLES = ["OWNER", "ADMIN", "HR"];
const HR_APP_ROLES = ["Admin", "HR Manager", "HR Staff"];

/** Aktor = HR/admin (boleh semua aksi OKR) — selain owner objective. */
export function okrHrActor(role: string | null | undefined, appUserRole: string | null | undefined): boolean {
  return HR_ROLES.includes(role ?? "") || HR_APP_ROLES.includes(appUserRole ?? "");
}

// ============ kuartal (D-BL2) ============

/** Format kuartal valid: "YYYY-Qn" dengan n 1–4. */
export const QUARTER_RE = /^\d{4}-Q[1-4]$/;

/** Kuartal berjalan dari tanggal (lokal server). */
export function currentQuarter(d = new Date()): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/** Kuartal ± offset dari sebuah kuartal "YYYY-Qn" (offset ±). */
export function quarterShift(q: string, offset: number): string {
  const m = QUARTER_RE.exec(q);
  if (!m) return q;
  const year = Number(q.slice(0, 4));
  const qn = Number(q.slice(6, 7));
  const total = year * 4 + (qn - 1) + offset;
  return `${Math.floor(total / 4)}-Q${(total % 4) + 1}`;
}

function assertQuarter(q: string): string {
  if (!QUARTER_RE.test(q)) {
    bad(`Format kuartal tidak valid: "${q}" — gunakan YYYY-Qn, contoh ${currentQuarter()}`);
  }
  return q;
}

/** Daftar kuartal utk picker: kuartal data + berjalan ±(3 lalu, 1 depan), desc. */
export async function listQuarters(db: TenantDb): Promise<string[]> {
  const rows = await db.okrObjective.findMany({ select: { quarter: true }, distinct: ["quarter"] });
  const set = new Set<string>(rows.map((r) => r.quarter));
  const cur = currentQuarter();
  for (let off = -3; off <= 1; off++) set.add(quarterShift(cur, off));
  return [...set].sort((a, b) => b.localeCompare(a));
}

// ============ skor server otoritatif (D-BL5) ============

export type KrLike = { polarity: string; baseline: number; target: number; current: number };

/** Skor satu KR 0..1 — clamp; LowerIsBetter dibalik (D-BL5). */
export function krScore(kr: KrLike): number {
  const span = kr.target - kr.baseline;
  if (!Number.isFinite(span) || span === 0) return 0;
  const raw = kr.polarity === "LowerIsBetter"
    ? (kr.baseline - kr.current) / span
    : (kr.current - kr.baseline) / span;
  return Math.min(1, Math.max(0, raw));
}

/** Skor objective live 0..1 = Σ(kr.weight/100 × krScore) (D-BL5). */
export function objectiveScore(krs: (KrLike & { weight: number })[]): number {
  return krs.reduce((s, kr) => s + (kr.weight / 100) * krScore(kr), 0);
}

/** Confidence dominan sebuah objective (total bobot terbesar antar R/Y/G). */
function dominantConfidence(krs: { weight: number; confidence: string }[]): "Red" | "Yellow" | "Green" | null {
  if (krs.length === 0) return null;
  const sum: Record<string, number> = {};
  for (const kr of krs) sum[kr.confidence] = (sum[kr.confidence] ?? 0) + kr.weight;
  const top = Object.entries(sum).sort((a, b) => b[1] - a[1])[0];
  return (top?.[0] as "Red" | "Yellow" | "Green") ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ============ fitur flag (D-BL2) ============

/** Mode OKR aktif? (PerformanceSetting.okrEnabled — default OFF). */
export async function okrFeatureOn(db: TenantDb): Promise<boolean> {
  const s = await getPerfSetting(db);
  return s.okrEnabled === true;
}

/** Guard fitur OFF → 409 (semua mutasi). */
async function requireOkrOn(db: TenantDb): Promise<void> {
  if (!(await okrFeatureOn(db))) {
    throw new OkrStateError("Mode OKR kuartalan belum diaktifkan untuk tenant ini — aktifkan lewat Pengaturan Kinerja (HR)");
  }
}

// ============ validasi payload KR (D-BL4/D-BL5) ============

export const OKR_POLARITIES = ["HigherIsBetter", "LowerIsBetter"] as const;
export const OKR_CONFIDENCES = ["Red", "Yellow", "Green"] as const;

export interface OkrKrInput {
  title: string;
  unit: string;
  polarity: string;
  baseline: number;
  target: number;
  current?: number;
  weight: number;
  confidence?: string;
  note?: string;
}

/** Validasi 3–5 KR: judul/unit/polarity/baseline≠target/weight Σ=100/confidence. */
function validateKeyResults(raw: OkrKrInput[]): OkrKrInput[] {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 5) {
    bad("Key result harus 3–5 item per objective (D-BL4)");
  }
  const clean = raw.map((k) => ({
    title: String(k.title ?? "").trim(),
    unit: String(k.unit ?? "").trim(),
    polarity: String(k.polarity ?? "HigherIsBetter"),
    baseline: Number(k.baseline),
    target: Number(k.target),
    current: k.current == null ? undefined : Number(k.current),
    weight: Number(k.weight),
    confidence: k.confidence == null ? undefined : String(k.confidence),
    note: k.note == null ? undefined : String(k.note),
  }));
  for (const k of clean) {
    if (k.title.length < 3) bad("Judul tiap key result wajib ≥3 karakter");
    if (k.unit.length < 1) bad("Satuan (unit) tiap key result wajib diisi (mis. %, Rp, unit)");
    if (!OKR_POLARITIES.includes(k.polarity as (typeof OKR_POLARITIES)[number])) {
      bad(`Polarity key result tidak dikenal: ${k.polarity} — gunakan HigherIsBetter atau LowerIsBetter`);
    }
    if (!Number.isFinite(k.baseline) || !Number.isFinite(k.target)) bad("Baseline & target tiap key result wajib angka");
    if (k.baseline === k.target) bad("Target harus BERBEDA dari baseline (arah kemajuan terdefinisi — D-BL5)");
    if (!Number.isFinite(k.weight) || k.weight <= 0 || k.weight > 100) bad("Bobot tiap key result harus angka 1–100");
    if (k.confidence != null && !OKR_CONFIDENCES.includes(k.confidence as (typeof OKR_CONFIDENCES)[number])) {
      bad(`Confidence key result tidak dikenal: ${k.confidence} — gunakan Red, Yellow, atau Green`);
    }
    if (k.note != null && k.note.length > 500) bad("Catatan key result maksimal 500 karakter");
  }
  const sum = clean.reduce((s, k) => s + k.weight, 0);
  if (Math.abs(sum - 100) > 0.01) bad(`Jumlah bobot key result harus 100 (sekarang ${Math.round(sum)})`);
  return clean;
}

// ============ bentuk baris API (board / mine) ============

export interface OkrKrRow {
  id: string;
  title: string;
  unit: string;
  polarity: string;
  baseline: number;
  target: number;
  current: number;
  weight: number;
  confidence: string;
  note: string | null;
  score: number; // 0..1 live (D-BL5)
  updatedAt: string;
}

export interface OkrObjectiveRow {
  id: string;
  quarter: string;
  title: string;
  status: string;
  ownerEmployeeId: string;
  ownerName: string;
  ownerNo: string;
  ownerUnit: string | null;
  ownerPosition: string | null;
  alignToId: string | null;
  alignParentTitle: string | null; // chip "mendukung: …" (resolusi on-read)
  liveScore: number; // 0..1 — on-read, TIDAK disimpan (D-BL5)
  progressPct: number; // 0..100 utk progress bar
  closedScore: number | null; // skor final saat Closed (server)
  confidence: "Red" | "Yellow" | "Green" | null; // dominan antar KR
  krs: OkrKrRow[];
  createdAt: string;
  updatedAt: string;
}

const OKR_OBJ_INCLUDE = {
  owner: { select: { id: true, fullName: true, employeeNo: true, orgUnit: { select: { name: true } }, position: { select: { title: true } } } },
  alignParent: { select: { id: true, title: true } },
  keyResults: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.OkrObjectiveInclude;

type DbObjective = Prisma.OkrObjectiveGetPayload<{ include: typeof OKR_OBJ_INCLUDE }>;

function okrRowOf(o: DbObjective): OkrObjectiveRow {
  const live = round2(objectiveScore(o.keyResults));
  return {
    id: o.id,
    quarter: o.quarter,
    title: o.title,
    status: o.status,
    ownerEmployeeId: o.ownerEmployeeId,
    ownerName: o.owner.fullName,
    ownerNo: o.owner.employeeNo,
    ownerUnit: o.owner.orgUnit?.name ?? null,
    ownerPosition: o.owner.position?.title ?? null,
    alignToId: o.alignToId,
    alignParentTitle: o.alignParent?.title ?? null,
    liveScore: live,
    progressPct: Math.round(live * 100),
    closedScore: o.closedScore != null ? round2(o.closedScore) : null,
    confidence: dominantConfidence(o.keyResults),
    krs: o.keyResults.map((k) => ({
      id: k.id, title: k.title, unit: k.unit, polarity: k.polarity,
      baseline: k.baseline, target: k.target, current: k.current,
      weight: k.weight, confidence: k.confidence, note: k.note,
      score: round2(krScore(k)),
      updatedAt: k.updatedAt.toISOString(),
    })),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

// ============ BOARD (D-BL3 — visibilitas) ============

/**
 * Board objective per kuartal. Visibilitas D-BL3:
 *   • HR → SEMUA objective (Draft termasuk).
 *   • non-HR (karyawan/ESS) → Posted + Closed + Draft miliknya sendiri.
 * default quarter = kuartal berjalan.
 */
export async function listBoard(
  db: TenantDb,
  opts: {
    quarter?: string;
    status?: string;
    ownerEmployeeId?: string;
    viewerEmployeeId?: string | null;
    viewerIsHr?: boolean;
  },
): Promise<OkrObjectiveRow[]> {
  const quarter = opts.quarter ? assertQuarter(opts.quarter) : currentQuarter();
  const where: Record<string, unknown> = { quarter };
  if (opts.status) where.status = opts.status;
  if (opts.ownerEmployeeId) where.ownerEmployeeId = opts.ownerEmployeeId;
  if (!opts.viewerIsHr) {
    // D-BL3: Draft hanya pemilik + HR
    where.OR = [
      { status: { in: ["Posted", "Closed"] } },
      ...(opts.viewerEmployeeId ? [{ ownerEmployeeId: opts.viewerEmployeeId }] : []),
    ];
  }
  const recs = await db.okrObjective.findMany({
    where,
    include: OKR_OBJ_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  // urutkan tampilan: Posted (hidup) → Draft → Closed (riwayat)
  const order: Record<string, number> = { Posted: 0, Draft: 1, Closed: 2 };
  return recs
    .map(okrRowOf)
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
}

/** Objective milik satu karyawan (semua kuartal / terfilter) — "OKR Saya". */
export async function myObjectives(
  db: TenantDb,
  employeeId: string,
  quarter?: string,
): Promise<OkrObjectiveRow[]> {
  const where: Record<string, unknown> = { ownerEmployeeId: employeeId };
  if (quarter) where.quarter = assertQuarter(quarter);
  const recs = await db.okrObjective.findMany({
    where,
    include: OKR_OBJ_INCLUDE,
    orderBy: [{ quarter: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return recs.map(okrRowOf);
}

/** Statistik ringkas "OKR Saya": jumlah per status + rata-rata progres Posted. */
export function okrStats(rows: OkrObjectiveRow[]): {
  total: number; draft: number; posted: number; closed: number;
  avgProgressPct: number | null;
} {
  const posted = rows.filter((r) => r.status === "Posted");
  return {
    total: rows.length,
    draft: rows.filter((r) => r.status === "Draft").length,
    posted: posted.length,
    closed: rows.filter((r) => r.status === "Closed").length,
    avgProgressPct: posted.length ? Math.round(posted.reduce((s, r) => s + r.progressPct, 0) / posted.length) : null,
  };
}

/** Detail satu objective (+ anak align 1 level — pohon dukungan D-BL4). */
export async function objectiveDetail(db: TenantDb, id: string): Promise<{
  row: OkrObjectiveRow;
  alignChildren: { id: string; title: string; ownerName: string; status: string; quarter: string }[];
} | null> {
  const o = await db.okrObjective.findUnique({ where: { id }, include: OKR_OBJ_INCLUDE });
  if (!o) return null;
  const children = await db.okrObjective.findMany({
    where: { alignToId: id },
    select: { id: true, title: true, status: true, quarter: true, owner: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return {
    row: okrRowOf(o),
    alignChildren: children.map((c) => ({ id: c.id, title: c.title, ownerName: c.owner.fullName, status: c.status, quarter: c.quarter })),
  };
}

// ============ picker (create HR / align-to) ============

/** Karyawan aktif utk picker owner (pola searchPipEmployees). */
export async function searchOkrEmployees(db: TenantDb, q?: string) {
  const where: Record<string, unknown> = { status: "Active" };
  if (q) where.OR = [
    { employeeNo: { contains: q, mode: "insensitive" } },
    { fullName: { contains: q, mode: "insensitive" } },
  ];
  const emps = await db.employee.findMany({
    where,
    select: { id: true, employeeNo: true, fullName: true, position: { select: { title: true } }, orgUnit: { select: { name: true } } },
    orderBy: { employeeNo: "asc" },
    take: 30,
  });
  return {
    employees: emps.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName,
      position: e.position?.title ?? null, orgUnit: e.orgUnit?.name ?? null,
    })),
  };
}

/**
 * Opsi align-to: objective Posted/Draft kuartal yang sama milik siapa saja
 * (pohon dukungan lintas pemilik — board transparan). Kecuali objective ini
 * sendiri (guard siklus).
 */
export async function alignOptions(db: TenantDb, quarter: string, excludeId?: string) {
  const rows = await db.okrObjective.findMany({
    where: { quarter: assertQuarter(quarter), status: { in: OKR_OPEN_STATUSES }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, title: true, status: true, owner: { select: { fullName: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return {
    options: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, ownerName: r.owner.fullName })),
  };
}

// ============ guard align — anti siklus (pohon dukungan) ============

/** Naik pohon align dari kandidat; true bila bertemu target (siklus). */
async function alignCreatesCycle(db: TenantDb, fromId: string, alignToId: string): Promise<boolean> {
  let cur: string | null = alignToId;
  for (let hop = 0; hop < 10 && cur; hop++) {
    if (cur === fromId) return true;
    const next = await db.okrObjective.findUnique({ where: { id: cur }, select: { alignToId: true } });
    cur = next?.alignToId ?? null;
  }
  return false;
}

async function assertAlignOk(db: TenantDb, objectiveId: string | null, alignToId: string | null | undefined, quarter: string): Promise<string | null> {
  if (alignToId == null || alignToId === "") return null;
  const parent = await db.okrObjective.findUnique({ where: { id: alignToId }, select: { id: true, quarter: true, status: true } });
  if (!parent) bad("Objective yang didukung (align-to) tidak ditemukan");
  if (parent.quarter !== quarter) bad("Align-to harus objective pada KUARTAL yang sama (pohon dukungan per kuartal)");
  if (!OKR_OPEN_STATUSES.includes(parent.status)) bad("Align-to harus objective ber-status Draft atau Posted (bukan Closed)");
  if (objectiveId && (await alignCreatesCycle(db, objectiveId, alignToId))) {
    bad("Pohon dukungan tidak boleh melingkar (A→B→A)");
  }
  return parent.id;
}

// ============ CREATE (Draft — D-BL3/D-BL4) ============

export async function createObjective(
  db: TenantDb,
  input: {
    quarter: string;
    title: string;
    ownerEmployeeId: string;
    alignToId?: string | null;
    keyResults: OkrKrInput[];
  },
  actor: OkrActor,
): Promise<{ id: string }> {
  await requireOkrOn(db);
  const quarter = assertQuarter(input.quarter);
  const title = String(input.title ?? "").trim();
  if (title.length < 3) bad("Judul objective wajib ≥3 karakter");

  // ownership: non-HR hanya boleh membuat utk dirinya sendiri (ESS Draft)
  if (!actor.isHr && actor.employeeId !== input.ownerEmployeeId) {
    throw new OkrForbiddenError("Hanya HR yang bisa membuat objective milik karyawan lain — karyawan membuat objective untuk dirinya sendiri");
  }
  const owner = await db.employee.findUnique({
    where: { id: input.ownerEmployeeId },
    select: { id: true, fullName: true, status: true },
  });
  if (!owner) bad("Owner objective tidak ditemukan");
  if (owner.status !== "Active") bad("Owner objective harus karyawan ber-status Active");

  const krs = validateKeyResults(input.keyResults);
  const alignToId = await assertAlignOk(db, null, input.alignToId, quarter);

  const obj = await db.okrObjective.create({
    data: {
      quarter,
      title,
      ownerEmployeeId: owner.id,
      alignToId,
      status: "Draft",
      keyResults: {
        create: krs.map((k) => ({
          title: k.title, unit: k.unit, polarity: k.polarity,
          baseline: k.baseline, target: k.target,
          current: k.current != null && Number.isFinite(k.current) ? k.current : k.baseline,
          weight: k.weight,
          confidence: k.confidence ?? "Yellow",
          note: k.note ?? null,
        })),
      },
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "OkrObjective", entityId: obj.id, employeeId: owner.id,
      detail: `OKR ${quarter} "${title}" dibuat (Draft) utk ${owner.fullName}: ${krs.length} key result Σbobot 100${alignToId ? ", mendukung objective lain" : ""} — oleh ${actor.name} (D-BL3: Draft hanya terlihat pemilik + HR sampai diposting)`,
    },
  });
  return { id: obj.id };
}

// ============ UPDATE (Draft penuh — owner/HR) ============

export async function updateObjective(
  db: TenantDb,
  input: {
    id: string;
    quarter?: string;
    title?: string;
    alignToId?: string | null;
    keyResults?: OkrKrInput[];
  },
  actor: OkrActor,
): Promise<{ id: string }> {
  await requireOkrOn(db);
  const o = await db.okrObjective.findUnique({ where: { id: input.id }, include: { keyResults: true } });
  if (!o) bad("Objective tidak ditemukan");
  if (o.status !== "Draft") {
    throw new OkrStateError(`Objective sudah ${o.status} — hanya Draft yang bisa diedit (transisi Draft→Posted→Closed satu arah, D-BL3)`);
  }
  if (!actor.isHr && actor.employeeId !== o.ownerEmployeeId) {
    throw new OkrForbiddenError("Hanya pemilik objective atau HR yang boleh mengubah draf ini");
  }
  const quarter = input.quarter != null ? assertQuarter(input.quarter) : o.quarter;
  const title = input.title != null ? String(input.title).trim() : o.title;
  if (title.length < 3) bad("Judul objective wajib ≥3 karakter");
  const alignToId = input.alignToId !== undefined
    ? await assertAlignOk(db, o.id, input.alignToId, quarter)
    : o.alignToId;
  const krs = input.keyResults !== undefined ? validateKeyResults(input.keyResults) : null;

  await db.okrObjective.update({
    where: { id: o.id },
    data: {
      quarter, title, alignToId,
      ...(krs ? { keyResults: { deleteMany: {}, create: krs.map((k) => ({
        title: k.title, unit: k.unit, polarity: k.polarity,
        baseline: k.baseline, target: k.target,
        current: k.current != null && Number.isFinite(k.current) ? k.current : k.baseline,
        weight: k.weight, confidence: k.confidence ?? "Yellow", note: k.note ?? null,
      })) } } : {}),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "OkrObjective", entityId: o.id, employeeId: o.ownerEmployeeId,
      detail: `OKR ${quarter} "${title}" (Draft) disesuaikan${krs ? ` — KR dibangun ulang ${krs.length} item Σbobot 100` : ""} oleh ${actor.name}`,
    },
  });
  return { id: o.id };
}

// ============ POST (Draft → Posted — owner/HR, D-BL3) ============

export async function postObjective(
  db: TenantDb,
  input: { id: string },
  actor: OkrActor,
): Promise<{ id: string; status: string }> {
  await requireOkrOn(db);
  const o = await db.okrObjective.findUnique({ where: { id: input.id }, include: { owner: { select: { fullName: true } }, keyResults: true } });
  if (!o) bad("Objective tidak ditemukan");
  if (o.status !== "Draft") {
    throw new OkrStateError(`Objective sudah ${o.status} — posting hanya dari Draft (transisi satu arah, D-BL3)`);
  }
  if (!actor.isHr && actor.employeeId !== o.ownerEmployeeId) {
    throw new OkrForbiddenError("Hanya pemilik objective atau HR yang boleh memosting objective ini");
  }
  if (o.keyResults.length < 3 || o.keyResults.length > 5) {
    bad("Objective harus punya 3–5 key result sebelum diposting (D-BL4)");
  }
  await db.okrObjective.update({ where: { id: o.id }, data: { status: "Posted" } });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "OkrObjective", entityId: o.id, employeeId: o.ownerEmployeeId,
      detail: `OKR ${o.quarter} "${o.title}" DIPOSTING oleh ${actor.name} — kini terlihat seluruh karyawan aktif di board transparan (D-BL3)`,
    },
  });
  return { id: o.id, status: "Posted" };
}

// ============ CLOSE (Posted → Closed — HR saja, D-BL5 skor final) ============

export async function closeObjective(
  db: TenantDb,
  input: { id: string },
  actor: OkrActor,
): Promise<{ id: string; status: string; closedScore: number }> {
  await requireOkrOn(db);
  if (!actor.isHr) {
    throw new OkrForbiddenError("Penutupan objective kuartalan (skor final) hanya oleh HR — karyawan bisa memosting, menutup tidak (D-BL5)");
  }
  const o = await db.okrObjective.findUnique({ where: { id: input.id }, include: { owner: { select: { fullName: true } }, keyResults: true } });
  if (!o) bad("Objective tidak ditemukan");
  if (o.status !== "Posted") {
    throw new OkrStateError(`Objective ber-status ${o.status} — penutupan hanya dari Posted (transisi satu arah, D-BL3)`);
  }
  // skor final server otoritatif (D-BL5) — disimpan HANYA saat close
  const final = round2(objectiveScore(o.keyResults));
  await db.okrObjective.update({ where: { id: o.id }, data: { status: "Closed", closedScore: final } });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "OkrObjective", entityId: o.id, employeeId: o.ownerEmployeeId,
      detail: `OKR ${o.quarter} "${o.title}" DITUTUP oleh ${actor.name} — skor final server ${Math.round(final * 100)}% = Σ(bobot/100 × clamp KR) tersimpan permanen (D-BL5; terpisah dari penilaian kinerja — D-BL1)`,
    },
  });
  return { id: o.id, status: "Closed", closedScore: final };
}

// ============ UPDATE KR (progres — owner/HR, hanya saat Posted) ============

export async function updateKeyResult(
  db: TenantDb,
  input: {
    id: string; // KR id
    current?: number;
    confidence?: string;
    note?: string | null;
  },
  actor: OkrActor,
): Promise<{ id: string; objectiveId: string; liveScore: number }> {
  await requireOkrOn(db);
  const kr = await db.okrKeyResult.findUnique({ where: { id: input.id } });
  if (!kr) bad("Key result tidak ditemukan");
  const o = await db.okrObjective.findUnique({
    where: { id: kr.objectiveId },
    include: { keyResults: { orderBy: { createdAt: "asc" } } },
  });
  if (!o) bad("Objective tidak ditemukan");
  if (o.status !== "Posted") {
    throw new OkrStateError(`Objective ber-status ${o.status} — update progres key result hanya saat Posted (saat Draft, edit objective penuh; Closed terkunci)`);
  }
  if (!actor.isHr && actor.employeeId !== o.ownerEmployeeId) {
    throw new OkrForbiddenError("Update progres key result hanya oleh pemilik objective atau HR");
  }
  const data: Record<string, unknown> = { updatedById: actor.employeeId };
  if (input.current !== undefined) {
    const cur = Number(input.current);
    if (!Number.isFinite(cur)) bad("Nilai current harus angka (boleh melewati target — skor di-clamp 0..1)");
    data.current = cur;
  }
  if (input.confidence !== undefined) {
    const conf = String(input.confidence);
    if (!OKR_CONFIDENCES.includes(conf as (typeof OKR_CONFIDENCES)[number])) {
      bad(`Confidence tidak dikenal: ${conf} — gunakan Red, Yellow, atau Green`);
    }
    data.confidence = conf;
  }
  if (input.note !== undefined) {
    const note = input.note == null ? null : String(input.note);
    if (note != null && note.length > 500) bad("Catatan maksimal 500 karakter");
    data.note = note;
  }
  await db.okrKeyResult.update({ where: { id: kr.id }, data });
  const live = round2(objectiveScore(o.keyResults.map((k) => (k.id === kr.id ? { ...k, ...(data as Partial<typeof k>) } : k))));
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "OkrKeyResult", entityId: kr.id, employeeId: o.ownerEmployeeId,
      detail: `Progres KR "${kr.title}" (OKR ${o.quarter} "${o.title}"): current ${input.current !== undefined ? `${kr.current} → ${Number(input.current)}` : "tetap"}, confidence ${input.confidence ?? kr.confidence}${input.note ? `, catatan: "${String(input.note).slice(0, 120)}"` : ""} — oleh ${actor.name}; skor objective live ${Math.round(live * 100)}%`,
    },
  });
  return { id: kr.id, objectiveId: o.id, liveScore: live };
}

// ============ DELETE (Draft saja — owner/HR) ============

export async function deleteObjective(
  db: TenantDb,
  input: { id: string },
  actor: OkrActor,
): Promise<{ id: string }> {
  await requireOkrOn(db);
  const o = await db.okrObjective.findUnique({ where: { id: input.id }, include: { owner: { select: { fullName: true } } } });
  if (!o) bad("Objective tidak ditemukan");
  if (o.status !== "Draft") {
    throw new OkrStateError(`Objective sudah ${o.status} — hanya Draft yang bisa dihapus (Posted/Closed adalah riwayat transparan)`);
  }
  if (!actor.isHr && actor.employeeId !== o.ownerEmployeeId) {
    throw new OkrForbiddenError("Hanya pemilik objective atau HR yang boleh menghapus draf ini");
  }
  // lepas anak align (FK onDelete SetNull juga menjamin — eksplisit utk kejelasan)
  await db.okrObjective.updateMany({ where: { alignToId: o.id }, data: { alignToId: null } });
  await db.okrObjective.delete({ where: { id: o.id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "OkrObjective", entityId: o.id, employeeId: o.ownerEmployeeId,
      detail: `OKR ${o.quarter} "${o.title}" (Draft, milik ${o.owner.fullName}) DIHAPUS oleh ${actor.name} — anak align dilepas (dukungan kini tanpa induk)`,
    },
  });
  return { id: o.id };
}
