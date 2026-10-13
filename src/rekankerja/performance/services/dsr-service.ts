// P9-PERF — service DSR KARYAWAN (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P9;
// §7.3 UU PDP No. 27/2022; §37): perluasan DataSubjectRequest yang sudah ada
// untuk pelamar (F9-REC) ke KARYAWAN — hak akses/ekspor/hapus DATA KINERJA.
//
// PILAR DESAIN (mirror recruitment compliance-service + pola performance):
// • SLA 7 hari (DSR_SLA_DAYS — praktik industri UU PDP, sama dgn DSR pelamar).
// • State machine New → InProgress → Completed|Rejected (transisi sah saja;
//   Rejected wajib alasan ≥10 char; Completed wajib resultNote tidak kosong).
// • Paket Export = 1 sheet identitas dasar (PII limited — pola employee-detail
//   P8: TANPA gaji/NIK/npwp/rekening) + REUSE 5 sheet riwayat kinerja
//   buildEmployeeHistorySheets (PP 35/2021 §7.2 — eksporabel & ter-audit).
// • Erase TIDAK menghapus data kinerja otomatis — karyawan aktif & bukti
//   keputusan kepegawaian (PP 35/2021 §7.2) = dasar sah mempertahankan data;
//   keputusan ditangani HR manual lewat resultNote (§37: penghapusan manual).
// • ActivityLog di setiap aksi (opsional try-catch — pola proyek).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { ExportSheet } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";
import { trFor } from "@/rekankerja/shared/lib/i18n-core";
import { buildEmployeeHistorySheets } from "@/rekankerja/performance/api/report-documents";

function bad(msg: string): never { throw new Error(msg); }

export type EmployeeDsrType = "Access" | "Export" | "Erase";

const DSR_TYPES: readonly EmployeeDsrType[] = ["Access", "Export", "Erase"];
/** SLA penanganan DSR karyawan (UU PDP — 7 hari, mirror DSR pelamar F9-REC). */
export const DSR_SLA_DAYS = 7;

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;

// ============ infrastruktur (self-heal — pola ensurePipInfrastructure) ============

/**
 * Pastikan PerformanceSetting ada (retentionYears dipakai halaman Kepatuhan &
 * job perf-retention-scan). Tenant baru via provisioning; tenant lama di-heal
 * saat menu Kepatuhan dibuka (GET) — idempoten.
 */
export async function ensureDsrInfrastructure(db: TenantDb): Promise<void> {
  const st = await db.performanceSetting.findFirst({ select: { id: true } });
  if (!st) {
    await db.performanceSetting.create({ data: {} }).catch(() => null); // race tenant bootstrap
  }
}

// ============ opsi karyawan (picker dialog Buat DSR) ============

/** Karyawan Active utk dialog Buat DSR (pola searchPipEmployees). */
export async function searchDsrEmployees(db: TenantDb, q?: string) {
  const where: Record<string, unknown> = { status: "Active" };
  if (q) where.OR = [
    { employeeNo: { contains: q, mode: "insensitive" } },
    { fullName: { contains: q, mode: "insensitive" } },
  ];
  const emps = await db.employee.findMany({
    where,
    select: { id: true, employeeNo: true, fullName: true, position: { select: { title: true } }, orgUnit: { select: { name: true } } },
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

export async function createEmployeeDsr(
  db: TenantDb,
  input: { employeeId: string; type: string; note?: string | null },
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<{ id: string }> {
  if (!(DSR_TYPES as readonly string[]).includes(input.type)) {
    bad(`Tipe DSR tidak dikenal: ${input.type} (harus Access|Export|Erase)`);
  }
  const emp = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNo: true, fullName: true },
  });
  if (!emp) bad("Karyawan tidak ditemukan");
  // NOTE: tidak dibatasi status Active — mantan karyawan tetap subjek data UU
  // PDP atas data kinerjanya (hak akses/ekspor bertahan pasca-kerja; picker
  // UI memang hanya menawarkan Active, tapi panggilan utk ex-karyawan sah).
  const active = await db.dataSubjectRequest.findFirst({
    where: { employeeId: emp.id, status: { in: ["New", "InProgress"] } },
    select: { id: true, type: true },
  });
  if (active) {
    bad(`Karyawan ${emp.employeeNo} masih punya DSR aktif (${active.type}) — selesaikan dulu`);
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
      detail: `DSR ${input.type} karyawan ${emp.employeeNo} — ${emp.fullName} dicatat (SLA ${dueAt.toISOString().slice(0, 10)})${actor?.name ? ` oleh ${actor.name}` : ""}${input.note?.trim() ? ` — catatan: ${input.note.trim()}` : ""}`,
    },
  }).catch(() => {});
  return { id: row.id };
}

// ============ daftar (inbox kepatuhan — hanya DSR karyawan) ============

export interface EmployeeDsrRow {
  id: string;
  employeeNo: string;
  employeeName: string;
  unit: string | null;
  type: string;
  status: string;
  note: string | null;
  dueAt: string;
  createdAt: string;
  handledAt: string | null;
  resultNote: string | null;
  handlerName: string | null;
  overdue: boolean;
}

const DSR_STATUS_RANK: Record<string, number> = { New: 0, InProgress: 1, Completed: 2, Rejected: 3 };

/**
 * Daftar DSR KARYAWAN (employeeId != null — DSR pelamar F9-REC TIDAK ikut;
 * kebalikannya juga berlaku di listDsr recruitment). Urut: status New dulu,
 * lalu dueAt asc (pola recruitment).
 */
export async function listEmployeeDsr(db: TenantDb): Promise<EmployeeDsrRow[]> {
  const rows = await db.dataSubjectRequest.findMany({
    where: { employeeId: { not: null } },
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
      handledBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows
    .map((r) => ({
      id: r.id,
      employeeNo: r.employee?.employeeNo ?? "—",
      employeeName: r.employee?.fullName ?? "—",
      unit: r.employee?.orgUnit?.name ?? null,
      type: r.type,
      status: r.status,
      note: r.note,
      dueAt: r.dueAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      resultNote: r.resultNote,
      handlerName: r.handledBy?.fullName ?? null,
      overdue: (r.status === "New" || r.status === "InProgress") && r.dueAt.getTime() < Date.now(),
    }))
    .sort((a, b) =>
      (DSR_STATUS_RANK[a.status] ?? 9) - (DSR_STATUS_RANK[b.status] ?? 9) ||
      a.dueAt.localeCompare(b.dueAt),
    );
}

// ============ transisi status (New → InProgress → Completed|Rejected) ============

/**
 * Transisi sah satu langkah: New → InProgress; New|InProgress → Completed
 * (resultNote wajib); New|InProgress → Rejected (resultNote ≥10 char).
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
    include: { employee: { select: { employeeNo: true, fullName: true } } },
  });
  if (!dsr) bad("Permintaan data (DSR) tidak ditemukan");
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
}

// ============ paket Export (hak ekspor — UU PDP Pasal 7) ============

/**
 * Workbook multi-sheet DSR Export karyawan: sheet 1 identitas dasar (PII
 * limited — tanpa gaji/NIK/npwp/rekening; pola employee-detail P8) + 5 sheet
 * riwayat kinerja lintas siklus REUSE buildEmployeeHistorySheets (PP 35/2021
 * §7.2). Hanya untuk DSR karyawan bertipe Export; unduhan ter-audit.
 */
export async function buildDsrPackageSheets(
  db: TenantDb,
  dsrId: string,
  lang: Lang,
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<ExportSheet[]> {
  const dsr = await db.dataSubjectRequest.findUnique({
    where: { id: dsrId },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
  if (!dsr) bad("Permintaan data (DSR) tidak ditemukan");
  if (!dsr.employeeId || !dsr.employee) {
    bad("Paket DSR karyawan hanya untuk DSR karyawan (bukan DSR pelamar)");
  }
  if (dsr.type !== "Export") {
    bad(`Paket data hanya untuk DSR Export (ini ${dsr.type})`);
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
  if (!emp) bad("Karyawan tidak ditemukan");

  const title = `${trFor(lang, "Paket Data Subjek — Data Pribadi & Kinerja (UU PDP §7.3)", "Data Subject Package — Personal & Performance Data (UU PDP §7.3)")} — ${dateID(new Date())}`;
  // sheet 1: identitas dasar SAJA (PII limited — kolom gaji/NIK/npwp/rekening
  // sengaja tidak dibundel; identitas dasar cukup utk memverifikasi pemilik data)
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
      emp.orgUnit?.name ?? "—",
      emp.position?.title ?? "—",
      dateID(emp.joinDate),
      emp.assignments[0]?.employmentStatus ?? "—",
    ]],
  };

  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "DsrExported", entity: "DataSubjectRequest", entityId: emp.employeeNo,
      detail: `Paket DSR (XLSX) karyawan ${emp.employeeNo} — ${emp.fullName} dibuat: identitas dasar + riwayat kinerja PP 35/2021 §7.2${actor?.name ? ` oleh ${actor.name}` : ""}`,
    },
  }).catch(() => {});

  const historySheets = await buildEmployeeHistorySheets(db, emp.id, lang);
  return [sheet1, ...historySheets];
}
