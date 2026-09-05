// Migrasi APPROVAL STRUKTUR BERJENJANG ke tenant existing (Task 25):
//   1. applyApprovalDdl — 7 tabel baru + kolom baru (idempoten)
//   2. backfill:
//      a. master PositionLevel (PL1..PL8) + Position.positionLevelId
//      b. snapshot parameter Employee dari assignment aktif
//      c. MII: master CompanyOffice + WorkLocation + penempatan karyawan
//      d. struktur approval default bermakna (kriteria + jenjang + tier nominal)
//      e. backfill ApprovalChain untuk dokumen leave/travel/medical/loan
// Jalankan: bun run scripts/migrate-approval-structure.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { startApprovalChain } from "@/onevity/shared/services/approval-engine";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const NEW_TABLES = [
  "CompanyOffice", "WorkLocation", "PositionLevel",
  "ApprovalStructure", "ApprovalStructureLevel", "ApprovalChain", "ApprovalStep",
];

const NEW_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "Position", column: "positionLevelId", ddl: 'TEXT' },
  { table: "EmployeeAssignment", column: "companyOfficeId", ddl: 'TEXT' },
  { table: "EmployeeAssignment", column: "workLocationId", ddl: 'TEXT' },
  { table: "Employee", column: "orgUnitId", ddl: 'TEXT' },
  { table: "Employee", column: "positionId", ddl: 'TEXT' },
  { table: "Employee", column: "gradeId", ddl: 'TEXT' },
  { table: "Employee", column: "positionLevelId", ddl: 'TEXT' },
  { table: "Employee", column: "companyOfficeId", ddl: 'TEXT' },
  { table: "Employee", column: "workLocationId", ddl: 'TEXT' },
];

const NEW_FKS: { name: string; sql: string }[] = [
  { name: "Position_positionLevelId_fkey", sql: 'ALTER TABLE "Position" ADD CONSTRAINT "Position_positionLevelId_fkey" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "EmployeeAssignment_companyOfficeId_fkey", sql: 'ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "EmployeeAssignment_workLocationId_fkey", sql: 'ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "Employee_orgUnitId_fkey", sql: 'ALTER TABLE "Employee" ADD CONSTRAINT "Employee_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "Employee_positionId_fkey", sql: 'ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "Employee_gradeId_fkey", sql: 'ALTER TABLE "Employee" ADD CONSTRAINT "Employee_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "Employee_positionLevelId_fkey", sql: 'ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionLevelId_fkey" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "Employee_companyOfficeId_fkey", sql: 'ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
  { name: "Employee_workLocationId_fkey", sql: 'ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
];

/** Parse statement DDL dari tenant-ddl.sql. */
function ddlStatements(): string[] {
  const ddl = readFileSync(path.join(process.cwd(), "prisma", "tenant-ddl.sql"), "utf8");
  const statements: string[] = [];
  let cur = "";
  for (const line of ddl.split("\n")) {
    if (line.startsWith("--")) continue;
    cur += line + "\n";
    if (line.trim().endsWith(";")) { statements.push(cur.trim()); cur = ""; }
  }
  return statements;
}

/** CREATE TABLE/INDEX + FK untuk tabel baru; ADD COLUMN + FK untuk tabel existing. */
export async function applyApprovalDdl(schemaName: string): Promise<{ tables: number; columns: number }> {
  const statements = ddlStatements();
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);
    const existing = new Set(
      (await c.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [schemaName])).rows.map((r) => r.table_name),
    );
    let tables = 0;
    for (const stmt of statements) {
      const create = stmt.match(/^CREATE TABLE "([A-Za-z]+)"/);
      if (create && NEW_TABLES.includes(create[1])) {
        if (existing.has(create[1])) continue; // idempoten
        await c.query(stmt); tables++; continue;
      }
      const idx = stmt.match(/^CREATE (?:UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "([A-Za-z]+)"/);
      if (idx && NEW_TABLES.includes(idx[1])) {
        try { await c.query(stmt); } catch { /* index sudah ada */ }
        continue;
      }
      const fk = stmt.match(/^ALTER TABLE (?:ONLY )?"([A-Za-z]+)"/);
      if (fk && NEW_TABLES.includes(fk[1]) && stmt.includes("ADD CONSTRAINT")) {
        const conName = stmt.match(/ADD CONSTRAINT "([A-Za-z0-9_]+)"/)?.[1];
        const has = conName ? await c.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [conName]) : null;
        if (has && has.rowCount === 0) await c.query(stmt);
        continue;
      }
    }
    // ADD COLUMN untuk tabel existing (idempoten)
    let columns = 0;
    for (const { table, column, ddl } of NEW_COLUMNS) {
      const has = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        [schemaName, table, column],
      );
      if (has.rowCount === 0) {
        await c.query(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`);
        columns++;
      }
    }
    // FK kolom baru (cek nama constraint agar idempoten)
    for (const { name, sql } of NEW_FKS) {
      const has = await c.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
      if (has.rowCount === 0) await c.query(sql);
    }
    return { tables, columns };
  } finally {
    await c.end();
  }
}

// ============ backfill ============

const LEVELS_BY_GRADE: Record<string, [string, string]> = {
  G1: ["PL1", "Officer"],
  G2: ["PL2", "Senior Officer"],
  G3: ["PL3", "Supervisor"],
  G4: ["PL4", "Assistant Manager"],
  G5: ["PL5", "Manager"],
  G6: ["PL6", "Senior Manager"],
  G7: ["PL7", "General Manager"],
  G8: ["PL8", "Director"],
};

/** Master PositionLevel + Position.positionLevelId (dari kolom level legacy = kode grade). */
async function backfillPositionLevels(db: TenantDb): Promise<number> {
  const existing = await db.positionLevel.count();
  if (existing === 0) {
    await db.positionLevel.createMany({
      data: Object.entries(LEVELS_BY_GRADE).map(([grade, [code, name]], i) => ({ code, name, sortOrder: i + 1 })),
    });
  }
  const levels = await db.positionLevel.findMany();
  const byGrade = new Map(Object.entries(LEVELS_BY_GRADE).map(([g, [code]]) => [g, levels.find((l) => l.code === code)?.id ?? null]));
  const positions = await db.position.findMany({ select: { id: true, level: true, positionLevelId: true } });
  let n = 0;
  for (const p of positions) {
    if (!p.positionLevelId && p.level && byGrade.get(p.level)) {
      await db.position.update({ where: { id: p.id }, data: { positionLevelId: byGrade.get(p.level) } });
      n++;
    }
  }
  return n;
}

/** Snapshot parameter employee dari assignment aktif. */
async function backfillEmployeeSnapshots(db: TenantDb): Promise<number> {
  const assignments = await db.employeeAssignment.findMany({
    where: { validTo: null },
    select: { employeeId: true, orgUnitId: true, positionId: true, gradeId: true, companyOfficeId: true, workLocationId: true, position: { select: { positionLevelId: true } } },
  });
  let n = 0;
  for (const a of assignments) {
    await db.employee.update({
      where: { id: a.employeeId },
      data: {
        orgUnitId: a.orgUnitId,
        positionId: a.positionId,
        gradeId: a.gradeId,
        positionLevelId: a.position?.positionLevelId ?? null,
        companyOfficeId: a.companyOfficeId,
        workLocationId: a.workLocationId,
      },
    });
    n++;
  }
  return n;
}

/** MII: master kantor + lokasi kerja + penempatan karyawan berdasar unit. */
async function backfillOfficesLocations(db: TenantDb): Promise<{ offices: number; located: number }> {
  const company = await db.company.findFirst({ select: { id: true, code: true } });
  if (!company) return { offices: 0, located: 0 };
  if ((await db.companyOffice.count()) > 0) return { offices: 0, located: 0 };

  const ho = await db.companyOffice.create({ data: { code: "OFF-HO", name: "Kantor Pusat Jakarta", companyId: company.id, address: "Jl. Industri Raya Kav. 25, Pulogadung", city: "Jakarta Timur", phone: "021-4600808" } });
  const plg = await db.companyOffice.create({ data: { code: "OFF-PLG", name: "Pabrik Pulogadung", companyId: company.id, address: "Jl. Industri Raya Kav. 25B, Kawasan Industri Pulogadung", city: "Jakarta Timur" } });
  const sby = await db.companyOffice.create({ data: { code: "OFF-SBY", name: "Cabang Surabaya", companyId: company.id, address: "Jl. Rungkut Industri II No. 8", city: "Surabaya" } });

  const locHo = await db.workLocation.create({ data: { code: "LOC-HO", name: "Lantai 5 — Kantor Pusat", companyId: company.id, officeId: ho.id } });
  const locA = await db.workLocation.create({ data: { code: "LOC-PRD-A", name: "Production Line A", companyId: company.id, officeId: plg.id } });
  const locB = await db.workLocation.create({ data: { code: "LOC-PRD-B", name: "Production Line B", companyId: company.id, officeId: plg.id } });
  const locWh = await db.workLocation.create({ data: { code: "LOC-WH", name: "Gudang & Logistik", companyId: company.id, officeId: plg.id } });
  await db.workLocation.create({ data: { code: "LOC-QC", name: "QC Laboratory", companyId: company.id, officeId: plg.id } });
  await db.workLocation.create({ data: { code: "LOC-SBY", name: "Kantor Cabang Surabaya", companyId: company.id, officeId: sby.id } });

  // penempatan: unit PRD* → pabrik (line bergantian), sisanya kantor pusat
  const assignments = await db.employeeAssignment.findMany({
    where: { validTo: null },
    select: { id: true, employeeId: true, orgUnit: { select: { code: true } } },
    orderBy: { employeeId: "asc" },
  });
  let i = 0;
  let located = 0;
  for (const a of assignments) {
    const code = a.orgUnit?.code ?? "";
    const plant = code.startsWith("MII-PRD") || code.startsWith("MII-WHS");
    const officeId = plant ? plg.id : ho.id;
    const workLocationId = plant
      ? (code.startsWith("MII-WHS") ? locWh.id : i % 2 === 0 ? locA.id : locB.id)
      : locHo.id;
    await db.employeeAssignment.update({ where: { id: a.id }, data: { companyOfficeId: officeId, workLocationId } });
    await db.employee.update({ where: { id: a.employeeId }, data: { companyOfficeId: officeId, workLocationId } });
    i++; located++;
  }
  return { offices: 3, located };
}

/** Struktur approval default (hanya bila belum ada satupun). */
async function backfillStructures(db: TenantDb): Promise<number> {
  if ((await db.approvalStructure.count()) > 0) return 0;
  const posByCode = new Map((await db.position.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]));
  const orgByCode = new Map((await db.orgUnit.findMany({ select: { id: true, code: true } })).map((o) => [o.code, o.id]));
  const P = (code: string) => posByCode.get(code) ?? null;

  const defs: {
    code: string; name: string; docType: string;
    orgUnitId?: string | null;
    levels: { approverType: string; approverPositionId?: string | null; minAmount?: number | null; maxAmount?: number | null; note?: string }[];
  }[] = [
    {
      code: "AS-LEAVE-STD", name: "Persetujuan Cuti Standar", docType: "Leave",
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "POSISI", approverPositionId: P("P-HRM"), note: "HR Manager" },
      ],
    },
    {
      code: "AS-WORKOFF-STD", name: "Persetujuan Izin Tidak Masuk", docType: "WorkOff",
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "POSISI", approverPositionId: P("P-HRM"), note: "HR Manager" },
      ],
    },
    {
      code: "AS-LEAVE-PRD", name: "Persetujuan Cuti — Divisi Produksi", docType: "Leave",
      orgUnitId: orgByCode.get("MII-PRD") ?? null,
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "POSISI", approverPositionId: P("P-PRD"), note: "Production Manager" },
        { approverType: "POSISI", approverPositionId: P("P-HRM"), note: "HR Manager" },
      ],
    },
    {
      code: "AS-TRAVEL-STD", name: "Persetujuan Perjalanan Dinas", docType: "Travel",
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "POSISI", approverPositionId: P("P-FIN"), minAmount: 15_000_000, note: "≥ Rp 15 jt: Finance Manager" },
        { approverType: "POSISI", approverPositionId: P("P-HRD"), minAmount: 50_000_000, note: "≥ Rp 50 jt: HR Director" },
      ],
    },
    {
      code: "AS-MED-STD", name: "Persetujuan Klaim Medis", docType: "Medical",
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "POSISI", approverPositionId: P("P-HRM") },
        { approverType: "POSISI", approverPositionId: P("P-HRD"), minAmount: 10_000_000, note: "≥ Rp 10 jt: HR Director" },
      ],
    },
    {
      code: "AS-LOAN-STD", name: "Persetujuan Pinjaman Karyawan", docType: "Loan",
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "POSISI", approverPositionId: P("P-HRM"), minAmount: 10_000_000, note: "≥ Rp 10 jt: HR Manager" },
        { approverType: "POSISI", approverPositionId: P("P-HRD"), minAmount: 25_000_000, note: "≥ Rp 25 jt: HR Director" },
        { approverType: "POSISI", approverPositionId: P("P-CEO"), minAmount: 100_000_000, note: "≥ Rp 100 jt: CEO" },
      ],
    },
  ];

  let n = 0;
  for (const d of defs) {
    const levels = d.levels.filter((l) => l.approverType !== "POSISI" || l.approverPositionId);
    if (levels.length === 0) continue;
    await db.approvalStructure.create({
      data: {
        code: d.code, name: d.name, docType: d.docType,
        orgUnitId: d.orgUnitId ?? null,
        levels: { create: levels.map((l, idx) => ({ levelNo: idx + 1, approverType: l.approverType, approverPositionId: l.approverPositionId ?? null, minAmount: l.minAmount ?? null, maxAmount: l.maxAmount ?? null, note: l.note ?? null })) },
      },
    });
    n++;
  }
  return n;
}

/** Struktur generik untuk tenant referensi tanpa karyawan. */
async function backfillGenericStructures(db: TenantDb): Promise<number> {
  if ((await db.approvalStructure.count()) > 0) return 0;
  const defs = [
    { code: "AS-LEAVE-STD", name: "Persetujuan Cuti (default)", docType: "Leave" },
    { code: "AS-WORKOFF-STD", name: "Persetujuan Izin Tidak Masuk (default)", docType: "WorkOff" },
    { code: "AS-TRAVEL-STD", name: "Persetujuan Perjalanan Dinas (default)", docType: "Travel" },
    { code: "AS-MED-STD", name: "Persetujuan Klaim Medis (default)", docType: "Medical" },
    { code: "AS-LOAN-STD", name: "Persetujuan Pinjaman (default)", docType: "Loan" },
  ];
  for (const d of defs) {
    await db.approvalStructure.create({
      data: { code: d.code, name: d.name, docType: d.docType, levels: { create: [{ levelNo: 1, approverType: "ATASAN_LANGSUNG" }] } },
    });
  }
  return defs.length;
}

/** Pastikan struktur WorkOff tersedia pada tenant yang struktur lama sudah ter-seed (idempoten). */
async function ensureWorkoffStructure(db: TenantDb): Promise<boolean> {
  if (await db.approvalStructure.findFirst({ where: { docType: "WorkOff" } })) return false;
  const hrm = await db.position.findFirst({ where: { code: "P-HRM" }, select: { id: true } });
  await db.approvalStructure.create({
    data: {
      code: "AS-WORKOFF-STD", name: "Persetujuan Izin Tidak Masuk", docType: "WorkOff",
      levels: {
        create: [
          { levelNo: 1, approverType: "ATASAN_LANGSUNG" },
          hrm
            ? { levelNo: 2, approverType: "POSISI", approverPositionId: hrm.id, note: "HR Manager" }
            : { levelNo: 2, approverType: "HR_ADMIN" },
        ],
      },
    },
  });
  return true;
}

/** Backfill chain untuk dokumen existing. */
async function backfillChains(db: TenantDb): Promise<{ created: number; finalized: number }> {
  const now = new Date();
  let created = 0;
  let finalized = 0;

  const finalize = async (docType: string, docId: string, docStatus: string) => {
    const chain = await db.approvalChain.findUnique({ where: { docType_docId: { docType, docId } }, select: { id: true, status: true, currentLevel: true, totalLevels: true } });
    if (!chain || chain.status !== "InProgress") return;
    if (docStatus === "Rejected" || docStatus === "Cancelled") {
      await db.approvalStep.updateMany({ where: { chainId: chain.id, status: "Current" }, data: { status: docStatus, decidedBy: "Backfill migrasi", decidedAt: now } });
      await db.approvalChain.update({ where: { id: chain.id }, data: { status: docStatus, completedAt: now } });
    } else {
      // dokumen sudah final-approve (Approved/MassLeave/Settled/Active/PaidOff)
      await db.approvalStep.updateMany({ where: { chainId: chain.id }, data: { status: "Approved", decidedBy: "Backfill migrasi", decidedAt: now } });
      await db.approvalChain.update({ where: { id: chain.id }, data: { status: "Approved", currentLevel: chain.totalLevels, completedAt: now } });
    }
    finalized++;
  };

  // Leave (tanpa nominal)
  const leaves = await db.leaveRequest.findMany({ select: { id: true, employeeId: true, status: true } });
  for (const r of leaves) {
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "Leave", docId: r.id } } });
    if (!before) { await startApprovalChain(db, { docType: "Leave", docId: r.id, employeeId: r.employeeId, createdBy: "backfill" }); created++; }
    if (r.status !== "Submitted") await finalize("Leave", r.id, r.status === "MassLeave" ? "Approved" : r.status);
  }

  // Travel (nominal = total uang muka)
  const travels = await db.travelRequest.findMany({
    select: { id: true, employeeId: true, status: true, advances: { select: { amount: true } } },
  });
  for (const r of travels) {
    const amount = r.advances.reduce((s, a) => s + a.amount, 0);
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "Travel", docId: r.id } } });
    if (!before) { await startApprovalChain(db, { docType: "Travel", docId: r.id, employeeId: r.employeeId, amount: amount > 0 ? amount : null, createdBy: "backfill" }); created++; }
    if (r.status !== "Submitted") await finalize("Travel", r.id, r.status);
  }

  // Medical (nominal = total tagihan; Draft belum diajukan → skip)
  const meds = await db.medicalClaim.findMany({ select: { id: true, employeeId: true, state: true, totalBill: true } });
  for (const r of meds) {
    if (r.state === "Draft") continue;
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "Medical", docId: r.id } } });
    if (!before) { await startApprovalChain(db, { docType: "Medical", docId: r.id, employeeId: r.employeeId, amount: r.totalBill, createdBy: "backfill" }); created++; }
    if (r.state !== "Submitted" && r.state !== "Returned") await finalize("Medical", r.id, r.state);
  }

  // Loan (nominal = jumlah pinjaman; Active/PaidOff historis → dianggap approved)
  const loans = await db.employeeLoan.findMany({ select: { id: true, employeeId: true, status: true, amount: true } });
  for (const r of loans) {
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "Loan", docId: r.id } } });
    if (!before) { await startApprovalChain(db, { docType: "Loan", docId: r.id, employeeId: r.employeeId, amount: r.amount, createdBy: "backfill" }); created++; }
    if (r.status !== "Submitted") await finalize("Loan", r.id, r.status === "Active" || r.status === "PaidOff" ? "Approved" : r.status);
  }

  // WorkOff (tanpa nominal; Pending → chain baru, final historis → difinalkan)
  const workoffs = await db.workOffPermission.findMany({ select: { id: true, employeeId: true, status: true } });
  for (const r of workoffs) {
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "WorkOff", docId: r.id } } });
    if (!before && r.status === "Pending") { await startApprovalChain(db, { docType: "WorkOff", docId: r.id, employeeId: r.employeeId, createdBy: "backfill" }); created++; }
    if (before && r.status !== "Pending") await finalize("WorkOff", r.id, r.status);
  }

  return { created, finalized };
}

// ============ main ============

for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi approval struktur berjenjang…`);
  const ddl = await applyApprovalDdl(schema);
  console.log(`  DDL: ${ddl.tables} tabel baru, ${ddl.columns} kolom baru`);
  const db = getTenantClient(schema);
  const levels = await backfillPositionLevels(db);
  console.log(`  PositionLevel: ${levels} posisi dipetakan`);
  const snapshots = await backfillEmployeeSnapshots(db);
  console.log(`  Snapshot employee: ${snapshots} karyawan`);
  const offices = await backfillOfficesLocations(db);
  if (offices.offices > 0) console.log(`  Kantor/lokasi: 3 kantor + 6 lokasi, ${offices.located} karyawan ditempatkan`);
  const empCount = await db.employee.count();
  const structures = empCount > 0 ? await backfillStructures(db) : await backfillGenericStructures(db);
  console.log(`  Struktur approval: ${structures} dibuat`);
  const wo = await ensureWorkoffStructure(db);
  if (wo) console.log("  Struktur WorkOff: AS-WORKOFF-STD dibuat (approval berjenjang izin tidak masuk)");
  const chains = await backfillChains(db);
  console.log(`  Chain backfill: ${chains.created} dibuat, ${chains.finalized} difinalkan`);
  await db.$disconnect();
}
console.log("\nDONE");
