import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import {
  ACCESS_DIMENSIONS, ACCESS_SUBJECT_TYPES,
  resolveAccessScope, scopeWhere,
  type AccessDimension,
} from "@/onevity/shared/services/access-scope";
import { readSessionCookie } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";

// ============ SKEMA AKSES DATA (Task 30) ============
// CRUD rule akses data karyawan berbasis parameter (seperti struktur
// approval berjenjang) + simulasi akses efektif per pengguna
// (?action=preview&userId=) yang memperhitungkan akses otomatis
// (super admin, atasan langsung, diri sendiri).

const APP_ROLES = ["Admin", "HR Manager", "HR Staff", "Approver", "Viewer"];

/** Validasi & normalisasi payload rule (kriteria AND, null bila kosong). */
function normalizeRule(b: Record<string, unknown>) {
  if (!b.code || !b.name) return { error: "Kode & nama rule wajib diisi" } as const;
  const subjectType = String(b.subjectType ?? "ROLE");
  if (!(ACCESS_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    return { error: "Tipe subjek tidak valid (ROLE|USER|ACCESS_GROUP)" } as const;
  }
  const role = subjectType === "ROLE" ? String(b.role ?? "") : null;
  const appUserId = subjectType === "USER" ? (b.appUserId ? String(b.appUserId) : null) : null;
  const accessGroupId = subjectType === "ACCESS_GROUP" ? (b.accessGroupId ? String(b.accessGroupId) : null) : null;
  if (subjectType === "ROLE" && !role) return { error: "Pilih role untuk subjek rule" } as const;
  if (subjectType === "USER" && !appUserId) return { error: "Pilih pengguna untuk subjek rule" } as const;
  if (subjectType === "ACCESS_GROUP" && !accessGroupId) return { error: "Pilih access group untuk subjek rule" } as const;
  if (role != null && !APP_ROLES.includes(role)) return { error: `Role tidak dikenal (${APP_ROLES.join("|")})` } as const;

  const data: Record<string, unknown> = {
    code: String(b.code), name: String(b.name),
    description: b.description ? String(b.description) : null,
    subjectType, role, appUserId, accessGroupId,
    companyOfficeId: b.companyOfficeId || null,
    workLocationId: b.workLocationId || null,
    orgUnitId: b.orgUnitId || null,
    positionId: b.positionId || null,
    gradeId: b.gradeId || null,
    positionLevelId: b.positionLevelId || null,
    employmentStatus: b.employmentStatus || null,
    priority: b.priority != null && b.priority !== "" ? Number(b.priority) : 100,
    active: b.active !== false,
  };
  if (isNaN(data.priority as number)) return { error: "Prioritas harus angka" } as const;
  return { data } as const;
}

// GET /api/onevity/data-access-rules
// GET /api/onevity/data-access-rules?action=preview&userId=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;

    // ---- simulasi akses efektif seorang pengguna ----
    if (sp.get("action") === "preview") {
      const userId = sp.get("userId");
      if (!userId) return NextResponse.json({ error: "userId wajib untuk simulasi" }, { status: 400 });

      const user = await db.appUser.findUnique({
        where: { id: userId },
        select: { id: true, username: true, fullName: true, role: true, employeeId: true, email: true },
      });
      if (!user) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

      // platform role: cari membership via email (fallback null → bukan platform admin)
      let platformRole = "";
      if (user.email) {
        const pu = await platformDb.user.findUnique({
          where: { email: user.email },
          select: { memberships: { select: { role: true, tenant: { select: { schemaName: true } } } } },
        });
        platformRole = pu?.memberships.find((m) => m.tenant.schemaName)?.role ?? "";
      }

      const scope = await resolveAccessScope(db, {
        appUserId: user.id,
        employeeId: user.employeeId,
        appUserRole: user.role,
        platformRole,
      });
      const where = scopeWhere(scope);
      const [count, sample] = await Promise.all([
        db.employee.count({ where }),
        db.employee.findMany({
          where, take: 6,
          select: { id: true, employeeNo: true, fullName: true },
          orderBy: { employeeNo: "asc" },
        }),
      ]);
      return NextResponse.json({
        preview: {
          user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, employeeId: user.employeeId },
          platformRole: platformRole || null,
          all: scope.all,
          sources: scope.sources,
          subordinateCount: scope.subordinateIds.length,
          filterCount: scope.filters.length,
          accessibleCount: count,
          sample,
        },
      });
    }

    // ---- daftar rule + referensi subjek & kriteria ----
    const [rules, users, groups, offices, locations, units, positions, grades, levels] = await Promise.all([
      db.dataAccessRule.findMany({
        include: {
          appUser: { select: { username: true, fullName: true, role: true } },
          accessGroup: { select: { code: true, name: true } },
          companyOffice: { select: { code: true, name: true } },
          workLocation: { select: { code: true, name: true } },
          orgUnit: { select: { code: true, name: true } },
          position: { select: { code: true, title: true } },
          grade: { select: { code: true, name: true } },
          positionLevel: { select: { code: true, name: true } },
        },
        orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
      }),
      db.appUser.findMany({ select: { id: true, username: true, fullName: true, role: true, active: true }, orderBy: { username: "asc" } }),
      db.accessGroup.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
      db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
      db.workLocation.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
      db.position.findMany({ where: { active: true }, select: { id: true, code: true, title: true }, orderBy: { code: "asc" } }),
      db.grade.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
      db.positionLevel.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ]);
    return NextResponse.json({
      rules,
      users,
      groups,
      roles: APP_ROLES,
      employmentStatuses: ["Permanent", "Contract", "Probation", "Outsourcing"],
      references: { offices, locations, units, positions, grades, levels },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/data-access-rules { code, name, subjectType, role/appUserId/accessGroupId, kriteria…, priority, active }
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const r = normalizeRule(b);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    const exists = await db.dataAccessRule.findUnique({ where: { code: r.data.code as string } });
    if (exists) return NextResponse.json({ error: `Kode rule ${r.data.code} sudah dipakai` }, { status: 400 });

    const rule = await db.dataAccessRule.create({ data: r.data as never });
    await db.activityLog.create({
      data: { action: "Created", entity: "DataAccessRule", entityId: rule.id, detail: `Rule akses data ${rule.code} (${rule.name}) dibuat` },
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/data-access-rules?id=
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id rule wajib" }, { status: 400 });
    const cur = await db.dataAccessRule.findUnique({ where: { id } });
    if (!cur) return NextResponse.json({ error: "Rule tidak ditemukan" }, { status: 404 });

    const b = await req.json();

    // toggle cepat aktif/nonaktif
    if (b.active != null && Object.keys(b).length === 1) {
      const rule = await db.dataAccessRule.update({ where: { id }, data: { active: !!b.active } });
      return NextResponse.json({ rule });
    }

    const r = normalizeRule({ ...b, code: b.code ?? cur.code, name: b.name ?? cur.name });
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    if (r.data.code !== cur.code) {
      const clash = await db.dataAccessRule.findUnique({ where: { code: r.data.code as string } });
      if (clash) return NextResponse.json({ error: `Kode rule ${r.data.code} sudah dipakai` }, { status: 400 });
    }

    const rule = await db.dataAccessRule.update({ where: { id }, data: r.data as never });
    await db.activityLog.create({
      data: { action: "Updated", entity: "DataAccessRule", entityId: id, detail: `Rule akses data ${rule.code} diperbarui` },
    });
    return NextResponse.json({ rule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/data-access-rules?id=
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id rule wajib" }, { status: 400 });
    const cur = await db.dataAccessRule.findUnique({ where: { id } });
    if (!cur) return NextResponse.json({ error: "Rule tidak ditemukan" }, { status: 404 });

    await db.dataAccessRule.delete({ where: { id } });
    await db.activityLog.create({
      data: { action: "Deleted", entity: "DataAccessRule", entityId: id, detail: `Rule akses data ${cur.code} (${cur.name}) dihapus` },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
