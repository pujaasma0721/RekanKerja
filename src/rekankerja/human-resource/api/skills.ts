// P3.2-BM (D-BM24) — API SKILLS ==================================================
// ================================================================================
// GET /api/rekankerja/skills — 4 mode:
//   ?q=&category=&active=  → daftar katalog + hitung pemakaian (menu hr:skills view)
//   ?options=1             → opsi keahlian AKTIF utk picker (viewAny hr:skills|hr:list —
//                            dipakai dialog posisi & dialog penilaian)
//   ?employeeId=           → keahlian satu karyawan (skema akses data — pola
//                            employee-detail; utk tab Keahlian di profil karyawan)
//   ?gapFor=<positionId>   → analisis gap keahlian posisi (D-BM24, read-only)
// POST  {action:"create"}          → katalog baru (hr:skills create)
// POST  {action:"assess-employee"} → upsert penilaian EmployeeSkill (op:assess
//                                    + cakupan akses data karyawan)
// PATCH {id, ...}                  → ubah katalog (hr:skills update)
// DELETE ?id=              → hapus katalog (hr:skills delete + guard terpakai)
// DELETE ?employeeSkillId= → hapus satu penilaian karyawan (op:assess + scope)
// Semua mutasi ter-audit ActivityLog. Katalog + level SAJA — bukan modul
// training (D-BM28 exclude permanen).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { requireScoped, isEmployeeInScope, resolveAccessScope } from "@/rekankerja/shared/services/access-scope";
import {
  parseSkillRequirements,
  skillsGapForPosition,
  SkillServiceError,
} from "@/rekankerja/human-resource/services/skill-service";

const errJson = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });

function skillError(e: unknown): NextResponse | null {
  if (e instanceof SkillServiceError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return null;
}

// ---------- GET ----------
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const gapFor = sp.get("gapFor");
    const employeeId = sp.get("employeeId");

    // --- mode: analisis gap per posisi (D-BM24) ---
    if (gapFor) {
      const m = await requireMenuViewAny(req, ["hr:skills", "hr:list"]);
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      try {
        return NextResponse.json(await skillsGapForPosition(m.db, gapFor));
      } catch (e) {
        const se = skillError(e);
        if (se) return se;
        throw e;
      }
    }

    // --- mode: keahlian satu karyawan (skema akses data — pola employee-detail) ---
    if (employeeId) {
      const s = await requireScoped(req);
      if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
      const employee = await s.db.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });
      if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
      const inScope = await isEmployeeInScope(s.db, s.scope, employeeId);
      if (!inScope) {
        return NextResponse.json(
          { error: "Akses ditolak: karyawan ini di luar skema akses data Anda. Hubungi admin workspace bila seharusnya dapat diakses." },
          { status: 403 },
        );
      }
      const skills = await s.db.employeeSkill.findMany({
        where: { employeeId },
        select: {
          id: true, skillId: true, level: true, evidence: true, assessedAt: true,
          skill: { select: { code: true, name: true, category: true } },
        },
        orderBy: [{ skill: { name: "asc" } }],
      });
      return NextResponse.json({ skills });
    }

    const q = sp.get("q")?.trim() ?? "";
    const category = sp.get("category");
    const active = sp.get("active");

    // --- mode: opsi aktif (picker ringan — tanpa hitungan pemakaian) ---
    if (sp.get("options")) {
      const m = await requireMenuViewAny(req, ["hr:skills", "hr:list"]);
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const skills = await m.db.skillCatalog.findMany({
        where: { active: true, ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] } : {}) },
        select: { id: true, code: true, name: true, category: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      return NextResponse.json({ skills });
    }

    // --- mode: daftar katalog + hitungan pemakaian (menu hr:skills) ---
    const m = await requireMenuAction(req, "hr:skills", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const where: Record<string, unknown> = {};
    if (q) where.OR = [{ code: { contains: q } }, { name: { contains: q } }];
    if (category && category !== "all") where.category = category;
    if (active === "true") where.active = true;
    if (active === "false") where.active = false;

    const [catalog, empCounts, positions] = await Promise.all([
      db.skillCatalog.findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      db.employeeSkill.groupBy({ by: ["skillId"], _count: { _all: true } }),
      db.position.findMany({ where: { requiredSkillsJson: { not: null } }, select: { requiredSkillsJson: true } }),
    ]);
    const empCountOf = new Map(empCounts.map((c) => [c.skillId, c._count._all]));
    // hitung pemakaian di syarat posisi: requiredSkillsJson adalah JSON string
    // (Postgres string — tak bisa query contains native) → scan + parse ringan.
    const posCountOf = new Map<string, number>();
    for (const p of positions) {
      try {
        for (const r of parseSkillRequirements(p.requiredSkillsJson)) {
          posCountOf.set(r.skillId, (posCountOf.get(r.skillId) ?? 0) + 1);
        }
      } catch {
        // json legacy cacat → dihitung 0 utk baris itu, jangan gagalkan daftar
      }
    }

    return NextResponse.json({
      skills: catalog.map((s) => ({
        id: s.id, code: s.code, name: s.name, category: s.category,
        active: s.active, sortOrder: s.sortOrder,
        employeeCount: empCountOf.get(s.id) ?? 0,
        positionCount: posCountOf.get(s.id) ?? 0,
      })),
      total: catalog.length,
    });
  } catch (e) {
    return errJson(e);
  }
}

// ---------- POST (action-based) ----------
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");

    // === create katalog ===
    if (action === "create") {
      const m = await requireMenuAction(req, "hr:skills", "create");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;

      const code = String(b.code ?? "").trim().toUpperCase();
      const name = String(b.name ?? "").trim();
      const category = b.category == null || String(b.category).trim() === "" ? null : String(b.category).trim();
      const sortOrder = b.sortOrder == null || b.sortOrder === "" ? 0 : Number(b.sortOrder);
      if (!code || !name) return NextResponse.json({ error: "Kode dan nama keahlian wajib diisi" }, { status: 400 });
      if (code.length > 24) return NextResponse.json({ error: "Kode keahlian maksimal 24 karakter" }, { status: 400 });
      if (name.length > 120) return NextResponse.json({ error: "Nama keahlian maksimal 120 karakter" }, { status: 400 });
      if (category && category.length > 60) return NextResponse.json({ error: "Kategori maksimal 60 karakter" }, { status: 400 });
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
        return NextResponse.json({ error: "Urutan tampil harus bilangan bulat 0–9999" }, { status: 400 });
      }
      const exists = await db.skillCatalog.findUnique({ where: { code } });
      if (exists) return NextResponse.json({ error: `Kode keahlian ${code} sudah dipakai` }, { status: 400 });
      const skill = await db.skillCatalog.create({
        data: { code, name, category, sortOrder, active: b.active !== false },
      });
      await db.activityLog.create({
        data: {
          action: "Created", entity: "SkillCatalog", entityId: skill.id,
          appUserId: m.actor.appUserId ?? undefined,
          detail: `Keahlian ${skill.name} (${skill.code}) dibuat di katalog`,
        },
      });
      return NextResponse.json({ skill }, { status: 201 });
    }

    // === assess-employee: upsert penilaian EmployeeSkill ===
    if (action === "assess-employee") {
      const m = await requireMenuAction(req, "hr:skills", "op:assess");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;

      const employeeId = String(b.employeeId ?? "");
      const skillId = String(b.skillId ?? "");
      const level = Number(b.level);
      if (!employeeId || !skillId) return NextResponse.json({ error: "employeeId & skillId wajib" }, { status: 400 });
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        return NextResponse.json({ error: "Level keahlian harus bilangan bulat 1–5" }, { status: 400 });
      }
      const evidence = b.evidence == null || String(b.evidence).trim() === "" ? null : String(b.evidence).trim();
      if (evidence && evidence.length > 500) {
        return NextResponse.json({ error: "Bukti/evidence maksimal 500 karakter" }, { status: 400 });
      }
      let assessedAt = new Date();
      if (b.assessedAt != null && String(b.assessedAt) !== "") {
        const d = new Date(String(b.assessedAt));
        if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Tanggal penilaian tidak valid" }, { status: 400 });
        assessedAt = d;
      }

      const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true } });
      if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
      const skill = await db.skillCatalog.findUnique({ where: { id: skillId } });
      if (!skill) return NextResponse.json({ error: "Keahlian tidak ditemukan di katalog" }, { status: 400 });
      if (!skill.active) return NextResponse.json({ error: `Keahlian "${skill.name}" sudah non-aktif — tidak bisa dinilai` }, { status: 400 });

      // cakupan akses data karyawan (pola PATCH employee-detail) — mutasi
      // penilaian hanya utk karyawan dalam scope efektif aktor.
      const scope = await resolveAccessScope(db, {
        appUserId: m.actor.appUserId,
        employeeId: m.actor.employeeId,
        appUserRole: m.actor.appUserRole,
        platformRole: m.actor.role,
      });
      const inScope = await isEmployeeInScope(db, scope, employeeId);
      if (!inScope) {
        return NextResponse.json(
          { error: "Akses ditolak: karyawan ini di luar skema akses data Anda. Hubungi admin workspace bila seharusnya dapat diakses." },
          { status: 403 },
        );
      }

      const existing = await db.employeeSkill.findUnique({
        where: { employeeId_skillId: { employeeId, skillId } },
        select: { id: true, level: true },
      });
      const row = await db.employeeSkill.upsert({
        where: { employeeId_skillId: { employeeId, skillId } },
        create: { employeeId, skillId, level, evidence, assessedAt },
        update: { level, evidence, assessedAt },
      });
      await db.activityLog.create({
        data: {
          action: existing ? "Updated" : "Created",
          entity: "EmployeeSkill",
          entityId: row.id,
          employeeId,
          appUserId: m.actor.appUserId ?? undefined,
          detail: existing
            ? `Penilaian ${skill.name} karyawan ${employee.fullName} diubah ke level ${level} (dari ${existing.level})`
            : `Penilaian ${skill.name} karyawan ${employee.fullName} ditambahkan level ${level}`,
        },
      });
      return NextResponse.json({ employeeSkill: row, updated: !!existing });
    }

    return NextResponse.json({ error: "action tidak dikenal (create|assess-employee)" }, { status: 400 });
  } catch (e) {
    return errJson(e);
  }
}

// ---------- PATCH (ubah katalog) ----------
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:skills", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const current = await db.skillCatalog.findUnique({ where: { id: String(b.id) } });
    if (!current) return NextResponse.json({ error: "Keahlian tidak ditemukan di katalog" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.name !== undefined) {
      const name = String(b.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Nama keahlian wajib diisi" }, { status: 400 });
      if (name.length > 120) return NextResponse.json({ error: "Nama keahlian maksimal 120 karakter" }, { status: 400 });
      data.name = name;
    }
    if (b.category !== undefined) {
      const category = b.category == null || String(b.category).trim() === "" ? null : String(b.category).trim();
      if (category && category.length > 60) return NextResponse.json({ error: "Kategori maksimal 60 karakter" }, { status: 400 });
      data.category = category;
    }
    if (b.sortOrder !== undefined) {
      const sortOrder = b.sortOrder == null || b.sortOrder === "" ? 0 : Number(b.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
        return NextResponse.json({ error: "Urutan tampil harus bilangan bulat 0–9999" }, { status: 400 });
      }
      data.sortOrder = sortOrder;
    }
    if (b.active !== undefined) data.active = b.active === true;

    const skill = await db.skillCatalog.update({ where: { id: String(b.id) }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "SkillCatalog", entityId: skill.id,
        appUserId: m.actor.appUserId ?? undefined,
        detail: `Keahlian ${skill.name} (${skill.code}) diperbarui${b.active !== undefined && b.active !== current.active ? ` — ${b.active ? "diaktifkan" : "dinonaktifkan"}` : ""}`,
      },
    });
    return NextResponse.json({ skill });
  } catch (e) {
    return errJson(e);
  }
}

// ---------- DELETE (katalog / penilaian karyawan) ----------
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const employeeSkillId = req.nextUrl.searchParams.get("employeeSkillId");

    // === hapus satu penilaian karyawan (op:assess + scope) ===
    if (employeeSkillId) {
      const m = await requireMenuAction(req, "hr:skills", "op:assess");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;

      const row = await db.employeeSkill.findUnique({
        where: { id: employeeSkillId },
        select: { id: true, employeeId: true, level: true, skill: { select: { name: true } }, employee: { select: { fullName: true } } },
      });
      if (!row) return NextResponse.json({ error: "Penilaian keahlian tidak ditemukan" }, { status: 404 });
      const scope = await resolveAccessScope(db, {
        appUserId: m.actor.appUserId,
        employeeId: m.actor.employeeId,
        appUserRole: m.actor.appUserRole,
        platformRole: m.actor.role,
      });
      const inScope = await isEmployeeInScope(db, scope, row.employeeId);
      if (!inScope) {
        return NextResponse.json(
          { error: "Akses ditolak: karyawan ini di luar skema akses data Anda. Hubungi admin workspace bila seharusnya dapat diakses." },
          { status: 403 },
        );
      }
      await db.employeeSkill.delete({ where: { id: employeeSkillId } });
      await db.activityLog.create({
        data: {
          action: "Deleted", entity: "EmployeeSkill", entityId: row.id,
          employeeId: row.employeeId,
          appUserId: m.actor.appUserId ?? undefined,
          detail: `Penilaian ${row.skill.name} (level ${row.level}) karyawan ${row.employee.fullName} dihapus`,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // === hapus katalog (guard terpakai — bilingual) ===
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "hr:skills", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const skill = await db.skillCatalog.findUnique({ where: { id } });
    if (!skill) return NextResponse.json({ error: "Keahlian tidak ditemukan di katalog" }, { status: 404 });

    const empCount = await db.employeeSkill.count({ where: { skillId: id } });
    const positions = await db.position.findMany({
      where: { requiredSkillsJson: { not: null } },
      select: { requiredSkillsJson: true },
    });
    let posCount = 0;
    for (const p of positions) {
      try {
        if (parseSkillRequirements(p.requiredSkillsJson).some((r) => r.skillId === id)) posCount++;
      } catch {
        // json cacat diabaikan utk guard hapus
      }
    }
    if (empCount > 0 || posCount > 0) {
      return NextResponse.json(
        {
          error:
            `Keahlian "${skill.name}" masih dipakai (${empCount} penilaian karyawan, ${posCount} posisi) — ` +
            `Skill "${skill.name}" is still in use (${empCount} employee assessments, ${posCount} positions)`,
        },
        { status: 400 },
      );
    }

    await db.skillCatalog.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        action: "Deleted", entity: "SkillCatalog", entityId: id,
        appUserId: m.actor.appUserId ?? undefined,
        detail: `Keahlian ${skill.name} (${skill.code}) dihapus dari katalog`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errJson(e);
  }
}
