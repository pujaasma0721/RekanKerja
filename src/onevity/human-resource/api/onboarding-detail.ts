import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { allowedDeptsOf, canTouchDept, deptLabelOf } from "@/onevity/shared/services/checklist-service";
import { CHECKLIST_DEPARTMENTS } from "@/onevity/shared/services/checklist-service";

// OneVity — Detail onboarding (Task 65): baca + aksi proses (tugas checklist,
// selesai/batal, edit dasar, hapus bila dibatalkan). Otorisasi centang per
// bagian: Admin/HR (koordinator) bebas; role lain (IT/GA/Finance/Supervisor/
// Payroll sebagai role AppUser) hanya boleh mencentang tugas bagiannya.

const TASK_STATUS_LABEL: Record<string, string> = { Done: "Selesai", Pending: "Pending", Na: "N/A" };

/** Susun DTO detail onboarding penuh. */
export async function buildOnboardingDetail(db: TenantDb, id: string) {
  const ob = await db.onboarding.findUnique({
    where: { id },
    include: {
      employee: {
        select: {
          id: true, fullName: true, employeeNo: true, joinDate: true, status: true, email: true,
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

  const completerIds = [...new Set(ob.tasks.map((t) => t.completedById).filter((v): v is string => !!v))];
  const completers = completerIds.length > 0
    ? await db.appUser.findMany({ where: { id: { in: completerIds } }, select: { id: true, fullName: true } })
    : [];
  const nameMap = new Map(completers.map((c) => [c.id, c.fullName]));

  const cur = ob.employee.assignments[0] ?? null;
  const { assignments: _a, ...empRest } = ob.employee as typeof ob.employee & { assignments?: unknown[] };
  const employee = { ...empRest, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null, grade: cur?.grade ?? null };

  const tasks = ob.tasks.map((t) => ({
    ...t,
    ownerLabel: t.owner ? deptLabelOf(t.owner) : null,
    completedByName: t.completedById ? nameMap.get(t.completedById) ?? null : null,
  }));
  const done = tasks.filter((t) => t.status === "Done").length;
  const na = tasks.filter((t) => t.status === "Na").length;

  return {
    id: ob.id,
    employeeId: ob.employeeId,
    startDate: ob.startDate,
    note: ob.note,
    status: ob.status,
    createdAt: ob.createdAt,
    completedAt: ob.completedAt,
    updatedAt: ob.updatedAt,
    employee,
    position: cur?.position ?? null,
    orgUnit: cur?.orgUnit ?? null,
    tasks,
    taskStats: { total: tasks.length, done, pending: tasks.length - done - na, na },
  };
}

// GET /api/onevity/onboarding/[id] — detail penuh (+ meta bagian utk UI)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { id } = await ctx.params;
    const detail = await buildOnboardingDetail(m.db, id);
    if (!detail) return NextResponse.json({ error: "Proses onboarding tidak ditemukan" }, { status: 404 });

    const allowed = allowedDeptsOf({ role: m.actor.role, appUserRole: m.actor.appUserRole });
    return NextResponse.json({
      onboarding: detail,
      viewer: {
        // null = koordinator (bebas); [] = view-only; [dept] = hanya bagiannya
        allowedDepts: allowed,
        canComplete: allowed === null,
      },
      departments: CHECKLIST_DEPARTMENTS,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/onboarding/[id] — aksi: task | addTask | removeTask | complete | cancel | update | resendEmail
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const actorLabel = actor.appUsername ?? actor.name;

    const { id } = await ctx.params;
    const b = await req.json();
    const act = b.action as string;

    const ob = await db.onboarding.findUnique({ where: { id }, include: { tasks: true } });
    if (!ob) return NextResponse.json({ error: "Proses onboarding tidak ditemukan" }, { status: 404 });

    const log = (action: string, detail: string) =>
      db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action, entity: "Onboarding", entityId: id, employeeId: ob.employeeId,
          detail: `${detail} oleh ${actorLabel}`,
        },
      });

    const frozen = () =>
      NextResponse.json({ error: "Proses sudah selesai/dibatalkan — data tidak bisa diubah" }, { status: 400 });
    if (ob.status !== "Open" && ["task", "addTask", "removeTask", "update"].includes(act)) {
      return frozen();
    }

    // ===== TASK — centang/buka-centang/N-A satu tugas =====
    if (act === "task") {
      const task = ob.tasks.find((t) => t.id === b.taskId);
      if (!task) return NextResponse.json({ error: "Tugas tidak ditemukan pada proses ini" }, { status: 404 });
      if (!canTouchDept({ role: m.actor.role, appUserRole: m.actor.appUserRole }, task.owner)) {
        return NextResponse.json(
          { error: `Tugas ini milik bagian ${deptLabelOf(task.owner)} — hanya bagian tersebut (atau Admin/HR) yang bisa mengubah` },
          { status: 403 },
        );
      }
      const status = String(b.status ?? "");
      if (!["Done", "Pending", "Na"].includes(status)) {
        return NextResponse.json({ error: "Status tugas tidak valid (Done/Pending/Na)" }, { status: 400 });
      }
      await db.onboardingTask.update({
        where: { id: task.id },
        data: {
          status,
          completedAt: status === "Done" ? task.completedAt ?? new Date() : null,
          completedById: status === "Done" ? task.completedById ?? actor.appUserId : null,
          ...(b.notes !== undefined ? { notes: b.notes?.trim() ? String(b.notes).trim() : null } : {}),
        },
      });
      // semua tugas selesai → status otomatis Completed + email ke HR
      const after = await db.onboardingTask.findMany({ where: { onboardingId: id }, select: { status: true } });
      const remaining = after.filter((t) => t.status === "Pending").length;
      if (remaining === 0 && ob.status === "Open") {
        await db.onboarding.update({ where: { id }, data: { status: "Completed", completedAt: new Date() } });
        await notifyCompleted(db, id);
        await log("Completed", `Tugas \"${task.title}\" → ${TASK_STATUS_LABEL[status]}; checklist onboarding TUNTAS (otomatis selesai)`);
      } else {
        await log("Updated", `Tugas \"${task.title}\" → ${TASK_STATUS_LABEL[status] ?? status}`);
      }
      return NextResponse.json({ ok: true, onboarding: await buildOnboardingDetail(db, id) });
    }

    // ===== ADD TASK =====
    if (act === "addTask") {
      if (!canTouchDept({ role: m.actor.role, appUserRole: m.actor.appUserRole }, b.owner ?? null) && !isCoordinatorOf(m.actor)) {
        return NextResponse.json({ error: "Hanya koordinator (Admin/HR) yang bisa menambah tugas" }, { status: 403 });
      }
      const title = String(b.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "Judul tugas wajib diisi" }, { status: 400 });
      const owner = b.owner ? String(b.owner) : null;
      const maxSeq = ob.tasks.reduce((mx, t) => Math.max(mx, t.seq), 0);
      await db.onboardingTask.create({
        data: { onboardingId: id, seq: maxSeq + 1, title, owner, status: "Pending" },
      });
      await log("Updated", `Tugas tambahan \"${title}\"${owner ? ` (${deptLabelOf(owner)})` : ""} ditambahkan`);
      return NextResponse.json({ ok: true, onboarding: await buildOnboardingDetail(db, id) });
    }

    // ===== REMOVE TASK =====
    if (act === "removeTask") {
      const task = ob.tasks.find((t) => t.id === b.taskId);
      if (!task) return NextResponse.json({ error: "Tugas tidak ditemukan pada proses ini" }, { status: 404 });
      if (!isCoordinatorOf(m.actor)) {
        return NextResponse.json({ error: "Hanya koordinator (Admin/HR) yang bisa menghapus tugas" }, { status: 403 });
      }
      if (task.status !== "Pending") {
        return NextResponse.json({ error: "Hanya tugas berstatus Pending yang bisa dihapus" }, { status: 400 });
      }
      await db.onboardingTask.delete({ where: { id: task.id } });
      await log("Deleted", `Tugas \"${task.title}\" dihapus dari checklist`);
      return NextResponse.json({ ok: true, onboarding: await buildOnboardingDetail(db, id) });
    }

    // ===== RESEND EMAIL — kirim ulang checklist ke bagian (mis. ada tugas baru) =====
    if (act === "resendEmail") {
      if (!isCoordinatorOf(m.actor)) {
        return NextResponse.json({ error: "Hanya koordinator (Admin/HR) yang bisa mengirim ulang email" }, { status: 403 });
      }
      const { emailOnboardingChecklist } = await import("@/onevity/human-resource/api/onboarding");
      const sent = await emailOnboardingChecklist(db, id, req);
      await log("Updated", `Email checklist onboarding dikirim ulang ke ${sent} bagian`);
      return NextResponse.json({ ok: true, sent, onboarding: await buildOnboardingDetail(db, id) });
    }

    // ===== COMPLETE — tutup manual (semua tugas Done/Na) =====
    if (act === "complete") {
      if (!isCoordinatorOf(m.actor)) {
        return NextResponse.json({ error: "Hanya koordinator (Admin/HR) yang bisa menandai selesai" }, { status: 403 });
      }
      if (ob.status !== "Open") {
        return NextResponse.json({ error: "Hanya proses berjalan (Open) yang bisa ditandai selesai" }, { status: 400 });
      }
      const remaining = ob.tasks.filter((t) => t.status === "Pending").length;
      if (remaining > 0) {
        return NextResponse.json({ error: `Masih ada ${remaining} tugas belum selesai` }, { status: 400 });
      }
      await db.onboarding.update({ where: { id }, data: { status: "Completed", completedAt: new Date() } });
      await notifyCompleted(db, id);
      await log("Completed", `Proses onboarding selesai — seluruh checklist tuntas`);
      return NextResponse.json({ ok: true, onboarding: await buildOnboardingDetail(db, id) });
    }

    // ===== CANCEL =====
    if (act === "cancel") {
      if (!isCoordinatorOf(m.actor)) {
        return NextResponse.json({ error: "Hanya koordinator (Admin/HR) yang bisa membatalkan" }, { status: 403 });
      }
      if (ob.status !== "Open") {
        return NextResponse.json({ error: "Hanya proses berjalan (Open) yang bisa dibatalkan" }, { status: 400 });
      }
      await db.onboarding.update({ where: { id }, data: { status: "Cancelled" } });
      await log("Cancelled", `Proses onboarding dibatalkan`);
      return NextResponse.json({ ok: true, onboarding: await buildOnboardingDetail(db, id) });
    }

    // ===== UPDATE — edit dasar (tanggal mulai / catatan) =====
    if (act === "update") {
      if (ob.status !== "Open") return frozen();
      let startDate: Date | null | undefined = undefined;
      if (b.startDate !== undefined) {
        startDate = b.startDate === null || b.startDate === "" ? null : new Date(String(b.startDate));
        if (startDate != null && Number.isNaN(startDate.getTime())) {
          return NextResponse.json({ error: "Tanggal mulai tidak valid" }, { status: 400 });
        }
      }
      await db.onboarding.update({
        where: { id },
        data: {
          ...(startDate !== undefined ? { startDate } : {}),
          ...(b.note !== undefined ? { note: b.note?.toString().trim() || null } : {}),
        },
      });
      await log("Updated", `Data dasar proses onboarding diubah (tanggal mulai/catatan)`);
      return NextResponse.json({ ok: true, onboarding: await buildOnboardingDetail(db, id) });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${act}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

/** Koordinator? (pemakaian lokal — ambil role dari MenuActor) */
function isCoordinatorOf(actor: { role: string; appUserRole: string | null }): boolean {
  return ["OWNER", "ADMIN"].includes(actor.role) || actor.appUserRole === "Admin";
}

// DELETE /api/onevity/onboarding/[id] — hanya status Cancelled
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const { id } = await ctx.params;
    const ob = await db.onboarding.findUnique({ where: { id } });
    if (!ob) return NextResponse.json({ error: "Proses onboarding tidak ditemukan" }, { status: 404 });
    if (ob.status !== "Cancelled") {
      return NextResponse.json({ error: "Hanya proses berstatus Dibatalkan yang bisa dihapus" }, { status: 400 });
    }
    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Deleted", entity: "Onboarding", entityId: id, employeeId: ob.employeeId,
        detail: `Proses onboarding (dibatalkan) dihapus dari daftar oleh ${actor.appUsername ?? actor.name}`,
      },
    });
    await db.onboarding.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ---------- email ke HR saat checklist tuntas ----------

async function notifyCompleted(db: TenantDb, id: string): Promise<void> {
  const { notifyEmailEvent, approverEmailsOf } = await import("@/onevity/shared/services/email-service");
  const detail = await buildOnboardingDetail(db, id);
  if (!detail) return;
  const to = await approverEmailsOf(db);
  if (to.length === 0) return;
  notifyEmailEvent(db, {
    event: "onboarding.completed",
    to,
    data: {
      nama: detail.employee.fullName,
      employeeNo: detail.employee.employeeNo,
      posisi: detail.position?.title ?? "-",
      unit: detail.orgUnit?.name ?? "-",
    },
  });
}
