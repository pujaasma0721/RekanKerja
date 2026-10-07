import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { loadPayslipSlip } from "@/rekankerja/payroll/services/payslip-pdf";
import { buildAnnualSpt } from "@/rekankerja/payroll/services/payroll-spt";
import { getActiveRegulation } from "@/rekankerja/payroll/services/payroll-service";
import { terCategoryOf } from "@/rekankerja/payroll/services/payroll-engine";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { MoneyView } from "@/rekankerja/shared/lib/money-view";

// ============================================================================
// RekanKerja Payroll — LAPORAN DISTRIBUSI (dokumen cetak/PDF-ready) ==========
// ============================================================================
// GET /api/rekankerja/payroll-reports/documents
//
// Dua mode:
//   ?_params=1                          → pool parameter (runs, periods, unit,
//                                          bank, tahun pajak)
//   ?_params=employees&runId=|year=      → pool karyawan utk picker payslip /
//                                          bukti potong 1721-A1
//   ?report=<id>&…filter…                → payload dokumen per laporan:
//     r11 payslip         runId, lineId
//     r12 register        runId, unit?
//     r13 bank-transfer    runId, bank?, unit?
//     r21 pph21-monthly   periodId, unit?
//     r22 bukti-potong    year, employeeId
//     r23 pph26           periodId
//     r31 bpjs-tk         runId, unit?
//     r32 bpjs-kesehatan  runId
//     r33 tapera          runId
//     r41 variance        periodId
//     r42 tcow            periodId
//     r43 overtime        runId
//
// Standar setiap dokumen (cetak/PDF): kop perusahaan (nama, NPWP, kota/cabang),
// blok metadata (Periode Penggajian, Tanggal Transfer/Cut-off, Tanggal Dicetak,
// Nama Payroll Officer), tabel rapi (teks kiri / status & NPWP tengah / uang
// kanan), baris grand total, blok persetujuan 3 pihak, nota kerahasiaan
// "SANGAT RAHASIA - DOKUMEN KEUANGAN".
//
// Keamanan (mengikuti kebijakan module):
//   - Guard: LIHAT pada menu payroll:reports ATAU payroll:runs (read-only).
//   - Uang: gerbang MoneyView aktor (45-b) — vault tertutup → null → UI "—".
//   - PII (NPWP / no. rekening): dekripsi tenantCrypto di batas serializer
//     (28-c) — tidak pernah di query/sort.
// ============================================================================

const r0 = (n: number) => Math.round(n);
const FINAL_METHODS = new Set(["FixedRateFinal", "SeveranceFinal", "PensionFinal", "Final2Years"]);

/** "a,b" → ["a","b"] (param list CSV; kosong → array kosong). */
const csvList = (v: string | null): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Kop perusahaan — dipakai semua dokumen (nama, NPWP, alamat, kota). */
async function companyOf(db: TenantDb) {
  const c = await db.company.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: { name: true, code: true, taxId: true, address: true, city: true, phone: true, email: true },
  });
  return c ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["payroll:reports", "payroll:runs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const officer = { name: m.actor.name, printedAt: new Date().toISOString() };

    // ================= POOL PARAMETER =================
    if (sp.get("_params")) {
      const mode = sp.get("_params");

      if (mode === "employees") {
        const runId = sp.get("runId");
        const year = sp.get("year");
        if (runId) {
          const lines = await db.payrollRunLine.findMany({
            where: { runId, run: { status: { in: ["Calculated", "Confirmed", "Paid"] } } },
            orderBy: { employeeNo: "asc" },
            select: { id: true, employeeNo: true, employeeName: true, orgUnitName: true },
          });
          return NextResponse.json({
            employees: lines.map((l) => ({
              lineId: l.id, employeeNo: l.employeeNo, name: l.employeeName, unit: l.orgUnitName,
            })),
          });
        }
        if (year) {
          const y = parseInt(year, 10);
          const lines = await db.payrollRunLine.findMany({
            where: { run: { status: { in: ["Confirmed", "Paid"] }, period: { sptYear: y } } },
            orderBy: { employeeNo: "asc" },
            distinct: ["employeeId"],
            select: { employeeId: true, employeeNo: true, employeeName: true },
          });
          return NextResponse.json({
            employees: lines.map((l) => ({
              employeeId: l.employeeId, employeeNo: l.employeeNo, name: l.employeeName,
            })),
          });
        }
        return NextResponse.json({ error: "runId / year wajib untuk pool karyawan" }, { status: 400 });
      }

      // ---- pool utama ----
      const runs = await db.payrollRun.findMany({
        where: { status: { in: ["Calculated", "Confirmed", "Paid"] } },
        include: { period: true, processType: true },
        orderBy: [{ period: { startDate: "desc" } }, { createdAt: "desc" }],
      });
      const orgUnits = await db.payrollRunLine.groupBy({
        by: ["orgUnitName"],
        _count: { _all: true },
        orderBy: { orgUnitName: "asc" },
      });
      const banks = await db.employeePayrollProfile.findMany({
        where: { bankName: { not: null }, active: true },
        distinct: ["bankName"],
        select: { bankName: true },
        orderBy: { bankName: "asc" },
      });
      const periods = await db.payrollPeriod.findMany({
        where: { runs: { some: { status: { in: ["Calculated", "Confirmed", "Paid"] } } } },
        include: { _count: { select: { runs: true } } },
        orderBy: { startDate: "desc" },
      });
      return NextResponse.json({
        runs: runs.map((r) => ({
          id: r.id, runNo: r.runNo, status: r.status,
          periodId: r.periodId, periodName: r.period.name, periodCode: r.period.code,
          sptMonth: r.period.sptMonth, sptYear: r.period.sptYear,
          processTypeName: r.processType.name,
          employeeCount: r.employeeCount,
          paidAt: r.paidAt, confirmedAt: r.confirmedAt,
        })),
        periods: periods.map((p) => ({
          id: p.id, name: p.name, code: p.code, sptMonth: p.sptMonth, sptYear: p.sptYear,
          status: p.status, runCount: p._count.runs,
        })),
        orgUnits: orgUnits.map((u) => ({ name: u.orgUnitName?.trim() || "Tanpa Unit", count: u._count._all })).filter((u) => u.name),
        banks: banks.map((b) => ({ name: b.bankName! })).filter((b) => b.name),
        years: [...new Set(periods.map((p) => p.sptYear))].sort((a, b) => b - a),
      });
    }

    // ================= DOKUMEN =================
    const report = sp.get("report");
    if (!report) return NextResponse.json({ error: "report wajib" }, { status: 400 });

    const mv = await moneyViewForReq(req, db);
    const tc = tenantCryptoForDb(db);
    const dm = (v: string | null): number | null => (mv.canSee ? (mv.dec(v) ?? 0) : null);

    const company = await companyOf(db);

    /** Muat run + validasi status (Draft/Cancelled ditolak). */
    const loadRun = async (runId: string) => {
      const run = await db.payrollRun.findUnique({
        where: { id: runId },
        include: { period: true, processType: true },
      });
      if (!run) throw httpErr(404, "Run tidak ditemukan");
      if (run.status === "Draft" || run.status === "Cancelled") {
        throw httpErr(400, `Run ${run.runNo} berstatus ${run.status} — hitung (calculate) payroll terlebih dahulu`);
      }
      return run;
    };
    const runMeta = (r: Awaited<ReturnType<typeof loadRun>>) => ({
      id: r.id, runNo: r.runNo, status: r.status,
      periodId: r.periodId, periodName: r.period.name, periodCode: r.period.code,
      sptMonth: r.period.sptMonth, sptYear: r.period.sptYear,
      processTypeName: r.processType.name,
      paidAt: r.paidAt, confirmedAt: r.confirmedAt, calculatedAt: r.calculatedAt,
      employeeCount: r.employeeCount,
    });

    switch (report) {
      // ------------------------------------------------------------- R1.1 ----
      case "r11": {
        const runId = sp.get("runId");
        const lineId = sp.get("lineId");
        if (!runId || !lineId) return NextResponse.json({ error: "runId & lineId wajib" }, { status: 400 });
        const run = await loadRun(runId);
        const slip = await loadPayslipSlip(db, lineId, mv);
        if (!slip) return NextResponse.json({ error: "Baris karyawan tidak ditemukan pada run ini" }, { status: 404 });
        if (slip.runId !== runId) return NextResponse.json({ error: "Slip tidak berada pada run terpilih" }, { status: 400 });
        return NextResponse.json({
          report, company, run: runMeta(run), officer, filters: { lineId },
          slip: {
            ...slip,
            paidAt: run.paidAt, runStatus: run.status,
            periodName: run.period.name, periodCode: run.period.code, processName: run.processType.name,
          },
        });
      }

      // ------------------------------------------------------------- R1.2 ----
      case "r12": {
        const runId = sp.get("runId");
        if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });
        const run = await loadRun(runId);
        const units = csvList(sp.get("unit"));
        const lines = (await db.payrollRunLine.findMany({
          where: { runId, ...(units.length ? { orgUnitName: { in: units } } : {}) },
          orderBy: [{ orgUnitName: "asc" }, { employeeNo: "asc" }],
          include: { items: { orderBy: { sortOrder: "asc" } } },
        }));
        // kolom komponen dinamis (penghasilan → potongan; urutan kemunculan)
        const colMap = new Map<string, { code: string; name: string; type: string }>();
        for (const l of lines) for (const it of l.items) {
          if (!colMap.has(it.code)) colMap.set(it.code, { code: it.code, name: it.name, type: it.type });
        }
        const rank: Record<string, number> = { Earning: 0, Deduction: 1, Informational: 2 };
        const columns = [...colMap.values()].sort((a, b) => (rank[a.type] ?? 3) - (rank[b.type] ?? 3));
        const rows = lines.map((l) => {
          const per: Record<string, number | null> = {};
          for (const it of l.items) per[it.code] = dm(it.amount);
          const tax = (dm(l.taxRegular) ?? 0) + (dm(l.taxIrregular) ?? 0);
          return {
            employeeNo: l.employeeNo, employeeName: l.employeeName,
            orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit", positionName: l.positionName ?? "-",
            ptkpStatus: l.ptkpStatus, umkWarning: l.umkWarning,
            per, bruto: dm(l.bruto), deduction: dm(l.deduction),
            tax: mv.canSee ? tax : null, net: dm(l.net),
          };
        });
        const perCol: Record<string, number | null> = {};
        for (const c of columns) {
          if (!mv.canSee) { perCol[c.code] = null; continue; }
          perCol[c.code] = r0(rows.reduce((s, l) => s + (l.per[c.code] ?? 0), 0));
        }
        const sumOf = (f: (l: (typeof rows)[number]) => number | null) =>
          mv.canSee ? r0(rows.reduce((s, l) => s + (f(l) ?? 0), 0)) : null;
        return NextResponse.json({
          report, company, run: runMeta(run), officer, filters: { unit: units },
          columns, rows,
          totals: {
            employees: rows.length,
            perColumn: perCol,
            totalBruto: sumOf((l) => l.bruto), totalDeduction: sumOf((l) => l.deduction),
            totalTax: sumOf((l) => l.tax), totalNet: sumOf((l) => l.net),
            umkWarnings: rows.filter((l) => l.umkWarning).length,
          },
        });
      }

      // ------------------------------------------------------------- R1.3 ----
      case "r13": {
        const runId = sp.get("runId");
        if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });
        const run = await loadRun(runId);
        const bank = (sp.get("bank") ?? "").trim();
        const units = csvList(sp.get("unit"));
        const lines = await db.payrollRunLine.findMany({
          where: { runId, ...(units.length ? { orgUnitName: { in: units } } : {}) },
          orderBy: { employeeNo: "asc" },
          include: { employee: { include: { payrollProfile: true } } },
        });
        const bankOf = (l: (typeof lines)[number]) =>
          (l.employee?.payrollProfile?.bankName ?? l.employee?.bankName ?? "").trim() || "Tanpa Bank";
        const accOf = (l: (typeof lines)[number]) =>
          tc.decryptText(l.employee?.payrollProfile?.bankAccount) ?? tc.decryptText(l.employee?.bankAccount) ?? "";
        const filtered = bank ? lines.filter((l) => bankOf(l).toUpperCase().includes(bank.toUpperCase())) : lines;
        const groups: { bank: string; rows: { employeeNo: string; name: string; orgUnitName: string; account: string; net: number | null; tax: number | null }[]; subtotalNet: number | null }[] = [];
        for (const l of filtered) {
          const b = bankOf(l);
          let g = groups.find((x) => x.bank === b);
          if (!g) { g = { bank: b, rows: [], subtotalNet: 0 }; groups.push(g); }
          g.rows.push({
            employeeNo: l.employeeNo, name: l.employeeName,
            orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit",
            account: accOf(l), net: dm(l.net),
            tax: mv.canSee ? r0((dm(l.taxRegular) ?? 0) + (dm(l.taxIrregular) ?? 0)) : null,
          });
          g.subtotalNet = (g.subtotalNet ?? 0) + (dm(l.net) ?? 0);
        }
        groups.sort((a, b) => a.bank.localeCompare(b.bank));
        const totalNet = mv.canSee
          ? r0(filtered.reduce((s, l) => s + (dm(l.net) ?? 0), 0))
          : null;
        return NextResponse.json({
          report, company, run: runMeta(run), officer,
          filters: { bank: bank || null, unit: units },
          groups,
          totals: {
            employees: filtered.length, banks: groups.length,
            totalNet,
            totalTax: mv.canSee ? r0(filtered.reduce((s, l) => s + (dm(l.taxRegular) ?? 0) + (dm(l.taxIrregular) ?? 0), 0)) : null,
          },
        });
      }

      // ------------------------------------------------------------- R2.1 ----
      case "r21": {
        const periodId = sp.get("periodId");
        if (!periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
        const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!period) return NextResponse.json({ error: "Periode tidak ditemukan" }, { status: 404 });
        const units = csvList(sp.get("unit"));
        const runs = await db.payrollRun.findMany({
          where: { periodId, status: { in: ["Confirmed", "Paid"] } },
          include: {
            lines: {
              where: units.length ? { orgUnitName: { in: units } } : {},
              orderBy: { employeeNo: "asc" },
              include: { employee: { include: { payrollProfile: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        });
        if (runs.length === 0) {
          return NextResponse.json({ error: `Belum ada run Confirmed/Paid pada periode ${period.name}` }, { status: 400 });
        }
        const byEmp = new Map<string, {
          employeeNo: string; name: string; orgUnitName: string; npwp: string | null;
          ptkpStatus: string; bruto: number; tax: number; net: number;
        }>();
        for (const run of runs) for (const l of run.lines) {
          const cur = byEmp.get(l.employeeId) ?? {
            employeeNo: l.employeeNo, employeeName: "", orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit",
            name: l.employeeName,
            npwp: tc.decryptText(l.employee?.payrollProfile?.npwp) ?? tc.decryptText(l.employee?.taxId),
            ptkpStatus: l.ptkpStatus, bruto: 0, tax: 0, net: 0,
          };
          cur.bruto += dm(l.bruto) ?? 0;
          cur.tax += (dm(l.taxRegular) ?? 0) + (dm(l.taxIrregular) ?? 0);
          cur.net += dm(l.net) ?? 0;
          byEmp.set(l.employeeId, cur);
        }
        const rows = [...byEmp.values()].map((r) => ({
          ...r,
          terCategory: terCategoryOf(r.ptkpStatus),
          effectiveRatePct: mv.canSee && r.bruto > 0 ? (r.tax / r.bruto) * 100 : null,
          bruto: mv.canSee ? r0(r.bruto) : null, tax: mv.canSee ? r0(r.tax) : null, net: mv.canSee ? r0(r.net) : null,
        })).sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
        let useTer = false;
        try { useTer = (await getActiveRegulation(db)).useTer; } catch { /* seedless */ }
        return NextResponse.json({
          report, company, officer, filters: { unit: units },
          period: { id: period.id, name: period.name, code: period.code, sptMonth: period.sptMonth, sptYear: period.sptYear, status: period.status },
          runs: runs.map((r) => r.runNo),
          rows,
          totals: {
            employees: rows.length,
            totalBruto: mv.canSee ? r0(rows.reduce((s, r) => s + (r.bruto ?? 0), 0)) : null,
            totalTax: mv.canSee ? r0(rows.reduce((s, r) => s + (r.tax ?? 0), 0)) : null,
            totalNet: mv.canSee ? r0(rows.reduce((s, r) => s + (r.net ?? 0), 0)) : null,
          },
          regulation: { useTer },
        });
      }

      // ------------------------------------------------------------- R2.2 ----
      case "r22": {
        const year = parseInt(sp.get("year") ?? "", 10);
        const employeeId = sp.get("employeeId");
        if (!year || !employeeId) return NextResponse.json({ error: "year & employeeId wajib" }, { status: 400 });
        const spt = await buildAnnualSpt(db, year, mv);
        const emp = spt.employees.find((e) => e.employeeId === employeeId);
        if (!emp) return NextResponse.json({ error: "Karyawan tidak memiliki data payroll final pada tahun tersebut" }, { status: 404 });
        // Nomor bukti potong — konvensi e-Bupot: 21.0-<masa>-<urut>
        const formNo = `21.0-${String(emp.monthLast ?? 12).padStart(2, "0")}-${emp.employeeNo.replace(/\D/g, "").padStart(6, "0")}`;
        return NextResponse.json({ report, company, officer, year, formNo, employee: emp });
      }

      // ------------------------------------------------------------- R2.3 ----
      case "r23": {
        const periodId = sp.get("periodId");
        if (!periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
        const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!period) return NextResponse.json({ error: "Periode tidak ditemukan" }, { status: 404 });
        const runs = await db.payrollRun.findMany({
          where: { periodId, status: { in: ["Confirmed", "Paid"] } },
          include: { lines: { include: { items: true, employee: { include: { payrollProfile: true } } } } },
          orderBy: { createdAt: "asc" },
        });
        // Populasi: baris dengan komponen penghasilan metode FINAL (PPh 26 /
        // final rate) — basis potongan 20% atas bruto final (UU PPh Ps. 26).
        const byEmp = new Map<string, { employeeNo: string; name: string; orgUnitName: string; npwp: string | null; country: string; brutoFinal: number }>();
        for (const run of runs) for (const l of run.lines) {
          const finals = l.items.filter((it) => it.type === "Earning" && FINAL_METHODS.has(it.incomeTaxMethod));
          if (finals.length === 0) continue;
          const cur = byEmp.get(l.employeeId) ?? {
            employeeNo: l.employeeNo, name: l.employeeName,
            orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit",
            npwp: tc.decryptText(l.employee?.payrollProfile?.npwp) ?? tc.decryptText(l.employee?.taxId),
            country: "—", brutoFinal: 0,
          };
          cur.brutoFinal += finals.reduce((s, it) => s + (dm(it.amount) ?? 0), 0);
          byEmp.set(l.employeeId, cur);
        }
        const RATE_26 = 0.2; // Pasal 26(1)(a): 20% atas bruto
        const rows = [...byEmp.values()].map((r) => ({
          ...r,
          brutoFinal: mv.canSee ? r0(r.brutoFinal) : null,
          tax26: mv.canSee ? r0(r.brutoFinal * RATE_26) : null,
        })).sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
        return NextResponse.json({
          report, company, officer,
          period: { id: period.id, name: period.name, code: period.code, sptMonth: period.sptMonth, sptYear: period.sptYear },
          rows,
          totals: {
            employees: rows.length,
            totalBrutoFinal: mv.canSee ? r0(rows.reduce((s, r) => s + (r.brutoFinal ?? 0), 0)) : null,
            totalTax26: mv.canSee ? r0(rows.reduce((s, r) => s + (r.tax26 ?? 0), 0)) : null,
          },
        });
      }

      // ------------------------------------------------------------- R3.x ----
      case "r31":
      case "r32":
      case "r33": {
        const runId = sp.get("runId");
        if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });
        const run = await loadRun(runId);
        const units = csvList(sp.get("unit"));
        const lines = await db.payrollRunLine.findMany({
          where: { runId, ...(units.length ? { orgUnitName: { in: units } } : {}) },
          orderBy: { employeeNo: "asc" },
          include: { items: true, employee: { select: { nationalId: true, bpjsHealth: true } } },
        });

        // klasifikasi program BPJS (urutan: JPK/JKN/JKK/JKM/JKP sebelum JP)
        const basisOf = (code: string, name: string): string | null => {
          const s = `${code} ${name}`.toUpperCase().replace(/\s+/g, "");
          if (s.includes("JHT")) return "JHT";
          if (s.includes("JPK") || s.includes("JKN") || s.includes("KESEHATAN")) return "JKN";
          if (s.includes("JKK")) return "JKK";
          if (s.includes("JKM")) return "JKM";
          if (s.includes("JKP")) return "JKP";
          if (s.includes("JP")) return "JP";
          if (s.includes("TAPERA")) return "TAPERA";
          return null;
        };

        if (report === "r33") {
          // Tapera — item komponen TAPERA (perusahaan / pegawai)
          const rows = lines.map((l) => {
            let companyPart = 0, employeePart = 0;
            for (const it of l.items) {
              if (basisOf(it.code, it.name) !== "TAPERA") continue;
              if (it.type === "Earning") companyPart += dm(it.amount) ?? 0;
              else if (it.type === "Deduction") employeePart += dm(it.amount) ?? 0;
            }
            return {
              employeeNo: l.employeeNo, employeeName: l.employeeName,
              orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit",
              companyPart: mv.canSee ? r0(companyPart) : null,
              employeePart: mv.canSee ? r0(employeePart) : null,
            };
          }).filter((r) => (r.companyPart ?? 0) > 0 || (r.employeePart ?? 0) > 0);
          return NextResponse.json({
            report, company, run: runMeta(run), officer, filters: { unit: units },
            rows,
            totals: {
              employees: rows.length,
              totalCompany: mv.canSee ? r0(rows.reduce((s, r) => s + (r.companyPart ?? 0), 0)) : null,
              totalEmployee: mv.canSee ? r0(rows.reduce((s, r) => s + (r.employeePart ?? 0), 0)) : null,
            },
          });
        }

        // r31 / r32 — rekap iuran dari snapshot item Jamsostek
        const rows = lines.map((l) => {
          const b: Record<string, number> = { jhtC: 0, jhtE: 0, jpC: 0, jpE: 0, jkk: 0, jkm: 0, jknC: 0, jknE: 0 };
          for (const it of l.items) {
            if (it.wageType !== "Jamsostek") continue;
            const basis = basisOf(it.code, it.name);
            if (!basis) continue;
            const isCompany = it.type === "Earning";
            if (basis === "JHT") b[isCompany ? "jhtC" : "jhtE"] += dm(it.amount) ?? 0;
            else if (basis === "JP") b[isCompany ? "jpC" : "jpE"] += dm(it.amount) ?? 0;
            else if (basis === "JKK") b.jkk += dm(it.amount) ?? 0;
            else if (basis === "JKM") b.jkm += dm(it.amount) ?? 0;
            else if (basis === "JKN") b[isCompany ? "jknC" : "jknE"] += dm(it.amount) ?? 0;
          }
          return {
            employeeNo: l.employeeNo, employeeName: l.employeeName,
            orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit",
            nik: tc.decryptText(l.employee?.nationalId),
            bpjsKes: tc.decryptText(l.employee?.bpjsHealth),
            jhtCompany: mv.canSee ? r0(b.jhtC) : null, jhtEmployee: mv.canSee ? r0(b.jhtE) : null,
            jpCompany: mv.canSee ? r0(b.jpC) : null, jpEmployee: mv.canSee ? r0(b.jpE) : null,
            jkk: mv.canSee ? r0(b.jkk) : null, jkm: mv.canSee ? r0(b.jkm) : null,
            jknCompany: mv.canSee ? r0(b.jknC) : null, jknEmployee: mv.canSee ? r0(b.jknE) : null,
            jknBasis: mv.canSee && b.jknC > 0 ? r0(b.jknC) : null,
          };
        });
        const sum = (f: (r: (typeof rows)[number]) => number | null) =>
          mv.canSee ? r0(rows.reduce((s, r) => s + (f(r) ?? 0), 0)) : null;
        let reg: Awaited<ReturnType<typeof getActiveRegulation>> | null = null;
        try { reg = await getActiveRegulation(db); } catch { /* seedless */ }
        const totals = {
          employees: rows.length,
          jhtCompany: sum((r) => r.jhtCompany), jhtEmployee: sum((r) => r.jhtEmployee),
          jpCompany: sum((r) => r.jpCompany), jpEmployee: sum((r) => r.jpEmployee),
          jkk: sum((r) => r.jkk), jkm: sum((r) => r.jkm),
          jknCompany: sum((r) => r.jknCompany), jknEmployee: sum((r) => r.jknEmployee),
        };
        if (report === "r32") {
          const kes = rows.map((r) => ({
            ...r,
            upah: mv.canSee && reg && reg.jpkCompanyRate > 0 && (r.jknCompany ?? 0) >= 0
              ? r0((r.jknCompany ?? 0) / reg.jpkCompanyRate) : null,
          }));
          return NextResponse.json({
            report, company, run: runMeta(run), officer, filters: { unit: units },
            rows: kes,
            totals: { employees: kes.length, jknCompany: totals.jknCompany, jknEmployee: totals.jknEmployee },
            regulation: reg ? {
              jpkCompanyRate: reg.jpkCompanyRate, jpkEmployeeRate: reg.jpkEmployeeRate, jpkSalaryCap: reg.jpkSalaryCap,
            } : null,
          });
        }
        return NextResponse.json({
          report, company, run: runMeta(run), officer, filters: { unit: units },
          rows, totals,
          regulation: reg ? {
            jhtCompanyRate: reg.jhtCompanyRate, jhtEmployeeRate: reg.jhtEmployeeRate,
            jpCompanyRate: reg.jpCompanyRate, jpEmployeeRate: reg.jpEmployeeRate,
            jkkRate: reg.jkkRate, jkmRate: reg.jkmRate, jpSalaryCap: reg.jpSalaryCap,
          } : null,
        });
      }

      // ------------------------------------------------------------- R4.1 ----
      case "r41": {
        const periodId = sp.get("periodId");
        if (!periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
        const cur = await db.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!cur) return NextResponse.json({ error: "Periode tidak ditemukan" }, { status: 404 });
        // periode sebelumnya: period terdekat sebelum current yang punya run final
        const prev = await db.payrollPeriod.findFirst({
          where: { startDate: { lt: cur.startDate }, runs: { some: { status: { in: ["Confirmed", "Paid"] } } } },
          orderBy: { startDate: "desc" },
        });
        const loadPeriodTotals = async (p: typeof cur | null) => {
          if (!p) return { employees: 0, bruto: 0, deduction: 0, tax: 0, net: 0, runs: 0 as number, byUnit: new Map<string, { bruto: number; net: number; employees: Set<string> }>() };
          const runs = await db.payrollRun.findMany({
            where: { periodId: p.id, status: { in: ["Confirmed", "Paid"] } },
            include: { lines: true },
          });
          const t = { employees: 0, bruto: 0, deduction: 0, tax: 0, net: 0, runs: runs.length, byUnit: new Map<string, { bruto: number; net: number; employees: Set<string> }>() };
          const seen = new Set<string>();
          for (const run of runs) for (const l of run.lines) {
            const unit = l.orgUnitName?.trim() || "Tanpa Unit";
            const u = t.byUnit.get(unit) ?? { bruto: 0, net: 0, employees: new Set<string>() };
            u.bruto += dm(l.bruto) ?? 0; u.net += dm(l.net) ?? 0; u.employees.add(l.employeeId);
            t.byUnit.set(unit, u);
            if (!seen.has(l.employeeId)) { seen.add(l.employeeId); t.employees += 1; }
            t.bruto += dm(l.bruto) ?? 0; t.deduction += dm(l.deduction) ?? 0;
            t.tax += (dm(l.taxRegular) ?? 0) + (dm(l.taxIrregular) ?? 0); t.net += dm(l.net) ?? 0;
          }
          return t;
        };
        const c = await loadPeriodTotals(cur);
        const p = prev ? await loadPeriodTotals(prev) : null;
        const mk = (label: string, curv: number, prevv: number | null, money = true) => {
          const delta = prevv == null ? null : curv - prevv;
          const deltaPct = prevv == null || prevv === 0 ? null : (delta! / prevv) * 100;
          return { label, current: curv, previous: prevv, delta, deltaPct, money, anomaly: deltaPct != null && Math.abs(deltaPct) >= 10 };
        };
        return NextResponse.json({
          report, company, officer,
          current: { id: cur.id, name: cur.name, code: cur.code, sptMonth: cur.sptMonth, sptYear: cur.sptYear },
          previous: prev ? { id: prev.id, name: prev.name, code: prev.code, sptMonth: prev.sptMonth, sptYear: prev.sptYear } : null,
          summary: [
            mk("Jumlah Karyawan Dibayar", c.employees, p ? p.employees : null, false),
            mk("Total Bruto", c.bruto, p ? p.bruto : null),
            mk("Total Potongan", c.deduction, p ? p.deduction : null),
            mk("Total PPh 21", c.tax, p ? p.tax : null),
            mk("Total Take Home Pay", c.net, p ? p.net : null),
          ].map((s) => (mv.canSee ? s : { ...s, current: 0, previous: 0, delta: 0, deltaPct: 0 })),
          byUnit: [...new Set([...c.byUnit.keys(), ...(p ? [...p.byUnit.keys()] : [])])]
            .sort((a, b) => a.localeCompare(b))
            .map((unit) => {
              const cu = c.byUnit.get(unit), pu = p?.byUnit.get(unit);
              const brutoC = cu?.bruto ?? 0, brutoP = pu?.bruto ?? 0;
              const delta = p == null ? null : brutoC - brutoP;
              return {
                unit,
                employeesCur: cu?.employees.size ?? 0, employeesPrev: pu?.employees.size ?? 0,
                brutoCur: mv.canSee ? r0(brutoC) : null, brutoPrev: mv.canSee ? r0(brutoP) : null,
                netCur: mv.canSee ? r0(cu?.net ?? 0) : null,
                delta: mv.canSee ? (delta == null ? null : r0(delta)) : null,
                deltaPct: p == null || brutoP === 0 ? null : ((brutoC - brutoP) / brutoP) * 100,
              };
            }),
        });
      }

      // ------------------------------------------------------------- R4.2 ----
      case "r42": {
        const periodId = sp.get("periodId");
        if (!periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
        const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!period) return NextResponse.json({ error: "Periode tidak ditemukan" }, { status: 404 });
        const runs = await db.payrollRun.findMany({
          where: { periodId, status: { in: ["Confirmed", "Paid"] } },
          include: { lines: { include: { items: true } } },
          orderBy: { createdAt: "asc" },
        });
        if (runs.length === 0) {
          return NextResponse.json({ error: `Belum ada run Confirmed/Paid pada periode ${period.name}` }, { status: 400 });
        }
        const byUnit = new Map<string, { employees: Set<string>; net: number; tax: number; taxAllowance: number; bpjsCompany: number }>();
        for (const run of runs) for (const l of run.lines) {
          const unit = l.orgUnitName?.trim() || "Tanpa Unit";
          const u = byUnit.get(unit) ?? { employees: new Set<string>(), net: 0, tax: 0, taxAllowance: 0, bpjsCompany: 0 };
          u.employees.add(l.employeeId);
          u.net += dm(l.net) ?? 0;
          u.tax += (dm(l.taxRegular) ?? 0) + (dm(l.taxIrregular) ?? 0);
          for (const it of l.items) {
            const s = `${it.code} ${it.name}`.toUpperCase().replace(/\s+/g, "");
            if (it.type === "Earning" && it.wageType === "Jamsostek") u.bpjsCompany += dm(it.amount) ?? 0;
            else if (it.type === "Earning" && (s.includes("TAX_ALLOW") || s.includes("TUNJANGANPPH"))) u.taxAllowance += dm(it.amount) ?? 0;
          }
          byUnit.set(unit, u);
        }
        const rows = [...byUnit.entries()].map(([unit, u]) => ({
          unit, employees: u.employees.size,
          net: mv.canSee ? r0(u.net) : null,
          tax: mv.canSee ? r0(u.tax) : null,
          taxAllowance: mv.canSee ? r0(u.taxAllowance) : null,
          bpjsCompany: mv.canSee ? r0(u.bpjsCompany) : null,
          totalCost: mv.canSee ? r0(u.net + u.tax + u.bpjsCompany) : null,
        })).sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0));
        const t = rows.reduce(
          (acc, r) => ({
            employees: acc.employees + r.employees, net: acc.net + (r.net ?? 0), tax: acc.tax + (r.tax ?? 0),
            taxAllowance: acc.taxAllowance + (r.taxAllowance ?? 0), bpjsCompany: acc.bpjsCompany + (r.bpjsCompany ?? 0),
            totalCost: acc.totalCost + (r.totalCost ?? 0),
          }),
          { employees: 0, net: 0, tax: 0, taxAllowance: 0, bpjsCompany: 0, totalCost: 0 },
        );
        return NextResponse.json({
          report, company, officer,
          period: { id: period.id, name: period.name, code: period.code, sptMonth: period.sptMonth, sptYear: period.sptYear },
          runs: runs.map((r) => r.runNo),
          rows,
          totals: mv.canSee ? {
            employees: t.employees,
            net: r0(t.net), tax: r0(t.tax), taxAllowance: r0(t.taxAllowance),
            bpjsCompany: r0(t.bpjsCompany), totalCost: r0(t.totalCost),
            costPerEmployee: t.employees > 0 ? r0(t.totalCost / t.employees) : 0,
          } : null,
        });
      }

      // ------------------------------------------------------------- R4.3 ----
      case "r43": {
        const runId = sp.get("runId");
        if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });
        const run = await loadRun(runId);
        const lines = await db.payrollRunLine.findMany({
          where: { runId },
          include: { items: true },
          orderBy: { employeeNo: "asc" },
        });
        // LEMBUR item per karyawan (nominal di run)
        const otAmount = new Map<string, number>();
        const basicAmount = new Map<string, number>();
        for (const l of lines) {
          for (const it of l.items) {
            if (it.wageType === "Overtime") otAmount.set(l.employeeId, (otAmount.get(l.employeeId) ?? 0) + (dm(it.amount) ?? 0));
            if (it.code === "BASIC") basicAmount.set(l.employeeId, dm(it.amount) ?? 0);
          }
        }
        // Order lembur yang dibayar run ini (paidRunNo)
        const orders = await db.overtimeOrder.findMany({
          where: { paidRunNo: run.runNo, status: "Paid" },
          include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
          orderBy: { overtimeDate: "asc" },
        });
        const byEmp = new Map<string, { employeeNo: string; name: string; unit: string | null; orders: number; minutes: number; indexes: Set<string>; basic: number | null; runAmount: number }>();
        const lineByEmp = new Map(lines.map((l) => [l.employeeId, l]));
        const ensureRow = (employeeId: string) => {
          let row = byEmp.get(employeeId);
          if (!row) {
            const l = lineByEmp.get(employeeId);
            row = {
              employeeNo: l?.employeeNo ?? orders.find((o) => o.employeeId === employeeId)?.employee.employeeNo ?? "-",
              name: l?.employeeName ?? orders.find((o) => o.employeeId === employeeId)?.employee.fullName ?? "-",
              unit: l?.orgUnitName ?? null, orders: 0, minutes: 0, indexes: new Set<string>(),
              basic: mv.canSee ? (basicAmount.get(employeeId) ?? null) : null, runAmount: 0,
            };
            byEmp.set(employeeId, row);
          }
          return row;
        };
        // baris dari order (punya menit) + baris dari item LEMBUR tanpa order
        for (const o of orders) {
          const row = ensureRow(o.employeeId);
          row.orders += 1;
          row.minutes += o.verifiedMinutes;
          row.indexes.add(`×${o.rateMultiplier}`);
        }
        for (const [employeeId, amt] of otAmount) {
          const row = ensureRow(employeeId);
          row.runAmount += amt;
        }
        const rows = [...byEmp.entries()].map(([employeeId, r]) => {
          const basic = r.basic;
          const hourly = basic != null && basic > 0 ? basic / 173 : null; // Kepmen 102/2004: 1/173
          const estimated =
            mv.canSee && hourly != null && r.minutes > 0
              ? orders.filter((o) => o.employeeId === employeeId)
                  .reduce((s, o) => s + (o.verifiedMinutes / 60) * o.rateMultiplier * hourly, 0)
              : null;
          return {
            employeeId, employeeNo: r.employeeNo, employeeName: r.name, orgUnitName: r.unit ?? "Tanpa Unit",
            orders: r.orders, minutes: r.minutes, index: [...r.indexes].sort().join(", ") || "—",
            hourlyRate: hourly != null ? r0(hourly) : null,
            estimated: estimated != null ? r0(estimated) : null,
            runAmount: mv.canSee && r.runAmount > 0 ? r0(r.runAmount) : null,
          };
        }).filter((r) => r.orders > 0 || r.runAmount != null);
        const orderList = orders.map((o) => ({
          orderNo: o.orderNo, date: o.overtimeDate, minutes: o.verifiedMinutes,
          dayCategory: o.dayCategory, multiplier: o.rateMultiplier,
          employeeName: o.employee.fullName, employeeNo: o.employee.employeeNo,
        }));
        return NextResponse.json({
          report, company, run: runMeta(run), officer,
          rows, orders: orderList,
          totals: {
            employees: rows.length, orders: orders.length,
            minutes: rows.reduce((s, r) => s + r.minutes, 0),
            estimated: mv.canSee ? r0(rows.reduce((s, r) => s + (r.estimated ?? 0), 0)) : null,
            runAmount: mv.canSee ? r0(rows.reduce((s, r) => s + (r.runAmount ?? 0), 0)) : null,
          },
        });
      }

      default:
        return NextResponse.json({ error: `Report tidak dikenal: ${report}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function httpErr(status: number, message: string): HttpError { return new HttpError(status, message); }
