import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { DbOrTx } from "@/rekankerja/human-resource/services/assignment";
import {
  CHECKLIST_DEPARTMENTS, allowedDeptsOf, canTouchDept, deptLabelOf, tenantSlugOf,
} from "@/rekankerja/shared/services/checklist-service";
import { buildOnboardingDetail } from "@/rekankerja/human-resource/api/onboarding-detail";
import { sendChecklistEmails } from "@/rekankerja/shared/services/checklist-email";

// RekanKerja — Onboarding checklist (Task 65): proses penyambutan karyawan baru.
// Mirror Offboarding: daftar + buat manual; OTOMATIS dibuat saat karyawan baru
// dibuat (hook di employees.ts). Email checklist dikirim per bagian (IT/GA/…)
// dengan link checklist publik per bagian; in-app tiap bagian hanya boleh
// mencentang tugasnya sendiri (koordinator Admin/HR bebas).

/** Checklist bawaan onboarding — penyediaan per bagian. */
export const DEFAULT_ONBOARDING_TASKS: { title: string; owner: string }[] = [
  { title: "Penyiapan akun user aplikasi (RekanKerja, email perusahaan)", owner: "IT" },
  { title: "Penyiapan perangkat kerja — laptop & akses sistem", owner: "IT" },
  { title: "Penyiapan meja, kursi & perlengkapan kerja", owner: "GA" },
  { title: "Kartu akses kantor & absensi (finger/face)", owner: "GA" },
  { title: "Kontrak kerja & dokumen kepegawaian ditandatangani", owner: "HR" },
  { title: "Orientasi & intro team (induction)", owner: "Supervisor" },
  { title: "Registrasi BPJS & asuransi", owner: "HR" },
  { title: "Input data payroll — rekening, NPWP, template upah", owner: "Payroll" },
];

export interface CreateOnboardingOpts {
  employeeId: string;
  startDate?: Date | null;
  note?: string | null;
}

/** Buat Onboarding + checklist bawaan (nested create — atomik). Dipakai POST
 *  manual & hook karyawan baru. TIDAK mengirim email (pemanggil yang kirim
 *  setelah commit agar butuh req untuk link publik). */
export async function createOnboardingWithTasks(tx: DbOrTx, opts: CreateOnboardingOpts) {
  return tx.onboarding.create({
    data: {
      employeeId: opts.employeeId,
      startDate: opts.startDate ?? null,
      note: opts.note ?? null,
      status: "Open",
      tasks: {
        create: DEFAULT_ONBOARDING_TASKS.map((task, i) => ({
          seq: i + 1,
          title: task.title,
          owner: task.owner,
          status: "Pending",
        })),
      },
    },
    include: { tasks: { select: { id: true } } },
  });
}

/** Kirim email checklist ke bagian-bagian yang punya tugas (butuh req utk link). */
export async function emailOnboardingChecklist(db: TenantDb, onboardingId: string, req: NextRequest): Promise<number> {
  const detail = await buildOnboardingDetail(db, onboardingId);
  if (!detail) return 0;
  return sendChecklistEmails(db, {
    kind: "onboarding",
    processId: onboardingId,
    tenantSlug: tenantSlugOf(db),
    employee: { fullName: detail.employee.fullName, employeeNo: detail.employee.employeeNo },
    position: detail.position?.title ?? null,
    orgUnit: detail.orgUnit?.name ?? null,
    date: detail.startDate,
    tasks: detail.tasks.map((t) => ({ seq: t.seq, title: t.title, owner: t.owner })),
    req,
  });
}

// GET /api/rekankerja/onboarding?employeeId= — daftar terbaru dulu
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const onboardings = await db.onboarding.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: {
        employee: {
          select: {
            id: true, fullName: true, employeeNo: true, status: true, joinDate: true,
            assignments: {
              where: { validTo: null },
              orderBy: { validFrom: "desc" },
              take: 1,
              include: {
                position: { select: { id: true, title: true } },
                orgUnit: { select: { id: true, name: true } },
              },
            },
          },
        },
        tasks: { select: { status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const rows = onboardings.map((o) => {
      const cur = o.employee.assignments[0] ?? null;
      const { assignments: _a, ...emp } = o.employee as typeof o.employee & { assignments?: unknown[] };
      const done = o.tasks.filter((t) => t.status === "Done").length;
      return {
        id: o.id,
        employeeId: o.employeeId,
        startDate: o.startDate,
        note: o.note,
        status: o.status,
        createdAt: o.createdAt,
        completedAt: o.completedAt,
        employee: { ...emp, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null },
        taskStats: { total: o.tasks.length, done },
      };
    });

    const statusCounts: Record<string, number> = { Open: 0, Completed: 0, Cancelled: 0 };
    for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

    return NextResponse.json({ onboardings: rows, statusCounts, total: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/onboarding — buat proses manual {employeeId, startDate?, note?, sendEmail?}
// → checklist dibuat + email dikirim per bagian yang punya tugas.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.employeeId) return NextResponse.json({ error: "Karyawan wajib dipilih" }, { status: 400 });

    const employee = await db.employee.findUnique({
      where: { id: b.employeeId },
      select: { id: true, fullName: true, employeeNo: true },
    });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 400 });

    // satu proses aktif per karyawan
    const existing = await db.onboarding.findFirst({
      where: { employeeId: b.employeeId, status: "Open" },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Proses onboarding untuk karyawan ini sudah berjalan" }, { status: 400 });
    }

    let startDate: Date | null = null;
    if (b.startDate) {
      startDate = new Date(String(b.startDate));
      if (Number.isNaN(startDate.getTime())) {
        return NextResponse.json({ error: "Tanggal mulai tidak valid" }, { status: 400 });
      }
    }

    const created = await createOnboardingWithTasks(db, {
      employeeId: b.employeeId,
      startDate,
      note: b.note?.trim() ? String(b.note).trim() : null,
    });

    const deptCount = await emailOnboardingChecklist(db, created.id, req);

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created", entity: "Onboarding", entityId: created.id,
        employeeId: b.employeeId,
        detail: `Proses onboarding dibuat untuk ${employee.fullName} (${employee.employeeNo}) oleh ${actor.appUsername ?? actor.name} — ${created.tasks.length} tugas checklist, email ke ${deptCount} bagian`,
      },
    });

    const detail = await buildOnboardingDetail(db, created.id);
    return NextResponse.json({ onboarding: detail }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa karyawan terkait" }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// GET /api/rekankerja/onboarding?meta=depts — daftar bagian + label (UI)
export async function HEAD() {
  return new Response(null, { status: 204 });
}
