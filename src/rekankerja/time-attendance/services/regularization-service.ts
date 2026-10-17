// RekanKerja — Service REGULARISASI ABSENSI MANDIRI (P1.3 / D-BM7).
// ============================================================================
// Karyawan mengajukan koreksi absensi sendiri ("lupa absen" / "jam salah")
// → dokumen AttendanceRegularizationRequest (docNo AR-YYYY-NNNN) → approval
// chain docType "AttendanceReg" (terdaftar di approval-engine P1-BENCHMARK
// Phase 0; default TANPA struktur aktif → fallback atasan langsung/Admin-HR).
// Approve FINAL → auto-apply OVERRIDE rekap harian (state "Revised", kontrak
// admin op:override-daily clocking.ts) + regenerasi hari tsb (regenerateDaily
// — fungsi yang sama dengan "Refresh Clocking" admin, scope 1 karyawan).
//
// Batas pengajuan (D-BM7): maks 4 pengajuan AKTIF (Submitted) per karyawan
// per bulan kalender (bulan TANGGAL KERJA yang diregularisasi) → 429.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { retryOnUnique } from "@/rekankerja/shared/lib/doc-no-retry";
import {
  startApprovalChain, decideApprovalChain, cancelApprovalChain, attachChainSummaries,
  type ChainSummary, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { bindDraftAttachments, attachmentsByEntityIds, countDraftAttachmentsByIds } from "@/rekankerja/shared/services/attachment-service";
import {
  regenerateDaily, isValidTimeStr,
} from "@/rekankerja/time-attendance/services/attendance-service";

// ============ konstanta domain ============

export const REG_KINDS = ["MissingClockIn", "MissingClockOut", "WrongTime", "MissingBoth"] as const;
export type RegKind = (typeof REG_KINDS)[number];

export const REG_STATUSES = ["Submitted", "Approved", "Rejected", "Cancelled"] as const;

/** Jendela backdate pengajuan (hari) — selaras guard clock manual admin (30). */
export const REG_MAX_BACKDATE_DAYS = 30;
/** Batas pengajuan AKTIF per karyawan per bulan kalender (D-BM7). */
export const REG_MONTHLY_ACTIVE_CAP = 4;

/** Aktor mutasi (pola service TA: nama display + identitas untuk log). */
export interface RegActor {
  /** AppUser id tenant (fallback platform userId) — decidedById. */
  appUserId: string | null;
  employeeId: string | null;
  name: string;
}

/** Error bisnis dengan status HTTP (pemanggil route memetakan 1:1). */
export class RegError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RegError";
    this.status = status;
  }
}

// ============ util ============

/** Awal hari lokal 00:00 (pola dayStart attendance-service). */
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "YYYY-MM-DD" lokal tanpa timezone-shift (pola ess-auth fmtIsoDate). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Label singkat id-ID utk ActivityLog (pola fmtDate leave-service). */
function fmtDateId(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Jam "HH:MM" lokal dari Date (utk log before/after). */
function hhmm(d: Date | null): string | null {
  return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : null;
}

/** Validasi jam "HH:MM" ketat (00–23 / 00–59) — reuse kontrak attendance. */
function assertHhMm(v: string, label: string): void {
  if (!isValidTimeStr(v)) {
    throw new RegError(`${label} harus format HH:MM (00:00–23:59)`);
  }
}

/** Nomor dokumen AR-YYYY-NNNN (max-suffix + 1 — pola nextDocNo leave). */
async function nextDocNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const start = `AR-${year}-`;
  const rows = await db.attendanceRegularizationRequest.findMany({
    where: { docNo: { startsWith: start } },
    select: { docNo: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

// ============ SUBMIT ============

export interface RegSubmitInput {
  employeeId: string;
  /** "YYYY-MM-DD" (tanggal kerja yang dikoreksi). */
  workDate: string;
  kind: string;
  /** "HH:MM" diajukan (opsional per kind). */
  clockIn?: string;
  clockOut?: string;
  reason: string;
  /** id lampiran draf (entityType "AttendanceRegularization", entityId "draft:…"). */
  attachmentIds?: string[];
  /** identitas pengaju (audit ActivityLog — pola leave actorName). */
  actorName?: string | null;
  actorAppUserId?: string | null;
  actorEmployeeId?: string | null;
}

export interface RegSubmitResult {
  id: string;
  docNo: string;
  status: string;
  approvalLevels: number;
  firstApprover: string | null;
}

/**
 * Ajukan regularisasi absensi. Validasi:
 *  - tanggal kerja: wajib YYYY-MM-DD, bukan masa depan, maks 30 hari ke belakang
 *    (selaras jendela koreksi clock manual admin; koreksi lebih jauh = jalur
 *    admin override/regen-range dengan jejak audit);
 *  - kind ↔ jam konsisten: MissingClockIn → clockIn; MissingClockOut → clockOut;
 *    WrongTime/MissingBoth → keduanya;
 *  - alasan wajib ≥10 karakter (≤500);
 *  - cap: <4 pengajuan Submitted bulan kalender tanggal kerja yang sama → 429.
 */
export async function submitRegularization(db: TenantDb, input: RegSubmitInput): Promise<RegSubmitResult> {
  const employeeId = input.employeeId.trim();
  if (!employeeId) throw new RegError("Karyawan wajib diisi");

  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNo: true, fullName: true, status: true },
  });
  if (!emp) throw new RegError("Karyawan tidak ditemukan", 404);

  // ---- tanggal kerja ----
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) {
    throw new RegError("Tanggal kerja wajib format YYYY-MM-DD");
  }
  const [y, m, d] = input.workDate.split("-").map(Number);
  const workDate = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (workDate.getFullYear() !== y || workDate.getMonth() !== (m ?? 1) - 1 || workDate.getDate() !== (d ?? 1)) {
    throw new RegError("Tanggal kerja tidak valid");
  }
  const today = dayStart(new Date());
  if (workDate > today) {
    throw new RegError("Tanggal kerja tidak boleh di masa depan — regularisasi hanya untuk hari yang sudah terjadi");
  }
  const earliest = new Date(today.getTime() - REG_MAX_BACKDATE_DAYS * 86_400_000);
  if (workDate < earliest) {
    throw new RegError(
      `Tanggal kerja maksimal ${REG_MAX_BACKDATE_DAYS} hari ke belakang (${fmtDateId(earliest)}) — koreksi lebih jauh hubungi HR/admin kehadiran`,
    );
  }

  // ---- kind ↔ jam ----
  const kind = input.kind;
  if (!(REG_KINDS as readonly string[]).includes(kind)) {
    throw new RegError(`Jenis regularisasi tidak valid ("${kind}") — pilihan: ${REG_KINDS.join("|")}`);
  }
  const clockIn = input.clockIn?.trim() || undefined;
  const clockOut = input.clockOut?.trim() || undefined;
  if (clockIn) assertHhMm(clockIn, "Jam masuk diajukan");
  if (clockOut) assertHhMm(clockOut, "Jam pulang diajukan");
  if ((kind === "MissingClockIn" || kind === "WrongTime" || kind === "MissingBoth") && !clockIn) {
    throw new RegError("Jam masuk (HH:MM) wajib diisi untuk jenis pengajuan ini");
  }
  if ((kind === "MissingClockOut" || kind === "WrongTime" || kind === "MissingBoth") && !clockOut) {
    throw new RegError("Jam pulang (HH:MM) wajib diisi untuk jenis pengajuan ini");
  }
  if (clockIn && clockOut && clockOut <= clockIn && kind !== "MissingBoth") {
    // lintas tengah malam hanya masuk akal utk shift malam — biarkan admin yang
    // menilai; validasi keras hanya jam pulang < jam masuk pada hari yang sama.
    throw new RegError("Jam pulang tidak boleh lebih awal daripada jam masuk");
  }

  // ---- alasan ----
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new RegError("Alasan regularisasi wajib diisi minimal 10 karakter (jelaskan kronologi lupa absen / jam salah)");
  }
  if (reason.length > 500) {
    throw new RegError("Alasan regularisasi maksimal 500 karakter");
  }

  // ---- duplikat aktif utk tanggal yang sama ----
  const dup = await db.attendanceRegularizationRequest.findFirst({
    where: { employeeId, workDate: dayStart(workDate), status: "Submitted" },
    select: { docNo: true },
  });
  if (dup) {
    throw new RegError(
      `Sudah ada pengajuan ${dup.docNo} untuk tanggal ${input.workDate} yang masih menunggu keputusan`,
      409,
    );
  }

  // ---- cap bulanan (D-BM7): maks 4 AKTIF per bulan kalender tanggal kerja ----
  const monthStart = new Date(workDate.getFullYear(), workDate.getMonth(), 1);
  const monthEnd = new Date(workDate.getFullYear(), workDate.getMonth() + 1, 1);
  const activeCount = await db.attendanceRegularizationRequest.count({
    where: { employeeId, status: "Submitted", workDate: { gte: monthStart, lt: monthEnd } },
  });
  if (activeCount >= REG_MONTHLY_ACTIVE_CAP) {
    throw new RegError(
      `Maksimal ${REG_MONTHLY_ACTIVE_CAP} pengajuan regularisasi aktif per bulan — batalkan pengajuan lain atau tunggu keputusannya terlebih dahulu`,
      429,
    );
  }

  // ---- lampiran draf (pola T16-ATTACH / P1.2-BM leave) ----
  const attachmentIds = Array.isArray(input.attachmentIds)
    ? input.attachmentIds.map((x) => String(x)).filter(Boolean)
    : [];
  if (attachmentIds.length > 0) {
    // validasi draf: SEMUA id harus benar-benar draf AttendanceRegularization
    // yang siap di-rebind (bukan id palsu / lampiran milik dokumen lain /
    // sudah ter-bound) — gate identik leave-service D-BM5.
    const draftCount = await countDraftAttachmentsByIds(db, "AttendanceRegularization", attachmentIds);
    if (draftCount !== attachmentIds.length) {
      throw new RegError("Lampiran tidak valid — unggah ulang file lampiran lalu ajukan kembali");
    }
  }

  // ---- create + chain (retryOnUnique utk race nomor dokumen) ----
  const created = await retryOnUnique(async () => {
    const docNo = await nextDocNo(db);
    return db.attendanceRegularizationRequest.create({
      data: {
        docNo,
        employeeId,
        workDate: dayStart(workDate),
        kind,
        clockIn: clockIn ?? null,
        clockOut: clockOut ?? null,
        reason,
        attachmentIds: JSON.stringify(attachmentIds),
        status: "Submitted",
      },
      select: { id: true, docNo: true },
    });
  });

  // lampiran draf pra-submit di-rebind ke dokumen final (pola T16-ATTACH).
  const bound = attachmentIds.length > 0
    ? await bindDraftAttachments(db, "AttendanceRegularization", attachmentIds, created.id)
    : 0;

  // approval berjenjang docType "AttendanceReg" (terdaftar Phase 0 — tanpa
  // nominal; default tanpa struktur aktif → fallback atasan langsung/Admin-HR).
  const chain = await startApprovalChain(db, {
    docType: "AttendanceReg",
    docId: created.id,
    employeeId,
    createdBy: input.actorName ?? null,
  });

  await db.activityLog.create({
    data: {
      appUserId: input.actorAppUserId ?? null,
      employeeId: input.actorEmployeeId ?? null,
      action: "Submitted",
      entity: "AttendanceRegularizationRequest",
      entityId: created.docNo,
      detail:
        `${created.docNo}: ${emp.employeeNo} ${emp.fullName} — ${kind} ${input.workDate}` +
        `${clockIn ? ` in ${clockIn}` : ""}${clockOut ? ` out ${clockOut}` : ""}` +
        ` — approval ${chain.totalLevels} jenjang (${bound > 0 ? `${bound} lampiran` : "tanpa lampiran"}): ${reason}`,
    },
  }).catch(() => { /* audit best-effort */ });

  return {
    id: created.id,
    docNo: created.docNo,
    status: "Submitted",
    approvalLevels: chain.totalLevels,
    firstApprover: chain.steps[0]?.approverLabel ?? null,
  };
}

// ============ APPLY (approve final → override + regen) ============

/**
 * Terapkan override rekap harian — REPLIKA persis admin op:override-daily
 * (time-attendance/api/clocking.ts PATCH): state "Revised" + revised/revisedBy
 * + notes + jam dari pengajuan digabung tanggal kerja via setHours lokal
 * (konvensi timezone jalur tsb).
 *
 * Catatan URUTAN (deviasi terdokumentasi dari brief): regenerateDaily DULU,
 * override KEMUDIAN — regenerateDaily menimpa baris apa pun dgn state
 * "Calculated" (termasuk Revised — komentar kontrak di clocking.ts "dipertahankan"
 * tidak sejalan implementasi service), sehingga override wajib menulis TERAKHIR
 * agar hasil akhir = state "Revised" + jam diajukan (kontrak E2E). Regen dulU
 * juga menjamin baris rekap ada (tanggal lampau tanpa clock tetap ter-upsert).
 */
async function applyOverride(
  db: TenantDb,
  req: { id: string; docNo: string; employeeId: string; workDate: Date; kind: string; clockIn: string | null; clockOut: string | null; reason: string },
  actorName: string,
): Promise<{ before: { checkIn: Date | null; checkOut: Date | null; status: string; state: string }; after: { checkIn: Date | null; checkOut: Date | null; status: string; state: string } }> {
  const date = dayStart(req.workDate);

  // (1) regen dulu (fungsi yang sama dgn "Refresh Clocking" admin, scope 1
  // karyawan + 1 tanggal — idempoten upsert).
  await regenerateDaily(db, date, req.employeeId);

  // (2) cari baris rekap utk diff log.
  const row = await db.attendanceDaily.findUnique({
    where: { employeeId_workDate: { employeeId: req.employeeId, workDate: date } },
  });
  const before = {
    checkIn: row?.checkIn ?? null,
    checkOut: row?.checkOut ?? null,
    status: row?.status ?? "—",
    state: row?.state ?? "—",
  };

  // (3) patch override — hanya jam yang diajukan (pola admin: field opsional).
  const data: { checkIn?: Date; checkOut?: Date } = {};
  const mkTs = (hhmmStr: string): Date => {
    const [h, mi] = hhmmStr.split(":").map((x) => parseInt(x, 10));
    const d = new Date(date);
    d.setHours(h, mi, 0, 0);
    return d;
  };
  if (req.clockIn) data.checkIn = mkTs(req.clockIn);
  if (req.clockOut) data.checkOut = mkTs(req.clockOut);

  const noteText = `Regularisasi ${req.docNo}: ${req.reason}`.slice(0, 300);

  let updated: { checkIn: Date | null; checkOut: Date | null; status: string; state: string };
  if (row) {
    const u = await db.attendanceDaily.update({
      where: { id: row.id },
      data: {
        ...data,
        state: "Revised",
        revised: true,
        revisedBy: actorName,
        notes: noteText,
      },
      select: { checkIn: true, checkOut: true, status: true, state: true },
    });
    updated = u;
  } else {
    // karyawan non-aktif tidak ter-regen — buat baris minimal ber-flag Revised.
    const c = await db.attendanceDaily.create({
      data: {
        employeeId: req.employeeId,
        workDate: date,
        state: "Revised",
        status: "Present",
        presence: 1,
        checkIn: data.checkIn ?? null,
        checkOut: data.checkOut ?? null,
        revised: true,
        revisedBy: actorName,
        notes: noteText,
      },
      select: { checkIn: true, checkOut: true, status: true, state: true },
    });
    updated = c;
  }

  return { before, after: updated };
}

// ============ DECIDE (admin approve/reject) ============

export interface RegDecideInput {
  id: string;
  action: "approve" | "reject" | "cancel";
  note?: string;
  actor: RegActor;
}

export interface RegDecideResult {
  docNo: string;
  status: string;
  /** null = dokumen masih menunggu jenjang berikutnya (approve parsial). */
  approval: { currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

/** Engine chain actor (pola leave decideRequest). */
function chainActorOf(actor: RegActor): DecideActor {
  return { role: "ADMIN", employeeId: actor.employeeId, name: actor.name };
}

/**
 * Putuskan pengajuan (admin). Approve jenjang terakhir → auto-apply override
 * + regen + ActivityLog before/after. Reject → catatan wajib ≥10 karakter.
 * Hanya status Submitted yang bisa diputus (409 bila sudah diproses).
 */
export async function decideRegularization(db: TenantDb, input: RegDecideInput): Promise<RegDecideResult> {
  const req = await db.attendanceRegularizationRequest.findUnique({
    where: { id: input.id },
    include: { employee: { select: { employeeNo: true, fullName: true } } },
  });
  if (!req) throw new RegError("Pengajuan regularisasi tidak ditemukan", 404);
  if (req.status !== "Submitted") {
    throw new RegError(`Pengajuan ${req.docNo} sudah berstatus ${req.status} — hanya pengajuan menunggu keputusan yang bisa diproses`, 409);
  }

  const note = input.note?.trim() ?? "";
  if (input.action === "reject" && note.length < 10) {
    throw new RegError("Catatan penolakan wajib diisi minimal 10 karakter (alasan agar karyawan memahami keputusannya)");
  }
  if (note.length > 300) {
    throw new RegError("Catatan keputusan maksimal 300 karakter");
  }

  const res = await decideApprovalChain(db, {
    docType: "AttendanceReg",
    docId: input.id,
    action: input.action,
    note: note || undefined,
    actor: chainActorOf(input.actor),
  });

  if (!res.final) {
    // approve jenjang menengah — dokumen masih Submitted.
    const currentStep = res.chain.steps.find((s) => s.status === "Current");
    await db.activityLog.create({
      data: {
        appUserId: input.actor.appUserId,
        employeeId: input.actor.employeeId,
        action: "Approved",
        entity: "AttendanceRegularizationRequest",
        entityId: req.docNo,
        detail: `${req.docNo}: jenjang ${res.chain.currentLevel - 1}/${res.chain.totalLevels} disetujui oleh ${input.actor.name} — menunggu ${currentStep?.approverLabel ?? "jenjang berikutnya"}`,
      },
    }).catch(() => { /* audit best-effort */ });
    return {
      docNo: req.docNo,
      status: "Submitted",
      approval: {
        currentLevel: res.chain.currentLevel,
        totalLevels: res.chain.totalLevels,
        currentApprover: currentStep?.approverLabel ?? null,
      },
    };
  }

  if (input.action !== "approve") {
    // reject final.
    const upd = await db.attendanceRegularizationRequest.updateMany({
      where: { id: input.id, status: "Submitted" },
      data: {
        status: "Rejected",
        decidedById: input.actor.appUserId,
        decidedAt: new Date(),
        decisionNote: note || null,
      },
    });
    if (upd.count === 0) {
      throw new RegError(`Pengajuan ${req.docNo} sudah diproses pengguna lain — muat ulang daftar`, 409);
    }
    await db.activityLog.create({
      data: {
        appUserId: input.actor.appUserId,
        employeeId: input.actor.employeeId,
        action: "Rejected",
        entity: "AttendanceRegularizationRequest",
        entityId: req.docNo,
        detail: `${req.docNo} (${req.employee.employeeNo} ${req.employee.fullName}) → DITOLAK oleh ${input.actor.name}${note ? ` — ${note}` : ""}`,
      },
    }).catch(() => { /* audit best-effort */ });
    return { docNo: req.docNo, status: "Rejected", approval: null };
  }

  // ==== approve FINAL → auto-apply override + ActivityLog before/after ====
  const applied = await applyOverride(
    db,
    {
      id: req.id, docNo: req.docNo, employeeId: req.employeeId, workDate: req.workDate,
      kind: req.kind, clockIn: req.clockIn, clockOut: req.clockOut, reason: req.reason,
    },
    input.actor.name,
  );
  const upd = await db.attendanceRegularizationRequest.updateMany({
    where: { id: input.id, status: "Submitted" },
    data: {
      status: "Approved",
      decidedById: input.actor.appUserId,
      decidedAt: new Date(),
      decisionNote: note || null,
    },
  });
  if (upd.count === 0) {
    throw new RegError(`Pengajuan ${req.docNo} sudah diproses pengguna lain — muat ulang daftar`, 409);
  }

  const b = `in ${hhmm(applied.before.checkIn) ?? "—"} → ${hhmm(applied.after.checkIn) ?? "—"}`;
  const o = `out ${hhmm(applied.before.checkOut) ?? "—"} → ${hhmm(applied.after.checkOut) ?? "—"}`;
  await db.activityLog.create({
    data: {
      appUserId: input.actor.appUserId,
      employeeId: input.actor.employeeId,
      action: "Approved",
      entity: "AttendanceRegularizationRequest",
      entityId: req.docNo,
      detail:
        `${req.docNo} (${req.employee.employeeNo} ${req.employee.fullName}) → DISETUJUI oleh ${input.actor.name} — ` +
        `rekap ${isoLocal(req.workDate)} dikoreksi (${b}, ${o}; status ${applied.before.status}→${applied.after.status}, ` +
        `state ${applied.before.state}→${applied.after.state})${note ? ` — catatan: ${note}` : ""}`,
    },
  }).catch(() => { /* audit best-effort */ });
  // log kedua pada entitas rekap yang dimutasi (pola admin override-daily).
  await db.activityLog.create({
    data: {
      appUserId: input.actor.appUserId,
      employeeId: input.actor.employeeId,
      action: "Updated",
      entity: "AttendanceDaily",
      entityId: req.docNo,
      detail:
        `Koreksi rekap via regularisasi ${req.docNo} ${isoLocal(req.workDate)} ${req.employee.employeeNo} ${req.employee.fullName}: ` +
        `${b}, ${o} (alasan: ${req.reason}) oleh ${input.actor.name}`,
    },
  }).catch(() => { /* audit best-effort */ });

  return { docNo: req.docNo, status: "Approved", approval: null };
}

// ============ CANCEL (pemohon ESS) ============

/** Tarik pengajuan SENDIRI yang masih Submitted (pola cancelOwnRequest leave). */
export async function cancelOwnRegularization(
  db: TenantDb,
  input: { id: string; employeeId: string; note?: string; actorName: string },
): Promise<RegDecideResult> {
  const req = await db.attendanceRegularizationRequest.findUnique({
    where: { id: input.id },
    include: { employee: { select: { employeeNo: true, fullName: true } } },
  });
  if (!req) throw new RegError("Pengajuan regularisasi tidak ditemukan", 404);
  if (req.employeeId !== input.employeeId) {
    throw new RegError("Pengajuan regularisasi ini bukan milik Anda", 403);
  }
  if (req.status !== "Submitted") {
    throw new RegError(`Pengajuan ${req.docNo} sudah berstatus ${req.status} — tidak bisa ditarik`, 409);
  }

  await cancelApprovalChain(db, "AttendanceReg", input.id, input.actorName);
  const upd = await db.attendanceRegularizationRequest.updateMany({
    where: { id: input.id, status: "Submitted" },
    data: { status: "Cancelled", decidedAt: new Date(), decisionNote: input.note?.trim() || null },
  });
  if (upd.count === 0) {
    throw new RegError(`Pengajuan ${req.docNo} sudah diproses pengguna lain — muat ulang daftar`, 409);
  }
  await db.activityLog.create({
    data: {
      employeeId: req.employeeId,
      action: "Cancelled",
      entity: "AttendanceRegularizationRequest",
      entityId: req.docNo,
      detail: `${req.docNo} ditarik pemohon ${req.employee.employeeNo} ${req.employee.fullName}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`,
    },
  }).catch(() => { /* audit best-effort */ });
  return { docNo: req.docNo, status: "Cancelled", approval: null };
}

// ============ LIST (admin) ============

export interface RegRow {
  id: string;
  docNo: string;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  workDate: string;
  kind: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  /** rekap harian SAAT INI utk tanggal tsb (diff display). */
  current: {
    checkIn: string | null;
    checkOut: string | null;
    status: string;
    state: string;
    revised: boolean;
  } | null;
  /** ringkasan chain (jenjang aktif). */
  approval: ChainSummary | null;
  /** metadata lampiran ter-bind (bukti opsional — utk approver). */
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
}

export interface RegListResult {
  rows: RegRow[];
  stats: { total: number; submitted: number; approved: number; rejected: number; cancelled: number };
}

/**
 * Daftar pengajuan (admin) — filter status | employeeId | orgUnit | dateFrom |
 * dateTo; join karyawan (nama/no/unit penempatan aktif) + jam rekap saat ini
 * (diff) + ringkasan chain. Maks 200 baris terbaru (kebutuhan inbox approval).
 */
export async function listRegularizations(
  db: TenantDb,
  filter: { status?: string; employeeId?: string; orgUnit?: string; dateFrom?: string; dateTo?: string } = {},
): Promise<RegListResult> {
  const where: {
    status?: string;
    employeeId?: string;
    workDate?: { gte?: Date; lt?: Date };
    employee?: { assignments?: { some: { orgUnitId: string; validTo: null } } };
  } = {};
  if (filter.status && filter.status !== "all" && (REG_STATUSES as readonly string[]).includes(filter.status)) {
    where.status = filter.status;
  }
  if (filter.employeeId) where.employeeId = filter.employeeId;
  if (filter.orgUnit) {
    where.employee = { assignments: { some: { orgUnitId: filter.orgUnit, validTo: null } } };
  }
  const parseDate = (s: string | undefined): Date | null => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  };
  const from = parseDate(filter.dateFrom);
  const to = parseDate(filter.dateTo);
  if (from || to) {
    where.workDate = {};
    if (from) where.workDate.gte = dayStart(from);
    if (to) where.workDate.lt = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  }

  const raw = await db.attendanceRegularizationRequest.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true, employeeNo: true, fullName: true,
          assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { docNo: "desc" }],
    take: 200,
  });

  // jam rekap saat ini per (karyawan, tanggal) — batch OR pairs.
  const pairs = raw.map((r) => ({ employeeId: r.employeeId, workDate: dayStart(r.workDate) }));
  const dailyByPair = new Map<string, { checkIn: string | null; checkOut: string | null; status: string; state: string; revised: boolean }>();
  for (let i = 0; i < pairs.length; i += 50) {
    const batch = pairs.slice(i, i + 50);
    if (batch.length === 0) continue;
    const rows = await db.attendanceDaily.findMany({
      where: { OR: batch.map((p) => ({ employeeId: p.employeeId, workDate: p.workDate })) },
      select: { employeeId: true, workDate: true, checkIn: true, checkOut: true, status: true, state: true, revised: true },
    });
    for (const d of rows) {
      dailyByPair.set(
        `${d.employeeId}|${isoLocal(d.workDate)}`,
        { checkIn: hhmm(d.checkIn), checkOut: hhmm(d.checkOut), status: d.status, state: d.state, revised: d.revised },
      );
    }
  }

  // nama pemberi keputusan (AppUser) — batch.
  const decidedByIds = [...new Set(raw.map((r) => r.decidedById).filter((x): x is string => !!x))];
  const deciders = decidedByIds.length > 0
    ? await db.appUser.findMany({ where: { id: { in: decidedByIds } }, select: { id: true, username: true, fullName: true } })
    : [];
  const deciderName = new Map<string, string>();
  for (const u of deciders) deciderName.set(u.id, u.fullName || u.username);

  const chains = await attachChainSummaries(db, "AttendanceReg", raw.map((r) => ({ id: r.id })));
  const attachments = await attachmentsByEntityIds(
    db,
    "AttendanceRegularization",
    raw.map((r) => r.id),
  );

  const rows: RegRow[] = raw.map((r) => {
    const cur = dailyByPair.get(`${r.employeeId}|${isoLocal(r.workDate)}`) ?? null;
    const chain = chains.get(r.id) ?? null;
    return {
      id: r.id,
      docNo: r.docNo,
      employeeId: r.employeeId,
      employeeNo: r.employee.employeeNo,
      fullName: r.employee.fullName,
      orgUnitName: r.employee.assignments[0]?.orgUnit?.name ?? null,
      workDate: isoLocal(r.workDate),
      kind: r.kind,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      decidedByName: r.decidedById ? deciderName.get(r.decidedById) ?? null : null,
      current: cur,
      approval: r.status === "Submitted" ? chain : null,
      attachments: attachments.get(r.id) ?? [],
    };
  });

  return {
    rows,
    stats: {
      total: raw.length,
      submitted: raw.filter((r) => r.status === "Submitted").length,
      approved: raw.filter((r) => r.status === "Approved").length,
      rejected: raw.filter((r) => r.status === "Rejected").length,
      cancelled: raw.filter((r) => r.status === "Cancelled").length,
    },
  };
}

// ============ LIST (ESS — self scope) ============

export interface MyRegRow {
  id: string;
  docNo: string;
  workDate: string;
  kind: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: string;
  createdAt: string;
  decisionNote: string | null;
  decidedAt: string | null;
  attachmentCount: number;
  approval: { currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

/** Daftar pengajuan MILIK SENDIRI + sisa kuota bulan berjalan (anti-IDOR). */
export async function myRegularizations(
  db: TenantDb,
  employeeId: string,
): Promise<{ rows: MyRegRow[]; stats: { submitted: number; approved: number; rejected: number; cancelled: number; monthQuotaLeft: number } }> {
  const raw = await db.attendanceRegularizationRequest.findMany({
    where: { employeeId },
    orderBy: [{ createdAt: "desc" }, { docNo: "desc" }],
    take: 100,
  });

  // jumlah lampiran ter-bind per dokumen (batch).
  const ids = raw.map((r) => r.id);
  const attCounts = new Map<string, number>();
  if (ids.length > 0) {
    const grouped = await db.attachment.groupBy({ by: ["entityId"], where: { entityType: "AttendanceRegularization", entityId: { in: ids } }, _count: { _all: true } });
    for (const g of grouped) attCounts.set(g.entityId, g._count._all);
  }

  const chains = await attachChainSummaries(db, "AttendanceReg", raw.map((r) => ({ id: r.id })));

  const rows: MyRegRow[] = raw.map((r) => {
    const c = chains.get(r.id);
    return {
      id: r.id,
      docNo: r.docNo,
      workDate: isoLocal(r.workDate),
      kind: r.kind,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      attachmentCount: attCounts.get(r.id) ?? 0,
      approval: r.status === "Submitted" && c
        ? { currentLevel: c.currentLevel, totalLevels: c.totalLevels, currentApprover: c.currentApprover }
        : null,
    };
  });

  // sisa kuota bulan KALENDER BERJALAN (tanggal kerja) utk hint form.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const activeThisMonth = await db.attendanceRegularizationRequest.count({
    where: { employeeId, status: "Submitted", workDate: { gte: monthStart, lt: monthEnd } },
  });

  return {
    rows,
    stats: {
      submitted: rows.filter((r) => r.status === "Submitted").length,
      approved: rows.filter((r) => r.status === "Approved").length,
      rejected: rows.filter((r) => r.status === "Rejected").length,
      cancelled: rows.filter((r) => r.status === "Cancelled").length,
      monthQuotaLeft: Math.max(0, REG_MONTHLY_ACTIVE_CAP - activeThisMonth),
    },
  };
}
