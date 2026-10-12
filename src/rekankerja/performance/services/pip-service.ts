// P6-PERF — PIP end-to-end (DEVELOPMENT-PLAN-PERFORMANCE.md §33 alur 9):
// draf PipPlan (target mini-KPI 3–5 item + jadwal checkpoint 3 tahap + pembina +
// HR advisor, durasi 1–3 bulan D7), submit → approval AS-PIP-STD (L1 atasan →
// L2 HR — NON-nominal, tier dari dimensi karyawan yang dinilai D4), persetujuan
// penuh → status Active + SK PROGRAM PERBAIKAN KINERJA terbit (issueLetter
// sourceRef idempoten), review checkpoint (achievementPct 0–150 sekali jalan),
// perpanjangan maks 1× (total tetap ≤3 bulan — D7, checkpoint baru seq lanjut),
// outcome Recovered (dicatat pada penilaian berikutnya — bukan hapus riwayat) /
// NotRecovered (SARAN DisciplinaryRecord per jenjang SP + PA Termination manual
// via HR Base — modul TIDAK auto-PHK), pembatalan ter-audit. Scheduler:
// checkpoint jatuh tempo H-3 → ingatkan pembina; PIP lewat endDate+7 tanpa
// outcome → ingatkan HR (dedupe ActivityLog Reminder).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  startApprovalChain, decideApprovalChain, cancelApprovalChain, attachChainSummaries,
  type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { issueLetter } from "@/rekankerja/shared/services/letter-service";

function bad(msg: string): never { throw new Error(msg); }

/** Durasi PIP 1–3 bulan, default 2 (register D7 — §23). */
export const PIP_MONTHS_MIN = 1;
export const PIP_MONTHS_MAX = 3;
/** Satu bulan didefinisikan 30 hari (basis jadwal checkpoint 30/60/90 — D7). */
const DAYS_PER_MONTH = 30;
/** Total maksimum program termasuk perpanjangan: 3 bulan (D7). */
const MAX_TOTAL_DAYS = PIP_MONTHS_MAX * DAYS_PER_MONTH;

/** Status PIP yang masih berjalan/bisa diproses (belum terminal — §33-5). */
function pipOpen(s: string): boolean { return s === "Draft" || s === "Active" || s === "Extended"; }
/** Status terminal PIP (Recovered/NotRecovered/Cancelled). */
function pipTerminal(s: string): boolean { return !pipOpen(s); }
/** PIP yang SK-nya sudah terbit (program berjalan — checkpoint/extend/outcome). */
function pipLive(s: string): boolean { return s === "Active" || s === "Extended"; }

export interface PipTargetInput { title: string; metric: string; target: string; weight: number }

function parseTargets(json: string): PipTargetInput[] {
  try {
    const arr = JSON.parse(json) as PipTargetInput[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Validasi target mini-KPI PIP: 3–5 item, Σbobot = 100 (§33-2). */
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
    if (!Number.isFinite(t.weight) || t.weight <= 0 || t.weight > 100) bad("Bobot target harus angka 1–100");
  }
  const sum = clean.reduce((s, t) => s + t.weight, 0);
  if (Math.abs(sum - 100) > 0.01) bad(`Jumlah bobot target harus 100 (sekarang ${Math.round(sum)})`);
  return clean;
}

/** Tanggal + n hari (basis 30/60/90 — D7). */
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}

/** Jadwal checkpoint: seq 1..3 tersebar merata (2 bln → +20/+40/+60; 3 bln →
 * +30/+60/+90; 1 bln → +10/+20/+30 — D7). */
function checkpointDueDates(startDate: Date, months: number): Date[] {
  const step = (months * DAYS_PER_MONTH) / 3;
  return [1, 2, 3].map((i) => addDays(startDate, Math.round(step * i)));
}

// ============ STRUKTUR AS-PIP-STD + TEMPLATE SK PIP (idempoten) ============

/** Pastikan struktur approval PIP + template SK PIP ada (tenant baru via
 * provisioning; tenant lama self-heal saat PIP dibuka pertama kali). */
export async function ensurePipInfrastructure(db: TenantDb): Promise<void> {
  const existing = await db.approvalStructure.findUnique({ where: { code: "AS-PIP-STD" }, select: { id: true } });
  if (!existing) {
    await db.approvalStructure.create({
      data: {
        code: "AS-PIP-STD",
        name: "Persetujuan Rencana PIP (default)",
        docType: "PipPlan",
        levels: {
          create: [
            { levelNo: 1, approverType: "ATASAN_LANGSUNG", note: "L1 — atasan langsung karyawan yang dibina" },
            { levelNo: 2, approverType: "HR_ADMIN", note: "L2 — HR verifikasi proses PIP (AS-PIP-STD §11.1)" },
          ],
        },
      },
    }).catch(() => null); // race tenant bootstrap — struktur unik per code
  }
  const tpl = await db.letterTemplate.findUnique({ where: { key: "SK_PIP" }, select: { id: true } });
  if (!tpl) {
    // seed dari katalog bawaan (sumber tunggal — sama dgn provisioning tenant baru)
    const { LETTER_TEMPLATE_DEFAULTS } = await import("@/rekankerja/shared/lib/letter-defaults");
    const def = LETTER_TEMPLATE_DEFAULTS.find((d) => d.key === "SK_PIP");
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

// ============ DAFTAR ============

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

export async function listPips(
  db: TenantDb,
  opts: { status?: string; employeeId?: string },
): Promise<{ rows: PipRow[] }> {
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
  };
  const recs = await db.pipPlan.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true, orgUnit: { select: { name: true } } } },
      checkpoints: true,
    },
    orderBy: { docNo: "asc" },
  });
  const chains = await attachChainSummaries(db, "PipPlan", recs.map((r) => ({ id: r.id })));

  // reviewer / advisor / appraisal / reviewedBy — relasi polos (schema tanpa
  // named relation) → resolusi batch per panggilan.
  const empIds = new Set<string>();
  for (const r of recs) {
    empIds.add(r.reviewerId);
    if (r.hrAdvisorId) empIds.add(r.hrAdvisorId);
    for (const c of r.checkpoints) { if (c.reviewedById) empIds.add(c.reviewedById); }
  }
  const emps = empIds.size > 0
    ? await db.employee.findMany({ where: { id: { in: [...empIds] } }, select: { id: true, fullName: true } })
    : [];
  const empName = new Map(emps.map((e) => [e.id, e.fullName]));

  const apprIds = [...new Set(recs.map((r) => r.appraisalId).filter((x): x is string => x != null))];
  const apprs = apprIds.length > 0
    ? await db.appraisalRecord.findMany({ where: { id: { in: apprIds } }, select: { id: true, docNo: true, finalRating: true } })
    : [];
  const apprBy = new Map(apprs.map((a) => [a.id, a]));

  // SK PIP terbit per dokumen — refNo terakhir (metaJson.sourceRef = docNo idempoten)
  const letters = await db.letterDocument.findMany({
    where: { templateKey: "SK_PIP" },
    select: { metaJson: true, refNo: true, issuedAt: true },
    orderBy: { issuedAt: "desc" },
  });
  const letterBy = new Map<string, string>();
  for (const l of letters) {
    try {
      const m = JSON.parse(l.metaJson ?? "{}") as { sourceRef?: string };
      if (m.sourceRef && !letterBy.has(m.sourceRef)) letterBy.set(m.sourceRef, l.refNo);
    } catch { /* abaikan */ }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    rows: recs.map((r) => ({
      id: r.id, docNo: r.docNo,
      employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      unit: r.employee.orgUnit?.name ?? null,
      appraisalId: r.appraisalId, appraisalDocNo: r.appraisalId ? apprBy.get(r.appraisalId)?.docNo ?? null : null,
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
      chain: chains.get(r.id) ?? null,
    })),
  };
}

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
    where: { role: { in: ["HR Manager", "HR Staff", "Admin"] }, active: true, employeeId: { not: null } },
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

// ============ CREATE / UPDATE (DRAFT) ============

export async function createPip(
  db: TenantDb,
  input: {
    employeeId: string; appraisalId?: string; startDate: string; months: number;
    targets: PipTargetInput[]; reviewerId: string; hrAdvisorId?: string;
  },
  actor: string,
): Promise<{ id: string; docNo: string }> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, status: true } });
  if (!emp) bad("Karyawan tidak ditemukan");
  if (emp.status !== "Active") bad(`Karyawan berstatus ${emp.status} — PIP hanya utk karyawan Active`);
  const open = await db.pipPlan.findFirst({
    where: { employeeId: input.employeeId, status: { notIn: ["Recovered", "NotRecovered", "Cancelled"] } },
    select: { docNo: true, status: true },
  });
  if (open) bad(`${emp.fullName} masih punya PIP berjalan (${open.docNo} — status ${open.status}). Selesaikan dulu program sebelum membuat yang baru.`);
  if (input.appraisalId) {
    const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, select: { employeeId: true } });
    if (!a) bad("Penilaian yang ditautkan tidak ditemukan");
    if (a.employeeId !== input.employeeId) bad("Penilaian yang ditautkan bukan milik karyawan ini");
  }
  const reviewer = await db.employee.findUnique({ where: { id: input.reviewerId }, select: { id: true, fullName: true } });
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

  const year = new Date().getFullYear();
  let seq = await db.pipPlan.count({ where: { docNo: { startsWith: `PIP-${year}` } } });
  let docNo = "";
  // guard tabrakan docNo (unique) — pola MER: maju sampai slot kosong
  for (let i = 0; i < 50; i++) {
    seq++;
    docNo = `PIP-${year}-${String(seq).padStart(4, "0")}`;
    const clash = await db.pipPlan.findUnique({ where: { docNo }, select: { id: true } });
    if (!clash) break;
  }
  const dueDates = checkpointDueDates(start, months);
  const pip = await db.pipPlan.create({
    data: {
      docNo,
      employeeId: input.employeeId,
      appraisalId: input.appraisalId ?? null,
      startDate: start,
      endDate: end,
      targetsJson: JSON.stringify(targets),
      reviewerId: input.reviewerId,
      hrAdvisorId: input.hrAdvisorId ?? null,
      status: "Draft",
      checkpoints: {
        create: dueDates.map((d, i) => ({ seq: i + 1, dueDate: d, status: "Pending" })),
      },
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PipPlan", entityId: pip.id, employeeId: input.employeeId,
      detail: `PIP ${docNo} dibuat (draf) utk ${emp.fullName}: ${targets.length} target Σbobot 100, durasi ${months} bln (${start.toLocaleDateString("id-ID")} → ${end.toLocaleDateString("id-ID")}), pembina ${reviewer.fullName}${input.hrAdvisorId ? `, HR advisor ${input.hrAdvisorId}` : ""}${input.appraisalId ? `, ditautkan ke penilaian ${input.appraisalId}` : ""} — oleh ${actor}`,
    },
  });
  return { id: pip.id, docNo };
}

export async function updatePip(
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
    where: { docType_docId: { docType: "PipPlan", docId: pip.id } },
    select: { status: true },
  });
  if (chain?.status === "InProgress") bad("Draf sedang dalam persetujuan — tarik/batalkan dulu sebelum mengubah");

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
  // tanggal berubah → jadwal checkpoint dibangun ulang (draf = semua Pending,
  // belum ada review yang hilang — guard status Draft di atas)
  if (dateChanged) {
    await db.pipCheckpoint.deleteMany({ where: { pipId: pip.id } });
    const dueDates = checkpointDueDates(start, months);
    await db.pipCheckpoint.createMany({
      data: dueDates.map((d, i) => ({ pipId: pip.id, seq: i + 1, dueDate: d, status: "Pending" })),
    });
  }
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} (draf) disesuaikan${dateChanged ? ` — jadwal checkpoint dibangun ulang (${start.toLocaleDateString("id-ID")} → ${end.toLocaleDateString("id-ID")}, ${months} bln)` : ""}${input.targets !== undefined ? ` — ${targets.length} target Σbobot 100` : ""} oleh ${actor}`,
    },
  });
  return { ok: true };
}

// ============ SUBMIT → APPROVAL (AS-PIP-STD — NON-nominal, D4) ============

export async function submitPip(
  db: TenantDb,
  input: { id: string; actor: string; actorId?: string | null },
): Promise<{ chainStatus: string }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: true },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (pip.status !== "Draft") bad(`PIP sudah diproses (status ${pip.status})`);
  const existing = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: "PipPlan", docId: pip.id } },
    select: { id: true, status: true, currentLevel: true, totalLevels: true },
  });
  if (existing && existing.status === "InProgress") bad("PIP ini sudah dalam persetujuan");
  if (existing) {
    // pengajuan ulang pasca-ditolak (pola merit §32-2): chain lama terminal →
    // arsipkan jejaknya di ActivityLog lalu ganti chain baru (steps ikut cascade).
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "ApprovalChain", entityId: existing.id,
        detail: `Jalur persetujuan lama ${pip.docNo} (status ${existing.status}, jenjang ${existing.currentLevel}/${existing.totalLevels}) dihapus utk pengajuan ulang oleh ${input.actor}`,
      },
    });
    await db.approvalChain.delete({ where: { id: existing.id } });
  }
  await ensurePipInfrastructure(db);
  const chain = await startApprovalChain(db, {
    docType: "PipPlan",
    docId: pip.id,
    employeeId: pip.employeeId, // tier dari dimensi karyawan yang dibina (D4)
    createdBy: input.actor,
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} (${pip.employee.fullName}) diajukan — persetujuan AS-PIP-STD ${chain.totalLevels} jenjang (L1 atasan → L2 HR) oleh ${input.actor}`,
    },
  });
  // notifikasi milestone: pembina (≈L1 atasan) + HR users (L2 — pola submitMerit)
  const users = await db.appUser.findMany({ where: { employeeId: pip.reviewerId, active: true }, select: { id: true }, take: 5 });
  const hrUsers = await db.appUser.findMany({ where: { role: { in: ["HR Manager", "HR Staff", "Admin"] }, active: true }, select: { id: true }, take: 10 });
  const seenUsers = new Set<string>();
  for (const u of [...users, ...hrUsers]) {
    if (seenUsers.has(u.id)) continue;
    seenUsers.add(u.id);
    await db.notification.create({
      data: {
        appUserId: u.id,
        title: `Rencana PIP ${pip.docNo} menunggu persetujuan`,
        body: `Program perbaikan kinerja untuk ${pip.employee.fullName} (${pip.startDate.toLocaleDateString("id-ID")} → ${pip.endDate.toLocaleDateString("id-ID")}) menunggu keputusan (L1 atasan → L2 HR). Buka menu Performance → PIP.`,
        kind: "performance",
        link: "performance:pip",
      },
    }).catch(() => null);
  }
  return { chainStatus: chain.status };
}

export async function decidePip(
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
    docType: "PipPlan", docId: input.id,
    action: input.action, note: input.note, actor,
  });
  if (res.final && input.action === "approve") {
    // §33-1: persetujuan penuh → status Active + SK PIP terbit (idempoten sourceRef)
    await ensurePipInfrastructure(db);
    const targets = parseTargets(pip.targetsJson);
    const letter = await issueLetter(db, {
      category: "Performance",
      templateKey: "SK_PIP",
      employeeId: pip.employeeId,
      actorId: actor.appUserId ?? null,
      sourceRef: pip.docNo,
      extraContext: {
        pip_doc_no: pip.docNo,
        pip_start_date: pip.startDate.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
        pip_end_date: pip.endDate.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
        pip_targets_summary: targets.map((t) => `- ${t.title} — ${t.target} ${t.metric ? `(${t.metric})` : ""} (bobot ${t.weight}%)`).join("\n"),
        pip_reviewer_name: await employeeNameOf(db, pip.reviewerId),
      },
    });
    await db.pipPlan.update({ where: { id: pip.id }, data: { status: "Active" } });
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
        detail: `PIP ${pip.docNo} DISETUJUI PENUH → program AKTIF (${pip.startDate.toLocaleDateString("id-ID")} → ${pip.endDate.toLocaleDateString("id-ID")}, ${pip.checkpoints.length} checkpoint) + SK PIP ${letter.refNo} terbit`,
      },
    });
    // notifikasi ke karyawan: program dimulai (§33-3 ESS melihat progresnya)
    const empUsers = await db.appUser.findMany({ where: { employeeId: pip.employeeId, active: true }, select: { id: true }, take: 5 });
    for (const u of empUsers) {
      await db.notification.create({
        data: {
          appUserId: u.id,
          title: `Program Perbaikan Kinerja dimulai (${pip.docNo})`,
          body: `Anda terdaftar dalam program perbaikan kinerja ${pip.startDate.toLocaleDateString("id-ID")} → ${pip.endDate.toLocaleDateString("id-ID")}. Lihat sasaran dan jadwal checkpoint Anda di menu ESS Penilaian Saya. SK: ${letter.refNo}.`,
          kind: "performance",
          link: "ess:my-appraisal",
        },
      }).catch(() => null);
    }
    return { final: true, status: "Active", letterRefNo: letter.refNo };
  }
  if (input.action === "reject") {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
        detail: `PIP ${pip.docNo} DITOLAK di jenjang${input.note ? ` (“${input.note.trim()}”)` : ""} — draf dapat disunting dan diajukan ulang`,
      },
    });
    return { final: true, status: "Draft" };
  }
  return { final: false, status: "Draft" };
}

async function employeeNameOf(db: TenantDb, employeeId: string): Promise<string> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { fullName: true } });
  return e?.fullName ?? "—";
}

// ============ CHECKPOINT (§33-3 — review sekali jalan) ============

export async function reviewCheckpoint(
  db: TenantDb,
  input: { id: string; seq: number; achievementPct: number; notes?: string; actor: string },
  actor: DecideActor,
): Promise<{ ok: true }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: { orderBy: { seq: "asc" } } },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (!pipLive(pip.status)) bad(`Review checkpoint hanya utk PIP Active/Extended (status ${pip.status})`);
  const cp = pip.checkpoints.find((c) => c.seq === input.seq);
  if (!cp) bad(`Checkpoint ${input.seq} tidak ditemukan`);
  if (cp.status === "Reviewed") bad(`Checkpoint ${cp.seq} sudah direview — review hanya sekali (ter-audit)`);
  const pct = Number(input.achievementPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 150) bad("Capaian checkpoint harus angka 0–150 (%)");
  const notes = input.notes?.trim() || null;

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
      action: "Processed", entity: "PipCheckpoint", entityId: cp.id, employeeId: pip.employeeId,
      detail: `Checkpoint ${cp.seq}/3 PIP ${pip.docNo} (${cp.dueDate.toLocaleDateString("id-ID")}) direview: capaian ${pct}%${notes ? ` — “${notes}”` : ""} oleh ${input.actor}`,
    },
  });
  // notifikasi: HR advisor (bila ada) + karyawan (progress-nya sendiri §33-3)
  const targets: { appUserId: string; title: string; body: string; link: string }[] = [];
  if (pip.hrAdvisorId) {
    const advisors = await db.appUser.findMany({ where: { employeeId: pip.hrAdvisorId, active: true }, select: { id: true }, take: 3 });
    for (const u of advisors) {
      targets.push({
        appUserId: u.id,
        title: `Checkpoint PIP ${pip.docNo}: ${pct}%`,
        body: `Checkpoint ${cp.seq} (${cp.dueDate.toLocaleDateString("id-ID")}) karyawan ${pip.employee.fullName} dicatat ${pct}%${notes ? ` — ${notes}` : ""}. Buka menu Performance → PIP.`,
        link: "performance:pip",
      });
    }
  }
  const empUsers = await db.appUser.findMany({ where: { employeeId: pip.employeeId, active: true }, select: { id: true }, take: 5 });
  for (const u of empUsers) {
    targets.push({
      appUserId: u.id,
      title: `Checkpoint PIP Anda: ${pct}%`,
      body: `Hasil checkpoint ${cp.seq} program perbaikan kinerja Anda: ${pct}%. Lihat detail di menu ESS Penilaian Saya.`,
      link: "ess:my-appraisal",
    });
  }
  for (const n of targets) {
    await db.notification.create({
      data: { appUserId: n.appUserId, title: n.title, body: n.body, kind: "performance", link: n.link },
    }).catch(() => null);
  }
  return { ok: true };
}

// ============ EXTEND (D7 — maks 1×, total ≤3 bulan) ============

export async function extendPip(
  db: TenantDb,
  input: { id: string; extraWeeks?: number; newEndDate?: string; reason: string; actor: string },
): Promise<{ newEndDate: string; newSeq: number }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: { orderBy: { seq: "desc" }, take: 1 } },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (pip.status === "Extended") bad("PIP sudah pernah diperpanjang — maksimum 1× perpanjangan (D7)");
  if (pip.status !== "Active") bad(`Perpanjangan hanya utk PIP Active (status ${pip.status})`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan perpanjangan wajib ≥10 karakter (ter-audit)");

  let end: Date;
  if (input.newEndDate) {
    end = new Date(input.newEndDate);
    if (Number.isNaN(end.getTime())) bad("Tanggal berakhir baru tidak valid");
  } else if (input.extraWeeks != null) {
    const weeks = Math.round(Number(input.extraWeeks));
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 8) bad("Perpanjangan 1–8 minggu");
    end = addDays(pip.endDate, weeks * 7);
  } else {
    bad("Sertakan tanggal berakhir baru atau jumlah minggu perpanjangan");
  }
  if (end.getTime() <= pip.endDate.getTime()) bad("Tanggal berakhir baru harus setelah tenggat saat ini");
  const maxEnd = addDays(pip.startDate, MAX_TOTAL_DAYS);
  if (end.getTime() > maxEnd.getTime()) {
    bad(`Total durasi PIP maksimum 3 bulan dari ${pip.startDate.toLocaleDateString("id-ID")} (s.d. ${maxEnd.toLocaleDateString("id-ID")} — D7)`);
  }

  // checkpoint baru seq lanjut dgn dueDate = tenggat baru (keputusan desain:
  // perpanjangan = tahap evaluasi tambahan, bukan sekadar geser tenggat lama)
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
      action: "Processed", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} DIPERPANJANG: ${pip.endDate.toLocaleDateString("id-ID")} → ${end.toLocaleDateString("id-ID")} + checkpoint ${nextSeq} — “${reason}” oleh ${input.actor} (maks 1× — D7)`,
    },
  });
  return { newEndDate: end.toISOString(), newSeq: nextSeq };
}

// ============ OUTCOME (§33-4 — ujung keputusan) ============

export async function outcomePip(
  db: TenantDb,
  input: { id: string; outcome: "Recovered" | "NotRecovered"; notes: string; actor: string },
): Promise<{ ok: true; suggestion?: { existingSpCount: number; lastWarningLevel: string | null; suggestedNextLevel: string; note: string } }> {
  const pip = await db.pipPlan.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } }, checkpoints: { orderBy: { seq: "asc" } } },
  });
  if (!pip) bad("PIP tidak ditemukan");
  if (!pipLive(pip.status)) bad(`Outcome hanya utk PIP Active/Extended (status ${pip.status})`);
  if (input.outcome !== "Recovered" && input.outcome !== "NotRecovered") bad("Outcome harus Recovered atau NotRecovered");
  const notes = input.notes.trim();
  if (notes.length < 10) bad("Catatan outcome wajib ≥10 karakter (ter-audit)");

  const lastCp = pip.checkpoints[pip.checkpoints.length - 1] ?? null;
  const notReviewedYet = lastCp ? lastCp.status !== "Reviewed" : true;
  await db.pipPlan.update({
    where: { id: pip.id },
    data: { status: input.outcome, outcomeNotes: notes },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} OUTCOME ${input.outcome.toUpperCase()} (${pip.employee.fullName})${notReviewedYet ? " — dicatat SEBELUM checkpoint terakhir direview (keputusan dipercepat, ter-audit)" : ""}: “${notes}” oleh ${input.actor}${input.outcome === "Recovered" ? " — catat pada penilaian berikutnya (bukan hapus riwayat)" : ""}`,
    },
  });

  // notifikasi ke karyawan
  const empUsers = await db.appUser.findMany({ where: { employeeId: pip.employeeId, active: true }, select: { id: true }, take: 5 });
  for (const u of empUsers) {
    await db.notification.create({
      data: {
        appUserId: u.id,
        title: input.outcome === "Recovered"
          ? `Program PIP selesai — pulih (${pip.docNo})`
          : `Program PIP selesai — belum pulih (${pip.docNo})`,
        body: input.outcome === "Recovered"
          ? `Selamat — program perbaikan kinerja Anda dinyatakan PULIH. Hasil ini dicatat pada penilaian berikutnya (riwayat tetap tersimpan).`
          : `Program perbaikan kinerja Anda dinyatakan BELUM PULIH. HR akan menghubungi Anda mengenai langkah berikutnya.`,
        kind: "performance",
        link: "ess:my-appraisal",
      },
    }).catch(() => null);
  }

  if (input.outcome === "Recovered") return { ok: true };

  // SARAN sistem (§33-4): DisciplinaryRecord per jenjang riwayat SP — HR
  // mengeksekusi MANUAL di modul HR Base (modul TIDAK auto-membuat SP/PHK).
  const records = await db.disciplinaryRecord.findMany({
    where: { employeeId: pip.employeeId },
    select: { warningLevel: true, issuedAt: true },
    orderBy: { issuedAt: "desc" },
  });
  const rank: Record<string, number> = { Verbal: 1, Written: 2, Final: 3 };
  let highest: string | null = null;
  for (const r of records) {
    if (rank[r.warningLevel] != null && (highest == null || rank[r.warningLevel] > rank[highest])) highest = r.warningLevel;
  }
  let suggestedNextLevel: string;
  if (highest == null) suggestedNextLevel = "Verbal";
  else if (rank[highest] >= 3) suggestedNextLevel = "Final";
  else suggestedNextLevel = rank[highest] === 1 ? "Written" : "Final";
  return {
    ok: true,
    suggestion: {
      existingSpCount: records.length,
      lastWarningLevel: highest,
      suggestedNextLevel,
      note: highest == null
        ? "Belum ada riwayat SP — saran: mulai SP Verbal (SP1) via modul HR Base; PA Termination (PHK) bila diputuskan, juga manual via HR Base — bukti PIP + SP menjadi rantai pertahanan §7."
        : `Riwayat ${records.length} SP (tertinggi: ${highest}) — saran lanjutan: ${suggestedNextLevel} via modul HR Base. Modul ini TIDAK otomatis membuat SP/PHK — PA Termination digulirkan manual via HR Base bila diputuskan (rantai pertahanan §7).`,
    },
  };
}

// ============ CANCEL ============

export async function cancelPip(
  db: TenantDb,
  input: { id: string; reason: string; actor: string },
): Promise<{ ok: true }> {
  const pip = await db.pipPlan.findUnique({ where: { id: input.id } });
  if (!pip) bad("PIP tidak ditemukan");
  if (pipTerminal(pip.status)) bad(`PIP sudah berstatus terminal ${pip.status} — tidak bisa dibatalkan`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan pembatalan wajib ≥10 karakter (ter-audit)");
  // chain berjalan dihentikan tanpa keputusan (race-safe — pola modul lain)
  await cancelApprovalChain(db, "PipPlan", pip.id, input.actor);
  await db.pipPlan.update({
    where: { id: pip.id },
    data: { status: "Cancelled", outcomeNotes: reason },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PipPlan", entityId: pip.id, employeeId: pip.employeeId,
      detail: `PIP ${pip.docNo} DIBATALKAN oleh ${input.actor} — “${reason}”`,
    },
  });
  return { ok: true };
}

// ============ SCHEDULER JOB (P6 — §33-3 pengingat checkpoint; §33-4 tenggat) ============

/** Checkpoint PIP Pending jatuh tempo ≤3 hari (dan belum lewat >1 hari) →
 * ingatkan pembina; PIP Active/Extended lewat endDate+7 tanpa outcome →
 * ingatkan HR. Dedupe ActivityLog Reminder (pola claimPerfReminder). */
export async function jobPerfPipReminders(db: TenantDb): Promise<{ reminded: number; notified: number }> {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const in3 = addDays(today, 3);
  const yesterday = addDays(today, -1);
  let reminded = 0;
  let notified = 0;

  // (a) checkpoint ≤3 hari menjelang jatuh tempo
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
    const key = `perf-pip-cp:${cp.id}:${cp.dueDate.toISOString().slice(0, 10)}`;
    const claimed = await claimPipReminder(db, key, `Checkpoint PIP ${cp.pip.docNo} tahap ${cp.seq} jatuh tempo ${cp.dueDate.toISOString().slice(0, 10)}`);
    if (!claimed) continue;
    reminded++;
    const users = await db.appUser.findMany({ where: { employeeId: cp.pip.reviewerId, active: true }, select: { id: true }, take: 3 });
    for (const u of users) {
      await db.notification.create({
        data: {
          appUserId: u.id,
          title: `Checkpoint PIP ${cp.pip.docNo} jatuh tempo ${cp.dueDate.toLocaleDateString("id-ID")}`,
          body: `Checkpoint ${cp.seq} program perbaikan kinerja ${cp.pip.employee.fullName} jatuh tempo ${cp.dueDate.toLocaleDateString("id-ID")} — catat capaian (achievement %) sekarang. Buka menu Performance → PIP.`,
          kind: "performance",
          link: "performance:pip",
        },
      }).catch(() => null);
      notified++;
    }
  }

  // (b) PIP lewat endDate +7 hari tanpa outcome → eskalasi HR
  const overdue = await db.pipPlan.findMany({
    where: {
      status: { in: ["Active", "Extended"] },
      endDate: { lt: addDays(today, -7) },
    },
    include: { employee: { select: { fullName: true } } },
    take: 100,
  });
  for (const p of overdue) {
    const key = `perf-pip-over:${p.id}`;
    const claimed = await claimPipReminder(db, key, `PIP ${p.docNo} lewat tenggat ${p.endDate.toISOString().slice(0, 10)} tanpa outcome`);
    if (!claimed) continue;
    reminded++;
    const hrUsers = await db.appUser.findMany({ where: { role: { in: ["HR Manager", "HR Staff", "Admin"] }, active: true }, select: { id: true }, take: 10 });
    for (const u of hrUsers) {
      await db.notification.create({
        data: {
          appUserId: u.id,
          title: `PIP ${p.docNo} lewat tenggat +7 hari — putuskan outcome`,
          body: `Program perbaikan kinerja ${p.employee.fullName} berakhir ${p.endDate.toLocaleDateString("id-ID")} tanpa keputusan outcome (Recovered/NotRecovered). Buka menu Performance → PIP.`,
          kind: "performance",
          link: "performance:pip",
        },
      }).catch(() => null);
      notified++;
    }
  }
  return { reminded, notified };
}

/** Klaim pengingat sekali-jalan (pola claimPerfReminder checkin-service —
 * domain entity terpisah PipPlan supaya tidak bertabrakan dgn check-in). */
async function claimPipReminder(db: TenantDb, key: string, detail: string): Promise<boolean> {
  try {
    const n = await db.$executeRaw`
      INSERT INTO "ActivityLog" ("id","actorType","action","entity","entityId","employeeId","personnelActionId","detail","createdAt")
      SELECT gen_random_uuid()::text, 'system', 'Reminder', 'PipPlan', ${key}, NULL, NULL, ${detail}, now()
      ON CONFLICT ("action","entity","entityId") WHERE "entityId" IS NOT NULL AND "action" = 'Reminder'
      DO NOTHING`;
    return n === 1;
  } catch {
    return false;
  }
}
