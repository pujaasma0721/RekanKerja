// P1-PERF — service target & KPI (DEVELOPMENT-PLAN-PERFORMANCE.md §26; §18.1
// KPI Builder + §18.2 salin dari periode sebelumnya AMANDEMEN 1 + §18.5
// impor Excel AMANDEMEN 2 + §18.7 autosave draf). Guard §35 baris 3–5, 24–26.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

function bad(msg: string): never { throw new Error(msg); }

const STATUS_RANK = ["Enrolled", "GoalProposed", "GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
function rank(s: string): number { return STATUS_RANK.indexOf(s); }

// ============ tipe ============

export interface KpiRowInput {
  id?: string;
  kpiDefId?: string | null;
  title: string;
  polarity: string; // Higher|Lower|Boolean
  unit: string;
  thresholdMin?: number | null;
  target: number;
  stretchValue?: number | null;
  weight: number;
  isCritical?: boolean;
  dataSource?: string;
  sourceKey?: string | null;
}

// ============ LIST ============

export async function listParticipants(
  db: TenantDb,
  opts: { cycleId: string; q?: string; managerId?: string; onlyWithoutKpi?: boolean; offset?: number; limit?: number },
) {
  const where: Record<string, unknown> = { cycleId: opts.cycleId };
  if (opts.managerId) where.managerId = opts.managerId;
  const rows = await db.appraisalRecord.findMany({
    where,
    include: {
      employee: {
        select: {
          employeeNo: true, fullName: true,
          position: { select: { title: true } },
          orgUnit: { select: { name: true } },
        },
      },
      manager: { select: { id: true, fullName: true } },
      kpis: { select: { target: true, thresholdMin: true, polarity: true, weight: true } },
    },
    orderBy: { docNo: "asc" },
  });
  let out = rows.map((a) => {
    let filled = 0;
    for (const k of a.kpis) {
      if (k.target != null && (k.polarity === "Boolean" || k.thresholdMin != null)) filled++;
    }
    return {
      appraisalId: a.id,
      docNo: a.docNo,
      employeeId: a.employeeId,
      employeeNo: a.employee.employeeNo,
      employeeName: a.employee.fullName,
      position: a.employee.position?.title ?? null,
      orgUnit: a.employee.orgUnit?.name ?? null,
      managerId: a.managerId,
      managerName: a.manager?.fullName ?? null,
      status: a.status,
      goalsCopiedFrom: a.goalsCopiedFrom,
      kpiCount: a.kpis.length,
      weightSum: a.kpis.reduce((s, k) => s + k.weight, 0),
      progressPct: a.kpis.length === 0 ? 0 : Math.round((filled / a.kpis.length) * 100),
      submittedAt: a.status === "GoalApproved" || rank(a.status) >= rank("GoalApproved"),
    };
  });
  if (opts.q) {
    const q = opts.q.toLowerCase();
    out = out.filter((r) => r.employeeName.toLowerCase().includes(q) || r.employeeNo.toLowerCase().includes(q));
  }
  if (opts.onlyWithoutKpi) out = out.filter((r) => r.kpiCount === 0);
  const total = out.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 200;
  return { rows: out.slice(offset, offset + limit), total };
}

/** Detail KPI satu peserta (builder). */
export async function getGoalsDetail(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      employee: {
        select: {
          id: true, employeeNo: true, fullName: true,
          position: { select: { title: true } },
          orgUnit: { select: { name: true } },
        },
      },
      manager: { select: { id: true, fullName: true } },
      cycle: true,
      kpis: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!a) bad("Peserta tidak ditemukan");
  return a;
}

async function requireEditableGoals(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: { cycle: { select: { code: true, status: true, goalEnd: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status !== "GoalSetting") bad(`Fase siklus ${a.cycle.code} bukan GoalSetting — target terkunci (§35-24)`);
  if (rank(a.status) >= rank("GoalApproved")) bad(`Target peserta sudah dikunci (${a.status}) — perubahan hanya lewat revisi mid-year (§35-3)`);
  return a;
}

// ============ ASSIGN BATCH (builder langkah 2–3) ============

export async function assignBatch(
  db: TenantDb,
  input: { appraisalId: string; kpis: KpiRowInput[] },
  actor: string,
): Promise<{ count: number }> {
  const a = await requireEditableGoals(db, input.appraisalId);
  // hapus baris lama (draf builder — bukan usulan karyawan; usulan dilewati bila status GoalProposed dari employee → atasan sedang review)
  await db.appraisalKpi.deleteMany({ where: { appraisalId: input.appraisalId, proposedBy: "Manager" } });
  let n = 0;
  for (const k of input.kpis) {
    await db.appraisalKpi.create({
      data: {
        appraisalId: input.appraisalId,
        kpiDefId: k.kpiDefId ?? null,
        title: k.title,
        polarity: k.polarity,
        unit: k.unit,
        thresholdMin: k.thresholdMin ?? null,
        target: k.target,
        stretchValue: k.stretchValue ?? null,
        weight: k.weight,
        isCritical: k.isCritical ?? false,
        dataSource: k.dataSource ?? "Manual",
        sourceKey: k.sourceKey ?? null,
        proposedBy: "Manager",
        origin: k.kpiDefId ? "Template" : "Fresh",
      },
    });
    n++;
  }
  void a;
  void actor;
  return { count: n };
}

/** Autosave satu baris draf (§18.7) — PATCH debounce dari builder. */
export async function saveKpiRow(db: TenantDb, input: { kpiId: string; patch: Partial<KpiRowInput> }): Promise<void> {
  const row = await db.appraisalKpi.findUnique({ where: { id: input.kpiId }, include: { appraisal: { select: { id: true, status: true, cycleId: true } } } });
  if (!row) bad("Baris KPI tidak ditemukan");
  const a = await db.appraisalRecord.findUnique({ where: { id: row.appraisal.id }, include: { cycle: { select: { status: true, code: true } } } });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status !== "GoalSetting" || rank(a.status) >= rank("GoalApproved")) {
    bad("Draf hanya dapat disimpan selama fase GoalSetting sebelum submit (§18.7/§35-24)");
  }
  const p = input.patch;
  await db.appraisalKpi.update({
    where: { id: input.kpiId },
    data: {
      ...(p.title != null ? { title: p.title } : {}),
      ...(p.polarity != null ? { polarity: p.polarity } : {}),
      ...(p.unit != null ? { unit: p.unit } : {}),
      ...(p.thresholdMin !== undefined ? { thresholdMin: p.thresholdMin } : {}),
      ...(p.target !== undefined ? { target: p.target } : {}),
      ...(p.stretchValue !== undefined ? { stretchValue: p.stretchValue } : {}),
      ...(p.weight !== undefined ? { weight: p.weight } : {}),
      ...(p.isCritical !== undefined ? { isCritical: p.isCritical } : {}),
    },
  });
}

export async function addKpiRow(db: TenantDb, input: { appraisalId: string; kpi: KpiRowInput }): Promise<string> {
  await requireEditableGoals(db, input.appraisalId);
  const k = input.kpi;
  const row = await db.appraisalKpi.create({
    data: {
      appraisalId: input.appraisalId,
      kpiDefId: k.kpiDefId ?? null,
      title: k.title,
      polarity: k.polarity,
      unit: k.unit,
      thresholdMin: k.thresholdMin ?? null,
      target: k.target,
      stretchValue: k.stretchValue ?? null,
      weight: k.weight,
      isCritical: k.isCritical ?? false,
      dataSource: k.dataSource ?? "Manual",
      sourceKey: k.sourceKey ?? null,
      proposedBy: "Manager",
      origin: k.kpiDefId ? "Template" : "Fresh",
    },
  });
  return row.id;
}

export async function deleteKpiRow(db: TenantDb, kpiId: string): Promise<void> {
  const row = await db.appraisalKpi.findUnique({ where: { id: kpiId }, select: { appraisalId: true } });
  if (!row) bad("Baris KPI tidak ditemukan");
  await requireEditableGoals(db, row.appraisalId);
  await db.appraisalKpi.delete({ where: { id: kpiId } });
}

// ============ SUBMIT / LOCK (§26-5, guard §35-3) ============

export async function submitGoals(db: TenantDb, appraisalId: string, actor: string): Promise<void> {
  const a = await requireEditableGoals(db, appraisalId);
  const kpis = await db.appraisalKpi.findMany({ where: { appraisalId } });
  if (kpis.length < 3 || kpis.length > 8) bad(`Jumlah KPI harus 3–8 item (sekarang ${kpis.length}) — §35-3`);
  const weightSum = kpis.reduce((s, k) => s + k.weight, 0);
  if (Math.abs(weightSum - 100) > 0.01) bad(`Jumlah bobot KPI harus 100 (sekarang ${weightSum}) — §35-3`);
  for (const k of kpis) {
    if (!k.unit?.trim()) bad(`KPI "${k.title}" belum punya satuan — §35-3`);
    if (k.polarity === "Boolean") {
      if (!k.isCritical) bad(`KPI Boolean "${k.title}" wajib menandai gagal/sukses kritis (isCritical) — §35-3`);
    } else if (k.thresholdMin == null) {
      bad(`KPI "${k.title}" belum punya ambang gagal (F) — §35-3`);
    }
    if (k.target == null) bad(`KPI "${k.title}" belum punya target (T) — §35-3`);
  }
  const kpiTotalWeight = weightSum;
  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: { status: "GoalApproved", kpiTotalWeight },
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "AppraisalRecord", entityId: appraisalId,
      detail: `Target KPI ${a.cycle.code} peserta ${a.docNo} dikunci (GoalApproved) oleh ${actor} — ${kpis.length} KPI, Σbobot ${weightSum}`,
    },
  });
}

// ============ MBO: USULAN KARYAWAN (§26-4, ESS) ============

export async function proposeGoals(db: TenantDb, input: { appraisalId: string; kpis: KpiRowInput[] }, actor: string): Promise<void> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: { cycle: { select: { code: true, status: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status !== "GoalSetting") bad("Fase penetapan target belum/sudah tutup — usulan hanya saat GoalSetting (§35-4)");
  if (rank(a.status) >= rank("GoalApproved")) bad("Target sudah dikunci — tidak dapat mengusulkan (§35-4)");
  if (input.kpis.length === 0) bad("Usulan kosong");
  await db.appraisalKpi.deleteMany({ where: { appraisalId: input.appraisalId, proposedBy: "Employee" } });
  for (const k of input.kpis) {
    await db.appraisalKpi.create({
      data: {
        appraisalId: input.appraisalId,
        kpiDefId: k.kpiDefId ?? null,
        title: k.title,
        polarity: k.polarity,
        unit: k.unit,
        thresholdMin: k.thresholdMin ?? null,
        target: k.target,
        stretchValue: k.stretchValue ?? null,
        weight: k.weight,
        isCritical: k.isCritical ?? false,
        dataSource: k.dataSource ?? "Manual",
        sourceKey: k.sourceKey ?? null,
        proposedBy: "Employee",
        origin: "EmployeeProposal",
      },
    });
  }
  await db.appraisalRecord.update({ where: { id: input.appraisalId }, data: { status: "GoalProposed" } });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "AppraisalRecord", entityId: input.appraisalId,
      detail: `Usulan KPI (MBO) diajukan karyawan untuk ${a.docNo} (${input.kpis.length} item) — menunggu keputusan atasan`,
    },
  });
  void actor;
}

export async function decideProposal(
  db: TenantDb,
  input: { appraisalId: string; decision: "approve" | "reject" | "edit" },
  actor: string,
): Promise<void> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: { cycle: { select: { code: true, status: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.status !== "GoalProposed") bad("Tidak ada usulan KPI yang menunggu keputusan (status harus GoalProposed)");
  if (input.decision === "reject") {
    await db.appraisalKpi.deleteMany({ where: { appraisalId: input.appraisalId, proposedBy: "Employee" } });
    await db.appraisalRecord.update({ where: { id: input.appraisalId }, data: { status: "Enrolled" } });
    await db.activityLog.create({
      data: {
        action: "Rejected", entity: "AppraisalRecord", entityId: input.appraisalId,
        detail: `Usulan KPI ${a.docNo} ditolak atasan — peserta kembali Enrolled`,
      },
    });
    return;
  }
  if (input.decision === "approve") {
    // usulan jadikan baris resmi lalu langsung dikunci (submit)
    await db.appraisalKpi.updateMany({ where: { appraisalId: input.appraisalId, proposedBy: "Employee" }, data: { proposedBy: "Manager" } });
    await db.appraisalKpi.deleteMany({ where: { appraisalId: input.appraisalId, proposedBy: "Manager", origin: { not: "EmployeeProposal" } } });
    await submitGoals(db, input.appraisalId, actor);
    return;
  }
  // edit: ambil alih ke builder (baris usulan jadi draf atasan bisa diubah)
  await db.appraisalKpi.updateMany({ where: { appraisalId: input.appraisalId, proposedBy: "Employee" }, data: { proposedBy: "Manager" } });
  await db.appraisalRecord.update({ where: { id: input.appraisalId }, data: { status: "Enrolled" } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "AppraisalRecord", entityId: input.appraisalId,
      detail: `Usulan KPI ${a.docNo} diambil alih atasan untuk disunting (MBO)`,
    },
  });
}

// ============ SALIN DARI PERIODE SEBELUMNYA (§18.2 AMANDEMEN 1) ============

/** Daftar siklus sumber untuk salinan (D15: periodEnd < periodStart siklus aktif). */
export async function copySources(db: TenantDb, cycleId: string) {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const candidates = await db.performanceCycle.findMany({
    where: { periodEnd: { lt: cycle.periodStart } },
    orderBy: { periodEnd: "desc" },
    select: { id: true, code: true, name: true, periodStart: true, periodEnd: true, status: true },
  });
  const out = [];
  for (const c of candidates) {
    // hitung peserta aktif yang punya KPI terkunci di siklus kandidat
    const withKpi = await db.appraisalRecord.count({
      where: {
        cycleId: c.id,
        employeeId: { in: (await db.appraisalRecord.findMany({ where: { cycleId }, select: { employeeId: true } })).map((x) => x.employeeId) },
        status: { in: ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"] },
        kpis: { some: {} },
      },
    });
    if (withKpi > 0) out.push({ ...c, participantsWithSource: withKpi });
  }
  return { cycles: out };
}

/** Resolusi sumber default (D15): siklus terdahulu terdekat peserta sama dengan ≥1 KPI terkunci. */
export async function resolveSource(db: TenantDb, cycleId: string, employeeId: string) {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { periodStart: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const sources = await db.appraisalRecord.findMany({
    where: {
      employeeId,
      status: { in: ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"] },
      kpis: { some: {} },
      cycle: { periodEnd: { lt: cycle.periodStart } },
    },
    orderBy: [{ cycle: { periodEnd: "desc" } }],
    include: { cycle: { select: { id: true, code: true, name: true, periodEnd: true } } },
    take: 5,
  });
  return sources.map((s) => ({
    appraisalId: s.id,
    cycleId: s.cycle.id,
    cycleCode: s.cycle.code,
    cycleName: s.cycle.name,
    periodEnd: s.cycle.periodEnd,
  }));
}

/** Pratinjau salinan (§18.2 dialog): baris periode lalu + flag amber. */
export async function copyPreview(db: TenantDb, input: { cycleId: string; employeeId: string; sourceCycleId?: string }) {
  const a = await requireEditableGoals(db, (await db.appraisalRecord.findFirst({
    where: { cycleId: input.cycleId, employeeId: input.employeeId },
    select: { id: true },
  }))?.id ?? "");
  const sources = await resolveSource(db, input.cycleId, input.employeeId);
  if (sources.length === 0) bad("Peserta tidak punya siklus sumber dengan KPI terkunci (D15) — gunakan template jabatan atau mulai kosong");
  const chosen = input.sourceCycleId
    ? sources.find((s) => s.cycleId === input.sourceCycleId) ?? bad("Siklus sumber tidak valid untuk peserta ini")
    : sources[0];
  const srcAppraisal = await db.appraisalRecord.findFirst({
    where: { cycleId: chosen.cycleId, employeeId: input.employeeId },
    select: { id: true },
  });
  if (!srcAppraisal) bad("Sumber tidak ditemukan");
  const srcKpis = await db.appraisalKpi.findMany({
    where: { appraisalId: srcAppraisal.id },
    orderBy: { createdAt: "asc" },
  });
  const activeDefs = await db.kpiDefinition.findMany({ where: { status: "Active" }, select: { id: true, unit: true } });
  const activeDefMap = new Map(activeDefs.map((d) => [d.id, d]));
  const rows = srcKpis.map((k) => {
    const def = k.kpiDefId ? activeDefMap.get(k.kpiDefId) : undefined;
    return {
      sourceKpiId: k.id,
      kpiDefId: k.kpiDefId,
      title: k.title,
      polarity: k.polarity,
      unit: k.unit,
      thresholdMin: k.thresholdMin,
      target: k.target, // nilai awal — bebas diedit di dialog
      stretchValue: k.stretchValue,
      weight: k.weight,
      isCritical: k.isCritical,
      dataSource: k.dataSource,
      sourceKey: k.sourceKey,
      defInactive: k.kpiDefId != null && !def, // pustaka non-aktif → flag amber (§18.4)
      unitChanged: def != null && def.unit !== k.unit, // satuan berubah sejak periode lalu
    };
  });
  const existingCount = await db.appraisalKpi.count({ where: { appraisalId: a.id } });
  return {
    source: chosen,
    rows,
    existingCount, // >0 → dialog tawarkan gabung/ganti
    positionChanged: false, // dicek client-side via data penempatan vs sumber (implementasi ringan)
  };
}

/** Jalankan salinan (per peserta §18.2; capaian & bukti SELALU reset). */
export async function copyFromCycle(
  db: TenantDb,
  input: { cycleId: string; employeeId: string; sourceCycleId: string; items: { sourceKpiId: string; target?: number }[]; mode?: "merge" | "replace" },
  actor: string,
): Promise<{ copied: number }> {
  const a = await requireEditableGoals(db, (await db.appraisalRecord.findFirst({
    where: { cycleId: input.cycleId, employeeId: input.employeeId },
    select: { id: true },
  }))?.id ?? "");
  const source = await resolveSource(db, input.cycleId, input.employeeId);
  if (!source.find((s) => s.cycleId === input.sourceCycleId)) bad("Siklus sumber tidak valid (periodEnd harus < awal siklus aktif — §35-24)");
  const srcAppraisal = await db.appraisalRecord.findFirst({
    where: { cycleId: input.sourceCycleId, employeeId: input.employeeId },
    select: { id: true, cycle: { select: { code: true } } },
  });
  if (!srcAppraisal) bad("Siklus sumber tidak ditemukan untuk peserta ini");
  const srcKpis = await db.appraisalKpi.findMany({ where: { appraisalId: srcAppraisal.id } });
  // items kosong = salin SEMUA baris sumber (dipakai copyTeam/prefill)
  const chosenIds = new Set(input.items.map((i) => i.sourceKpiId));
  const items = input.items.length
    ? input.items
    : srcKpis.map((k) => ({ sourceKpiId: k.id }) as { sourceKpiId: string; target?: number });
  if (input.mode === "replace") {
    await db.appraisalKpi.deleteMany({ where: { appraisalId: a.id } });
  }
  let copied = 0;
  for (const item of items) {
    const src = srcKpis.find((k) => k.id === item.sourceKpiId);
    if (!src) continue;
    await db.appraisalKpi.create({
      data: {
        appraisalId: a.id,
        kpiDefId: src.kpiDefId,
        title: src.title,
        polarity: src.polarity,
        unit: src.unit,
        thresholdMin: src.thresholdMin,
        target: item.target ?? src.target, // kolom target baru editable (§18.2)
        stretchValue: src.stretchValue,
        weight: src.weight,
        isCritical: src.isCritical,
        dataSource: src.dataSource,
        sourceKey: src.sourceKey,
        proposedBy: "Manager",
        origin: "CopiedFromCycle",
        copiedFromId: src.id,
        // capaian & bukti TIDAK disalin — midActual/finalActual/autoValueJson/evidenceJson null (§18.2)
      },
    });
    copied++;
  }
  await db.appraisalRecord.update({
    where: { id: a.id },
    data: { goalsCopiedFrom: srcAppraisal.cycle.code }, // chip UI "⟨disalin dari PER-2025⟩"
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "AppraisalRecord", entityId: a.id,
      detail: `Salin ${copied} KPI dari ${srcAppraisal.cycle.code} (capaian & bukti direset) — mode ${input.mode ?? "merge"}`,
    },
  });
  void chosenIds;
  void actor;
  return { copied };
}

/** Bulk tim (§18.2-c): peserta TANPA baris KPI diisi dari sumber masing-masing. */
export async function copyTeam(
  db: TenantDb,
  input: { cycleId: string; sourceCycleId?: string },
  actor: string,
): Promise<{ copied: number; noSource: { employeeName: string }[]; skipped: { employeeName: string }[] }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, status: true, periodStart: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "GoalSetting") bad("Bulk tim hanya saat fase GoalSetting (§35-25)");
  const participants = await db.appraisalRecord.findMany({
    where: { cycleId: input.cycleId, status: { in: ["Enrolled", "GoalProposed"] } },
    include: { employee: { select: { fullName: true } }, kpis: { select: { id: true } } },
  });
  const noSource: { employeeName: string }[] = [];
  const skipped: { employeeName: string }[] = [];
  let copied = 0;
  for (const p of participants) {
    if (p.kpis.length > 0) { skipped.push({ employeeName: p.employee.fullName }); continue; }
    const sources = await resolveSource(db, input.cycleId, p.employeeId);
    const chosen = input.sourceCycleId ? sources.find((s) => s.cycleId === input.sourceCycleId) : sources[0];
    if (!chosen) { noSource.push({ employeeName: p.employee.fullName }); continue; }
    const r = await copyFromCycle(db, {
      cycleId: input.cycleId,
      employeeId: p.employeeId,
      sourceCycleId: chosen.cycleId,
      items: [], // semua baris
      mode: "merge",
    }, actor).catch(() => null);
    if (r) copied++;
  }
  // items: [] → salin SEMUA baris sumber (khusus copyTeam)
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PerformanceCycle", entityId: input.cycleId,
      detail: `Salin massal tim ${cycle.code}: ${copied} terisi · ${noSource.length} tanpa sumber (tawarkan template) · ${skipped.length} dilewati (sudah isi) — oleh ${actor}`,
    },
  });
  return { copied, noSource, skipped };
}
