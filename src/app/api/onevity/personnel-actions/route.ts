import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";

// GET /api/onevity/personnel-actions?status=&type=&q=&mine=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const type = sp.get("type");
    const q = sp.get("q")?.trim() ?? "";

    const where: Record<string, unknown> = {};
    if (status && status !== "all") where.status = status;
    if (type && type !== "all") where.type = type;
    if (q) {
      where.OR = [
        { docNo: { contains: q } },
        { employee: { fullName: { contains: q } } },
        { employee: { employeeNo: { contains: q } } },
      ];
    }
    if (sp.get("mine") === "1") {
      // my inbox: submitted docs where the CURRENT pending layer's designated approver is me (acting user: HR Manager MII000001)
      const me = await db.appUser.findFirst({ where: { username: "MII000001" } });
      where.status = "Submitted";
    }

    const [actionsRaw, counts] = await Promise.all([
      db.personnelAction.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true, fullName: true, employeeNo: true,
              // posisi/unit saat ini dari assignment aktif
              assignments: {
                where: { validTo: null },
                orderBy: { validFrom: "desc" },
                take: 1,
                include: { position: { select: { title: true } }, orgUnit: { select: { name: true } } },
              },
            },
          },
          layers: { orderBy: { layerNo: "asc" }, include: { approver: { select: { fullName: true, role: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.personnelAction.groupBy({ by: ["status"], _count: true }),
    ]);

    // flatten assignment aktif → bentuk lama (position/orgUnit)
    const actionsWithFlat = actionsRaw.map((a) => {
      const cur = a.employee.assignments[0] ?? null;
      const { assignments: _a, ...emp } = a.employee as typeof a.employee & { assignments?: unknown[] };
      return { ...a, employee: { ...emp, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null } };
    });

    // filter: my inbox = only docs where current pending layer belongs to me (or I can act on it)
    let actions = actionsWithFlat;
    if (sp.get("mine") === "1") {
      const me = await db.appUser.findFirst({ where: { username: "MII000001" } });
      actions = actionsWithFlat.filter((a) => {
        const pending = a.layers.find((l) => l.status === "Pending");
        if (!pending) return false;
        if (me && pending.approverId === me.id) return true;
        // HR Manager can act on HR-layer; Admin can act on any
        return me?.role === "Admin";
      });
    }

    const statusCounts: Record<string, number> = {};
    for (const c of counts) statusCounts[c.status] = c._count;

    return NextResponse.json({ actions, statusCounts, total: actions.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST create new PA (status Prepared + template layers)
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.employeeId || !b.type) return NextResponse.json({ error: "Karyawan dan jenis aksi wajib diisi" }, { status: 400 });
    const employee = await db.employee.findUnique({ where: { id: b.employeeId } });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 400 });

    // docNo sequence
    const last = await db.personnelAction.findFirst({ orderBy: { docNo: "desc" }, select: { docNo: true } });
    const nextNo = last ? Number(last.docNo.split("-").pop()) + 1 : 1;
    const docNo = `PA-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;

    // layers from standard template
    const template = await db.approvalTemplate.findFirst({ where: { code: "AT-PA-STD" } });
    const layersDef: { layer: number; role: string }[] = template ? JSON.parse(template.layersJson) : [{ layer: 1, role: "HR Manager" }];
    const me = await db.appUser.findFirst({ where: { username: "MII000001" } });

    const action = await db.personnelAction.create({
      data: {
        docNo, employeeId: b.employeeId, type: b.type,
        effectiveDate: b.effectiveDate ? new Date(b.effectiveDate) : new Date(),
        reason: b.reason ?? null,
        detailJson: b.detail ? JSON.stringify(b.detail) : null,
        status: "Prepared",
        createdBy: me?.username ?? "system",
        layers: {
          create: layersDef.map((l) => ({
            layerNo: l.layer, approverRole: l.role,
            approverId: me?.id ?? null, status: "Pending",
          })),
        },
      },
      include: { layers: true },
    });

    await db.activityLog.create({
      data: {
        action: "Created", entity: "PersonnelAction", entityId: action.id,
        employeeId: b.employeeId, personnelActionId: action.id,
        detail: `${b.type} — dokumen ${docNo} dibuat (draft)`,
      },
    });

    return NextResponse.json({ action }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
