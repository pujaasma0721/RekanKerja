// P5-PERF — merit, PA & surat (DEVELOPMENT-PLAN-PERFORMANCE.md §32 alur 8):
// draf MeritRecommendation otomatis utk peserta Closed (matrix aktif × finalRating,
// nominal dihitung dari assignment gaji pokok → VAULT enc), submit → approval
// nominal-tier AS-MERIT-STD (L1 HR_ADMIN; L2 Direktur bila nominal > Rp 10 jt — D12),
// penerapan toPayroll (assignment BONUS → PayrollRun periode terbuka + hitung +
// appliedRunNo bukti §35-18) / toPersonnelAction (PA SalaryAdjustment/Promotion —
// promosi rating ≥4 & band tinggi, override direksi ter-log §35-19), surat hasil
// penilaian (PERF_RESULT via mesin surat, kategori Performance), usul PIP rating ≤2.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  startApprovalChain, decideApprovalChain, attachChainSummaries,
  type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { nextRunNo, calculateAndSaveRun } from "@/rekankerja/payroll/services/payroll-service";
import { issueLetter } from "@/rekankerja/shared/services/letter-service";

function bad(msg: string): never { throw new Error(msg); }

/** Nominal > Rp 10 jt → jenjang L2 Direktur aktif (AS-MERIT-STD — D12). */
const DIRECTOR_TIER_MIN = 10_000_001;

/** Status usulan yang masih bisa diubah/diajukan ulang (Draft/Rejected — §32-2). */
function meritEditable(s: string): boolean { return s === "Draft" || s === "Rejected"; }

// ============ STRUKTUR AS-MERIT-STD + TEMPLATE SURAT (idempoten) ============

/** Pastikan struktur approval merit + template surat hasil ada (tenant baru via
 *  provisioning; tenant lama self-heal saat merit dibuka pertama kali). */
export async function ensureMeritInfrastructure(db: TenantDb): Promise<void> {
  const existing = await db.approvalStructure.findUnique({ where: { code: "AS-MERIT-STD" }, select: { id: true } });
  if (!existing) {
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
        code: "AS-MERIT-STD",
        name: "Persetujuan Usulan Merit (default)",
        docType: "MeritRecommendation",
        levels: {
          create: [
            { levelNo: 1, approverType: "HR_ADMIN", note: "L1 — HR review usulan nominal" },
            ...(directorPositionId
              ? [{ levelNo: 2, approverType: "POSISI", approverPositionId: directorPositionId, minAmount: DIRECTOR_TIER_MIN, note: `L2 Direktur — nominal > Rp 10 jt (D12)` }]
              : [{ levelNo: 2, approverType: "HR_ADMIN", minAmount: DIRECTOR_TIER_MIN, note: "L2 (jabatan direktur belum dipetakan — Admin/HR memutuskan)" }]),
          ],
        },
      },
    }).catch(() => null); // race tenant bootstrap — struktur unik per code
  }
  const tpl = await db.letterTemplate.findUnique({ where: { key: "PERF_RESULT" }, select: { id: true } });
  if (!tpl) {
    // seed dari katalog bawaan (sumber tunggal — sama dgn provisioning tenant baru)
    const { LETTER_TEMPLATE_DEFAULTS } = await import("@/rekankerja/shared/lib/letter-defaults");
    const def = LETTER_TEMPLATE_DEFAULTS.find((d) => d.key === "PERF_RESULT");
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

// ============ DAFTAR & USULAN ============

export interface MeritRow {
  id: string; docNo: string; appraisalId: string; appraisalDocNo: string; cycleCode: string;
  employeeName: string; employeeNo: string; unit: string | null;
  finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  matrixCode: string | null;
  bonusMonths: number | null; bonusAmount: number | null; raisePct: number | null; raiseAmount: number | null;
  note: string | null; status: string; personnelActionId: string | null; appliedRunNo: string | null;
  letterRefNo: string | null;
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

export async function listMerit(
  db: TenantDb,
  opts: { cycleId?: string; status?: string },
): Promise<{ rows: MeritRow[] }> {
  const where = {
    ...(opts.cycleId ? { appraisal: { cycleId: opts.cycleId } } : {}),
    ...(opts.status ? { status: opts.status } : {}),
  };
  const tc = tenantCryptoForDb(db as unknown as object);
  const recs = await db.meritRecommendation.findMany({
    where,
    include: {
      appraisal: {
        select: {
          docNo: true, finalScore: true, finalRating: true, potentialBand: true, cycleId: true,
          employee: { select: { fullName: true, employeeNo: true, orgUnit: { select: { name: true } } } },
        },
      },
    },
    orderBy: { docNo: "asc" },
  });
  const chains = await attachChainSummaries(db, "MeritRecommendation", recs.map((r) => ({ id: r.id })));
  const cycleCodes = new Map<string, string>();
  const cycleIds = [...new Set(recs.map((r) => r.appraisal.cycleId))];
  for (const cid of cycleIds) {
    const c = await db.performanceCycle.findUnique({ where: { id: cid }, select: { code: true } });
    if (c) cycleCodes.set(cid, c.code);
  }
  // kode matriks di-query langsung per panggilan (bukan cache proses — cache
  // akan kosong/stale setelah restart / rename matriks di Master Kinerja).
  const matrixIds = [...new Set(recs.map((r) => r.matrixId).filter((x): x is string => x != null))];
  const matrices = matrixIds.length
    ? await db.meritMatrix.findMany({ where: { id: { in: matrixIds } }, select: { id: true, code: true } })
    : [];
  const matrixBy = new Map(matrices.map((m) => [m.id, m.code]));
  // surat hasil terbit per appraisal — refNo terakhir (metaJson appraisalRef)
  const letters = await db.letterDocument.findMany({
    where: { templateKey: "PERF_RESULT" },
    select: { metaJson: true, refNo: true, issuedAt: true },
    orderBy: { issuedAt: "desc" },
  });
  const letterBy = new Map<string, string>();
  for (const l of letters) {
    try {
      const m = JSON.parse(l.metaJson ?? "{}") as { appraisalDocNo?: string; sourceRef?: string };
      // P5: sourceRef = appraisalDocNo (kunci idempoten issueLetter); dukung juga
      // kunci lama appraisalDocNo bila ada template yang menuliskannya eksplisit.
      const key = m.sourceRef ?? m.appraisalDocNo;
      if (key && !letterBy.has(key)) letterBy.set(key, l.refNo);
    } catch { /* abaikan */ }
  }
  return {
    rows: recs.map((r) => ({
      id: r.id, docNo: r.docNo, appraisalId: r.appraisalId, appraisalDocNo: r.appraisal.docNo,
      cycleCode: cycleCodes.get(r.appraisal.cycleId) ?? "—",
      employeeName: r.appraisal.employee.fullName, employeeNo: r.appraisal.employee.employeeNo,
      unit: r.appraisal.employee.orgUnit?.name ?? null,
      finalScore: r.appraisal.finalScore, finalRating: r.appraisal.finalRating, potentialBand: r.appraisal.potentialBand,
      matrixCode: r.matrixId ? (matrixBy.get(r.matrixId) ?? null) : null,
      bonusMonths: r.bonusMonths, bonusAmount: r.bonusAmount ? tc.decryptMoney(r.bonusAmount) : null,
      raisePct: r.raisePct, raiseAmount: r.raiseAmount ? tc.decryptMoney(r.raiseAmount) : null,
      note: r.note, status: r.status, personnelActionId: r.personnelActionId, appliedRunNo: r.appliedRunNo,
      letterRefNo: letterBy.get(r.appraisal.docNo) ?? null,
      chain: chains.get(r.id) ?? null,
    })),
  };
}

/** Draf usulan otomatis utk peserta Closed yang belum punya usulan (§32-1). */
export async function recommendAll(
  db: TenantDb,
  input: { cycleId: string; actor: string },
): Promise<{ created: number; skipped: number; noSalary: string[] }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (!["Published", "Closed"].includes(cycle.status)) bad(`Usulan merit hanya utk siklus yang hasilnya sudah dipublikasi/ditutup (${cycle.code} = ${cycle.status})`);
  const matrix = await db.meritMatrix.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
  if (!matrix) bad("Belum ada MeritMatrix aktif — buat di Master Kinerja → Merit Matrix");
  let grid: Record<string, { bonusMonths?: number; raisePct?: [number, number] }> = {};
  try { grid = JSON.parse(matrix.gridJson) as typeof grid; } catch { bad("gridJson MeritMatrix aktif tidak valid"); }

  const participants = await db.appraisalRecord.findMany({
    where: { cycleId: input.cycleId, status: "Closed", finalRating: { not: null } },
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true } },
    },
    orderBy: { docNo: "asc" },
  });
  const existing = await db.meritRecommendation.findMany({ where: { appraisalId: { in: participants.map((p) => p.id) } }, select: { appraisalId: true } });
  const existingSet = new Set(existing.map((e) => e.appraisalId));
  const tc = tenantCryptoForDb(db as unknown as object);

  let created = 0, skipped = 0;
  const noSalary: string[] = [];
  let seq = await db.meritRecommendation.count({ where: { docNo: { startsWith: `MER-${new Date().getFullYear()}` } } });
  for (const p of participants) {
    if (existingSet.has(p.id)) { skipped++; continue; }
    const cell = grid[String(p.finalRating)];
    if (!cell) { skipped++; continue; }
    const assignment = await db.employeeAssignment.findFirst({
      where: { employeeId: p.employee.id, validTo: null },
      orderBy: { validFrom: "desc" },
      select: { baseSalary: true },
    });
    const base = assignment ? tc.decryptMoney(assignment.baseSalary) ?? null : null;
    const bonusMonths = cell.bonusMonths ?? null;
    const raisePct = Array.isArray(cell.raisePct) && cell.raisePct.length === 2 ? (cell.raisePct[0] + cell.raisePct[1]) / 2 : null;
    if (base == null) noSalary.push(`${p.employee.employeeNo} — ${p.employee.fullName}`);
    seq++;
    await db.meritRecommendation.create({
      data: {
        docNo: `MER-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`,
        appraisalId: p.id,
        matrixId: matrix.id,
        bonusMonths,
        bonusAmount: base != null && bonusMonths ? tc.encryptMoney(Math.round(bonusMonths * base)) : null,
        raisePct: Array.isArray(cell.raisePct) && cell.raisePct.length === 2 ? (cell.raisePct[0] + cell.raisePct[1]) / 2 : null,
        raiseAmount: base != null && raisePct != null ? tc.encryptMoney(Math.round(base * raisePct / 100)) : null,
        note: base == null ? "Gaji pokok belum terdaftar (assignment aktif tanpa base salary) — nominal diisi manual oleh HR" : null,
        status: "Draft",
      },
    });
    created++;
  }
  await db.activityLog.create({
    data: {
      action: "Created", entity: "MeritRecommendation", entityId: input.cycleId,
      detail: `Usulan merit ${cycle.code} dibuat otomatis: ${created} draf (matrix ${matrix.code}; ${skipped} dilewati — sudah ada/tanpa sel rating)${noSalary.length ? `; ${noSalary.length} tanpa gaji pokok: ${noSalary.slice(0, 3).join(", ")}…` : ""} — oleh ${input.actor}`,
    },
  });
  return { created, skipped, noSalary };
}

/** HR menyesuaikan draf (nominal vault di-re-enkripsi). */
export async function updateMerit(
  db: TenantDb,
  input: { id: string; bonusMonths?: number | null; bonusAmount?: number | null; raisePct?: number | null; raiseAmount?: number | null; note?: string | null },
  actor: string,
): Promise<{ ok: true }> {
  const r = await db.meritRecommendation.findUnique({ where: { id: input.id } });
  if (!r) bad("Usulan merit tidak ditemukan");
  if (!meritEditable(r.status)) bad(`Hanya draf yang bisa diubah (status ${r.status})`);
  const tc = tenantCryptoForDb(db as unknown as object);
  await db.meritRecommendation.update({
    where: { id: input.id },
    data: {
      ...(input.bonusMonths !== undefined ? { bonusMonths: input.bonusMonths } : {}),
      ...(input.bonusAmount !== undefined ? { bonusAmount: input.bonusAmount == null ? null : tc.encryptMoney(input.bonusAmount) } : {}),
      ...(input.raisePct !== undefined ? { raisePct: input.raisePct } : {}),
      ...(input.raiseAmount !== undefined ? { raiseAmount: input.raiseAmount == null ? null : tc.encryptMoney(input.raiseAmount) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "MeritRecommendation", entityId: input.id,
      detail: `Usulan merit ${r.docNo} disesuaikan HR (draf) oleh ${actor}`,
    },
  });
  return { ok: true };
}

// ============ SUBMIT → APPROVAL (AS-MERIT-STD, nominal-tier D12) ============

export async function submitMerit(
  db: TenantDb,
  input: { id: string; actor: string },
): Promise<{ chainStatus: string }> {
  const r = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: { appraisal: { select: { employeeId: true, docNo: true, employee: { select: { fullName: true } } } } },
  });
  if (!r) bad("Usulan merit tidak ditemukan");
  if (!meritEditable(r.status)) bad(`Usulan sudah diajukan/diproses (status ${r.status})`);
  const existing = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: "MeritRecommendation", docId: r.id } },
    select: { id: true, status: true, currentLevel: true, totalLevels: true },
  });
  if (existing && existing.status === "InProgress") bad("Usulan ini sudah dalam persetujuan");
  if (existing) {
    // pengajuan ulang pasca-ditolak (§32-2 "dapat disunting dan diajukan ulang"):
    // chain lama terminal → arsipkan jejaknya di ActivityLog lalu ganti chain baru
    // (steps ikut cascade). Chain InProgress sudah ditolak di atas.
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "ApprovalChain", entityId: existing.id,
        detail: `Jalur persetujuan lama ${r.docNo} (status ${existing.status}, jenjang ${existing.currentLevel}/${existing.totalLevels}) dihapus utk pengajuan ulang oleh ${input.actor}`,
      },
    });
    await db.approvalChain.delete({ where: { id: existing.id } });
  }
  const tc = tenantCryptoForDb(db as unknown as object);
  const bonus = r.bonusAmount ? tc.decryptMoney(r.bonusAmount) ?? 0 : 0;
  const raise = r.raiseAmount ? tc.decryptMoney(r.raiseAmount) ?? 0 : 0;
  const nominal = Math.max(bonus, raise);
  await ensureMeritInfrastructure(db);
  const chain = await startApprovalChain(db, {
    docType: "MeritRecommendation",
    docId: r.id,
    employeeId: r.appraisal.employeeId, // tier dari dimensi karyawan yang dinilai (D4)
    amount: nominal, // D12 — nominal-tier: > Rp 10 jt mengaktifkan L2 Direktur
    createdBy: input.actor,
  });
  await db.meritRecommendation.update({ where: { id: r.id }, data: { status: "Submitted" } });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "MeritRecommendation", entityId: r.id,
      detail: `Usulan merit ${r.docNo} (${r.appraisal.docNo} — ${r.appraisal.employee.fullName}; bonus ${bonus ? `Rp ${bonus.toLocaleString("id-ID")}` : "—"}, kenaikan ${raise ? `Rp ${raise.toLocaleString("id-ID")}` : "—"}) diajukan${nominal >= DIRECTOR_TIER_MIN ? " — NOMINAL > Rp 10 jt: jenjang Direktur aktif (D12)" : ""} oleh ${input.actor}`,
    },
  });
  // notifikasi milestone: HR admin (L1) — pola kalibrasi
  const hrUsers = await db.appUser.findMany({ where: { role: { in: ["HR Manager", "HR Staff", "Admin"] }, active: true }, select: { id: true }, take: 10 });
  for (const u of hrUsers) {
    await db.notification.create({
      data: {
        appUserId: u.id,
        title: `Usulan merit ${r.docNo} menunggu persetujuan`,
        body: `Usulan merit ${r.appraisal.employee.fullName} (bonus ${r.bonusMonths ?? "—"} bln, kenaikan ${r.raisePct ?? "—"}%) menunggu keputusan Anda. Buka menu Performance → Hasil & 9-Box → tab Merit.`,
        kind: "performance",
        link: "performance:results",
      },
    }).catch(() => null);
  }
  return { chainStatus: chain.status };
}

export async function decideMerit(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject"; note?: string },
  actor: DecideActor,
): Promise<{ final: boolean; status: string }> {
  const r = await db.meritRecommendation.findUnique({ where: { id: input.id }, include: { appraisal: { select: { docNo: true, employee: { select: { fullName: true } } } } } });
  if (!r) bad("Usulan merit tidak ditemukan");
  const res = await decideApprovalChain(db, {
    docType: "MeritRecommendation", docId: input.id,
    action: input.action, note: input.note, actor,
  });
  if (res.final && input.action === "approve") {
    await db.meritRecommendation.update({ where: { id: input.id }, data: { status: "Approved" } });
    await db.activityLog.create({
      data: { action: "Processed", entity: "MeritRecommendation", entityId: input.id, detail: `Usulan merit ${r.docNo} DISETUJUI penuh — siap diterapkan (payroll / personnel action)` },
    });
  } else if (input.action === "reject") {
    await db.meritRecommendation.update({ where: { id: input.id }, data: { status: "Rejected" } });
    await db.activityLog.create({
      data: { action: "Processed", entity: "MeritRecommendation", entityId: input.id, detail: `Usulan merit ${r.docNo} DITOLAK di jenjang${input.note ? ` (“${input.note.trim()}”)` : ""} — dapat disunting dan diajukan ulang` },
    });
  }
  return { final: res.final, status: input.action === "approve" ? (res.final ? "Approved" : "InProgress") : "Rejected" };
}

// ============ PENERAPAN (§32-3 — guard §35-18/19) ============

/** Bonus diserap ke PayrollRun BONUS periode terbuka berikutnya (pola bonus
 *  massal): assignment Specific + run dibuat bila belum ada + hitung ulang. */
export async function toPayroll(
  db: TenantDb,
  input: { id: string; actor: string },
): Promise<{ runNo: string; calculated: boolean }> {
  const r = await db.meritRecommendation.findUnique({ where: { id: input.id }, include: { appraisal: { select: { docNo: true, employeeId: true, employee: { select: { fullName: true, employeeNo: true } } } } } });
  if (!r) bad("Usulan merit tidak ditemukan");
  if (r.status === "Applied") bad("Sudah diterapkan (Applied) — tidak boleh dua kali (§35-18)");
  if (r.status !== "Approved") bad(`Penerapan hanya utk usulan Approved (status ${r.status})`);
  if (r.appliedRunNo) bad(`Bonus sudah terserap ke run ${r.appliedRunNo}`);
  const tc = tenantCryptoForDb(db as unknown as object);
  const bonus = r.bonusAmount ? tc.decryptMoney(r.bonusAmount) ?? 0 : null;
  if (!bonus || bonus <= 0) bad("Nominal bonus kosong — isi draf nominal bonus atau gunakan PA saja (kenaikan gaji)");

  const component = await db.wageComponent.findFirst({ where: { code: "BONUS" }, select: { id: true, code: true, name: true } });
  if (!component) bad("Komponen upah BONUS belum tersedia (seed payroll belum dijalankan)");
  const bonusPt = await db.processType.findFirst({ where: { code: "BONUS" }, select: { id: true, code: true, name: true, calculateTax: true } });
  if (!bonusPt) bad("ProcessType BONUS belum tersedia");

  // periode terbuka berikutnya dgn run BONUS Draft (atau belum ada run)
  const openPeriods = await db.payrollPeriod.findMany({ where: { status: "Open" }, orderBy: { code: "asc" } });
  let period: { id: string; code: string; name: string } | null = null;
  let run: { id: string; runNo: string; status: string } | null = null;
  for (const p of openPeriods) {
    const existing = await db.payrollRun.findFirst({ where: { periodId: p.id, processTypeId: bonusPt.id, status: { not: "Cancelled" } } });
    if (!existing || existing.status === "Draft") { period = p; run = existing ? { id: existing.id, runNo: existing.runNo, status: existing.status } : null; break; }
  }
  if (!period) bad("Tidak ada periode payroll terbuka dgn run BONUS yang bisa menerima (buat periode baru atau batalkan run terkunci)");

  // guard duplikat assignment (pola bonus massal M-3a)
  const dup = await db.employeeComponentAssignment.findFirst({
    where: { employeeId: r.appraisal.employeeId, kind: "Specific", active: true, periodId: period.id, processTypeId: bonusPt.id, wageComponentId: component.id },
  });
  if (dup) bad(`Assignment BONUS ${period.code} sudah ada utk karyawan ini — hapus assignment lama (Transaksi & Rapel) dulu`);

  await db.employeeComponentAssignment.create({
    data: {
      employeeId: r.appraisal.employeeId,
      wageComponentId: component.id,
      kind: "Specific",
      amount: tc.encryptMoney(bonus),
      periodId: period.id,
      processTypeId: bonusPt.id,
      basedDate: new Date(),
      notes: `Merit ${r.docNo} (${r.appraisal.docNo}) — bonus kinerja`,
    },
  });
  let runId = run?.id;
  if (!runId) {
    const runNo = await nextRunNo(db, period.code, bonusPt.code);
    const created = await db.payrollRun.create({
      data: {
        runNo, periodId: period.id, processTypeId: bonusPt.id,
        calculateTax: bonusPt.calculateTax, allEmployee: true,
        notes: `Run BONUS merit — ${r.docNo} (${period.name})`,
      },
    });
    runId = created.id;
    await db.activityLog.create({
      data: { action: "Created", entity: "PayrollRun", entityId: created.id, detail: `Run ${runNo} dibuat otomatis dari merit ${r.docNo} (${period.name} × BONUS)` },
    });
  }
  await calculateAndSaveRun(db, runId);
  const runAfter = await db.payrollRun.findUnique({ where: { id: runId }, select: { runNo: true } });

  await db.meritRecommendation.update({
    where: { id: input.id },
    data: { appliedRunNo: runAfter?.runNo ?? "", status: "Applied" },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "MeritRecommendation", entityId: input.id,
      detail: `Merit ${r.docNo} DITERAPKAN KE PAYROLL: bonus Rp ${bonus.toLocaleString("id-ID")} → assignment BONUS ${period.name} + run ${runAfter?.runNo} dihitung (${r.appraisal.employee.fullName}) — oleh ${input.actor}`,
    },
  });
  // notifikasi milestone ke karyawan
  const users = await db.appUser.findMany({ where: { employeeId: r.appraisal.employeeId, active: true }, select: { id: true }, take: 5 });
  for (const u of users) {
    await db.notification.create({
      data: {
        appUserId: u.id,
        title: `Bonus kinerja diproses ke payroll (${r.docNo})`,
        body: `Bonus kinerja dari hasil penilaian Anda telah diserap ke payroll periode ${period.name} dan akan dibayarkan bersama run berikutnya.`,
        kind: "performance",
        link: "ess:my-appraisal",
      },
    }).catch(() => null);
  }
  return { runNo: runAfter?.runNo ?? "", calculated: true };
}

/** Kenaikan gaji / promosi → PersonnelAction (pola PA modul HR Base). */
export async function toPersonnelAction(
  db: TenantDb,
  input: { id: string; type?: "SalaryAdjustment" | "Promotion"; effectiveDate?: string; overrideReason?: string; actor: string },
): Promise<{ personnelActionId: string; docNo: string }> {
  const r = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: { appraisal: { select: { docNo: true, employeeId: true, finalRating: true, potentialBand: true, employee: { select: { fullName: true, status: true } } } } },
  });
  if (!r) bad("Usulan merit tidak ditemukan");
  if (r.status !== "Approved" && r.status !== "Applied") bad(`PA hanya dari usulan Approved/Applied (status ${r.status})`);
  if (r.personnelActionId) bad(`PA sudah digulirkan utk usulan ini (§35-19)`);
  const type = input.type === "Promotion" ? "Promotion" : "SalaryAdjustment";
  const emp = r.appraisal.employee;
  if (emp.status !== "Active") bad(`Karyawan berstatus ${emp.status} — PA hanya utk karyawan Active`);

  if (type === "Promotion") {
    // §32-guard: promosi hanya bila rating ≥ 4 & band potensi tinggi (3) —
    // override direksi diperbolehkan DENGAN alasan ter-ActivityLog.
    if ((r.appraisal.finalRating ?? 0) < 4 || (r.appraisal.potentialBand ?? 0) < 3) {
      const reason = input.overrideReason?.trim();
      if (!reason || reason.length < 10) {
        bad(`Promosi ditolak: rating ${r.appraisal.finalRating ?? "—"} (butuh ≥4) & band 9-box ${r.appraisal.potentialBand ?? "—"} (butuh 3). Override direksi wajib alasan ≥10 karakter.`);
      }
      await db.activityLog.create({
        data: {
          action: "Processed", entity: "MeritRecommendation", entityId: input.id,
          detail: `OVERRIDE DIREKSI — promosi ${r.docNo} dipaksa melewati guard rating/band: “${reason}” oleh ${input.actor}`,
        },
      });
    }
  }

  const tc = tenantCryptoForDb(db as unknown as object);
  const raise = r.raiseAmount ? tc.decryptMoney(r.raiseAmount) ?? 0 : 0;
  const assignment = await db.employeeAssignment.findFirst({
    where: { employeeId: r.appraisal.employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { baseSalary: true, positionId: true, orgUnitId: true, gradeId: true },
  });
  const base = assignment ? tc.decryptMoney(assignment.baseSalary) ?? null : null;
  const newSalary = base != null && r.raisePct ? Math.round(base * (1 + r.raisePct / 100)) : null;

  const last = await db.personnelAction.findFirst({ orderBy: { docNo: "desc" }, select: { docNo: true } });
  const nextNo = last ? Number(last.docNo.split("-").pop()) + 1 : 1;
  const docNo = `PA-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;
  const template = await db.approvalTemplate.findFirst({ where: { code: "AT-PA-STD" } });
  const layersDef: { layer: number; role: string }[] = template ? JSON.parse(template.layersJson) : [{ layer: 1, role: "HR Manager" }];
  // resolusi approver awal per layer (pola personnel-actions POST — fix K-03):
  // Dept Head → AppUser atasan langsung karyawan; lainnya → AppUser role cocok.
  const cur = await db.employeeAssignment.findFirst({
    where: { employeeId: r.appraisal.employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { managerId: true },
  });
  let managerApproverId: string | null = null;
  if (cur?.managerId) {
    const mgrUser = await db.appUser.findFirst({ where: { employeeId: cur.managerId, active: true }, select: { id: true } });
    managerApproverId = mgrUser?.id ?? null;
  }
  const otherRoles = [...new Set(layersDef.map((l) => l.role).filter((rr) => rr !== "Dept Head"))];
  const roleApprover: Record<string, string | null> = {};
  for (const rr of otherRoles) {
    const u = await db.appUser.findFirst({ where: { role: rr, active: true }, select: { id: true } });
    roleApprover[rr] = u?.id ?? null;
  }
  const pa = await db.personnelAction.create({
    data: {
      docNo, employeeId: r.appraisal.employeeId, type,
      effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : new Date(),
      reason: `Merit ${r.docNo} dari penilaian ${r.appraisal.docNo} (rating ${r.appraisal.finalRating ?? "—"}${r.raisePct != null ? `, kenaikan ${r.raisePct}%` : ""})`,
      detailJson: JSON.stringify({
        ...(base != null ? { currentSalary: base } : {}),
        ...(newSalary != null ? { newSalary } : {}),
        ...(r.raisePct != null ? { raisePct: r.raisePct } : {}),
        meritDocNo: r.docNo, appraisalDocNo: r.appraisal.docNo,
        ...(type === "Promotion" ? { positionId: assignment?.positionId ?? null } : {}),
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
  await db.meritRecommendation.update({
    where: { id: input.id },
    data: {
      personnelActionId: pa.id,
      // tanpa bonus → PA adalah seluruh konsekuensi → Applied
      ...(r.bonusAmount ? {} : { status: "Applied" }),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PersonnelAction", entityId: pa.id,
      detail: `PA ${type} ${docNo} digulirkan dari merit ${r.docNo}${newSalary != null ? ` (gaji → Rp ${newSalary.toLocaleString("id-ID")})` : ""} oleh ${input.actor}`,
    },
  });
  return { personnelActionId: pa.id, docNo };
}

export async function cancelMerit(
  db: TenantDb,
  input: { id: string; reason: string; actor: string },
): Promise<{ ok: true }> {
  const r = await db.meritRecommendation.findUnique({ where: { id: input.id } });
  if (!r) bad("Usulan merit tidak ditemukan");
  if (r.status === "Applied") bad("Usulan sudah diterapkan — tidak bisa dibatalkan");
  if (r.status === "Cancelled") bad("Sudah dibatalkan");
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan pembatalan wajib ≥10 karakter (ter-audit)");
  await db.meritRecommendation.update({ where: { id: input.id }, data: { status: "Cancelled", note: reason } });
  await db.activityLog.create({
    data: { action: "Processed", entity: "MeritRecommendation", entityId: input.id, detail: `Usulan merit ${r.docNo} DIBATALKAN oleh ${input.actor} — “${reason}”` },
  });
  return { ok: true };
}

// ============ SURAT HASIL PENILAIAN (§32-4 — pola surat, opsional massal) ============

export async function issueResultLetter(
  db: TenantDb,
  input: { meritId?: string; appraisalId?: string; cycleId?: string; actorId?: string | null; actor: string },
): Promise<{ issued: { id: string; refNo: string; employeeName: string }[]; skipped: number }> {
  const targets = [] as { appraisalId: string; employeeId: string; docNo: string }[];
  if (input.cycleId) {
    // MODE MASSAL (§32-4): seluruh peserta siklus yang sudah punya hasil final
    // (rating terisi) — issueLetter idempoten per sourceRef, yang sudah bersurat dilewati.
    const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, status: true } });
    if (!cycle) bad("Siklus tidak ditemukan");
    if (!["Published", "Appealed", "Closed"].includes(cycle.status)) {
      bad(`Surat hasil hanya utk siklus yang sudah dipublikasi (${cycle.code} = ${cycle.status})`);
    }
    const rows = await db.appraisalRecord.findMany({
      where: { cycleId: input.cycleId, finalRating: { not: null } },
      select: { id: true, employeeId: true, docNo: true },
      orderBy: { docNo: "asc" },
    });
    for (const a of rows) targets.push({ appraisalId: a.id, employeeId: a.employeeId, docNo: a.docNo });
  } else if (input.meritId) {
    const r = await db.meritRecommendation.findUnique({ where: { id: input.meritId }, include: { appraisal: { select: { id: true, employeeId: true, docNo: true } } } });
    if (!r) bad("Usulan merit tidak ditemukan");
    targets.push({ appraisalId: r.appraisal.id, employeeId: r.appraisal.employeeId, docNo: r.appraisal.docNo });
  } else if (input.appraisalId) {
    const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, select: { id: true, employeeId: true, docNo: true } });
    if (!a) bad("Peserta tidak ditemukan");
    targets.push({ appraisalId: a.id, employeeId: a.employeeId, docNo: a.docNo });
  } else {
    bad("meritId, appraisalId, atau cycleId wajib");
  }
  await ensureMeritInfrastructure(db);
  const issued: { id: string; refNo: string; employeeName: string }[] = [];
  let skipped = 0;
  for (const t of targets) {
    const a = await db.appraisalRecord.findUnique({
      where: { id: t.appraisalId },
      include: { cycle: { select: { periodStart: true, periodEnd: true } } },
    });
    if (!a) bad("Peserta tidak ditemukan");
    const rating = a.finalRating != null
      ? await db.ratingScale.findFirst({ where: { value: a.finalRating }, select: { labelId: true } })
      : null;
    const periodLabel = `${a.cycle.periodStart.getFullYear()}–${a.cycle.periodEnd.getFullYear()}`.replace(/^(\d{4})–\1$/, "$1");
    // idempoten massal: yang sudah bersurat tidak diterbitkan ulang (hitung skip)
    const already = await db.letterDocument.findFirst({
      where: { templateKey: "PERF_RESULT", metaJson: { contains: `"sourceRef":"${t.docNo}"` } },
      select: { id: true },
    });
    if (already) { skipped++; continue; }
    const letter = await issueLetter(db, {
      category: "Performance",
      templateKey: "PERF_RESULT",
      employeeId: t.employeeId,
      actorId: input.actorId ?? null,
      sourceRef: t.docNo,
      extraContext: {
        appraisal_doc_no: t.docNo,
        final_score: a.finalScore != null ? a.finalScore.toFixed(1) : "—",
        final_rating: String(a.finalRating ?? "—"),
        final_rating_label: rating?.labelId ?? "—",
        period_label: periodLabel,
      },
    });
    issued.push({ id: letter.id, refNo: letter.refNo, employeeName: letter.employeeName });
  }
  await db.activityLog.create({
    data: {
      action: "Created", entity: "LetterDocument", entityId: issued[0]?.id ?? input.meritId ?? input.cycleId ?? "",
      detail: `Surat hasil penilaian diterbitkan (${issued.length} karyawan${skipped ? `, ${skipped} dilewati — sudah bersurat` : ""}: ${issued.map((i) => i.refNo).join(", ")}) oleh ${input.actor}`,
    },
  });
  return { issued, skipped };
}

// ============ USUL PIP (§32-5 — rating ≤2 pasca-penutupan) ============

export async function pipProposals(
  db: TenantDb,
  opts: { cycleId?: string },
): Promise<{
  proposals: { appraisalId: string; docNo: string; employeeName: string; employeeNo: string; unit: string | null; finalScore: number | null; finalRating: number | null; existingPipStatus: string | null; dismissedAt: string | null }[];
}> {
  const where = {
    status: "Closed" as const,
    finalRating: { lte: 2 },
    ...(opts.cycleId ? { cycleId: opts.cycleId } : {}),
  };
  const rows = await db.appraisalRecord.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true, employeeNo: true, orgUnit: { select: { name: true } } } },
    },
    orderBy: { docNo: "asc" },
  });
  const proposals = [] as {
    appraisalId: string; docNo: string; employeeName: string; employeeNo: string; unit: string | null;
    finalScore: number | null; finalRating: number | null; existingPipStatus: string | null; dismissedAt: string | null;
  }[];
  for (const r of rows) {
    const pip = await db.pipPlan.findFirst({
      // PIP yang masih berjalan = semua KECUALI terminal (Recovered/NotRecovered/Cancelled)
      where: { employeeId: r.employee.id, status: { notIn: ["Recovered", "NotRecovered", "Cancelled"] } },
      orderBy: { createdAt: "desc" }, select: { status: true },
    });
    // keputusan "tidak menjalankan PIP" ter-audit di ActivityLog — agar tombol
    // tidak menggoda ulang, tandai proposal yang sudah diputus (dismissedAt).
    const dismissed = await db.activityLog.findFirst({
      where: { entity: "AppraisalRecord", entityId: r.id, action: "Processed", detail: { startsWith: `USUL PIP DITUNDA/DITOLAK utk ${r.docNo}` } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    proposals.push({
      appraisalId: r.id, docNo: r.docNo,
      employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      unit: r.employee.orgUnit?.name ?? null,
      finalScore: r.finalScore, finalRating: r.finalRating,
      existingPipStatus: pip?.status ?? null,
      dismissedAt: dismissed ? dismissed.createdAt.toISOString() : null,
    });
  }
  return { proposals };
}

/** Catat keputusan TIDAK menjalankan PIP (alasan ter-audit — §32-5). */
export async function dismissPipProposal(
  db: TenantDb,
  input: { appraisalId: string; reason: string; actor: string },
): Promise<{ ok: true }> {
  const a = await db.appraisalRecord.findUnique({ where: { id: input.appraisalId }, include: { employee: { select: { fullName: true } } } });
  if (!a) bad("Peserta tidak ditemukan");
  const reason = input.reason.trim();
  if (reason.length < 10) bad("Alasan tidak menjalankan PIP wajib ≥10 karakter (ter-audit)");
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "AppraisalRecord", entityId: input.appraisalId,
      detail: `USUL PIP DITUNDA/DITOLAK utk ${a.docNo} (${a.employee.fullName}, rating ${a.finalRating ?? "—"}): “${reason}” oleh ${input.actor}`,
    },
  });
  return { ok: true };
}
