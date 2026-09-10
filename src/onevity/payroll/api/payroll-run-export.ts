import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

// GET /api/onevity/payroll-run-export?id=&bank=umum|bca|mandiri|bni
// File transfer bank (pattern "Transfer Bank Payment": file per bank).
// Baris difilter sesuai bank terdaftar pada profil/employee; "umum" = rekap semua.
const BANKS: Record<string, { label: string; match: (bank: string) => boolean }> = {
  bca: { label: "BCA", match: (b) => b.includes("BCA") },
  mandiri: { label: "Mandiri", match: (b) => b.includes("MANDIRI") || b.includes("BANK SYARIAH") },
  bni: { label: "BNI", match: (b) => b.includes("BNI") },
};

export async function GET(req: NextRequest) {
  try {
    // fix audit 42 K-2 (KRITIS): file transfer bank memuat NO. REKENING
    // TERDEKRIPTI + nominal seluruh run — dulu hanya requireTenant sehingga
    // anggota tenant tanpa hak payroll pun bisa menariknya. Guard hak AKSI
    // menu payroll:runs op:export ("Mengekspor slip & hasil" — op yang sama
    // dipakai send-slips payroll-runs.ts; CUSTOM tanpa op export → 403).
    const m = await requireMenuAction(req, "payroll:runs", "op:export");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    const bankKey = (req.nextUrl.searchParams.get("bank") ?? "umum").toLowerCase();
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: {
        period: true,
        processType: true,
        lines: {
          orderBy: { employeeNo: "asc" },
          include: { employee: { include: { payrollProfile: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status !== "Confirmed" && run.status !== "Paid") {
      return NextResponse.json({ error: "Ekspor hanya untuk run yang sudah dikonfirmasi" }, { status: 400 });
    }

    // 28-c: uang line/total run + no. rekening tersimpan terenkripsi — dekripsi
    // di sini (file transfer bank butuh nilai riil).
    const tc = tenantCryptoForDb(db);
    const dm = (v: string | null) => tc.decryptMoney(v) ?? 0;
    const lines = run.lines.map((l) => ({
      ...l,
      bruto: dm(l.bruto),
      deduction: dm(l.deduction),
      taxRegular: dm(l.taxRegular),
      taxIrregular: dm(l.taxIrregular),
      net: dm(l.net),
    }));
    const runTotals = {
      totalBruto: dm(run.totalBruto),
      totalDeduction: dm(run.totalDeduction),
      totalTax: dm(run.totalTax),
      totalNet: dm(run.totalNet),
    };

    const bankOf = (l: (typeof lines)[number]) =>
      (l.employee?.payrollProfile?.bankName ?? l.employee?.bankName ?? "").toUpperCase();
    const accountOf = (l: (typeof lines)[number]) =>
      tc.decryptText(l.employee?.payrollProfile?.bankAccount) ?? tc.decryptText(l.employee?.bankAccount) ?? "";

    if (bankKey === "umum") {
      // Rekap umum (semua karyawan) — format lama.
      const header = ["NO", "EMPLOYEE_ID", "NAMA", "UNIT", "BANK", "NO_REKENING", "BRUTO", "POTONGAN", "PPh21", "NETTO"].join(";");
      const rows = lines.map((l, i) => [
        i + 1, l.employeeNo, `"${l.employeeName}"`, `"${l.orgUnitName ?? ""}"`, bankOf(l), accountOf(l),
        Math.round(l.bruto), Math.round(l.deduction), Math.round(l.taxRegular + l.taxIrregular), Math.round(l.net),
      ].join(";"));
      const totals = ["", "", `"TOTAL (${run.employeeCount} karyawan)"`, "", "", "", Math.round(runTotals.totalBruto), Math.round(runTotals.totalDeduction), Math.round(runTotals.totalTax), Math.round(runTotals.totalNet)].join(";");
      const csv = [`OneVity Payroll Transfer — ${run.runNo} (${run.period.name} / ${run.processType.name})`, header, ...rows, totals].join("\n");
      await db.activityLog.create({ data: { action: "Exported", entity: "PayrollRun", entityId: run.id, detail: `Ekspor CSV umum run ${run.runNo}` } });
      return csvResponse(csv, `onevity-transfer-${run.runNo}.csv`);
    }

    const bank = BANKS[bankKey];
    if (!bank) return NextResponse.json({ error: `Bank tidak dikenal: ${bankKey}` }, { status: 400 });

    const matched = lines.filter((l) => bank.match(bankOf(l)));
    if (matched.length === 0) {
      return NextResponse.json(
        { error: `Tidak ada karyawan dengan rekening ${bank.label} pada run ini — gunakan format "umum"` },
        { status: 400 }
      );
    }
    const totalNet = matched.reduce((s, l) => s + l.net, 0);
    const ket = `GAJI ${run.period.name} ${run.runNo}`;

    let csv: string;
    if (bankKey === "bca") {
      // BCA payroll: NO;NO_REKENING;NAMA;NOMINAL;KETERANGAN
      const header = ["NO", "NO_REKENING", "NAMA", "NOMINAL", "KETERANGAN"].join(";");
      const rows = matched.map((l, i) => [i + 1, accountOf(l), `"${l.employeeName}"`, Math.round(l.net), `"${ket}"`].join(";"));
      csv = [`BCA PAYROLL TRANSFER — ${run.runNo} · ${matched.length} pegawai · Rp ${Math.round(totalNet).toLocaleString("id-ID")}`, header, ...rows].join("\n");
    } else if (bankKey === "mandiri") {
      // Mandiri: NO;NO_REKENING;NAMA_PENERIMA;NOMINAL;BERITA1;BERITA2
      const header = ["NO", "NO_REKENING", "NAMA_PENERIMA", "NOMINAL", "BERITA1", "BERITA2"].join(";");
      const rows = matched.map((l, i) => [i + 1, accountOf(l), `"${l.employeeName}"`, Math.round(l.net), `"${ket}"`, `"${l.employeeNo}"`].join(";"));
      csv = [`MANDIRI TRANSFER — ${run.runNo} · ${matched.length} pegawai · Rp ${Math.round(totalNet).toLocaleString("id-ID")}`, header, ...rows].join("\n");
    } else {
      // BNI: NO;NO_REKENING;NAMA;NOMINAL;REF
      const header = ["NO", "NO_REKENING", "NAMA", "NOMINAL", "REF"].join(";");
      const rows = matched.map((l, i) => [i + 1, accountOf(l), `"${l.employeeName}"`, Math.round(l.net), `"${l.employeeNo}"`].join(";"));
      csv = [`BNI PAYROLL TRANSFER — ${run.runNo} · ${matched.length} pegawai · Rp ${Math.round(totalNet).toLocaleString("id-ID")}`, header, ...rows].join("\n");
    }

    await db.activityLog.create({
      data: { action: "Exported", entity: "PayrollRun", entityId: run.id, detail: `Ekspor file bank ${bank.label} run ${run.runNo} (${matched.length} pegawai)` },
    });
    return csvResponse(csv, `onevity-${bankKey}-${run.runNo}.csv`);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
