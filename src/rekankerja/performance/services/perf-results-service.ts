// ============================================================================
// RekanKerja PERFORMANCE P4 — Hasil & 9-Box (DEVELOPMENT-PLAN-PERFORMANCE.md
// §31 Alur 7 + §18-6 9-box + §11.3 visibility matrix):
//   • results          — daftar hasil + potentialBand + status acknowledgement
//     + banding (row-level: HR semua; atasan timnya; karyawan via ESS sendiri).
//   • nineBox          — matriks 3×3 performance × potential (klik sel →
//     daftar karyawan) — HANYA HR/Direksi (§11.3).
//   • publish          — §35-12: semua peserta Finalized ATAU force ter-log;
//     status siklus Published + publishAt (jangkar jendela banding D6) +
//     notifikasi in-app massal ke tiap peserta (deep-link ess:my-appraisal).
//   • acknowledge       — §35-13: karyawan mencatat telah membaca (BUKAN
//     persetujuan isi) → acknowledgedAt.
//   • appeal / withdrawAppeal / decideAppeal — banding D6 (jendela
//     appealDays sejak publishAt); Adjusted = CalibrationDecision baru
//     (alasan wajib) + finalScore baru; tanpa catatan → 400.
//   • closeCycleResults — §35-16: banding selesai semua → siklus Closed
//     (read-only permanen; reuse gerbang close P1).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { publishCycle, closeCycle } from "@/rekankerja/performance/services/perf-cycle-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { PERF_DOC_TYPE, type CalibrationActor } from "@/rekankerja/performance/services/perf-calibration-service";

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;

/** Jendela banding D6: appealDays (PerformanceSetting, default 7) sejak publishAt. */
async function appealWindowOf(
  db: TenantDb,
  cycle: { publishAt: Date | null },
): Promise<{ days: number; deadline: string | null; open: boolean; daysLeft: number | null }> {
  const setting = await db.performanceSetting.findFirst({ select: { appealDays: true } });
  const days = setting?.appealDays ?? 7;
  if (!cycle.publishAt) return { days, deadline: null, open: false, daysLeft: null };
  const end = cycle.publishAt.getTime() + days * DAY_MS;
  const daysLeft = Math.ceil((end - Date.now()) / DAY_MS);
  return { days, deadline: new Date(end).toISOString(), open: Date.now() <= end, daysLeft };
}

// ============ daftar hasil (§11.3) ============

export async function results(
  db: TenantDb,
  actor: CalibrationActor,
  opt: { cycleId: string; unitId?: string },
): Promise<{
  cycle: { code: string; status: string; publishAt: string | null };
  appealWindow: { days: number; deadline: string | null; open: boolean; daysLeft: number | null };
  stats: { total: number; scored: number; finalized: number; published: number; acknowledged: number; appealed: number };
  rows: {
    appraisalId: string; docNo: string; status: string;
    employeeNo: string; fullName: string; unitName: string | null; managerName: string | null;
    selfScore: number | null; managerScore: number | null; finalScore: number | null; finalRating: number | null;
    ratingLabel: string | null; ratingLabelEn: string | null; ratingColor: string | null;
    potentialBand: number | null; acknowledgedAt: string | null;
    appealStatus: string | null; appealNote: string | null; appealDecidedBy: string | null;
  }[];
}> {
  const cycle = await db.performanceCycle.findUnique({
    where: { id: opt.cycleId }, select: { code: true, status: true, publishAt: true },
  });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const where: Record<string, unknown> = { cycleId: opt.cycleId };
  if (!actor.superAdmin && actor.employeeId) where.managerId = actor.employeeId; // atasan: timnya
  if (opt.unitId) where.employee = { orgUnitId: opt.unitId };
  const rows = await db.appraisalRecord.findMany({
    where: where as never,
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnitId: true } },
      manager: { select: { fullName: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });
  const unitIds = [...new Set(rows.map((r) => r.employee.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0
    ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
    : [];
  const unitNameOf = new Map(units.map((u) => [u.id, u.name]));
  const scales = await db.ratingScale.findMany();
  const scaleOf = new Map(scales.map((s) => [s.value, s]));

  return {
    cycle: { code: cycle.code, status: cycle.status, publishAt: cycle.publishAt?.toISOString() ?? null },
    appealWindow: await appealWindowOf(db, cycle),
    stats: {
      total: rows.length,
      scored: rows.filter((r) => (r.finalScore ?? r.managerScore) != null).length,
      finalized: rows.filter((r) => ["Finalized", "Published", "Appealed", "Closed"].includes(r.status)).length,
      published: rows.filter((r) => ["Published", "Appealed", "Closed"].includes(r.status)).length,
      acknowledged: rows.filter((r) => r.acknowledgedAt != null).length,
      appealed: rows.filter((r) => r.appealStatus === "Submitted").length,
    },
    rows: rows.map((r) => {
      const sc = r.finalRating != null ? scaleOf.get(r.finalRating) : undefined;
      return {
        appraisalId: r.id, docNo: r.docNo, status: r.status,
        employeeNo: r.employee.employeeNo, fullName: r.employee.fullName,
        unitName: unitNameOf.get(r.employee.orgUnitId ?? "") ?? null, managerName: r.manager?.fullName ?? null,
        selfScore: r.selfScore, managerScore: r.managerScore, finalScore: r.finalScore, finalRating: r.finalRating,
        ratingLabel: sc?.labelId ?? null, ratingLabelEn: sc?.labelEn ?? null, ratingColor: sc?.color ?? null,
        potentialBand: r.potentialBand, acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        appealStatus: r.appealStatus, appealNote: r.appealNote, appealDecidedBy: r.appealDecidedBy,
      };
    }),
  };
}

// ============ 9-box (§18-6, §11.3 — HR/Direksi) ============

/** Band performa dari rating: 1–2 rendah, 3 memenuhi, 4–5 tinggi. */
function perfBandOf(rating: number): 1 | 2 | 3 {
  if (rating <= 2) return 1;
  if (rating === 3) return 2;
  return 3;
}

export async function nineBox(
  db: TenantDb,
  actor: CalibrationActor,
  opt: { cycleId: string },
): Promise<{
  cycle: { code: string; status: string };
  grid: { perf: 1 | 2 | 3; potential: 1 | 2 | 3; count: number; rows: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string; unitName: string | null;
    finalRating: number; potentialBand: number;
  }[] }[];
  unplaced: { appraisalId: string; docNo: string; fullName: string; finalRating: number | null; potentialBand: number | null }[];
  totals: { placed: number; unplaced: number };
}> {
  if (!actor.superAdmin) {
    throw new Error("Matriks 9-box hanya untuk HR/Direksi (§11.3 — karyawan & atasan tidak melihat 9-box perusahaan)");
  }
  const cycle = await db.performanceCycle.findUnique({ where: { id: opt.cycleId }, select: { code: true, status: true } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: opt.cycleId },
    include: { employee: { select: { employeeNo: true, fullName: true, orgUnitId: true } } },
    orderBy: { docNo: "asc" },
    take: 500,
  });
  const unitIds = [...new Set(rows.map((r) => r.employee.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0
    ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
    : [];
  const unitNameOf = new Map(units.map((u) => [u.id, u.name]));

  const placed = rows.filter((r) => r.finalRating != null && r.potentialBand != null);
  const grid = ([1, 2, 3] as const).flatMap((potential) =>
    ([3, 2, 1] as const).map((perf) => ({ perf, potential }))).map((cell) => ({
      perf: cell.perf, potential: cell.potential, count: 0, rows: [] as {
        appraisalId: string; docNo: string; fullName: string; employeeNo: string; unitName: string | null;
        finalRating: number; potentialBand: number;
      }[],
    }));
  const indexOf = (perf: 1 | 2 | 3, potential: 1 | 2 | 3) =>
    grid.findIndex((g) => g.perf === perf && g.potential === potential);
  for (const r of placed) {
    const p = perfBandOf(r.finalRating as number);
    const b = Math.min(3, Math.max(1, r.potentialBand as number)) as 1 | 2 | 3;
    const g = grid[indexOf(p, b)];
    g.count++;
    g.rows.push({
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      unitName: unitNameOf.get(r.employee.orgUnitId ?? "") ?? null,
      finalRating: r.finalRating as number, potentialBand: r.potentialBand as number,
    });
  }

  return {
    cycle,
    grid,
    unplaced: rows.filter((r) => r.finalRating == null || r.potentialBand == null).map((r) => ({
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName,
      finalRating: r.finalRating, potentialBand: r.potentialBand,
    })),
    totals: { placed: placed.length, unplaced: rows.length - placed.length },
  };
}

// ============ publikasi (§35-12) ============

export async function publish(
  db: TenantDb,
  actor: CalibrationActor,
  cycleId: string,
  opt: { force?: boolean } = {},
): Promise<{ code: string; status: string; publishAt: string; notified: number }> {
  const cycle = await db.performanceCycle.findUnique({
    where: { id: cycleId },
    include: { appraisals: { select: { id: true, status: true } } },
  });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "Calibration") {
    throw new Error(`Publikasi hasil hanya dari fase Calibration (siklus ${cycle.code} saat ini ${cycle.status}) — jalankan Buka Kalibrasi dahulu`);
  }

  // gerbang P1 §35-12 (ManagerDone pending → tolak kecuali force) + Finalized/Calibrating → Published
  await publishCycle(db, cycleId, opt.force === true);
  const publishAt = new Date();
  await db.performanceCycle.update({ where: { id: cycleId }, data: { publishAt } });

  // notifikasi in-app massal ke tiap peserta (deep-link ESS §31-1)
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId, status: { in: ["Published", "Appealed"] } },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  let notified = 0;
  for (const r of rows) {
    const res = await notifyEvent(db, {
      to: "employee", docType: PERF_DOC_TYPE, docNo: r.docNo, docId: r.id, employeeId: r.employee.id,
      title: `Hasil penilaian ${cycle.code} telah dipublikasikan`,
      body: `${r.docNo} — silakan buka Penilaian Saya: lihat hasil, konfirmasi penerimaan (acknowledge), atau ajukan banding dalam ${(await appealWindowOf(db, { publishAt })).days} hari.`,
      kind: "performance", link: "ess:my-appraisal",
    });
    notified += res.recipients.length;
  }
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Hasil siklus ${cycle.code} DIPUBLIKASIKAN — ${rows.length} peserta, ${notified} notifikasi terkirim${opt.force === true ? " · FORCE (peserta ManagerDone dipaksa ikut — ter-log §35-12)" : ""} (${actor.name})`,
    },
  });
  return { code: cycle.code, status: "Published", publishAt: publishAt.toISOString(), notified };
}

// ============ acknowledgement (§35-13) ============

export async function acknowledge(
  db: TenantDb,
  employeeId: string,
  appraisalId: string,
): Promise<{ docNo: string; acknowledgedAt: string | null; already: boolean }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: { cycle: { select: { code: true, status: true } } },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  if (a.employeeId !== employeeId) throw new Error("Bukan penilaian milik karyawan ini");
  if (a.cycle.status !== "Published") {
    throw new Error(`Hasil belum dipublikasi (siklus ${a.cycle.status}) — acknowledge tersedia setelah publikasi (§35-13)`);
  }
  if (!["Published", "Appealed"].includes(a.status)) {
    throw new Error(`Peserta berstatus ${a.status} — tidak dapat acknowledge (§35-13)`);
  }
  if (a.acknowledgedAt) return { docNo: a.docNo, acknowledgedAt: a.acknowledgedAt.toISOString(), already: true };

  const now = new Date();
  await db.appraisalRecord.update({ where: { id: appraisalId }, data: { acknowledgedAt: now } });
  await db.activityLog.create({
    data: {
      employeeId,
      action: "Processed", entity: "AppraisalRecord", entityId: a.docNo,
      detail: `Karyawan acknowledge hasil penilaian ${a.docNo} (${a.cycle.code}) — bukti telah dikomunikasikan, BUKAN persetujuan isi (§35-13)`,
    },
  });
  return { docNo: a.docNo, acknowledgedAt: now.toISOString(), already: false };
}

// ============ banding (§35-14/15) ============

export async function appeal(
  db: TenantDb,
  employeeId: string,
  appraisalId: string,
  input: { note: string; evidence?: string | null },
): Promise<{ docNo: string; appealStatus: string; deadline: string | null }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: { cycle: { select: { code: true, status: true, publishAt: true } } },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  if (a.employeeId !== employeeId) throw new Error("Bukan penilaian milik karyawan ini");
  if (a.cycle.status !== "Published") throw new Error(`Banding hanya pada hasil terpublikasi (siklus ${a.cycle.status} — §35-14)`);

  const note = (input.note ?? "").trim();
  if (!note) throw new Error("Alasan banding wajib diisi (§35-14)");
  const win = await appealWindowOf(db, a.cycle);
  if (!a.cycle.publishAt) throw new Error("Tanggal publikasi belum tercatat — hubungi HR");
  if (!win.open) throw new Error(`Jendela banding D6 sudah tutup (tenggat ${win.deadline?.slice(0, 10) ?? "—"}) (§35-14)`);
  if (a.appealStatus === "Submitted") throw new Error("Banding sudah diajukan — menunggu keputusan HR");
  if (a.appealStatus === "Rejected" || a.appealStatus === "Adjusted") throw new Error(`Banding sudah diputus (${a.appealStatus})`);

  const fullNote = input.evidence?.trim() ? `${note}\n\n[bukti tambahan] ${input.evidence.trim()}` : note;
  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: { status: "Appealed", appealStatus: "Submitted", appealNote: fullNote, appealDecidedBy: null, appealDecidedAt: null },
  });
  await db.activityLog.create({
    data: {
      employeeId,
      action: "Submitted", entity: "AppraisalRecord", entityId: a.docNo,
      detail: `BANDING diajukan utk ${a.docNo} (${a.cycle.code}) — sisa ${win.daysLeft} hari dari jendela ${win.days} hari; alasan: ${note.slice(0, 200)} (§35-14)`,
    },
  });
  void notifyEvent(db, {
    to: "admins", docType: PERF_DOC_TYPE, docNo: a.docNo, docId: a.id,
    title: `Banding hasil penilaian ${a.docNo}`,
    body: `Jendela ${win.days} hari · sisa ${win.daysLeft} hari — putuskan di Hasil & 9-Box (§35-15)`,
    kind: "performance", link: "performance:results",
  }).catch(() => { /* never */ });
  return { docNo: a.docNo, appealStatus: "Submitted", deadline: win.deadline };
}

export async function withdrawAppeal(
  db: TenantDb,
  employeeId: string,
  appraisalId: string,
): Promise<{ docNo: string; appealStatus: string }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: { cycle: { select: { code: true } } },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  if (a.employeeId !== employeeId) throw new Error("Bukan penilaian milik karyawan ini");
  if (a.appealStatus !== "Submitted") throw new Error(`Tidak ada banding aktif (status banding: ${a.appealStatus ?? "—"})`);

  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: { appealStatus: "Withdrawn", status: "Published" },
  });
  await db.activityLog.create({
    data: {
      employeeId,
      action: "Cancelled", entity: "AppraisalRecord", entityId: a.docNo,
      detail: `Banding ${a.docNo} ditarik pengaju — kembali Published (${a.cycle.code})`,
    },
  });
  return { docNo: a.docNo, appealStatus: "Withdrawn" };
}

export async function decideAppeal(
  db: TenantDb,
  actor: CalibrationActor,
  appraisalId: string,
  input: { decision: "Rejected" | "Adjusted"; note: string; newScore?: number | null },
): Promise<{ docNo: string; appealStatus: string; finalScore: number | null; finalRating: number | null }> {
  const note = (input.note ?? "").trim();
  if (!note) throw new Error("Catatan keputusan banding WAJIB diisi (§35-15)");

  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      cycle: { select: { id: true, code: true } },
      employee: { select: { id: true, fullName: true } },
      kpis: { select: { isCritical: true, polarity: true, finalActual: true } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  if (a.appealStatus !== "Submitted" || a.status !== "Appealed") {
    throw new Error(`Tidak ada banding menunggu keputusan (status: ${a.status}/${a.appealStatus ?? "—"} — §35-15)`);
  }

  if (input.decision === "Rejected") {
    await db.appraisalRecord.update({
      where: { id: appraisalId },
      data: { appealStatus: "Rejected", appealDecidedBy: actor.name, appealDecidedAt: new Date(), status: "Published" },
    });
    await db.activityLog.create({
      data: {
        action: "Rejected", entity: "AppraisalRecord", entityId: a.docNo,
        detail: `Banding ${a.docNo} DITOLAK (${actor.name}) — catatan: ${note} (§35-15)`,
      },
    });
    return { docNo: a.docNo, appealStatus: "Rejected", finalScore: a.finalScore, finalRating: a.finalRating };
  }

  // Adjusted — CalibrationDecision baru (alasan = catatan keputusan §31-3)
  if (input.newScore == null) throw new Error("Penyesuaian (Adjusted) wajib skor baru (§35-15)");
  const newScore = round2(input.newScore);
  if (newScore < 0 || newScore > 120) throw new Error("Skor baru harus 0–120 (§16)");
  const criticalFailed = a.kpis.some((k) => k.isCritical && k.polarity === "Boolean" && (k.finalActual ?? 0) < 1);
  const scales = await db.ratingScale.findMany({ orderBy: { minScore: "desc" } });
  let sc = scales.find((s) => newScore >= s.minScore) ?? null;
  if (criticalFailed && sc && sc.value > 2) sc = scales.find((s) => s.value === 2) ?? sc;
  const newRating = sc?.value ?? null;

  // sesi banding (CalibrationDecision butuh session — dibuat khusus, ter-audit)
  const session = await db.calibrationSession.create({
    data: {
      cycleId: a.cycle.id,
      heldAt: new Date(),
      participantsJson: JSON.stringify({ participants: [a.employeeId] }),
      chairId: actor.employeeId,
      notes: `Sesi banding ${a.docNo} — keputusan ${actor.name}`,
    },
  });
  await db.calibrationDecision.create({
    data: {
      sessionId: session.id, appraisalId: a.id,
      oldScore: a.finalScore ?? a.managerScore, newScore,
      oldRating: a.finalRating, newRating,
      reason: note, decidedBy: actor.name,
    },
  });
  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: {
      finalScore: newScore, finalRating: newRating,
      appealStatus: "Adjusted", appealDecidedBy: actor.name, appealDecidedAt: new Date(), status: "Published",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "AppraisalRecord", entityId: a.docNo,
      detail: `Banding ${a.docNo} DISESUAIKAN (${actor.name}): skor ${(a.finalScore ?? a.managerScore) ?? "—"}→${newScore}, rating ${a.finalRating ?? "—"}→${newRating ?? "—"} — CalibrationDecision baru; catatan: ${note} (§35-15)`,
    },
  });
  void notifyEvent(db, {
    to: "employee", docType: PERF_DOC_TYPE, docNo: a.docNo, docId: a.id, employeeId: a.employeeId,
    title: `Banding ${a.docNo} diputuskan: disesuaikan`,
    body: `Skor final menjadi ${newScore} (rating ${newRating ?? "—"}) — lihat Penilaian Saya. Catatan HR: ${note.slice(0, 160)}`,
    kind: "performance", link: "ess:my-appraisal",
  }).catch(() => { /* never */ });
  return { docNo: a.docNo, appealStatus: "Adjusted", finalScore: newScore, finalRating: newRating };
}

// ============ tutup hasil (§35-16) ============

export async function closeCycleResults(
  db: TenantDb,
  actor: CalibrationActor,
  cycleId: string,
): Promise<{ code: string; status: string }> {
  const cycle = await db.performanceCycle.findUnique({
    where: { id: cycleId },
    include: { appraisals: { select: { id: true, status: true, appealStatus: true } } },
  });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "Published") {
    throw new Error(`Penutupan hasil hanya dari fase Published (saat ini ${cycle.status} — §35-16)`);
  }
  const openAppeals = cycle.appraisals.filter((a) => a.status === "Appealed" || a.appealStatus === "Submitted").length;
  if (openAppeals > 0) {
    throw new Error(`Masih ada ${openAppeals} banding yang belum diputuskan — selesaikan dahulu (§35-16)`);
  }

  // reuse gerbang close P1 (konsisten: cek Appealed + status siklus + → Closed)
  await closeCycle(db, cycleId);
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Hasil siklus ${cycle.code} DITUTUP (Closed — read-only permanen; arsip sesuai retensi) oleh ${actor.name} (§35-16)`,
    },
  });
  return { code: cycle.code, status: "Closed" };
}
