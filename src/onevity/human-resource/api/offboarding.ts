import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import type { DbOrTx } from "@/onevity/human-resource/services/assignment";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { buildOffboardingDetail } from "@/onevity/human-resource/api/offboarding-detail";
import { sendChecklistEmails } from "@/onevity/shared/services/checklist-email";
import { tenantSlugOf } from "@/onevity/shared/services/checklist-service";

// OneVity — Offboarding (proses karyawan keluar): daftar + buat manual.
// Checklist clearance + exit interview + pelacakan penyelesaian. Proses juga
// dibuat OTOMATIS saat Personnel Action Resignation/Termination/Retirement
// diproses (hook di personnel-actions-detail.ts → createOffboardingWithTasks).

/** Checklist clearance bawaan (per fungsi pemilik tugas) — dibuat saat proses
 *  offboarding baru; HR dapat menambah/menghapus tugas sesuai kondisi. */
export const DEFAULT_OFFBOARDING_TASKS: { title: string; owner: string }[] = [
  { title: "Serah terima pekerjaan & dokumen (handover)", owner: "Supervisor" },
  { title: "Pengembalian aset IT — laptop & perangkat", owner: "IT" },
  { title: "Penonaktifan akses sistem, email & akun aplikasi", owner: "IT" },
  { title: "Clearance keuangan — kasbon, pinjaman karyawan, piutang", owner: "Finance" },
  { title: "Pengembalian kartu akses, seragam & aset kantor", owner: "GA" },
  { title: "Administrasi BPJS & asuransi (penghentian iuran)", owner: "HR" },
  // Task 52-c — JKP (PP 6/2025): pekerja yang di-PHK berhak manfaat JKP;
  // perusahaan WAJIB menerbitkan surat keterangan PHK + daftar upah (syarat
  // klaim ke BPJS Ketenagakerjaan). Non-PHK (resign/mundur) → tandai Na.
  { title: "Terbitkan surat keterangan PHK & daftar upah utk klaim JKP (BPJS Ketenagakerjaan — PP 6/2025)", owner: "HR" },
  { title: "Exit interview", owner: "HR" },
  { title: "Slip final settlement & surat keterangan kerja", owner: "Payroll" },
  { title: "Arsip dokumen kepegawaian & tanda tangan berita acara", owner: "HR" },
];

export interface CreateOffboardingOpts {
  employeeId: string;
  /** PA sumber (plain string — tanpa FK, ditampilkan sebagai docNo). */
  personnelActionId?: string | null;
  lastDay?: Date | null;
  reason?: string | null;
}

/** Buat Offboarding + checklist bawaan (seq 1..n) dalam SATU create Prisma
 *  (nested create tasks — atomik). Dipakai POST manual & hook PA exit.
 *  Task 27-b: bila karyawan masih memegang aset aktif, SATU tugas clearance
 *  tambahan "Kembalikan aset perusahaan (N item)" owner GA ditambahkan
 *  setelah tugas bawaan — additive & tidak mengubah checklist lama. */
export async function createOffboardingWithTasks(tx: DbOrTx, opts: CreateOffboardingOpts) {
  // aset belum dikembalikan (penugasan aktif) → tugas GA dgn jumlah item
  const outstandingAssets = await tx.assetAssignment.count({
    where: { employeeId: opts.employeeId, returnedAt: null },
  });
  const tasks = [...DEFAULT_OFFBOARDING_TASKS];
  if (outstandingAssets > 0) {
    tasks.push({ title: `Kembalikan aset perusahaan (${outstandingAssets} item)`, owner: "GA" });
  }
  return tx.offboarding.create({
    data: {
      employeeId: opts.employeeId,
      personnelActionId: opts.personnelActionId ?? null,
      lastDay: opts.lastDay ?? null,
      reason: opts.reason ?? null,
      status: "Open",
      tasks: {
        create: tasks.map((task, i) => ({
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

// GET /api/onevity/offboarding?employeeId= — daftar terbaru dulu
// (employeeId dipakai banner profil karyawan: proses berjalan?).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offboarding", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const offboardings = await db.offboarding.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: {
        employee: {
          select: {
            id: true, fullName: true, employeeNo: true, status: true,
            // posisi/unit saat ini dari assignment aktif
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

    // PA sumber — personnelActionId plain string (tanpa FK) → resolve manual
    const paIds = [...new Set(offboardings.map((o) => o.personnelActionId).filter((v): v is string => !!v))];
    const sourcePAs = paIds.length > 0
      ? await db.personnelAction.findMany({ where: { id: { in: paIds } }, select: { id: true, docNo: true, type: true } })
      : [];
    const paMap = new Map(sourcePAs.map((p) => [p.id, p]));

    const rows = offboardings.map((o) => {
      const cur = o.employee.assignments[0] ?? null;
      const { assignments: _a, ...emp } = o.employee as typeof o.employee & { assignments?: unknown[] };
      const done = o.tasks.filter((t) => t.status === "Done").length;
      return {
        id: o.id,
        employeeId: o.employeeId,
        personnelActionId: o.personnelActionId,
        lastDay: o.lastDay,
        reason: o.reason,
        status: o.status,
        createdAt: o.createdAt,
        completedAt: o.completedAt,
        employee: { ...emp, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null },
        sourcePA: o.personnelActionId ? paMap.get(o.personnelActionId) ?? null : null,
        taskStats: { total: o.tasks.length, done },
      };
    });

    const statusCounts: Record<string, number> = { Open: 0, Completed: 0, Cancelled: 0 };
    for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

    return NextResponse.json({ offboardings: rows, statusCounts, total: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

/** Kirim email checklist clearance per bagian (Task 65 — mirror onboarding). */
export async function emailOffboardingChecklist(db: TenantDb, offboardingId: string, req: NextRequest): Promise<number> {
  const detail = await buildOffboardingDetail(db, offboardingId);
  if (!detail) return 0;
  return sendChecklistEmails(db, {
    kind: "offboarding",
    processId: offboardingId,
    tenantSlug: tenantSlugOf(db),
    employee: { fullName: detail.employee.fullName, employeeNo: detail.employee.employeeNo },
    position: detail.employee.position?.title ?? null,
    orgUnit: detail.employee.orgUnit?.name ?? null,
    date: detail.lastDay,
    tasks: detail.tasks.map((t) => ({ seq: t.seq, title: t.title, owner: t.owner })),
    req,
  });
}

// POST /api/onevity/offboarding — buat proses manual {employeeId, lastDay?, reason?}
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:offboarding", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.employeeId) return NextResponse.json({ error: "Karyawan wajib dipilih" }, { status: 400 });

    const employee = await db.employee.findUnique({
      where: { id: b.employeeId },
      select: { id: true, fullName: true, employeeNo: true },
    });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 400 });

    // satu proses aktif per karyawan (hindari checklist ganda)
    const existing = await db.offboarding.findFirst({
      where: { employeeId: b.employeeId, status: "Open" },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Proses offboarding untuk karyawan ini sudah berjalan" }, { status: 400 });
    }

    let lastDay: Date | null = null;
    if (b.lastDay) {
      lastDay = new Date(String(b.lastDay));
      if (Number.isNaN(lastDay.getTime())) {
        return NextResponse.json({ error: "Tanggal hari terakhir tidak valid" }, { status: 400 });
      }
    }

    const created = await createOffboardingWithTasks(db, {
      employeeId: b.employeeId,
      lastDay,
      reason: b.reason?.trim() ? String(b.reason).trim() : null,
    });

    // Task 65 — email checklist clearance ke tiap bagian yang punya tugas
    const deptCount = await emailOffboardingChecklist(db, created.id, req);

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created", entity: "Offboarding", entityId: created.id,
        employeeId: b.employeeId,
        detail: `Proses offboarding dibuat untuk ${employee.fullName} (${employee.employeeNo}) oleh ${actor.appUsername ?? actor.name} — ${created.tasks.length} tugas clearance, email ke ${deptCount} bagian`,
      },
    });

    // respons = detail penuh (langsung dipakai UI untuk navigasi ke detail)
    const detail = await buildOffboardingDetail(db, created.id);
    return NextResponse.json({ offboarding: detail }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa karyawan terkait" }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
