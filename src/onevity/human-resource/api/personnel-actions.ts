import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/onevity/shared/services/menu-access";
import { validateSalaryAgainstGrade } from "@/onevity/human-resource/services/pa-targets";

// GET /api/onevity/personnel-actions?status=&type=&q=&mine=
// Task 82-T5: guard view menu (dulu requireTenant saja — PA berisi data
// sensitif pengajuan kepegawaian). mine=1 dipakai Kotak Persetujuan (hr:inbox),
// list penuh dipakai Semua Pengajuan (hr:all).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["hr:all", "hr:inbox"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const type = sp.get("type");
    const q = sp.get("q")?.trim() ?? "";
    const mine = sp.get("mine") === "1";

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
    if (mine) where.status = "Submitted";

    // Sort server-side (Task 76): whitelist — kolom langsung + nama karyawan via
    // orderBy relasi (SQL). Progress diurut client-side (computed dari layers).
    const PA_SORT = {
      doc: "docNo", type: "type", effective: "effectiveDate", status: "status", createdAt: "createdAt",
    } as const;
    const sortRaw = sp.get("sortBy");
    const sortCol = (sortRaw && (PA_SORT as Record<string, string>)[sortRaw]) || "createdAt";
    const sortDir: "asc" | "desc" = sp.get("sortDir") === "desc" ? "desc" : sp.get("sortDir") === "asc" ? "asc" : sortCol === "createdAt" ? "desc" : "asc";
    const orderBy = sortRaw === "employee"
      ? { employee: { fullName: sortDir } }
      : { [sortCol]: sortDir };

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
        orderBy,
      }),
      db.personnelAction.groupBy({ by: ["status"], _count: true }),
    ]);

    // flatten assignment aktif → bentuk lama (position/orgUnit)
    const actionsWithFlat = actionsRaw.map((a) => {
      const cur = a.employee.assignments[0] ?? null;
      const { assignments: _a, ...emp } = a.employee as typeof a.employee & { assignments?: unknown[] };
      return { ...a, employee: { ...emp, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null } };
    });

    // filter inbox (fix K-03): layer Pending yang relevan dengan AKTOR SESI —
    // bukan user hard-coded. Layer relevan bila: aktor berperan OWNER/ADMIN/HR
    // (boleh memutuskan layer mana pun), ATAU layer menunjuk aktor (approverId match),
    // ATAU layer tanpa approver tertentu (approverId null).
    let actions = actionsWithFlat;
    if (mine) {
      const m = await requireMutator(req);
      if (!m.ok && m.status === 401) return NextResponse.json({ error: m.error }, { status: m.status });
      if (!m.ok) {
        // role VIEWER: tidak punya hak keputusan → inbox kosong (bukan error)
        actions = [];
      } else {
        const privileged = ["OWNER", "ADMIN", "HR"].includes(m.actor.role);
        actions = actionsWithFlat.filter((a) => {
          const pending = a.layers.find((l) => l.status === "Pending");
          if (!pending) return false;
          if (privileged) return true;
          if (pending.approverId === null) return true;
          return m.actor.appUserId != null && pending.approverId === m.actor.appUserId;
        });
      }
    }

    const statusCounts: Record<string, number> = {};
    for (const c of counts) statusCounts[c.status] = c._count;

    return NextResponse.json({ actions, statusCounts, total: actions.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST create new PA (status Prepared + template layers)
// Fix K-03: aktor dari SESI (requireMutator — VIEWER ditolak, identitas nyata untuk
// createdBy/ActivityLog); approver layer di-resolve dari struktur/role, bukan = pembuat.
// Fix M-05/M-06: validasi server (eff date ≥ joinDate, gaji dalam rentang grade,
// karyawan Active kecuali Hire, FK ramah 400).
// Task 32-d: guard hak AKSI menu — create pada menu hr:all (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:all", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.employeeId || !b.type) return NextResponse.json({ error: "Karyawan dan jenis aksi wajib diisi" }, { status: 400 });
    const employee = await db.employee.findUnique({ where: { id: b.employeeId } });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 400 });

    const detail: Record<string, unknown> =
      b.detail && typeof b.detail === "object" && !Array.isArray(b.detail) ? (b.detail as Record<string, unknown>) : {};

    // (c) PA hanya untuk karyawan berstatus Active (kecuali Hire — rencana rekrutmen)
    if (employee.status !== "Active" && b.type !== "Hire") {
      return NextResponse.json(
        { error: `Personnel Action hanya untuk karyawan berstatus Active (status ${employee.status} — gunakan jenis Hire untuk rencana rekrutmen)` },
        { status: 400 },
      );
    }

    // (a) tanggal efektif tidak boleh mendahului tanggal bergabung karyawan
    const effectiveDate = b.effectiveDate ? new Date(b.effectiveDate) : new Date();
    if (Number.isNaN(effectiveDate.getTime())) {
      return NextResponse.json({ error: "Tanggal efektif tidak valid" }, { status: 400 });
    }
    if (effectiveDate.getTime() < employee.joinDate.getTime()) {
      return NextResponse.json(
        { error: `Tanggal efektif (${effectiveDate.toISOString().slice(0, 10)}) tidak boleh mendahului tanggal bergabung karyawan (${employee.joinDate.toISOString().slice(0, 10)})` },
        { status: 400 },
      );
    }

    // (b) gaji baru wajib dalam rentang min/max grade tujuan (atau grade saat ini)
    // — grade tanpa rentang (maxSalary ≤ 0) dianggap tidak mendefinisikan range.
    if (detail.newSalary !== undefined && detail.newSalary !== null && String(detail.newSalary) !== "") {
      try {
        await validateSalaryAgainstGrade(db, Number(detail.newSalary), detail, employee.id);
      } catch (e) {
        if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }

    // (d) FK posisi/unit/grade eksplisit harus valid → 400 ramah (bukan 500 prisma)
    if (detail.positionId) {
      const p = await db.position.findUnique({ where: { id: String(detail.positionId) }, select: { id: true } });
      if (!p) return NextResponse.json({ error: "Posisi tujuan tidak dikenal — periksa kembali detail dokumen" }, { status: 400 });
    }
    if (detail.orgUnitId) {
      const u = await db.orgUnit.findUnique({ where: { id: String(detail.orgUnitId) }, select: { id: true } });
      if (!u) return NextResponse.json({ error: "Unit organisasi tujuan tidak dikenal — periksa kembali detail dokumen" }, { status: 400 });
    }
    if (detail.gradeId) {
      const g = await db.grade.findUnique({ where: { id: String(detail.gradeId) }, select: { id: true } });
      if (!g) return NextResponse.json({ error: "Grade tujuan tidak dikenal — periksa kembali detail dokumen" }, { status: 400 });
    }

    // docNo sequence
    const last = await db.personnelAction.findFirst({ orderBy: { docNo: "desc" }, select: { docNo: true } });
    const nextNo = last ? Number(last.docNo.split("-").pop()) + 1 : 1;
    const docNo = `PA-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;

    // layers from standard template
    const template = await db.approvalTemplate.findFirst({ where: { code: "AT-PA-STD" } });
    const layersDef: { layer: number; role: string }[] = template ? JSON.parse(template.layersJson) : [{ layer: 1, role: "HR Manager" }];

    // ---- Resolusi approver awal per layer (fix K-03) ----
    // - layer "Dept Head" → atasan langsung karyawan target: AppUser dengan employeeId
    //   = manager pada assignment aktif (murah: 2 query);
    // - layer lain → AppUser aktif dengan role yang cocok;
    // - tidak resoluble → approverId null (approverRole tetap; keputusan dijaga guard
    //   aktor di detail — bukan lagi approverId = pembuat → tidak self-approve bawaan).
    const cur = await db.employeeAssignment.findFirst({
      where: { employeeId: employee.id, validTo: null },
      orderBy: { validFrom: "desc" },
      select: { managerId: true },
    });
    let managerApproverId: string | null = null;
    if (cur?.managerId) {
      const mgrUser = await db.appUser.findFirst({
        where: { employeeId: cur.managerId, active: true },
        select: { id: true },
      });
      managerApproverId = mgrUser?.id ?? null;
    }
    const otherRoles = [...new Set(layersDef.map((l) => l.role).filter((r) => r !== "Dept Head"))];
    const roleApprover: Record<string, string | null> = {};
    for (const r of otherRoles) {
      const u = await db.appUser.findFirst({ where: { role: r, active: true }, select: { id: true } });
      roleApprover[r] = u?.id ?? null;
    }

    const action = await db.personnelAction.create({
      data: {
        docNo, employeeId: b.employeeId, type: b.type,
        effectiveDate,
        reason: b.reason ?? null,
        detailJson: b.detail ? JSON.stringify(b.detail) : null,
        status: "Prepared",
        createdBy: actor.appUsername ?? actor.name, // aktor sesi nyata (bukan hard-coded)
        layers: {
          create: layersDef.map((l) => ({
            layerNo: l.layer, approverRole: l.role,
            approverId: l.role === "Dept Head" ? managerApproverId : (roleApprover[l.role] ?? null),
            status: "Pending",
          })),
        },
      },
      include: { layers: true },
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId, // jejak aktor sesi nyata (fix audit C-03)
        action: "Created", entity: "PersonnelAction", entityId: action.id,
        employeeId: b.employeeId, personnelActionId: action.id,
        detail: `${b.type} — dokumen ${docNo} dibuat (draft) oleh ${actor.appUsername ?? actor.name}`,
      },
    });

    return NextResponse.json({ action }, { status: 201 });
  } catch (e) {
    // (d) FK prisma (P2003) → 400 pesan ramah, bukan 500
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa karyawan/posisi/unit/grade tujuan" }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
