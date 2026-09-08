import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { calculateAndSaveRun, nextRunNo, getBrackets, getActiveRegulation } from "@/onevity/payroll/services/payroll-service";
import { ptkpValueOf, progressiveTax } from "@/onevity/payroll/services/payroll-engine";

// POST /api/onevity/payroll-bonus-massal — Bonus / THR Massal (T19)
// =====================================================================
// Body:
//   { periodId, processTypeId (BONUS|THR), wageComponentId (Earning, Irregular),
//     target: { mode: all|unit|status|custom, unitIds?, status?, employeeIds? },
//     amountMode: nominal | percent-salary, amount | percent,
//     prorateJoin?: boolean (prorata masa kerja tahun berjalan — PMK 168),
//     dryRun?: boolean, autoRun?: boolean (default true — pola rapel) }
//
// dryRun → PREVIEW: daftar karyawan + jumlah + total + estimasi pajak ireguler
//          ringan (PMK 168 disetahunkan dari gaji profil saat ini).
// commit → EmployeeComponentAssignment Specific (period × processType) per
//          karyawan + run BONUS/THR (buat bila belum ada, hitung via
//          calculateAndSaveRun — pola payroll-rapel autoRun) + ActivityLog.
// Guard: payroll:runs op:calculate (pola payroll-runs — endpoint dapat membuat
//        & menghitung run).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:runs", "op:calculate");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actorLabel = m.actor.appUsername ?? m.actor.name;
    // 28-c: baseSalary terenkripsi (baca) & amount komponen dienkripsi (tulis).
    const tc = tenantCryptoForDb(db);

    const b = await req.json().catch(() => ({}));
    const dryRun = b.dryRun === true;
    const autoRun = b.autoRun !== false; // default: buat + hitung run (pola rapel)

    const { periodId, processTypeId, wageComponentId } = b;
    const target = (b.target ?? {}) as {
      mode?: string; unitIds?: string[]; status?: string; employeeIds?: string[];
    };
    const amountMode = b.amountMode === "percent-salary" ? "percent-salary" : "nominal";
    const amount = Number(b.amount);
    const percent = Number(b.percent);
    const prorateJoin = b.prorateJoin === true;

    // ============ validasi ============
    if (!periodId || !processTypeId || !wageComponentId) {
      return NextResponse.json({ error: "periodId, processTypeId & wageComponentId wajib dipilih" }, { status: 400 });
    }
    if (!["all", "unit", "status", "custom"].includes(target.mode ?? "")) {
      return NextResponse.json({ error: "Target mode harus all / unit / status / custom" }, { status: 400 });
    }
    if (target.mode === "unit" && (!Array.isArray(target.unitIds) || target.unitIds.length === 0)) {
      return NextResponse.json({ error: "Pilih minimal satu unit organisasi untuk target unit" }, { status: 400 });
    }
    if (target.mode === "status" && !target.status) {
      return NextResponse.json({ error: "Pilih status kepegawaian untuk target status" }, { status: 400 });
    }
    if (target.mode === "custom" && (!Array.isArray(target.employeeIds) || target.employeeIds.length === 0)) {
      return NextResponse.json({ error: "Pilih minimal satu karyawan untuk target manual" }, { status: 400 });
    }
    if (amountMode === "nominal" && (!Number.isFinite(amount) || amount <= 0)) {
      return NextResponse.json({ error: "Nominal bonus harus lebih dari 0" }, { status: 400 });
    }
    if (amountMode === "percent-salary" && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
      return NextResponse.json({ error: "Persentase gaji harus di rentang 0-100%" }, { status: 400 });
    }

    const [period, processType, component] = await Promise.all([
      db.payrollPeriod.findUnique({ where: { id: periodId } }),
      db.processType.findUnique({ where: { id: processTypeId } }),
      db.wageComponent.findUnique({ where: { id: wageComponentId } }),
    ]);
    if (!period) return NextResponse.json({ error: "Period payroll tidak ditemukan" }, { status: 404 });
    if (period.status === "Closed" || period.status === "Locked") {
      return NextResponse.json({ error: `Period ${period.name} sudah ${period.status === "Closed" ? "ditutup" : "terkunci"} — pilih period yang masih terbuka` }, { status: 400 });
    }
    if (!processType) return NextResponse.json({ error: "Jenis proses tidak ditemukan" }, { status: 404 });
    if (!["BONUS", "THR"].includes(processType.code)) {
      return NextResponse.json({ error: `Jenis proses harus BONUS atau THR (dipilih: ${processType.code})` }, { status: 400 });
    }
    if (!component) return NextResponse.json({ error: "Komponen upah tidak ditemukan" }, { status: 404 });
    if (!component.active) return NextResponse.json({ error: `Komponen ${component.code} tidak aktif` }, { status: 400 });
    if (component.type !== "Earning" || component.incomeTaxMethod !== "Irregular") {
      return NextResponse.json(
        { error: `Komponen harus pendapatan (Earning) dengan metode pajak Irregular — ${component.code} bertipe ${component.type}/${component.incomeTaxMethod}` },
        { status: 400 },
      );
    }

    // ============ resolusi target karyawan ============
    const employees = await db.employee.findMany({
      where: {
        status: "Active",
        ...(target.mode === "custom" ? { id: { in: target.employeeIds } } : {}),
        assignments: { some: { validTo: null } },
      },
      include: {
        assignments: { where: { validTo: null }, orderBy: { validFrom: "desc" }, take: 1, include: { orgUnit: true, position: true } },
        payrollProfile: { select: { taxStatus: true, hasNpwp: true, processMethod: true } },
      },
      orderBy: { employeeNo: "asc" },
    });

    let list = employees;
    if (target.mode === "unit") {
      // subtree unit: pilih unit = unit itu sendiri + seluruh turunannya
      const allUnits = await db.orgUnit.findMany({ select: { id: true, parentId: true } });
      const byParent = new Map<string | null, string[]>();
      for (const u of allUnits) {
        const arr = byParent.get(u.parentId ?? null) ?? [];
        arr.push(u.id);
        byParent.set(u.parentId ?? null, arr);
      }
      const wanted = new Set<string>();
      const collect = (id: string) => {
        wanted.add(id);
        for (const c of byParent.get(id) ?? []) collect(c);
      };
      for (const id of target.unitIds!) collect(id);
      list = employees.filter((e) => e.assignments[0]?.orgUnitId && wanted.has(e.assignments[0].orgUnitId));
    } else if (target.mode === "status") {
      list = employees.filter((e) => e.assignments[0]?.employmentStatus === target.status);
    }

    if (list.length === 0) {
      return NextResponse.json({ error: "Tidak ada karyawan aktif yang cocok dengan target" }, { status: 400 });
    }

    // ============ hitung jumlah per karyawan ============
    // Prorata THR PMK 168: bulan kerja tahun berjalan / 12 × nominal.
    const yearStart = new Date(period.sptYear, 0, 1);
    const periodEnd = new Date(period.endDate);
    const monthsFactorOf = (joinDate: Date): number => {
      if (!prorateJoin) return 1;
      const from = joinDate > yearStart ? joinDate : yearStart;
      if (from > periodEnd) return 0;
      let months = (periodEnd.getFullYear() - from.getFullYear()) * 12 + (periodEnd.getMonth() - from.getMonth());
      months += (periodEnd.getDate() - from.getDate()) / 30;
      return Math.max(0, Math.min(1, Math.round((months / 12) * 10000) / 10000));
    };

    const rows = list.map((emp) => {
      const assignment = emp.assignments[0];
      // 28-c: gaji pokok tersimpan terenkripsi — dekripsi utk prorata % gaji.
      const baseSalary = assignment ? tc.decryptMoney(assignment.baseSalary) ?? 0 : 0;
      const factor = monthsFactorOf(emp.joinDate);
      const raw = amountMode === "nominal" ? amount : baseSalary * (percent / 100);
      return {
        employeeId: emp.id,
        employeeNo: emp.employeeNo,
        fullName: emp.fullName,
        orgUnitName: assignment?.orgUnit?.name ?? null,
        positionName: assignment?.position?.title ?? null,
        employmentStatus: assignment?.employmentStatus ?? null,
        joinDate: emp.joinDate.toISOString().slice(0, 10),
        baseSalary,
        prorateFactor: factor,
        amount: Math.round(raw * factor),
        taxStatus: emp.payrollProfile?.taxStatus ?? "TK0",
        hasNpwp: emp.payrollProfile?.hasNpwp ?? true,
      };
    });

    const total = rows.reduce((s, r) => s + r.amount, 0);

    // ============ estimasi pajak ireguler RINGAN (preview saja) ============
    // PMK 168/2023 disetahunkan dari gaji profil saat ini: PPh21 progresif atas
    // (neto tahunan + bonus) − PPh21 neto tahunan tanpa bonus. Angka final
    // dihitung engine payroll saat run di-Calculate (konteks YTD nyata).
    let taxEstimate: { perEmployee: Record<string, number>; total: number } | null = null;
    try {
      const [brackets, reg] = await Promise.all([getBrackets(db), getActiveRegulation(db)]);
      const perEmployee: Record<string, number> = {};
      let taxTotal = 0;
      for (const r of rows) {
        const bj = Math.min(r.baseSalary * reg.biayaJabatanRate, reg.biayaJabatanCapMonthly);
        const netoAnnual = (r.baseSalary - bj) * 12;
        const ptkp = ptkpValueOf(r.taxStatus);
        const pkp0 = Math.max(0, Math.floor((netoAnnual - ptkp) / 1000) * 1000);
        const pkp1 = Math.max(0, Math.floor((netoAnnual + r.amount - ptkp) / 1000) * 1000);
        const est = Math.max(0, Math.round(progressiveTax(pkp1, brackets, r.hasNpwp) - progressiveTax(pkp0, brackets, r.hasNpwp)));
        if (est > 0) { perEmployee[r.employeeNo] = est; taxTotal += est; }
      }
      taxEstimate = { perEmployee, total: taxTotal };
    } catch {
      taxEstimate = null; // regulasi/bracket belum tersedia → estimasi dilewati
    }

    const previewPayload = {
      preview: dryRun,
      period: { id: period.id, code: period.code, name: period.name, status: period.status },
      processType: { code: processType.code, name: processType.name },
      component: { code: component.code, name: component.name },
      amountMode,
      ...(amountMode === "nominal" ? { amount } : { percent }),
      prorateJoin,
      target: { mode: target.mode, count: rows.length },
      count: rows.length,
      employees: rows,
      total,
      taxEstimate,
    };
    if (dryRun) return NextResponse.json(previewPayload);

    // ============ KOMIT ============
    // Guard run (pola rapel M-3b): assignment baru hanya bisa diproses run Draft.
    const existingRun = await db.payrollRun.findFirst({
      where: { periodId: period.id, processTypeId: processType.id, status: { not: "Cancelled" } },
      include: { period: true, processType: true },
    });
    if (existingRun && existingRun.status !== "Draft") {
      return NextResponse.json(
        { error: `Run ${existingRun.runNo} pada period ${period.name} berstatus ${existingRun.status} — bonus massal hanya dapat diproses ke run Draft. Batalkan/hapus run tersebut atau pilih period lain` },
        { status: 400 },
      );
    }

    // Assignment Specific per karyawan — skip yang sudah ada (guard duplikat
    // M-3a: assignment Specific menimpa nilai di engine, komit ulang tanpa
    // sengaja akan mengganti nilai sebelumnya secara senyap).
    const existing = await db.employeeComponentAssignment.findMany({
      where: {
        employeeId: { in: rows.map((r) => r.employeeId) },
        kind: "Specific", active: true, periodId: period.id, processTypeId: processType.id,
        wageComponentId: component.id,
      },
      select: { employeeId: true },
    });
    const existingBy = new Set(existing.map((e) => e.employeeId));
    const fresh = rows.filter((r) => !existingBy.has(r.employeeId));
    const skipped = rows.filter((r) => existingBy.has(r.employeeId));

    if (fresh.length === 0) {
      return NextResponse.json(
        {
          error: `Seluruh ${rows.length} karyawan sudah memiliki assignment ${component.code} pada ${period.name} × ${processType.name} — hapus assignment lama (menu Transaksi & Rapel) atau pilih period lain`,
          skipped: skipped.map((s) => s.employeeNo),
        },
        { status: 400 },
      );
    }

    const notes = `${processType.code === "THR" ? "THR" : "Bonus"} massal ${component.name} (${amountMode === "nominal" ? `nominal Rp ${amount.toLocaleString("id-ID")}` : `${percent}% gaji pokok`}${prorateJoin ? ", prorata masa kerja tahun berjalan" : ""})`;
    const createdAssignments: { id: string; employeeId: string; amount: number }[] = [];
    for (const r of fresh) {
      const a = await db.employeeComponentAssignment.create({
        data: {
          employeeId: r.employeeId,
          wageComponentId: component.id,
          kind: "Specific",
          // 28-c: nilai komponen disimpan TERENKRIPSI (enc:v1:n:…).
          amount: tc.encryptMoney(r.amount),
          periodId: period.id,
          processTypeId: processType.id,
          basedDate: new Date(),
          notes,
        },
      });
      createdAssignments.push({ id: a.id, employeeId: r.employeeId, amount: r.amount });
    }

    // Run BONUS/THR — buat bila belum ada, lalu hitung (pola rapel autoRun).
    let run = existingRun;
    let calculated = false;
    if (autoRun) {
      if (!run) {
        run = await db.payrollRun.create({
          data: {
            runNo: await nextRunNo(db, period.code, processType.code),
            periodId: period.id,
            processTypeId: processType.id,
            calculateTax: processType.calculateTax,
            allEmployee: true,
            notes: `${notes} — ${fresh.length} karyawan`,
          },
          include: { period: true, processType: true },
        });
        await db.activityLog.create({
          data: {
            action: "Created", entity: "PayrollRun", entityId: run.id,
            appUserId: m.actor.appUserId ?? undefined,
            detail: `Run ${run.runNo} dibuat otomatis dari ${notes} (${period.name} × ${processType.name})`,
          },
        });
      }
      if (run.status === "Draft") {
        await calculateAndSaveRun(db, run.id);
        calculated = true;
        run = await db.payrollRun.findUnique({ where: { id: run.id }, include: { period: true, processType: true } });
      }
    }

    await db.activityLog.create({
      data: {
        action: "Created", entity: "EmployeeComponentAssignment", entityId: period.id,
        appUserId: m.actor.appUserId ?? undefined,
        detail:
          `${notes} oleh ${actorLabel}: ${fresh.length} karyawan × rata-rata Rp ${Math.round(fresh.reduce((s, r) => s + r.amount, 0) / fresh.length).toLocaleString("id-ID")} = total Rp ${fresh.reduce((s, r) => s + r.amount, 0).toLocaleString("id-ID")} → ${period.name} × ${processType.name}` +
          (skipped.length ? ` (${skipped.length} dilewati — assignment sudah ada)` : "") +
          (run && calculated ? ` — run ${run.runNo} dihitung otomatis` : run ? ` — run ${run.runNo} tersedia (Draft)` : ""),
      },
    });

    return NextResponse.json(
      {
        ...previewPayload,
        preview: false,
        created: createdAssignments.length,
        createdAssignments,
        skipped: skipped.map((s) => ({ employeeNo: s.employeeNo, fullName: s.fullName })),
        run: run ? {
          id: run.id, runNo: run.runNo, status: run.status, employeeCount: run.employeeCount,
          // 28-c: total run terenkripsi — dekripsi utk response.
          totalBruto: tc.decryptMoney(run.totalBruto) ?? 0,
          totalTax: tc.decryptMoney(run.totalTax) ?? 0,
          totalNet: tc.decryptMoney(run.totalNet) ?? 0,
        } : null,
        calculated,
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
