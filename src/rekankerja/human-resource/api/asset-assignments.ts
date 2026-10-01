import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

// RekanKerja — Penugasan & Pengembalian Aset (Task 27-b) =====================
// =====================================================================
// GET   /api/rekankerja/asset-assignments?scope=all|active|returned&employeeId=&assetId=
//       — riwayat penugasan dgn aset + karyawan. Guard requireTenant
//       (viewers boleh lihat — dipakai juga seksi clearance offboarding).
// POST  /api/rekankerja/asset-assignments {assetId, employeeId, dueAt?, notes?}
//       — tugaskan aset (wajib status Available) + set asset.status=Assigned.
//         Guard hr:assets op:assign.
// PATCH /api/rekankerja/asset-assignments {id, returnCondition Good|Damaged|Lost, notes?}
//       — terima pengembalian: returnedAt=now + kondisi; status aset
//         Good→Available, Damaged→Maintenance, Lost→Lost. Guard op:return.
// Mutasi → ActivityLog + notifikasi ke karyawan pemegang (notifyEvent
// never-throw — kegagalan notifikasi tidak menggagalkan transaksi).

const RETURN_CONDITIONS = ["Good", "Damaged", "Lost"];
const CONDITION_LABEL: Record<string, string> = { Good: "Baik", Damaged: "Rusak", Lost: "Hilang" };

// ================= GET =================
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const scope = req.nextUrl.searchParams.get("scope") ?? "all"; // all|active|returned
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const assetId = req.nextUrl.searchParams.get("assetId");

    const where: Record<string, unknown> = {};
    if (scope === "active") where.returnedAt = null;
    else if (scope === "returned") where.returnedAt = { not: null };
    if (employeeId) where.employeeId = employeeId;
    if (assetId) where.assetId = assetId;

    const assignments = await db.assetAssignment.findMany({
      where,
      include: {
        asset: { select: { id: true, code: true, name: true, category: true, serialNumber: true, status: true, value: true } },
        employee: { select: { id: true, employeeNo: true, fullName: true, photoUrl: true } },
      },
      orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    });

    return NextResponse.json({
      assignments: assignments.map((a) => ({
        id: a.id,
        assetId: a.assetId,
        employeeId: a.employeeId,
        assignedAt: a.assignedAt,
        dueAt: a.dueAt,
        returnedAt: a.returnedAt,
        returnCondition: a.returnCondition,
        notes: a.notes,
        asset: a.asset,
        employee: a.employee,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — tugangkan aset =================
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:assets", "op:assign");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    const assetId = String(b.assetId ?? "");
    const employeeId = String(b.employeeId ?? "");
    if (!assetId || !employeeId) {
      return NextResponse.json({ error: "Aset dan karyawan wajib dipilih" }, { status: 400 });
    }

    const asset = await db.asset.findUnique({ where: { id: assetId } });
    if (!asset) return NextResponse.json({ error: "Aset tidak ditemukan" }, { status: 404 });
    if (asset.status !== "Available") {
      return NextResponse.json(
        { error: `Aset ${asset.code} sedang ${asset.status === "Assigned" ? "ditugaskan" : asset.status === "Maintenance" ? "dalam perbaikan" : asset.status === "Lost" ? "hilang" : "dipensiunkan (Retired)"} — tidak bisa ditugaskan` },
        { status: 400 },
      );
    }

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, employeeNo: true, fullName: true, status: true },
    });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    if (employee.status !== "Active") {
      return NextResponse.json(
        { error: `${employee.fullName} berstatus ${employee.status} — aset hanya bisa ditugaskan ke karyawan aktif` },
        { status: 400 },
      );
    }

    // tenggat pengembalian opsional
    let dueAt: Date | null = null;
    if (b.dueAt) {
      dueAt = new Date(String(b.dueAt));
      if (Number.isNaN(dueAt.getTime())) {
        return NextResponse.json({ error: "Tanggal jatuh tempo tidak valid" }, { status: 400 });
      }
    }

    const notes = b.notes?.trim() ? String(b.notes).trim() : null;

    // atomik: buat penugasan + tandai aset Assigned
    const created = await db.$transaction(async (tx) => {
      const assignment = await tx.assetAssignment.create({
        data: { assetId, employeeId, dueAt, notes },
      });
      await tx.asset.update({ where: { id: assetId }, data: { status: "Assigned" } });
      return assignment;
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created", entity: "AssetAssignment", entityId: created.id,
        employeeId,
        detail: `Aset ${asset.code} (${asset.name}) ditugaskan ke ${employee.fullName} (${employee.employeeNo}) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    // kabari pemegang (never-throw)
    void notifyEvent(db, {
      to: "employee",
      employeeId,
      docType: "Asset", docNo: asset.code,
      title: `Aset ${asset.code} ditugaskan kepada Anda`,
      body: `${asset.name} kini tercatat atas nama Anda. Periksa menu "Aset Saya" di ESS.${dueAt ? ` Jatuh tempo pengembalian: ${dueAt.toLocaleDateString("id-ID")}.` : ""}`,
      kind: "assets",
    });

    return NextResponse.json({ assignment: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH — terima pengembalian =================
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:assets", "op:return");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    const id = String(b.id ?? "");
    const returnCondition = String(b.returnCondition ?? "");
    if (!id) return NextResponse.json({ error: "id penugasan wajib" }, { status: 400 });
    if (!RETURN_CONDITIONS.includes(returnCondition)) {
      return NextResponse.json({ error: "Kondisi pengembalian wajib Good/Damaged/Lost" }, { status: 400 });
    }

    const assignment = await db.assetAssignment.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, code: true, name: true, status: true } },
        employee: { select: { id: true, employeeNo: true, fullName: true } },
      },
    });
    if (!assignment) return NextResponse.json({ error: "Penugasan tidak ditemukan" }, { status: 404 });
    if (assignment.returnedAt) {
      return NextResponse.json(
        { error: `Aset ${assignment.asset.code} sudah dikembalikan pada ${assignment.returnedAt.toLocaleDateString("id-ID")}` },
        { status: 400 },
      );
    }

    // kondisi menentukan status aset berikutnya
    const nextStatus = returnCondition === "Good" ? "Available" : returnCondition === "Damaged" ? "Maintenance" : "Lost";

    // catatan pengembalian ditambahkan setelah catatan penugasan
    const returnNote = b.notes?.trim() ? String(b.notes).trim() : null;
    const notes = returnNote
      ? [assignment.notes, `[Pengembalian ${CONDITION_LABEL[returnCondition]}] ${returnNote}`].filter(Boolean).join(" — ")
      : assignment.notes;

    const returnedAt = new Date();
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.assetAssignment.update({
        where: { id },
        data: { returnedAt, returnCondition, notes },
      });
      await tx.asset.update({ where: { id: assignment.assetId }, data: { status: nextStatus } });
      return row;
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Updated", entity: "AssetAssignment", entityId: id,
        employeeId: assignment.employeeId,
        detail: `Aset ${assignment.asset.code} (${assignment.asset.name}) dikembalikan oleh ${assignment.employee.fullName} — kondisi ${CONDITION_LABEL[returnCondition]}; status aset → ${nextStatus} oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    // kabari pemegang bahwa pengembalian tercatat (never-throw)
    void notifyEvent(db, {
      to: "employee",
      employeeId: assignment.employeeId,
      docType: "Asset", docNo: assignment.asset.code,
      title: `Pengembalian aset ${assignment.asset.code} tercatat`,
      body: `Terima kasih — pengembalian ${assignment.asset.name} tercatat dengan kondisi ${CONDITION_LABEL[returnCondition]}.`,
      kind: "assets",
    });

    return NextResponse.json({ assignment: updated, asset: { id: assignment.assetId, code: assignment.asset.code, status: nextStatus } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
