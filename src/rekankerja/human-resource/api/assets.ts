import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// RekanKerja — Inventaris Aset Karyawan (Task 27-b) ==========================
// =====================================================================
// GET    /api/rekankerja/assets?category=&status=&q= — daftar aset + pemegang
//        aktif (assignment returnedAt null) + statistik GLOBAL (tanpa
//        terpengaruh filter) utk kartu ringkasan. Guard requireTenant.
// POST   /api/rekankerja/assets — aset baru, kode otomatis AST-%04d (count+1).
// PATCH  /api/rekankerja/assets — edit nama/kategori/serial/nilai/lokasi/
//        catatan/status. Guard hr:assets update.
// DELETE /api/rekankerja/assets?id= — hanya bila TIDAK ada penugasan aktif
//        (riwayat pengembalian tetap menghalangi — FK RESTRICT → sarankan
//        status Retired). Guard hr:assets delete.
// Setiap mutasi menulis ActivityLog (pola disciplinary.ts / offboarding.ts).

/** Kategori & status valid (selaras seed wave-27 + skema). */
const ASSET_CATEGORIES = ["Elektronik", "Kendaraan", "Seragam", "Alat Kerja", "Furniture", "Lainnya"];
const ASSET_STATUSES = ["Available", "Assigned", "Maintenance", "Retired", "Lost"];

// ================= GET =================
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const category = req.nextUrl.searchParams.get("category");
    const status = req.nextUrl.searchParams.get("status");
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    // statistik GLOBAL (dasar kartu ringkasan — dihitung sebelum filter)
    const [total, assigned, available, totalValueRaw] = await Promise.all([
      db.asset.count(),
      db.asset.count({ where: { status: "Assigned" } }),
      db.asset.count({ where: { status: "Available" } }),
      db.asset.aggregate({ _sum: { value: true } }),
    ]);

    // filter list (kosong = semua)
    const where: Record<string, unknown> = {};
    if (category && ASSET_CATEGORIES.includes(category)) where.category = category;
    if (status && ASSET_STATUSES.includes(status)) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { serialNumber: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ];
    }

    const assets = await db.asset.findMany({
      where,
      include: {
        assignments: {
          where: { returnedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
        },
      },
      orderBy: { code: "asc" },
    });

    // flatten pemegang aktif → holder di level aset (tanpa array di UI)
    const rows = assets.map((a) => {
      const active = a.assignments[0] ?? null;
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        serialNumber: a.serialNumber,
        notes: a.notes,
        purchaseDate: a.purchaseDate,
        value: a.value,
        status: a.status,
        location: a.location,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        holder: active
          ? {
              assignmentId: active.id,
              assignedAt: active.assignedAt,
              dueAt: active.dueAt,
              employee: active.employee,
            }
          : null,
      };
    });

    return NextResponse.json({
      assets: rows,
      stats: {
        total,
        assigned,
        available,
        totalValue: totalValueRaw._sum.value ?? 0,
      },
      categories: ASSET_CATEGORIES,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — aset baru =================
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:assets", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    const name = String(b.name ?? "").trim();
    const category = String(b.category ?? "Lainnya");
    if (!name) return NextResponse.json({ error: "Nama aset wajib diisi" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "Nama aset maksimal 120 karakter" }, { status: 400 });
    if (!ASSET_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `Kategori tidak valid (${ASSET_CATEGORIES.join(", ")})` }, { status: 400 });
    }

    // nilai perolehan — angka >= 0 opsional
    let value: number | null = null;
    if (b.value !== undefined && b.value !== null && b.value !== "") {
      value = Number(b.value);
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "Nilai aset harus angka >= 0" }, { status: 400 });
      }
    }

    // tanggal perolehan opsional
    let purchaseDate: Date | null = null;
    if (b.purchaseDate) {
      purchaseDate = new Date(String(b.purchaseDate));
      if (Number.isNaN(purchaseDate.getTime())) {
        return NextResponse.json({ error: "Tanggal perolehan tidak valid" }, { status: 400 });
      }
    }

    // kode berurutan tenant
    const count = await db.asset.count();
    let code = `AST-${String(count + 1).padStart(4, "0")}`;
    // tahan tabrakan dgn data luar migrasi (unqiue code) — maju sampai kosong
    for (let i = 0; i < 100; i++) {
      const clash = await db.asset.findUnique({ where: { code }, select: { id: true } });
      if (!clash) break;
      code = `AST-${String(count + 2 + i).padStart(4, "0")}`;
    }

    const asset = await db.asset.create({
      data: {
        code,
        name,
        category,
        serialNumber: b.serialNumber?.trim() ? String(b.serialNumber).trim() : null,
        notes: b.notes?.trim() ? String(b.notes).trim() : null,
        purchaseDate,
        value,
        status: "Available",
        location: b.location?.trim() ? String(b.location).trim() : null,
      },
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created", entity: "Asset", entityId: asset.id,
        detail: `Aset baru ${asset.code} — ${asset.name} (${asset.category}${value != null ? `, nilai Rp ${value.toLocaleString("id-ID")}` : ""}) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH — edit aset =================
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:assets", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id aset wajib" }, { status: 400 });

    const asset = await db.asset.findUnique({ where: { id } });
    if (!asset) return NextResponse.json({ error: "Aset tidak ditemukan" }, { status: 404 });

    // validasi field yang dikirim
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) {
      const name = String(b.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Nama aset wajib diisi" }, { status: 400 });
      data.name = name;
    }
    if (b.category !== undefined) {
      if (!ASSET_CATEGORIES.includes(String(b.category))) {
        return NextResponse.json({ error: `Kategori tidak valid (${ASSET_CATEGORIES.join(", ")})` }, { status: 400 });
      }
      data.category = String(b.category);
    }
    if (b.serialNumber !== undefined) data.serialNumber = b.serialNumber?.trim() ? String(b.serialNumber).trim() : null;
    if (b.notes !== undefined) data.notes = b.notes?.trim() ? String(b.notes).trim() : null;
    if (b.location !== undefined) data.location = b.location?.trim() ? String(b.location).trim() : null;
    if (b.value !== undefined) {
      if (b.value === null || b.value === "") data.value = null;
      else {
        const v = Number(b.value);
        if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "Nilai aset harus angka >= 0" }, { status: 400 });
        data.value = v;
      }
    }
    if (b.purchaseDate !== undefined) {
      if (!b.purchaseDate) data.purchaseDate = null;
      else {
        const d = new Date(String(b.purchaseDate));
        if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Tanggal perolehan tidak valid" }, { status: 400 });
        data.purchaseDate = d;
      }
    }
    if (b.status !== undefined) {
      const status = String(b.status);
      if (!ASSET_STATUSES.includes(status)) {
        return NextResponse.json({ error: `Status tidak valid (${ASSET_STATUSES.join(", ")})` }, { status: 400 });
      }
      // pelindih: aset yang sedang ditugaskan tidak boleh dipaksa Available
      // lewat edit — pengembalian harus lewat aksi "Kembalikan" (catat kondisi)
      if (status === "Available" && asset.status === "Assigned") {
        return NextResponse.json(
          { error: "Aset sedang ditugaskan — gunakan aksi Kembalikan di tab Penugasan agar kondisi tercatat" },
          { status: 400 },
        );
      }
      data.status = status;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan data" }, { status: 400 });
    }

    const updated = await db.asset.update({ where: { id }, data });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Updated", entity: "Asset", entityId: id,
        detail: `Aset ${asset.code} diperbarui (${Object.keys(data).join(", ")}) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ asset: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= DELETE — hapus aset =================
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:assets", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const asset = await db.asset.findUnique({ where: { id } });
    if (!asset) return NextResponse.json({ error: "Aset tidak ditemukan" }, { status: 404 });

    // penugasan AKTIF menghalangi penghapusan
    const active = await db.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
      select: { id: true },
    });
    if (active) {
      return NextResponse.json(
        { error: `Aset ${asset.code} sedang ditugaskan — terima pengembaliannya dulu (tab Penugasan)` },
        { status: 400 },
      );
    }

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Deleted", entity: "Asset", entityId: id,
        detail: `Aset ${asset.code} — ${asset.name} dihapus dari inventaris oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    try {
      await db.asset.delete({ where: { id } });
    } catch (e) {
      // FK RESTRICT: masih ada riwayat penugasan (sudah dikembalikan) →
      // arahkan ke status Retired sebagai pengganti penghapusan
      if ((e as { code?: string })?.code === "P2003") {
        return NextResponse.json(
          { error: "Aset memiliki riwayat penugasan dan tidak bisa dihapus — tandai status Retired sebagai gantinya" },
          { status: 400 },
        );
      }
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
