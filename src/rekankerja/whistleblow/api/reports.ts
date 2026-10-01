// RekanKerja — Whistleblowing triase (Task 52-f) ==============================
// =====================================================================
// GET   /api/rekankerja/whistleblowing/reports — daftar laporan + statistik
//       (guard menu whistleblowing:triage view — tim penangan berwenang).
// PATCH /api/rekankerja/whistleblowing/reports — aksi penanganan:
//       { id, action: "receive" | "investigate" | "resolve" | "close"
//         | "assign" | "note", note?, assignedToId?, resolutionNote? }
//       Guard: aksi assign → op "assign"; aksi lain → op "decide"
//       (menu-perms whistleblowing:triage). Semua mutasi tercatat di
//       ActivityLog (action Updated, entity WhistleblowReport).
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

const STATUSES = ["Baru", "Diterima", "Investigasi", "Selesai", "Ditutup"] as const;

const REPORT_SELECT = {
  id: true, ticketNo: true, category: true, channel: true, description: true,
  incidentDate: true, location: true, involvedHint: true, anonymous: true,
  reporterEmployeeId: true, reporterContact: true, status: true,
  assignedToId: true, followUpNote: true, resolutionNote: true,
  createdAt: true, updatedAt: true,
} as const;

// GET — daftar + statistik status/kategori.
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "whistleblowing:triage", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status")?.trim() || undefined;
    const category = sp.get("category")?.trim() || undefined;

    const [reports, byStatusRows, byCategoryRows] = await Promise.all([
      db.whistleblowReport.findMany({
        where: {
          ...(status && status !== "all" ? { status } : {}),
          ...(category && category !== "all" ? { category } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: REPORT_SELECT,
      }),
      db.whistleblowReport.groupBy({ by: ["status"], _count: { _all: true } }),
      db.whistleblowReport.groupBy({ by: ["category"], _count: { _all: true } }),
    ]);

    // penangan (assignedTo) + pelapor non-anonim → nama (AppUser/AppUser of employee)
    const assigneeIds = [...new Set(reports.map((r) => r.assignedToId).filter((v): v is string => !!v))];
    const [assignees, reporterEmployees] = await Promise.all([
      assigneeIds.length
        ? db.appUser.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, username: true, role: true } })
        : Promise.resolve([] as { id: string; username: string | null; role: string }[]),
      db.employee.findMany({
        where: { id: { in: reports.map((r) => r.reporterEmployeeId).filter((v): v is string => !!v) } },
        select: { id: true, fullName: true, employeeNo: true },
      }),
    ]);
    // kandidat penangan: AppUser aktif peran penangan (Admin/HR/Owner)
    const handlers = await db.appUser.findMany({
      where: { active: true, role: { in: ["Admin", "HR Manager", "HR Staff", "Owner"] } },
      select: { id: true, username: true, role: true },
      orderBy: { username: "asc" },
      take: 50,
    });

    const assigneeName = new Map(assignees.map((a) => [a.id, a.username ?? a.role]));
    const reporterName = new Map(reporterEmployees.map((e) => [e.id, `${e.fullName} (${e.employeeNo})`]));

    return NextResponse.json({
      reports: reports.map((r) => ({
        ...r,
        assignedToName: r.assignedToId ? assigneeName.get(r.assignedToId) ?? null : null,
        reporterName: r.anonymous ? null : r.reporterEmployeeId ? reporterName.get(r.reporterEmployeeId) ?? null : null,
      })),
      stats: {
        byStatus: Object.fromEntries(byStatusRows.map((s) => [s.status, s._count._all])),
        byCategory: Object.fromEntries(byCategoryRows.map((c) => [c.category, c._count._all])),
        total: byStatusRows.reduce((sum, s) => sum + s._count._all, 0),
      },
      handlers: handlers.map((h) => ({ id: h.id, label: h.username ?? h.role, role: h.role })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — aksi penanganan (status flow + penugasan + catatan).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");
    const menuOp = action === "assign" ? "op:assign" : "op:decide";
    const m = await requireMenuAction(req, "whistleblowing:triage", menuOp as `op:${string}`);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.whistleblowReport.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Laporan tidak ditemukan" }, { status: 404 });
    if (existing.status === "Selesai" || existing.status === "Ditutup") {
      return NextResponse.json({ error: `Laporan sudah ${existing.status.toLowerCase()} — tidak dapat diubah lagi` }, { status: 409 });
    }

    const data: Record<string, unknown> = {};
    let detail = "";
    switch (action) {
      case "assign": {
        const assignedToId = String(b.assignedToId ?? "");
        if (!assignedToId) return NextResponse.json({ error: "assignedToId wajib" }, { status: 400 });
        const handler = await db.appUser.findUnique({ where: { id: assignedToId }, select: { id: true, username: true } });
        if (!handler) return NextResponse.json({ error: "Penangan tidak ditemukan" }, { status: 404 });
        data.assignedToId = assignedToId;
        if (existing.status === "Baru") data.status = "Diterima";
        detail = `Laporan ${existing.ticketNo} ditugaskan kepada ${handler.username ?? handler.id}`;
        break;
      }
      case "receive": {
        if (existing.status !== "Baru") return NextResponse.json({ error: "Hanya laporan berstatus Baru yang bisa diterima" }, { status: 409 });
        data.status = "Diterima";
        detail = `Laporan ${existing.ticketNo} DITERIMA — mulai penanganan`;
        break;
      }
      case "investigate": {
        if (existing.status !== "Diterima") return NextResponse.json({ error: "Terima laporan dulu sebelum investigasi" }, { status: 409 });
        data.status = "Investigasi";
        detail = `Laporan ${existing.ticketNo} masuk INVESTIGASI`;
        break;
      }
      case "resolve": {
        if (existing.status !== "Investigasi") return NextResponse.json({ error: "Laporan harus berstatus Investigasi sebelum diselesaikan" }, { status: 409 });
        const resolutionNote = String(b.resolutionNote ?? "").trim();
        if (resolutionNote.length < 10) {
          return NextResponse.json({ error: "Catatan hasil penyelesaian minimal 10 karakter" }, { status: 400 });
        }
        data.status = "Selesai";
        data.resolutionNote = resolutionNote;
        detail = `Laporan ${existing.ticketNo} SELESAI — ${resolutionNote.slice(0, 200)}`;
        break;
      }
      case "close": {
        const reason = String(b.note ?? "").trim();
        if (reason.length < 10) {
          return NextResponse.json({ error: "Alasan penutupan minimal 10 karakter (laporan ditutup tanpa tindak lanjut — wajib beralasan)" }, { status: 400 });
        }
        data.status = "Ditutup";
        data.resolutionNote = `Ditutup: ${reason}`;
        detail = `Laporan ${existing.ticketNo} DITUTUP — ${reason.slice(0, 200)}`;
        break;
      }
      case "note": {
        const note = String(b.note ?? "").trim();
        if (!note) return NextResponse.json({ error: "Catatan kosong" }, { status: 400 });
        data.followUpNote = note;
        detail = `Catatan tindak lanjut laporan ${existing.ticketNo}: ${note.slice(0, 200)}`;
        break;
      }
      default:
        return NextResponse.json({ error: "action tidak dikenal (receive|investigate|resolve|close|assign|note)" }, { status: 400 });
    }

    const updated = await db.whistleblowReport.update({
      where: { id },
      data,
      select: REPORT_SELECT,
    });
    // Jejak triase — aktor dicatat (penangan, BUKAN pelapor; laporan anonim
    // tetap anonim: detail log tidak memuat identitas pelapor).
    await db.activityLog.create({
      data: {
        action: "Updated",
        entity: "WhistleblowReport",
        entityId: existing.ticketNo,
        appUserId: actor.appUserId ?? undefined,
        detail: `${detail} — oleh ${actor.appUsername ?? actor.name}`,
      },
    });

    return NextResponse.json({ report: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
