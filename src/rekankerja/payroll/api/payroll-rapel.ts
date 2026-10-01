import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/tenant";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { calculateAndSaveRun, nextRunNo } from "@/rekankerja/payroll/services/payroll-service";

type RapelRun = Prisma.PayrollRunGetPayload<{ include: { period: true; processType: true } }>;

interface RapelBreakdownRow {
  periodCode: string;
  periodName: string;
  paid: number;
  expected: number;
  diff: number;
}

// POST /api/rekankerja/payroll-rapel
// Body: { employeeId, componentCode, newAmount, fromPeriodId, toPeriodId,
//         targetPeriodId, preview?, autoRun? }
// Menghitung selisih retroaktif (nilai baru vs dibayar) pada run gaji bulanan yang
// sudah dikonfirmasi/dibayar, lalu menjadwalkan komponen RAPEL pada period target —
// pola Back Pay (fromPeriod → selisih → wageCode back pay).
export async function POST(req: NextRequest) {
  try {
    // Task 79 — guard hak AKSI menu payroll:transactions (Baru rapel) — dulu hanya role-check.
    const m = await requireMenuAction(req, "payroll:transactions", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    // 28-c: item run historis & penulisan komponen rapel memakai field uang
    // terenkripsi — dekripsi saat baca, enkripsi saat tulis.
    const tc = tenantCryptoForDb(db);

    const b = await req.json();
    const { employeeId, componentCode, fromPeriodId, toPeriodId, targetPeriodId } = b;
    const newAmount = Number(b.newAmount);
    const preview = b.preview === true;
    const autoRun = b.autoRun !== false; // default: buat + hitung run rapel

    if (!employeeId || !componentCode || !fromPeriodId || !toPeriodId || !targetPeriodId) {
      return NextResponse.json({ error: "employeeId, componentCode, fromPeriodId, toPeriodId & targetPeriodId wajib" }, { status: 400 });
    }
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return NextResponse.json({ error: "Nilai baru per bulan harus > 0" }, { status: 400 });
    }

    const [employee, fromPeriod, toPeriod, targetPeriod] = await Promise.all([
      db.employee.findUnique({ where: { id: employeeId }, include: { payrollProfile: true } }),
      db.payrollPeriod.findUnique({ where: { id: fromPeriodId } }),
      db.payrollPeriod.findUnique({ where: { id: toPeriodId } }),
      db.payrollPeriod.findUnique({ where: { id: targetPeriodId } }),
    ]);
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    if (!fromPeriod || !toPeriod || !targetPeriod) {
      return NextResponse.json({ error: "Period tidak ditemukan" }, { status: 404 });
    }
    if (targetPeriod.status === "Closed" || targetPeriod.status === "Locked") {
      return NextResponse.json({ error: `Period target ${targetPeriod.name} sudah ${targetPeriod.status}` }, { status: 400 });
    }
    if (fromPeriod.sptYear !== toPeriod.sptYear) {
      return NextResponse.json({ error: "Rapel lintas tahun pajak belum didukung — pilih range dalam satu tahun" }, { status: 400 });
    }

    // Ambil semua period dalam range (urut payPeriod).
    const periodsInRange = await db.payrollPeriod.findMany({
      where: {
        sptYear: fromPeriod.sptYear,
        payPeriod: { gte: Math.min(fromPeriod.payPeriod, toPeriod.payPeriod), lte: Math.max(fromPeriod.payPeriod, toPeriod.payPeriod) },
      },
      orderBy: { payPeriod: "asc" },
    });
    const periodIds = new Set(periodsInRange.map((p) => p.id));

    // Run gaji bulanan yang sudah final dalam range + item komponen karyawan.
    const runs = await db.payrollRun.findMany({
      where: {
        periodId: { in: [...periodIds] },
        status: { in: ["Confirmed", "Paid"] },
        processType: { code: "SALARY" },
      },
      include: {
        period: true,
        lines: { where: { employeeId }, include: { items: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const breakdown: RapelBreakdownRow[] = [];
    for (const p of periodsInRange) {
      const run = runs.find((r) => r.periodId === p.id);
      const line = run?.lines[0];
      const item = line?.items.find((it) => it.code === componentCode);
      const paid = item ? Math.round(tc.decryptMoney(item.amount) ?? 0) : 0;
      const expected = Math.round(newAmount);
      if (!run) continue; // period belum diproses final → di luar lingkup rapel
      breakdown.push({ periodCode: p.code, periodName: p.name, paid, expected, diff: expected - paid });
    }

    if (breakdown.length === 0) {
      return NextResponse.json({ error: "Tidak ada period yang sudah diproses final dalam range rapel" }, { status: 400 });
    }
    const totalDiff = breakdown.reduce((s, r) => s + r.diff, 0);
    if (totalDiff <= 0) {
      return NextResponse.json(
        { error: `Selisih rapel Rp ${totalDiff.toLocaleString("id-ID")} (≤ 0) — nilai baru tidak lebih tinggi dari yang dibayar, atau komponen tidak ditemukan pada riwayat run` },
        { status: 400 }
      );
    }

    if (preview) {
      return NextResponse.json({
        preview: true,
        employee: { employeeNo: employee.employeeNo, fullName: employee.fullName },
        componentCode,
        breakdown,
        totalDiff,
        periods: breakdown.length,
      });
    }

    // M-3a (MAJOR): cegah rapel duplikat — employee + period target + komponen
    // sumber sama. Assignment Specific bersifat MENIMPA (engine memakai nilai
    // assignment terakhir): rapel kedua akan mengganti nilai rapel pertama
    // secara senyap tanpa peringatan. Marker rapel lama tercatat pada notes
    // assignment ("Rapel {kode komponen} ...").
    const dupAssignment = await db.employeeComponentAssignment.findFirst({
      where: {
        employeeId,
        kind: "Specific",
        active: true,
        periodId: targetPeriod.id,
        OR: [
          { wageComponent: { code: componentCode } },
          { wageComponent: { code: "RAPEL" }, notes: { startsWith: `Rapel ${componentCode} ` } },
        ],
      },
    });
    if (dupAssignment) {
      return NextResponse.json(
        { error: `Rapel ${componentCode} untuk ${employee.fullName} pada period ${targetPeriod.name} sudah ada (assignment ${dupAssignment.id}) — hapus assignment lama atau pilih period target lain` },
        { status: 400 }
      );
    }

    // M-3b (MAJOR): assignment rapel hanya dapat diproses run RAPEL yang masih
    // Draft — run Calculated/Confirmed/Paid tidak dapat menghitung assignment
    // baru (rapel "hilang" senyap tanpa peringatan; run tak bisa dihitung ulang).
    const rapelTypeExisting = await db.processType.findFirst({ where: { code: "RAPEL" } });
    if (rapelTypeExisting) {
      const existingRapelRun = await db.payrollRun.findFirst({
        where: { periodId: targetPeriod.id, processTypeId: rapelTypeExisting.id, status: { not: "Cancelled" } },
      });
      if (existingRapelRun && existingRapelRun.status !== "Draft") {
        return NextResponse.json(
          { error: `Run RAPEL ${existingRapelRun.runNo} pada period ${targetPeriod.name} berstatus ${existingRapelRun.status} — assignment rapel hanya dapat diproses run Draft. Batalkan/hapus run tersebut atau pilih period target lain` },
          { status: 400 }
        );
      }
    }

    // Pastikan process type & komponen RAPEL tersedia (db lama belum punya).
    let rapelType = await db.processType.findFirst({ where: { code: "RAPEL" } });
    if (!rapelType) {
      const maxSeq = await db.processType.aggregate({ _max: { sequence: true } });
      rapelType = await db.processType.create({
        data: { code: "RAPEL", name: "Rapel / Back-Pay", sequence: (maxSeq._max.sequence ?? 5) + 1, calculateTax: true },
      });
    }
    let rapelComp = await db.wageComponent.findUnique({ where: { code: "RAPEL" } });
    if (!rapelComp) {
      rapelComp = await db.wageComponent.create({
        data: {
          code: "RAPEL", name: "Back Pay (Rapel)", type: "Earning", wageType: "BackPay",
          calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", sptReference: "Gaji",
        },
      });
    }

    // Komponen specific RAPEL pada period target.
    const assignment = await db.employeeComponentAssignment.create({
      data: {
        employeeId,
        wageComponentId: rapelComp.id,
        kind: "Specific",
        // 28-c: nilai komponen disimpan TERENKRIPSI (enc:v1:n:…).
        amount: tc.encryptMoney(totalDiff),
        periodId: targetPeriod.id,
        processTypeId: rapelType.id,
        basedDate: new Date(),
        notes: `Rapel ${componentCode} ${breakdown[0].periodCode}–${breakdown[breakdown.length - 1].periodCode} (${breakdown.length} period, nilai baru ${Math.round(newAmount).toLocaleString("id-ID")}/bln)`,
      },
      include: { period: true, processType: true },
    });

    let run: RapelRun | null = null;
    if (autoRun) {
      const existing = await db.payrollRun.findFirst({
        where: { periodId: targetPeriod.id, processTypeId: rapelType.id, status: { not: "Cancelled" } },
        include: { period: true, processType: true },
      });
      run = existing ?? await db.payrollRun.create({
        data: {
          runNo: await nextRunNo(db, targetPeriod.code, rapelType.code),
          periodId: targetPeriod.id,
          processTypeId: rapelType.id,
          calculateTax: true,
          notes: `Rapel ${employee.fullName} — ${componentCode} ${breakdown[0].periodCode}–${breakdown[breakdown.length - 1].periodCode}`,
        },
        include: { period: true, processType: true },
      });
      if (run && run.status === "Draft") {
        await calculateAndSaveRun(db, run.id);
        run = await db.payrollRun.findUnique({ where: { id: run.id }, include: { period: true, processType: true } });
      }
    }

    await db.activityLog.create({
      data: {
        action: "Created", entity: "EmployeeComponentAssignment", entityId: assignment.id,
        detail: `Rapel ${employee.fullName}: Rp ${totalDiff.toLocaleString("id-ID")} (${breakdown.length} period) → ${targetPeriod.name}`,
      },
    });

    // 45-b: gate vault (aktor requireMutator) — hanya DTO assignment/run;
    // breakdown/totalDiff = output kalkulasi bisnis (tc raw, tulis tetap benar).
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    return NextResponse.json({
      // 28-c: dekripsi di batas serializer — amount komponen & total run.
      assignment: mv.json(assignment),
      run: run ? mv.json(run) : null,
      breakdown,
      totalDiff,
      periods: breakdown.length,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
