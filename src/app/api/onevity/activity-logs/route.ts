import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { toCsv, csvResponse, exportFilename, type ExportColumn, type ExportCell } from "@/onevity/shared/lib/export";

// GET /api/onevity/activity-logs — VIEWER AUDIT TRAIL (26-b P0) ================
// =====================================================================
// Data ActivityLog sudah dikumpulkan 12+ API (Created/Updated/Deleted/
// Approved/Processed/Warning/…) tapi tidak pernah punya UI. Endpoint ini
// membaliknya: jejak audit jadi data yang bisa ditelusuri manusia.
//
//   ?employeeId=  filter per karyawan (opsional — join nama & no)
//   ?action=      Created|Updated|Deleted|Submitted|Approved|Rejected|…
//   ?entity=      Employee|PayrollRun|PersonnelAction|…
//   ?q=           cari bebas di kolom detail
//   ?from=&to=    rentang tanggal (yyyy-mm-dd, inklusif)
//   ?limit=&offset=  paginasi (default 50, max 200)
//   ?export=csv   unduh CSV (guard op:export menu settings:audit)
//
// Guard: menu settings:audit aksi view (per pengguna — Task 32).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:audit", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db } = m;

    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";
    const employeeId = sp.get("employeeId")?.trim() ?? "";
    const action = sp.get("action")?.trim() ?? "";
    const entity = sp.get("entity")?.trim() ?? "";
    const from = sp.get("from")?.trim() ?? "";
    const to = sp.get("to")?.trim() ?? "";
    const isExport = sp.get("export") === "csv";
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);

    const where: Record<string, unknown> = {};
    if (action && action !== "all") where.action = action;
    if (entity && entity !== "all") where.entity = entity;
    if (employeeId && employeeId !== "all") where.employeeId = employeeId;
    if (q) where.detail = { contains: q };
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
      };
    }

    const include = {
      employee: { select: { employeeNo: true, fullName: true } },
      appUser: { select: { username: true, fullName: true } },
    };

    // ---------- ekspor CSV (seluruh hasil filter, maks 5000 baris) ----------
    if (isExport) {
      // ekspor = operasi menu sendiri (guard kedua, op:export)
      const g = await requireMenuAction(req, "settings:audit", "op:export");
      if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

      const rows = await g.db.activityLog.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      await g.db.activityLog.create({
        data: {
          action: "Exported", entity: "ActivityLog",
          appUserId: g.actor.appUserId ?? undefined,
          detail: `Ekspor CSV log aktivitas (${rows.length} baris) oleh ${g.actor.appUsername ?? g.actor.name}`,
        },
      }).catch(() => { /* log tidak boleh menggagalkan ekspor */ });

      const columns: ExportColumn[] = [
        { header: "Waktu", width: 20 },
        { header: "Aktor", width: 18 },
        { header: "Karyawan", width: 22 },
        { header: "Aksi", width: 12 },
        { header: "Entitas", width: 22 },
        { header: "Ref ID", width: 28 },
        { header: "Detail", width: 90 },
      ];
      const data: ExportCell[][] = rows.map((r) => [
        r.createdAt.toISOString().replace("T", " ").slice(0, 19),
        r.actorType === "system" ? "SISTEM" : (r.appUser?.username ?? r.appUser?.fullName ?? "-"),
        r.employee ? `${r.employee.fullName} (${r.employee.employeeNo})` : "-",
        r.action,
        r.entity,
        r.entityId ?? "-",
        r.detail ?? "",
      ]);
      return csvResponse(toCsv(columns, data), exportFilename("log-aktivitas", "csv"));
    }

    // ---------- halaman biasa: data + agregat filter ----------
    const [logs, total, actionAgg, entityAgg] = await Promise.all([
      db.activityLog.findMany({ where, include, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
      db.activityLog.count({ where }),
      db.activityLog.groupBy({ by: ["action"], where, _count: true }),
      db.activityLog.groupBy({ by: ["entity"], where, _count: true }),
    ]);

    return NextResponse.json({
      logs,
      total,
      limit,
      offset,
      actions: actionAgg.map((a) => ({ key: a.action, count: a._count })).sort((a, b) => b.count - a.count),
      entities: entityAgg.map((e) => ({ key: e.entity, count: e._count })).sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
