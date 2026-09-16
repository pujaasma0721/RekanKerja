import { NextRequest, NextResponse } from "next/server";
import { verifyChecklistToken } from "@/onevity/shared/services/checklist-service";
import { notifyEmailEvent, approverEmailsOf } from "@/onevity/shared/services/email-service";
import { getTenantClient, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { db as platformDb } from "@/lib/db";

// OneVity — Checklist publik via token (Task 65) ========================
// Link di email checklist mengarah ke sini: token HMAC (kind.processId.dept.mac)
// membuka SATU proses + SATU bagian. Penerima email melihat daftar tugas
// bagiannya & mencentang Done/Na tanpa login — token tidak bisa memodifikasi
// bagian lain (diverifikasi server per request).
// =====================================================================

async function resolveTenant(tenantSlug: string) {
  return platformDb.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { schemaName: true },
  });
}

interface ProcRead {
  status: string;
  employee: { fullName: string; employeeNo: string };
}

/** Baca proses + tugas bagian (branching eksplisit — union model tidak callable). */
async function readProcess(db: TenantDb, kind: "onboarding" | "offboarding", processId: string, dept: string) {
  if (kind === "onboarding") {
    const proc = await db.onboarding.findUnique({
      where: { id: processId },
      select: {
        status: true, startDate: true,
        employee: { select: { fullName: true, employeeNo: true } },
        tasks: { orderBy: { seq: "asc" }, select: { id: true, seq: true, title: true, owner: true, status: true, notes: true, completedAt: true } },
      },
    });
    if (!proc) return null;
    return {
      status: proc.status,
      date: proc.startDate as Date | null,
      employee: proc.employee as ProcRead["employee"],
      tasks: proc.tasks.filter((t) => t.owner === dept).map((t) => ({ id: t.id, seq: t.seq, title: t.title, status: t.status, notes: t.notes, completedAt: t.completedAt })),
    };
  }
  const proc = await db.offboarding.findUnique({
    where: { id: processId },
    select: {
      status: true, lastDay: true,
      employee: { select: { fullName: true, employeeNo: true } },
      tasks: { orderBy: { seq: "asc" }, select: { id: true, seq: true, title: true, owner: true, status: true, notes: true, completedAt: true } },
    },
  });
  if (!proc) return null;
  return {
    status: proc.status,
    date: proc.lastDay as Date | null,
    employee: proc.employee as ProcRead["employee"],
    tasks: proc.tasks.filter((t) => t.owner === dept).map((t) => ({ id: t.id, seq: t.seq, title: t.title, status: t.status, notes: t.notes, completedAt: t.completedAt })),
  };
}

// GET /api/public/checklist?token=…&t=slug — baca checklist bagian
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const tenantSlug = req.nextUrl.searchParams.get("t") ?? "";
    const p = verifyChecklistToken(token);
    if (!p.ok || !tenantSlug) {
      return NextResponse.json({ error: "Tautan tidak valid" }, { status: 400 });
    }
    const tenant = await resolveTenant(tenantSlug);
    if (!tenant) return NextResponse.json({ error: "Tenant tidak dikenal" }, { status: 404 });
    const db = getTenantClient(tenant.schemaName);

    const proc = await readProcess(db, p.kind, p.processId, p.dept);
    if (!proc) return NextResponse.json({ error: "Proses tidak ditemukan" }, { status: 404 });

    return NextResponse.json({
      kind: p.kind,
      dept: p.dept,
      status: proc.status,
      date: proc.date,
      employee: proc.employee,
      tasks: proc.tasks,
      canEdit: proc.status === "Open",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/public/checklist — centang tugas {token, tenant, taskId, status, notes?}
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const p = verifyChecklistToken(String(b.token ?? ""));
    const tenantSlug = String(b.tenant ?? "");
    if (!p.ok || !tenantSlug) {
      return NextResponse.json({ error: "Tautan tidak valid" }, { status: 400 });
    }
    const tenant = await resolveTenant(tenantSlug);
    if (!tenant) return NextResponse.json({ error: "Tenant tidak dikenal" }, { status: 404 });
    const db = getTenantClient(tenant.schemaName);

    const status = String(b.status ?? "");
    if (!["Done", "Pending", "Na"].includes(status)) {
      return NextResponse.json({ error: "Status tidak valid (Done/Pending/Na)" }, { status: 400 });
    }
    const taskId = String(b.taskId ?? "");

    // proses harus masih Open
    const proc = await readProcess(db, p.kind, p.processId, p.dept);
    if (!proc) return NextResponse.json({ error: "Proses tidak ditemukan" }, { status: 404 });
    if (proc.status !== "Open") {
      return NextResponse.json({ error: "Proses sudah selesai/dibatalkan — tidak bisa diubah" }, { status: 400 });
    }
    // token hanya berlaku utk tugas bagian sendiri
    if (!proc.tasks.some((t) => t.id === taskId)) {
      return NextResponse.json({ error: "Tugas tidak termasuk bagian Anda" }, { status: 403 });
    }

    if (p.kind === "onboarding") {
      await db.onboardingTask.update({
        where: { id: taskId },
        data: {
          status,
          completedAt: status === "Done" ? new Date() : null,
          completedById: null,
          completedVia: `email:${p.dept}`,
          notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : undefined,
        },
      });
      // semua tugas tuntas → auto-complete + email ke HR
      const all = await db.onboardingTask.findMany({ where: { onboardingId: p.processId }, select: { status: true } });
      if (all.length > 0 && all.every((t) => t.status !== "Pending")) {
        await db.onboarding.update({ where: { id: p.processId }, data: { status: "Completed", completedAt: new Date() } });
        await notifyChecklistCompleted(db, "onboarding", p.processId);
      }
    } else {
      await db.offboardingTask.update({
        where: { id: taskId },
        data: {
          status,
          completedAt: status === "Done" ? new Date() : null,
          completedById: null,
          completedVia: `email:${p.dept}`,
          notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : undefined,
        },
      });
      const all = await db.offboardingTask.findMany({ where: { offboardingId: p.processId }, select: { status: true } });
      if (all.length > 0 && all.every((t) => t.status !== "Pending")) {
        await db.offboarding.update({ where: { id: p.processId }, data: { status: "Completed", completedAt: new Date() } });
        await notifyChecklistCompleted(db, "offboarding", p.processId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

/** Email "checklist selesai" ke approver/HR (dipakai jalur publik & in-app). */
export async function notifyChecklistCompleted(db: TenantDb, kind: "onboarding" | "offboarding", processId: string): Promise<void> {
  try {
    const read = kind === "onboarding"
      ? await db.onboarding.findUnique({
          where: { id: processId },
          select: { status: true, employee: { select: { fullName: true, employeeNo: true } } },
        })
      : await db.offboarding.findUnique({
          where: { id: processId },
          select: { status: true, employee: { select: { fullName: true, employeeNo: true } } },
        });
    if (!read || read.status !== "Completed") return;
    const to = await approverEmailsOf(db);
    if (to.length === 0) return;
    notifyEmailEvent(db, {
      event: kind === "onboarding" ? "onboarding.completed" : "offboarding.completed",
      to,
      data: { nama: read.employee.fullName, employeeNo: read.employee.employeeNo, posisi: "-", unit: "-" },
    });
  } catch {
    // fire-and-forget — email kegagalan tidak pernah menggagalkan alur utama
  }
}
