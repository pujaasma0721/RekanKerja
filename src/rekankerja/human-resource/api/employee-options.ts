import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { resolveMenuPerms } from "@/rekankerja/shared/services/menu-access";

// GET /api/rekankerja/employee-options — select options for wizard/detail.
// M-11 (audit 42, follow-up 43-g): managers[] memuat NIK + gaji pokok
// TERDEKRIPSI — gerbang menu view-any (pola 43-a/43-g) atas menu konsumen:
// halaman karyawan HR (directory/tree: wizard/dokumen/aksi/assets/offboarding),
// settings (approval structure / audit), payroll (bonus massal). Tanpa LIHAT
// di salah satu menu → 403 (tidak ada fallback self-scope — ESS tidak
// mengonsumsi endpoint ini; pencarian global shell memakai /employees).
const OPTIONS_MENUS = ["hr:directory", "hr:tree", "settings:security", "settings:audit", "payroll:runs"];

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const menu = await resolveMenuPerms(req);
    const hasMenu = Boolean(
      menu && (menu.all || OPTIONS_MENUS.some((k) => menu.perms[k]?.view === true)),
    );
    if (!hasMenu) {
      return NextResponse.json(
        {
          error:
            `Akses ditolak: Anda tidak memiliki aksi "Lihat" pada menu ${OPTIONS_MENUS.join(" / ")}. ` +
            "Hak aksi diatur per pengguna — hubungi admin bila memerlukan akses.",
        },
        { status: 403 },
      );
    }

    const [orgUnits, positions, grades, employeesRaw, companies, lookups] = await Promise.all([
      db.orgUnit.findMany({ where: { active: true }, select: { id: true, name: true, level: true, code: true }, orderBy: { code: "asc" } }),
      db.position.findMany({ where: { active: true }, select: { id: true, title: true, code: true, orgUnitId: true }, orderBy: { code: "asc" } }),
      db.grade.findMany({ where: { active: true }, select: { id: true, code: true, name: true, minSalary: true, maxSalary: true }, orderBy: { sortOrder: "asc" } }),
      // AUD-DEPLOY (3-a H-8 + 2-a HIGH-2 follow-up): SELECT sempit — dulu
      // `include` SEMUA kolom karyawan lalu flattenEmployee men-dekripsi
      // NIK/NPWP/rekening dan menyebarkannya (…rest) ke managers[] untuk
      // sekadar dropdown wizard/PA/bonus/approval (150–300 KB PII per buka
      // dialog). Konsumen hanya memakai: id/employeeNo/fullName/position/
      // employmentStatus/status/joinDate/endDate/baseSalary/workShift.
      db.employee.findMany({
        where: { status: "Active" },
        select: {
          id: true, employeeNo: true, fullName: true, status: true, joinDate: true, endDate: true,
          assignments: {
            where: { validTo: null },
            orderBy: { validFrom: "desc" },
            take: 1,
            select: { employmentStatus: true, baseSalary: true, workShift: true, position: { select: { title: true } } },
          },
        },
        orderBy: { employeeNo: "asc" },
      }),
      db.company.findMany({ select: { id: true, name: true, code: true, shortName: true } }),
      db.lookup.findMany({ where: { active: true }, select: { category: true, code: true, label: true }, orderBy: { sortOrder: "asc" } }),
    ]);

    // 45-b: gerbang vault uang — gaji pokok managers → null saat masked.
    // (Bentuk flat kompatibel konsumen: PA-create/bonus-massal memakai
    // baseSalary + employmentStatus + workShift; picker lain cukup identitas.)
    const mv = await moneyViewForReq(req, db);
    const tc = tenantCryptoForDb(db);
    const employees = employeesRaw.map((e) => {
      const a = e.assignments[0];
      return {
        id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, status: e.status,
        joinDate: e.joinDate, endDate: e.endDate,
        employmentStatus: a?.employmentStatus ?? "Tanpa data",
        workShift: a?.workShift ?? "Regular",
        // 28-c: baseSalary TERENKRIPSI — dekripsi di batas serializer.
        baseSalary: a?.baseSalary ? (mv.canSee ? tc.decryptMoney(a.baseSalary) ?? 0 : null) : 0,
        position: a?.position ?? null,
      };
    });

    const lookupMap: Record<string, { code: string; label: string }[]> = {};
    for (const l of lookups) {
      (lookupMap[l.category] ??= []).push({ code: l.code, label: l.label });
    }

    return NextResponse.json({ orgUnits, positions, grades, managers: employees, companies, lookups: lookupMap });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
