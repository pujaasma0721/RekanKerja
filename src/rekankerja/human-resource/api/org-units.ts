import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// GET /api/rekankerja/org-units[?withTree=1]
// GET /api/rekankerja/org-units?impactCode=MII-ITD — QA-ORG-CODE-IMPACT: analisis
// dokumen PA yang masih bergantung pada KODE unit (resolve-by-code fallback),
// dipakai dialog edit unit untuk memperingatkan sebelum kode diganti.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const impactCode = req.nextUrl.searchParams.get("impactCode");
    if (impactCode !== null) {
      const code = impactCode.trim().toUpperCase();
      if (!code) return NextResponse.json({ impact: { code, count: 0, documents: [] } });
      // Kandidat kasar: PA yang belum final (akan melewati resolve saat diproses)
      // dan detailJson-nya mengandung kode (case-insensitive). Filter presisi
      // (exact match + tanpa referensi id) dilakukan setelah parse JSON —
      // contains kasar hanya untuk memangkas jumlah baris yang di-parse.
      const pending = await db.personnelAction.findMany({
        where: {
          status: { in: ["Prepared", "Submitted", "Approved"] },
          detailJson: { contains: code, mode: "insensitive" },
        },
        select: { docNo: true, type: true, detailJson: true, employee: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const documents = pending.flatMap((pa) => {
        let d: Record<string, unknown> = {};
        try { d = JSON.parse(pa.detailJson ?? "{}") as Record<string, unknown>; } catch { /* detail rusak — abaikan */ }
        // Dokumen yang menyimpan id valid tidak terpengaruh ganti kode.
        const hasIdRef = [d.orgUnitId, d.toUnitId].some((v) => typeof v === "string" && v.trim() !== "");
        const codeRef = typeof d.toUnit === "string" ? d.toUnit.trim().toUpperCase() : "";
        if (hasIdRef || codeRef !== code) return [];
        return [{ docNo: pa.docNo, type: pa.type, employee: pa.employee?.fullName ?? null }];
      });
      return NextResponse.json({ impact: { code, count: documents.length, documents } });
    }

    const withTree = req.nextUrl.searchParams.get("withTree") === "1";
    const units = await db.orgUnit.findMany({
      where: { active: true },
      include: { parent: { select: { name: true } }, _count: { select: { assignments: { where: { validTo: null } }, positions: true, children: true } } },
      orderBy: [{ level: "asc" }, { code: "asc" }],
    });
    const flat = units.map((u) => ({
      id: u.id, code: u.code, name: u.name, parentId: u.parentId, level: u.level,
      headcountBudget: u.headcountBudget, active: u.active,
      parentName: u.parent?.name ?? null,
      employeeCount: u._count.assignments, positionCount: u._count.positions, childCount: u._count.children,
    }));
    if (!withTree) return NextResponse.json({ units: flat });
    // build nested tree
    const map = new Map(flat.map((u) => [u.id, { ...u, children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) (map.get(node.parentId)!.children as unknown[]).push(node);
      else roots.push(node);
    }
    return NextResponse.json({ units: flat, tree: roots });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST create unit — T1-SECURITY: guard hak AKSI menu hr:tree (Unit Organisasi).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:tree", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode dan nama unit wajib diisi" }, { status: 400 });
    const exists = await db.orgUnit.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode unit ${b.code} sudah dipakai` }, { status: 400 });
    let level = 1;
    if (b.parentId) {
      // Fix bug: findUnique butuh objek where unik ({ id }), bukan string mentah —
      // dulu sub-unit selalu 500 "Expected OrgUnitWhereUniqueInput, provided String".
      const parent = await db.orgUnit.findUnique({ where: { id: String(b.parentId) } });
      if (!parent) return NextResponse.json({ error: "Unit induk tidak ditemukan" }, { status: 400 });
      level = parent.level + 1;
    }
    const company = b.companyId ? await db.company.findUnique({ where: { id: b.companyId } }) : await db.company.findFirst();
    if (!company) return NextResponse.json({ error: "Perusahaan tidak ditemukan" }, { status: 400 });
    const unit = await db.orgUnit.create({
      data: {
        code: b.code, name: b.name, parentId: b.parentId ?? null,
        companyId: company.id, level, headcountBudget: Number(b.headcountBudget ?? 0),
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "OrgUnit", entityId: unit.id, detail: `Unit organisasi ${unit.name} (${unit.code}) dibuat` } });
    return NextResponse.json({ unit }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH update — T1-SECURITY: guard hak AKSI menu hr:tree (Ubah).
// QA-ORG-EDIT: dulu hanya {name, headcountBudget, active} tapi UI tidak pernah
// memakainya. Kini mendukung edit lengkap: kode (unik), nama, pindah induk
// (cegah siklus + hitung ulang level seluruh subtree), dan budget headcount.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:tree", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const current = await db.orgUnit.findUnique({ where: { id: b.id } });
    if (!current) return NextResponse.json({ error: "Unit tidak ditemukan" }, { status: 404 });
    if (b.name != null && !String(b.name).trim()) return NextResponse.json({ error: "Nama unit tidak boleh kosong" }, { status: 400 });

    // — Kode unit: boleh diubah, harus unik —
    let code: string | undefined;
    if (b.code != null) {
      code = String(b.code).trim().toUpperCase();
      if (!code) return NextResponse.json({ error: "Kode unit tidak boleh kosong" }, { status: 400 });
      if (code !== current.code) {
        const dup = await db.orgUnit.findUnique({ where: { code } });
        if (dup) return NextResponse.json({ error: `Kode unit ${code} sudah dipakai` }, { status: 400 });
      }
    }

    // — Pindah induk: validasi target & cegah siklus, hitung level baru —
    let newParentId: string | null | undefined = undefined;
    let newLevel: number | undefined = undefined;
    if (b.parentId !== undefined) {
      const target = b.parentId === null || b.parentId === "" ? null : String(b.parentId);
      if (target !== current.parentId) {
        if (target === current.id) return NextResponse.json({ error: "Unit tidak dapat menjadi induk dirinya sendiri" }, { status: 400 });
        if (target) {
          const parent = await db.orgUnit.findUnique({ where: { id: target } });
          if (!parent) return NextResponse.json({ error: "Unit induk tidak ditemukan" }, { status: 400 });
          // Naik dari calon induk ke root — tidak boleh melewati unit ini (siklus)
          let p: { id: string; parentId: string | null } | null = parent;
          while (p) {
            if (p.id === current.id) return NextResponse.json({ error: "Tidak boleh memindahkan unit ke bawah dirinya sendiri" }, { status: 400 });
            p = p.parentId ? await db.orgUnit.findUnique({ where: { id: p.parentId } }) : null;
          }
          newLevel = parent.level + 1;
        } else {
          newLevel = 1; // pindah ke root
        }
        newParentId = target;
      }
    }

    const unit = await db.orgUnit.update({
      where: { id: b.id },
      data: {
        code, name: b.name,
        headcountBudget: b.headcountBudget != null ? Number(b.headcountBudget) : undefined,
        active: b.active,
        parentId: newParentId, level: newLevel,
      },
    });

    // — Level subtree bergeser mengikuti delta level unit ini —
    if (newLevel !== undefined && newLevel !== current.level) {
      const delta = newLevel - current.level;
      const queue = [unit.id];
      while (queue.length) {
        const cur = queue.shift()!;
        const children = await db.orgUnit.findMany({ where: { parentId: cur }, select: { id: true } });
        for (const ch of children) {
          await db.orgUnit.update({ where: { id: ch.id }, data: { level: { increment: delta } } });
          queue.push(ch.id);
        }
      }
    }

    await db.activityLog.create({ data: { action: "Updated", entity: "OrgUnit", entityId: unit.id, detail: `Unit ${unit.name} (${unit.code}) diperbarui${newParentId !== undefined ? " — struktur induk diubah" : ""}` } });
    return NextResponse.json({ unit });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE ?id= — T1-SECURITY: guard hak AKSI menu hr:tree (Hapus).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:tree", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const [children, employees, positions] = await Promise.all([
      db.orgUnit.count({ where: { parentId: id } }),
      db.employeeAssignment.count({ where: { validTo: null, orgUnitId: id } }),
      db.position.count({ where: { orgUnitId: id } }),
    ]);
    if (children > 0) return NextResponse.json({ error: "Unit memiliki sub-unit — hapus/pindahkan sub-unit terlebih dahulu" }, { status: 400 });
    if (employees > 0) return NextResponse.json({ error: `Unit masih memiliki ${employees} karyawan aktif` }, { status: 400 });
    if (positions > 0) return NextResponse.json({ error: `Unit masih memiliki ${positions} posisi` }, { status: 400 });
    const unit = await db.orgUnit.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "OrgUnit", entityId: id, detail: `Unit ${unit.name} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
