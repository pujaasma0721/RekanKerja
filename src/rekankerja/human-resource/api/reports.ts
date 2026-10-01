import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";

// GET /api/rekankerja/hr/reports — laporan HR agregat:
//   • Turnover & Tenure: KPI (headcount aktif, hires YTD, exits YTD,
//     turnover rate = exits / avg headcount, avg tenure tahun), tabel per
//     divisi (headcount, exits, turnover %), distribusi bucket tenure
//     (<1 / 1-3 / 3-5 / 5-10 / >10 th), tren hires-exits 12 bulan.
//   • Demografi: gender, bucket usia, status kepegawaian (assignment aktif),
//     marital, agama, pendidikan terakhir (bucket jenjang tertinggi),
//     unit organisasi, level jabatan, grade, kantor, golongan darah,
//     cross-tab gender × status kepegawaian.
// ?export=turnover|demografi → stream XLSX (multi-sheet) — pola respons
// payroll-run-export.ts (Content-Disposition attachment).
//
// Guard: requireMenuAction hr:directory view (pola employees.ts) + data
// dihitung dalam cakupan akses efektif pengguna (pola dashboard.ts).
const EXIT_STATUSES = new Set(["Resigned", "Terminated"]);

interface LifeRow {
  status: string;
  joinDate: Date;
  endDate: Date | null;
  gender: string;
  birthDate: Date | null;
  maritalStatus: string | null;
  religion: string | null;
  bloodType: string | null;
  /** unit penempatan: assignment aktif (aktif) / snapshot employee (keluar). */
  unitId: string | null;
  employmentStatus: string | null;
  /** dimensi demografi tambahan (snapshot employee — driven assignment aktif). */
  positionLevelId: string | null;
  gradeId: string | null;
  companyOfficeId: string | null;
  /** seluruh jenjang di EmployeeEducation (bucket dihitung dari tertinggi). */
  eduLevels: string[];
}

interface GenderStatusRow {
  gender: "Laki-laki" | "Perempuan";
  Permanent: number;
  Probation: number;
  Contract: number;
  Outsourcing: number;
  "Tanpa data": number;
}

const TENURE_BUCKETS: { key: string; label: string; test: (y: number) => boolean }[] = [
  { key: "lt1", label: "< 1 tahun", test: (y) => y < 1 },
  { key: "b13", label: "1 – 3 tahun", test: (y) => y >= 1 && y < 3 },
  { key: "b35", label: "3 – 5 tahun", test: (y) => y >= 3 && y < 5 },
  { key: "b510", label: "5 – 10 tahun", test: (y) => y >= 5 && y < 10 },
  { key: "gt10", label: "> 10 tahun", test: (y) => y >= 10 },
];

const AGE_BUCKETS: { key: string; label: string; test: (y: number) => boolean }[] = [
  { key: "lt25", label: "< 25", test: (a) => a < 25 },
  { key: "b2534", label: "25 – 34", test: (a) => a >= 25 && a < 35 },
  { key: "b3544", label: "35 – 44", test: (a) => a >= 35 && a < 45 },
  { key: "b4554", label: "45 – 54", test: (a) => a >= 45 && a < 55 },
  { key: "gt55", label: "≥ 55", test: (a) => a >= 55 },
];

export async function GET(req: NextRequest) {
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

    // lifecycle + demografi satu query (assignment aktif utk status pegawai
    // & unit; snapshot employee.orgUnitId utk yang sudah keluar) + master
    // referensi (nama unit/level/grade/kantor) utk distribusi demografi.
    const [rows, divisions, subUnits, unitsAll, posLevels, gradesAll, officesAll] = await Promise.all([
      db.employee.findMany({
        where: scopeCond,
        select: {
          status: true, joinDate: true, endDate: true, gender: true, birthDate: true,
          maritalStatus: true, religion: true, bloodType: true, orgUnitId: true,
          positionLevelId: true, gradeId: true, companyOfficeId: true,
          assignments: { where: { validTo: null }, select: { orgUnitId: true, employmentStatus: true }, take: 1 },
          education: { select: { level: true } },
        },
      }),
      db.orgUnit.findMany({ where: { level: 3 }, select: { id: true, name: true } }),
      db.orgUnit.findMany({ where: { level: 4 }, select: { id: true, parentId: true } }),
      db.orgUnit.findMany({ select: { id: true, name: true } }),
      db.positionLevel.findMany({ select: { id: true, name: true } }),
      db.grade.findMany({ select: { id: true, code: true, name: true } }),
      db.companyOffice.findMany({ select: { id: true, name: true } }),
    ]);

    const divisionMap = new Map(divisions.map((d) => [d.id, d.name]));
    const subToDiv = new Map(subUnits.map((s) => [s.id, s.parentId]));
    const unitNameById = new Map(unitsAll.map((u) => [u.id, u.name]));
    const plNameById = new Map(posLevels.map((p) => [p.id, p.name]));
    const gradeById = new Map(gradesAll.map((g) => [g.id, g]));
    const officeNameById = new Map(officesAll.map((o) => [o.id, o.name]));
    const divNameOf = (unitId: string | null): string => {
      if (!unitId) return "Tanpa Unit";
      const divId = divisionMap.has(unitId) ? unitId : (subToDiv.get(unitId) ?? unitId);
      return divisionMap.get(divId) ?? "Lainnya";
    };

    const life: LifeRow[] = rows.map((e) => ({
      status: e.status,
      joinDate: new Date(e.joinDate),
      endDate: e.endDate ? new Date(e.endDate) : null,
      gender: e.gender,
      birthDate: e.birthDate ? new Date(e.birthDate) : null,
      maritalStatus: e.maritalStatus,
      religion: e.religion,
      unitId: e.assignments[0]?.orgUnitId ?? e.orgUnitId,
      employmentStatus: e.assignments[0]?.employmentStatus ?? null,
      bloodType: e.bloodType,
      positionLevelId: e.positionLevelId,
      gradeId: e.gradeId,
      companyOfficeId: e.companyOfficeId,
      eduLevels: e.education.map((ed) => ed.level),
    }));

    const now = new Date();
    const year = now.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const active = life.filter((e) => e.status === "Active");
    const isExit = (e: LifeRow) => EXIT_STATUSES.has(e.status);
    const employedAt = (e: LifeRow, d: Date) => e.joinDate <= d && (!e.endDate || e.endDate >= d);

    const hiresYtd = life.filter((e) => e.joinDate >= yearStart).length;
    const exitsYtd = life.filter((e) => isExit(e) && e.endDate && e.endDate >= yearStart).length;
    const startHeadcount = life.filter((e) => employedAt(e, yearStart)).length;
    const avgHeadcount = (startHeadcount + active.length) / 2;
    const turnoverRate = avgHeadcount > 0 ? (exitsYtd / avgHeadcount) * 100 : 0;

    // avg tenure (tahun, desimal 1) — karyawan aktif
    const tenureOf = (e: LifeRow) => (now.getTime() - e.joinDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    const avgTenure = active.length > 0
      ? active.reduce((s, e) => s + tenureOf(e), 0) / active.length
      : 0;
    const r1 = (n: number) => Math.round(n * 10) / 10;

    // per divisi: headcount aktif, exits YTD, turnover %
    const divAgg = new Map<string, { start: number; active: number; exits: number }>();
    const bump = (name: string) => divAgg.get(name) ?? { start: 0, active: 0, exits: 0 };
    for (const e of life) {
      const name = divNameOf(e.unitId);
      const cur = bump(name);
      if (employedAt(e, yearStart)) cur.start++;
      if (e.status === "Active") cur.active++;
      if (isExit(e) && e.endDate && e.endDate >= yearStart) cur.exits++;
      divAgg.set(name, cur);
    }
    const byDivision = [...divAgg.entries()]
      .map(([division, v]) => {
        const avg = (v.start + v.active) / 2;
        return {
          division,
          headcount: v.active,
          exits: v.exits,
          turnoverRate: r1(avg > 0 ? (v.exits / avg) * 100 : 0),
        };
      })
      .sort((a, b) => b.headcount - a.headcount || a.division.localeCompare(b.division));

    // distribusi tenure (aktif)
    const tenureBuckets = TENURE_BUCKETS.map((b) => ({
      key: b.key, label: b.label, count: active.filter((e) => b.test(tenureOf(e))).length,
    }));

    // tren 12 bulan (semua lifecycle dalam scope — hires & exits histori)
    const monthLabel = (d: Date) => new Intl.DateTimeFormat("id-ID", { month: "short" }).format(d);
    const trend: { month: string; hires: number; exits: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trend.push({
        month: monthLabel(d),
        hires: life.filter((e) => e.joinDate.getFullYear() === d.getFullYear() && e.joinDate.getMonth() === d.getMonth()).length,
        exits: life.filter((e) => isExit(e) && e.endDate && e.endDate.getFullYear() === d.getFullYear() && e.endDate.getMonth() === d.getMonth()).length,
      });
    }

    // ===== demografi (karyawan aktif dalam scope) =====
    const dist = (vals: (string | null)[], order?: string[]) => {
      const map = new Map<string, number>();
      for (const v of vals) {
        const k = v && v.trim() ? v : "—";
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      let entries = [...map.entries()];
      if (order) {
        entries.sort((a, b) => {
          const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || b[1] - a[1];
        });
      } else {
        entries = entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      }
      return entries.map(([label, count]) => ({ label, count }));
    };

    const ageOf = (e: LifeRow) =>
      e.birthDate ? (now.getTime() - e.birthDate.getTime()) / (365.25 * 24 * 3600 * 1000) : null;
    const ageBuckets = AGE_BUCKETS.map((b) => ({
      key: b.key, label: b.label, count: active.filter((e) => { const a = ageOf(e); return a != null && b.test(a); }).length,
    }));
    const noBirth = active.filter((e) => !e.birthDate).length;

    // distribusi dgn sentinel "Tanpa data" utk nilai null/kosong (count desc).
    const distNd = (vals: (string | null)[]) => {
      const map = new Map<string, number>();
      for (const v of vals) {
        const k = v && v.trim() ? v : "Tanpa data";
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, count]) => ({ label, count }));
    };

    // pendidikan terakhir per karyawan = jenjang TERTINGGI dari semua baris
    // EmployeeEducation (jenjang tak dikenali diabaikan → tanpa data).
    const EDU_RANK: Record<string, number> = {
      S3: 6, S2: 5, S1: 4,
      D1: 3, D2: 3, D3: 3, D4: 3,
      SD: 2, SMP: 2, "PAKET A": 2, "PAKET B": 2, SMA: 2, SMK: 2,
    };
    const eduBucketOf = (levels: string[]): string => {
      let rank = 0;
      for (const lv of levels) {
        const r = EDU_RANK[lv.trim().toUpperCase()];
        if (r != null && r > rank) rank = r;
      }
      if (rank === 0) return "Tanpa data";
      if (rank >= 6) return "S3";
      if (rank === 5) return "S2";
      if (rank === 4) return "S1";
      if (rank === 3) return "Diploma (D1–D4)";
      return "SMA & Sederajat";
    };
    // urutan bucket tetap utk display (UI boleh re-sort dgn urutan sama).
    const EDU_ORDER = ["S3", "S2", "S1", "Diploma (D1–D4)", "SMA & Sederajat", "Tanpa data"];
    const eduCounts = new Map<string, number>();
    for (const e of active) {
      const b = eduBucketOf(e.eduLevels);
      eduCounts.set(b, (eduCounts.get(b) ?? 0) + 1);
    }
    const education = EDU_ORDER
      .filter((label) => label !== "Tanpa data" || (eduCounts.get(label) ?? 0) > 0)
      .map((label) => ({ label, count: eduCounts.get(label) ?? 0 }));

    // cross-tab gender × status kepegawaian (status: assignment aktif —
    // sumber yang sama dgn employmentStatus di atas; null → "Tanpa data").
    const genderByStatus: GenderStatusRow[] = (["Laki-laki", "Perempuan"] as const).map((g) => {
      const row: GenderStatusRow = {
        gender: g, Permanent: 0, Probation: 0, Contract: 0, Outsourcing: 0, "Tanpa data": 0,
      };
      for (const e of active) {
        if ((e.gender === "F" ? "Perempuan" : "Laki-laki") !== g) continue;
        const st = e.employmentStatus ?? "Tanpa data";
        if (st === "Permanent" || st === "Probation" || st === "Contract" || st === "Outsourcing") row[st] += 1;
        else row["Tanpa data"] += 1;
      }
      return row;
    });

    const demografi = {
      gender: dist(active.map((e) => (e.gender === "F" ? "Perempuan" : e.gender === "M" ? "Laki-laki" : e.gender)), ["Laki-laki", "Perempuan"]),
      ageBuckets: noBirth > 0 ? [...ageBuckets, { key: "na", label: "Tanpa data", count: noBirth }] : ageBuckets,
      employmentStatus: dist(active.map((e) => e.employmentStatus), ["Permanent", "Probation", "Contract", "Outsourcing"]),
      marital: dist(active.map((e) => e.maritalStatus), ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"]),
      religion: dist(active.map((e) => e.religion)),
      education,
      orgUnits: distNd(active.map((e) => (e.unitId ? (unitNameById.get(e.unitId) ?? null) : null))),
      positionLevels: distNd(active.map((e) => (e.positionLevelId ? (plNameById.get(e.positionLevelId) ?? null) : null))),
      grades: distNd(active.map((e) => {
        if (!e.gradeId) return null;
        const g = gradeById.get(e.gradeId);
        if (!g) return null;
        return g.name && g.name.trim() ? `${g.code} — ${g.name}` : g.code;
      })),
      offices: distNd(active.map((e) => (e.companyOfficeId ? (officeNameById.get(e.companyOfficeId) ?? null) : null))),
      bloodTypes: distNd(active.map((e) => (e.bloodType && e.bloodType.trim() ? `Gol. ${e.bloodType.trim()}` : null))),
      genderByStatus,
    };

    const turnover = {
      kpi: {
        headcount: active.length,
        headcountTotal: life.length,
        startHeadcount,
        avgHeadcount: r1(avgHeadcount),
        hiresYtd,
        exitsYtd,
        turnoverRate: r1(turnoverRate),
        avgTenureYears: r1(avgTenure),
      },
      byDivision,
      tenureBuckets,
      trend,
    };

    // ===== mode export =====
    const exportMode = req.nextUrl.searchParams.get("export");
    if (exportMode) {
      const k = turnover.kpi;
      let sheets: ExportSheet[];
      let filename: string;
      if (exportMode === "turnover") {
        sheets = [
          {
            name: "Ringkasan",
            title: `Laporan Turnover & Tenure ${year}`,
            columns: [{ header: "Indikator", width: 30 }, { header: "Nilai", width: 18 }],
            rows: [
              ["Headcount Aktif", k.headcount],
              ["Headcount Awal Tahun", k.startHeadcount],
              ["Rata-rata Headcount", k.avgHeadcount],
              ["Hires YTD", k.hiresYtd],
              ["Exits YTD", k.exitsYtd],
              ["Turnover Rate (%)", k.turnoverRate],
              ["Avg Tenure (tahun)", k.avgTenureYears],
            ],
          },
          {
            name: "Per Divisi",
            title: `Headcount & Turnover per Divisi — ${year}`,
            columns: [{ header: "Divisi", width: 32 }, { header: "Headcount", width: 14 }, { header: "Exits YTD", width: 12 }, { header: "Turnover %", width: 13 }],
            rows: byDivision.map((d) => [d.division, d.headcount, d.exits, d.turnoverRate]),
          },
          {
            name: "Distribusi Tenure",
            columns: [{ header: "Bucket Tenure", width: 22 }, { header: "Jumlah Karyawan", width: 18 }],
            rows: tenureBuckets.map((b) => [b.label, b.count]),
          },
          {
            name: "Tren 12 Bulan",
            columns: [{ header: "Bulan", width: 12 }, { header: "Hires", width: 10 }, { header: "Exits", width: 10 }],
            rows: trend.map((t) => [t.month, t.hires, t.exits]),
          },
        ];
        filename = exportFilename("rekankerja-hr-turnover", "xlsx");
      } else if (exportMode === "demografi") {
        const gsTotal = (r: GenderStatusRow) => r.Permanent + r.Probation + r.Contract + r.Outsourcing + r["Tanpa data"];
        const gsCol = (c: "Permanent" | "Probation" | "Contract" | "Outsourcing" | "Tanpa data") =>
          genderByStatus.reduce((s, r) => s + r[c], 0);
        sheets = [
          { name: "Gender", columns: [{ header: "Gender", width: 20 }, { header: "Jumlah", width: 12 }], rows: demografi.gender.map((g) => [g.label, g.count]) },
          { name: "Usia", columns: [{ header: "Bucket Usia", width: 20 }, { header: "Jumlah", width: 12 }], rows: demografi.ageBuckets.map((a) => [a.label, a.count]) },
          { name: "Status Pegawai", columns: [{ header: "Status Kepegawaian", width: 26 }, { header: "Jumlah", width: 12 }], rows: demografi.employmentStatus.map((s) => [s.label, s.count]) },
          { name: "Marital", columns: [{ header: "Status Pernikahan", width: 24 }, { header: "Jumlah", width: 12 }], rows: demografi.marital.map((s) => [s.label, s.count]) },
          { name: "Agama", columns: [{ header: "Agama", width: 24 }, { header: "Jumlah", width: 12 }], rows: demografi.religion.map((s) => [s.label, s.count]) },
          { name: "Pendidikan", columns: [{ header: "Pendidikan Terakhir", width: 22 }, { header: "Jumlah", width: 12 }], rows: education.map((s) => [s.label, s.count]) },
          { name: "Unit Organisasi", columns: [{ header: "Unit Organisasi", width: 36 }, { header: "Jumlah", width: 12 }], rows: demografi.orgUnits.map((s) => [s.label, s.count]) },
          { name: "Level Jabatan", columns: [{ header: "Level Jabatan", width: 26 }, { header: "Jumlah", width: 12 }], rows: demografi.positionLevels.map((s) => [s.label, s.count]) },
          { name: "Grade", columns: [{ header: "Grade", width: 26 }, { header: "Jumlah", width: 12 }], rows: demografi.grades.map((s) => [s.label, s.count]) },
          { name: "Kantor", columns: [{ header: "Kantor", width: 30 }, { header: "Jumlah", width: 12 }], rows: demografi.offices.map((s) => [s.label, s.count]) },
          { name: "Golongan Darah", columns: [{ header: "Golongan Darah", width: 20 }, { header: "Jumlah", width: 12 }], rows: demografi.bloodTypes.map((s) => [s.label, s.count]) },
          {
            name: "Gender x Status",
            columns: [
              { header: "Gender", width: 16 }, { header: "Permanent", width: 12 }, { header: "Probation", width: 12 },
              { header: "Contract", width: 12 }, { header: "Outsourcing", width: 12 }, { header: "Tanpa data", width: 12 }, { header: "Total", width: 10 },
            ],
            rows: [
              ...genderByStatus.map((r) => [r.gender, r.Permanent, r.Probation, r.Contract, r.Outsourcing, r["Tanpa data"], gsTotal(r)]),
              ["TOTAL", gsCol("Permanent"), gsCol("Probation"), gsCol("Contract"), gsCol("Outsourcing"), gsCol("Tanpa data"), genderByStatus.reduce((s, r) => s + gsTotal(r), 0)],
            ],
          },
        ];
        filename = exportFilename("rekankerja-hr-demografi", "xlsx");
      } else {
        return NextResponse.json(
          { error: "Parameter export tidak dikenal — gunakan ?export=turnover atau ?export=demografi" },
          { status: 400 },
        );
      }

      const buf = await toXlsxMulti(sheets);
      await logExport(db, exportMode, m.actor.appUserId);
      return xlsxResponse(buf, filename);
    }

    return NextResponse.json({ generatedAt: now.toISOString(), year, scope: scope.all ? "all" : "scoped", turnover, demografi });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

async function logExport(db: TenantDb, kind: string, appUserId: string | null) {
  try {
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "HrReport",
        ...(appUserId ? { appUserId } : {}),
        detail: `Ekspor XLSX laporan HR (${kind})`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}
