import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { resolveMenuPerms } from "@/rekankerja/shared/services/menu-access";
import { flattenEmployee } from "@/rekankerja/human-resource/services/assignment";

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
      db.employee.findMany({
        where: { status: "Active" },
        include: {
          assignments: {
            where: { validTo: null },
            orderBy: { validFrom: "desc" },
            take: 1,
            include: { position: { select: { title: true } } },
          },
        },
        orderBy: { employeeNo: "asc" },
      }),
      db.company.findMany({ select: { id: true, name: true, code: true, shortName: true } }),
      db.lookup.findMany({ where: { active: true }, select: { category: true, code: true, label: true }, orderBy: { sortOrder: "asc" } }),
    ]);

    // flatten assignment aktif → bentuk lama (position/orgUnitId).
    // 28-c / follow-up 43-b: NIK/NPWP/rekening + gaji pokok TERENKRIPSI di DB —
    // kirim konteks crypto agar flattenEmployee men-dekripsi di batas serializer
    // (decryptText meloloskan plaintext legacy; tanpa tc, karyawan yang pernah
    // di-PATCH pasca-enkripsi mengembalikan ciphertext enc:v1:… ke klien).
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi) — gaji pokok
    // managers → null saat masked (PII tetap terdekripsi — vault hanya uang).
    const tc = tenantCryptoForDb(db);
    const mv = await moneyViewForReq(req, db);
    const employees = employeesRaw.map((e) => {
      const flat = flattenEmployee(e, tc);
      const { assignments, ...rest } = flat as Record<string, unknown>;
      if (!mv.canSee) rest.baseSalary = null;
      return rest;
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
