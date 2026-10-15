import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { pushNotification } from "@/rekankerja/shared/services/notification-service";
import { scanBias, serializeFlags, type BiasFlag } from "@/rekankerja/performance/services/bias-lexicon";

// ============================================================================
// PERFORMANCE — Service 360-degree feedback (P3 — DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P3, §3.6, Alur 5 §29-3, §37 PDP "anonimitas ≥3"):
//   • Undangan reviewer oleh atasan peserta/HR (hanya bila cycle.feedback360).
//   • Reviewer ESS mengisi kompetensi 1–5 + komentar → Submitted.
//   • ANONIMITAS: identitas reviewer TIDAK PERNAH dikirim ke agregasi tampilan
//     maupun ke konteks AI compose — hanya count + avg + komentar kolektif.
//   • Agregasi tampil hanya bila ≥3 reviewer Submitted PER KATEGORI (§37).
//   • Scheduler: undangan Invited lewat dueAt → Expired (job perf-360-expire).
// P9 — rate-limit submit 10/jam per reviewer (ActivityLog 1 jam terakhir —
// pola D20 ai-compose; karyawan ESS hanya bisa submit undangan miliknya).
// ============================================================================

const DAY_MS = 86_400_000;

/** Rate-limit P9 (§37 hardening): maks 10 submit 360 per reviewer per jam. */
const SUBMIT_360_RATE_LIMIT_PER_HOUR = 10;

export interface Actor360 {
  employeeId: string | null;
  superAdmin: boolean;
}

export const REVIEWER_TYPES = ["Peer", "Subordinate", "CrossTeam", "Upward"] as const;
export type ReviewerType = (typeof REVIEWER_TYPES)[number];

export interface InviteInput {
  employeeId: string;
  reviewerType: ReviewerType;
}

export interface InviteResult {
  invited: { employeeNo: string; fullName: string; reviewerType: string }[];
  skippedDuplicate: { employeeNo: string; fullName: string; reviewerType: string }[];
  skippedSelf: { employeeNo: string; fullName: string }[];
  skippedInactive: { employeeNo: string; fullName: string }[];
}

async function mustAppraisal360(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      cycle: { select: { id: true, code: true, status: true, feedback360: true } },
      employee: { select: { id: true, employeeNo: true, fullName: true } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  return a;
}

/** Undang reviewer (§29-3) — atasan peserta / HR; guard feedback360 aktif. */
export async function inviteReviewers(
  db: TenantDb, actor: Actor360, appraisalId: string, reviewers: InviteInput[], dueAt?: unknown,
): Promise<InviteResult> {
  const a = await mustAppraisal360(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat mengundang reviewer 360 (§29-3)");
  }
  if (!a.cycle.feedback360) {
    throw new Error("360 tidak aktif untuk siklus ini — aktifkan di pengaturan siklus (feedback360)");
  }
  if (a.cycle.status !== "Assessment") {
    throw new Error(`Undangan 360 hanya saat fase Assessment — siklus ${a.cycle.code} saat ini ${a.cycle.status}`);
  }
  if (!reviewers.length) throw new Error("Pilih minimal satu reviewer");
  let due: Date | null = null;
  if (dueAt != null && dueAt !== "") {
    due = dueAt instanceof Date ? dueAt : new Date(String(dueAt));
    if (Number.isNaN(due.getTime())) throw new Error("Tanggal tenggat tidak valid");
    due.setHours(23, 59, 0, 0);
  }

  const out: InviteResult = { invited: [], skippedDuplicate: [], skippedSelf: [], skippedInactive: [] };
  for (const r of reviewers) {
    if (!(REVIEWER_TYPES as readonly string[]).includes(r.reviewerType)) {
      throw new Error(`Tipe reviewer tidak valid: ${r.reviewerType} (Peer/Subordinate/CrossTeam/Upward)`);
    }
    const emp = await db.employee.findUnique({
      where: { id: r.employeeId },
      select: { id: true, employeeNo: true, fullName: true, status: true },
    });
    if (!emp || emp.status !== "Active") {
      out.skippedInactive.push({ employeeNo: r.employeeId, fullName: emp?.fullName ?? "—" });
      continue;
    }
    if (emp.id === a.employeeId) {
      // reviewer tidak boleh = karyawan peserta sendiri
      out.skippedSelf.push({ employeeNo: emp.employeeNo, fullName: emp.fullName });
      continue;
    }
    const dup = await db.feedback360.findUnique({
      where: { appraisalId_reviewerId_reviewerType: { appraisalId, reviewerId: emp.id, reviewerType: r.reviewerType } },
    });
    if (dup) {
      out.skippedDuplicate.push({ employeeNo: emp.employeeNo, fullName: emp.fullName, reviewerType: r.reviewerType });
      continue;
    }
    await db.feedback360.create({
      data: { appraisalId, reviewerId: emp.id, reviewerType: r.reviewerType, status: "Invited", dueAt: due },
    });
    out.invited.push({ employeeNo: emp.employeeNo, fullName: emp.fullName, reviewerType: r.reviewerType });
    // notifikasi in-app reviewer dengan deep-link ESS "360 Saya"
    const u = await db.appUser.findFirst({ where: { employeeId: emp.id }, select: { id: true } });
    if (u) {
      await pushNotification(db, {
        appUserId: u.id,
        title: `Undangan penilaian 360 — ${a.employee.fullName} (${a.cycle.code})`,
        body: `Anda diundang memberi umpan balik 360 untuk ${a.employee.fullName} periode ${a.cycle.code}. Isi identitas Anda dirahasiakan (agregat ≥3 reviewer).${due ? ` Tenggat: ${due.toISOString().slice(0, 10)}.` : ""}`,
        kind: "performance",
        link: "ess:my-360",
      });
    }
  }
  return out;
}

/** Daftar undangan milik reviewer (ESS "360 Saya") — yang aktif + sudah submit. */
export async function myInvitations(db: TenantDb, employeeId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.feedback360.findMany({
    where: { reviewerId: employeeId },
    include: {
      appraisal: {
        select: {
          id: true, docNo: true,
          employee: { select: { employeeNo: true, fullName: true } },
          cycle: { select: { code: true, status: true } },
          comps: { include: { competency: { select: { id: true, code: true, name: true, kind: true, levelsJson: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const now = Date.now();
  return rows.map((r) => {
    const overdue = r.status === "Invited" && r.dueAt != null && r.dueAt.getTime() < now;
    return {
      feedbackId: r.id,
      status: overdue && r.status === "Invited" ? "Expired" : r.status, // tampilan lewat-tenggat sinkron scheduler
      reviewerType: r.reviewerType,
      dueAt: r.dueAt?.toISOString().slice(0, 10) ?? null,
      submittedAt: r.submittedAt?.toISOString().slice(0, 10) ?? null,
      employeeNo: r.appraisal.employee.employeeNo,
      fullName: r.appraisal.employee.fullName,
      docNo: r.appraisal.docNo,
      cycleCode: r.appraisal.cycle.code,
      appraisalId: r.appraisal.id,
      comps: r.appraisal.comps.map((c) => {
        let levels: { level: number; label: string; descriptor: string }[] = [];
        try { levels = JSON.parse(c.competency.levelsJson) ?? []; } catch { /* rusak */ }
        return { competencyId: c.competencyId, code: c.competency.code, name: c.competency.name, kind: c.competency.kind, levels };
      }),
    };
  });
}

/** Reviewer menolak undangannya sendiri. */
export async function declineInvitation(db: TenantDb, employeeId: string, feedbackId: string): Promise<void> {
  const fb = await db.feedback360.findUnique({ where: { id: feedbackId } });
  if (!fb) throw new Error("Undangan tidak ditemukan");
  if (fb.reviewerId !== employeeId) throw new Error("Hanya reviewer undangan ini yang dapat menolak");
  if (fb.status !== "Invited") throw new Error(`Undangan sudah berstatus ${fb.status}`);
  await db.feedback360.update({ where: { id: feedbackId }, data: { status: "Declined" } });
}

/** Hitung submit 360 reviewer dalam 1 jam terakhir (pola ai-compose D20 —
 *  ActivityLog ditulis oleh pemanggil ESS tepat setelah submit sukses, jadi
 *  jumlah ini mencerminkan seluruh submit nyata reviewer tsb). */
async function recent360SubmitCount(db: TenantDb, reviewerEmployeeId: string): Promise<number> {
  const since = new Date(Date.now() - 3600 * 1000);
  return db.activityLog.count({
    where: {
      action: "Submitted", entity: "Feedback360", employeeId: reviewerEmployeeId,
      createdAt: { gte: since },
    },
  });
}

export interface Answer360Input {
  competencyId: string;
  score: number;
  comment?: string;
  aiAssisted?: boolean;
}

/** Submit isian 360 (§29-3) — reviewer sendiri; undangan Invited & belum lewat dueAt.
 *  ANONIMITAS: identitas reviewer tidak pernah keluar dari baris ini (hanya
 *  dibaca agregasi aggregate360).
 *  B2-BL (D-BL7): SETIAP comment di-scan bias lexicon deterministik —
 *  ter-flag → disimpan dgn flaggedJson + moderated="Pending" (masuk antrean
 *  moderasi HR); bersih → "Approved". respons menambah biasWarnings ADVISORI
 *  (submit TETAP berhasil — tidak pernah memblokir). */
export async function submit360(
  db: TenantDb, employeeId: string, feedbackId: string, answers: Answer360Input[],
): Promise<{ answered: number; biasWarnings?: BiasFlag[] }> {
  const fb = await db.feedback360.findUnique({
    where: { id: feedbackId },
    include: {
      appraisal: {
        select: {
          id: true, status: true,
          cycle: { select: { status: true, code: true } },
          comps: { select: { competencyId: true } },
        },
      },
    },
  });
  if (!fb) throw new Error("Undangan tidak ditemukan");
  if (fb.reviewerId !== employeeId) throw new Error("Hanya reviewer undangan ini yang dapat mengisi");
  if (fb.status !== "Invited") throw new Error(`Undangan sudah berstatus ${fb.status}`);
  if (fb.dueAt && fb.dueAt.getTime() < Date.now()) throw new Error("Undangan sudah lewat tenggat — status Expired");
  if (fb.appraisal.cycle.status !== "Assessment") {
    throw new Error(`Isian 360 hanya saat fase Assessment — siklus ${fb.appraisal.cycle.code} saat ini ${fb.appraisal.cycle.status}`);
  }
  // P9-PERF — rate-limit 10 submit/jam per reviewer (pola D20 ai-compose;
  // ActivityLog submit ESS mencatat employeeId reviewer → hitung 1 jam terakhir)
  const used = await recent360SubmitCount(db, employeeId);
  if (used >= SUBMIT_360_RATE_LIMIT_PER_HOUR) {
    throw new Error("Batas 10 submit 360 per jam tercapai — coba lagi nanti");
  }

  const validIds = new Set(fb.appraisal.comps.map((c) => c.competencyId));
  const seen = new Set<string>();
  const clean: Answer360Input[] = [];
  for (const x of answers) {
    if (!validIds.has(x.competencyId)) throw new Error("Kompetensi tidak termasuk penilaian peserta ini");
    if (seen.has(x.competencyId)) throw new Error("Duplikat jawaban untuk satu kompetensi yang sama");
    seen.add(x.competencyId);
    const s = Math.round(Number(x.score));
    if (!Number.isInteger(s) || s < 1 || s > 5) throw new Error("Skor kompetensi harus bilangan bulat 1–5");
    clean.push({ competencyId: x.competencyId, score: s, comment: x.comment?.trim() || undefined, aiAssisted: x.aiAssisted === true });
  }
  if (clean.length !== validIds.size) {
    throw new Error(`Semua kompetensi wajib dinilai (${clean.length}/${validIds.size} terisi)`);
  }

  await db.feedback360Answer.deleteMany({ where: { feedbackId } }); // re-entry aman sebelum Submitted
  const biasWarnings: BiasFlag[] = [];
  const warnSeen = new Set<string>();
  for (const x of clean) {
    // B2-BL (D-BL7) — scan NON-BLOKIR: advisori utk penulis + antrean HR
    const flags = scanBias(x.comment ?? "");
    for (const f of flags) {
      if (!warnSeen.has(f.phrase)) { warnSeen.add(f.phrase); biasWarnings.push(f); }
    }
    await db.feedback360Answer.create({
      data: {
        feedbackId, competencyId: x.competencyId, score: x.score, comment: x.comment ?? null, aiAssisted: x.aiAssisted === true,
        flaggedJson: serializeFlags(flags),
        moderated: flags.length ? "Pending" : "Approved",
      },
    });
  }
  await db.feedback360.update({ where: { id: feedbackId }, data: { status: "Submitted", submittedAt: new Date() } });
  return { answered: clean.length, ...(biasWarnings.length ? { biasWarnings } : {}) };
}

/** String pengganti komentar ter-Redaksi HR — jangan bocorkan isi (D-BL7b).
 *  UI mengenali marker ini & menerjemahkan via t() dwibahasa. */
export const REDACTED_360_COMMENT = "[dikensorkan oleh HR — potensi bias]";

/** Agregasi per kompetensi — avg + count; komentar TIDAK dikirim bila kategori
 *  <3 reviewer (§37 "anonimitas ≥3"). Dipakai appraisalDetail & hasil ESS.
 *  B2-BL (D-BL7b): komentar moderated="Pending" DIKECUALIKAN dari agregat
 *  (sampai HR memutuskan); "Redacted" tampil sebagai string sensor tetap;
 *  NULL/Approved tampil normal. Identitas reviewer TETAP tidak pernah muncul. */
export async function aggregate360(db: TenantDb, appraisalId: string): Promise<{
  perCompetency: {
    competencyId: string; name: string; kind: string;
    avg: number | null; count: number; comments: string[] | null;
  }[];
  reviewers: { total: number; submitted: number; invited: number; declined: number; expired: number };
  hidden: string | null;
}> {
  const fbs = await db.feedback360.findMany({ where: { appraisalId } });
  const submitted = fbs.filter((f) => f.status === "Submitted");
  const answers = submitted.length
    ? await db.feedback360Answer.findMany({
        where: { feedbackId: { in: submitted.map((f) => f.id) } },
        include: { competency: { select: { id: true, name: true, kind: true, code: true } } },
      })
    : [];
  const byComp = new Map<string, { name: string; kind: string; scores: number[]; comments: string[] }>();
  for (const x of answers) {
    if (!byComp.has(x.competencyId)) byComp.set(x.competencyId, { name: x.competency.name, kind: x.competency.kind, scores: [], comments: [] });
    const g = byComp.get(x.competencyId)!;
    g.scores.push(x.score); // skor tetap dihitung — moderasi hanya komentar
    if (x.moderated === "Pending") continue; // dikecualikan sampai HR memutuskan
    if (x.moderated === "Redacted") { g.comments.push(REDACTED_360_COMMENT); continue; }
    if (x.comment) g.comments.push(x.comment); // NULL/Approved → normal
  }
  const enough = submitted.length >= 3;
  const perCompetency = [...byComp.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([competencyId, g]) => ({
      competencyId,
      name: g.name,
      kind: g.kind,
      avg: g.scores.length ? Math.round((g.scores.reduce((s, v) => s + v, 0) / g.scores.length) * 10) / 10 : null,
      count: g.scores.length,
      // komentar hanya utk agregat ≥3 reviewer (anonimitas §37)
      comments: enough ? g.comments : null,
    }));
  return {
    perCompetency,
    reviewers: {
      total: fbs.length,
      submitted: submitted.length,
      invited: fbs.filter((f) => f.status === "Invited").length,
      declined: fbs.filter((f) => f.status === "Declined").length,
      expired: fbs.filter((f) => f.status === "Expired").length,
    },
    hidden: enough ? null : "kurang dari 3 reviewer, dirahasiakan",
  };
}

/** Daftar undangan per siklus (admin — kelola dari halaman penilaian). */
export async function listInvitations(db: TenantDb, cycleId: string): Promise<Record<string, unknown>[]> {
  const rows = await db.feedback360.findMany({
    where: { appraisal: { cycleId } },
    include: {
      reviewer: { select: { employeeNo: true, fullName: true } },
      appraisal: {
        select: {
          docNo: true,
          employee: { select: { employeeNo: true, fullName: true } },
          cycle: { select: { code: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    appraisalId: r.appraisalId,
    docNo: r.appraisal.docNo,
    subjectNo: r.appraisal.employee.employeeNo,
    subjectName: r.appraisal.employee.fullName,
    reviewerNo: r.reviewer.employeeNo,
    reviewerName: r.reviewer.fullName,
    reviewerType: r.reviewerType,
    status: r.status === "Invited" && r.dueAt && r.dueAt.getTime() < now ? "Expired" : r.status,
    dueAt: r.dueAt?.toISOString().slice(0, 10) ?? null,
    submittedAt: r.submittedAt?.toISOString().slice(0, 10) ?? null,
    cycleCode: r.appraisal.cycle.code,
  }));
}

/** Scheduler (§29-3): Invited lewat dueAt → Expired. Guard feedback360 di level
 *  pemanggil (cycle) — di sini polos per undangan. */
export async function expireOverdue(db: TenantDb): Promise<number> {
  const r = await db.feedback360.updateMany({
    where: { status: "Invited", dueAt: { lt: new Date() } },
    data: { status: "Expired" },
  });
  return r.count;
}

// ============================================================================
// B2-BL — ANTREAN MODERASI HR (D-BL7b/D-BL9): komentar 360 ter-flag
// (moderated="Pending") menunggu keputusan HR Setujui/Redaksi.
// ANONIMITAS TIDAK BOLEH BOCOR: daftar & log TANPA nama reviewer — hanya
// feedbackId, competencyId, comment, flaggedJson, docNo appraisal, submittedAt.
// ============================================================================

export interface FlaggedAnswerRow {
  id: string;
  feedbackId: string;
  competencyId: string;
  competencyName: string;
  comment: string | null;
  flagged: { category: string; phrase: string }[];
  appraisalDocNo: string;
  cycleCode: string;
  submittedAt: string | null;
}

/** Daftar komentar ter-flag menunggu keputusan HR (opsional per siklus).
 *  HR-only — dijaga pemanggil (route) via actor.superAdmin.
 *  (Feedback360Answer tak punya kolom waktu — urut via feedback.submittedAt.) */
export async function listFlaggedAnswers(db: TenantDb, cycleId?: string): Promise<FlaggedAnswerRow[]> {
  const rows = await db.feedback360Answer.findMany({
    where: {
      moderated: "Pending",
      ...(cycleId ? { feedback: { appraisal: { cycleId } } } : {}),
    },
    include: {
      competency: { select: { id: true, name: true } },
      feedback: {
        select: {
          id: true,
          submittedAt: true,
          appraisal: { select: { docNo: true, cycle: { select: { code: true } } } },
        },
      },
    },
    take: 200,
  });
  return rows
    .sort((a, b) => (b.feedback.submittedAt?.getTime() ?? 0) - (a.feedback.submittedAt?.getTime() ?? 0))
    .map((x) => ({
      id: x.id,
      feedbackId: x.feedbackId,
      competencyId: x.competencyId,
      competencyName: x.competency.name,
      comment: x.comment,
      flagged: (() => {
        try { return JSON.parse(x.flaggedJson ?? "[]") as { category: string; phrase: string }[]; }
        catch { return []; }
      })(),
      appraisalDocNo: x.feedback.appraisal.docNo,
      cycleCode: x.feedback.appraisal.cycle.code,
      submittedAt: x.feedback.submittedAt?.toISOString() ?? null,
    }));
}

/** Keputusan HR atas komentar ter-flag (D-BL7b): Approved → tampil normal di
 *  agregat; Redacted → tampil string sensor (isi tidak dibocorkan).
 *  HR-only (actor.superAdmin). ActivityLog "Moderate360" — TANPA nama reviewer. */
export async function moderateAnswer(
  db: TenantDb, actor: Actor360, answerId: string, decision: "Approved" | "Redacted",
): Promise<{ id: string; moderated: string }> {
  if (!actor.superAdmin) {
    throw new Error("Moderasi komentar 360 hanya oleh HR (D-BL7b)");
  }
  if (decision !== "Approved" && decision !== "Redacted") {
    throw new Error("Keputusan moderasi harus Approved atau Redacted");
  }
  const ans = await db.feedback360Answer.findUnique({
    where: { id: answerId },
    include: {
      competency: { select: { name: true } },
      feedback: { select: { appraisal: { select: { docNo: true } } } },
    },
  });
  if (!ans) throw new Error("Komentar tidak ditemukan");
  if (ans.moderated !== "Pending") {
    throw new Error(`Komentar sudah dimoderasi (${ans.moderated}) — tidak dapat diubah lagi`);
  }
  await db.feedback360Answer.update({ where: { id: answerId }, data: { moderated: decision } });
  await db.activityLog.create({
    data: {
      action: "Moderate360",
      entity: "Feedback360Answer",
      entityId: answerId,
      detail: `Keputusan HR: ${decision}; peserta-penilaian=${ans.feedback.appraisal.docNo}; kompetensi=${ans.competency.name} (D-BL7b — identitas reviewer tidak dicatat)`,
    },
  }).catch(() => { /* best effort */ });
  return { id: answerId, moderated: decision };
}

// ============================================================================
// B2-BL — AI DEEP-SCAN OLEH HR (D-BL8 — opsional, advisori): penilaian
// konstruktif ya/tidak + saran penulisan ulang atas komentar Pending.
// ANONIMITAS: hanya TEKS komentar + kategori flag yang dikirim ke model —
// identitas reviewer TIDAK PERNAH dikirim (D-BL9). Rate-limit 20/jam/user via
// ActivityLog "AiBiasScan" (pola aiCompose D20). Kegagalan TENANG.
// ============================================================================

const AI_BIAS_SCAN_RATE_LIMIT = 20;

export interface AiBiasScanResult {
  scan: string | null;
  unavailable?: boolean;
  error?: string;
}

/** Deep-scan AI satu komentar Pending (HR). STATELESS — hasil tidak disimpan;
 *  murni advisori utk membantu keputusan Setujui/Redaksi. */
export async function aiBiasScan(
  db: TenantDb, actorKey: string, actorEmployeeId: string | null, answerId: string, lang: "id" | "en",
): Promise<AiBiasScanResult> {
  const since = new Date(Date.now() - 3600 * 1000);
  const used = await db.activityLog.count({
    where: { action: "AiBiasScan", employeeId: actorEmployeeId ?? actorKey, createdAt: { gte: since } },
  });
  if (used >= AI_BIAS_SCAN_RATE_LIMIT) {
    throw new Error("Batas 20 pindai AI per jam tercapai — coba lagi nanti (D-BL8)");
  }

  const ans = await db.feedback360Answer.findUnique({
    where: { id: answerId },
    include: { competency: { select: { name: true } } },
  });
  if (!ans) throw new Error("Komentar tidak ditemukan");
  if (!ans.comment?.trim()) throw new Error("Komentar kosong — tidak ada yang dapat dipindai");
  let flags: { category: string; phrase: string }[] = [];
  try { flags = JSON.parse(ans.flaggedJson ?? "[]"); } catch { /* rusak */ }

  // ActivityLog per panggilan — TANPA isi teks komentar (privasi D-BL9);
  // rate-limit via kolom employeeId (pola P9-360)
  await db.activityLog.create({
    data: {
      action: "AiBiasScan",
      entity: "Feedback360Answer",
      entityId: answerId,
      ...(actorEmployeeId ? { employeeId: actorEmployeeId } : {}),
      detail: `deep-scan advisori HR; kategori-lexicon=${flags.map((f) => f.category).join(",") || "-"}; lang=${lang} (D-BL8 — isi teks tidak dicatat)`,
    },
  }).catch(() => { /* rate-limit best-effort */ });

  const langLine = lang === "en" ? "Write the analysis in English." : "Tulis analisis dalam Bahasa Indonesia.";
  const system =
    "Anda peninjau bahasa umpan balik kinerja 360 di sistem HRIS. Tugas Anda SATU: menilai apakah komentar ini KONSTRUKTIF (berbasis perilaku, spesifik, dapat ditindaklanjuti) atau TIDAK, lalu menyarankan penulisan ulang. " +
    "ATURAN KERAS: (1) JANGAN menambah fakta/angka/asumsi baru tentang orang yang dinilai; " +
    "(2) JANGAN menilai kinerja orang — nilai hanya KUALITAS BAHASA komentar; " +
    "(3) tetap SARA-safe; (4) format keluaran: baris 'Konstruktif: ya/tidak' singkat, alasan 1-2 kalimat, lalu 'Saran penulisan ulang:' satu paragraf netral berbasis perilaku. " +
    "Ini advisori untuk HR — keputusan akhir tetap milik HR.";
  const user =
    `${langLine}\n\n` +
    `Konteks: komentar reviewer 360 (anonim) untuk kompetensi "${ans.competency.name}".\n` +
    `Frasa ter-flag lexicon: ${flags.map((f) => `${f.category}: "…${f.phrase}…"`).join("; ") || "(tidak ada)"}\n\n` +
    `Teks komentar:\n"""${ans.comment.slice(0, 2000)}"""\n\n` +
    `Analisis.`;

  try {
    const { createZaiClient } = await import("@/rekankerja/shared/services/zai-client");
    const zai = await createZaiClient();
    const res = await zai.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    });
    const scan = res.choices?.[0]?.message?.content?.trim() ?? "";
    if (!scan) return { scan: null, unavailable: true, error: "AI mengembalikan hasil kosong — coba lagi nanti" };
    return { scan: scan.slice(0, 2000), unavailable: false };
  } catch (e) {
    // KEGAGALAN TENANG — advisori saja
    return {
      scan: null,
      unavailable: true,
      error: `AI sedang tidak tersedia — coba lagi nanti (${e instanceof Error ? e.message.slice(0, 160) : "unknown"})`,
    };
  }
}

/** Pengingat reviewer (§B-7) — in-app saja (bukan nudge formal). */
export async function remindReviewer(db: TenantDb, actor: Actor360, feedbackId: string): Promise<{ notified: boolean }> {
  const fb = await db.feedback360.findUnique({
    where: { id: feedbackId },
    include: {
      reviewer: { select: { id: true, fullName: true } },
      appraisal: {
        select: {
          employee: { select: { fullName: true } },
          manager: { select: { id: true } },
          cycle: { select: { code: true } },
        },
      },
    },
  });
  if (!fb) throw new Error("Undangan tidak ditemukan");
  if (!actor.superAdmin && actor.employeeId && fb.appraisal.manager?.id !== actor.employeeId) {
    throw new Error("Hanya atasan peserta atau HR yang dapat mengingatkan reviewer");
  }
  if (fb.status !== "Invited") throw new Error(`Undangan sudah berstatus ${fb.status}`);
  const u = await db.appUser.findFirst({ where: { employeeId: fb.reviewer.id }, select: { id: true } });
  if (!u) return { notified: false };
  const nid = await pushNotification(db, {
    appUserId: u.id,
    title: `Pengingat 360 — ${fb.appraisal.employee.fullName} (${fb.appraisal.cycle.code})`,
    body: `Mohon meluangkan waktu mengisi umpan balik 360 untuk ${fb.appraisal.employee.fullName}. Identitas Anda tetap dirahasiakan.${fb.dueAt ? ` Tenggat: ${fb.dueAt.toISOString().slice(0, 10)}.` : ""}`,
    kind: "performance",
    link: "ess:my-360",
  });
  return { notified: nid != null };
}
