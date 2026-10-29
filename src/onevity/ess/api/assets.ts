// ESS — Aset Saya (Task 27-b) ==============================================
// GET /api/onevity/ess/assets — penugasan aset milik karyawan sesi:
//   · active:  aset yang sedang dipegang (returnedAt null) — kode/nama/
//              kategori/serial + tanggal penugasan, jatuh tempo & catatan;
//   · history: riwayat pengembalian (returnedAt + kondisi Good/Damaged/Lost).
// Auth karyawan via requireEss (pola ess/api/letters.ts) — data strictly
// milik employeeId aktor (where employeeId, tanpa parameter tambahan).
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const rows = await db.assetAssignment.findMany({
      where: { employeeId },
      include: {
        asset: { select: { code: true, name: true, category: true, serialNumber: true, value: true } },
      },
      orderBy: { assignedAt: "desc" },
      take: 100,
    });

    const map = (a: (typeof rows)[number]) => ({
      id: a.id,
      assetId: a.assetId,
      assignedAt: a.assignedAt,
      dueAt: a.dueAt,
      returnedAt: a.returnedAt,
      returnCondition: a.returnCondition,
      notes: a.notes,
      asset: a.asset,
    });

    return NextResponse.json({
      active: rows.filter((a) => !a.returnedAt).map(map),
      history: rows.filter((a) => a.returnedAt).map(map),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
