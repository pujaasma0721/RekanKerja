import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

// OneVity — Detail offboarding: baca + seluruh aksi proses (tugas clearance,
// exit interview, selesai/batal, edit dasar, hapus bila dibatalkan).

/** Bentuk form exit interview (disimpan sebagai JSON string di kolom exitInterviewJson). */
export interface ExitInterviewForm {
  reason?: string | null;
  nextPlan?: string | null;
  feedback?: string | null;
  satisfaction?: number | null;
  notes?: string | null;
}

/** Label Indonesia status tugas (utk ActivityLog). */
const TASK_STATUS_LABEL: Record<string, string> = { Done: "Selesai", Pending: "Pending", Na: "N/A" };

/** Susun DTO detail offboarding penuh (dipakai GET detail + respons POST create). */
export async function buildOffboardingDetail(db: TenantDb, id: string) {
  const ob = await db.offboarding.findUnique({
    where: { id },
    include: {
      employee: {
        select: {
          id: true, fullName: true, employeeNo: true, joinDate: true, endDate: true, status: true,
          // data pekerjaan saat ini dari assignment aktif (saat proses dibuat)
          assignments: {
            where: { validTo: null },
            orderBy: { validFrom: "desc" },
            take: 1,
            include: {
              position: { select: { id: true, title: true, code: true } },
              orgUnit: { select: { id: true, name: true, code: true } },
              grade: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
      tasks: { orderBy: { seq: "asc" } },
    },
  });
  if (!ob) return null;

  // PA sumber — plain string tanpa FK → resolve manual (null bila PA terhapus)
  const sourcePA = ob.personnelActionId
    ? await db.personnelAction.findUnique({
        where: { id: ob.personnelActionId },
        select: { id: true, docNo: true, type: true, status: true, effectiveDate: true },
      })
    : null;

  // nama penyelesai tugas (completedById = AppUser id plain)
  const completerIds = [...new Set(ob.tasks.map((t) => t.completedById).filter((v): v is string => !!v))];
  const completers = completerIds.length > 0
    ? await db.appUser.findMany({ where: { id: { in: completerIds } }, select: { id: true, fullName: true } })
    : [];
  const nameMap = new Map(completers.map((c) => [c.id, c.fullName]));

  // flatten assignment aktif → position/orgUnit/grade pada level employee
  const cur = ob.employee.assignments[0] ?? null;
  const { assignments: _a, ...empRest } = ob.employee as typeof ob.employee & { assignments?: unknown[] };
  const employee = { ...empRest, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null, grade: cur?.grade ?? null };

  // exit interview — JSON string → objek (toleran bila korup → null)
  let exitInterview: ExitInterviewForm | null = null;
  if (ob.exitInterviewJson) {
    try {
      const parsed = JSON.parse(ob.exitInterviewJson) as Record<string, unknown>;
      exitInterview = {
        reason: typeof parsed.reason === "string" ? parsed.reason : null,
        nextPlan: typeof parsed.nextPlan === "string" ? parsed.nextPlan : null,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : null,
        satisfaction: typeof parsed.satisfaction === "number" ? parsed.satisfaction : null,
        notes: typeof parsed.notes === "string" ? parsed.notes : null,
      };
    } catch {
      exitInterview = null;
    }
  }

  const tasks = ob.tasks.map((t) => ({
    ...t,
    completedByName: t.completedById ? nameMap.get(t.completedById) ?? null : null,
  }));
  const done = tasks.filter((t) => t.status === "Done").length;
  const na = tasks.filter((t) => t.status === "Na").length;

  return {
    id: ob.id,
    employeeId: ob.employeeId,
    personnelActionId: ob.personnelActionId,
    lastDay: ob.lastDay,
    reason: ob.reason,
    status: ob.status,
    createdAt: ob.createdAt,
    completedAt: ob.completedAt,
    updatedAt: ob.updatedAt,
    employee,
    sourcePA,
    tasks,
    exitInterview,
    taskStats: { total: tasks.length, done, pending: tasks.length - done - na, na },
  };
}

// GET /api/onevity/offboarding/[id] — detail penuh
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:offboarding", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { id } = await ctx.params;
    const detail = await buildOffboardingDetail(m.db, id);
    if (!detail) return NextResponse.json({ error: "Proses offboarding tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ offboarding: detail });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/offboarding/[id] — aksi proses:
// task | addTask | removeTask | interview | complete | cancel | update
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:offboarding", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const actorLabel = actor.appUsername ?? actor.name;

    const { id } = await ctx.params;
    const b = await req.json();
    const act = b.action as string;

    const ob = await db.offboarding.findUnique({ where: { id }, include: { tasks: true } });
    if (!ob) return NextResponse.json({ error: "Proses offboarding tidak ditemukan" }, { status: 404 });

    const log = (action: string, detail: string) =>
      db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action, entity: "Offboarding", entityId: id, employeeId: ob.employeeId,
          detail: `${detail} oleh ${actorLabel}`,
        },
      });

    // proses yang sudah Completed/Cancelled BEKU — semua aksi mutasi
    // (tugas/interview/edit) hanya berlaku saat status masih Open.
    const frozen = () =>
      NextResponse.json({ error: "Proses sudah selesai/dibatalkan — data tidak bisa diubah" }, { status: 400 });
    if (ob.status !== "Open" && ["task", "addTask", "removeTask", "interview", "update"].includes(act)) {
      return frozen();
    }

    // ===== TASK — centang/buka-centang/N-A satu tugas checklist =====
    if (act === "task") {
      const task = ob.tasks.find((t) => t.id === b.taskId);
      if (!task) return NextResponse.json({ error: "Tugas tidak ditemukan pada proses ini" }, { status: 404 });
      const status = String(b.status ?? "");
      if (!["Done", "Pending", "Na"].includes(status)) {
        return NextResponse.json({ error: "Status tugas tidak valid (Done/Pending/Na)" }, { status: 400 });
      }
      await db.offboardingTask.update({
        where: { id: task.id },
        data: {
          status,
          // jejak penyelesai saat TRANSISI ke Done; bila sudah Done (mis. edit
          // catatan saja) penyelesai & waktu ASLI dipertahankan, tidak ditimpa.
          completedAt: status === "Done" ? task.completedAt ?? new Date() : null,
          completedById: status === "Done" ? task.completedById ?? actor.appUserId : null,
          ...(b.notes !== undefined ? { notes: b.notes?.trim() ? String(b.notes).trim() : null } : {}),
        },
      });
      await log("Updated", `Tugas clearance "${task.title}" → ${TASK_STATUS_LABEL[status] ?? status}`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    // ===== ADD TASK — tugas tambahan di akhir checklist =====
    if (act === "addTask") {
      const title = String(b.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "Judul tugas wajib diisi" }, { status: 400 });
      const owner = b.owner ? String(b.owner) : null;
      const maxSeq = ob.tasks.reduce((mx, t) => Math.max(mx, t.seq), 0);
      await db.offboardingTask.create({
        data: { offboardingId: id, seq: maxSeq + 1, title, owner, status: "Pending" },
      });
      await log("Updated", `Tugas clearance tambahan "${title}"${owner ? ` (${owner})` : ""} ditambahkan`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    // ===== REMOVE TASK — hapus tugas (hanya yang belum dikerjakan) =====
    if (act === "removeTask") {
      const task = ob.tasks.find((t) => t.id === b.taskId);
      if (!task) return NextResponse.json({ error: "Tugas tidak ditemukan pada proses ini" }, { status: 404 });
      if (task.status !== "Pending") {
        return NextResponse.json({ error: "Hanya tugas berstatus Pending yang bisa dihapus" }, { status: 400 });
      }
      await db.offboardingTask.delete({ where: { id: task.id } });
      await log("Deleted", `Tugas clearance "${task.title}" dihapus dari checklist`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    // ===== INTERVIEW — simpan / ubah form exit interview =====
    if (act === "interview") {
      const form = (b.form ?? {}) as Record<string, unknown>;
      const satisfaction = form.satisfaction == null || form.satisfaction === "" ? null : Number(form.satisfaction);
      if (satisfaction != null && (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5)) {
        return NextResponse.json({ error: "Skor kepuasan harus angka bulat 1–5" }, { status: 400 });
      }
      const clean: ExitInterviewForm = {
        reason: form.reason?.toString().trim() || null,
        nextPlan: form.nextPlan?.toString().trim() || null,
        feedback: form.feedback?.toString().trim() || null,
        satisfaction,
        notes: form.notes?.toString().trim() || null,
      };
      await db.offboarding.update({ where: { id }, data: { exitInterviewJson: JSON.stringify(clean) } });
      await log("Updated", `Form exit interview disimpan${satisfaction != null ? ` (kepuasan ${satisfaction}/5)` : ""}`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    // ===== COMPLETE — tutup proses (semua tugas harus Done/Na) =====
    if (act === "complete") {
      if (ob.status !== "Open") {
        return NextResponse.json({ error: "Hanya proses berjalan (Open) yang bisa ditandai selesai" }, { status: 400 });
      }
      const remaining = ob.tasks.filter((t) => t.status === "Pending").length;
      if (remaining > 0) {
        return NextResponse.json({ error: `Masih ada ${remaining} tugas belum selesai` }, { status: 400 });
      }
      await db.offboarding.update({ where: { id }, data: { status: "Completed", completedAt: new Date() } });
      await log("Completed", `Proses offboarding selesai — seluruh checklist clearance tuntas`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    // ===== CANCEL — batalkan proses (mis. exit dibatalkan / salah buat) =====
    if (act === "cancel") {
      if (ob.status !== "Open") {
        return NextResponse.json({ error: "Hanya proses berjalan (Open) yang bisa dibatalkan" }, { status: 400 });
      }
      const reason = b.reason?.toString().trim() || null;
      await db.offboarding.update({ where: { id }, data: { status: "Cancelled" } });
      await log("Cancelled", `Proses offboarding dibatalkan${reason ? ` — alasan: ${reason}` : ""}`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    // ===== UPDATE — edit dasar (hari terakhir / alasan) =====
    if (act === "update") {
      if (ob.status !== "Open") {
        return NextResponse.json({ error: "Hanya proses berjalan (Open) yang bisa diedit" }, { status: 400 });
      }
      let lastDay: Date | null | undefined = undefined;
      if (b.lastDay !== undefined) {
        lastDay = b.lastDay === null || b.lastDay === "" ? null : new Date(String(b.lastDay));
        if (lastDay != null && Number.isNaN(lastDay.getTime())) {
          return NextResponse.json({ error: "Tanggal hari terakhir tidak valid" }, { status: 400 });
        }
      }
      await db.offboarding.update({
        where: { id },
        data: {
          ...(lastDay !== undefined ? { lastDay } : {}),
          ...(b.reason !== undefined ? { reason: b.reason?.toString().trim() || null } : {}),
        },
      });
      await log("Updated", `Data dasar proses offboarding diubah (hari terakhir/alasan)`);
      return NextResponse.json({ ok: true, offboarding: await buildOffboardingDetail(db, id) });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${act}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/offboarding/[id] — hanya status Cancelled (pembersihan)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:offboarding", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const { id } = await ctx.params;
    const ob = await db.offboarding.findUnique({ where: { id } });
    if (!ob) return NextResponse.json({ error: "Proses offboarding tidak ditemukan" }, { status: 404 });
    if (ob.status !== "Cancelled") {
      return NextResponse.json({ error: "Hanya proses berstatus Dibatalkan yang bisa dihapus" }, { status: 400 });
    }
    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Deleted", entity: "Offboarding", entityId: id, employeeId: ob.employeeId,
        detail: `Proses offboarding (dibatalkan) dihapus dari daftar oleh ${actor.appUsername ?? actor.name}`,
      },
    });
    await db.offboarding.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
