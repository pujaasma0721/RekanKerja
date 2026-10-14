// P6-PERF — PIP End-to-End (DEVELOPMENT-PLAN-PERFORMANCE.md §33 alur 9; §17 pip;
// §35 guard 20–22). Service lengkap alur 9 PIP 30/60/90 hari:
//   create (dari usul Alur 8 / manual ber-alasan) → SK PIP terbit saat draf
//   dibuat (idempoten metaJson.pipDocNo — pola P5 decidePip) → activate
//   (approval AS-PIP-STD: L1 ATASAN_LANGSUNG atasan karyawan yang dibina →
//   L2 HR_ADMIN, NON-nominal §9) → status Active → reviewCheckpoint
//   (pembina/HR, 0–150, catatan wajib bila capaian < 60) → extend (maks 1×,
//   total ≤ 3 bln, minimal 1 checkpoint Reviewed) → outcome Recovered
//   (checkpoint terakhir-Reviewed ≥ 100) / NotRecovered (SARAN DisciplinaryRecord
//   jenjang SP + PA Termination — eksekusi MANUAL via HR Base; modul TIDAK
//   auto-PHK §33-4) + pembatalan.
// Scheduler pipReminders: (a) checkpoint Pending jatuh tempo ≤ H+3 → ingatkan
// pembina + karyawan; (b) endDate ≤ hari ini → ingatkan HR (keputusan paling
// lambat +7 hari); (c) endDate + 7 lewat → eskalasi overdue (ActivityLog sekali
// per PIP). Semua transisi ter-ActivityLog; notifikasi milestone notifyEvent.
//
// Status saat approval berjalan: TETAP "Draft" (enum §15 tanpa Submitted) —
// badge "Menunggu approval" UI diturunkan dari chain; reject → kembali Draft
// dan bisa diajukan ulang (chain terminal dihapus, pola submitMerit §32-2).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  startApprovalChain, decideApprovalChain, cancelApprovalChain, attachChainSummaries,
  getApprovalChain, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { issueLetter, fmtDateIdLong } from "@/rekankerja/shared/services/letter-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { nextPerfNo } from "@/rekankerja/performance/services/perf-master-service";

function bad(msg: string): never { throw new Error(msg); }

/** docType approval + template SK (kategori Performance — pola P5 PERF_PIP). */
const PIP_DOC_TYPE = "PipPlan";
export const PERF_PIP_KEY = "PERF_PIP";

/** Durasi PIP 1–3 bulan, default 2 (register D7 — §23). */
export const PIP_MONTHS_MIN = 1;
export const PIP_MONTHS_MAX = 3;
/** Satu bulan = 30 hari (basis jadwal checkpoint 30/60/90 — D7). */
const DAYS_PER_MONTH = 30;
/** Total maksimum program termasuk perpanjangan: 3 bulan (D7 / §35-21). */
const MAX_TOTAL_DAYS = PIP_MONTHS_MAX * DAYS_PER_MONTH;

/** Status PIP masih terbuka (Draft|Active|Extended — §35-20 "PIP aktif lain"). */
function pipOpen(s: string): boolean { return s === "Draft" || s === "Active" || s === "Extended"; }
/** Status terminal (Recovered/NotRecovered/Cancelled). */
function pipTerminal(s: string): boolean { return !pipOpen(s); }
/** PIP yang programnya berjalan (checkpoint/extend/outcome — SK sudah terbit). */
function pipLive(s: string): boolean { return s === "Active" || s === "Extended"; }

/** Aktor sesi diperkaya — dipakai guard pelaku (pembina vs HR/admin). */
export interface PipActor {
  /** role workspace platform (OWNER|ADMIN|HR|…). */
  role: string;
  /** role AppUser tenant (Admin/HR Manager/HR Staff/Approver/…). */
  appUserRole: string | null;
  employeeId: string | null;
  name: string;
  appUserId: string | null;
}

const HR_ROLES = ["OWNER", "ADMIN", "HR"];
const HR_APP_ROLES = ["Admin", "HR Manager", "HR Staff"];

/** Aktor = HR/admin (boleh semua aksi PIP) — selain pembina (§33-3, §35-22). */
function isHrActor(a: PipActor): boolean {
  return HR_ROLES.includes(a.role) || (a.appUserRole != null && HR_APP_ROLES.includes(a.appUserRole));
}

// ============ TARGET MINI-KPI (§33-2: 3–5 item, Σbobot 100) ============

export interface PipTargetInput { title: string; metric: string; target: string; weight: number }

function parseTargets(json: string): PipTargetInput[] {
  try {
    const arr = JSON.parse(json) as PipTargetInput[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Validasi target mini-KPI PIP: 3–5 item, Σbobot = 100. Bila seluruh bobot
 * kosong/0 → diisi merata (default merata — keputusan desain P6). */
function validateTargets(targets: PipTargetInput[]): PipTargetInput[] {
  if (!Array.isArray(targets) || targets.length < 3 || targets.length > 5) {
    bad("Target PIP harus 3–5 item (mini-KPI §33-2)");
  }
  const clean = targets.map((t) => ({
    title: String(t.title ?? "").trim(),
    metric: String(t.metric ?? "").trim(),
    target: String(t.target ?? "").trim(),
    weight: Number(t.weight ?? 0),
  }));
  for (const t of clean) {
    if (t.title.length < 3) bad("Judul tiap target wajib ≥3 karakter");
    if (t.metric.length < 2) bad("Metrik pengukuran tiap target wajib diisi");
    if (t.target.length < 1) bad("Nilai target tiap item wajib diisi");
  }
  // default merata bila semua bobot 0/kosong
  if (clean.every((t) => !Number.isFinite(t.weight) || t.weight <= 0)) {
    const base = Math.floor(100 / clean.length);
    clean.forEach((t, i) => { t.weight = i === clean.length - 1 ? 100 - base * (clean.length - 1) : base; });
  }
  for (const t of clean) {
    if (!Number.isFinite(t.weight) || t.weight <= 0 || t.weight > 100) bad("Bobot target harus angka 1–100");
  }
  const sum = clean.reduce((s, t) => s + t.weight, 0);
  if (Math.abs(sum - 100) > 0.01) bad(`Jumlah bobot target harus 100 (sekarang ${Math.round(sum)})`);
  return clean;
}

/** Tanggal + n hari. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}

/** Jadwal checkpoint: seq 1..3 pada +30/+60/+90 hari sejak mulai (§33 judul
 * alur 9 — KONSISTEN dengan usul PIP dari penilaian rating ≤2 / P5 decidePip). */
function checkpointDueDates(startDate: Date): Date[] {
  return [30, 60, 90].map((d) => addDays(startDate, d));
}

// ============ STRUKTUR AS-PIP-STD + TEMPLATE SK PIP (idempoten) ============

/** Pastikan struktur approval PIP + template SK PIP ada (tenant baru via
 * provisioning; tenant lama self-heal saat menu PIP dibuka pertama kali). */
export async function ensurePipInfrastructure(db: TenantDb): Promise<void> {
  const existing = await db.approvalStructure.findUnique({ where: { code: "AS-PIP-STD" }, select: { id: true } });
  if (!existing) {
    await db.approvalStructure.create({
      data: {
        code: "AS-PIP-STD",
        name: "Persetujuan Program Perbaikan Kinerja (default)",
        docType: PIP_DOC_TYPE,
        levels: {
          create: [
            { levelNo: 1, approverType: "ATASAN_LANGSUNG", note: "L1 — Atasan langsung karyawan yang dibina (§33-1)" },
            { levelNo: 2, approverType: "HR_ADMIN", note: "L2 — Verifikasi program PIP" },
          ],
        },
      },
    }).catch(() => null); // race tenant bootstrap — struktur unik per code
  }
  const tpl = await db.letterTemplate.findUnique({ where: { key: PERF_PIP_KEY }, select: { id: true } });
  if (!tpl) {
    // seed dari katalog bawaan (sumber tunggal — sama dgn provisioning tenant baru)
    const { LETTER_TEMPLATE_DEFAULTS } = await import("@/rekankerja/shared/lib/letter-defaults");
    const def = LETTER_TEMPLATE_DEFAULTS.find((d) => d.key === PERF_PIP_KEY);
    if (def) {
      await db.letterTemplate.create({
        data: {
          key: def.key,
          category: def.category,
          name: def.name,
          description: def.description ?? null,
          subject: def.subject ?? null,
          body: def.body,
          signatoryName: "",
          signatoryTitle: def.signatoryTitle,
        },
      }).catch(() => null); // race tenant bootstrap
    }
  }
}

// ============ SARAN DISIPLIN (§33-4 — TIDAK auto-create) ============

export interface PipSuggestion {
  existingSpCount: number;
  lastWarningLevel: string | null;
  suggestedNextLevel: string;
  priorRecords: { level: string; issuedAt: string; violation: string }[];
  note: string;
  paSuggestion: string;
}

/** Saran tindak lanjut NotRecovered berdasarkan riwayat DisciplinaryRecord:
 * 0 record → Written (SP1); ada Written → Final (SP3); sudah Final → evaluasi
 * PA Termination. PA selalu manual via modul HR Base (§33-4). */
export async function disciplinarySuggestion(db: TenantDb, employeeId: string): Promise<PipSuggestion> {
  const records = await db.disciplinaryRecord.findMany({
    where: { employeeId },
    select: { warningLevel: true, issuedAt: true, violation: true },
    orderBy: { issuedAt: "desc" },
  });
  const rank: Record<string, number> = { Verbal: 1, Written: 2, Final: 3 };
  let highest: string | null = null;
  for (const r of records) {
    if (rank[r.warningLevel] != null && (highest == null || rank[r.warningLevel] > rank[highest])) highest = r.warningLevel;
  }
  let suggestedNextLevel: string;
  if (highest == null) suggestedNextLevel = "Written (SP1)";
  else if (highest === "Written") suggestedNextLevel = "Final (SP3)";
  else if (highest === "Final") suggestedNextLevel = "Termination";
  else suggestedNextLevel = "Final (SP3)";
  const note = highest == null
    ? "Belum ada riwayat SP — saran: mulai SP tertulis (SP1) via modul HR Base. Modul ini TIDAK otomatis membuat SP/PHK (bukti PIP + SP = rantai pertahanan §7)."
    : `Riwayat ${records.length} SP (tertinggi: ${highest}) — saran lanjutan: ${suggestedNextLevel} via modul HR Base.`;
  return {
    existingSpCount: records.length,
    lastWarningLevel: highest,
    suggestedNextLevel,
    priorRecords: records.map((r) => ({
      level: r.warningLevel,
      issuedAt: r.issuedAt.toISOString(),
      violation: r.violation,
    })),
    note,
    paSuggestion: "Personnel Action Termination (bila diputuskan) digulirkan MANUAL di modul HR Base — modul Performance tidak otomatis mem-PHK (§33-4).",
  };
}

// ============ SK PIP (idempoten metaJson.pipDocNo — pola P5 decidePip) ============

/** Cek SK PIP sudah terbit utk dokumen PIP (idempoten via metaJson — pola
 * findResultLetter P5). */
async function findPipLetter(db: TenantDb, pipDocNo: string): Promise<{ id: string; refNo: string } | null> {
  const doc = await db.letterDocument.findFirst({
    where: { templateKey: PERF_PIP_KEY, metaJson: { contains: `"pipDocNo":"${pipDocNo}"` } },
    select: { id: true, refNo: true },
    orderBy: { issuedAt: "desc" },
  });
  return doc ?? null;
}

/** Terbitkan SK PIP bila belum ada (dipakai saat draf dibuat DAN saat persetujuan
 * penuh — idempoten). extraCtx mengikuti placeholder template PERF_PIP Line-1. */
async function ensureSkPip(
  db: TenantDb,
  pip: { id: string; docNo: string; employeeId: string; startDate: Date; endDate: Date; reviewerId: string; targetsJson: string; appraisalId: string | null },
  opts: { actorName: string; actorId?: string | null },
): Promise<{ id: string; refNo: string } | null> {
  const existing = await findPipLetter(db, pip.docNo);
  if (existing) return existing;

  // konteks penilaian asal (rating/skor utk template) — "—" bila PIP manual
  let appraisalNo = "—";
  let cycleName = "—";
  let finalScore = "—";
  let ratingLabel = "—";
  if (pip.appraisalId) {
    const a = await db.appraisalRecord.findUnique({
      where: { id: pip.appraisalId },
      select: { docNo: true, finalScore: true, finalRating: true, cycle: { select: { name: true } } },
    });
    if (a) {
      appraisalNo = a.docNo;
      cycleName = a.cycle.name;
      finalScore = a.finalScore != null ? String(a.finalScore) : "—";
      if (a.finalRating != null) {
        const scales = await db.ratingScale.findMany({ select: { value: true, labelId: true } });
        ratingLabel = scales.find((s) => s.value === a.finalRating)?.labelId ?? String(a.finalRating);
      }
    }
  }
  const reviewer = await db.employee.findUnique({ where: { id: pip.reviewerId }, select: { fullName: true } });
  const targets = parseTargets(pip.targetsJson);
  const pipTargetsText = targets
    .map((t, i) => `${i + 1}. ${t.title} — target: ${t.target}${t.metric ? ` (${t.metric})` : ""} (bobot ${t.weight}%)`)
    .join("\n");

  await ensurePipInfrastructure(db);
  const letter = await issueLetter(db, {
    category: "Performance",
    templateKey: PERF_PIP_KEY,
    employeeId: pip.employeeId,
    actorId: opts.actorId ?? null,
    extraCtx: {
      appraisal_no: appraisalNo,
      cycle_name: cycleName,
      final_score: finalScore,
      rating_label: ratingLabel,
      pip_start: fmtDateIdLong(pip.startDate),
      pip_end: fmtDateIdLong(pip.endDate),
      pip_reviewer: reviewer?.fullName ?? "—",
      pip_targets: pipTargetsText,
    },
  });
  // meta idempoten: pipDocNo (pola P5 decidePip — metaJson berisi appraisalNo/cycleId/pipDocNo)
  const existingMeta = await db.letterDocument.findUnique({ where: { id: letter.id }, select: { metaJson: true } });
  try {
    const meta = existingMeta?.metaJson ? (JSON.parse(existingMeta.metaJson) as Record<string, unknown>) : {};
    await db.letterDocument.update({
      where: { id: letter.id },
      data: { metaJson: JSON.stringify({ ...meta, pipDocNo: pip.docNo }) },
    });
  } catch { /* metaJson korup — biarkan */ }
  return { id: letter.id, refNo: letter.refNo };
}

// ============ DAFTAR + DETAIL (§17 pip) ============

export interface PipRow {
  id: string; docNo: string;
  employeeId: string; employeeName: string; employeeNo: string; unit: string | null;
  appraisalId: string | null; appraisalDocNo: string | null; finalRating: number | null;
  startDate: string; endDate: string; months: number; daysRemaining: number;
  reviewerId: string; reviewerName: string | null; advisorId: string | null; advisorName: string | null;
  targets: PipTargetInput[];
  checkpoints: { id: string; seq: number; dueDate: string; achievementPct: number | null; notes: string | null; status: string; reviewedBy: string | null; reviewedAt: string | null }[];
  status: string; outcomeNotes: string | null; letterRefNo: string | null;
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

/** SK PIP terbit per dokumen — refNo terakhir (metaJson.pipDocNo idempoten). */
async function pipLetterRefs(db: TenantDb): Promise<Map<string, string>> {
  const letters = await db.letterDocument.findMany({
    where: { templateKey: PERF_PIP_KEY },
    select: { metaJson: true, refNo: true, issuedAt: true },
    orderBy: { issuedAt: "desc" },
  });
  const by = new Map<string, string>();
  for (const l of letters) {
    try {
      const m = JSON.parse(l.metaJson ?? "{}") as { pipDocNo?: string };
      if (m.pipDocNo && !by.has(m.pipDocNo)) by.set(m.pipDocNo, l.refNo);
    } catch { /* abaikan */ }
  }
  return by;
}

async function pipNameMap(db: TenantDb, ids: Iterable<string>): Promise<Map<string, string>> {
  const set = [...new Set(ids)];
  if (set.length === 0) return new Map();
  const emps = await db.employee.findMany({ where: { id: { in: set } }, select: { id: true, fullName: true } });
  return new Map(emps.map((e) => [e.id, e.fullName]));
}

/** Bentuk record PIP + relasi yang dipakai pembentukan baris register/detail. */
interface PipWithRelations {
  id: string; docNo: string; employeeId: string; appraisalId: string | null;
  startDate: Date; endDate: Date; reviewerId: string; hrAdvisorId: string | null;
  targetsJson: string; status: string; outcomeNotes: string | null;
  employee: { fullName: string; employeeNo: string; orgUnit: { name: string } | null };
  checkpoints: { id: string; seq: number; dueDate: Date; achievementPct: number | null; notes: string | null; status: string; reviewedById: string | null; reviewedAt: Date | null }[];
}

function pipRowOf(
  r: PipWithRelations,
  empName: Map<string, string>,
  apprBy: Map<string, { docNo: string; finalRating: number | null }>,
  letterBy: Map<string, string>,
): PipRow {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    id: r.id, docNo: r.docNo,
    employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo,
    unit: r.employee.orgUnit?.name ?? null,
    appraisalId: r.appraisalId,
    appraisalDocNo: r.appraisalId ? apprBy.get(r.appraisalId)?.docNo ?? null : null,
    finalRating: r.appraisalId ? apprBy.get(r.appraisalId)?.finalRating ?? null : null,
    startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString(),
    months: Math.round((r.endDate.getTime() - r.startDate.getTime()) / (DAYS_PER_MONTH * 24 * 3600 * 1000)),
    daysRemaining: Math.round((r.endDate.getTime() - today.getTime()) / (24 * 3600 * 1000)),
    reviewerId: r.reviewerId, reviewerName: empName.get(r.reviewerId) ?? null,
    advisorId: r.hrAdvisorId, advisorName: r.hrAdvisorId ? empName.get(r.hrAdvisorId) ?? null : null,
    targets: parseTargets(r.targetsJson),
    checkpoints: r.checkpoints
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((c) => ({
        id: c.id, seq: c.seq, dueDate: c.dueDate.toISOString(),
        achievementPct: c.achievementPct, notes: c.notes, status: c.status,
        reviewedBy: c.reviewedById ? empName.get(c.reviewedById) ?? null : null,
        reviewedAt: c.reviewedAt?.toISOString() ?? null,
      })),
    status: r.status, outcomeNotes: r.outcomeNotes,
    letterRefNo: letterBy.get(r.docNo) ?? null,
    chain: null, // diisi attachChainSummaries
  };
}

export async function listPips(
  db: TenantDb,
  opts: { status?: string; employeeId?: string; q?: string },
): Promise<{
  rows: PipRow[];
  stats: {
    total: number; draft: number; active: number; extended: number;
    recovered: number; notRecovered: number; cancelled: number;
    recoveryRate: number | null;
  };
}> {
  const q = opts.q?.trim();
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
    ...(q ? {
      OR: [
        { docNo: { contains: q, mode: "insensitive" as const } },
        { employee: { fullName: { contains: q, mode: "insensitive" as const } } },
      ],
    } : {}),
  };
  const recs = await db.pipPlan.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true, orgUnit: { select: { name: true } } } },
      checkpoints: true,
    },
    orderBy: { docNo: "asc" },
  });
  const chains = await attachChainSummaries(db, PIP_DOC_TYPE as never, recs.map((r) => ({ id: r.id })));

  // reviewer / advisor / reviewedBy — resolusi batch per panggilan
  const empIds = new Set<string>();
  for (const r of recs) {
    empIds.add(r.reviewerId);
    if (r.hrAdvisorId) empIds.add(r.hrAdvisorId);
    for (const c of r.checkpoints) { if (c.reviewedById) empIds.add(c.reviewedById); }
  }
  const empName = await pipNameMap(db, empIds);

  const apprIds = [...new Set(recs.map((r) => r.appraisalId).filter((x): x is string => x != null))];
  const apprs = apprIds.length > 0
    ? await db.appraisalRecord.findMany({ where: { id: { in: apprIds } }, select: { id: true, docNo: true, finalRating: true } })
    : [];
  const apprBy = new Map(apprs.map((a) => [a.id, a]));

  const letterBy = await pipLetterRefs(db);
  const rows: PipRow[] = recs.map((r) => {
    const row = pipRowOf(r, empName, apprBy, letterBy);
    const c = chains.get(r.id) ?? null;
    row.chain = c ? { status: c.status, currentLevel: c.currentLevel, totalLevels: c.totalLevels, currentApprover: c.currentApprover } : null;
    return row;
  });

  // stats register: jumlah per status + tingkat pemulihan (pf42 §33-5)
  const all = await db.pipPlan.findMany({ select: { status: true } });
  const count = (s: string) => all.filter((r) => r.status === s).length;
  const recovered = count("Recovered");
  const notRecovered = count("NotRecovered");
  return {
    rows,
    stats: {
      total: all.length,
      draft: count("Draft"), active: count("Active"), extended: count("Extended"),
      recovered, notRecovered, cancelled: count("Cancelled"),
      recoveryRate: recovered + notRecovered > 0 ? Math.round((recovered / (recovered + notRecovered)) * 1000) / 10 : null,
    },
  };
}

/** Detail satu PIP (GET ?id= §17): targets + checkpoints + chain lengkap +
 * pratinjau saran disiplin (live — untuk panel NotRecovered UI). */
export async function pipDetail(db: TenantDb, id: string): Promise<{
  row: PipRow;
  chainSteps: { levelNo: number; approverType: string; approverLabel: string; status: string; note: string | null; decidedBy: string | null; decidedAt: string | null }[] | null;
  suggestion: PipSuggestion | null;
} | null> {
  const r = await db.pipPlan.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true, orgUnit: { select: { name: true } } } },
      checkpoints: true,
    },
  });
  if (!r) return null;
  const chain = await getApprovalChain(db, PIP_DOC_TYPE as never, r.id);
  const empName = await pipNameMap(db, [
    r.reviewerId, ...(r.hrAdvisorId ? [r.hrAdvisorId] : []),
    ...r.checkpoints.map((c) => c.reviewedById).filter((x): x is string => x != null),
  ]);
  const appr = r.appraisalId
    ? await db.appraisalRecord.findUnique({ where: { id: r.appraisalId }, select: { id: true, docNo: true, finalRating: true } })
    : null;
  const letterBy = await pipLetterRefs(db);
  const row = pipRowOf(r, empName, new Map(appr ? [[appr.id, appr]] : []), letterBy);
  row.chain = chain ? { status: chain.status, currentLevel: chain.currentLevel, totalLevels: chain.totalLevels, currentApprover: chain.steps.find((s) => s.status === "Current")?.approverLabel ?? null } : null;
  const suggestion = pipLive(r.status) || r.status === "NotRecovered"
    ? await disciplinarySuggestion(db, r.employeeId)
    : null;
  return {
    row,
    chainSteps: chain
      ? chain.steps.map((s) => ({
          levelNo: s.levelNo, approverType: s.approverType, approverLabel: s.approverLabel,
          status: s.status, note: s.note, decidedBy: s.decidedBy, decidedAt: s.decidedAt?.toISOString() ?? null,
        }))
      : null,
    suggestion,
  };
}

// ============ PICKER (create/patch) ============

/** Daftar karyawan Active utk picker create (pola listEnrollable). */
export async function searchPipEmployees(db: TenantDb, q?: string) {
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
  return { employees: emps.map((e) => ({ id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, position: e.position?.title ?? null, orgUnit: e.orgUnit?.name ?? null })) };
}

/** Kandidat pembina (atasan dgn assignment aktif) + HR advisor (AppUser HR). */
export async function pipReferees(db: TenantDb) {
  const mgrRows = await db.employeeAssignment.findMany({
    where: { validTo: null, managerId: { not: null } },
    select: { managerId: true },
    take: 500,
  });
  const mgrIds = [...new Set(mgrRows.map((m) => m.managerId).filter((x): x is string => x != null))];
  const reviewers = mgrIds.length > 0
    ? await db.employee.findMany({
        where: { id: { in: mgrIds }, status: "Active" },
        select: { id: true, fullName: true, employeeNo: true, position: { select: { title: true } } },
        orderBy: { fullName: "asc" },
      })
    : [];
  const hrUsers = await db.appUser.findMany({
    where: { role: { in: HR_APP_ROLES }, active: true, employeeId: { not: null } },
    select: { employeeId: true, fullName: true, role: true },
    take: 50,
  });
  const advIds = [...new Set(hrUsers.map((u) => u.employeeId).filter((x): x is string => x != null))];
  const advEmps = advIds.length > 0
    ? await db.employee.findMany({ where: { id: { in: advIds } }, select: { id: true, fullName: true, employeeNo: true } })
    : [];
  return {
    reviewers: reviewers.map((e) => ({ id: e.id, fullName: e.fullName, employeeNo: e.employeeNo, position: e.position?.title ?? null })),
    advisors: advEmps.map((e) => ({ id: e.id, fullName: e.fullName, employeeNo: e.employeeNo })),
  };
}

/** Penilaian Closed milik karyawan yang bisa ditautkan ke PIP (opsional). */
export async function linkableAppraisals(db: TenantDb, employeeId: string) {
  const rows = await db.appraisalRecord.findMany({
    where: { employeeId, status: "Closed", finalRating: { not: null } },
    select: { id: true, docNo: true, finalRating: true, cycle: { select: { code: true } } },
    orderBy: { docNo: "desc" },
    take: 10,
  });
  return { appraisals: rows.map((r) => ({ id: r.id, docNo: r.docNo, finalRating: r.finalRating, cycleCode: r.cycle.code })) };
}

// ============ CREATE (§35-20 — dari usul Alur 8 / manual ber-alasan) ============

export async function createPip(
  db: TenantDb,
  input: {
    employeeId: string; appraisalId?: string; reason?: string;
    startDate: string; months: number;
    targets: PipTargetInput[]; reviewerId?: string; hrAdvisorId?: string;
  },
  actor: string,
): Promise<{ id: string; docNo: string; letterRefNo: string | null }> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, status: true } });
  if (!emp) bad("Karyawan tidak ditemukan");
  if (emp.status !== "Active") bad(`Karyawan berstatus ${emp.status} — PIP hanya utk karyawan Active`);
  // guard §35-20: tidak boleh ada PIP aktif lain utk karyawan sama
  const open = await db.pipPlan.findFirst({
    where: { employeeId: input.employeeId, status: { notIn: ["Recovered", "NotRecovered", "Cancelled"] } },
    select: { docNo: true, status: true },
  });
  if (open) bad(`${emp.fullName} masih punya PIP berjalan (${open.docNo} — status ${open.status}). Selesaikan dulu program sebelum membuat yang baru.`);
  const reason = (input.reason ?? "").trim();
  if (input.appraisalId) {
    const a = await db.appraisalRecord.findUnique({
      where: { id: input.appraisalId },
      select: { employeeId: true, docNo: true, finalRating: true, status: true },
    });
    if (!a) bad("Penilaian yang ditautkan tidak ditemukan");
    if (a.employeeId !== input.employeeId) bad("Penilaian yang ditautkan bukan milik karyawan ini");
    // §35-20: tautan sah = Closed rating ≤2; rating lebih tinggi → wajib alasan manual (ter-audit)
    if (a.status !== "Closed") bad(`Penilaian ${a.docNo} berstatus ${a.status} — PIP hanya bisa ditautkan ke hasil Closed (§35-20)`);
    if ((a.finalRating ?? 0) > 2 && reason.length < 10) {
      bad(`Penilaian ${a.docNo} rating ${a.finalRating} (> 2) — tautkan penilaian rating ≤2 ATAU isi alasan manual ≥10 karakter (§35-20)`);
    }
  } else {
    // PIP manual (tanpa usulan penilaian) — alasan wajib ≥10 karakter (§35-20)
    if (reason.length < 10) bad("PIP manual (tanpa tautan penilaian) wajib menyertakan alasan ≥10 karakter (§35-20)");
  }
  // pembina: eksplisit ATAU fallback atasan langsung assignment aktif karyawan
  let reviewerId = input.reviewerId?.trim() || "";
  if (!reviewerId) {
    const mgr = await db.employeeAssignment.findFirst({
      where: { employeeId: input.employeeId, validTo: null, managerId: { not: null } },
      orderBy: { validFrom: "desc" },
      select: { managerId: true },
    });
    reviewerId = mgr?.managerId ?? "";
    if (!reviewerId) bad("Pembina (reviewer) wajib dipilih — karyawan tidak punya atasan aktif di assignment");
  }
  const reviewer = await db.employee.findUnique({ where: { id: reviewerId }, select: { id: true, fullName: true } });
  if (!reviewer) bad("Pembina (reviewer) tidak ditemukan");
  if (input.hrAdvisorId) {
    const adv = await db.employee.findUnique({ where: { id: input.hrAdvisorId }, select: { id: true } });
    if (!adv) bad("HR advisor tidak ditemukan");
  }

  const months = Math.round(Number(input.months ?? 2));
  if (!Number.isFinite(months) || months < PIP_MONTHS_MIN || months > PIP_MONTHS_MAX) {
    bad(`Durasi PIP ${PIP_MONTHS_MIN}–${PIP_MONTHS_MAX} bulan (D7 — default 2)`);
  }
  const start = new Date(input.startDate);
  if (Number.isNaN(start.getTime())) bad("Tanggal mulai tidak valid");
  const targets = validateTargets(input.targets);
  const end = addDays(start, months * DAYS_PER_MONTH);

  const docNo = await nextPerfNo(db, "PIP"); // penomoran max-suffix global lintas-siklus (pola Line-1)
  const dueDates = checkpointDueDates(start);
  const pip = await db.pipPlan.create({
    data: {
      docNo,
      employeeId: input.employeeId,
      appraisalId: input.appraisalId ?? null,
      startDate: start,
      endDate: end,
      targetsJson: JSON.stringify(targets),
      reviewerId,
      hrAdvisorId: input.hrAdvisorId ?? null,
      status: "Draft",
      checkpoints: {
        create: dueDates.map((d, i) => ({ seq: i + 1, dueDate: d, status: "Pending" })),
      },
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PipPlan", entityId: docNo, employeeId: input.employeeId,
      detail: `PIP ${docNo} dibuat (draf) utk ${emp.fullName}: ${targets.length} target Σbobot 100, durasi ${months} bln (${fmtDateIdLong(start)} → ${fmtDateIdLong(end)}), checkpoint 30/60/90 hari, pembina ${reviewer.fullName}${input.hrAdvisorId ? `, HR advisor ${input.hrAdvisorId}` : ""}${input.appraisalId ? `, ditautkan ke penilaian` : reason ? `, alasan manual: "${reason}"` : ""} — oleh ${actor} (§35-20)`,
    },
  });
  // SK PROGRAM PERBAIKAN KINERJA terbit saat draf dibuat (pola P5 decidePip —
  // idempoten metaJson.pipDocNo; activate TIDAK menerbitkan ulang)
  const letter = await ensureSkPip(db, pip, { actorName: actor });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipPlan", entityId: docNo, employeeId: input.employeeId,
      detail: `SK PIP ${docNo} terbit: ${letter?.refNo ?? "—"} (draf — program dimulai setelah persetujuan AS-PIP-STD §33-1)`,
    },
  });
  // notifikasi pembina (pola P5 decidePip)
  void notifyEvent(db, {
    to: "employee", docType: "PipPlan", docNo, employeeId: reviewerId,
    title: `PIP ${docNo} menunggu aktivasi — Anda ditetapkan pembina`,
    body: `${emp.fullName} · ${fmtDateIdLong(start)} s.d. ${fmtDateIdLong(end)} — SK PIP ${letter?.refNo ?? "—"} terbit`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });
  return { id: pip.id, docNo, letterRefNo: letter?.refNo ?? null };
}

// ============ PATCH (Draft only — hanya sebelum aktivasi) ============

export async function patchPip(
  db: TenantDb,
  input: {
    id: string; startDate?: string; months?: number; targets?: PipTargetInput[];
    reviewerId?: string; hrAdvisorId?: string | null; appraisalId?: string | null;
  },
  actor: string,
): Promise<{ ok: true }> {
  const pip = await db.pipPlan.findUnique({ where: { id: input.id }, include: { checkpoints: true } });
  if (!pip) bad("PIP tidak ditemukan");
  if (pip.status !== "Draft") bad(`Hanya draf yang bisa diubah (status ${pip.status})`);
  const chain = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: PIP_DOC_TYPE, docId: pip.id } },
    select: { status: true },
  });
  if (chain?.status === "InProgress") bad("Draf sedang dalam persetujuan — batalkan pengajuan dulu sebelum mengubah");

  const oldTargets = parseTargets(pip.targetsJson);
  const targets = input.targets !== undefined ? validateTargets(input.targets) : oldTargets;
  const months = input.months !== undefined ? Math.round(Number(input.months)) : Math.round((pip.endDate.getTime() - pip.startDate.getTime()) / (DAYS_PER_MONTH * 24 * 3600 * 1000));
  if (!Number.isFinite(months) || months < PIP_MONTHS_MIN || months > PIP_MONTHS_MAX) {
    bad(`Durasi PIP ${PIP_MONTHS_MIN}–${PIP_MONTHS_MAX} bulan (D7)`);
  }
  const start = input.startDate !== undefined ? new Date(input.startDate) : pip.startDate;
  if (Number.isNaN(start.getTime())) bad("Tanggal mulai tidak valid");
  const end = addDays(start, months * DAYS_PER_MONTH);
  if (input.reviewerId !== undefined) {
    const reviewer = await db.employee.findUnique({ where: { id: input.reviewerId }, select: { id: true } });
    if (!reviewer) bad("Pembina (reviewer) tidak ditemukan");
  }
  if (input.hrAdvisorId) {
    const adv = await db.employee.findUnique({ where: { id: input.hrAdvisorId }, select: { id: true } });
    if (!adv) bad("HR advisor tidak ditemukan");
  }
  if (input.appraisalId) {
    const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, select: { employeeId: true } });
    if (!a) bad("Penilaian yang ditautkan tidak ditemukan");
    if (a.employeeId !== pip.employeeId) bad("Penilaian yang ditautkan bukan milik karyawan ini");
  }

  const dateChanged = start.getTime() !== pip.startDate.getTime() || end.getTime() !== pip.endDate.getTime();
  await db.pipPlan.update({
    where: { id: pip.id },
    data: {
      startDate: start,
      endDate: end,
      targetsJson: JSON.stringify(targets),
      ...(input.reviewerId !== undefined ? { reviewerId: input.reviewerId } : {}),
      ...(input.hrAdvisorId !== undefined ? { hrAdvisorId: input.hrAdvisorId } : {}),
      ...(input.appraisalId !== undefined ? { appraisalId: input.appraisalId } : {}),
    },
  });
  // tanggal/durasi berubah → jadwal checkpoint dibangun ulang (masih Draft =
  // semua Pending — belum mungkin ada review yang hilang, guard status di atas)
  if (dateChanged) {
    await db.pipCheckpoint.deleteMany({ where: { pipId: pip.id } });
    const dueDates = checkpointDueDates(start);
    await db.pipCheckpoint.createMany({
      data: dueDates.map((d, i) => ({ pipId: pip.id, seq: i + 1, dueDate: d, status: "Pending" })),
    });
  }
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} (draf) disesuaikan${dateChanged ? ` — jadwal checkpoint dibangun ulang (${fmtDateIdLong(start)} → ${fmtDateIdLong(end)}, ${months} bln)` : ""}${input.targets !== undefined ? ` — ${targets.length} target Σbobot 100` : ""} oleh ${actor}`,
    },
  });
  return { ok: true };
}

// ============ ACTIVATE → APPROVAL AS-PIP-STD (§33-1) ============

export async function activatePip(
  db: TenantDb,
  input: { id: string; actor: string; actorId?: string | null },
): Promise<{ chainStatus: string; totalLevels: number; firstApprover: string | null }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: true },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (pip.status !== "Draft") bad(`Aktivasi hanya dari status Draft (status saat ini ${pip.status})`);
  const existing = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: PIP_DOC_TYPE, docId: pip.id } },
    select: { id: true, status: true, currentLevel: true, totalLevels: true },
  });
  if (existing && existing.status === "InProgress") bad("PIP ini sudah menunggu persetujuan (chain InProgress)");
  if (existing) {
    // pengajuan ulang pasca-ditolak (pola submitMerit §32-2): chain lama terminal
    // → arsipkan jejaknya di ActivityLog lalu ganti chain baru (steps ikut cascade)
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "ApprovalChain", entityId: existing.id,
        detail: `Jalur persetujuan lama ${pip.docNo} (status ${existing.status}, jenjang ${existing.currentLevel}/${existing.totalLevels}) dihapus utk pengajuan ulang oleh ${input.actor}`,
      },
    });
    await db.approvalChain.delete({ where: { id: existing.id } });
  }
  await ensurePipInfrastructure(db);
  // pemohon = karyawan yang dibina (pola D4 — tier dari dimensi karyawan)
  const chain = await startApprovalChain(db, {
    docType: PIP_DOC_TYPE as never,
    docId: pip.id,
    employeeId: pip.employeeId,
    createdBy: input.actor,
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} (${pip.employee.fullName}) DIAJUKAN — aktivasi via persetujuan AS-PIP-STD ${chain.totalLevels} jenjang (L1 atasan langsung karyawan yang dibina → L2 HR verifikasi) oleh ${input.actor} (§33-1)`,
    },
  });
  // notifikasi milestone: approver jenjang pertama (pola merit)
  void notifyEvent(db, {
    to: "nextApprover", docType: PIP_DOC_TYPE, docId: pip.id, docNo: pip.docNo, employeeId: pip.employeeId,
    title: `Aktivasi PIP ${pip.docNo} menunggu persetujuan`,
    body: `Program perbaikan kinerja untuk ${pip.employee.fullName} (${fmtDateIdLong(pip.startDate)} → ${fmtDateIdLong(pip.endDate)}) menunggu keputusan Anda (L1 atasan → L2 HR).`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });
  return { chainStatus: chain.status, totalLevels: chain.totalLevels, firstApprover: chain.steps.find((s) => s.status === "Current")?.approverLabel ?? null };
}

/** Keputusan jenjang persetujuan (pola decideMeritApproval): approve → jenjang
 * berikutnya / final → status Active; reject → TETAP Draft (enum tanpa
 * Submitted — badge "Menunggu approval" diturunkan dari chain) + bisa diajukan
 * ulang via activate setelah chain terminal dihapus. */
export async function decidePipApproval(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject"; note?: string },
  actor: DecideActor,
): Promise<{ final: boolean; status: string; letterRefNo?: string }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { id: true, fullName: true, employeeNo: true } }, checkpoints: true },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (pip.status !== "Draft") bad(`PIP sudah diproses (status ${pip.status})`);
  const res = await decideApprovalChain(db, {
    docType: PIP_DOC_TYPE as never, docId: input.id,
    action: input.action, note: input.note, actor,
  });
  if (res.final && input.action === "approve") {
    // §33-1: persetujuan penuh → status Active. SK PIP sudah terbit saat draf
    // dibuat (idempoten — ensureSkPip mengembalikan surat existing).
    const letter = await ensureSkPip(db, pip, { actorName: actor.name, actorId: actor.appUserId ?? null });
    await db.pipPlan.update({ where: { id: pip.id }, data: { status: "Active" } });
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
        detail: `PIP ${pip.docNo} DISETUJUI PENUH → program AKTIF (${fmtDateIdLong(pip.startDate)} → ${fmtDateIdLong(pip.endDate)}, ${pip.checkpoints.length} checkpoint)${letter ? ` + SK PIP ${letter.refNo}` : ""} — keputusan akhir ${actor.name} (AS-PIP-STD §33-1)`,
      },
    });
    // notifikasi: karyawan dibina (program dimulai §33-3) + pembina + admins
    void notifyEvent(db, {
      to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.employeeId,
      title: `Program Perbaikan Kinerja dimulai (${pip.docNo})`,
      body: `Program perbaikan kinerja Anda ${fmtDateIdLong(pip.startDate)} → ${fmtDateIdLong(pip.endDate)} kini AKTIF. Lihat sasaran dan jadwal checkpoint di menu Penilaian Saya. SK: ${letter?.refNo ?? "—"}.`,
      kind: "performance", link: "ess:my-appraisal",
    }).catch(() => { /* never */ });
    void notifyEvent(db, {
      to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.reviewerId,
      title: `Anda pembina PIP ${pip.docNo}`,
      body: `Program perbaikan kinerja ${pip.employee.fullName} AKTIF (${fmtDateIdLong(pip.startDate)} → ${fmtDateIdLong(pip.endDate)}) — Anda ditunjuk sebagai pembina. Catat capaian tiap checkpoint (30/60/90 hari).`,
      kind: "performance", link: "performance:pip",
    }).catch(() => { /* never */ });
    void notifyEvent(db, {
      to: "admins", docType: "PipPlan", docId: pip.id, docNo: pip.docNo,
      title: `PIP ${pip.docNo} aktif`,
      body: `Program perbaikan kinerja ${pip.employee.fullName} disetujui penuh dan berjalan ${fmtDateIdLong(pip.startDate)} → ${fmtDateIdLong(pip.endDate)}.`,
      kind: "performance", link: "performance:pip",
    }).catch(() => { /* never */ });
    return { final: true, status: "Active", letterRefNo: letter?.refNo };
  }
  if (res.final && input.action === "reject") {
    // tetap Draft — draf dapat disunting & diajukan ulang
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
        detail: `PIP ${pip.docNo} DITOLAK di jenjang${input.note ? ` ("${input.note.trim()}")` : ""} — status kembali Draft; draf dapat disunting dan diajukan ulang (${actor.name})`,
      },
    });
    return { final: true, status: "Draft" };
  }
  // approve jenjang non-final — jejak ringkas
  await db.activityLog.create({
    data: {
      action: "Approved", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} disetujui jenjang ${res.chain.currentLevel - 1}/${res.chain.totalLevels} (${actor.name}) — lanjut ke ${res.chain.steps.find((s) => s.status === "Current")?.approverLabel ?? "-"}`,
    },
  }).catch(() => { /* best effort */ });
  void notifyEvent(db, {
    to: "nextApprover", docType: PIP_DOC_TYPE, docId: pip.id, docNo: pip.docNo, employeeId: pip.employeeId,
    title: `Aktivasi PIP ${pip.docNo} menunggu persetujuan Anda (jenjang berikutnya)`,
    body: `Program perbaikan kinerja ${pip.employee.fullName}.`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });
  return { final: false, status: "Draft" };
}

// ============ CHECKPOINT (§33-3 — pembina/HR, sekali jalan) ============

export async function reviewCheckpoint(
  db: TenantDb,
  input: { id: string; seq: number; achievementPct: number; notes?: string; actor: string },
  actor: PipActor,
): Promise<{ ok: true }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: { orderBy: { seq: "asc" } } },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (!pipLive(pip.status)) bad(`Review checkpoint hanya utk PIP Active/Extended (status ${pip.status})`);
  // pelaku sah: pembina (atasan karyawan yang dibina) ATAU HR/admin (§33-3)
  const isPembina = actor.employeeId != null && actor.employeeId === pip.reviewerId;
  if (!isPembina && !isHrActor(actor)) {
    bad("Review checkpoint hanya oleh pembina PIP atau HR/admin");
  }
  const cp = pip.checkpoints.find((c) => c.seq === input.seq);
  if (!cp) bad(`Checkpoint ${input.seq} tidak ditemukan`);
  if (cp.status === "Reviewed") bad(`Checkpoint ${cp.seq} sudah direview — review hanya sekali (ter-audit)`);
  const pct = Number(input.achievementPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 150) bad("Capaian checkpoint harus angka 0–150 (%)");
  const notes = input.notes?.trim() || null;
  // capaian rendah WAJIB disertai catatan ("perlu perhatian")
  if (pct < 60 && !notes) bad("Catatan wajib bila capaian < 60% (perlu perhatian — jelaskan hambatan & bantuan yang dibutuhkan)");
  await db.pipCheckpoint.update({
    where: { id: cp.id },
    data: {
      achievementPct: pct,
      notes,
      status: "Reviewed",
      reviewedById: actor.employeeId,
      reviewedAt: new Date(),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipCheckpoint", entityId: `${pip.docNo}#${cp.seq}`, employeeId: pip.employeeId,
      detail: `Checkpoint ${cp.seq}/${pip.checkpoints.length} PIP ${pip.docNo} (jatuh tempo ${fmtDateIdLong(cp.dueDate)}) direview: capaian ${pct}%${notes ? ` — "${notes}"` : ""} oleh ${input.actor} (§33-3)`,
    },
  });
  // notifikasi progres ke karyawan (ESS melihat progresnya sendiri §33-3)
  void notifyEvent(db, {
    to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.employeeId,
    title: `Checkpoint PIP Anda: ${pct}%`,
    body: `Hasil checkpoint ${cp.seq} program perbaikan kinerja Anda: ${pct}%.${notes ? ` Catatan pembina: ${notes}` : ""} Lihat detail di menu Penilaian Saya.`,
    kind: "performance", link: "ess:my-appraisal",
  }).catch(() => { /* never */ });
  return { ok: true };
}

// ============ EXTEND (§35-21 — maks 1×, total ≤3 bln) ============

export async function extendPip(
  db: TenantDb,
  input: { id: string; months?: number; reason: string; actor: string },
): Promise<{ newEndDate: string; newSeq: number }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: { orderBy: { seq: "desc" }, take: 1 } },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (pip.status === "Extended") bad("PIP sudah pernah diperpanjang — maksimum 1× perpanjangan (§35-21)");
  if (pip.status !== "Active") bad(`Perpanjangan hanya utk PIP Active (status ${pip.status})`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan perpanjangan wajib ≥10 karakter (ter-audit)");
  // bukti monitoring: minimal 1 checkpoint sudah Reviewed sebelum boleh extend
  const reviewed = await db.pipCheckpoint.count({ where: { pipId: pip.id, status: "Reviewed" } });
  if (reviewed < 1) bad("Minimal 1 checkpoint harus sudah direview sebelum perpanjangan (bukti monitoring berjalan)");

  const months = Math.round(Number(input.months));
  if (!Number.isFinite(months) || months < 1 || months > 2) bad("Perpanjangan 1–2 bulan");
  const end = addDays(pip.endDate, months * DAYS_PER_MONTH);
  if (end.getTime() <= pip.endDate.getTime()) bad("Tanggal berakhir baru harus setelah tenggat saat ini");
  const maxEnd = addDays(pip.startDate, MAX_TOTAL_DAYS);
  if (end.getTime() > maxEnd.getTime()) {
    bad(`Total durasi PIP maksimum 3 bulan dari ${fmtDateIdLong(pip.startDate)} (s.d. ${fmtDateIdLong(maxEnd)} — §35-21)`);
  }

  // checkpoint baru seq lanjut, dueDate = endDate baru (§33-4 Extend)
  const nextSeq = (pip.checkpoints[0]?.seq ?? 0) + 1;
  await db.pipCheckpoint.create({
    data: { pipId: pip.id, seq: nextSeq, dueDate: end, status: "Pending" },
  });
  await db.pipPlan.update({
    where: { id: pip.id },
    data: { endDate: end, status: "Extended" },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} DIPERPANJANG: ${fmtDateIdLong(pip.endDate)} → ${fmtDateIdLong(end)} + checkpoint ${nextSeq} pada tenggat baru — "${reason}" oleh ${input.actor} (maks 1× perpanjangan, total ≤3 bln §35-21)`,
    },
  });
  // notifikasi: karyawan + pembina
  void notifyEvent(db, {
    to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.employeeId,
    title: `PIP ${pip.docNo} diperpanjang`,
    body: `Program perbaikan kinerja diperpanjang menjadi ${fmtDateIdLong(end)} (checkpoint baru ${nextSeq} pada tenggat baru).`,
    kind: "performance", link: "ess:my-appraisal",
  }).catch(() => { /* never */ });
  void notifyEvent(db, {
    to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.reviewerId,
    title: `PIP ${pip.docNo} diperpanjang`,
    body: `Program ${pip.employee.fullName} diperpanjang s.d. ${fmtDateIdLong(end)} — catat capaian checkpoint ${nextSeq} saat jatuh tempo. ${reason}`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });
  return { newEndDate: end.toISOString(), newSeq: nextSeq };
}

// ============ OUTCOME (§33-4; §35-22) ============

export async function pipOutcome(
  db: TenantDb,
  input: { id: string; outcome: "Recovered" | "NotRecovered"; notes: string; actor: string },
): Promise<{
  ok: true;
  suggestion?: PipSuggestion;
}> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: { orderBy: { seq: "asc" } } },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (!pipLive(pip.status)) bad(`Keputusan hasil hanya utk PIP Active/Extended (status ${pip.status})`);
  if (input.outcome !== "Recovered" && input.outcome !== "NotRecovered") bad("Outcome harus Recovered atau NotRecovered");
  const notes = input.notes.trim();
  if (notes.length < 10) bad("Catatan outcome wajib ≥10 karakter (ter-audit)");

  // gate §35-22: checkpoint akhir sudah Reviewed ATAU sudah lewat tenggat
  // (endDate + 7 hari); guard: masih ada checkpoint Pending yang belum jatuh tempo → 400
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lastCp = pip.checkpoints[pip.checkpoints.length - 1] ?? null;
  const pastDeadline = today.getTime() > addDays(pip.endDate, 7).getTime();
  const lastReviewed = lastCp?.status === "Reviewed";
  if (!lastReviewed && !pastDeadline) {
    const pendingNotDue = pip.checkpoints.find((c) => c.status === "Pending" && c.dueDate.getTime() > today.getTime());
    bad(pendingNotDue
      ? `Checkpoint ${pendingNotDue.seq} masih Pending dan belum jatuh tempo (${fmtDateIdLong(pendingNotDue.dueDate)}) — keputusan hasil menunggu review checkpoint akhir atau lewat tenggat +7 hari (§35-22)`
      : "Checkpoint akhir belum direview — keputusan hasil menunggu review checkpoint akhir atau lewat tenggat +7 hari (§35-22)");
  }

  // validasi Recovered: checkpoint TERAKHIR yang Reviewed harus ≥100 (§33-4)
  if (input.outcome === "Recovered") {
    const reviewed = pip.checkpoints.filter((c) => c.status === "Reviewed");
    const lastR = reviewed[reviewed.length - 1] ?? null;
    if (!lastR) bad("Tidak ada checkpoint yang sudah direview — Recovered membutuhkan checkpoint terakhir-Reviewed bercapaian ≥100%");
    if ((lastR.achievementPct ?? 0) < 100) {
      bad(`Checkpoint terakhir yang direview (seq ${lastR.seq}) bercapaian ${lastR.achievementPct}% — Recovered mensyaratkan capaian ≥100% pada checkpoint terakhir yang direview`);
    }
  }

  await db.pipPlan.update({
    where: { id: pip.id },
    data: { status: input.outcome, outcomeNotes: notes },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} OUTCOME ${input.outcome.toUpperCase()} (${pip.employee.fullName})${pastDeadline && !lastReviewed ? " — diputuskan SETELAH lewat tenggat +7 hari (ter-audit)" : ""}: "${notes}" oleh ${input.actor}${input.outcome === "Recovered" ? " — catat pada penilaian berikutnya (bukan hapus riwayat §33-4)" : ""} (§35-22)`,
    },
  });

  // notifikasi: karyawan + pembina + admins
  void notifyEvent(db, {
    to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.employeeId,
    title: input.outcome === "Recovered"
      ? `Program PIP selesai — pulih (${pip.docNo})`
      : `Program PIP selesai — belum pulih (${pip.docNo})`,
    body: input.outcome === "Recovered"
      ? "Program perbaikan kinerja Anda dinyatakan PULIH. Hasil ini dicatat pada penilaian berikutnya (riwayat tetap tersimpan)."
      : "Program perbaikan kinerja Anda dinyatakan BELUM PULIH. HR akan menghubungi Anda mengenai langkah berikutnya.",
    kind: "performance", link: "ess:my-appraisal",
  }).catch(() => { /* never */ });
  void notifyEvent(db, {
    to: "employee", docType: "PipPlan", docId: pip.id, docNo: pip.docNo, employeeId: pip.reviewerId,
    title: `PIP ${pip.docNo}: ${input.outcome === "Recovered" ? "pulih" : "belum pulih"}`,
    body: `Keputusan hasil program perbaikan kinerja ${pip.employee.fullName}: ${input.outcome === "Recovered" ? "RECOVERED" : "NOT RECOVERED"}. ${notes}`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });
  void notifyEvent(db, {
    to: "admins", docType: "PipPlan", docId: pip.id, docNo: pip.docNo,
    title: `PIP ${pip.docNo}: ${input.outcome === "Recovered" ? "Recovered" : "NotRecovered"}`,
    body: input.outcome === "Recovered"
      ? `Program perbaikan kinerja ${pip.employee.fullName} selesai dengan hasil PULIH.`
      : `Program perbaikan kinerja ${pip.employee.fullName} selesai BELUM PULIH — saran tindak lanjut tersedia di register PIP (eksekusi manual).`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });

  if (input.outcome === "Recovered") return { ok: true };

  // SARAN sistem (§33-4): SP sesuai jenjang riwayat + PA Termination —
  // HR mengeksekusi MANUAL di modul HR Base (modul TIDAK auto-membuat SP/PHK).
  const suggestion = await disciplinarySuggestion(db, pip.employeeId);
  return { ok: true, suggestion };
}

// ============ CANCEL (alias close) ============

export async function cancelPip(
  db: TenantDb,
  input: { id: string; reason: string; actor: string },
): Promise<{ ok: true }> {
  const pip = await db.pipPlan.findUnique({ where: { id: input.id } });
  if (!pip) bad("PIP tidak ditemukan");
  if (pipTerminal(pip.status)) bad(`PIP sudah berstatus terminal ${pip.status} — tidak bisa dibatalkan`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan pembatalan wajib ≥10 karakter (ter-audit)");
  // chain berjalan dihentikan tanpa keputusan (race-safe — pola merit)
  await cancelApprovalChain(db, PIP_DOC_TYPE as never, pip.id, input.actor);
  await db.pipPlan.update({
    where: { id: pip.id },
    data: { status: "Cancelled", outcomeNotes: reason },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipPlan", entityId: pip.docNo, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} DIBATALKAN oleh ${input.actor} — "${reason}"`,
    },
  });
  return { ok: true };
}

// ============ SCHEDULER JOB (P6 — §33-3 H-3; §33-4 tenggat) ============

/** Pengingat PIP (wire scheduler "perf-pip-reminder"):
 *  (a) checkpoint Pending jatuh tempo ≤ H+3 pada PIP Active/Extended → notif
 *      pembina + karyawan (dedupe per checkpoint per tanggal);
 *  (b) PIP Active/Extended endDate ≤ hari ini → notif HR admins "outcome jatuh
 *      tempo — keputusan paling lambat +7 hari" (dedupe per PIP per hari);
 *  (c) endDate + 7 lewat → eskalasi overdue: ActivityLog sekali per PIP +
 *      notif HR admins. */
export async function pipReminders(db: TenantDb): Promise<{
  checkpointReminded: number;
  outcomeDueReminded: number;
  overdueEscalated: number;
  notified: number;
}> {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const in3 = addDays(today, 3);
  const yesterday = addDays(today, -1);
  let checkpointReminded = 0;
  let outcomeDueReminded = 0;
  let overdueEscalated = 0;
  let notified = 0;

  // (a) checkpoint ≤3 hari menjelang jatuh tempo → pembina + karyawan
  const cps = await db.pipCheckpoint.findMany({
    where: {
      status: "Pending",
      dueDate: { gte: yesterday, lte: in3 },
      pip: { status: { in: ["Active", "Extended"] } },
    },
    include: {
      pip: { include: { employee: { select: { fullName: true } } } },
    },
    take: 100,
  });
  for (const cp of cps) {
    const dayKey = cp.dueDate.toISOString().slice(0, 10);
    const key = `reminder:perf-pip-cp:${cp.id}:${dayKey}`;
    const claimed = await claimReminder(db, key, `Checkpoint PIP ${cp.pip.docNo} tahap ${cp.seq} jatuh tempo ${dayKey}`);
    if (!claimed) continue;
    checkpointReminded++;
    const r1 = await notifyEvent(db, {
      to: "employee", docType: "PipPlan", docId: cp.pip.id, docNo: cp.pip.docNo, employeeId: cp.pip.reviewerId,
      title: `Checkpoint PIP ${cp.pip.docNo} jatuh tempo ${fmtDateIdLong(cp.dueDate)}`,
      body: `Checkpoint ${cp.seq} program perbaikan kinerja ${cp.pip.employee.fullName} jatuh tempo ${cp.dueDate.toLocaleDateString("id-ID")} — catat capaian (achievement %) sekarang.`,
      kind: "performance", link: "performance:pip",
    });
    const r2 = await notifyEvent(db, {
      to: "employee", docType: "PipPlan", docId: cp.pip.id, docNo: cp.pip.docNo, employeeId: cp.pip.employeeId,
      title: `Checkpoint PIP Anda jatuh tempo ${cp.dueDate.toLocaleDateString("id-ID")}`,
      body: `Checkpoint ${cp.seq} program perbaikan kinerja Anda jatuh tempo ${cp.dueDate.toLocaleDateString("id-ID")} — pembina akan mencatat capaian.`,
      kind: "performance", link: "ess:my-appraisal",
    });
    notified += r1.recipients.length + r2.recipients.length;
  }

  // (b) endDate ≤ hari ini → HR admins (outcome jatuh tempo, keputusan ≤ +7 hr)
  const due = await db.pipPlan.findMany({
    where: {
      status: { in: ["Active", "Extended"] },
      endDate: { lte: today },
    },
    include: { employee: { select: { fullName: true } } },
    take: 100,
  });
  const dayKey = today.toISOString().slice(0, 10);
  for (const p of due) {
    const overdueDays = Math.floor((today.getTime() - p.endDate.getTime()) / (24 * 3600 * 1000));
    if (overdueDays > 7) continue; // sudah masuk eskalasi (c)
    const key = `reminder:perf-pip-due:${p.id}:${dayKey}`;
    const claimed = await claimReminder(db, key, `PIP ${p.docNo} jatuh tempo ${p.endDate.toISOString().slice(0, 10)} — outcome belum diputus`);
    if (!claimed) continue;
    outcomeDueReminded++;
    const r = await notifyEvent(db, {
      to: "admins", docType: "PipPlan", docId: p.id, docNo: p.docNo,
      title: `PIP ${p.docNo} jatuh tempo — putuskan hasil`,
      body: `Program perbaikan kinerja ${p.employee.fullName} berakhir ${fmtDateIdLong(p.endDate)} tanpa keputusan outcome (Recovered/NotRecovered). Keputusan paling lambat endDate +7 hari (§33-4).`,
      kind: "performance", link: "performance:pip",
    });
    notified += r.recipients.length;
  }

  // (c) endDate + 7 lewat → eskalasi overdue SEKALI per PIP (ActivityLog)
  const overdue = await db.pipPlan.findMany({
    where: {
      status: { in: ["Active", "Extended"] },
      endDate: { lt: addDays(today, -7) },
    },
    include: { employee: { select: { fullName: true } } },
    take: 100,
  });
  for (const p of overdue) {
    const key = `reminder:perf-pip-overdue:${p.id}`;
    const claimed = await claimReminder(db, key, `PIP ${p.docNo} LEWAT tenggat ${p.endDate.toISOString().slice(0, 10)} +7 hari tanpa outcome — eskalasi`);
    if (!claimed) continue;
    overdueEscalated++;
    const r = await notifyEvent(db, {
      to: "admins", docType: "PipPlan", docId: p.id, docNo: p.docNo,
      title: `ESKALASI: PIP ${p.docNo} lewat tenggat +7 hari`,
      body: `Program perbaikan kinerja ${p.employee.fullName} berakhir ${fmtDateIdLong(p.endDate)} dan melewati tenggat keputusan (+7 hari) tanpa outcome. Putuskan segera (Recovered/NotRecovered).`,
      kind: "performance", link: "performance:pip",
    });
    notified += r.recipients.length;
  }
  return { checkpointReminded, outcomeDueReminded, overdueEscalated, notified };
}

/** Klaim pengingat sekali-jalan (pola checkinReminders Line-1: findFirst +
 * create — dedupe ActivityLog action 'Reminder' entity 'Scheduler'). */
async function claimReminder(db: TenantDb, key: string, detail: string): Promise<boolean> {
  const claimed = await db.activityLog.findFirst({ where: { action: "Reminder", entity: "Scheduler", entityId: key } });
  if (claimed) return false;
  await db.activityLog.create({
    data: { actorType: "system", action: "Reminder", entity: "Scheduler", entityId: key, detail },
  }).catch(() => { /* best effort */ });
  return true;
}
