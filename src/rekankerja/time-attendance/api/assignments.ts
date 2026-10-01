import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

const ASSIGNMENT_INCLUDE = {
  employee: { select: { employeeNo: true, fullName: true, status: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
  schedule: { select: { code: true, name: true, cycleDays: true, days: { orderBy: { sequence: "asc" as const }, include: { dayType: { select: { code: true, name: true, color: true } } } } } },
} as const;

// GET /api/rekankerja/attendance/assignments — penugasan jadwal per karyawan
// (padanan EmpWorkSchedule.jsp)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const [assignments, schedules, employees] = await Promise.all([
      db.scheduleAssignment.findMany({
        include: ASSIGNMENT_INCLUDE,
        orderBy: [{ employee: { employeeNo: "asc" } }, { validFrom: "desc" }],
      }),
      db.workSchedule.findMany({ where: { active: true }, select: { id: true, code: true, name: true, cycleDays: true }, orderBy: { code: "asc" } }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    const employeesOut = employees.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName,
      orgUnitName: e.assignments[0]?.orgUnit?.name ?? null,
    }));
    return NextResponse.json({ assignments, schedules, employees: employeesOut });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — assign jadwal ke karyawan (menutup assignment lama bila tumpang tindih)
// Task 32-d: guard hak AKSI menu — create pada attendance:assignment-schedule (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:assignment-schedule", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const employeeId = String(b.employeeId ?? "");
    const scheduleId = String(b.scheduleId ?? "");
    if (!employeeId || !scheduleId) return NextResponse.json({ error: "Karyawan & jadwal wajib dipilih" }, { status: 400 });

    const emp = await db.employee.findUnique({ where: { id: employeeId } });
    if (!emp || emp.status !== "Active") return NextResponse.json({ error: "Karyawan tidak ditemukan / tidak aktif" }, { status: 400 });
    const schedule = await db.workSchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule || !schedule.active) return NextResponse.json({ error: "Jadwal tidak ditemukan / tidak aktif" }, { status: 400 });

    let anchorMonday: Date;
    if (b.anchorMonday && /^\d{4}-\d{2}-\d{2}$/.test(b.anchorMonday)) {
      anchorMonday = new Date(`${b.anchorMonday}T00:00:00`);
    } else {
      // default: Senin pada minggu validFrom
      const d = b.validFrom && /^\d{4}-\d{2}-\d{2}$/.test(b.validFrom) ? new Date(`${b.validFrom}T00:00:00`) : new Date();
      anchorMonday = new Date(d);
      anchorMonday.setHours(0, 0, 0, 0);
      const dow = (anchorMonday.getDay() + 6) % 7; // 0 = Senin
      anchorMonday.setDate(anchorMonday.getDate() - dow);
    }
    const anchorSequence = Math.max(1, parseInt(b.anchorSequence ?? 1, 10) || 1);
    if (anchorSequence > schedule.cycleDays) {
      return NextResponse.json({ error: `Sequence maksimal ${schedule.cycleDays} (cycle ${schedule.code})` }, { status: 400 });
    }

    const validFrom = b.validFrom && /^\d{4}-\d{2}-\d{2}$/.test(b.validFrom) ? new Date(`${b.validFrom}T00:00:00`) : new Date();

    // T5-TA-FIX (D-5, misi 3b): tutup SEMUA assignment lama yang masih tumpang
    // tindih dengan assignment baru — bukan hanya yang validTo-nya null:
    // assignment lama ber-validTo panjang (mis. s.d. akhir tahun) dulu dibiarkan
    // terbuka → dua assignment overlap senyap (resolveDayType memilih validFrom
    // terbaru; hari di antara tanggalnya tidak konsisten). Penutupan + create
    // SATU transaksi (atomik — tidak ada celah tanpa assignment aktif).
    // Hanya assignment LAMA (validFrom < validFrom baru) yang ditutup; assignment
    // yang mulai SETELAH tanggal efektif baru dibiarkan (saatnya tiba ia yang berlaku).
    const dayBefore = new Date(validFrom.getTime() - 86_400_000);
    const assignment = await db.$transaction(async (tx) => {
      await tx.scheduleAssignment.updateMany({
        where: {
          employeeId,
          validFrom: { lt: validFrom },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
        data: { validTo: dayBefore },
      });
      return tx.scheduleAssignment.create({
        data: {
          employeeId, scheduleId, anchorMonday, anchorSequence,
          clockingRequired: b.clockingRequired === undefined ? true : Boolean(b.clockingRequired),
          validFrom,
          notes: b.notes?.trim() || null,
        },
        include: ASSIGNMENT_INCLUDE,
      });
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — akhiri assignment (validTo) / ubah clockingRequired
// Task 32-d: guard hak AKSI menu per pengguna — aksi "end" → op:end pada
// attendance:assignment-schedule; ubah field lain → update. Body dibaca SEKALI
// sebelum guard (aksi menentukan op yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = b.action === "end"
      ? await requireMenuAction(req, "attendance:assignment-schedule", "op:end")
      : await requireMenuAction(req, "attendance:assignment-schedule", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const existing = await db.scheduleAssignment.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Penugasan tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.clockingRequired !== undefined) data.clockingRequired = Boolean(b.clockingRequired);
    if (b.notes !== undefined) data.notes = b.notes?.trim() || null;
    if (b.action === "end") {
      if (existing.validTo) return NextResponse.json({ error: "Penugasan sudah berakhir" }, { status: 400 });
      data.validTo = new Date();
    }
    const assignment = await db.scheduleAssignment.update({ where: { id: b.id }, data, include: ASSIGNMENT_INCLUDE });
    return NextResponse.json({ assignment });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
