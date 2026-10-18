// P3.5-BM (D-BM27) — API CAREER PATHS =============================================
// ================================================================================
// GET  /api/rekankerja/career-paths — 2 mode (menu hr:career-paths):
//   (default)      → daftar seluruh jalur + judul posisi asal/tujuan + nama
//                   keahlian syarat (ter-parse) + catatan; dikelompokkan
//                   per posisi asal oleh UI.
//   ?options=1     → opsi picker: posisi AKTIF (id/kode/judul/unit) + katalog
//                   keahlian AKTIF (id/nama/kategori) utk dialog buat/ubah.
// POST   {fromPositionId, toPositionId, requirements, note} → jalur baru
//        (guard: posisi sama 400 · pasangan duplikat 409 · JALUR BALIK
//        LANGSUNG 400 dwibahasa · syarat divalidasi vs SkillCatalog aktif).
// PATCH  {id, ...} → ubah (guard sama, duplikat dikecualikan diri sendiri).
// DELETE ?id=      → hapus jalur.
// Semua mutasi ter-audit ActivityLog. Jalur karier = graf posisi → posisi
// berikutnya + syarat keahlian (D-BM27) — BUKAN modul training (D-BM28
// exclude permanen; tidak ada kursus/sesi/e-learning di sini).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { validatePositionRequirements, type SkillRequirement } from "@/rekankerja/human-resource/services/skill-service";

const MAX_NOTE = 500;

const errJson = (e: unknown) =>
  NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });

/** Bentuk baris jalur utk respons GET (UI dikelompokkan per posisi asal). */
export interface CareerPathRow {
  id: string;
  fromPosition: { id: string; code: string; title: string; active: boolean; unitName: string | null };
  toPosition: { id: string; code: string; title: string; active: boolean; unitName: string | null };
  requirements: { skillId: string; name: string; level: number }[];
  note: string | null;
}

/** Muat + bentuk satu baris jalur (dipakai POST/PATCH agar respons konsisten). */
async function loadRow(
  db: import("@/rekankerja/shared/lib/tenant-db").TenantDb,
  id: string,
): Promise<CareerPathRow | null> {
  const r = await db.careerPath.findUnique({
    where: { id },
    include: {
      fromPosition: { select: { id: true, code: true, title: true, active: true, orgUnit: { select: { name: true } } } },
      toPosition: { select: { id: true, code: true, title: true, active: true, orgUnit: { select: { name: true } } } },
    },
  });
  if (!r) return null;
  let reqs: SkillRequirement[] = [];
  try {
    reqs = r.requiredSkillsJson ? (JSON.parse(r.requiredSkillsJson) as SkillRequirement[]) : [];
  } catch {
    reqs = []; // json legacy cacat → tampil tanpa syarat, tidak menggagalkan daftar
  }
  const skillIds = reqs.map((x) => x.skillId);
  const skills = skillIds.length
    ? await db.skillCatalog.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(skills.map((s) => [s.id, s.name]));
  return {
    id: r.id,
    fromPosition: {
      id: r.fromPosition.id, code: r.fromPosition.code, title: r.fromPosition.title,
      active: r.fromPosition.active, unitName: r.fromPosition.orgUnit?.name ?? null,
    },
    toPosition: {
      id: r.toPosition.id, code: r.toPosition.code, title: r.toPosition.title,
      active: r.toPosition.active, unitName: r.toPosition.orgUnit?.name ?? null,
    },
    requirements: reqs.map((x) => ({ skillId: x.skillId, name: nameOf.get(x.skillId) ?? "—", level: x.level })),
    note: r.note,
  };
}

// ---------- GET ----------
export async function GET(req: NextRequest) {
  try {
    // mode: opsi picker (dialog buat/ubah — posisi aktif + katalog aktif)
    if (req.nextUrl.searchParams.get("options") === "1") {
      const m = await requireMenuViewAny(req, ["hr:career-paths"]);
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const [positions, skills] = await Promise.all([
        m.db.position.findMany({
          where: { active: true },
          select: { id: true, code: true, title: true, orgUnit: { select: { name: true } } },
          orderBy: { title: "asc" },
        }),
        m.db.skillCatalog.findMany({
          where: { active: true },
          select: { id: true, name: true, category: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      ]);
      return NextResponse.json({
        positions: positions.map((p) => ({ id: p.id, code: p.code, title: p.title, unitName: p.orgUnit?.name ?? null })),
        skills: skills.map((s) => ({ id: s.id, name: s.name, category: s.category })),
      });
    }

    // mode: daftar jalur lengkap (menu hr:career-paths view)
    const m = await requireMenuAction(req, "hr:career-paths", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const rows = await db.careerPath.findMany({
      include: {
        fromPosition: { select: { id: true, code: true, title: true, active: true, orgUnit: { select: { name: true } } } },
        toPosition: { select: { id: true, code: true, title: true, active: true, orgUnit: { select: { name: true } } } },
      },
      orderBy: [{ fromPosition: { title: "asc" } }, { toPosition: { title: "asc" } }],
    });

    // nama keahlian utk seluruh syarat (1 kueri batch)
    const allReqs = rows.flatMap((r) => {
      try {
        return r.requiredSkillsJson ? (JSON.parse(r.requiredSkillsJson) as SkillRequirement[]) : [];
      } catch {
        return [] as SkillRequirement[]; // json legacy cacat diabaikan utk tampilan
      }
    });
    const skills = allReqs.length
      ? await db.skillCatalog.findMany({
          where: { id: { in: [...new Set(allReqs.map((x) => x.skillId))] } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(skills.map((s) => [s.id, s.name]));

    const paths: CareerPathRow[] = rows.map((r) => {
      let reqs: SkillRequirement[] = [];
      try {
        reqs = r.requiredSkillsJson ? (JSON.parse(r.requiredSkillsJson) as SkillRequirement[]) : [];
      } catch {
        reqs = [];
      }
      return {
        id: r.id,
        fromPosition: {
          id: r.fromPosition.id, code: r.fromPosition.code, title: r.fromPosition.title,
          active: r.fromPosition.active, unitName: r.fromPosition.orgUnit?.name ?? null,
        },
        toPosition: {
          id: r.toPosition.id, code: r.toPosition.code, title: r.toPosition.title,
          active: r.toPosition.active, unitName: r.toPosition.orgUnit?.name ?? null,
        },
        requirements: reqs.map((x) => ({ skillId: x.skillId, name: nameOf.get(x.skillId) ?? "—", level: x.level })),
        note: r.note,
      };
    });

    return NextResponse.json({
      paths,
      stats: {
        paths: paths.length,
        sources: new Set(paths.map((p) => p.fromPosition.id)).size,
        targets: new Set(paths.map((p) => p.toPosition.id)).size,
      },
    });
  } catch (e) {
    return errJson(e);
  }
}

// ---------- POST (buat jalur) ----------
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:career-paths", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const fromPositionId = String(b.fromPositionId ?? "");
    const toPositionId = String(b.toPositionId ?? "");
    if (!fromPositionId || !toPositionId) {
      return NextResponse.json({ error: "Posisi asal & posisi tujuan wajib dipilih" }, { status: 400 });
    }
    if (fromPositionId === toPositionId) {
      return NextResponse.json({ error: "Posisi tujuan harus berbeda dari posisi asal" }, { status: 400 });
    }

    const [from, to] = await Promise.all([
      db.position.findUnique({ where: { id: fromPositionId }, select: { id: true, title: true, code: true } }),
      db.position.findUnique({ where: { id: toPositionId }, select: { id: true, title: true, code: true } }),
    ]);
    if (!from) return NextResponse.json({ error: "Posisi asal tidak ditemukan" }, { status: 404 });
    if (!to) return NextResponse.json({ error: "Posisi tujuan tidak ditemukan" }, { status: 404 });

    // guard duplikat pasangan (unique fromPositionId+toPositionId)
    const dupe = await db.careerPath.findUnique({
      where: { fromPositionId_toPositionId: { fromPositionId, toPositionId } },
      select: { id: true },
    });
    if (dupe) {
      return NextResponse.json(
        {
          error:
            `Jalur "${from.title}" → "${to.title}" sudah terdaftar — ubah jalur yang ada · ` +
            `Path "${from.title}" → "${to.title}" already exists — edit the existing path`,
        },
        { status: 409 },
      );
    }

    // guard JALUR BALIK LANGSUNG (A→B saat B→A sudah ada) — dwibahasa (D-BM27)
    const reverse = await db.careerPath.findUnique({
      where: { fromPositionId_toPositionId: { fromPositionId: toPositionId, toPositionId: fromPositionId } },
      select: { id: true },
    });
    if (reverse) {
      return NextResponse.json(
        {
          error:
            `Jalur balik langsung tidak diperbolehkan — jalur "${to.title}" → "${from.title}" sudah terdaftar · ` +
            `A direct reverse path is not allowed — the path "${to.title}" → "${from.title}" already exists`,
        },
        { status: 400 },
      );
    }

    // syarat keahlian: [{skillId, level}] — validasi bentuk + skill aktif (slice B)
    let requirements: SkillRequirement[] = [];
    if (b.requirements != null) {
      try {
        requirements = await validatePositionRequirements(db, b.requirements);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Syarat keahlian tidak valid" },
          { status: 400 },
        );
      }
    }

    const note = b.note == null || String(b.note).trim() === "" ? null : String(b.note).trim();
    if (note && note.length > MAX_NOTE) {
      return NextResponse.json({ error: `Catatan maksimal ${MAX_NOTE} karakter` }, { status: 400 });
    }

    const created = await db.careerPath.create({
      data: {
        fromPositionId,
        toPositionId,
        requiredSkillsJson: requirements.length ? JSON.stringify(requirements) : null,
        note,
      },
    });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "CareerPath", entityId: created.id,
        appUserId: m.actor.appUserId ?? undefined,
        detail:
          `Jalur karier "${from.title}" → "${to.title}" dibuat oleh ${m.actor.name}` +
          `${requirements.length ? ` — ${requirements.length} syarat keahlian` : ""}` +
          `${note ? `, catatan "${note.slice(0, 120)}"` : ""} (D-BM27)`,
      },
    });
    const row = await loadRow(db, created.id);
    return NextResponse.json({ path: row }, { status: 201 });
  } catch (e) {
    return errJson(e);
  }
}

// ---------- PATCH (ubah jalur) ----------
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:career-paths", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.careerPath.findUnique({
      where: { id },
      include: {
        fromPosition: { select: { id: true, title: true } },
        toPosition: { select: { id: true, title: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Jalur karier tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    let from = existing.fromPosition;
    let to = existing.toPosition;

    // perubahan posisi (asal/tujuan) → guard lengkap dijalankan ulang
    const newFrom = b.fromPositionId != null ? String(b.fromPositionId) : existing.fromPositionId;
    const newTo = b.toPositionId != null ? String(b.toPositionId) : existing.toPositionId;
    const positionsChanged = newFrom !== existing.fromPositionId || newTo !== existing.toPositionId;
    if (positionsChanged) {
      if (newFrom === newTo) {
        return NextResponse.json({ error: "Posisi tujuan harus berbeda dari posisi asal" }, { status: 400 });
      }
      const [fromPos, toPos] = await Promise.all([
        db.position.findUnique({ where: { id: newFrom }, select: { id: true, title: true } }),
        db.position.findUnique({ where: { id: newTo }, select: { id: true, title: true } }),
      ]);
      if (!fromPos) return NextResponse.json({ error: "Posisi asal tidak ditemukan" }, { status: 404 });
      if (!toPos) return NextResponse.json({ error: "Posisi tujuan tidak ditemukan" }, { status: 404 });
      from = fromPos;
      to = toPos;

      const dupe = await db.careerPath.findFirst({
        where: { fromPositionId: newFrom, toPositionId: newTo, id: { not: existing.id } },
        select: { id: true },
      });
      if (dupe) {
        return NextResponse.json(
          {
            error:
              `Jalur "${from.title}" → "${to.title}" sudah terdaftar — ubah jalur yang ada · ` +
              `Path "${from.title}" → "${to.title}" already exists — edit the existing path`,
          },
          { status: 409 },
        );
      }
      const reverse = await db.careerPath.findFirst({
        where: { fromPositionId: newTo, toPositionId: newFrom, id: { not: existing.id } },
        select: { id: true },
      });
      if (reverse) {
        return NextResponse.json(
          {
            error:
              `Jalur balik langsung tidak diperbolehkan — jalur "${to.title}" → "${from.title}" sudah terdaftar · ` +
              `A direct reverse path is not allowed — the path "${to.title}" → "${from.title}" already exists`,
          },
          { status: 400 },
        );
      }
      data.fromPositionId = newFrom;
      data.toPositionId = newTo;
    }

    // syarat keahlian diganti (validasi sama dgn POST)
    if (b.requirements != null) {
      let requirements: SkillRequirement[] = [];
      try {
        requirements = await validatePositionRequirements(db, b.requirements);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Syarat keahlian tidak valid" },
          { status: 400 },
        );
      }
      data.requiredSkillsJson = requirements.length ? JSON.stringify(requirements) : null;
    }

    if (b.note !== undefined) {
      const note = b.note == null || String(b.note).trim() === "" ? null : String(b.note).trim();
      if (note && note.length > MAX_NOTE) {
        return NextResponse.json({ error: `Catatan maksimal ${MAX_NOTE} karakter` }, { status: 400 });
      }
      data.note = note;
    }

    const updated = await db.careerPath.update({ where: { id: existing.id }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "CareerPath", entityId: updated.id,
        appUserId: m.actor.appUserId ?? undefined,
        detail:
          `Jalur karier "${from.title}" → "${to.title}" diubah oleh ${m.actor.name}` +
          (data.requiredSkillsJson != null
            ? ` — syarat keahlian → ${(JSON.parse(String(data.requiredSkillsJson)) as SkillRequirement[]).length} entri`
            : "") +
          (data.note !== undefined ? `, catatan ${data.note ? `"${String(data.note).slice(0, 120)}"` : "dihapus"}` : "") +
          (positionsChanged ? ", pasangan posisi diubah" : "") + " (D-BM27)",
      },
    });
    const row = await loadRow(db, updated.id);
    return NextResponse.json({ path: row });
  } catch (e) {
    return errJson(e);
  }
}

// ---------- DELETE (hapus jalur) ----------
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "hr:career-paths", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const existing = await db.careerPath.findUnique({
      where: { id },
      include: {
        fromPosition: { select: { title: true } },
        toPosition: { select: { title: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Jalur karier tidak ditemukan" }, { status: 404 });

    await db.careerPath.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        action: "Deleted", entity: "CareerPath", entityId: id,
        appUserId: m.actor.appUserId ?? undefined,
        detail: `Jalur karier "${existing.fromPosition.title}" → "${existing.toPosition.title}" dihapus oleh ${m.actor.name} (D-BM27)`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errJson(e);
  }
}
