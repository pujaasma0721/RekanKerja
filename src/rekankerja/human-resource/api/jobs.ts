import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// =============================================================================
// P3.1-BM (D-BM23) — Job API + JOB PROFILE (family/mission/duties/qualifications/
// minEducation/workingConditions). GET juga menyertakan family utk kolom tabel
// & filter family di UI Katalog Job.
// Validasi: mission/workingConditions ≤ 2000 kar; item duties/qualifications
// ≤ 500 kar & ≤ 20 item (disimpan sbg JSON array string di dutiesJson/
// qualificationsJson); minEducation ∈ {SMA/SMK, D3, S1, S2, S3}.
// =============================================================================

const MISSION_MAX = 2000;
const LIST_ITEM_MAX = 500;
const LIST_MAX_ITEMS = 20;
const EDUCATION_LEVELS = ["SMA/SMK", "D3", "S1", "S2", "S3"] as const;

/** Pesan 400 statis dwibahasa (BASE_EN blok P3-SLICE-A — trServer exact-match). */
const ERR_FAMILY_NOT_FOUND = "Family jabatan tidak ditemukan";
const ERR_EDU_INVALID = "Syarat pendidikan tidak valid (pilih SMA/SMK, D3, S1, S2, atau S3)";
const ERR_MISSION_MAX = "Mission maksimal 2000 karakter";
const ERR_CONDITIONS_MAX = "Kondisi kerja maksimal 2000 karakter";
const ERR_DUTY_ITEM_MAX = "Item tugas maksimal 500 karakter";
const ERR_QUAL_ITEM_MAX = "Item kualifikasi maksimal 500 karakter";
const ERR_DUTY_MAX_ITEMS = "Maksimal 20 item tugas";
const ERR_QUAL_MAX_ITEMS = "Maksimal 20 item kualifikasi";
const ERR_DUTY_NOT_ARRAY = "Tugas harus berupa daftar teks";
const ERR_QUAL_NOT_ARRAY = "Kualifikasi harus berupa daftar teks";

/** Hasil validasi job profile. */
type ProfileResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/**
 * Validasi + bentuk field job profile dari body request.
 * Mengembalikan { error } (→ 400) atau { data } siap dipakai create/update.
 * Semua field opsional — hanya divalidasi bila kunci dikirim klien.
 */
async function jobProfileData(
  db: TenantDb,
  b: Record<string, unknown>,
): Promise<ProfileResult> {
  const data: Record<string, unknown> = {};

  if ("familyId" in b) {
    if (b.familyId === null || b.familyId === "") {
      data.familyId = null;
    } else if (typeof b.familyId === "string") {
      const fam = await db.jobFamily.findUnique({ where: { id: b.familyId }, select: { id: true } });
      if (!fam) return { ok: false, error: ERR_FAMILY_NOT_FOUND, status: 400 };
      data.familyId = fam.id;
    } else {
      return { ok: false, error: ERR_FAMILY_NOT_FOUND, status: 400 };
    }
  }

  if ("mission" in b) {
    if (b.mission != null && typeof b.mission !== "string") return { ok: false, error: ERR_MISSION_MAX, status: 400 };
    const mission = typeof b.mission === "string" ? b.mission.trim() : "";
    if (mission.length > MISSION_MAX) return { ok: false, error: ERR_MISSION_MAX, status: 400 };
    data.mission = mission || null;
  }

  if ("workingConditions" in b) {
    if (b.workingConditions != null && typeof b.workingConditions !== "string") return { ok: false, error: ERR_CONDITIONS_MAX, status: 400 };
    const wc = typeof b.workingConditions === "string" ? b.workingConditions.trim() : "";
    if (wc.length > MISSION_MAX) return { ok: false, error: ERR_CONDITIONS_MAX, status: 400 };
    data.workingConditions = wc || null;
  }

  if ("minEducation" in b) {
    if (b.minEducation == null || b.minEducation === "") {
      data.minEducation = null;
    } else if (typeof b.minEducation === "string" && (EDUCATION_LEVELS as readonly string[]).includes(b.minEducation)) {
      data.minEducation = b.minEducation;
    } else {
      return { ok: false, error: ERR_EDU_INVALID, status: 400 };
    }
  }

  // duties / qualifications — daftar teks → JSON array string.
  const listPairs: Array<{ key: string; jsonKey: string; itemErr: string; maxErr: string; notArrErr: string }> = [
    { key: "duties", jsonKey: "dutiesJson", itemErr: ERR_DUTY_ITEM_MAX, maxErr: ERR_DUTY_MAX_ITEMS, notArrErr: ERR_DUTY_NOT_ARRAY },
    { key: "qualifications", jsonKey: "qualificationsJson", itemErr: ERR_QUAL_ITEM_MAX, maxErr: ERR_QUAL_MAX_ITEMS, notArrErr: ERR_QUAL_NOT_ARRAY },
  ];
  for (const lp of listPairs) {
    if (!(lp.key in b)) continue;
    const v = b[lp.key];
    if (v == null) {
      data[lp.jsonKey] = null;
      continue;
    }
    if (!Array.isArray(v) || v.some((it) => typeof it !== "string")) {
      return { ok: false, error: lp.notArrErr, status: 400 };
    }
    if (v.length > LIST_MAX_ITEMS) return { ok: false, error: lp.maxErr, status: 400 };
    const items = (v as string[]).map((it) => it.trim()).filter((it) => it.length > 0);
    if (items.some((it) => it.length > LIST_ITEM_MAX)) return { ok: false, error: lp.itemErr, status: 400 };
    data[lp.jsonKey] = items.length > 0 ? JSON.stringify(items) : null;
  }

  return { ok: true, data };
}

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const jobs = await db.job.findMany({
      include: {
        family: { select: { id: true, code: true, name: true } },
        _count: { select: { positions: true } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({ jobs: jobs.map((j) => ({ ...j, positionCount: j._count.positions })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// T1-SECURITY: guard hak AKSI menu hr:jobs (Katalog Jabatan) per pengguna.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:jobs", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.title) return NextResponse.json({ error: "Kode dan judul job wajib diisi" }, { status: 400 });
    const exists = await db.job.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode job ${b.code} sudah dipakai` }, { status: 400 });

    const profile = await jobProfileData(db, b);
    if (!profile.ok) return NextResponse.json({ error: profile.error }, { status: profile.status });
    const job = await db.job.create({
      data: {
        code: b.code, title: b.title, category: b.category ?? "Staff", description: b.description,
        ...profile.data,
      },
    });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "Job", entityId: job.id,
        ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
        detail: `Job ${job.title} dibuat`,
      },
    });
    return NextResponse.json({ job }, { status: 201 });
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
    if (b.title !== undefined && !String(b.title).trim()) {
      return NextResponse.json({ error: "Kode dan judul job wajib diisi" }, { status: 400 });
    }
    const profile = await jobProfileData(db, b);
    if (!profile.ok) return NextResponse.json({ error: profile.error }, { status: profile.status });
    const job = await db.job.update({
      where: { id: b.id },
      data: { title: b.title, category: b.category, description: b.description, active: b.active, ...profile.data },
    });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "Job", entityId: job.id,
        ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
        detail: `Job ${job.title} diperbarui (profil family/mission/kualifikasi)`,
      },
    });
    return NextResponse.json({ job });
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
    const job = await db.job.findUnique({ where: { id }, select: { id: true, title: true, code: true } });
    if (!job) return NextResponse.json({ error: "Job tidak ditemukan" }, { status: 404 });
    const count = await db.position.count({ where: { jobId: id } });
    if (count > 0) return NextResponse.json({ error: `Job masih dipakai ${count} posisi` }, { status: 400 });
    await db.job.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        action: "Deleted", entity: "Job", entityId: id,
        ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
        detail: `Job ${job.title} (${job.code}) dihapus`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
