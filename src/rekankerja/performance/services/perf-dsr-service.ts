import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { ExportSheet, ExportCell } from "@/rekankerja/shared/lib/export";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { trFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { getPerfSetting } from "@/rekankerja/performance/services/perf-master-service";
import {
  PROB_RESULT_KEY, PROB_EXTEND_KEY,
} from "@/rekankerja/performance/services/perf-probation-service";
import {
  PERF_RESULT_KEY, PERF_PIP_KEY,
} from "@/rekankerja/performance/services/perf-merit-service";

// ============================================================================
// PERFORMANCE — Service DSR KARYAWAN (P9 — DEVELOVELOPMENT-PLAN-PERFORMANCE.md
// §20 P9; §7.3 UU PDP No. 27/2022; §37): perluasan DataSubjectRequest yang
// sudah ada untuk pelamar (F9-REC) ke KARYAWAN — hak akses/ekspor/hapus DATA
// KINERJA.
//
// PILAR DESAIN (mirror recruitment compliance-service + pola performance):
// • SLA 7 hari (DSR_SLA_DAYS — praktik industri UU PDP, sama dgn DSR pelamar).
// • State machine New → InProgress → Completed|Rejected (transisi sah saja;
//   Rejected wajib alasan ≥10 char; Completed wajib resultNote tidak kosong;
//   transisi ILEGAL → 400 eksplisit).
// • Paket Export = 1 sheet identitas dasar (PII limited — TANPA gaji/NIK/npwp/
//   rekening; pola pf23 employee-detail P8) + 5 sheet riwayat kinerja
//   (PP 35/2021 §7.2 — eksporabel & ter-audit): penilaian+KPI, kompetensi,
//   jejak kalibrasi, 360 TER-AGREGASI ANONIM (≥3 reviewer §37), PIP+surat+
//   merit ringkas (nominal via money-view — §37 vault gating).
// • Erase TIDAK menghapus data kinerja otomatis — karyawan aktif & bukti
//   keputusan kepegawaian (PP 35/2021 §7.2) = dasar sah mempertahankan data;
//   keputusan ditangani HR manual lewat resultNote (§37: penghapusan manual).
// • ActivityLog di setiap aksi + notifikasi via notifyEvent (pola P6/P7).
// • Duplikat: karyawan masih punya DSR aktif JENIS SAMA → 400 (selesaikan dulu).
// ============================================================================

/** Error DSR dengan kode HTTP (dipetakan API → 400/404/409 — pola ComplianceError). */
export class DsrError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function bad(msg: string): never { throw new DsrError(400, msg); }
function notFound(msg: string): never { throw new DsrError(404, msg); }

export type EmployeeDsrType = "Access" | "Export" | "Erase";

const DSR_TYPES: readonly EmployeeDsrType[] = ["Access", "Export", "Erase"];
/** SLA penanganan DSR karyawan (UU PDP — 7 hari, mirror DSR pelamar F9-REC). */
export const DSR_SLA_DAYS = 7;

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateEN = (d: Date) => `${d.getDate()} ${MONTHS_EN[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
const dateOf = (d: Date, lang: Lang) => (lang === "en" ? dateEN(d) : dateID(d));

/** label template surat kinerja utk sheet ringkas (dwibahasa via BASE_EN). */
const LETTER_KEY_LABEL: Record<string, [string, string]> = {
  [PERF_RESULT_KEY]: ["Surat Hasil Penilaian", "Appraisal Result Letter"],
  [PERF_PIP_KEY]: ["SK Program Perbaikan Kinerja", "PIP Decree"],
  [PROB_RESULT_KEY]: ["Surat Hasil Masa Percobaan", "Probation Result Letter"],
  [PROB_EXTEND_KEY]: ["Surat Perjanjian Perpanjangan Masa Percobaan", "Probation Extension Agreement"],
};

// ============ infrastruktur (self-heal — pola ensureProbInfrastructure) ============

/**
 * Pastikan PerformanceSetting ada (retentionYears dipakai halaman Kepatuhan &
 * job perf-retention-scan; pola getPerfSetting). Tenant baru via provisioning;
 * tenant lama di-heal saat menu Kepatuhan dibuka (GET) — idempoten.
 */
export async function ensureDsrInfrastructure(db: TenantDb): Promise<void> {
  await getPerfSetting(db);
}

// ============ opsi karyawan (picker dialog Buat DSR) ============

/** Karyawan Active utk dialog Buat DSR (pola searchProbationEmployees). */
export async function searchDsrEmployees(db: TenantDb, q?: string) {
  const where: Record<string, unknown> = { status: "Active" };
  if (q) where.OR = [
    { employeeNo: { contains: q, mode: "insensitive" } },
    { fullName: { contains: q, mode: "insensitive" } },
  ];
  const emps = await db.employee.findMany({
    where,
    select: {
      id: true, employeeNo: true, fullName: true,
      position: { select: { title: true } },
      orgUnit: { select: { name: true } },
    },
    orderBy: { employeeNo: "asc" },
    take: 500, // P9 §C — opsi combobox karyawan (Employee Active, take 500)
  });
  return {
    employees: emps.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName,
      position: e.position?.title ?? null, orgUnit: e.orgUnit?.name ?? null,
    })),
  };
}

// ============ buat DSR (hak subjek data — UU PDP Pasal 7–9) ============

async function doCreateDsr(
  db: TenantDb,
  empId: string,
  input: { type: string; note?: string | null },
  actor: { employeeId?: string | null; name?: string | null } | null,
  source: "hr" | "self",
): Promise<{ id: string }> {
  if (!(DSR_TYPES as readonly string[]).includes(input.type)) {
    bad(`Tipe DSR tidak dikenal: ${input.type} (harus Access|Export|Erase)`);
  }
  const emp = await db.employee.findUnique({
    where: { id: empId },
    select: { id: true, employeeNo: true, fullName: true, status: true },
  });
  if (!emp) notFound("Karyawan tidak ditemukan");
  // P9 — guard: DSR karyawan data kinerja hanya utk karyawan AKTIF (data
  // karyawan non-aktif = yurisdiksi HR Base / arsip, bukan modul Kinerja).
  if (emp.status !== "Active") {
    bad(`Karyawan ${emp.employeeNo} berstatus ${emp.status} — DSR data kinerja hanya untuk karyawan Active`);
  }
  const active = await db.dataSubjectRequest.findFirst({
    where: { employeeId: emp.id, type: input.type, status: { in: ["New", "InProgress"] } },
    select: { id: true },
  });
  if (active) {
    bad(`Karyawan ${emp.employeeNo} masih punya DSR aktif jenis ${input.type} — selesaikan dulu`);
  }
  const dueAt = new Date(Date.now() + DSR_SLA_DAYS * 86_400_000);
  const row = await db.dataSubjectRequest.create({
    data: {
      employeeId: emp.id,
      type: input.type,
      status: "New",
      note: input.note?.trim() || null,
      dueAt,
    },
  });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "DsrCreated", entity: "DataSubjectRequest", entityId: emp.employeeNo,
      detail: `DSR ${input.type} karyawan ${emp.employeeNo} — ${emp.fullName} dicatat (SLA ${dueAt.toISOString().slice(0, 10)})${source === "self" ? " — diajukan MANDIRI dari Portal Karyawan §7.3" : ""}${actor?.name ? ` oleh ${actor.name}` : ""}${input.note?.trim() ? ` — catatan: ${input.note.trim()}` : ""}`,
    },
  }).catch(() => {});
  // notifikasi inbox HR (pola P6/P7 notifyEvent — never-throw)
  void notifyEvent(db, {
    to: "admins", docType: "DataSubjectRequest", docNo: emp.employeeNo,
    title: source === "self"
      ? `DSR mandiri baru (${input.type}) — ${emp.fullName}`
      : `DSR karyawan baru (${input.type}) — ${emp.fullName}`,
    body: `Permintaan subjek data ${input.type} atas data kinerja ${emp.employeeNo} — ${emp.fullName} menunggu penanganan (SLA ${dueAt.toISOString().slice(0, 10)}).`,
    kind: "performance", link: "performance:compliance",
  }).catch(() => { /* never */ });
  return { id: row.id };
}

/** HR mencatat DSR karyawan (menu Kepatuhan). */
export async function createEmployeeDsr(
  db: TenantDb,
  input: { employeeId: string; type: string; note?: string | null },
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<{ id: string }> {
  return doCreateDsr(db, input.employeeId, input, actor ?? null, "hr");
}

/** Karyawan mengajukan DSR SENDIRI dari ESS (§7.3 — anti-IDOR: employeeId
 *  HANYA dari sesi Portal Karyawan, bukan dari body). */
export async function createSelfDsr(
  db: TenantDb,
  employeeId: string,
  input: { type: string; note?: string | null },
): Promise<{ id: string }> {
  return doCreateDsr(db, employeeId, input, null, "self");
}

// ============ daftar (inbox kepatuhan — hanya DSR karyawan) ============

export interface EmployeeDsrRow {
  id: string;
  employeeNo: string;
  employeeName: string;
  unit: string | null;
  position: string | null;
  type: string;
  status: string;
  note: string | null;
  dueAt: string;
  createdAt: string;
  handledAt: string | null;
  resultNote: string | null;
  handlerName: string | null;
  overdue: boolean;
  selfSubmitted: boolean;
}

const DSR_STATUS_RANK: Record<string, number> = { New: 0, InProgress: 1, Completed: 2, Rejected: 3 };

function mapDsrRow(r: {
  id: string; type: string; status: string; note: string | null;
  dueAt: Date; createdAt: Date; handledAt: Date | null; resultNote: string | null;
  employeeId: string | null;
  employee: { employeeNo: string; fullName: string; orgUnit?: { name: string } | null; position?: { title: string } | null } | null;
  handledBy: { fullName: string } | null;
}): EmployeeDsrRow {
  return {
    id: r.id,
    employeeNo: r.employee?.employeeNo ?? "—",
    employeeName: r.employee?.fullName ?? "—",
    unit: r.employee?.orgUnit?.name ?? null,
    position: r.employee?.position?.title ?? null,
    type: r.type,
    status: r.status,
    note: r.note,
    dueAt: r.dueAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    handledAt: r.handledAt ? r.handledAt.toISOString() : null,
    resultNote: r.resultNote,
    handlerName: r.handledBy?.fullName ?? null,
    overdue: (r.status === "New" || r.status === "InProgress") && r.dueAt.getTime() < Date.now(),
    selfSubmitted: false, // diisi pemanggil (deteksi marker MANDIRI ActivityLog)
  };
}

/** Deteksi DSR yang diajukan MANDIRI karyawan (badge "mandiri" register HR):
 *  ActivityLog DsrCreated bertanda "MANDIRI" — dicocokkan per employeeNo +
 *  waktu pembuatan (± 60 detik — log ditulis tepat setelah baris dibuat). */
async function selfDsrMarkers(db: TenantDb): Promise<{ employeeNo: string; createdAt: number }[]> {
  const logs = await db.activityLog.findMany({
    where: { action: "DsrCreated", entity: "DataSubjectRequest", detail: { contains: "MANDIRI" } },
    select: { detail: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 400,
  }).catch(() => [] as { detail: string | null; createdAt: Date }[]);
  const out: { employeeNo: string; createdAt: number }[] = [];
  for (const l of logs) {
    // detail format: "DSR {type} karyawan {employeeNo} — {name} dicatat (…) — diajukan MANDIRI …"
    const m = /karyawan (MII[A-Z0-9-]*|[A-Z0-9-]+) /.exec(l.detail ?? "");
    if (m?.[1]) out.push({ employeeNo: m[1], createdAt: l.createdAt.getTime() });
  }
  return out;
}

/**
 * Daftar DSR KARYAWAN (employeeId != null — DSR pelamar F9-REC TIDAK ikut;
 * kebalikannya juga berlaku di listDsr recruitment). Urut: status New dulu,
 * lalu dueAt asc (pola recruitment).
 */
export async function listEmployeeDsr(db: TenantDb): Promise<EmployeeDsrRow[]> {
  const [rows, selfMarkers] = await Promise.all([
    db.dataSubjectRequest.findMany({
      where: { employeeId: { not: null } },
      include: {
        employee: {
          select: {
            employeeNo: true, fullName: true,
            orgUnit: { select: { name: true } },
            position: { select: { title: true } },
          },
        },
        handledBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    selfDsrMarkers(db),
  ]);
  // marker MANDIRI → baris TERDEKAT menurut waktu (satu marker satu baris —
  // bila beberapa DSR karyawan yang sama dibuat dalam jendela ±60 dtk,
  // hanya baris yang paling dekat dgn markernya yang dianggap mandiri)
  const out = rows.map((r) => mapDsrRow(r));
  const byNo = new Map<string, { row: EmployeeDsrRow; created: number }[]>();
  rows.forEach((r, i) => {
    const row = out[i] as EmployeeDsrRow;
    const arr = byNo.get(row.employeeNo) ?? [];
    arr.push({ row, created: r.createdAt.getTime() });
    byNo.set(row.employeeNo, arr);
  });
  for (const m of selfMarkers) {
    const arr = byNo.get(m.employeeNo);
    if (!arr?.length) continue;
    let best = arr[0] as { row: EmployeeDsrRow; created: number };
    let bestD = Math.abs(best.created - m.createdAt);
    for (const cand of arr) {
      const d = Math.abs(cand.created - m.createdAt);
      if (d < bestD) { best = cand; bestD = d; }
    }
    if (bestD < 60_000) best.row.selfSubmitted = true;
  }
  return out
    .sort((a, b) =>
      (DSR_STATUS_RANK[a.status] ?? 9) - (DSR_STATUS_RANK[b.status] ?? 9) ||
      a.dueAt.localeCompare(b.dueAt),
    );
}

/** DSR milik karyawan sendiri (ESS — self-scope anti-IDOR dari sesi). */
export async function myEmployeeDsrs(db: TenantDb, employeeId: string): Promise<EmployeeDsrRow[]> {
  const rows = await db.dataSubjectRequest.findMany({
    where: { employeeId },
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      handledBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map((r) => mapDsrRow(r));
}

// ============ transisi status (New → InProgress → Completed|Rejected) ============

/**
 * Transisi SAH satu langkah: New → InProgress; New|InProgress → Completed
 * (resultNote wajib); New|InProgress → Rejected (resultNote ≥10 char).
 * Transisi lain → 400 eksplisit (state machine §12-2).
 */
export async function updateEmployeeDsr(
  db: TenantDb,
  input: { id: string; status: string; resultNote?: string | null },
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<void> {
  const target = input.status;
  if (target !== "InProgress" && target !== "Completed" && target !== "Rejected") {
    bad(`Status DSR tidak dikenal: ${target} (harus InProgress|Completed|Rejected)`);
  }
  const dsr = await db.dataSubjectRequest.findUnique({
    where: { id: input.id },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true, status: true } } },
  });
  if (!dsr) notFound("Permintaan data (DSR) tidak ditemukan");
  if (!dsr.employeeId || !dsr.employee) {
    bad("DSR ini milik pelamar — tangani lewat modul Rekrutmen → Kepatuhan");
  }
  const note = input.resultNote?.trim() ?? "";
  if (target === "InProgress") {
    if (dsr.status !== "New") {
      bad(`DSR ${dsr.type} ${dsr.employee.employeeNo} berstatus ${dsr.status} — hanya New yang bisa dijalankan`);
    }
    await db.dataSubjectRequest.update({ where: { id: dsr.id }, data: { status: "InProgress" } });
    await db.activityLog.create({
      data: {
        actorType: "user", employeeId: actor?.employeeId ?? null,
        action: "DsrUpdated", entity: "DataSubjectRequest", entityId: dsr.employee.employeeNo,
        detail: `DSR ${dsr.type} karyawan ${dsr.employee.employeeNo} mulai ditangani${actor?.name ? ` oleh ${actor.name}` : ""}`,
      },
    }).catch(() => {});
    return;
  }
  if (dsr.status !== "New" && dsr.status !== "InProgress") {
    bad(`DSR ${dsr.type} ${dsr.employee.employeeNo} sudah berstatus ${dsr.status}`);
  }
  if (target === "Rejected") {
    if (note.length < 10) bad("Alasan penolakan DSR wajib diisi (minimal 10 karakter)");
    await db.dataSubjectRequest.update({
      where: { id: dsr.id },
      data: { status: "Rejected", handledById: actor?.employeeId ?? null, handledAt: new Date(), resultNote: note },
    });
    await db.activityLog.create({
      data: {
        actorType: "user", employeeId: actor?.employeeId ?? null,
        action: "DsrRejected", entity: "DataSubjectRequest", entityId: dsr.employee.employeeNo,
        detail: `DSR ${dsr.type} karyawan ${dsr.employee.employeeNo} — ${dsr.employee.fullName} DITOLAK${actor?.name ? ` oleh ${actor.name}` : ""} — alasan: ${note}`,
      },
    }).catch(() => {});
    return;
  }
  // Completed — resultNote wajib (ringkasan tindakan: paket diunduh / akses
  // diberikan / keputusan Erase ditangani manual sesuai §37)
  if (!note) bad("Ringkasan hasil penyelesaian DSR wajib diisi");
  await db.dataSubjectRequest.update({
    where: { id: dsr.id },
    data: { status: "Completed", handledById: actor?.employeeId ?? null, handledAt: new Date(), resultNote: note },
  });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "DsrCompleted", entity: "DataSubjectRequest", entityId: dsr.employee.employeeNo,
      detail: `DSR ${dsr.type} karyawan ${dsr.employee.employeeNo} — ${dsr.employee.fullName} DISELESAIKAN${actor?.name ? ` oleh ${actor.name}` : ""} — ${note}`,
    },
  }).catch(() => {});
  // notifikasi ke karyawan: permintaannya selesai (deep-link ESS)
  void notifyEvent(db, {
    to: "employee", docType: "DataSubjectRequest", docNo: dsr.employee.employeeNo,
    employeeId: dsr.employee.id,
    title: `Permintaan data Anda selesai (${dsr.type})`,
    body: `Permintaan subjek data ${dsr.type} atas data kinerja Anda telah ditangani. Ringkasan: ${note}`,
    kind: "performance", link: "ess:my-appraisal",
  }).catch(() => { /* never */ });
}

// ============ paket Export (hak ekspor — UU PDP Pasal 7) ============

/**
 * Workbook multi-sheet DSR Export karyawan: sheet 1 identitas dasar (PII
 * limited — tanpa gaji/NIK/npwp/rekening; pola pf23 P8) + 5 sheet riwayat
 * kinerja (PP 35/2021 §7.2): penilaian+KPI · kompetensi · jejak kalibrasi ·
 * 360 ter-agregasi ANONIM ≥3 reviewer (§37) · PIP+surat+merit ringkas.
 * Hanya untuk DSR karyawan bertipe Export/Access; unduhan ter-audit.
 * decMoney: money-view gate utk nominal merit (§37 vault — masked → null).
 */
export async function buildDsrPackageSheets(
  db: TenantDb,
  dsrId: string,
  lang: Lang,
  decMoney: (v: string | null | undefined) => number | null,
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<ExportSheet[]> {
  const dsr = await db.dataSubjectRequest.findUnique({
    where: { id: dsrId },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
  if (!dsr) notFound("Permintaan data (DSR) tidak ditemukan");
  if (!dsr.employeeId || !dsr.employee) {
    bad("Paket DSR karyawan hanya untuk DSR karyawan (bukan DSR pelamar)");
  }
  if (dsr.type !== "Export" && dsr.type !== "Access") {
    bad(`Paket data hanya untuk DSR Export/Access (ini ${dsr.type})`);
  }
  const emp = await db.employee.findUnique({
    where: { id: dsr.employeeId },
    select: {
      id: true, employeeNo: true, fullName: true, joinDate: true,
      orgUnit: { select: { name: true } },
      position: { select: { title: true } },
      assignments: { where: { validTo: null }, orderBy: { validFrom: "desc" }, take: 1, select: { employmentStatus: true } },
    },
  });
  if (!emp) notFound("Karyawan tidak ditemukan");

  const title = `${trFor(lang, "Paket Data Subjek — Data Pribadi & Kinerja (UU PDP §7.3)", "Data Subject Package — Personal & Performance Data (UU PDP §7.3)")} — ${emp.employeeNo} ${emp.fullName} · ${dateOf(new Date(), lang)}`;
  const dash = "—";
  const s = (v: unknown): string => (v == null || v === "" ? dash : String(v));
  const num = (v: number | null | undefined): ExportCell => (v == null ? "" : v);

  // ---- sheet 1: identitas dasar SAJA (PII limited — kolom gaji/NIK/npwp/
  // rekening sengaja TIDAK dibundel; identitas dasar cukup utk memverifikasi
  // pemilik data; pola employee-detail P8) ----
  const sheet1: ExportSheet = {
    name: trFor(lang, "Data Pribadi", "Personal Data"),
    title,
    columns: [
      { header: trFor(lang, "No. Karyawan", "Employee No."), width: 14 },
      { header: trFor(lang, "Nama", "Name"), width: 26 },
      { header: trFor(lang, "Unit Kerja", "Work Unit"), width: 22 },
      { header: trFor(lang, "Jabatan", "Position"), width: 24 },
      { header: trFor(lang, "Tanggal Masuk", "Join Date"), width: 14 },
      { header: trFor(lang, "Status Kepegawaian", "Employment Status"), width: 18 },
    ],
    rows: [[
      emp.employeeNo,
      emp.fullName,
      s(emp.orgUnit?.name),
      s(emp.position?.title),
      dateOf(emp.joinDate, lang),
      s(emp.assignments[0]?.employmentStatus),
    ]],
  };

  // ---- muat riwayat kinerja lintas siklus ----
  const recs = await db.appraisalRecord.findMany({
    where: { employeeId: emp.id },
    include: {
      cycle: { select: { code: true, periodStart: true, periodEnd: true } },
      manager: { select: { fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
      comps: { include: { competency: { select: { name: true, kind: true } } } },
    },
    orderBy: [{ cycle: { periodStart: "asc" } }, { docNo: "asc" }],
    take: 200,
  });
  const recIds = recs.map((r) => r.id);
  const [decisions, f360s, pips, merits, letters] = await Promise.all([
    recIds.length
      ? db.calibrationDecision.findMany({ where: { appraisalId: { in: recIds } }, orderBy: { decidedAt: "asc" }, take: 500 })
      : Promise.resolve([] as Awaited<ReturnType<typeof db.calibrationDecision.findMany>>),
    recIds.length
      ? db.feedback360.findMany({
          where: { appraisalId: { in: recIds }, status: "Submitted" },
          select: { id: true, appraisalId: true },
        })
      : Promise.resolve([] as { id: string; appraisalId: string }[]),
    db.pipPlan.findMany({
      where: { employeeId: emp.id },
      include: { checkpoints: { orderBy: { seq: "asc" } } },
      orderBy: { docNo: "asc" },
      take: 50,
    }),
    recIds.length
      ? db.meritRecommendation.findMany({ where: { appraisalId: { in: recIds } }, orderBy: { docNo: "asc" }, take: 100 })
      : Promise.resolve([] as Awaited<ReturnType<typeof db.meritRecommendation.findMany>>),
    db.letterDocument.findMany({
      where: {
        employeeId: emp.id,
        templateKey: { in: [PERF_RESULT_KEY, PERF_PIP_KEY, PROB_RESULT_KEY, PROB_EXTEND_KEY] },
      },
      orderBy: { issuedAt: "desc" },
      take: 100,
    }),
  ]);
  const recBy = new Map(recs.map((r) => [r.id, r]));
  const f360Ids = f360s.map((f) => f.id);
  const f360Answers = f360Ids.length
    ? await db.feedback360Answer.findMany({
        where: { feedbackId: { in: f360Ids } },
        include: { competency: { select: { name: true } } },
      })
    : [];
  // agregat 360 per appraisal × kompetensi — ANONIM (§37): hanya bila appraisal
  // punya ≥3 reviewer Submitted; <3 → skor dirahasiakan.
  const submittedCount = new Map<string, number>();
  for (const f of f360s) submittedCount.set(f.appraisalId, (submittedCount.get(f.appraisalId) ?? 0) + 1);
  const fbOf = new Map<string, string>(); // feedbackId → appraisalId
  for (const f of f360s) fbOf.set(f.id, f.appraisalId);
  const agg360 = new Map<string, { name: string; scores: number[]; comments: string[] }>();
  for (const a of f360Answers) {
    const apprId = fbOf.get(a.feedbackId);
    if (!apprId) continue;
    const key = `${apprId}::${a.competencyId}`;
    const g = agg360.get(key) ?? { name: a.competency.name, scores: [], comments: [] };
    g.scores.push(a.score);
    if (a.comment) g.comments.push(a.comment);
    agg360.set(key, g);
  }

  // ---- sheet 2: riwayat penilaian + skor KPI per siklus (PP 35/2021 §7.2) ----
  const sheet2: ExportSheet = {
    name: trFor(lang, "Penilaian & KPI", "Appraisal & KPI"),
    title,
    columns: [
      { header: trFor(lang, "No. Dokumen", "Document No."), width: 16 },
      { header: trFor(lang, "Siklus", "Cycle"), width: 14 },
      { header: trFor(lang, "Periode Siklus", "Cycle Period"), width: 24 },
      { header: trFor(lang, "Atasan Penilai", "Manager"), width: 22 },
      { header: trFor(lang, "Status", "Status"), width: 16 },
      { header: trFor(lang, "Skor Final", "Final Score"), width: 10 },
      { header: trFor(lang, "Rating", "Rating"), width: 8 },
      { header: trFor(lang, "Judul KPI", "KPI Title"), width: 30 },
      { header: trFor(lang, "Satuan", "Unit"), width: 8 },
      { header: trFor(lang, "Polaritas", "Polarity"), width: 10 },
      { header: trFor(lang, "Bobot %", "Weight %"), width: 9 },
      { header: trFor(lang, "Ambang", "Threshold"), width: 10 },
      { header: trFor(lang, "Target", "Target"), width: 10 },
      { header: trFor(lang, "Aktual Akhir", "Final Actual"), width: 12 },
      { header: trFor(lang, "Kritis", "Critical"), width: 7 },
    ],
    rows: recs.flatMap((r) => {
      const base = [
        r.docNo, r.cycle.code,
        `${dateOf(r.cycle.periodStart, lang)} – ${dateOf(r.cycle.periodEnd, lang)}`,
        s(r.manager?.fullName), r.status,
        num(r.finalScore), num(r.finalRating),
      ] as ExportCell[];
      if (r.kpis.length === 0) {
        return [[...base, dash, dash, dash, dash, dash, dash, dash, dash, dash] as ExportCell[]];
      }
      return r.kpis.map((k) => [
        ...base,
        k.title, k.unit, k.polarity, k.weight,
        num(k.thresholdMin), num(k.target), num(k.finalActual),
        k.isCritical ? trFor(lang, "F", "F") : "",
      ] as ExportCell[]);
    }),
  };

  // ---- sheet 3: kompetensi (self vs atasan + catatan) ----
  const sheet3: ExportSheet = {
    name: trFor(lang, "Kompetensi", "Competencies"),
    title,
    columns: [
      { header: trFor(lang, "No. Dokumen", "Document No."), width: 16 },
      { header: trFor(lang, "Siklus", "Cycle"), width: 14 },
      { header: trFor(lang, "Kompetensi", "Competency"), width: 26 },
      { header: trFor(lang, "Jenis", "Kind"), width: 14 },
      { header: trFor(lang, "Nilai Diri", "Self"), width: 8 },
      { header: trFor(lang, "Nilai Atasan", "Manager"), width: 10 },
      { header: trFor(lang, "Catatan Atasan", "Manager Comment"), width: 40 },
    ],
    rows: recs.flatMap((r) => r.comps.map((c) => [
      r.docNo, r.cycle.code, c.competency.name, c.competency.kind,
      num(c.selfScore), num(c.score), s(c.comment),
    ] as ExportCell[])),
  };

  // ---- sheet 4: jejak kalibrasi (keputusan + banding — audit PP 35/2021) ----
  const sheet4: ExportSheet = {
    name: trFor(lang, "Jejak Kalibrasi", "Calibration Trail"),
    title,
    columns: [
      { header: trFor(lang, "No. Dokumen", "Document No."), width: 16 },
      { header: trFor(lang, "Siklus", "Cycle"), width: 14 },
      { header: trFor(lang, "Skor dari", "Score From"), width: 10 },
      { header: trFor(lang, "Skor ke", "Score To"), width: 10 },
      { header: trFor(lang, "Rating dari", "Rating From"), width: 11 },
      { header: trFor(lang, "Rating ke", "Rating To"), width: 11 },
      { header: trFor(lang, "Alasan", "Reason"), width: 46 },
      { header: trFor(lang, "Diputus oleh", "Decided By"), width: 18 },
      { header: trFor(lang, "Waktu", "Decided At"), width: 12 },
    ],
    rows: decisions.map((d) => {
      const ap = recBy.get(d.appraisalId);
      return [
        s(ap?.docNo), s(ap?.cycle.code),
        num(d.oldScore), num(d.newScore), num(d.oldRating), num(d.newRating),
        s(d.reason), s(d.decidedBy), d.decidedAt ? dateOf(d.decidedAt, lang) : dash,
      ] as ExportCell[];
    }),
  };

  // ---- sheet 5: 360 TER-AGREGASI ANONIM (≥3 reviewer §37) ----
  const sheet5: ExportSheet = {
    name: trFor(lang, "360 Ter-agregasi", "360 Aggregated"),
    title,
    columns: [
      { header: trFor(lang, "No. Dokumen", "Document No."), width: 16 },
      { header: trFor(lang, "Siklus", "Cycle"), width: 14 },
      { header: trFor(lang, "Kompetensi", "Competency"), width: 26 },
      { header: trFor(lang, "Rata-rata", "Average"), width: 10 },
      { header: trFor(lang, "Jumlah Reviewer", "Reviewer Count"), width: 14 },
      { header: trFor(lang, "Komentar (Kolektif)", "Comments (Collective)"), width: 52 },
    ],
    rows: [...agg360.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, g]) => {
        const [apprId] = key.split("::");
        const ap = recBy.get(apprId);
        const enough = (submittedCount.get(apprId) ?? 0) >= 3; // §37 anonimitas ≥3
        return [
          s(ap?.docNo), s(ap?.cycle.code), g.name,
          enough ? Math.round((g.scores.reduce((x, y) => x + y, 0) / g.scores.length) * 10) / 10 : dash,
          enough ? g.scores.length : dash,
          enough ? (g.comments.length ? g.comments.join(" · ") : dash) : trFor(lang, "Dirahasiakan — kurang dari 3 reviewer", "Hidden — fewer than 3 reviewers"),
        ] as ExportCell[];
      }),
  };

  // ---- sheet 6: PIP + surat + merit (ringkas) ----
  const rows6: ExportCell[][] = [];
  for (const p of pips) {
    const reviewed = p.checkpoints.filter((c) => c.status === "Reviewed");
    const last = p.checkpoints[p.checkpoints.length - 1] ?? null;
    rows6.push([
      "PIP",
      p.docNo,
      `${dateOf(p.startDate, lang)} – ${dateOf(p.endDate, lang)}`,
      trFor(lang,
        `checkpoint direview ${reviewed.length}/${p.checkpoints.length}${last?.achievementPct != null ? ` · capaian terakhir ${last.achievementPct}%` : ""}${p.outcomeNotes ? ` · ${p.outcomeNotes}` : ""}`,
        `${reviewed.length}/${p.checkpoints.length} checkpoints reviewed${last?.achievementPct != null ? ` · last achievement ${last.achievementPct}%` : ""}${p.outcomeNotes ? ` · ${p.outcomeNotes}` : ""}`),
      p.status,
      dash,
    ]);
  }
  for (const m of merits) {
    const ap = recBy.get(m.appraisalId);
    rows6.push([
      "Merit",
      m.docNo,
      s(ap?.cycle.code),
      trFor(lang,
        `bonus ${m.bonusMonths ?? dash} bln${m.bonusAmount ? ` · Rp ${decMoney(m.bonusAmount)?.toLocaleString("id-ID") ?? "•••"}` : ""}${m.raisePct != null ? ` · kenaikan ${m.raisePct}%` : ""}${m.raiseAmount ? ` · Rp ${decMoney(m.raiseAmount)?.toLocaleString("id-ID") ?? "•••"}` : ""} · penilaian ${s(ap?.docNo)}`,
        `bonus ${m.bonusMonths ?? dash} mo${m.bonusAmount ? ` · Rp ${decMoney(m.bonusAmount)?.toLocaleString("id-ID") ?? "•••"}` : ""}${m.raisePct != null ? ` · raise ${m.raisePct}%` : ""}${m.raiseAmount ? ` · Rp ${decMoney(m.raiseAmount)?.toLocaleString("id-ID") ?? "•••"}` : ""} · appraisal ${s(ap?.docNo)}`),
      m.status,
      s(m.appliedRunNo),
    ]);
  }
  for (const l of letters) {
    const lbl = LETTER_KEY_LABEL[l.templateKey];
    rows6.push([
      trFor(lang, "Surat", "Letter"),
      l.refNo,
      trFor(lang, "Kinerja", "Performance"),
      `${lbl ? trFor(lang, lbl[0], lbl[1]) : l.templateKey}${l.subject ? ` — ${l.subject}` : ""}`,
      dash,
      dateOf(l.issuedAt, lang),
    ]);
  }
  const sheet6: ExportSheet = {
    name: trFor(lang, "PIP · Surat · Merit", "PIP · Letters · Merit"),
    title,
    columns: [
      { header: trFor(lang, "Jenis", "Kind"), width: 10 },
      { header: trFor(lang, "No. Dokumen", "Document No."), width: 18 },
      { header: trFor(lang, "Siklus / Periode", "Cycle / Period"), width: 24 },
      { header: trFor(lang, "Ringkasan", "Summary"), width: 64 },
      { header: trFor(lang, "Status", "Status"), width: 14 },
      { header: trFor(lang, "Run / Tanggal", "Run / Date"), width: 16 },
    ],
    rows: rows6,
  };

  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "DsrExported", entity: "DataSubjectRequest", entityId: emp.employeeNo,
      detail: `Paket DSR (XLSX 6 sheet) karyawan ${emp.employeeNo} — ${emp.fullName} dibuat: identitas dasar + riwayat kinerja PP 35/2021 §7.2${actor?.name ? ` oleh ${actor.name}` : ""}`,
    },
  }).catch(() => {});

  return [sheet1, sheet2, sheet3, sheet4, sheet5, sheet6];
}
