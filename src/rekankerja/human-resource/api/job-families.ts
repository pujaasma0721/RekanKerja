import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { toXlsx, xlsxResponse, exportFilename, type ExportColumn, type ExportCell } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";

// =============================================================================
// P3.1-BM (D-BM23) — JOB FAMILY API (tree 2-level + laporan struktur jabatan).
// Route tipis: src/app/api/rekankerja/job-families/route.ts mendelegasikan ke sini.
//
// Endpoint:
//   GET                     → daftar family (tree 2-level: root + children) +
//                             jumlah job langsung per baris.
//   GET ?export=xlsx[&lang] → XLSX laporan struktur jabatan (1 sheet, per-job
//                             row + family tanpa job) + ActivityLog Exported.
//   POST                    → create (code/nama/parent root-only/sortOrder).
//   PATCH                   → update (termasuk pindah parent dgn guard depth).
//   DELETE ?id=             → hapus (guard: job teraut / sub-family → 400).
//
// Guard menu: hr:jobs — view utk GET/export, create/update/delete utk mutasi
// (mengikuti pola jobs.ts; super-admin & mode ALL lolos otomatis).
// Pesan error statis dwibahasa via BASE_EN (trServer exact-match) — entri
// ditambah di i18n-core.ts blok marker P3-SLICE-A.
// =============================================================================

/** Batas input family (jaga kolom DB tetap sehat). */
const FAMILY_CODE_MAX = 40;
const FAMILY_NAME_MAX = 100;

/** Seluruh pesan 400 statis dwibahasa (BASE_EN P3-SLICE-A). */
const ERR_REQUIRED = "Kode dan nama family wajib diisi";
const ERR_CODE_MAX = "Kode family maksimal 40 karakter";
const ERR_NAME_MAX = "Nama family maksimal 100 karakter";
const ERR_CODE_DUP = "Kode family sudah dipakai — gunakan kode lain";
const ERR_NOT_FOUND = "Family tidak ditemukan";
const ERR_PARENT_NOT_FOUND = "Parent family tidak ditemukan";
const ERR_DEPTH = "Family jabatan maksimal 2 tingkat — sub-family tidak dapat memiliki sub-family lagi";
const ERR_MOVE_WITH_CHILDREN = "Family yang memiliki sub-family tidak dapat dipindahkan di bawah family lain";
const ERR_SELF_PARENT = "Family tidak dapat menjadi parent-nya sendiri";
const ERR_DELETE_JOBS = "Family jabatan masih memiliki job terkait — pindahkan job ke family lain dahulu";
const ERR_DELETE_CHILDREN = "Family jabatan masih memiliki sub-family — hapus sub-family dahulu";

/** Bentuk node family utk UI (tree 2-level + hitungan job langsung). */
export interface FamilyNodeDto {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  jobCount: number;
  children: FamilyNodeDto[];
}

/** Ambil seluruh family tenant dalam bentuk tree (root → children). */
async function familyTree(db: import("@/rekankerja/shared/lib/tenant-db").TenantDb): Promise<FamilyNodeDto[]> {
  const rows = await db.jobFamily.findMany({
    include: { _count: { select: { jobs: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const byId = new Map<string, FamilyNodeDto>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, code: r.code, name: r.name, parentId: r.parentId,
      sortOrder: r.sortOrder, jobCount: r._count.jobs, children: [],
    });
  }
  const roots: FamilyNodeDto[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["hr:jobs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    // ---------- Laporan struktur jabatan (XLSX) ----------
    if (req.nextUrl.searchParams.get("export") === "xlsx") {
      const lang: Lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "id";
      const families = await familyTree(db);
      // agregat posisi per job (jumlah headcount + terisi) — sekali groupBy.
      const posAgg = await db.position.groupBy({
        by: ["jobId"],
        where: { jobId: { not: null } },
        _sum: { headcount: true, filled: true },
      });
      const posByJob = new Map<string, { total: number; filled: number }>();
      for (const p of posAgg) {
        posByJob.set(p.jobId ?? "", {
          total: p._sum.headcount ?? 0,
          filled: p._sum.filled ?? 0,
        });
      }
      const jobs = await db.job.findMany({
        include: { family: { select: { id: true, code: true, name: true, parentId: true } } },
        orderBy: { code: "asc" },
      });
      const jobByFamily = new Map<string, typeof jobs>();
      const orphanJobs: typeof jobs = [];
      for (const j of jobs) {
        if (j.familyId && j.family) {
          const list = jobByFamily.get(j.familyId) ?? [];
          list.push(j);
          jobByFamily.set(j.familyId, list);
        } else orphanJobs.push(j);
      }
      const columns: ExportColumn[] = [
        { header: "Family", width: 32 },
        { header: "Kode Family", width: 18 },
        { header: "Kode Job", width: 14 },
        { header: "Judul Job", width: 30 },
        { header: "Aktif", width: 10 },
        { header: "Jumlah Posisi", width: 14 },
        { header: "Posisi Terisi", width: 13 },
        { header: "Mission", width: 52 },
      ];
      const rows: ExportCell[][] = [];
      // Family tanpa job tetap muncul (struktur lengkap) — kolom job "—".
      let jobRowCount = 0;
      const walk = (f: FamilyNodeDto, indent: boolean) => {
        const famJobs = jobByFamily.get(f.id) ?? [];
        jobRowCount += famJobs.length;
        if (famJobs.length === 0) {
          rows.push([indent ? `    ${f.name}` : f.name, f.code, "—", "—", "—", 0, 0, ""]);
        }
        for (const j of famJobs) {
          const agg = posByJob.get(j.id);
          rows.push([
            indent ? `    ${f.name}` : f.name,
            f.code,
            j.code,
            j.title,
            j.active ? "Aktif" : "Nonaktif",
            agg?.total ?? 0,
            agg?.filled ?? 0,
            j.mission ? j.mission.slice(0, 200) : "",
          ]);
        }
        for (const c of f.children) walk(c, true);
      };
      for (const root of families) walk(root, false);
      // job tanpa family — tetap dilaporkan (baris akhir, kolom family "—").
      for (const j of orphanJobs) {
        const agg = posByJob.get(j.id);
        rows.push([
          "—", "—", j.code, j.title,
          j.active ? "Aktif" : "Nonaktif",
          agg?.total ?? 0, agg?.filled ?? 0,
          j.mission ? j.mission.slice(0, 200) : "",
        ]);
      }
      const buf = await toXlsx("Struktur Jabatan", columns, rows, {
        title: "Laporan Struktur Jabatan",
        lang,
      });
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "JobFamily",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor laporan struktur jabatan (${rows.length} baris, ${jobRowCount} job)`,
          },
        });
      } catch { /* ActivityLog opsional — export tetap sukses */ }
      return xlsxResponse(buf, exportFilename("rekankerja-struktur-jabatan", "xlsx"));
    }

    // ---------- Daftar family (tree) ----------
    const families = await familyTree(db);
    return NextResponse.json({ families });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:jobs", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!code || !name) return NextResponse.json({ error: ERR_REQUIRED }, { status: 400 });
    if (code.length > FAMILY_CODE_MAX) return NextResponse.json({ error: ERR_CODE_MAX }, { status: 400 });
    if (name.length > FAMILY_NAME_MAX) return NextResponse.json({ error: ERR_NAME_MAX }, { status: 400 });
    const dup = await db.jobFamily.findUnique({ where: { code } });
    if (dup) return NextResponse.json({ error: ERR_CODE_DUP }, { status: 400 });

    // parent wajib ROOT (tree maks 2 tingkat — D-BM23).
    let parentId: string | null = null;
    if (typeof b.parentId === "string" && b.parentId) {
      const parent = await db.jobFamily.findUnique({ where: { id: b.parentId } });
      if (!parent) return NextResponse.json({ error: ERR_PARENT_NOT_FOUND }, { status: 400 });
      if (parent.parentId != null) return NextResponse.json({ error: ERR_DEPTH }, { status: 400 });
      parentId = parent.id;
    }
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Math.trunc(Number(b.sortOrder)) : 0;

    const fam = await db.jobFamily.create({ data: { code, name, parentId, sortOrder } });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "JobFamily", entityId: fam.id,
        ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
        detail: parentId
          ? `Family jabatan ${fam.name} (${fam.code}) dibuat sebagai sub-family`
          : `Family jabatan ${fam.name} (${fam.code}) dibuat`,
      },
    });
    return NextResponse.json({ family: fam }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:jobs", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const fam = await db.jobFamily.findUnique({ where: { id: b.id }, include: { _count: { select: { children: true } } } });
    if (!fam) return NextResponse.json({ error: ERR_NOT_FOUND }, { status: 404 });

    const data: Record<string, unknown> = {};

    if (typeof b.code === "string") {
      const code = b.code.trim().toUpperCase();
      if (!code) return NextResponse.json({ error: ERR_REQUIRED }, { status: 400 });
      if (code.length > FAMILY_CODE_MAX) return NextResponse.json({ error: ERR_CODE_MAX }, { status: 400 });
      if (code !== fam.code) {
        const dup = await db.jobFamily.findUnique({ where: { code } });
        if (dup) return NextResponse.json({ error: ERR_CODE_DUP }, { status: 400 });
      }
      data.code = code;
    }
    if (typeof b.name === "string") {
      const name = b.name.trim();
      if (!name) return NextResponse.json({ error: ERR_REQUIRED }, { status: 400 });
      if (name.length > FAMILY_NAME_MAX) return NextResponse.json({ error: ERR_NAME_MAX }, { status: 400 });
      data.name = name;
    }

    // pindah parent — guard depth-2 (D-BM23):
    if (b.parentId !== undefined) {
      if (b.parentId === null || b.parentId === "") {
        data.parentId = null; // naik ke root — selalu aman.
      } else {
        if (b.parentId === fam.id) return NextResponse.json({ error: ERR_SELF_PARENT }, { status: 400 });
        const parent = await db.jobFamily.findUnique({ where: { id: b.parentId } });
        if (!parent) return NextResponse.json({ error: ERR_PARENT_NOT_FOUND }, { status: 400 });
        if (parent.parentId != null) return NextResponse.json({ error: ERR_DEPTH }, { status: 400 });
        if (fam._count.children > 0) return NextResponse.json({ error: ERR_MOVE_WITH_CHILDREN }, { status: 400 });
        data.parentId = parent.id;
      }
    }
    if (b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))) {
      data.sortOrder = Math.trunc(Number(b.sortOrder));
    }

    const updated = await db.jobFamily.update({ where: { id: fam.id }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "JobFamily", entityId: fam.id,
        ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
        detail: `Family jabatan ${updated.name} (${updated.code}) diperbarui`,
      },
    });
    return NextResponse.json({ family: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:jobs", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const fam = await db.jobFamily.findUnique({
      where: { id },
      include: { _count: { select: { jobs: true, children: true } } },
    });
    if (!fam) return NextResponse.json({ error: ERR_NOT_FOUND }, { status: 404 });
    if (fam._count.jobs > 0) return NextResponse.json({ error: ERR_DELETE_JOBS }, { status: 400 });
    if (fam._count.children > 0) return NextResponse.json({ error: ERR_DELETE_CHILDREN }, { status: 400 });

    await db.jobFamily.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        action: "Deleted", entity: "JobFamily", entityId: id,
        ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
        detail: `Family jabatan ${fam.name} (${fam.code}) dihapus`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
