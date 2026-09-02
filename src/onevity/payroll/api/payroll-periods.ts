import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

const fmtDate = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

// GET /api/onevity/payroll-periods
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const periods = await db.payrollPeriod.findMany({
      orderBy: [{ sptYear: "desc" }, { sptMonth: "desc" }],
      include: { _count: { select: { runs: true } } },
    });
    return NextResponse.json({ periods });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/payroll-periods — buat period baru
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.name || !b.startDate || !b.endDate) {
      return NextResponse.json({ error: "Nama, tanggal mulai & selesai wajib diisi" }, { status: 400 });
    }
    const start = new Date(b.startDate);
    const end = new Date(b.endDate);
    if (end < start) return NextResponse.json({ error: "Tanggal selesai sebelum tanggal mulai" }, { status: 400 });

    const sptMonth = Number(b.sptMonth ?? start.getMonth() + 1);
    const sptYear = Number(b.sptYear ?? start.getFullYear());
    const code = b.code ?? `${sptYear}-${String(sptMonth).padStart(2, "0")}`;
    const exists = await db.payrollPeriod.findUnique({ where: { code } });
    if (exists) return NextResponse.json({ error: `Kode period ${code} sudah dipakai` }, { status: 400 });

    // Period dengan sptMonth/Year sama hanya boleh satu (satu payroll per bulan pajak).
    const sameMonth = await db.payrollPeriod.findFirst({ where: { sptMonth, sptYear } });
    if (sameMonth) {
      return NextResponse.json({ error: `Period untuk bulan pajak ${sptMonth}/${sptYear} sudah ada (${sameMonth.name})` }, { status: 400 });
    }

    // M-2 (MAJOR): rentang tanggal period tidak boleh beririsan dengan period
    // lain — dua period menutup hari yang sama memungkinkan 2 run SALARY
    // meng-cover hari identik → gaji pokok dobel + 2 cicilan pinjaman sebulan.
    const overlap = await db.payrollPeriod.findFirst({
      where: { startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlap) {
      return NextResponse.json(
        { error: `Rentang tanggal beririsan dengan period ${overlap.name} (${overlap.code}: ${fmtDate(overlap.startDate)} s.d. ${fmtDate(overlap.endDate)}) — dua period tidak boleh menutup hari yang sama` },
        { status: 400 }
      );
    }

    const period = await db.payrollPeriod.create({
      data: {
        code, name: b.name, payType: b.payType ?? "Monthly",
        startDate: start, endDate: end,
        taStartDate: b.taStartDate ? new Date(b.taStartDate) : null,
        taEndDate: b.taEndDate ? new Date(b.taEndDate) : null,
        payPeriod: sptMonth, sptMonth, sptYear,
        notes: b.notes ?? null,
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "PayrollPeriod", entityId: period.id, detail: `Period payroll ${period.name} dibuat` } });
    return NextResponse.json({ period }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/payroll-periods — update status/notes/processDate
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const period = await db.payrollPeriod.findUnique({ where: { id: b.id }, include: { runs: true } });
    if (!period) return NextResponse.json({ error: "Period tidak ditemukan" }, { status: 404 });

    if (b.status === "Closed" || b.status === "Locked") {
      const open = period.runs.filter((r) => r.status === "Draft" || r.status === "Calculated");
      if (open.length > 0) {
        return NextResponse.json({ error: `Terdapat ${open.length} run belum selesai (Draft/Calculated) — selesaikan dulu sebelum menutup period` }, { status: 400 });
      }
      // M-6 (MAJOR): klaim benefit pay-in-payroll yang masih tertahan pada period
      // ini (Pending/Approved/Scheduled — live: BC-2026-007..009 di 2026-09) akan
      // terjebak permanen bila period ditutup tanpa run BENEFIT.
      const pendingClaims = await db.benefitClaim.count({
        where: { periodId: period.id, status: { in: ["Pending", "Approved", "Scheduled"] } },
      });
      if (pendingClaims > 0) {
        return NextResponse.json(
          { error: `Masih ada ${pendingClaims} klaim benefit belum dibayar (Pending/Approved/Scheduled) pada period ${period.name} — bayar via run payroll BENEFIT, tolak, atau batalkan klaim terlebih dahulu` },
          { status: 400 }
        );
      }
    }
    const updated = await db.payrollPeriod.update({
      where: { id: b.id },
      data: {
        status: b.status,
        notes: b.notes,
        processDate: b.processDate ? new Date(b.processDate) : undefined,
        taStartDate: b.taStartDate ? new Date(b.taStartDate) : undefined,
        taEndDate: b.taEndDate ? new Date(b.taEndDate) : undefined,
      },
    });
    await db.activityLog.create({ data: { action: "Updated", entity: "PayrollPeriod", entityId: b.id, detail: `Period ${period.name}: status → ${b.status ?? updated.status}` } });
    return NextResponse.json({ period: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
