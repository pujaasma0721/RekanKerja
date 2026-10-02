import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// Task 99 — validasi JSON blackoutDates: array [{from,to,note?}] tanggal valid.
// Input rusak → fallback "[]" (tidak pernah throw — master tetap bisa disimpan).
function parseBlackoutJson(raw: unknown): string {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return "[]";
    const clean = parsed
      .filter(
        (r): r is { from: string; to: string; note?: string } =>
          !!r && typeof r === "object" && typeof (r as { from?: unknown }).from === "string" &&
          typeof (r as { to?: unknown }).to === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test((r as { from: string }).from) &&
          /^\d{4}-\d{2}-\d{2}$/.test((r as { to: string }).to),
      )
      .slice(0, 12)
      .map((r) => ({ from: r.from, to: r.to, ...(typeof r.note === "string" && r.note.trim() ? { note: r.note.trim().slice(0, 120) } : {}) }));
    return JSON.stringify(clean);
  } catch {
    return "[]";
  }
}

// GET /api/rekankerja/leave/types — master jenis cuti + daftar karyawan aktif
// (padanan LeaveType + QueryEmpLeaveInfo; employees utk picker form permintaan).
// Task 99: guard menu-view — banyak dialog modul leave (permintaan/saldo/
// massal/encashment) mengkonsumsi master jenis ini.
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, [
      "leave:leave-type", "leave:leave-request", "leave:leave-info", "leave:leave-mass", "leave:leave-encashment",
    ]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const activeOnly = req.nextUrl.searchParams.get("all") !== "1";
    const [types, employees] = await Promise.all([
      db.leaveType.findMany({
        where: activeOnly ? { active: true } : {},
        orderBy: [{ code: "asc" }],
        // Task 33 — jumlah aturan diferensiasi entitlement per jenis.
        include: { _count: { select: { rules: true } } },
      }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    return NextResponse.json({
      types: types.map((ty) => {
        const { _count, ...rest } = ty;
        return { ...rest, ruleCount: _count.rules };
      }),
      employees,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — jenis cuti baru
// T41-M2: guard hak AKSI menu leave:leave-type (Baru) — sebelumnya
// requireTenant saja (VIEWER bisa mutasi master yang menggerakkan saldo cuti).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "leave:leave-type", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const code = String(b.code ?? "").trim().toUpperCase();
    const name = String(b.name ?? "").trim();
    if (!code || !name) return NextResponse.json({ error: "Kode & nama jenis cuti wajib diisi" }, { status: 400 });
    const clash = await db.leaveType.findUnique({ where: { code } });
    if (clash) return NextResponse.json({ error: `Kode ${code} sudah dipakai` }, { status: 400 });
    const unit = b.unit === "MONTH" ? "MONTH" : "DAY";
    // Task 99 — policy v2: notice period, batas hari berturut, blackout dates.
    const blackout = parseBlackoutJson(b.blackoutDates);
    const type = await db.leaveType.create({
      data: {
        code, name, description: b.description?.trim() || null, unit,
        entitlement: Math.max(0, Number(b.entitlement ?? 0)),
        maxPerRequest: Math.max(0, Number(b.maxPerRequest ?? 0)),
        paid: b.paid !== false,
        cashable: Boolean(b.cashable),
        periodMode: b.periodMode === "ANNIVERSARY" ? "ANNIVERSARY" : "CALENDAR",
        prorateMonthly: Boolean(b.prorateMonthly),
        carryOverMax: Math.max(0, Number(b.carryOverMax ?? 0)),
        waitingMonths: Math.max(0, parseInt(b.waitingMonths ?? 0, 10) || 0),
        allowAdvance: Boolean(b.allowAdvance),
        allowHalfDay: b.allowHalfDay !== false,
        needDocs: Boolean(b.needDocs),
        noticeDays: Math.max(0, parseInt(b.noticeDays ?? 0, 10) || 0),
        maxConsecutiveDays: Math.max(0, Number(b.maxConsecutiveDays ?? 0)),
        blackoutDates: blackout,
        notes: b.notes?.trim() || null,
      },
    });
    return NextResponse.json({ type }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — perbarui / nonaktifkan
// T41-M2: guard hak AKSI menu leave:leave-type (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "leave:leave-type", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.leaveType.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Jenis cuti tidak ditemukan" }, { status: 404 });
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = String(b.name).trim();
    if (b.description !== undefined) data.description = b.description?.trim() || null;
    if (b.unit !== undefined) data.unit = b.unit === "MONTH" ? "MONTH" : "DAY";
    if (b.entitlement !== undefined) data.entitlement = Math.max(0, Number(b.entitlement));
    if (b.maxPerRequest !== undefined) data.maxPerRequest = Math.max(0, Number(b.maxPerRequest));
    if (b.paid !== undefined) data.paid = Boolean(b.paid);
    if (b.cashable !== undefined) data.cashable = Boolean(b.cashable);
    if (b.periodMode !== undefined) data.periodMode = b.periodMode === "ANNIVERSARY" ? "ANNIVERSARY" : "CALENDAR";
    if (b.prorateMonthly !== undefined) data.prorateMonthly = Boolean(b.prorateMonthly);
    if (b.carryOverMax !== undefined) data.carryOverMax = Math.max(0, Number(b.carryOverMax));
    if (b.waitingMonths !== undefined) data.waitingMonths = Math.max(0, parseInt(b.waitingMonths ?? 0, 10) || 0);
    if (b.allowAdvance !== undefined) data.allowAdvance = Boolean(b.allowAdvance);
    if (b.allowHalfDay !== undefined) data.allowHalfDay = Boolean(b.allowHalfDay);
    if (b.needDocs !== undefined) data.needDocs = Boolean(b.needDocs);
    // Task 99 — policy v2: notice period, batas hari berturut, blackout dates.
    if (b.noticeDays !== undefined) data.noticeDays = Math.max(0, parseInt(b.noticeDays ?? 0, 10) || 0);
    if (b.maxConsecutiveDays !== undefined) data.maxConsecutiveDays = Math.max(0, Number(b.maxConsecutiveDays ?? 0));
    if (b.blackoutDates !== undefined) data.blackoutDates = parseBlackoutJson(b.blackoutDates);
    if (b.active !== undefined) data.active = Boolean(b.active);
    if (b.notes !== undefined) data.notes = b.notes?.trim() || null;
    const type = await db.leaveType.update({ where: { id: b.id }, data });
    return NextResponse.json({ type });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
