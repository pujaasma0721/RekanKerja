import { NextRequest, NextResponse } from "next/server";
import { type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { type Employee, Prisma } from "@/generated/tenant";
import * as ExcelJS from "exceljs";
import { requireMenuAction, resolveMenuPerms } from "@/onevity/shared/services/menu-access";
import { requireScoped, scopeWhere, resolveAccessScope } from "@/onevity/shared/services/access-scope";
import { readVerifiedSession } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { tenantCryptoForDb, type FieldCrypto } from "@/onevity/shared/lib/field-crypto";
import { CURRENT_ASSIGNMENT_INCLUDE, flattenEmployee, syncEmployeePlacementSnapshot, decryptBaseSalary, type DbOrTx } from "@/onevity/human-resource/services/assignment";
import { validateSalaryAgainstGrade, PATargetError } from "@/onevity/human-resource/services/pa-targets";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportColumn } from "@/onevity/shared/lib/export";

/** Sanitasi kode perusahaan/slug → prefix nomor karyawan (A-Z0-9). */
function codePrefix(code: string | null | undefined): string {
  return String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Prefix employeeNo tenant ini — fix audit AUDIT-1: dulu hard-coded "MII"
 * sehingga karyawan tenant Cahaya/Sentra pun ikut bernomor MII000xx.
 * Sumber: Company.code tenant (mis. MII); bila Company belum di-set / tanpa
 * kode → fallback 3 karakter pertama slug tenant (registry platform, via
 * sesi); terakhir "EMP" bila keduanya kosong. Pola nomor: {PREFIX}{5 digit}.
 */
async function employeeNoPrefix(req: NextRequest, companyCode: string | null | undefined): Promise<string> {
  const fromCompany = codePrefix(companyCode);
  if (fromCompany) return fromCompany;
  try {
    const session = await readVerifiedSession(req);
    if (session?.tid) {
      const tenant = await platformDb.tenant.findUnique({
        where: { id: session.tid },
        select: { slug: true },
      });
      const fromSlug = codePrefix(tenant?.slug).slice(0, 3);
      if (fromSlug) return fromSlug;
    }
  } catch {
    // registry platform tak terbaca → lanjut ke default
  }
  return "EMP";
}

/**
 * create employee + penomoran employeeNo race-safe (fix audit AUDIT-1):
 * nomor dihitung dari max urutan dgn prefix yang sama, lalu insert.
 * Bila P2002 (dua onboarding paralel merebut nomor sama) → retry 1× dgn
 * nomor dihitung ulang; kalah lagi → dilempar (catch route → 400 ramah).
 */
async function createEmployeeWithNoRetry(
  db: DbOrTx,
  prefix: string,
  data: Omit<Prisma.EmployeeUncheckedCreateInput, "employeeNo">,
): Promise<Employee> {
  for (let attempt = 0; ; attempt++) {
    const last = await db.employee.findFirst({
      where: { employeeNo: { startsWith: prefix } },
      orderBy: { employeeNo: "desc" },
      select: { employeeNo: true },
    });
    const lastSeq = last ? Number(last.employeeNo.slice(prefix.length).replace(/\D/g, "")) : 0;
    const employeeNo = `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(5, "0")}`;
    try {
      return await db.employee.create({ data: { ...data, employeeNo } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002" && attempt === 0) continue; // retry 1× (nomor baru)
      throw e;
    }
  }
}

/** Data penempatan awal untuk createEmployeeWithAssignment(). */
export interface AssignmentSeed {
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  managerId: string | null;
  companyOfficeId: string | null;
  workLocationId: string | null;
  employmentStatus: string;
  workShift: string;
  baseSalary: number;
  validFrom: Date;
  changeReason: string;
  notes: string | null;
}

/**
 * T13-IMPORT: inti create karyawan yang DIPAKAI ULANG wizard (POST /employees)
 * dan bulk import Excel — Employee + EmployeeAssignment awal (riwayat baris
 * pertama) + snapshot dimensi approval (syncEmployeePlacementSnapshot).
 * Bekerja pada client tenant ATAU transaksi interaktif ($transaction).
 * 28-c: NIK/NPWP/rekening + gaji pokok DIENKRIPSI saat persist — tc WAJIB
 * (client $transaction tidak membawa brand schema; ambil dari client luar).
 * ActivityLog tetap ditulis PEMANGGIL (teks berbeda per konteks).
 */
export async function createEmployeeWithAssignment(
  db: DbOrTx,
  prefix: string,
  employeeData: Omit<Prisma.EmployeeUncheckedCreateInput, "employeeNo">,
  assignment: AssignmentSeed,
  tc: FieldCrypto,
): Promise<Employee> {
  // 28-c: enkripsi field sensitif (NIK/NPWP/rekening) sebelum persist.
  const encData: Omit<Prisma.EmployeeUncheckedCreateInput, "employeeNo"> = {
    ...employeeData,
    nationalId: employeeData.nationalId != null ? tc.encryptText(employeeData.nationalId) : null,
    taxId: employeeData.taxId != null ? tc.encryptText(employeeData.taxId) : null,
    bankAccount: employeeData.bankAccount != null ? tc.encryptText(employeeData.bankAccount) : null,
  };
  const employee = await createEmployeeWithNoRetry(db, prefix, encData);
  await db.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      orgUnitId: assignment.orgUnitId,
      positionId: assignment.positionId,
      gradeId: assignment.gradeId,
      managerId: assignment.managerId,
      companyOfficeId: assignment.companyOfficeId,
      workLocationId: assignment.workLocationId,
      employmentStatus: assignment.employmentStatus,
      workShift: assignment.workShift,
      // 28-c: gaji pokok disimpan TERENKRIPSI (enc:v1:n:…).
      baseSalary: tc.encryptMoney(assignment.baseSalary),
      validFrom: assignment.validFrom,
      validTo: null,
      changeReason: assignment.changeReason,
      notes: assignment.notes,
    },
  });
  // dorong snapshot parameter penempatan (dimensi approval berjenjang — Task 25)
  await syncEmployeePlacementSnapshot(db, employee.id);
  return employee;
}

// GET /api/onevity/employees?q=...&status=...&unit=...&employmentStatus=...&limit=&offset=
// Multi-tenant: db = schema tenant dari session cookie (isolasi per workspace).
// Skema akses data (Task 30): hasil query dibatasi cakupan akses efektif
// pengguna (super admin semua, atasan langsung bawahan, rule parametrik).
// M-11 (audit 42): + gerbang MENU LIHAT — daftar karyawan memuat kolom PII
// (NIK/NPWP/rekening/alamat/telp — didekripsi di batas serializer), jadi hanya
// pemegang LIHAT menu halaman KONSUMEN endpoint ini yang mendapat query
// ter-scope penuh; anggota tenant tanpa menu dipaksa self-scope (lihat guard
// di dalam GET — satu-satunya konsumen non-menu adalah pencarian global shell
// admin-mode, yang bagi karyawan cukup menemukan DIRINYA sendiri).
const EMPLOYEE_LIST_MENUS = [
  "hr:directory", // Direktori Karyawan (employee-directory.tsx) — konsumen utama
  "hr:tree", // Unit Organisasi — daftar karyawan per unit (org-module.tsx)
  "settings:security", // Keamanan & Akses — pilih karyawan (user-security-view.tsx)
  "settings:audit", // Log Aktivitas — filter karyawan (activity-log-view.tsx)
  "payroll:runs", // dialog Bonus Massal di halaman run (bonus-massal-dialog.tsx)
] as const;

export async function GET(req: NextRequest) {
  try {
    const s = await requireScoped(req);
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
    const db = s.db;

    // ==== M-11 (audit 42): gerbang menu + self-scope fallback ====
    // • super admin / mode ALL / CUSTOM dgn LIHAT di salah satu menu konsumen
    //   → perilaku lama (query ter-scope skema akses).
    // • TANPA menu → self-scope SAJA (actor.employeeId) — bentuk respons
    //   dipertahankan (subset; konsumen ESS-satunya = pencarian global shell).
    // • TANPA menu & tanpa employeeId → 403 (pola pesan 43-a).
    // Field-selection PII per role (audit M-9 / desain 42-e) tetap di Task 44.
    const menu = await resolveMenuPerms(req);
    const hasListMenu = Boolean(
      menu && (menu.all || EMPLOYEE_LIST_MENUS.some((k) => menu.perms[k]?.view === true)),
    );
    const selfEmployeeId = s.scope.selfEmployeeId;
    if (!hasListMenu && !selfEmployeeId) {
      return NextResponse.json(
        {
          error:
            `Akses ditolak: Anda tidak memiliki aksi "Lihat" pada menu ${EMPLOYEE_LIST_MENUS.join(" / ")}. ` +
            "Hak aksi diatur per pengguna — hubungi admin bila memerlukan akses.",
        },
        { status: 403 },
      );
    }
    // self-scope bagi non-menu: cakupan akses efektif di-narrow ke diri sendiri
    // (atasan/rule akses tidak lagi melihat PII bawahan lewat endpoint ini).
    const scopeCond = hasListMenu
      ? scopeWhere(s.scope)
      : { id: selfEmployeeId! };
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";
    const status = sp.get("status") ?? undefined;
    const unit = sp.get("unit") ?? undefined;
    const employmentStatus = sp.get("employmentStatus") ?? undefined;
    // 26-b P0 — filter PKWT: kontrak berakhir ≤ N hari (termasuk yang sudah lewat)
    const contractExpiring = sp.get("contractExpiring");
    const limit = Math.min(Number(sp.get("limit") ?? 50), 200);
    const offset = Number(sp.get("offset") ?? 0);

    const where: Record<string, unknown> = {};
    if (q) {
      where.OR = [
        { fullName: { contains: q } },
        { employeeNo: { contains: q } },
        { email: { contains: q } },
        { assignments: { some: { validTo: null, position: { title: { contains: q } } } } },
      ];
    }
    if (status && status !== "all") {
      // "inactive" = agregat semua status non-aktif
      where.status = status === "inactive" ? { in: ["Resigned", "Terminated", "Blacklisted"] } : status;
    }
    // 26-b: filter masa kontrak — hanya baris dgn contractEnd ≤ hari ini + N hari.
    // Pelacakan kontrak relevan utk karyawan AKTIF; bila user belum memfilter
    // status secara eksplisit, filter chip menyiratkan status Active.
    if (contractExpiring) {
      const days = Math.max(1, Number(contractExpiring) || 30);
      const limitDate = new Date();
      limitDate.setHours(23, 59, 59, 999);
      limitDate.setDate(limitDate.getDate() + days);
      where.contractEnd = { lte: limitDate };
      if (!status || status === "all") where.status = "Active";
    }
    // filter pekerjaan via assignment aktif
    const assignSome: Record<string, unknown> = { validTo: null };
    if (employmentStatus && employmentStatus !== "all") assignSome.employmentStatus = employmentStatus;
    if (unit && unit !== "all") assignSome.orgUnitId = unit;
    if (Object.keys(assignSome).length > 1) where.assignments = { some: assignSome };

    // gabungkan dengan cakupan skema akses (AND)
    const scoped: Record<string, unknown> = Object.keys(scopeCond).length > 0 ? { AND: [where, scopeCond] } : where;

    const [employeesRaw, total, statusAgg, empStatusAgg] = await Promise.all([
      db.employee.findMany({
        where: scoped,
        include: CURRENT_ASSIGNMENT_INCLUDE,
        orderBy: [{ status: "asc" }, { employeeNo: "asc" }],
        take: limit,
        skip: offset,
      }),
      db.employee.count({ where: scoped }),
      db.employee.groupBy({ by: ["status"], where: scoped, _count: true }),
      db.employeeAssignment.groupBy({ by: ["employmentStatus"], where: { validTo: null, employee: scoped }, _count: true }),
    ]);

    // 26-b — jumlah karyawan aktif dengan kontrak berakhir dalam band (chip filter)
    const contractBandCount = async (days: number) => {
      const limitDate = new Date();
      limitDate.setHours(23, 59, 59, 999);
      limitDate.setDate(limitDate.getDate() + days);
      return db.employee.count({ where: { ...scoped, status: "Active", contractEnd: { lte: limitDate } } });
    };
    const [contract30, contract60, contract90] = await Promise.all([
      contractBandCount(30).catch(() => 0),
      contractBandCount(60).catch(() => 0),
      contractBandCount(90).catch(() => 0),
    ]);

    const employees = employeesRaw.map((e) => {
      // 28-c: dekripsi identitas sensitif + gaji pokok di batas serializer.
      const flat = flattenEmployee(e, tenantCryptoForDb(db));
      // strip array dari response agar payload ramping
      const { assignments, ...rest } = flat as Record<string, unknown>;
      return rest;
    });

    const statusCount = (s: string) => statusAgg.find((r) => r.status === s)?._count ?? 0;
    const empCount = (s: string) => empStatusAgg.find((r) => r.employmentStatus === s)?._count ?? 0;

    return NextResponse.json({
      employees,
      total,
      limit,
      offset,
      stats: {
        total,
        active: statusCount("Active"),
        probation: empCount("Probation"),
        contract: empCount("Contract"),
        inactive: statusCount("Resigned") + statusCount("Terminated") + statusCount("Blacklisted"),
        // 26-b — PKWT: band masa kontrak tersisa (Active + contractEnd ≤ band)
        contract30,
        contract60,
        contract90,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/employees — create employee (wizard final step)
// Membuat employee (data personal + lifecycle) + assignment awal (data pekerjaan).
// Fix M-05/M-06: validasi server — gaji dalam rentang grade, FK valid (400 ramah, bukan 500).
// Fix C-02: guard mutasi (VIEWER ditolak; aktor dicatat di ActivityLog).
// Task 32-d: guard hak AKSI menu — create pada menu hr:directory (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.fullName || !String(b.fullName).trim()) {
      return NextResponse.json({ error: "Nama lengkap karyawan wajib diisi" }, { status: 400 });
    }
    const company = b.companyId
      ? await db.company.findUnique({ where: { id: b.companyId }, select: { id: true, code: true } })
      : await db.company.findFirst({ select: { id: true, code: true } });
    const companyId = company?.id;
    if (b.companyId && !company) {
      return NextResponse.json({ error: "Perusahaan tidak dikenal — pilih ulang perusahaan" }, { status: 400 });
    }
    if (!companyId) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    // (d) FK wajib valid → pesan 400 ramah (bukan error 500 prisma)
    if (b.orgUnitId) {
      const u = await db.orgUnit.findUnique({ where: { id: b.orgUnitId }, select: { id: true } });
      if (!u) return NextResponse.json({ error: "Unit organisasi tidak dikenal — pilih ulang unit" }, { status: 400 });
    }
    if (b.positionId) {
      const p = await db.position.findUnique({ where: { id: b.positionId }, select: { id: true } });
      if (!p) return NextResponse.json({ error: "Posisi tidak dikenal — pilih ulang posisi" }, { status: 400 });
    }
    if (b.gradeId) {
      const g = await db.grade.findUnique({ where: { id: b.gradeId }, select: { id: true } });
      if (!g) return NextResponse.json({ error: "Grade tidak dikenal — pilih ulang grade" }, { status: 400 });
    }
    if (b.managerId) {
      const mgr = await db.employee.findUnique({ where: { id: b.managerId }, select: { id: true } });
      if (!mgr) return NextResponse.json({ error: "Atasan langsung tidak dikenal — pilih ulang atasan" }, { status: 400 });
    }
    if (b.companyOfficeId) {
      const o = await db.companyOffice.findUnique({ where: { id: b.companyOfficeId }, select: { id: true } });
      if (!o) return NextResponse.json({ error: "Kantor tidak dikenal — pilih ulang kantor" }, { status: 400 });
    }
    if (b.workLocationId) {
      const w = await db.workLocation.findUnique({ where: { id: b.workLocationId }, select: { id: true } });
      if (!w) return NextResponse.json({ error: "Lokasi kerja tidak dikenal — pilih ulang lokasi" }, { status: 400 });
    }

    // (b) gaji pokok tidak boleh negatif; bila grade dipilih dan mendefinisikan rentang
    // min/max, gaji wajib dalam rentang itu (wizard memang advisory — server yang menegakkan).
    const baseSalary = b.baseSalary !== undefined && b.baseSalary !== null && String(b.baseSalary) !== "" ? Number(b.baseSalary) : 0;
    if (!Number.isFinite(baseSalary) || baseSalary < 0) {
      return NextResponse.json({ error: "Gaji pokok harus berupa angka tidak negatif" }, { status: 400 });
    }
    if (b.gradeId && baseSalary > 0) {
      try {
        await validateSalaryAgainstGrade(db, baseSalary, { gradeId: String(b.gradeId) }, "");
      } catch (e) {
        if (e instanceof PATargetError) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }

    // auto employeeNo — prefix Company.code tenant (fix AUDIT-1, dulu "MII"
    // hard-coded) + race P2002 ditangani (retry 1×, hitung ulang nomor).
    const prefix = await employeeNoPrefix(req, company.code);

    const joinDate = b.joinDate ? new Date(b.joinDate) : new Date();

    // 26-b P0 — PKWT PP 35/2021: tanggal kontrak opsional (hanya relevan utk
    // status Contract/Probation/Outsourcing); akhir harus setelah mulai.
    const contractStart = b.contractStart ? new Date(b.contractStart) : null;
    const contractEnd = b.contractEnd ? new Date(b.contractEnd) : null;
    const renewalCount = Math.max(0, Number(b.renewalCount) || 0);
    if (contractStart && contractEnd && contractEnd.getTime() <= contractStart.getTime()) {
      return NextResponse.json(
        { error: "Tanggal berakhir kontrak harus setelah tanggal mulai kontrak" },
        { status: 400 },
      );
    }
    const employmentStatus = b.employmentStatus ?? "Probation";
    const isPermanent = employmentStatus === "Permanent";
    const contractData = isPermanent
      ? { contractStart: null, contractEnd: null, renewalCount: 0 }
      : { contractStart, contractEnd, renewalCount };

    const employee = await createEmployeeWithAssignment(db, prefix, {
      fullName: b.fullName,
      gender: b.gender ?? "M",
      birthPlace: b.birthPlace ?? null,
      birthDate: b.birthDate ? new Date(b.birthDate) : null,
      nationalId: b.nationalId ?? null,
      taxId: b.taxId ?? null,
      maritalStatus: b.maritalStatus ?? null,
      religion: b.religion ?? null,
      bloodType: b.bloodType ?? null,
      email: b.email ?? null,
      phone: b.phone ?? null,
      address: b.address ?? null,
      city: b.city ?? null,
      bankName: b.bankName ?? null,
      bankAccount: b.bankAccount ?? null,
      companyId,
      joinDate,
      status: "Active",
      ...contractData,
    }, {
      orgUnitId: b.orgUnitId ?? null,
      positionId: b.positionId ?? null,
      gradeId: b.gradeId ?? null,
      managerId: b.managerId ?? null,
      companyOfficeId: b.companyOfficeId ?? null,
      workLocationId: b.workLocationId ?? null,
      employmentStatus: b.employmentStatus ?? "Probation",
      workShift: b.workShift ?? "Regular",
      baseSalary,
      validFrom: joinDate,
      changeReason: "Initial",
      notes: "Penempatan awal saat onboarding",
    }, tenantCryptoForDb(db));

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created",
        entity: "Employee",
        entityId: employee.id,
        employeeId: employee.id,
        detail: `Onboarding karyawan ${employee.fullName} (${employee.employeeNo}) oleh ${actor.appUsername ?? actor.name}`,
      },
    });

    return NextResponse.json({ employee }, { status: 201 });
  } catch (e) {
    // FK prisma (P2003) → 400 ramah (fix M-06d: bukan 500)
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa unit/posisi/grade/atasan" }, { status: 400 });
    }
    // employeeNo kalah race setelah retry (P2002 unique) → 400 ramah, bukan 500 Prisma mentah
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "Nomor karyawan baru sudah dipakai permintaan lain yang berjalan bersamaan — muat ulang dan coba lagi" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// =========================================================================
// T13-IMPORT — Bulk Import/Export Karyawan via Excel ======================
// =========================================================================
// Route tipis (src/app/api/onevity/employees/import + /export) memanggil:
//   • employeesImportGet  — GET  ?template=1 → XLSX template + sheet Referensi
//   • employeesImportPost — POST multipart (file + dryRun) → laporan / commit
//   • employeesExportGet  — GET  → XLSX direktori sesuai scope akses (pola T1)
// Komit memakai createEmployeeWithAssignment (inti yang sama dengan wizard)
// dalam transaksi per batch — employeeNo prefix Company.code (pola T6, P2002
// retry di dalam createEmployeeWithNoRetry).
// =========================================================================

const IMPORT_MAX_ROWS = 500;
const IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const IMPORT_BATCH = 25;

/** Definisi kolom template import (header persis dipakai unduhan template). */
const IMPORT_COLUMNS: { key: ImportField; header: string; width: number; required?: boolean }[] = [
  { key: "nik", header: "NIK*", width: 22, required: true },
  { key: "fullName", header: "Nama Lengkap*", width: 30, required: true },
  { key: "email", header: "Email", width: 28 },
  { key: "phone", header: "Telepon", width: 16 },
  { key: "joinDate", header: "Tanggal Masuk* (YYYY-MM-DD)", width: 24, required: true },
  { key: "gender", header: "Jenis Kelamin (L/P)", width: 20 },
  { key: "marital", header: "Status Pernikahan (Single/Married/Divorced/Widowed)", width: 44 },
  { key: "religion", header: "Agama", width: 18 },
  { key: "bloodType", header: "Golongan Darah", width: 16 },
  { key: "taxId", header: "NPWP", width: 20 },
  { key: "address", header: "Alamat", width: 34 },
  { key: "bankName", header: "Kode Bank", width: 14 },
  { key: "bankAccount", header: "No Rekening", width: 18 },
  { key: "orgUnitCode", header: "Kode Unit Organisasi*", width: 24, required: true },
  { key: "positionCode", header: "Kode Posisi*", width: 16, required: true },
  { key: "gradeCode", header: "Kode Grade", width: 14 },
  { key: "level", header: "Level", width: 10 },
  { key: "employmentStatus", header: "Status Kepegawaian (Permanent/Probation/Contract/Outsourcing)", width: 48 },
  { key: "baseSalary", header: "Gaji Pokok", width: 16 },
  { key: "status", header: "Status Kerja (Active/Inactive)", width: 26 },
  { key: "note", header: "Keterangan", width: 40 },
];

type ImportField =
  | "nik" | "fullName" | "email" | "phone" | "joinDate" | "gender" | "marital"
  | "religion" | "bloodType" | "taxId" | "address" | "bankName" | "bankAccount"
  | "orgUnitCode" | "positionCode" | "gradeCode" | "level" | "employmentStatus"
  | "baseSalary" | "status" | "note";

/** Alias normalisasi header → field (toleran varian penamaan pengguna). */
const HEADER_ALIASES: Record<string, ImportField> = {
  nik: "nik", "nomor induk kependudukan": "nik",
  "nama lengkap": "fullName", nama: "fullName", "nama karyawan": "fullName",
  email: "email", "email pribadi": "email",
  telepon: "phone", phone: "phone", "no telepon": "phone", "nomor telepon": "phone",
  "tanggal masuk": "joinDate", "join date": "joinDate",
  "jenis kelamin": "gender", gender: "gender",
  "status pernikahan": "marital", marital: "marital",
  agama: "religion", religion: "religion",
  "golongan darah": "bloodType", "blood type": "bloodType",
  npwp: "taxId", "npwp (16 digit)": "taxId",
  alamat: "address", address: "address",
  "kode bank": "bankName", bank: "bankName", "bank code": "bankName",
  "no rekening": "bankAccount", "nomor rekening": "bankAccount", "account number": "bankAccount",
  "kode unit organisasi": "orgUnitCode", "unit organisasi": "orgUnitCode", "kode unit": "orgUnitCode", unit: "orgUnitCode",
  "kode posisi": "positionCode", posisi: "positionCode", "kode jabatan": "positionCode",
  "kode grade": "gradeCode", grade: "gradeCode",
  level: "level", "level jabatan": "level", "kode level": "level",
  "status kepegawaian": "employmentStatus", "employment status": "employmentStatus",
  "gaji pokok": "baseSalary", "base salary": "baseSalary", gaji: "baseSalary",
  "status kerja": "status", "work status": "status",
  keterangan: "note", catatan: "note", remark: "note",
};

/** Nilai enum domain. */
const EMPLOYMENT_STATUSES = ["Permanent", "Probation", "Contract", "Outsourcing"] as const;

/** Jenis kelamin input (L/P, toleran M/F) → nilai DB (M/F — pola data demo). */
const GENDER_MAP: Record<string, string> = { L: "M", M: "M", P: "F", F: "F" };

/** Status pernikahan input (EN template / ID langsung) → nilai DB. */
const MARITAL_TO_DB: Record<string, string> = {
  single: "Belum Menikah", married: "Menikah", divorced: "Cerai", widowed: "Janda/Duda",
  "belum menikah": "Belum Menikah", menikah: "Menikah", cerai: "Cerai", "janda/duda": "Janda/Duda",
};
/** Nilai DB → label EN template (utk export, round-trip import). */
const MARITAL_FROM_DB: Record<string, string> = {
  "Belum Menikah": "Single", Menikah: "Married", Cerai: "Divorced", "Janda/Duda": "Widowed",
};

// ============ helper sel Excel ============

/** Teks sel apa pun (string/number/Date/formula/richText/hyperlink) → string trim. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const obj = v as unknown as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if ("result" in obj) return cellText(obj.result as ExcelJS.CellValue);
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((t) => t.text).join("").trim();
    }
    if ("error" in obj) return "";
  }
  return String(v);
}

/** Parse sel tanggal: Date (sel format tanggal), atau string YYYY-MM-DD. */
function parseDateCell(v: ExcelJS.CellValue): Date | null {
  if (v instanceof Date) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
      return null; // 2026-02-31 → tanggal palsu
    }
    return d;
  }
  return null; // angka polos tanpa format tanggal → ambigu, ditolak
}

/** Parse sel angka uang: number, atau string "Rp 5.000.000" → 5000000. */
function parseMoneyCell(v: ExcelJS.CellValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const digits = v.replace(/[^0-9-]/g, "");
    if (!digits || digits === "-") return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const normHeader = (s: string): string =>
  s.toLowerCase().replace(/\*/g, "").replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();

/** Cari posisi kolom per field pada baris header (exact alias → tanpa kurung → contains). */
function resolveHeaderColumns(
  headerRow: ExcelJS.Row,
): { cols: Partial<Record<ImportField, number>>; missing: string[] } {
  const cells: { col: number; text: string }[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const text = cellText(cell.value);
    if (text) cells.push({ col, text });
  });
  const cols: Partial<Record<ImportField, number>> = {};
  for (const def of IMPORT_COLUMNS) {
    const expected = normHeader(def.header);
    // 1) exact alias / exact header-tanpa-kurung
    let hit = cells.find((c) => normHeader(c.text) === expected || HEADER_ALIASES[normHeader(c.text)] === def.key);
    // 2) contains dua arah (header user lebih panjang/pendek)
    if (!hit) {
      hit = cells.find((c) => {
        const n = normHeader(c.text);
        return n !== "" && (n.includes(expected) || expected.includes(n)) && expected.length >= 4;
      });
    }
    if (hit) cols[def.key] = hit.col;
  }
  const missing = IMPORT_COLUMNS.filter((d) => d.required && !cols[d.key]).map((d) => d.header);
  return { cols, missing };
}

/** Baris data hasil parse + validasi. */
interface ParsedRow {
  row: number; // nomor baris Excel (1-based, termasuk baris header di atasnya)
  nik: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  joinDate: Date | null;
  gender: string; // M/F
  marital: string | null;
  religion: string | null;
  bloodType: string | null;
  taxId: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  orgUnitCode: string;
  positionCode: string;
  gradeCode: string;
  levelCode: string;
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  levelId: string | null;
  employmentStatus: string;
  baseSalary: number;
  errors: string[];
  warnings: string[];
}

/** Template XLSX: sheet "Karyawan" (header + 2 baris contoh EXAMPLE) + sheet "Referensi". */
async function buildImportTemplate(
  db: TenantDb,
  company: { code: string; name: string },
): Promise<Buffer> {
  const [units, positions, grades, levels] = await Promise.all([
    db.orgUnit.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    db.position.findMany({ where: { active: true }, select: { code: true, title: true }, orderBy: { code: "asc" } }),
    db.grade.findMany({ where: { active: true }, select: { code: true, name: true, minSalary: true, maxSalary: true }, orderBy: { code: "asc" } }),
    db.positionLevel.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
  ]);

  const columns: ExportColumn[] = IMPORT_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  const exampleMark = "EXAMPLE — baris contoh, diabaikan saat import";
  const rows: (string | number | null)[][] = [
    [
      "3201234567890001", "Budi Santoso (CONTOH)", "budi.contoh@miico.id", "0812-0000-0001", "2026-01-05",
      "L", "Single", "Islam", "O", "09.876.543.2-091.000", "Jl. Contoh No. 1, Jakarta", "BCA", "1234567890",
      "MII-HRD", "P-HRS", "G1", "PL1", "Permanent", 5000000, "Active", exampleMark,
    ],
    [
      "3201234567890002", "Siti Aminah (CONTOH)", "siti.contoh@miico.id", "0813-0000-0002", "2026-02-01",
      "P", "Married", "Kristen Protestan", "A", "09.123.456.7-891.000", "Jl. Contoh No. 2, Bandung", "BNI", "9876543210",
      "MII-ITD", "P-DEV", "G2", "PL2", "Contract", 7000000, "Active", exampleMark,
    ],
  ];

  const refRows: (string | number | null)[][] = [
    ...units.map((u) => ["Unit Organisasi", u.code, u.name] as (string | number | null)[]),
    ...positions.map((p) => ["Posisi", p.code, p.title] as (string | number | null)[]),
    ...grades.map((g) => ["Grade", g.code, `Rp ${g.minSalary.toLocaleString("id-ID")} – Rp ${g.maxSalary.toLocaleString("id-ID")}`] as (string | number | null)[]),
    ...levels.map((l) => ["Level Jabatan", l.code, l.name] as (string | number | null)[]),
  ];

  const buf = await toXlsxMulti([
    { name: "Karyawan", columns, rows },
    {
      name: "Referensi",
      title: `Referensi kode valid — ${company.name}${company.code ? ` (${company.code})` : ""} · hanya kode AKTIF yang diterima import`,
      columns: [
        { header: "Jenis", width: 18 },
        { header: "Kode", width: 22 },
        { header: "Nama / Keterangan", width: 52 },
      ],
      rows: refRows,
    },
  ]);
  return buf;
}

/**
 * GET /api/onevity/employees/import?template=1 — unduh template XLSX.
 * Guard: hr:directory view (unduh template = baca referensi, bukan mutasi).
 */
export async function employeesImportGet(req: NextRequest): Promise<NextResponse> {
  try {
    const m = await requireMenuAction(req, "hr:directory", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    if (sp.get("template") !== "1") {
      return NextResponse.json(
        { error: "Endpoint ini untuk template — tambahkan ?template=1 (unduh) atau POST file untuk import" },
        { status: 400 },
      );
    }

    const company = await db.company.findFirst({ select: { id: true, code: true, name: true } });
    if (!company) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    const buf = await buildImportTemplate(db, { code: company.code, name: company.name });
    return xlsxResponse(buf, exportFilename(`onevity-import-karyawan-${company.code || "template"}`, "xlsx"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

/** Error Prisma → pesan ramah utk laporan import per baris. */
function friendlyImportError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "P2002") {
    return "Nomor karyawan bentrok dengan permintaan paralel — ulangi import untuk baris ini";
  }
  if (code === "P2003") {
    return "Data referensi tidak valid — periksa kode unit/posisi/grade (lihat sheet Referensi template)";
  }
  return e instanceof Error ? e.message : "unknown";
}

/**
 * POST /api/onevity/employees/import — multipart/form-data:
 *   file: XLSX (maks 500 baris data, 2 MB) · dryRun: "true"|"false"
 * dryRun=true  → hanya laporan validasi + preview (tanpa menulis DB).
 * dryRun=false → COMMIT baris valid (Employee + assignment awal + snapshot
 * approval + ActivityLog Created per karyawan) dalam transaksi per batch.
 * Guard: hr:directory create (pola T6).
 */
export async function employeesImportPost(req: NextRequest): Promise<NextResponse> {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Body harus multipart/form-data dengan field file + dryRun" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "File XLSX wajib dilampirkan (field \"file\")" }, { status: 400 });
    }
    if (file.size > IMPORT_MAX_BYTES) {
      return NextResponse.json(
        { error: `File terlalu besar (${(file.size / 1024 / 1024).toFixed(2)} MB) — maksimum 2 MB. Pecah file atau hapus baris tidak perlu.` },
        { status: 413 },
      );
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Hanya file .xlsx yang didukung — simpan ulang sebagai Excel Workbook" }, { status: 400 });
    }
    const dryRun = ["true", "1", "yes"].includes(String(form.get("dryRun") ?? "").toLowerCase());

    // ---- parse workbook ----
    let wb: ExcelJS.Workbook;
    try {
      wb = await new ExcelJS.Workbook().xlsx.load(await file.arrayBuffer());
    } catch {
      return NextResponse.json({ error: "File XLSX tidak terbaca (rusak / bukan Excel) — unduh template dan isi ulang" }, { status: 400 });
    }
    const ws = wb.getWorksheet("Karyawan") ?? wb.worksheets[0];
    if (!ws || ws.rowCount < 1) {
      return NextResponse.json({ error: "Sheet data tidak ditemukan — gunakan template resmi" }, { status: 400 });
    }

    // cari baris header (baris 1–5 yang memuat kolom wajib)
    let header: { rowNo: number; cols: Partial<Record<ImportField, number>> } | null = null;
    let missing: string[] = [];
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const res = resolveHeaderColumns(ws.getRow(r));
      if (res.missing.length === 0) {
        header = { rowNo: r, cols: res.cols };
        break;
      }
      if (Object.keys(res.cols).length > (header ? Object.keys(header.cols).length : 0)) {
        header = { rowNo: r, cols: res.cols };
        missing = res.missing;
      }
    }
    if (!header || missing.length > 0) {
      return NextResponse.json(
        { error: `Kolom wajib tidak ditemukan: ${missing.join(", ")} — unduh template resmi dan jangan mengubah baris header` },
        { status: 400 },
      );
    }

    // ---- parse baris data ----
    const parsed: ParsedRow[] = [];
    let skippedExample = 0;
    const headerCols = header.cols;
    for (let r = header.rowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const val = (key: ImportField): ExcelJS.CellValue => {
        const col = headerCols[key];
        return col ? row.getCell(col).value : null;
      };
      // baris kosong (semua sel tanpa teks) diabaikan
      let anyText = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cellText(cell.value) !== "") anyText = true;
      });
      if (!anyText) continue;
      if (/example/i.test(cellText(val("note")))) {
        skippedExample++; // baris contoh template — diabaikan saat import
        continue;
      }
      const p: ParsedRow = {
        row: r,
        nik: cellText(val("nik")),
        fullName: cellText(val("fullName")),
        email: cellText(val("email")) || null,
        phone: cellText(val("phone")) || null,
        joinDate: parseDateCell(val("joinDate")),
        gender: "M",
        marital: null,
        religion: cellText(val("religion")) || null,
        bloodType: cellText(val("bloodType")) || null,
        taxId: cellText(val("taxId")) || null,
        address: cellText(val("address")) || null,
        bankName: cellText(val("bankName")) || null,
        bankAccount: cellText(val("bankAccount")) || null,
        orgUnitCode: cellText(val("orgUnitCode")),
        positionCode: cellText(val("positionCode")),
        gradeCode: cellText(val("gradeCode")),
        levelCode: cellText(val("level")),
        orgUnitId: null,
        positionId: null,
        gradeId: null,
        levelId: null,
        employmentStatus: "Probation",
        baseSalary: 0,
        errors: [],
        warnings: [],
      };

      // --- validasi per baris ---
      if (!/^\d{16}$/.test(p.nik)) {
        p.errors.push(p.nik ? `NIK "${p.nik.slice(0, 24)}" harus 16 digit angka (tulis sebagai teks)` : "NIK wajib diisi (16 digit angka)");
      }
      if (!p.fullName) p.errors.push("Nama lengkap wajib diisi");
      if (!p.joinDate) {
        p.errors.push(cellText(val("joinDate")) ? `Tanggal masuk "${cellText(val("joinDate")).slice(0, 24)}" tidak valid — format YYYY-MM-DD` : "Tanggal masuk wajib diisi (YYYY-MM-DD)");
      }
      if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
        p.errors.push(`Email "${p.email}" tidak valid`);
      }
      const genderRaw = cellText(val("gender")).toUpperCase();
      if (genderRaw) {
        if (GENDER_MAP[genderRaw]) p.gender = GENDER_MAP[genderRaw];
        else p.errors.push(`Jenis kelamin "${genderRaw}" tidak dikenal — isi L atau P`);
      }
      const maritalRaw = cellText(val("marital")).toLowerCase();
      if (maritalRaw) {
        const mapped = MARITAL_TO_DB[maritalRaw];
        if (mapped) p.marital = mapped;
        else p.errors.push(`Status pernikahan "${cellText(val("marital")).slice(0, 24)}" tidak dikenal — Single/Married/Divorced/Widowed`);
      }
      const empRaw = cellText(val("employmentStatus"));
      if (empRaw) {
        const hit = EMPLOYMENT_STATUSES.find((s) => s.toLowerCase() === empRaw.toLowerCase());
        if (hit) p.employmentStatus = hit;
        else p.errors.push(`Status kepegawaian "${empRaw.slice(0, 24)}" tidak dikenal — Permanent/Probation/Contract/Outsourcing`);
      }
      const statusRaw = cellText(val("status"));
      if (statusRaw && statusRaw.toLowerCase() !== "active") {
        p.errors.push(`Status kerja "${statusRaw.slice(0, 24)}" tidak didukung import — hanya Active (non-aktif via offboarding)`);
      }
      const salaryCell = val("baseSalary");
      const salary = parseMoneyCell(salaryCell);
      if (salary === null) {
        if (cellText(salaryCell)) p.errors.push(`Gaji pokok "${cellText(salaryCell).slice(0, 24)}" bukan angka (boleh "Rp 5.000.000")`);
      } else if (salary < 0) {
        p.errors.push("Gaji pokok tidak boleh negatif");
      } else {
        p.baseSalary = salary;
      }
      parsed.push(p);
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: skippedExample > 0 ? "Tidak ada baris data — seluruh baris adalah baris contoh (EXAMPLE) yang diabaikan" : "Tidak ada baris data pada sheet" },
        { status: 400 },
      );
    }
    if (parsed.length > IMPORT_MAX_ROWS) {
      return NextResponse.json({ error: `Terlalu banyak baris (${parsed.length}) — maksimum ${IMPORT_MAX_ROWS} baris per file` }, { status: 400 });
    }

    // ---- validasi lintas-baris & referensi tenant (resolve by code) ----
    const company = await db.company.findFirst({ select: { id: true, code: true, name: true } });
    if (!company) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    const [unitRows, positionRows, gradeRows, levelRows, existingNiks, existingEmails] = await Promise.all([
      db.orgUnit.findMany({ where: { active: true }, select: { id: true, code: true, name: true } }),
      db.position.findMany({ where: { active: true }, select: { id: true, code: true, title: true, positionLevel: { select: { id: true, code: true } } } }),
      db.grade.findMany({ where: { active: true }, select: { id: true, code: true, name: true, minSalary: true, maxSalary: true } }),
      db.positionLevel.findMany({ where: { active: true }, select: { id: true, code: true, name: true } }),
      db.employee.findMany({ where: { nationalId: { not: null } }, select: { nationalId: true } }),
      db.employee.findMany({ where: { email: { not: null } }, select: { email: true } }),
    ]);
    const unitByCode = new Map(unitRows.map((u) => [u.code.toUpperCase(), u]));
    const posByCode = new Map(positionRows.map((p) => [p.code.toUpperCase(), p]));
    const gradeByCode = new Map(gradeRows.map((g) => [g.code.toUpperCase(), g]));
    const levelByCode = new Map(levelRows.map((l) => [l.code.toUpperCase(), l]));
    // 28-c: NIK tersimpan terenkripsi — dekripsi utk set dedupe (match JS,
    // bukan SQL: ciphertext random-IV tidak bisa dicocokkan di query).
    const tcImp = tenantCryptoForDb(db);
    const nikSet = new Set(existingNiks.map((e) => tcImp.decryptText(e.nationalId)).filter((n): n is string => !!n));
    const emailSet = new Set(existingEmails.map((e) => String(e.email).toLowerCase()));
    const nikSeen = new Map<string, number>(); // duplikat dalam file
    const emailSeen = new Map<string, number>();

    for (const p of parsed) {
      // unit organisasi (wajib)
      const unit = unitByCode.get(p.orgUnitCode.toUpperCase());
      if (unit) p.orgUnitId = unit.id;
      else p.errors.push(p.orgUnitCode ? `Kode unit organisasi "${p.orgUnitCode}" tidak ditemukan / tidak aktif — lihat sheet Referensi` : "Kode unit organisasi wajib diisi");

      // posisi (wajib)
      const pos = posByCode.get(p.positionCode.toUpperCase());
      if (pos) p.positionId = pos.id;
      else p.errors.push(p.positionCode ? `Kode posisi "${p.positionCode}" tidak ditemukan / tidak aktif — lihat sheet Referensi` : "Kode posisi wajib diisi");

      // grade (opsional, bila diisi harus valid)
      if (p.gradeCode) {
        const grade = gradeByCode.get(p.gradeCode.toUpperCase());
        if (grade) {
          p.gradeId = grade.id;
          // rentang gaji grade → ADVISORY (warning, tidak menggagalkan — pola wizard)
          if (grade.maxSalary > 0 && p.baseSalary > 0 && (p.baseSalary < grade.minSalary || p.baseSalary > grade.maxSalary)) {
            p.warnings.push(`Gaji pokok ${p.baseSalary.toLocaleString("id-ID")} di luar rentang grade ${grade.code} (Rp ${grade.minSalary.toLocaleString("id-ID")} – Rp ${grade.maxSalary.toLocaleString("id-ID")}) — advisory`);
          }
        } else {
          p.errors.push(`Kode grade "${p.gradeCode}" tidak ditemukan / tidak aktif — lihat sheet Referensi`);
        }
      }

      // level jabatan (opsional — snapshot diambil dari posisi; kode divalidasi + advisory mismatch)
      if (p.levelCode) {
        const level = levelByCode.get(p.levelCode.toUpperCase());
        if (level) {
          p.levelId = level.id;
          if (pos?.positionLevel && pos.positionLevel.code !== level.code) {
            p.warnings.push(`Level ${level.code} berbeda dari level posisi ${pos.code} (${pos.positionLevel.code ?? "—"}) — snapshot mengikuti posisi`);
          }
        } else {
          p.errors.push(`Kode level "${p.levelCode}" tidak ditemukan / tidak aktif — lihat sheet Referensi`);
        }
      }

      // keunikan NIK (DB + dalam file)
      if (/^\d{16}$/.test(p.nik)) {
        if (nikSet.has(p.nik)) p.errors.push(`NIK ${p.nik} sudah dipakai karyawan lain`);
        const prev = nikSeen.get(p.nik);
        if (prev) p.errors.push(`NIK ${p.nik} duplikat dengan baris ${prev}`);
        else nikSeen.set(p.nik, p.row);
      }
      // keunikan email opsional
      if (p.email) {
        const lower = p.email.toLowerCase();
        if (emailSet.has(lower)) p.errors.push(`Email ${p.email} sudah dipakai karyawan lain`);
        const prev = emailSeen.get(lower);
        if (prev) p.errors.push(`Email ${p.email} duplikat dengan baris ${prev}`);
        else emailSeen.set(lower, p.row);
      }
    }

    const validRows = parsed.filter((p) => p.errors.length === 0);
    const invalidRows = parsed.filter((p) => p.errors.length > 0);

    // ---- dry-run: laporan saja ----
    if (dryRun) {
      const rows = parsed.map((p) => ({
        row: p.row,
        nik: p.nik,
        fullName: p.fullName,
        errors: p.errors,
        warnings: p.warnings,
        error: p.errors.join("; ") || null,
      }));
      const preview = validRows.slice(0, 10).map((p) => ({
        row: p.row,
        nik: p.nik,
        fullName: p.fullName,
        joinDate: p.joinDate ? p.joinDate.toISOString().slice(0, 10) : null,
        orgUnit: unitByCode.get(p.orgUnitCode.toUpperCase())?.name ?? null,
        position: posByCode.get(p.positionCode.toUpperCase())?.title ?? null,
        grade: p.gradeId ? gradeByCode.get(p.gradeCode.toUpperCase())?.code ?? null : null,
        level: p.levelId
          ? levelByCode.get(p.levelCode.toUpperCase())?.code ?? null
          : posByCode.get(p.positionCode.toUpperCase())?.positionLevel?.code ?? null,
        employmentStatus: p.employmentStatus,
        baseSalary: p.baseSalary,
        employeeNoPrefix: codePrefix(company.code) || "EMP",
      }));
      return NextResponse.json({
        dryRun: true,
        file: file.name,
        totalRows: parsed.length,
        skippedExample,
        valid: validRows.length,
        invalid: invalidRows.length,
        rows,
        preview,
      });
    }

    // ---- commit (dryRun=false) ----
    const prefix = await employeeNoPrefix(req, company.code);
    const created: { row: number; employeeNo: string; fullName: string }[] = [];
    const failed: { row: number; error: string }[] = [];

    // 28-c: tangkap konteks enkripsi dari client LUAR sebelum $transaction
    // (client transaksi Prisma tidak membawa brand schema).
    const tcImport = tenantCryptoForDb(db);
    for (let i = 0; i < validRows.length; i += IMPORT_BATCH) {
      const batch = validRows.slice(i, i + IMPORT_BATCH);
      const batchCreated: { row: number; employeeNo: string; fullName: string }[] = [];
      try {
        await db.$transaction(async (tx) => {
          for (const p of batch) {
            try {
              const employee = await createEmployeeWithAssignment(tx, prefix, {
                fullName: p.fullName,
                gender: p.gender,
                nationalId: p.nik || null,
                taxId: p.taxId,
                maritalStatus: p.marital,
                religion: p.religion,
                bloodType: p.bloodType,
                email: p.email,
                phone: p.phone,
                address: p.address,
                bankName: p.bankName,
                bankAccount: p.bankAccount,
                companyId: company.id,
                joinDate: p.joinDate ?? new Date(),
                status: "Active",
              }, {
                orgUnitId: p.orgUnitId,
                positionId: p.positionId,
                gradeId: p.gradeId,
                managerId: null,
                companyOfficeId: null,
                workLocationId: null,
                employmentStatus: p.employmentStatus,
                workShift: "Regular",
                baseSalary: p.baseSalary,
                validFrom: p.joinDate ?? new Date(),
                changeReason: "Initial",
                notes: "Penempatan awal via import Excel",
              }, tcImport);
              await tx.activityLog.create({
                data: {
                  appUserId: actor.appUserId,
                  action: "Created",
                  entity: "Employee",
                  entityId: employee.id,
                  employeeId: employee.id,
                  detail: `Import Excel: karyawan ${employee.fullName} (${employee.employeeNo}) oleh ${actor.appUsername ?? actor.name}`,
                },
              });
              batchCreated.push({ row: p.row, employeeNo: employee.employeeNo, fullName: employee.fullName });
            } catch (e) {
              failed.push({ row: p.row, error: friendlyImportError(e) });
              // bersihkan sisa parsial baris ini (mis. employee terbuat tapi assignment gagal).
              // 28-c (follow-up 43-b): nationalId baris baru TERENKRIPSI —
              // deleteMany WHERE nationalId=plaintext tidak akan pernah match;
              // cari id kandidat via decrypt-then-match (tcImport dari client
              // luar transaksi) lalu hapus by id IN. NIK sudah divalidasi unik
              // pra-import → hanya sisa parsial baris ini yang cocok.
              try {
                if (p.nik) {
                  const cand = await tx.employee.findMany({
                    where: { nationalId: { not: null } },
                    select: { id: true, nationalId: true },
                  });
                  const stale = cand
                    .filter((c) => tcImport.decryptText(c.nationalId) === p.nik)
                    .map((c) => c.id);
                  if (stale.length > 0) await tx.employee.deleteMany({ where: { id: { in: stale } } });
                }
              } catch { /* noop */ }
            }
          }
        });
        created.push(...batchCreated);
      } catch (e) {
        // transaksi batch gagal menyeluruh (koneksi dll) — seluruh batch dianggap gagal
        const err = friendlyImportError(e);
        for (const p of batch) {
          if (!batchCreated.some((c) => c.row === p.row)) failed.push({ row: p.row, error: err });
        }
      }
    }

    // ringkasan audit satu baris (gagal per baris tetap masuk failed[])
    try {
      await db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action: "Imported",
          entity: "Employee",
          detail: `Import Excel ${file.name}: ${created.length} karyawan dibuat, ${failed.length + invalidRows.length} gagal, oleh ${actor.appUsername ?? actor.name}`,
        },
      });
    } catch { /* audit ringkasan best-effort */ }

    return NextResponse.json({
      created: created.length,
      failed: [
        ...invalidRows.map((p) => ({ row: p.row, error: p.errors.join("; ") })),
        ...failed,
      ],
      employees: created,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ export direktori (pola scope T1) ============

/**
 * GET /api/onevity/employees/export — XLSX seluruh karyawan AKTIF dalam
 * cakupan akses efektif pengguna (resolveAccessScope + scopeWhere — pola
 * dashboard/reports). Kolom identitas + pekerjaan; kolom upah (Gaji Pokok)
 * hanya bila scope akses penuh (scope.all — akses terbatas → identitas +
 * pekerjaan tanpa upah). Guard: hr:directory view.
 */
export async function employeesExportGet(req: NextRequest): Promise<NextResponse> {
  try {
    const m = await requireMenuAction(req, "hr:directory", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const scope = await resolveAccessScope(db, {
      appUserId: m.actor.appUserId,
      employeeId: m.actor.employeeId,
      appUserRole: m.actor.appUserRole,
      platformRole: m.actor.role,
    });
    const scopeCond = scopeWhere(scope);

    const employees = await db.employee.findMany({
      where: { AND: [scopeCond, { status: "Active" }] },
      include: CURRENT_ASSIGNMENT_INCLUDE,
      orderBy: { employeeNo: "asc" },
    });
    // 28-c: pass tc — NIK/NPWP/rekening + gaji pokok terdekripsi di batas serializer.
    const flat = employees.map((e) => flattenEmployee(e, tenantCryptoForDb(db)));
    const includeWage = scope.all; // upah hanya untuk scope penuh

    const columns: (ExportColumn & { key: string })[] = [
      { header: "No Karyawan", key: "employeeNo", width: 15 },
      { header: "NIK", key: "nik", width: 22 },
      { header: "Nama Lengkap", key: "fullName", width: 30 },
      { header: "Email", key: "email", width: 28 },
      { header: "Telepon", key: "phone", width: 16 },
      { header: "Tanggal Masuk (YYYY-MM-DD)", key: "joinDate", width: 22 },
      { header: "Jenis Kelamin (L/P)", key: "gender", width: 20 },
      { header: "Status Pernikahan", key: "marital", width: 20 },
      { header: "Agama", key: "religion", width: 18 },
      { header: "Golongan Darah", key: "bloodType", width: 16 },
      { header: "NPWP", key: "taxId", width: 20 },
      { header: "Alamat", key: "address", width: 34 },
      { header: "Kode Bank", key: "bankName", width: 14 },
      { header: "No Rekening", key: "bankAccount", width: 18 },
      { header: "Kode Unit Organisasi", key: "orgUnitCode", width: 24 },
      { header: "Unit Organisasi", key: "orgUnitName", width: 28 },
      { header: "Kode Posisi", key: "positionCode", width: 16 },
      { header: "Posisi", key: "positionTitle", width: 28 },
      { header: "Kode Grade", key: "gradeCode", width: 14 },
      { header: "Grade", key: "gradeName", width: 24 },
      { header: "Level", key: "levelCode", width: 10 },
      { header: "Status Kepegawaian", key: "employmentStatus", width: 20 },
      { header: "Gaji Pokok", key: "baseSalary", width: 16 },
      { header: "Status Kerja", key: "status", width: 14 },
    ].filter((c) => includeWage || c.key !== "baseSalary") as (ExportColumn & { key: string })[];

    const rows = flat.map((e) => {
      const g = String(e.gender ?? "M");
      return columns.map((c) => {
        switch (c.key) {
          case "employeeNo": return e.employeeNo;
          case "nik": return e.nationalId ?? "";
          case "joinDate": return e.joinDate instanceof Date ? e.joinDate.toISOString().slice(0, 10) : "";
          case "gender": return g === "F" ? "P" : "L";
          case "marital": return e.maritalStatus ? MARITAL_FROM_DB[e.maritalStatus] ?? e.maritalStatus : "";
          case "orgUnitCode": return e.orgUnit?.code ?? "";
          case "orgUnitName": return e.orgUnit?.name ?? "";
          case "positionCode": return e.position?.code ?? "";
          case "positionTitle": return e.position?.title ?? "";
          case "gradeCode": return e.grade?.code ?? "";
          case "gradeName": return e.grade?.name ?? "";
          case "levelCode": return e.positionLevel?.code ?? "";
          case "baseSalary": return e.baseSalary ?? 0;
          case "status": return e.status ?? "Active";
          default: {
            const v = (e as unknown as Record<string, unknown>)[c.key];
            return v === null || v === undefined ? "" : String(v);
          }
        }
      });
    });

    const buf = await toXlsxMulti([
      { name: "Karyawan", columns: columns.map(({ header, width }) => ({ header, width })), rows },
    ]);

    try {
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId,
          action: "Exported",
          entity: "Employee",
          detail: `Export Excel direktori: ${rows.length} karyawan aktif (${scope.all ? "cakupan penuh" : `cakupan terbatas — ${scope.sources.join(" | ") || "self"}`}) oleh ${m.actor.appUsername ?? m.actor.name}`,
        },
      });
    } catch { /* audit best-effort */ }

    return xlsxResponse(buf, exportFilename("onevity-karyawan", "xlsx"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
