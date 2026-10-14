// P7-PERF — evaluasi masa percobaan (DEVELOPMENT-PLAN-PERFORMANCE.md §28 alur 4;
// §7.1 UU 13/2003 Pasal 60): ProbationEvaluation otomatis dari onboarding rekrutmen
// (D9 — dueDate = joinDate + 90 hari, maks 3 bulan §7.1) atau manual HR; atasan
// menilai (skor 0–100 + kriteria bobot 3–6 item Σ100) → HR merekomendasikan 3 arah
// (Confirm / Extend / Terminate — Extend = PERJANJIAN KERJA BARU, bukan
// "perpanjangan percobaan" yang tidak dikenal UU) → approval AS-PROB-STD (L1
// atasan → L2 HR; L3 Direktur aktif HANYA utk Terminate via amount-as-flag — pola
// AS-PERF-STD P4) → keputusan → PA ChangeStatus (PKWTT) / ExtendProbation
// (perjanjian baru) / Termination + surat PROB_RESULT / PROB_EXTEND (idempoten
// metaJson.probDocNo — pola SK PIP P6). Scheduler: H-14 & H-3 → ingatkan atasan
// + HR; lewat jatuh tempo tanpa keputusan → eskalasi mingguan HR + direktur
// (dedupe ActivityLog Reminder entity Scheduler — pola claimReminder PIP).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  startApprovalChain, decideApprovalChain, cancelApprovalChain, attachChainSummaries,
  type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { issueLetter, fmtDateIdLong } from "@/rekankerja/shared/services/letter-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

function bad(msg: string): never { throw new Error(msg); }

/** docType approval keputusan percobaan (didaftar di APPROVAL_DOC_TYPES engine). */
export const PROB_DOC_TYPE = "ProbationDecision";
/** kode struktur approval default keputusan percobaan (§11.1). */
export const PROB_STRUCTURE_CODE = "AS-PROB-STD";
/** key template surat hasil percobaan / perjanjian baru. */
export const PROB_RESULT_KEY = "PROB_RESULT";
export const PROB_EXTEND_KEY = "PROB_EXTEND";

/** Masa percobaan maksimal 3 bulan — UU 13/2003 Pasal 60 (§7.1). */
export const PROBATION_MAX_DAYS = 90;

/** Status evaluasi yang masih berjalan (belum terminal — §34.5). */
function probOpen(s: string): boolean { return s === "Open" || s === "Assessed" || s === "Recommended"; }
/** Status terminal evaluasi percobaan (Decided/Cancelled). */
function probTerminal(s: string): boolean { return !probOpen(s); }

/** Rekomendasi yang dikenal (§28 alur 4 — 3 arah keputusan). */
const RECOMMENDATIONS = ["Confirm", "Extend", "Terminate"] as const;
type Recommendation = (typeof RECOMMENDATIONS)[number];

export interface ProbCriteria { title: string; weight: number }

function parseCriteria(json: string): ProbCriteria[] {
  try {
    const arr = JSON.parse(json) as ProbCriteria[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Validasi kriteria percobaan: 3–6 item, Σbobot = 100. */
function validateCriteria(criteria: ProbCriteria[]): ProbCriteria[] {
  if (!Array.isArray(criteria) || criteria.length < 3 || criteria.length > 6) {
    bad("Kriteria evaluasi percobaan harus 3–6 item");
  }
  const clean = criteria.map((c) => ({
    title: String(c.title ?? "").trim(),
    weight: Number(c.weight ?? 0),
  }));
  for (const c of clean) {
    if (c.title.length < 3) bad("Judul tiap kriteria wajib ≥3 karakter");
    if (!Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 100) bad("Bobot kriteria harus angka 1–100");
  }
  const sum = clean.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(sum - 100) > 0.01) bad(`Jumlah bobot kriteria harus 100 (sekarang ${Math.round(sum)})`);
  return clean;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}

/** Tenggat percobaan = tanggal masuk + 90 hari (maks 3 bulan — §7.1). */
function probationDueDate(joinDate: Date): Date {
  return addDays(joinDate, PROBATION_MAX_DAYS);
}

/** Kriteria default (auto-create dari onboarding & create manual). */
const DEFAULT_CRITERIA: ProbCriteria[] = [
  { title: "Penguasaan tugas & kualitas kerja", weight: 40 },
  { title: "Kepatuhan SOP & disiplin", weight: 30 },
  { title: "Kolaborasi & komunikasi tim", weight: 30 },
];

/** Label rekomendasi (dwibahasa di UI; ini utk surat & log — bahasa surat ID). */
export function recommendationLabelId(rec: string): string {
  if (rec === "Confirm") return "Dikonfirmasi sebagai karyawan tetap";
  if (rec === "Extend") return "Perjanjian baru — masa percobaan";
  if (rec === "Terminate") return "Pemutusan Hubungan Kerja dalam masa percobaan";
  return rec;
}

/** Teks peringatan hukum §7.1 — dipakai log, notifikasi & UI (sumber tunggal). */
export const PROB_EXTEND_LEGAL_NOTE =
  "PERINGATAN §7.1: \u201cperpanjangan masa percobaan\u201d TIDAK dikenal UU 13/2003 Pasal 60 — jalur yang benar adalah perjanjian kerja baru pengganti (PA ExtendProbation + surat perjanjian); penilaian percobaan ke-2 harus berdiri di atas perjanjian yang sah.";

// ============ STRUKTUR AS-PROB-STD + TEMPLATE SURAT (idempoten) ============

/** Pastikan struktur approval keputusan percobaan + template surat hasil &
 *  perjanjian baru ada (tenant baru via provisioning; tenant lama self-heal
 *  saat menu percobaan dibuka pertama kali). */
export async function ensureProbInfrastructure(db: TenantDb): Promise<void> {
  const existing = await db.approvalStructure.findUnique({ where: { code: PROB_STRUCTURE_CODE }, select: { id: true } });
  if (!existing) {
    // resolusi posisi "Direktur" (copy merit P5): prefer kode P-CEO → judul
    // ber-"director"/"direktur" pada positionLevel tertinggi → level tertinggi.
    let dirPosition = await db.position.findFirst({ where: { code: "P-CEO" }, select: { id: true, title: true } });
    if (!dirPosition) {
      dirPosition = await db.position.findFirst({
        where: { title: { contains: "director", mode: "insensitive" }, active: true },
        orderBy: { positionLevel: { sortOrder: "desc" } },
        select: { id: true, title: true },
      });
    }
    if (!dirPosition) {
      dirPosition = await db.position.findFirst({
        where: { active: true },
        orderBy: { positionLevel: { sortOrder: "desc" } },
        select: { id: true, title: true },
      });
    }
    await db.approvalStructure.create({
      data: {
        code: PROB_STRUCTURE_CODE,
        name: "Persetujuan Keputusan Masa Percobaan (default)",
        docType: PROB_DOC_TYPE,
        levels: {
          create: [
            { levelNo: 1, approverType: "ATASAN_LANGSUNG", note: "L1 — atasan langsung (rekomendasi penilai)" },
            { levelNo: 2, approverType: "HR_ADMIN", note: "L2 — HR verifikasi proses & kepatuhan §7.1" },
            // L3 aktif HANYA utk rekomendasi Terminate — amount = FLAG bukan
            // nominal (1 = Terminate, 2 = normal) — pola AS-PERF-STD (P4).
            ...(dirPosition
              ? [{ levelNo: 3, approverType: "POSISI", approverPositionId: dirPosition.id, minAmount: 1, maxAmount: 1, note: "L3 Direktur — hanya rekomendasi Terminate (PhK percobaan) §11.1" }]
              : [{ levelNo: 3, approverType: "HR_ADMIN", minAmount: 1, maxAmount: 1, note: "L3 (jabatan direktur belum dipetakan — Admin/HR memutuskan)" }]),
          ],
        },
      },
    }).catch(() => null); // race tenant bootstrap — struktur unik per code
  }
  for (const key of [PROB_RESULT_KEY, PROB_EXTEND_KEY]) {
    const tpl = await db.letterTemplate.findUnique({ where: { key }, select: { id: true } });
    if (!tpl) {
      // seed dari katalog bawaan (sumber tunggal — sama dgn provisioning tenant baru)
      const { LETTER_TEMPLATE_DEFAULTS } = await import("@/rekankerja/shared/lib/letter-defaults");
      const def = LETTER_TEMPLATE_DEFAULTS.find((d) => d.key === key);
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
}

// ============ PENOMORAN + CREATE ============

/** docNo PRB-{tahun}-{seq 4 digit} dgn guard tabrakan (pola PIP/MER). */
async function nextProbDocNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  let seq = await db.probationEvaluation.count({ where: { docNo: { startsWith: `PRB-${year}` } } });
  let docNo = "";
  for (let i = 0; i < 50; i++) {
    seq++;
    docNo = `PRB-${year}-${String(seq).padStart(4, "0")}`;
    const clash = await db.probationEvaluation.findUnique({ where: { docNo }, select: { id: true } });
    if (!clash) break;
  }
  return docNo;
}

/** Auto-create dari onboarding rekrutmen (D9 — dipanggil appointment-service
 *  `continueToOnboarding`; failure-safe di pemanggil). Idempoten per karyawan:
 *  bila sudah ada evaluasi terbuka → kembalikan yang ada (tidak dobel). */
export async function createProbationFromOnboarding(
  db: TenantDb,
  input: { employeeId: string; onboardingId: string; joinDate: Date; actor: string },
): Promise<{ id: string; docNo: string }> {
  const open = await db.probationEvaluation.findFirst({
    where: { employeeId: input.employeeId, status: { in: ["Open", "Assessed", "Recommended"] } },
    select: { id: true, docNo: true },
    orderBy: { createdAt: "desc" },
  });
  if (open) return { id: open.id, docNo: open.docNo };
  const docNo = await nextProbDocNo(db);
  const dueDate = probationDueDate(input.joinDate);
  const rec = await db.probationEvaluation.create({
    data: {
      docNo,
      employeeId: input.employeeId,
      onboardingId: input.onboardingId,
      dueDate,
      criteriaJson: JSON.stringify(DEFAULT_CRITERIA),
      status: "Open",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "ProbationEvaluation", entityId: rec.id, employeeId: input.employeeId,
      detail: `Evaluasi masa percobaan ${docNo} dibuat OTOMATIS dari onboarding (D9): kriteria 3 item Σbobot 100, jatuh tempo ${dueDate.toLocaleDateString("id-ID")} (joinDate + 90 hari — maks 3 bulan UU 13/2003 Ps.60 §7.1) — oleh ${input.actor}`,
    },
  }).catch(() => null);
  return { id: rec.id, docNo };
}

/** Create manual oleh HR (karyawan tanpa evaluasi terbuka; dueDate tetap
 *  dikunci maks joinDate + 3 bulan — §7.1 server guard). */
export async function createManualProbation(
  db: TenantDb,
  input: { employeeId: string; joinDate: string; criteria?: ProbCriteria[]; actor: string },
): Promise<{ id: string; docNo: string; dueDate: string }> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, status: true } });
  if (!emp) bad("Karyawan tidak ditemukan");
  if (emp.status !== "Active") bad(`Karyawan berstatus ${emp.status} — evaluasi percobaan hanya utk karyawan Active`);
  const open = await db.probationEvaluation.findFirst({
    where: { employeeId: input.employeeId, status: { in: ["Open", "Assessed", "Recommended"] } },
    select: { docNo: true },
  });
  if (open) bad(`${emp.fullName} masih punya evaluasi percobaan berjalan (${open.docNo}). Selesaikan dulu sebelum membuat yang baru.`);
  const join = new Date(input.joinDate);
  if (Number.isNaN(join.getTime())) bad("Tanggal masuk tidak valid");
  const dueDate = probationDueDate(join);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dueDate.getTime() < today.getTime() - 24 * 3600 * 1000) {
    bad(`Tanggal masuk terlalu lama — tenggat percobaan (${dueDate.toLocaleDateString("id-ID")}) sudah lewat. Evaluasi manual hanya utk karyawan yang tenggat 3 bulannya belum terlewat (§7.1).`);
  }
  const criteria = input.criteria ? validateCriteria(input.criteria) : DEFAULT_CRITERIA;
  const docNo = await nextProbDocNo(db);
  const rec = await db.probationEvaluation.create({
    data: {
      docNo,
      employeeId: input.employeeId,
      dueDate,
      criteriaJson: JSON.stringify(criteria),
      status: "Open",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "ProbationEvaluation", entityId: rec.id, employeeId: input.employeeId,
      detail: `Evaluasi masa percobaan ${docNo} dibuat MANUAL utk ${emp.fullName}: ${criteria.length} kriteria Σbobot 100, jatuh tempo ${dueDate.toLocaleDateString("id-ID")} (joinDate ${join.toLocaleDateString("id-ID")} + 3 bulan — §7.1) — oleh ${input.actor}`,
    },
  });
  return { id: rec.id, docNo, dueDate: dueDate.toISOString() };
}

// ============ DAFTAR + DETAIL ============

export interface ProbRow {
  id: string; docNo: string;
  employeeId: string; employeeName: string; employeeNo: string; unit: string | null; position: string | null;
  joinDate: string | null; onboardingId: string | null; onboardingStatus: string | null;
  dueDate: string; daysRemaining: number;
  criteria: ProbCriteria[]; managerScore: number | null; hrNote: string | null;
  recommendation: string | null; decisionDate: string | null; status: string;
  personnelActionId: string | null; personnelActionDocNo: string | null;
  letterRefNos: { key: string; refNo: string }[];
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

/** Bentuk record evaluasi + relasi employee yang dipakai rowsOf (include list & detail). */
interface ProbRecWithEmployee {
  id: string; docNo: string; employeeId: string; onboardingId: string | null;
  dueDate: Date; criteriaJson: string; managerScore: number | null; hrNote: string | null;
  recommendation: string | null; decisionDate: Date | null; personnelActionId: string | null;
  status: string;
  employee: { id: string; fullName: string; employeeNo: string; joinDate: Date | null; orgUnit: { name: string } | null; position: { title: string } | null };
}

/** Petakan record → ProbRow (dipakai list & detail — sumber tunggal). */
async function rowsOf(db: TenantDb, recs: ProbRecWithEmployee[]): Promise<ProbRow[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const chains = await attachChainSummaries(db, PROB_DOC_TYPE, recs.map((r) => ({ id: r.id })));

  // tanggal masuk: penempatan pertama (validFrom asc) → fallback Employee.joinDate
  const empIds = [...new Set(recs.map((r) => r.employeeId))];
  const firstAssign = new Map<string, Date>();
  if (empIds.length > 0) {
    const assigns = await db.employeeAssignment.findMany({
      where: { employeeId: { in: empIds } },
      select: { employeeId: true, validFrom: true },
      orderBy: { validFrom: "asc" },
      take: 1000,
    });
    for (const a of assigns) if (!firstAssign.has(a.employeeId)) firstAssign.set(a.employeeId, a.validFrom);
  }

  // status onboarding (link rekrutmen D9)
  const onbIds = [...new Set(recs.map((r) => r.onboardingId).filter((x): x is string => x != null))];
  const onbs = onbIds.length > 0
    ? await db.onboarding.findMany({ where: { id: { in: onbIds } }, select: { id: true, status: true } })
    : [];
  const onbBy = new Map(onbs.map((o) => [o.id, o.status]));

  // PA docNo (backlink)
  const paIds = [...new Set(recs.map((r) => r.personnelActionId).filter((x): x is string => x != null))];
  const pas = paIds.length > 0
    ? await db.personnelAction.findMany({ where: { id: { in: paIds } }, select: { id: true, docNo: true } })
    : [];
  const paBy = new Map(pas.map((p) => [p.id, p.docNo]));

  // surat hasil / perjanjian baru (idempoten metaJson.probDocNo — pola SK PIP P6)
  const letters = await db.letterDocument.findMany({
    where: { templateKey: { in: [PROB_RESULT_KEY, PROB_EXTEND_KEY] } },
    select: { templateKey: true, metaJson: true, refNo: true, issuedAt: true },
    orderBy: { issuedAt: "asc" },
  });
  const lettersBy = new Map<string, { key: string; refNo: string }[]>();
  for (const l of letters) {
    try {
      const m = JSON.parse(l.metaJson ?? "{}") as { probDocNo?: string };
      if (!m.probDocNo) continue;
      const list = lettersBy.get(m.probDocNo) ?? [];
      if (!list.some((x) => x.key === l.templateKey)) list.push({ key: l.templateKey, refNo: l.refNo });
      lettersBy.set(m.probDocNo, list);
    } catch { /* metaJson korup — biarkan */ }
  }

  return recs.map((r) => {
    const join = firstAssign.get(r.employeeId) ?? r.employee.joinDate ?? null;
    return {
      id: r.id, docNo: r.docNo,
      employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      unit: r.employee.orgUnit?.name ?? null, position: r.employee.position?.title ?? null,
      joinDate: join ? join.toISOString() : null,
      onboardingId: r.onboardingId, onboardingStatus: r.onboardingId ? onbBy.get(r.onboardingId) ?? null : null,
      dueDate: r.dueDate.toISOString(),
      daysRemaining: Math.round((r.dueDate.getTime() - today.getTime()) / (24 * 3600 * 1000)),
      criteria: parseCriteria(r.criteriaJson),
      managerScore: r.managerScore, hrNote: r.hrNote,
      recommendation: r.recommendation, decisionDate: r.decisionDate?.toISOString() ?? null,
      status: r.status,
      personnelActionId: r.personnelActionId,
      personnelActionDocNo: r.personnelActionId ? paBy.get(r.personnelActionId) ?? null : null,
      letterRefNos: lettersBy.get(r.docNo) ?? [],
      chain: chains.get(r.id) ?? null,
    };
  });
}

export async function listProbations(
  db: TenantDb,
  opts: { status?: string; dueSoon?: boolean; employeeId?: string },
): Promise<{ rows: ProbRow[] }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
    ...(opts.dueSoon ? { status: { in: ["Open", "Assessed", "Recommended"] }, dueDate: { lte: addDays(today, 14) } } : {}),
  };
  const recs = await db.probationEvaluation.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true, joinDate: true, orgUnit: { select: { name: true } }, position: { select: { title: true } } } },
    },
    orderBy: { docNo: "asc" },
    take: 300,
  });
  return { rows: await rowsOf(db, recs) };
}

/** Detail satu evaluasi (dialog UI) + jenjang approval lengkap. */
export async function probationDetail(db: TenantDb, id: string): Promise<{
  row: ProbRow;
  chainSteps: { levelNo: number; approverType: string; approverLabel: string; status: string; note: string | null; decidedBy: string | null; decidedAt: string | null }[] | null;
} | null> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true, joinDate: true, orgUnit: { select: { name: true } }, position: { select: { title: true } } } },
    },
  });
  if (!rec) return null;
  const [row] = await rowsOf(db, [rec]);
  let chainSteps: Awaited<ReturnType<typeof chainStepsOf>> = null;
  try { chainSteps = await chainStepsOf(db, id); } catch { chainSteps = null; }
  return { row, chainSteps };
}

/** Langkah chain lengkap utk detail (pola pipDetail P6). */
async function chainStepsOf(db: TenantDb, id: string) {
  const chain = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: PROB_DOC_TYPE, docId: id } },
    select: {
      status: true,
      steps: { orderBy: { levelNo: "asc" } },
    },
  });
  if (!chain) return null;
  return chain.steps.map((s) => ({
    levelNo: s.levelNo,
    approverType: s.approverType,
    approverLabel: s.approverLabel,
    status: s.status,
    note: s.note,
    decidedBy: s.decidedBy,
    decidedAt: s.decidedAt?.toISOString() ?? null,
  }));
}

/** Karyawan utk picker create manual — Active + tanpa evaluasi terbuka
 *  (bawa joinDate + status penempatan aktif utk form). */
export async function searchProbationEmployees(db: TenantDb, q?: string) {
  const recs = await db.employee.findMany({
    where: {
      status: "Active",
      ...(q ? { OR: [
        { employeeNo: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
      ] } : {}),
    },
    select: {
      id: true, employeeNo: true, fullName: true, joinDate: true,
      position: { select: { title: true } }, orgUnit: { select: { name: true } },
      assignments: { where: { validTo: null }, select: { employmentStatus: true }, orderBy: { validFrom: "desc" }, take: 1 },
    },
    orderBy: { employeeNo: "asc" },
    take: 30,
  });
  const openRows = await db.probationEvaluation.findMany({
    where: { status: { in: ["Open", "Assessed", "Recommended"] } },
    select: { employeeId: true },
  });
  const openSet = new Set(openRows.map((r) => r.employeeId));
  return {
    employees: recs
      .filter((e) => !openSet.has(e.id))
      .map((e) => ({
        id: e.id, employeeNo: e.employeeNo, fullName: e.fullName,
        position: e.position?.title ?? null, orgUnit: e.orgUnit?.name ?? null,
        joinDate: e.joinDate?.toISOString() ?? null,
        employmentStatus: e.assignments[0]?.employmentStatus ?? null,
      })),
  };
}

// ============ ASSESS (penilaian atasan — §28 alur 4 langkah 2) ============

export async function assessProbation(
  db: TenantDb,
  input: { id: string; criteria?: ProbCriteria[]; managerScore: number; note?: string; actor: string },
): Promise<{ ok: true }> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } } },
  });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (rec.status !== "Open" && rec.status !== "Assessed") {
    bad(`Penilaian hanya utk status Open/Assessed (status ${rec.status}${rec.status === "Recommended" ? " — sudah direkomendasikan" : ""})`);
  }
  const score = Number(input.managerScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) bad("Skor atasan harus angka 0–100");
  const criteria = input.criteria ? validateCriteria(input.criteria) : parseCriteria(rec.criteriaJson);
  const note = input.note?.trim() || null;
  await db.probationEvaluation.update({
    where: { id: rec.id },
    data: {
      criteriaJson: JSON.stringify(criteria),
      managerScore: score,
      status: "Assessed",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
      detail: `Penilaian atasan evaluasi percobaan ${rec.docNo} (${rec.employee.fullName}): skor ${score}/100 atas ${criteria.length} kriteria${note ? ` — “${note}”` : ""} oleh ${input.actor}`,
    },
  });
  // notifikasi HR: penilaian masuk, menunggu rekomendasi (pola notifyEvent admins)
  const r = await notifyEvent(db, {
    to: "admins", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo,
    title: `Penilaian percobaan ${rec.docNo} masuk (skor ${score})`,
    body: `Atasan telah menilai masa percobaan ${rec.employee.fullName} dgn skor ${score}/100 — menunggu rekomendasi HR (Confirm / Extend / Terminate). Jatuh tempo ${rec.dueDate.toLocaleDateString("id-ID")}.`,
    kind: "performance", link: "performance:probation",
  });
  void r;
  return { ok: true };
}

// ============ RECOMMEND (rekomendasi HR — §28 alur 4 langkah 3) ============

export async function recommendProbation(
  db: TenantDb,
  input: { id: string; recommendation: string; hrNote?: string; actor: string },
): Promise<{ ok: true }> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } } },
  });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (rec.status === "Open") {
    bad("Atasan harus menilai dulu (skor 0–100) sebelum HR merekomendasikan — buka aksi Nilai.");
  }
  const chain = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: PROB_DOC_TYPE, docId: rec.id } },
    select: { status: true },
  });
  if (chain?.status === "InProgress") bad("Keputusan sedang dalam persetujuan — tarik/batalkan dulu sebelum mengubah rekomendasi");
  if (rec.status !== "Assessed" && rec.status !== "Recommended") {
    bad(`Rekomendasi hanya utk status Assessed (status ${rec.status})`);
  }
  // status Recommended + chain mati (ditolak / belum diajukan) → rekomendasi
  // boleh disunting ulang lalu diajukan lagi (pola resubmit §32-2);
  const recommendation = input.recommendation as Recommendation;
  if (!RECOMMENDATIONS.includes(recommendation)) bad("Rekomendasi harus Confirm, Extend, atau Terminate");
  const note = input.hrNote?.trim() ?? "";
  if ((recommendation === "Extend" || recommendation === "Terminate") && note.length < 10) {
    bad(`Catatan HR wajib ≥10 karakter utk rekomendasi ${recommendation} (bobot hukum — ter-audit)`);
  }
  await db.probationEvaluation.update({
    where: { id: rec.id },
    data: { recommendation, hrNote: note || null, status: "Recommended" },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
      detail: `Rekomendasi HR evaluasi percobaan ${rec.docNo} (${rec.employee.fullName}): ${recommendationLabelId(recommendation)}${note ? ` — “${note}”` : ""} oleh ${input.actor}${recommendation === "Extend" ? ` — ${PROB_EXTEND_LEGAL_NOTE}` : ""}`,
    },
  });
  return { ok: true };
}

// ============ SUBMIT → APPROVAL (AS-PROB-STD; L3 Direktur hanya Terminate) ============

export async function submitDecision(
  db: TenantDb,
  input: { id: string; actor: string; actorId?: string | null },
): Promise<{ chainStatus: string }> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } } },
  });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (rec.status !== "Recommended" || !rec.recommendation) bad(`Hanya rekomendasi yang bisa diajukan (status ${rec.status})`);
  const existing = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: PROB_DOC_TYPE, docId: rec.id } },
    select: { id: true, status: true, currentLevel: true, totalLevels: true },
  });
  if (existing && existing.status === "InProgress") bad("Keputusan ini sudah dalam persetujuan");
  if (existing) {
    // pengajuan ulang pasca-ditolak (pola merit/PIP): chain lama terminal →
    // arsipkan jejaknya di ActivityLog lalu ganti chain baru (steps ikut cascade).
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "ApprovalChain", entityId: existing.id,
        detail: `Jalur persetujuan lama ${rec.docNo} (status ${existing.status}, jenjang ${existing.currentLevel}/${existing.totalLevels}) dihapus utk pengajuan ulang oleh ${input.actor}`,
      },
    });
    await db.approvalChain.delete({ where: { id: existing.id } });
  }
  await ensureProbInfrastructure(db);
  // amount = FLAG bukan nominal (pola AS-PERF-STD P4): 1 = Terminate →
  // L3 Direktur aktif (min/max=1); 2 = Confirm/Extend → L1→L2 saja.
  const amount = rec.recommendation === "Terminate" ? 1 : 2;
  const chain = await startApprovalChain(db, {
    docType: PROB_DOC_TYPE,
    docId: rec.id,
    employeeId: rec.employeeId,
    amount,
    createdBy: input.actor,
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
      detail: `Keputusan masa percobaan ${rec.docNo} (${rec.employee.fullName} — ${recommendationLabelId(rec.recommendation)}) diajukan — persetujuan AS-PROB-STD ${chain.totalLevels} jenjang (L1 atasan → L2 HR${rec.recommendation === "Terminate" ? " → L3 Direktur" : ""}) oleh ${input.actor}`,
    },
  });
  // notifikasi approver jenjang pertama (≈atasan langsung) + HR (pola notifyEvent)
  const r1 = await notifyEvent(db, {
    to: "nextApprover", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo,
    title: `Keputusan masa percobaan ${rec.docNo} menunggu persetujuan`,
    body: `Keputusan percobaan ${rec.employee.fullName} (${recommendationLabelId(rec.recommendation)}) menunggu keputusan (L1 atasan → L2 HR${rec.recommendation === "Terminate" ? " → L3 Direktur" : ""}).`,
    kind: "performance", link: "performance:probation",
  });
  const r2 = await notifyEvent(db, {
    to: "admins", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo,
    title: `Keputusan masa percobaan ${rec.docNo} menunggu persetujuan`,
    body: `Keputusan percobaan ${rec.employee.fullName} (${recommendationLabelId(rec.recommendation)}) menunggu keputusan (L1 atasan → L2 HR${rec.recommendation === "Terminate" ? " → L3 Direktur" : ""}).`,
    kind: "performance", link: "performance:probation",
  });
  void r1; void r2;
  return { chainStatus: chain.status };
}

export async function decideProbation(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject"; note?: string },
  actor: DecideActor,
): Promise<{ final: boolean; status: string; recommendation: string | null }> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id: input.id },
    include: { employee: { select: { fullName: true } } },
  });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (rec.status !== "Recommended") bad(`Keputusan hanya utk status Recommended (status ${rec.status})`);
  const res = await decideApprovalChain(db, {
    docType: PROB_DOC_TYPE, docId: input.id,
    action: input.action, note: input.note, actor,
  });
  if (res.final && input.action === "approve") {
    await db.probationEvaluation.update({
      where: { id: rec.id },
      data: { status: "Decided", decisionDate: new Date() },
    });
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
        detail: `Keputusan masa percobaan ${rec.docNo} (${rec.employee.fullName}) DISETUJUI PENUH: ${recommendationLabelId(rec.recommendation ?? "—")}${rec.managerScore != null ? ` (skor atasan ${rec.managerScore}/100)` : ""} — lanjut gulir PA + terbitkan surat`,
      },
    });
    return { final: true, status: "Decided", recommendation: rec.recommendation };
  }
  if (input.action === "reject") {
    // kembali ke Recommended — rekomendasi bisa disunting ulang lalu diajukan lagi
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
        detail: `Keputusan masa percobaan ${rec.docNo} DITOLAK di jenjang${input.note ? ` (“${input.note.trim()}”)` : ""} — rekomendasi dapat disunting dan diajukan ulang`,
      },
    });
    return { final: true, status: "Recommended", recommendation: rec.recommendation };
  }
  return { final: false, status: "Recommended", recommendation: rec.recommendation };
}

// ============ → PA (§28 langkah 4: ChangeStatus / ExtendProbation / Termination) ============

export async function toPersonnelAction(
  db: TenantDb,
  input: { id: string; type?: "ChangeStatus" | "ExtendProbation" | "Termination"; effectiveDate?: string; actor: string },
): Promise<{ personnelActionId: string; docNo: string; type: string }> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id: input.id },
    include: { employee: { select: { id: true, fullName: true, status: true } } },
  });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (rec.status !== "Decided") bad(`PA hanya dari keputusan final (status ${rec.status})`);
  if (rec.personnelActionId) bad("PA sudah digulirkan utk evaluasi ini");
  if (!rec.recommendation) bad("Keputusan tanpa rekomendasi — data tidak konsisten");
  const emp = rec.employee;
  if (emp.status !== "Active") bad(`Karyawan berstatus ${emp.status} — PA hanya utk karyawan Active`);

  const type = input.type ?? (
    rec.recommendation === "Confirm" ? "ChangeStatus"
      : rec.recommendation === "Extend" ? "ExtendProbation"
        : "Termination"
  );
  if (!["ChangeStatus", "ExtendProbation", "Termination"].includes(type)) {
    bad("Tipe PA harus ChangeStatus, ExtendProbation, atau Termination");
  }
  if (rec.recommendation === "Confirm" && type === "ExtendProbation") {
    bad("Keputusan Confirm → PA ChangeStatus (konversi PKWTT), bukan ExtendProbation");
  }

  // penempatan aktif (konteks PA + resolusi approver Dept Head)
  const assignment = await db.employeeAssignment.findFirst({
    where: { employeeId: rec.employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { baseSalary: true, positionId: true, orgUnitId: true, gradeId: true, employmentStatus: true, managerId: true },
  });

  // docNo PA-YYYY-NNNN max-suffix (pola merit P5)
  const last = await db.personnelAction.findFirst({ orderBy: { docNo: "desc" }, select: { docNo: true } });
  const nextNo = last ? Number(last.docNo.split("-").pop()) + 1 : 1;
  const docNo = `PA-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;

  // layers template AT-PA-STD + resolusi approver (Dept Head = atasan langsung)
  const template = await db.approvalTemplate.findFirst({ where: { code: "AT-PA-STD" } });
  const layersDef: { layer: number; role: string }[] = template ? JSON.parse(template.layersJson) : [{ layer: 1, role: "HR Manager" }];
  let managerApproverId: string | null = null;
  if (assignment?.managerId) {
    const mgrUser = await db.appUser.findFirst({ where: { employeeId: assignment.managerId, active: true }, select: { id: true } });
    managerApproverId = mgrUser?.id ?? null;
  }
  const otherRoles = [...new Set(layersDef.map((l) => l.role).filter((rr) => rr !== "Dept Head"))];
  const roleApprover: Record<string, string | null> = {};
  for (const rr of otherRoles) {
    const u = await db.appUser.findFirst({ where: { role: rr, active: true }, select: { id: true } });
    roleApprover[rr] = u?.id ?? null;
  }

  const scoreLabel = rec.managerScore != null ? `, skor percobaan ${rec.managerScore}/100` : "";
  const reasonByType: Record<string, string> = {
    ChangeStatus: `Konfirmasi lulus masa percobaan (evaluasi ${rec.docNo}${scoreLabel}) — konversi menjadi karyawan tetap (PKWTT)`,
    ExtendProbation: `Keputusan percobaan ${rec.docNo}${scoreLabel} — perjanjian kerja BARU pengganti (bukan perpanjangan percobaan — UU 13/2003 Ps.60)`,
    Termination: `PhK dalam masa percobaan — evaluasi ${rec.docNo}${scoreLabel}${rec.hrNote ? ` — catatan: ${rec.hrNote}` : ""}`,
  };
  const detailByType: Record<string, Record<string, unknown>> = {
    ChangeStatus: {
      fromStatus: assignment?.employmentStatus ?? "Probation",
      toStatus: "Permanent/PKWTT",
      probationDocNo: rec.docNo,
      probationManagerScore: rec.managerScore,
      note: "Lulus masa percobaan — dikonfirmasi sebagai karyawan tetap (PKWTT)",
    },
    ExtendProbation: {
      newAgreement: true,
      fromStatus: assignment?.employmentStatus ?? "Probation",
      toStatus: "Probation (perjanjian kerja baru)",
      probationDocNo: rec.docNo,
      probationNewEndDate: rec.dueDate.toISOString().slice(0, 10),
      legalNote: "Perjanjian kerja BARU pengganti — \u201cperpanjangan masa percobaan\u201d tidak dikenal UU 13/2003 Pasal 60; masa percobaan maksimal 3 bulan dihitung sejak perjanjian baru (§7.1)",
    },
    Termination: {
      probationDocNo: rec.docNo,
      probationManagerScore: rec.managerScore,
      lastDay: (input.effectiveDate ? new Date(input.effectiveDate) : new Date()).toISOString().slice(0, 10),
      note: "PhK dalam masa percobaan — jalur UU 13/2003 (persetujuan L3 Direktur ter-audit pada approval keputusan)",
    },
  };

  const pa = await db.personnelAction.create({
    data: {
      docNo, employeeId: rec.employeeId, type,
      effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : new Date(),
      reason: reasonByType[type],
      detailJson: JSON.stringify({
        ...detailByType[type],
        ...(assignment?.positionId ? { positionId: assignment.positionId } : {}),
        ...(assignment?.orgUnitId ? { orgUnitId: assignment.orgUnitId } : {}),
      }),
      status: "Prepared",
      createdBy: input.actor,
      layers: { create: layersDef.map((l) => ({
        layerNo: l.layer, approverRole: l.role,
        approverId: l.role === "Dept Head" ? managerApproverId : (roleApprover[l.role] ?? null),
        status: "Pending",
      })) },
    },
  });
  await db.probationEvaluation.update({ where: { id: rec.id }, data: { personnelActionId: pa.id } });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PersonnelAction", entityId: pa.id,
      employeeId: rec.employeeId, personnelActionId: pa.id,
      detail: `PA ${type} ${docNo} digulirkan dari keputusan percobaan ${rec.docNo} (${emp.fullName}) oleh ${input.actor}${type === "ExtendProbation" ? ` — ${PROB_EXTEND_LEGAL_NOTE}` : ""}`,
    },
  });
  const r = await notifyEvent(db, {
    to: "admins", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo,
    title: `PA ${type} ${docNo} dibuat dari keputusan percobaan ${rec.docNo}`,
    body: `${emp.fullName} — status Prepared, menunggu proses Personnel Action di modul HR Base.`,
    kind: "performance", link: "hr:all",
  });
  void r;
  return { personnelActionId: pa.id, docNo, type };
}

// ============ → SURAT (PROB_RESULT / PROB_EXTEND — idempoten metaJson.probDocNo) ============

/** Cek surat percobaan sudah terbit utk dokumen (idempoten via metaJson —
 *  pola findPipLetter P6). */
async function findProbLetter(db: TenantDb, templateKey: string, probDocNo: string): Promise<{ id: string; refNo: string } | null> {
  const doc = await db.letterDocument.findFirst({
    where: { templateKey, metaJson: { contains: `"probDocNo":"${probDocNo}"` } },
    select: { id: true, refNo: true },
    orderBy: { issuedAt: "desc" },
  });
  return doc ?? null;
}

/** Stempel meta idempoten probDocNo (pola ensureSkPip P6). */
async function stampProbMeta(db: TenantDb, letterId: string, probDocNo: string): Promise<void> {
  const existingMeta = await db.letterDocument.findUnique({ where: { id: letterId }, select: { metaJson: true } });
  try {
    const meta = existingMeta?.metaJson ? (JSON.parse(existingMeta.metaJson) as Record<string, unknown>) : {};
    await db.letterDocument.update({
      where: { id: letterId },
      data: { metaJson: JSON.stringify({ ...meta, probDocNo }) },
    });
  } catch { /* metaJson korup — biarkan */ }
}

export async function toLetter(
  db: TenantDb,
  input: { id: string; actorId?: string | null; actor: string },
): Promise<{ refNo: string; templateKey: string }> {
  const rec = await db.probationEvaluation.findUnique({
    where: { id: input.id },
    include: { employee: { select: { id: true, fullName: true, joinDate: true } } },
  });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (rec.status !== "Decided") bad(`Surat hanya dari keputusan final (status ${rec.status})`);
  if (!rec.recommendation) bad("Keputusan tanpa rekomendasi — data tidak konsisten");
  const recommendation = rec.recommendation;
  await ensureProbInfrastructure(db);

  // joinDate utk label perjanjian baru: penempatan pertama → Employee.joinDate
  const firstAssign = await db.employeeAssignment.findFirst({
    where: { employeeId: rec.employeeId },
    orderBy: { validFrom: "asc" },
    select: { validFrom: true },
  });
  const join = firstAssign?.validFrom ?? rec.employee.joinDate ?? rec.dueDate;

  if (recommendation === "Extend") {
    // idempoten: surat perjanjian baru satu per evaluasi
    const existing = await findProbLetter(db, PROB_EXTEND_KEY, rec.docNo);
    if (existing) return { refNo: existing.refNo, templateKey: PROB_EXTEND_KEY };
    // PERJANJIAN KERJA BARU — §7.1: "perpanjangan masa percobaan" tidak dikenal
    // UU 13/2003 Ps.60; akhir percobaan perjanjian baru = joinDate asli + 3 bulan.
    const letter = await issueLetter(db, {
      category: "Performance",
      templateKey: PROB_EXTEND_KEY,
      employeeId: rec.employeeId,
      actorId: input.actorId ?? null,
      extraCtx: {
        probation_doc_no: rec.docNo,
        probation_start_label: fmtDateIdLong(join),
        probation_new_end_date: fmtDateIdLong(probationDueDate(join)),
      },
    });
    await stampProbMeta(db, letter.id, rec.docNo);
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
        detail: `Surat perjanjian baru (percobaan ke-2) ${letter.refNo} terbit utk ${rec.docNo} oleh ${input.actor} — perjanjian kerja BARU pengganti, masa percobaan maks 3 bulan sejak perjanjian baru (§7.1)`,
      },
    });
    return { refNo: letter.refNo, templateKey: PROB_EXTEND_KEY };
  }
  // Confirm / Terminate → surat hasil evaluasi percobaan (idempoten per evaluasi)
  const existing = await findProbLetter(db, PROB_RESULT_KEY, rec.docNo);
  if (existing) return { refNo: existing.refNo, templateKey: PROB_RESULT_KEY };
  const letter = await issueLetter(db, {
    category: "Performance",
    templateKey: PROB_RESULT_KEY,
    employeeId: rec.employeeId,
    actorId: input.actorId ?? null,
    extraCtx: {
      probation_doc_no: rec.docNo,
      probation_due_date: fmtDateIdLong(rec.dueDate),
      probation_recommendation_label: recommendationLabelId(recommendation),
      probation_manager_score: rec.managerScore != null ? String(Math.round(rec.managerScore)) : "—",
    },
  });
  await stampProbMeta(db, letter.id, rec.docNo);
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
      detail: `Surat hasil evaluasi percobaan ${letter.refNo} terbit utk ${rec.docNo} (${recommendationLabelId(recommendation)}) oleh ${input.actor}`,
    },
  });
  return { refNo: letter.refNo, templateKey: PROB_RESULT_KEY };
}

// ============ CANCEL ============

export async function cancelProbation(
  db: TenantDb,
  input: { id: string; reason: string; actor: string },
): Promise<{ ok: true }> {
  const rec = await db.probationEvaluation.findUnique({ where: { id: input.id } });
  if (!rec) bad("Evaluasi percobaan tidak ditemukan");
  if (probTerminal(rec.status)) bad(`Evaluasi sudah berstatus terminal ${rec.status} — tidak bisa dibatalkan`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan pembatalan wajib ≥10 karakter (ter-audit)");
  // chain berjalan dihentikan tanpa keputusan (race-safe — pola modul lain)
  await cancelApprovalChain(db, PROB_DOC_TYPE, rec.id, input.actor);
  await db.probationEvaluation.update({
    where: { id: rec.id },
    data: { status: "Cancelled", hrNote: rec.hrNote ?? reason },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "ProbationEvaluation", entityId: rec.id, employeeId: rec.employeeId,
      detail: `Evaluasi masa percobaan ${rec.docNo} DIBATALKAN oleh ${input.actor} — “${reason}”`,
    },
  });
  return { ok: true };
}

// ============ SCHEDULER JOB (P7 — §28 guard H-14/H-3 + eskalasi lewat tempo) ============

/** Evaluasi aktif menjelang jatuh tempo → ingatkan atasan + HR (H-14 sekali,
 *  H-3 sekali); lewat jatuh tempo tanpa keputusan → eskalasi MINGGUAN ke HR +
 *  pemegang jabatan direktur (fallback admins). Dedupe ActivityLog Reminder
 *  entity 'Scheduler' (pola claimReminder PIP P6). */
export async function probationReminders(db: TenantDb): Promise<{ reminded: number; notified: number }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in14 = addDays(today, 14);
  let reminded = 0;
  let notified = 0;

  // (a) H-14 & H-3 — evaluasi aktif menjelang jatuh tempo → atasan + HR
  const upcoming = await db.probationEvaluation.findMany({
    where: {
      status: { in: ["Open", "Assessed", "Recommended"] },
      dueDate: { gte: today, lte: in14 },
    },
    include: { employee: { select: { fullName: true } } },
    take: 100,
  });
  for (const rec of upcoming) {
    const daysLeft = Math.round((rec.dueDate.getTime() - today.getTime()) / (24 * 3600 * 1000));
    // atasan langsung karyawan (penempatan aktif) + HR admins
    const mgrAssign = await db.employeeAssignment.findFirst({
      where: { employeeId: rec.employeeId, validTo: null, managerId: { not: null } },
      orderBy: { validFrom: "desc" },
      select: { managerId: true },
    });
    for (const [tag, withinDays] of [["h14", 14], ["h3", 3]] as const) {
      if (daysLeft > withinDays) continue;
      const key = `reminder:perf-prob:${rec.docNo}:${tag}`;
      const claimed = await claimReminder(db, key, `Evaluasi percobaan ${rec.docNo} jatuh tempo H-${daysLeft} (${tag})`);
      if (!claimed) continue;
      reminded++;
      if (mgrAssign?.managerId) {
        const r1 = await notifyEvent(db, {
          to: "employee", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo, employeeId: mgrAssign.managerId,
          title: `Evaluasi percobaan ${rec.docNo} jatuh tempo H-${daysLeft}`,
          body: `Masa percobaan ${rec.employee.fullName} berakhir ${rec.dueDate.toLocaleDateString("id-ID")} (status ${rec.status}${rec.managerScore != null ? `, skor atasan ${rec.managerScore}` : " — atasan belum menilai"}). Selesaikan penilaian → rekomendasi → keputusan.`,
          kind: "performance", link: "performance:probation",
        });
        notified += r1.recipients.length;
      }
      const r2 = await notifyEvent(db, {
        to: "admins", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo,
        title: `Evaluasi percobaan ${rec.docNo} jatuh tempo H-${daysLeft}`,
        body: `Masa percobaan ${rec.employee.fullName} berakhir ${rec.dueDate.toLocaleDateString("id-ID")} (status ${rec.status}). Selesaikan penilaian → rekomendasi → keputusan (§28).`,
        kind: "performance", link: "performance:probation",
      });
      notified += r2.recipients.length;
    }
  }

  // (b) lewat jatuh tempo tanpa keputusan → eskalasi mingguan (HR + direktur)
  const weekNo = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const overdue = await db.probationEvaluation.findMany({
    where: {
      status: { in: ["Open", "Assessed", "Recommended"] },
      dueDate: { lt: today },
    },
    include: { employee: { select: { fullName: true } } },
    take: 100,
  });
  if (overdue.length > 0) {
    // pemegang jabatan direktur (utk eskalasi — resolusi pola ensureProbInfrastructure)
    let directorEmployeeIds: string[] = [];
    try {
      let dirPosition = await db.position.findFirst({ where: { code: "P-CEO" }, select: { id: true } });
      if (!dirPosition) {
        dirPosition = await db.position.findFirst({
          where: { title: { contains: "director", mode: "insensitive" }, active: true },
          orderBy: { positionLevel: { sortOrder: "desc" } },
          select: { id: true },
        });
      }
      if (!dirPosition) {
        dirPosition = await db.position.findFirst({
          where: { active: true },
          orderBy: { positionLevel: { sortOrder: "desc" } },
          select: { id: true },
        });
      }
      if (dirPosition) {
        const holders = await db.employeeAssignment.findMany({
          where: { validTo: null, positionId: dirPosition.id },
          select: { employeeId: true },
          take: 10,
        });
        directorEmployeeIds = [...new Set(holders.map((h) => h.employeeId))];
      }
    } catch { /* fallback admins saja */ }
    for (const rec of overdue) {
      const key = `reminder:perf-prob:${rec.docNo}:over:w${weekNo}`;
      const daysOver = -Math.round((rec.dueDate.getTime() - today.getTime()) / (24 * 3600 * 1000));
      const claimed = await claimReminder(db, key, `Evaluasi percobaan ${rec.docNo} lewat jatuh tempo ${daysOver} hari tanpa keputusan — eskalasi minggu w${weekNo}`);
      if (!claimed) continue;
      reminded++;
      const body = `Masa percobaan ${rec.employee.fullName} berakhir ${rec.dueDate.toLocaleDateString("id-ID")} dan SUDAH LEWAT JATUH TEMPO ${daysOver} HARI TANPA KEPUTUSAN (status ${rec.status}) — eskalasi §28: keputusan Confirm/Extend (perjanjian kerja baru — UU 13/2003 Ps.60)/Terminate harus segera diputuskan.`;
      const r1 = await notifyEvent(db, {
        to: "admins", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo,
        title: `ESKALASI: percobaan ${rec.docNo} lewat jatuh tempo ${daysOver} hari`,
        body,
        kind: "performance", link: "performance:probation",
      });
      notified += r1.recipients.length;
      for (const dirId of directorEmployeeIds) {
        const r2 = await notifyEvent(db, {
          to: "employee", docType: PROB_DOC_TYPE, docId: rec.id, docNo: rec.docNo, employeeId: dirId,
          title: `ESKALASI: percobaan ${rec.docNo} lewat jatuh tempo ${daysOver} hari`,
          body,
          kind: "performance", link: "performance:probation",
        });
        notified += r2.recipients.length;
      }
    }
  }
  return { reminded, notified };
}

/** Klaim pengingat sekali-jalan per key (pola claimReminder PIP P6 — findFirst
 *  + create, dedupe ActivityLog action 'Reminder' entity 'Scheduler'). */
async function claimReminder(db: TenantDb, key: string, detail: string): Promise<boolean> {
  const claimed = await db.activityLog.findFirst({ where: { action: "Reminder", entity: "Scheduler", entityId: key } });
  if (claimed) return false;
  await db.activityLog.create({
    data: { actorType: "system", action: "Reminder", entity: "Scheduler", entityId: key, detail },
  }).catch(() => { /* best effort */ });
  return true;
}
