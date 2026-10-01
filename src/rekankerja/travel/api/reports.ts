import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { toCsv, csvResponse, exportFilename, type ExportCell } from "@/rekankerja/shared/lib/export";
import { claimReport } from "@/rekankerja/travel/services/travel-service";

// GET /api/rekankerja/travel/reports?from=&to=&employeeId= — laporan klaim per
// rentang (padanan TravelClaim report + Summary per jenis biaya).
// Task 82-c: ?export=csv → unduh CSV rincian klaim pada rentang (cermin pola
// T12-REPORTS leave/api/reports.ts — data sama dgn JSON, tanpa logika service baru).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["travel:travel-reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const from = sp.get("from") ? new Date(String(sp.get("from"))) : new Date(now.getFullYear(), 0, 1);
    const to = sp.get("to") ? new Date(String(sp.get("to"))) : now;
    const rows = await claimReport(db, {
      from,
      to,
      employeeId: sp.get("employeeId") ?? undefined,
    });

    const byKind = new Map<string, { amount: number; lines: number }>();
    const byExpense = new Map<string, { amount: number; lines: number }>();
    let totalExpenses = 0;
    for (const r of rows) {
      for (const e of r.expenses) {
        totalExpenses += e.amount;
        const k = byKind.get(e.kind) ?? { amount: 0, lines: 0 };
        byKind.set(e.kind, { amount: k.amount + e.amount, lines: k.lines + 1 });
        const x = byExpense.get(e.expenseCode) ?? { amount: 0, lines: 0 };
        byExpense.set(e.expenseCode, { amount: x.amount + e.amount, lines: x.lines + 1 });
      }
    }

    // Task 82-c: mode export — CSV rincian klaim (satu baris per rincian biaya,
    // kolom klaim diulang) + baris TOTAL + ringkasan per kelompok (pola leave).
    if (sp.get("export") === "csv") {
      // 45-b: gerbang vault uang — aktor requireMenuViewAny (pola travel/api/claims.ts);
      // masked → seluruh kolom nominal dikosongkan (unduhan tidak boleh membocorkan angka).
      const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
      const money = (v: number): ExportCell => (mv.canSee ? Math.round(v * 100) / 100 : "");
      const kindLabel: Record<string, string> = {
        GENERAL: "General Expense", ALLOWANCE: "Allowance (Uang Saku)",
        MILEAGE: "Mileage (BBM/Jarak)", ENTERTAINMENT: "Entertainment",
      };
      const columns = [
        { header: "No. Dokumen", width: 16 },
        { header: "No. Karyawan", width: 14 },
        { header: "Nama Karyawan", width: 28 },
        { header: "Tanggal Klaim", width: 12 },
        { header: "Jenis Biaya", width: 22 },
        { header: "Kode Biaya", width: 14 },
        { header: "Keterangan", width: 32 },
        { header: "Nominal", width: 14 },
        { header: "Status", width: 12 },
        { header: "(b) Dibayar Karyawan", width: 16 },
        { header: "(c) Kembali Perusahaan", width: 18 },
      ];
      const lines: ExportCell[][] = [];
      for (const r of rows) {
        const expenses = r.expenses.length ? r.expenses : [null];
        expenses.forEach((e, i) => {
          const keterangan = e
            ? [e.description, e.guestName ? `tamu: ${e.guestName}` : null].filter(Boolean).join(" · ")
            : "";
          lines.push([
            r.docNo, r.employeeNo, r.fullName,
            new Date(r.claimDate).toISOString().slice(0, 10),
            e ? kindLabel[e.kind] ?? e.kind : "",
            e?.expenseCode ?? "",
            keterangan,
            e ? money(e.amount) : "",
            r.status,
            // (b)/(c) hanya pada baris pertama tiap klaim — jumlah Excel tidak dobel.
            i === 0 ? money(r.payableEmployee) : "",
            i === 0 ? money(r.payableCompany) : "",
          ]);
        });
      }
      const sum = (v: number) => (mv.canSee ? v : "");
      lines.push([
        "", "", `TOTAL (${rows.length} klaim)`, "", "", "", "",
        sum(Math.round(totalExpenses * 100) / 100), "",
        sum(rows.reduce((s, r) => s + r.payableEmployee, 0)),
        sum(rows.reduce((s, r) => s + r.payableCompany, 0)),
      ]);
      // ringkasan per kelompok biaya (pola "Ringkasan per jenis" leave)
      lines.push([]);
      lines.push(["Ringkasan per kelompok biaya", "", "", "", "", "", "", "", "", "", ""]);
      for (const [kind, v] of [...byKind.entries()].sort((a, b) => b[1].amount - a[1].amount)) {
        lines.push(["", kindLabel[kind] ?? kind, "", "", "", "", `(${v.lines} baris)`, money(v.amount), "", "", ""]);
      }
      return csvResponse(
        toCsv(columns, lines),
        exportFilename("rekankerja-travel", "csv", `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`),
      );
    }

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      rows,
      summary: {
        claims: rows.length,
        totalSettlement: rows.reduce((s, r) => s + r.totalSettlement, 0),
        totalExpenses: Math.round(totalExpenses),
        payableEmployee: rows.reduce((s, r) => s + r.payableEmployee, 0),
        payableCompany: rows.reduce((s, r) => s + r.payableCompany, 0),
        byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.amount - a.amount),
        byExpense: [...byExpense.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 12),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
