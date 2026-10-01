import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { toXlsxMulti, xlsxResponse, exportFilename } from "@/rekankerja/shared/lib/export";
import type { ExportColumn, ExportCell } from "@/rekankerja/shared/lib/export";

// GET /api/rekankerja/payroll-reports/monthly?runId=&export=xlsx
// LAPORAN PAYROLL BULANAN LENGKAP (Task 64) — dipanggil dari detail run
// (menu "Payroll Runs & Results"). Workbook 5 sheet:
//   1. Ringkasan      — identitas perusahaan + run + periode + status + total.
//   2. Rekap Gaji     — per karyawan: identitas + PTKP + SATU KOLOM PER
//                       KOMPONEN upah (dinamis: penghasilan lalu potongan)
//                       + bruto/potongan/PPh21/THP + baris TOTAL.
//   3. Detail Komponen— format panjang audit: satu baris per item per
//                       karyawan (kode, nama, kategori, jenis upah, pajak,
//                       catatan, nominal).
//   4. Rekap Komponen — agregat per komponen (jumlah karyawan + total).
//   5. Pembayaran     — NPWP + bank + no. rekening (PII terdekripsi, pola
//                       payroll-run-export.ts) + PPh21 + THP + total.
// Uang: seluruh nominal via MoneyView.dec0 (vault tertutup → 0, keputusan
// pemilik produk Task 56 — konsisten register/bank/BPJS). NPWP/rekening =
// PII per aturan "tetap jalur env" (28-c) → decryptText tanpa gate vault.
// Guard: requireMenuAction payroll:runs op:export (file berisi PII + nilai
// penuh — sama dgn file transfer bank, audit 42 K-2). Status: Draft/Cancelled
// ditolak (pola reports-register). Tanpa ?export= → preview JSON ringkas.
const r0 = (n: number) => Math.round(n);
const rp = (n: number) => `Rp ${r0(n).toLocaleString("id-ID")}`;
const dstr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "-");

const RUN_STATUS_ID: Record<string, string> = {
  Draft: "Draft",
  Calculated: "Dihitung",
  Confirmed: "Dikonfirmasi",
  Paid: "Dibayar",
  Cancelled: "Dibatalkan",
};
const TYPE_ID: Record<string, string> = {
  Earning: "Penghasilan",
  Deduction: "Potongan",
  Informational: "Informasi",
};

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:runs", "op:export");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });

    const run = await db.payrollRun.findUnique({
      where: { id: runId },
      include: {
        period: true,
        processType: true,
        lines: {
          orderBy: [{ orgUnitName: "asc" }, { employeeNo: "asc" }],
          include: { items: { orderBy: { sortOrder: "asc" } }, employee: { include: { payrollProfile: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status === "Draft" || run.status === "Cancelled") {
      return NextResponse.json(
        { error: `Run ${run.runNo} berstatus ${run.status} — hitung (calculate) payroll terlebih dahulu` },
        { status: 400 },
      );
    }

    // 28-c + 45-b/56: dekripsi uang lewat gate MoneyView aktor (vault
    // tertutup → 0 utk semua nominal); PII (NPWP/rekening) via tenantCrypto.
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    const dm = (v: string | null) => mv.dec0(v);
    const tc = tenantCryptoForDb(db);

    const company = await db.company.findFirst({ where: { active: true } });
    const lines = run.lines.map((l) => {
      const itemAmt = new Map<string, number>();
      for (const it of l.items) itemAmt.set(it.code, (itemAmt.get(it.code) ?? 0) + dm(it.amount));
      const tax = r0(dm(l.taxRegular)) + r0(dm(l.taxIrregular));
      return {
        employeeNo: l.employeeNo,
        employeeName: l.employeeName,
        orgUnitName: l.orgUnitName?.trim() || "Tanpa Unit",
        positionName: l.positionName || "-",
        ptkpStatus: l.ptkpStatus,
        umkWarning: l.umkWarning,
        items: l.items.map((it) => ({ ...it, amount: r0(dm(it.amount)) })),
        itemAmt,
        bruto: r0(dm(l.bruto)),
        deduction: r0(dm(l.deduction)),
        tax,
        net: r0(dm(l.net)),
        npwp: tc.decryptText(l.employee?.payrollProfile?.npwp) ?? tc.decryptText(l.employee?.taxId) ?? "",
        bankName: l.employee?.payrollProfile?.bankName ?? l.employee?.bankName ?? "",
        bankAccount:
          tc.decryptText(l.employee?.payrollProfile?.bankAccount) ?? tc.decryptText(l.employee?.bankAccount) ?? "",
      };
    });

    // ---- agregat komponen (urutan kemunculan: penghasilan dulu, potongan, info)
    const earnCols = new Map<string, string>(); // code → header
    const dedCols = new Map<string, string>();
    const infoCols = new Map<string, string>();
    const usedHeaders = new Set<string>();
    const headerFor = (code: string, name: string) => {
      let h = name?.trim() || code;
      if (usedHeaders.has(h)) h = `${h} (${code})`;
      usedHeaders.add(h);
      return h;
    };
    for (const l of lines) {
      for (const it of l.items) {
        const target = it.type === "Earning" ? earnCols : it.type === "Deduction" ? dedCols : infoCols;
        if (!target.has(it.code)) target.set(it.code, headerFor(it.code, it.name));
      }
    }

    const sum = (f: (l: (typeof lines)[number]) => number) => r0(lines.reduce((s, l) => s + f(l), 0));
    const totals = {
      employees: lines.length,
      totalBruto: sum((l) => l.bruto),
      totalDeduction: sum((l) => l.deduction),
      totalTax: sum((l) => l.tax),
      totalNet: sum((l) => l.net),
      umkWarnings: lines.filter((l) => l.umkWarning).length,
    };
    const components = [...earnCols, ...dedCols, ...infoCols].map(([code, header]) => {
      const sample = lines.flatMap((l) => l.items).find((it) => it.code === code)!;
      const emp = lines.filter((l) => l.itemAmt.has(code)).length;
      const total = r0(lines.reduce((s, l) => s + (l.itemAmt.get(code) ?? 0), 0));
      return { code, name: header, type: sample.type, wageType: sample.wageType, incomeTaxMethod: sample.incomeTaxMethod, employees: emp, total };
    });

    const meta = {
      runId: run.id,
      runNo: run.runNo,
      status: run.status,
      period: run.period.name,
      processType: run.processType.name,
      company: company?.name ?? null,
      moneyVisible: mv.canSee,
      generatedAt: new Date().toISOString(),
    };

    if (req.nextUrl.searchParams.get("export") === "xlsx") {
      // ---------- Sheet 1: Ringkasan ----------
      const rcols: ExportColumn[] = [
        { header: "Item", width: 34 },
        { header: "Nilai", width: 52 },
      ];
      const rrows: ExportCell[][] = [
        ["Perusahaan", company?.name ?? "-"],
        ["Kode Perusahaan", company?.code ?? "-"],
        ["NPWP Perusahaan", company?.taxId ?? "-"],
        ["Alamat", [company?.address, company?.city].filter(Boolean).join(", ") || "-"],
        ["Telepon", company?.phone ?? "-"],
        ["Run Payroll", run.runNo],
        ["Periode", run.period.name],
        ["Tipe Proses", run.processType.name],
        ["Status", RUN_STATUS_ID[run.status] ?? run.status],
        ["Dibuat", dstr(run.createdAt)],
        ["Dihitung", dstr(run.calculatedAt)],
        ["Dikonfirmasi", dstr(run.confirmedAt)],
        ["Dibayar", dstr(run.paidAt)],
        ["Jumlah Karyawan", `${totals.employees} orang`],
        ["Total Bruto", rp(totals.totalBruto)],
        ["Total Potongan", rp(totals.totalDeduction)],
        ["Total PPh21", rp(totals.totalTax)],
        ["Total Take Home Pay", rp(totals.totalNet)],
        ["Karyawan di bawah UMP/UMK", `${totals.umkWarnings} orang`],
        ["Catatan Run", run.notes ?? "-"],
        ["Dicetak", `${new Date().toLocaleString("id-ID")} · ${m.actor.name}`],
      ];
      if (!mv.canSee) {
        rrows.push([
          "PERHATIAN",
          "Brankas uang (Money Vault) terkunci — seluruh nominal pada laporan ini tampil 0. Buka brankas lalu ekspor ulang untuk nilai riil.",
        ]);
      }

      // ---------- Sheet 2: Rekap Gaji (kolom komponen dinamis) ----------
      const gcols: ExportColumn[] = [
        { header: "No.", width: 6 },
        { header: "No. Karyawan", width: 16 },
        { header: "Nama", width: 28 },
        { header: "Unit Kerja", width: 22 },
        { header: "Jabatan", width: 22 },
        { header: "PTKP", width: 9 },
        ...[...earnCols.values()].map((h) => ({ header: h, width: 16 })),
        ...[...dedCols.values()].map((h) => ({ header: h, width: 16 })),
        { header: "Total Bruto", width: 16 },
        { header: "Total Potongan", width: 16 },
        { header: "PPh21", width: 16 },
        { header: "Take Home Pay", width: 16 },
      ];
      const grows: ExportCell[][] = [];
      lines.forEach((l, i) => {
        grows.push([
          i + 1,
          l.employeeNo,
          l.employeeName,
          l.orgUnitName,
          l.positionName,
          l.ptkpStatus,
          ...[...earnCols.keys(), ...dedCols.keys()].map((c) => l.itemAmt.get(c) ?? 0),
          l.bruto,
          l.deduction,
          l.tax,
          l.net,
        ]);
      });
      const colTotals = [...earnCols.keys(), ...dedCols.keys()].map((c) =>
        r0(lines.reduce((s, l) => s + (l.itemAmt.get(c) ?? 0), 0)),
      );
      grows.push([
        "TOTAL",
        `${totals.employees} karyawan`,
        "",
        "",
        "",
        "",
        ...colTotals,
        totals.totalBruto,
        totals.totalDeduction,
        totals.totalTax,
        totals.totalNet,
      ]);

      // ---------- Sheet 3: Detail Komponen (audit, format panjang) ----------
      const dcols: ExportColumn[] = [
        { header: "No.", width: 6 },
        { header: "No. Karyawan", width: 16 },
        { header: "Nama", width: 28 },
        { header: "Kode", width: 14 },
        { header: "Komponen", width: 28 },
        { header: "Kategori", width: 14 },
        { header: "Jenis Upah", width: 19 },
        { header: "Metode Pajak", width: 17 },
        { header: "Catatan", width: 26 },
        { header: "Nominal", width: 16 },
      ];
      const drows: ExportCell[][] = [];
      let dno = 0;
      for (const l of lines) {
        for (const it of l.items) {
          dno += 1;
          drows.push([
            dno,
            l.employeeNo,
            l.employeeName,
            it.code,
            it.name,
            TYPE_ID[it.type] ?? it.type,
            it.wageType,
            it.incomeTaxMethod,
            it.note ?? "",
            it.amount,
          ]);
        }
      }

      // ---------- Sheet 4: Rekap Komponen ----------
      const ccols: ExportColumn[] = [
        { header: "Kode", width: 14 },
        { header: "Komponen", width: 30 },
        { header: "Kategori", width: 14 },
        { header: "Jenis Upah", width: 19 },
        { header: "Metode Pajak", width: 17 },
        { header: "Jumlah Karyawan", width: 15 },
        { header: "Total Nominal", width: 18 },
      ];
      const crows: ExportCell[][] = components.map((c) => [
        c.code,
        c.name,
        TYPE_ID[c.type] ?? c.type,
        c.wageType,
        c.incomeTaxMethod,
        c.employees,
        c.total,
      ]);

      // ---------- Sheet 5: Pembayaran & Pajak ----------
      const pcols: ExportColumn[] = [
        { header: "No.", width: 6 },
        { header: "No. Karyawan", width: 16 },
        { header: "Nama", width: 28 },
        { header: "NPWP", width: 20 },
        { header: "Bank", width: 18 },
        { header: "No. Rekening", width: 20 },
        { header: "PPh21", width: 16 },
        { header: "Take Home Pay", width: 16 },
      ];
      const prows: ExportCell[][] = lines.map((l, i) => [
        i + 1,
        l.employeeNo,
        l.employeeName,
        l.npwp || "-",
        l.bankName || "-",
        l.bankAccount || "-",
        l.tax,
        l.net,
      ]);
      prows.push(["TOTAL", `${totals.employees} karyawan`, "", "", "", "", totals.totalTax, totals.totalNet]);

      const buf = await toXlsxMulti([
        {
          name: "Ringkasan",
          title: `Laporan Payroll Bulanan — ${run.runNo} · ${run.period.name} · ${run.processType.name}`,
          columns: rcols,
          rows: rrows,
        },
        { name: "Rekap Gaji", columns: gcols, rows: grows },
        { name: "Detail Komponen", columns: dcols, rows: drows },
        { name: "Rekap Komponen", columns: ccols, rows: crows },
        { name: "Pembayaran", columns: pcols, rows: prows },
      ]);

      try {
        await db.activityLog.create({
          data: {
            action: "Exported",
            entity: "PayrollRun",
            entityId: run.id,
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan bulanan payroll run ${run.runNo} (${totals.employees} karyawan)`,
          },
        });
      } catch {
        // ActivityLog tak tersedia di schema legacy — export tetap sukses.
      }
      return xlsxResponse(buf, exportFilename("rekankerja-payroll-bulanan", "xlsx", run.runNo));
    }

    return NextResponse.json({ meta, totals, components });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
