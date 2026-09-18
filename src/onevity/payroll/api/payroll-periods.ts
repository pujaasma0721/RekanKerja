import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

const fmtDate = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

// Nama bulan untuk pembuatan massal 12 period (id-ID, huruf kapital seperti konvensi nama period)
const BULK_MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
const clampDay = (v: number, fb: number) => Math.min(Math.max(Number.isFinite(v) ? Math.trunc(v) : fb, 1), 28);

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

    // ===== Pembuatan massal: 12 period bulanan sekaligus untuk satu tahun =====
    // body: { bulk: true, year, startDay?, useTa?, taStartDay?, taStartMonthOffset?, taEndDay?, taEndMonthOffset? }
    // Bulan yang sudah ada (kode/spt sama/rentang beririsan) dilewati, sisanya dibuat dalam 1 transaksi.
    if (b.bulk) {
      const year = Number(b.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2999) {
        return NextResponse.json({ error: "Tahun tidak valid (2000–2999)" }, { status: 400 });
      }
      const startDay = clampDay(Number(b.startDay), 1);
      const payType = typeof b.payType === "string" && b.payType ? b.payType : "Monthly";
      const useTa = !!b.useTa;
      const taStartDay = clampDay(Number(b.taStartDay), 26);
      const taStartOff = Number.isInteger(Number(b.taStartMonthOffset)) ? Number(b.taStartMonthOffset) : -1;
      const taEndDay = clampDay(Number(b.taEndDay), 25);
      const taEndOff = Number.isInteger(Number(b.taEndMonthOffset)) ? Number(b.taEndMonthOffset) : 0;

      const existing = await db.payrollPeriod.findMany({
        select: { code: true, name: true, sptMonth: true, sptYear: true, startDate: true, endDate: true },
      });
      const planned: { month: number; code: string; start: Date; end: Date; skip?: string }[] = [];
      for (let m = 1; m <= 12; m++) {
        const start = new Date(Date.UTC(year, m - 1, startDay));
        const end = new Date(Date.UTC(year, m, 0)); // hari terakhir bulan
        const code = `${year}-${String(m).padStart(2, "0")}`;
        if (existing.some((p) => p.code === code || (p.sptYear === year && p.sptMonth === m))) {
          planned.push({ month: m, code, start, end, skip: `period ${m}/${year} sudah ada` });
          continue;
        }
        const ov = existing.find((p) => p.startDate <= end && p.endDate >= start);
        if (ov) { planned.push({ month: m, code, start, end, skip: `beririsan dengan ${ov.name}` }); continue; }
        planned.push({ month: m, code, start, end });
      }

      const creatable = planned.filter((r) => !r.skip);
      if (creatable.length === 0) {
        return NextResponse.json({ created: [], skipped: planned.map(({ month, code, skip }) => ({ month, code, reason: skip })) });
      }
      const created = await db.$transaction((tx) =>
        Promise.all(
          creatable.map((r) =>
            tx.payrollPeriod.create({
              data: {
                code: r.code,
                name: `${BULK_MONTHS[r.month - 1]} ${year}`,
                payType,
                startDate: r.start,
                endDate: r.end,
                taStartDate: useTa ? new Date(Date.UTC(year, r.month - 1 + taStartOff, taStartDay)) : null,
                taEndDate: useTa ? new Date(Date.UTC(year, r.month - 1 + taEndOff, taEndDay)) : null,
                payPeriod: r.month,
                sptMonth: r.month,
                sptYear: year,
              },
            })
          )
        )
      );
      await db.activityLog.create({
        data: {
          action: "Created", entity: "PayrollPeriod", entityId: created[0]?.id ?? "-",
          detail: `${created.length} period tahun ${year} dibuat massal (${created.map((p) => p.code).join(", ")})${useTa ? ` · jendela TA ${taStartDay} bln${taStartOff < 0 ? " lalu" : " ini"} → ${taEndDay} bln ini` : ""}`,
        },
      });
      return NextResponse.json(
        { created, skipped: planned.filter((r) => r.skip).map(({ month, code, skip }) => ({ month, code, reason: skip })) },
        { status: 201 }
      );
    }

    if (!b.name || !b.startDate || !b.endDate) {
      return NextResponse.json({ error: "Nama, tanggal mulai & selesai wajib diisi" }, { status: 400 });
    }
    if (b.taStartDate && b.taEndDate && new Date(b.taEndDate) < new Date(b.taStartDate)) {
      return NextResponse.json({ error: "Jendela TA: tanggal selesai sebelum tanggal mulai" }, { status: 400 });
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

// DELETE /api/onevity/payroll-periods — hapus period uji/tertinggal (batch).
// Guard: hanya Open, tanpa run, dan tidak dirujuk klaim benefit/assignment komponen.
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const ids: string[] = Array.isArray(b.ids) ? b.ids : b.id ? [b.id] : [];
    if (ids.length === 0) return NextResponse.json({ error: "ids wajib" }, { status: 400 });

    const deletable = await db.payrollPeriod.findMany({
      where: { id: { in: ids }, status: "Open", runs: { none: {} }, benefitClaims: { none: {} }, componentAssignments: { none: {} } },
      select: { id: true, code: true },
    });
    if (deletable.length < ids.length) {
      const rejected = ids.length - deletable.length;
      return NextResponse.json(
        { error: `${rejected} period tidak bisa dihapus (punya run/klaim/assignment, atau tidak berstatus Open)` },
        { status: 409 }
      );
  }

    const del = await db.payrollPeriod.deleteMany({ where: { id: { in: deletable.map((p) => p.id) } } });
    await db.activityLog.create({
      data: { action: "Deleted", entity: "PayrollPeriod", entityId: deletable[0]?.id ?? "-", detail: `${del.count} period dihapus (${deletable.map((p) => p.code).join(", ")})` },
    });
    return NextResponse.json({ deleted: del.count });
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

    // Jendela TA user-defined — validasi urutan (null = hapus jendela TA, ikut rentang period)
    const nextTaStart = b.taStartDate === null ? null : b.taStartDate ? new Date(b.taStartDate) : period.taStartDate;
    const nextTaEnd = b.taEndDate === null ? null : b.taEndDate ? new Date(b.taEndDate) : period.taEndDate;
    if (nextTaStart && nextTaEnd && nextTaEnd < nextTaStart) {
      return NextResponse.json({ error: "Jendela TA: tanggal selesai sebelum tanggal mulai" }, { status: 400 });
    }

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
        taStartDate: b.taStartDate === null ? null : b.taStartDate ? new Date(b.taStartDate) : undefined,
        taEndDate: b.taEndDate === null ? null : b.taEndDate ? new Date(b.taEndDate) : undefined,
      },
    });
    await db.activityLog.create({ data: { action: "Updated", entity: "PayrollPeriod", entityId: b.id, detail: `Period ${period.name}: status → ${b.status ?? updated.status}` } });
    return NextResponse.json({ period: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
