// P4-PERF — kalibrasi & finalisasi (DEVELOPMENT-PLAN-PERFORMANCE.md §30 alur 6–7;
// §18.10 bell curve AMANDEMEN 2): dashboard distribusi + histogram + overlay normal
// + z-flag pelis/royal D19 + central tendency, CalibrationSession/Decision ter-audit,
// finalisasi berjenjang via approval engine (docType PerformanceAppraisal,
// struktur AS-PERF-STD §11.1), publikasi + acknowledgement + banding D6 7 hari.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { startApprovalChain, decideApprovalChain, getApprovalChain, attachChainSummaries, type DecideActor } from "@/rekankerja/shared/services/approval-engine";
import { ratingOfScore } from "./perf-service";

function bad(msg: string): never { throw new Error(msg); }

/** Status appraisal yang sudah melewati fase penilaian atasan (punya skor). */
const SCORED = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];

// ============ DASHBOARD DISTRIBUSI + BELL CURVE (§18.10) ============

export interface BellCurveDashboard {
  metric: "manager" | "final";
  cycle: { id: string; code: string; status: string };
  n: number;
  mean: number | null;
  sigma: number | null;
  /** histogram — bin lebar 5 poin, urut; tiap bin bawa pesertanya (klik bin) */
  bins: { from: number; to: number; count: number; participants: { appraisalId: string; docNo: string; name: string; unit: string | null; managerName: string | null; score: number; rating: number | null }[] }[];
  /** overlay kurva normal — titik per 2.5 poin utk digambar klien (PDF(x)) */
  curve: { x: number; y: number }[];
  /** z-score per atasan (D19) — hanya atasan dgn ≥2 bawahan dinilai */
  managers: { managerId: string | null; managerName: string; teamSize: number; teamMean: number; teamSigma: number; z: number | null; flag: "red-pelis" | "amber-pelis" | "amber-royal" | "red-royal" | "central" | "ok" | null; flagLabelId: string; flagLabelEn: string }[];
  /** bar rating per unit — bahan forum diskusi */
  byUnit: { unit: string; counts: [number, number, number, number, number]; mean: number | null }[];
}

export async function calibrationDashboard(
  db: TenantDb,
  opts: { cycleId: string; metric?: "manager" | "final" },
): Promise<BellCurveDashboard> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: opts.cycleId }, select: { id: true, code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const metric = opts.metric === "final" ? "final" : "manager";
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: opts.cycleId, status: { in: SCORED } },
    include: {
      employee: { select: { fullName: true, orgUnit: { select: { name: true } } } },
      manager: { select: { id: true, fullName: true } },
    },
    orderBy: { docNo: "asc" },
  });
  const pts = rows
    .map((r) => ({ r, score: metric === "final" ? r.finalScore : r.managerScore }))
    .filter((p): p is { r: (typeof rows)[number]; score: number } => p.score != null);
  const n = pts.length;
  const mean = n ? pts.reduce((s, p) => s + p.score, 0) / n : null;
  const sigma = n >= 2 && mean != null ? Math.sqrt(pts.reduce((s, p) => s + (p.score - mean) ** 2, 0) / n) : null;

  // histogram — bin 5 poin dari floor(min/5) sampai ceil(max/5) (min 0, maks ≥100)
  const bins: BellCurveDashboard["bins"] = [];
  if (n) {
    const lo = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.score)) / 5) * 5);
    const hi = Math.max(100, Math.ceil(Math.max(...pts.map((p) => p.score)) / 5) * 5);
    for (let b = lo; b < hi; b += 5) {
      bins.push({ from: b, to: b + 5, count: 0, participants: [] });
    }
    for (const p of pts) {
      const idx = Math.min(bins.length - 1, Math.max(0, Math.floor((p.score - lo) / 5)));
      bins[idx].count++;
      bins[idx].participants.push({
        appraisalId: p.r.id, docNo: p.r.docNo, name: p.r.employee.fullName,
        unit: p.r.employee.orgUnit?.name ?? null, managerName: p.r.manager?.fullName ?? null,
        score: Math.round(p.score * 10) / 10, rating: metric === "final" ? p.r.finalRating : null,
      });
    }
  }

  // overlay kurva normal N(μ, σ) — PDF diskalakan agar puncak = max bin count
  const curve: { x: number; y: number }[] = [];
  if (mean != null && sigma != null && sigma > 0 && n) {
    const maxCount = Math.max(...bins.map((b) => b.count), 1);
    const pdf = (x: number) => Math.exp(-((x - mean) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
    const peak = pdf(mean);
    for (let x = 0; x <= 120; x += 2.5) {
      curve.push({ x, y: Math.round((pdf(x) / peak) * maxCount * 100) / 100 });
    }
  }

  // z-score per atasan (D19) + central tendency
  const byMgr = new Map<string, { managerId: string; managerName: string; scores: number[] }>();
  for (const p of pts) {
    const key = p.r.manager?.id ?? "-tanpa-atasan-";
    const e = byMgr.get(key) ?? { managerId: p.r.manager?.id ?? "", managerName: p.r.manager?.fullName ?? "(tanpa atasan)", scores: [] };
    e.scores.push(p.score);
    byMgr.set(key, e);
  }
  const managers: BellCurveDashboard["managers"] = [];
  for (const m of byMgr.values()) {
    if (m.scores.length < 2) continue; // butuh ≥2 utk z bermakna
    const teamMean = m.scores.reduce((s, x) => s + x, 0) / m.scores.length;
    const teamSigma = Math.sqrt(m.scores.reduce((s, x) => s + (x - teamMean) ** 2, 0) / m.scores.length);
    const z = sigma != null && sigma > 0 ? (teamMean - (mean ?? 0)) / sigma : null;
    let flag: BellCurveDashboard["managers"][number]["flag"] = "ok";
    let flagLabelId = "Kewajaran dalam batas";
    let flagLabelEn = "Within normal bounds";
    if (z != null) {
      if (z <= -2) { flag = "red-pelis"; flagLabelId = "TERLALU PELIS (z ≤ −2)"; flagLabelEn = "TOO STRICT (z ≤ −2)"; }
      else if (z <= -1) { flag = "amber-pelis"; flagLabelId = "cenderung pelis (z ≤ −1)"; flagLabelEn = "leans strict (z ≤ −1)"; }
      else if (z >= 2) { flag = "red-royal"; flagLabelId = "TERLALU ROYAL (z ≥ +2)"; flagLabelEn = "TOO LENIENT (z ≥ +2)"; }
      else if (z >= 1) { flag = "amber-royal"; flagLabelId = "cenderung royal (z ≥ +1)"; flagLabelEn = "leans lenient (z ≥ +1)"; }
      else if (sigma != null && sigma > 0 && teamSigma < sigma / 2) { flag = "central"; flagLabelId = "central tendency — semua nilai “aman” di tengah (antipola §8)"; flagLabelEn = "central tendency — all scores “safe” mid-range (§8 anti-pattern)"; }
    }
    managers.push({ managerId: m.managerId || null, managerName: m.managerName, teamSize: m.scores.length, teamMean: Math.round(teamMean * 10) / 10, teamSigma: Math.round(teamSigma * 10) / 10, z: z == null ? null : Math.round(z * 100) / 100, flag, flagLabelId, flagLabelEn });
  }
  managers.sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0));

  // bar rating per unit (rating final bila ada; sebelum kalibrasi pakai konversi skor)
  const unitMap = new Map<string, { counts: [number, number, number, number, number]; sum: number; n: number }>();
  for (const p of pts) {
    const unit = p.r.employee.orgUnit?.name ?? "(tanpa unit)";
    let rating = metric === "final" ? p.r.finalRating : null;
    if (rating == null) rating = Math.min(5, Math.max(1, Math.floor(p.score / 20) + (p.score % 20 === 0 ? 0 : 1)));
    const e = unitMap.get(unit) ?? { counts: [0, 0, 0, 0, 0], sum: 0, n: 0 };
    e.counts[rating - 1]++;
    e.sum += p.score;
    e.n++;
    unitMap.set(unit, e);
  }
  const byUnit = Array.from(unitMap.entries()).map(([unit, e]) => ({ unit, counts: e.counts, mean: e.n ? Math.round((e.sum / e.n) * 10) / 10 : null }));

  return { metric, cycle, n, mean: mean == null ? null : Math.round(mean * 10) / 10, sigma: sigma == null ? null : Math.round(sigma * 100) / 100, bins, curve, managers, byUnit };
}

// ============ SESI KALIBRASI ============

export async function listSessions(db: TenantDb, cycleId: string) {
  const sessions = await db.calibrationSession.findMany({
    where: { cycleId },
    include: {
      decisions: { include: { appraisal: { select: { docNo: true } } }, orderBy: { decidedAt: "desc" } },
      chair: { select: { fullName: true } },
    },
    orderBy: { heldAt: "desc" },
  });
  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      heldAt: s.heldAt.toISOString(),
      orgUnitId: s.orgUnitId,
      chairName: s.chair?.fullName ?? null,
      notes: s.notes,
      decisionCount: s.decisions.length,
      decisions: s.decisions.map((d) => ({
        id: d.id, appraisalId: d.appraisalId, docNo: d.appraisal.docNo,
        oldScore: d.oldScore, newScore: d.newScore, oldRating: d.oldRating, newRating: d.newRating,
        potentialBand: d.potentialBand, reason: d.reason, decidedBy: d.decidedBy, decidedAt: d.decidedAt.toISOString(),
      })),
    })),
  };
}

export async function createSession(
  db: TenantDb,
  input: { cycleId: string; orgUnitId?: string; heldAt: string; participantIds: string[]; chairId?: string; notes?: string },
  actor: string,
): Promise<{ id: string }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (!["Assessment", "Calibration"].includes(cycle.status)) {
    bad(`Sesi kalibrasi hanya relevan saat fase penilaian/kalibrasi (siklus ${cycle.code} = ${cycle.status})`);
  }
  if (!input.heldAt) bad("Tanggal sesi wajib diisi");
  const s = await db.calibrationSession.create({
    data: {
      cycleId: input.cycleId,
      orgUnitId: input.orgUnitId || null,
      heldAt: new Date(input.heldAt),
      participantsJson: JSON.stringify(input.participantIds ?? []),
      chairId: input.chairId || null,
      notes: input.notes?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: { action: "Created", entity: "CalibrationSession", entityId: s.id, detail: `Sesi kalibrasi ${cycle.code} dijadwalkan (${input.participantIds?.length ?? 0} hadir) oleh ${actor}` },
  });
  return { id: s.id };
}

// ============ KEPUTUSAN KALIBRASI (§30-3 — alasan WAJIB) ============

export async function recordDecision(
  db: TenantDb,
  input: {
    sessionId: string; appraisalId: string;
    newScore?: number; newRating?: number; potentialBand?: number; reason: string;
  },
  actor: string,
): Promise<{ finalScore: number | null; finalRating: number | null }> {
  const session = await db.calibrationSession.findUnique({ where: { id: input.sessionId }, select: { id: true, cycleId: true } });
  if (!session) bad("Sesi kalibrasi tidak ditemukan");
  const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, include: { cycle: { select: { code: true, status: true } } } });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycleId !== session.cycleId) bad("Peserta bukan bagian siklus sesi ini");
  if (a.cycle.status !== "Calibration") bad(`Keputusan kalibrasi hanya saat fase Calibration (siklus ${a.cycle.code} = ${a.cycle.status})`);
  if (!["ManagerDone", "Calibrating"].includes(a.status)) bad(`Peserta sudah dikunci (${a.status}) — keputusan kalibrasi tidak lagi bisa`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan kalibrasi wajib ≥10 karakter (§30-3 — setiap penyesuaian ter-audit)");
  if (input.newScore != null && !(input.newScore >= 0 && input.newScore <= 120)) bad("Skor baru harus 0–120");
  if (input.newRating != null && !(input.newRating >= 1 && input.newRating <= 5)) bad("Rating baru harus 1–5");
  if (input.potentialBand != null && !(input.potentialBand >= 1 && input.potentialBand <= 3)) bad("Band potensi 9-box harus 1–3");
  if (input.newScore == null && input.newRating == null && input.potentialBand == null) bad("Tidak ada perubahan yang diajukan");

  const oldScore = a.finalScore ?? a.managerScore;
  const oldRating = a.finalRating ?? (oldScore != null ? (await ratingOfScore(db, oldScore))?.value ?? null : null);
  const newScore = input.newScore ?? oldScore;
  let newRating = input.newRating ?? null;
  if (newScore != null && newRating == null) {
    newRating = (await ratingOfScore(db, newScore))?.value ?? oldRating ?? null;
  }
  await db.calibrationDecision.create({
    data: {
      sessionId: input.sessionId,
      appraisalId: input.appraisalId,
      oldScore, newScore, oldRating, newRating,
      potentialBand: input.potentialBand ?? null,
      reason, decidedBy: actor,
    },
  });
  await db.appraisalRecord.update({
    where: { id: input.appraisalId },
    data: {
      finalScore: newScore,
      finalRating: newRating ?? a.finalRating,
      ...(input.potentialBand != null ? { potentialBand: input.potentialBand } : {}),
      status: "Calibrating",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "AppraisalRecord", entityId: input.appraisalId,
      detail: `KALIBRASI ${a.docNo}: skor ${oldScore?.toFixed(1) ?? "—"} → ${newScore?.toFixed(1) ?? "—"}, rating ${oldRating ?? "—"} → ${newRating ?? "—"}${input.potentialBand != null ? `, band 9-box ${input.potentialBand}` : ""} — “${reason}” oleh ${actor}`,
    },
  });
  return { finalScore: newScore, finalRating: newRating ?? a.finalRating };
}

// ============ FINALISASI BERJENJANG (§30-4 — approval PerformanceAppraisal) ============

/** Rating ekstrem (1 & 5) → jenjang L3 Direktur aktif (amount=1; normal amount=2). */
function extremeFlag(rating: number | null): number {
  return rating != null && (rating <= 2 || rating === 5) ? 1 : 2;
}

export async function startFinalize(
  db: TenantDb,
  input: { appraisalIds: string[]; actor: string },
): Promise<{ started: number; skipped: { docNo: string; reason: string }[] }> {
  const started: string[] = [];
  const skipped: { docNo: string; reason: string }[] = [];
  for (const appraisalId of input.appraisalIds) {
    const a = await db.appraisalRecord.findUnique({
      where: { id: appraisalId },
      include: {
        cycle: { select: { code: true, status: true } },
        employee: { select: { id: true, position: { select: { title: true } } } },
      },
    });
    if (!a) { skipped.push({ docNo: appraisalId, reason: "tidak ditemukan" }); continue; }
    if (a.cycle.status !== "Calibration") { skipped.push({ docNo: a.docNo, reason: `fase siklus ${a.cycle.status}` }); continue; }
    if (!["ManagerDone", "Calibrating"].includes(a.status)) { skipped.push({ docNo: a.docNo, reason: `status ${a.status}` }); continue; }
    const existing = await getApprovalChain(db, "PerformanceAppraisal", a.id);
    if (existing && existing.status === "InProgress") { skipped.push({ docNo: a.docNo, reason: "sudah dalam persetujuan" }); continue; }
    // finalScore default dari managerScore bila belum dikalibrasi (ter-jejak)
    let finalScore = a.finalScore ?? a.managerScore;
    let finalRating = a.finalRating;
    if (finalScore == null) { skipped.push({ docNo: a.docNo, reason: "skor atasan belum ada" }); continue; }
    if (finalRating == null) finalRating = (await ratingOfScore(db, finalScore))?.value ?? null;
    if (finalRating == null) { skipped.push({ docNo: a.docNo, reason: "rating belum bisa ditentukan" }); continue; }
    if (a.finalScore == null) {
      await db.appraisalRecord.update({ where: { id: a.id }, data: { finalScore, finalRating, status: "Calibrating" } });
      await db.activityLog.create({
        data: { action: "Updated", entity: "AppraisalRecord", entityId: a.id, detail: `Finalisasi ${a.docNo}: finalScore diisi dari skor atasan ${finalScore.toFixed(1)} (belum ada keputusan kalibrasi)` },
      });
    }
    await ensurePerfApprovalStructure(db); // self-heal tenant lama (idempoten per code)
    const chain = await startApprovalChain(db, {
      docType: "PerformanceAppraisal",
      docId: a.id,
      employeeId: a.employee.id, // §11.1 — tier dari dimensi karyawan YANG DINILAI
      amount: extremeFlag(finalRating), // 1 = ekstrem → L3 aktif (min/max=1)
      createdBy: input.actor,
    });
    void chain;
    started.push(a.id);
    await db.activityLog.create({
      data: {
        action: "Submitted", entity: "AppraisalRecord", entityId: a.id,
        detail: `Finalisasi ${a.docNo} (rating ${finalRating}${extremeFlag(finalRating) === 1 ? " — EKSTREM, jenjang Direktur aktif" : ""}) diajukan ke persetujuan oleh ${input.actor}`,
      },
    });
    // notifikasi atasan penilai (L1) — lampiran surat nanti di P5
    if (a.managerId) {
      const users = await db.appUser.findMany({ where: { employeeId: a.managerId, active: true }, select: { id: true }, take: 5 });
      for (const u of users) {
        await db.notification.create({
          data: {
            appUserId: u.id,
            title: `Persetujuan finalisasi penilaian ${a.docNo}`,
            body: `Hasil penilaian ${a.employee.position?.title ?? "karyawan"} menunggu persetujuan Anda (jenjang 1). Buka menu Performance → Kalibrasi.`,
            kind: "performance",
            link: "performance:calibration",
          },
        }).catch(() => null);
      }
    }
  }
  return { started: started.length, skipped };
}

export async function decideFinalize(
  db: TenantDb,
  input: { appraisalId: string; action: "approve" | "reject"; note?: string },
  actor: DecideActor,
): Promise<{ final: boolean; status: string }> {
  const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, include: { cycle: { select: { code: true } } } });
  if (!a) bad("Peserta tidak ditemukan");
  const res = await decideApprovalChain(db, {
    docType: "PerformanceAppraisal", docId: input.appraisalId,
    action: input.action, note: input.note, actor,
  });
  if (res.final && input.action === "approve") {
    await db.appraisalRecord.update({ where: { id: input.appraisalId }, data: { status: "Finalized" } });
    await db.activityLog.create({
      data: { action: "Processed", entity: "AppraisalRecord", entityId: input.appraisalId, detail: `Finalisasi ${a.docNo} DISETUJUI penuh — status Finalized (finalScore ${(a.finalScore ?? 0).toFixed(1)}, rating ${a.finalRating ?? "—"})` },
    });
  } else if (input.action === "reject") {
    await db.activityLog.create({
      data: { action: "Processed", entity: "AppraisalRecord", entityId: input.appraisalId, detail: `Finalisasi ${a.docNo} DITOLAK di jenjang — kembali dapat difinalisasi ulang${input.note ? ` (“${input.note.trim()}”)` : ""}` },
    });
  }
  return { final: res.final, status: input.action === "approve" ? (res.final ? "Finalized" : "InProgress") : "Rejected" };
}

/** Daftar peserta + status persetujuan utk tab finalisasi. */
export async function listFinalizations(db: TenantDb, cycleId: string) {
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId, status: { in: SCORED } },
    include: { employee: { select: { fullName: true, employeeNo: true } }, manager: { select: { fullName: true } } },
    orderBy: { docNo: "asc" },
  });
  const chains = await attachChainSummaries(db, "PerformanceAppraisal", rows.map((r) => ({ id: r.id })));
  return {
    rows: rows.map((r) => ({
      appraisalId: r.id, docNo: r.docNo, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      managerName: r.manager?.fullName ?? null, status: r.status,
      managerScore: r.managerScore, finalScore: r.finalScore, finalRating: r.finalRating, potentialBand: r.potentialBand,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      appealStatus: r.appealStatus ?? null, appealNote: r.appealNote ?? null,
      chain: chains.get(r.id) ?? null,
    })),
  };
}

// ============ PUBLIKASI (§31-1) & PENUTUPAN ============

export async function publishResults(
  db: TenantDb,
  input: { cycleId: string; force?: boolean; actor: string },
): Promise<{ published: number; forced: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, status: true, publishAt: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "Calibration") bad(`Publikasi hanya dari fase Calibration (siklus ${cycle.code} = ${cycle.status})`);
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: input.cycleId, status: { in: SCORED } },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  if (rows.length === 0) bad("Belum ada peserta yang selesai dinilai");
  const notFinal = rows.filter((r) => r.status !== "Finalized");
  if (notFinal.length > 0 && !input.force) {
    bad(`${notFinal.length} peserta belum Finalized (${notFinal.slice(0, 3).map((r) => r.docNo).join(", ")}…) — selesaikan finalisasi atau paksa publikasi (ter-ActivityLog)`);
  }
  let forced = 0;
  for (const r of rows) {
    if (r.status !== "Finalized") {
      forced++;
      await db.activityLog.create({
        data: { action: "Updated", entity: "AppraisalRecord", entityId: r.id, detail: `Publikasi paksa ${r.docNo} dari status ${r.status} (hasil atasan dipakai apa adanya) — oleh ${input.actor}` },
      });
    }
    await db.appraisalRecord.update({ where: { id: r.id }, data: { status: "Published" } });
    // notifikasi ESS karyawan — hasil siap dilihat (Alur 7)
    const users = await db.appUser.findMany({ where: { employeeId: r.employee.id, active: true }, select: { id: true }, take: 5 });
    for (const u of users) {
      await db.notification.create({
        data: {
          appUserId: u.id,
          title: `Hasil penilaian ${r.docNo} telah dipublikasikan`,
          body: "Skor per KPI, kompetensi, rating, dan komentar atasan kini dapat dilihat di menu Penilaian Saya. Anda dapat acknowledge dan (bila perlu) mengajukan banding dalam 7 hari.",
          kind: "performance",
          link: "ess:my-appraisal",
        },
      }).catch(() => null);
    }
  }
  await db.performanceCycle.update({ where: { id: input.cycleId }, data: { status: "Published", publishAt: new Date() } });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PerformanceCycle", entityId: input.cycleId,
      detail: `Hasil ${cycle.code} DIPUBLIKASIKAN: ${rows.length} peserta (${forced} dipaksa) oleh ${input.actor} — jendela banding 7 hari dibuka (D6)`,
    },
  });
  return { published: rows.length, forced };
}

export async function closeResults(
  db: TenantDb,
  input: { cycleId: string; force?: boolean; actor: string },
): Promise<{ closed: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "Published") bad(`Penutupan hanya dari fase Published (siklus ${cycle.code} = ${cycle.status})`);
  const rows = await db.appraisalRecord.findMany({ where: { cycleId: input.cycleId }, select: { id: true, docNo: true, status: true, appealStatus: true } });
  const openAppeals = rows.filter((r) => r.status === "Appealed" && r.appealStatus === "Submitted");
  if (openAppeals.length > 0 && !input.force) {
    bad(`${openAppeals.length} banding belum diputus (${openAppeals.slice(0, 3).map((r) => r.docNo).join(", ")}…) — putuskan dulu atau paksa (ter-ActivityLog)`);
  }
  let closed = 0;
  for (const r of rows) {
    if (["Published", "Appealed", "Finalized"].includes(r.status)) {
      await db.appraisalRecord.update({ where: { id: r.id }, data: { status: "Closed" } });
      closed++;
    }
  }
  await db.performanceCycle.update({ where: { id: input.cycleId }, data: { status: "Closed" } });
  await db.activityLog.create({
    data: { action: "Processed", entity: "PerformanceCycle", entityId: input.cycleId, detail: `Hasil ${cycle.code} DITUTUP (${closed} peserta read-only permanen) oleh ${input.actor}` },
  });
  return { closed };
}

// ============ BANDING (§31-3 — D6 jendela 7 hari) ============

export const APPEAL_WINDOW_DAYS = 7;

/** Putuskan banding: Rejected / Adjusted (wajib skor+alasan baru) / Withdrawn (pengaju). */
export async function decideAppeal(
  db: TenantDb,
  input: { appraisalId: string; decision: "Rejected" | "Adjusted" | "Withdrawn"; newScore?: number; newRating?: number; reason: string; byEmployee?: string },
  actor: string,
): Promise<{ appealStatus: string }> {
  const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, include: { cycle: { select: { code: true, publishAt: true } } } });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.appealStatus !== "Submitted") bad(`Tidak ada banding aktif (status banding: ${a.appealStatus ?? "—"})`);
  if (!["Published", "Appealed"].includes(a.status)) bad(`Status peserta tidak lagi bisa diputus banding (${a.status})`);
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan keputusan banding wajib ≥10 karakter (ter-audit)");
  if (input.decision === "Withdrawn" && input.byEmployee && a.employeeId !== input.byEmployee) bad("Banding hanya bisa ditarik pengajunya");
  if (input.decision === "Withdrawn" && !input.byEmployee && !reason.startsWith("HR")) { /* admin boleh withdraw atas permintaan — cukup alasan */ }

  if (input.decision === "Adjusted") {
    if (input.newScore == null) bad("Penyesuaian banding wajib skor baru");
    if (!(input.newScore >= 0 && input.newScore <= 120)) bad("Skor baru harus 0–120");
    const newRating = input.newRating ?? (await ratingOfScore(db, input.newScore))?.value ?? null;
    if (newRating == null) bad("Rating baru tidak bisa ditentukan dari skor baru");
    // keputusan penyesuaian = CalibrationDecision ter-audit (dari → ke + alasan — §31-3)
    const session = await db.calibrationSession.findFirst({ where: { cycleId: a.cycleId }, orderBy: { heldAt: "desc" }, select: { id: true } });
    if (!session) bad("Belum ada sesi kalibrasi di siklus ini — buat sesi untuk mencatat penyesuaian banding");
    await db.calibrationDecision.create({
      data: {
        sessionId: session.id, appraisalId: a.id,
        oldScore: a.finalScore, newScore: input.newScore, oldRating: a.finalRating, newRating,
        reason: `BANDING ${reason}`, decidedBy: actor,
      },
    });
    await db.appraisalRecord.update({
      where: { id: a.id },
      data: { finalScore: input.newScore, finalRating: newRating, appealStatus: "Adjusted", appealDecidedBy: actor, appealDecidedAt: new Date(), status: "Published" },
    });
  } else {
    await db.appraisalRecord.update({
      where: { id: a.id },
      data: { appealStatus: input.decision, appealDecidedBy: actor, appealDecidedAt: new Date(), status: "Published" },
    });
  }
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "AppraisalRecord", entityId: a.id,
      detail: `Banding ${a.docNo} → ${input.decision}${input.decision === "Adjusted" ? ` (skor → ${input.newScore?.toFixed(1)})` : ""} — “${reason}” oleh ${actor}`,
    },
  });
  return { appealStatus: input.decision };
}

// ============ STRUKTUR AS-PERF-STD (§11.1 — dijamin ada, idempoten) ============

/** Pastikan struktur finalisasi ada (tenant baru via provisioning; tenant lama
 *  self-heal saat finalisasi pertama). L3 Direktur aktif HANYA utk rating ekstrem
 *  (amount=1, min/max=1); jabatan direktur dipetakan per-level "Director" atau
 *  judul mengandung director/direktur/CEO; bila belum ada → Admin/HR (catatan). */
export async function ensurePerfApprovalStructure(db: TenantDb): Promise<void> {
  const existing = await db.approvalStructure.findUnique({ where: { code: "AS-PERF-STD" }, select: { id: true } });
  if (existing) return;
  let directorPositionId: string | null = null;
  const byLevel = await db.positionLevel.findMany({ where: { OR: [{ name: { contains: "Director" } }, { name: { contains: "Direktur" } }] }, select: { id: true } });
  if (byLevel.length > 0) {
    const pos = await db.position.findFirst({ where: { positionLevelId: { in: byLevel.map((l) => l.id) }, active: true }, select: { id: true }, orderBy: { code: "asc" } });
    directorPositionId = pos?.id ?? null;
  }
  if (!directorPositionId) {
    const pos = await db.position.findFirst({
      where: { OR: [{ title: { contains: "irector" } }, { title: { contains: "irektur" } }, { title: { contains: "CEO" } }] },
      select: { id: true }, orderBy: { code: "asc" },
    });
    directorPositionId = pos?.id ?? null;
  }
  await db.approvalStructure.create({
    data: {
      code: "AS-PERF-STD",
      name: "Persetujuan Finalisasi Penilaian (default)",
      docType: "PerformanceAppraisal",
      levels: {
        create: [
          { levelNo: 1, approverType: "ATASAN_LANGSUNG", note: "L1 — atasan penilai (snapshot)" },
          { levelNo: 2, approverType: "HR_ADMIN", note: "L2 — verifikasi proses HR" },
          ...(directorPositionId
            ? [{ levelNo: 3, approverType: "POSISI", approverPositionId: directorPositionId, minAmount: 1, maxAmount: 1, note: "L3 Direktur — hanya rating ekstrem (1–2 / 5) §11.1" }]
            : [{ levelNo: 3, approverType: "HR_ADMIN", minAmount: 1, maxAmount: 1, note: "L3 (jabatan direktur belum dipetakan — Admin/HR memutuskan)" }]),
        ],
      },
    },
  }).catch(() => null); // race tenant bootstrap — struktur unik per code
}
