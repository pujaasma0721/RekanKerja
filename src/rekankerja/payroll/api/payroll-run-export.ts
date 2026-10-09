import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { trFor, locFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";

// GET /api/rekankerja/payroll-run-export?id=&bank=umum|bca|mandiri|bni
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
    // BL-5 (tier-2 export): bahasa header/judul file — default EN (pola BL-4).
    const lang: Lang = req.nextUrl.searchParams.get("lang") === "id" ? "id" : "en";
    // header CSV manual → trFor per kolom (exact-match BASE_EN, fallback identity).
    const H = (h: string) => trFor(lang, h);
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
    // 45-b: gerbang MoneyView — file transfer bank memuat nominal; saat vault
    // uang TERTUTUP/tanpa grant nilai ter-mask (0) — admin membuka vault dulu
    // sebelum menarik file transfer riil. No. rekening (teks) per aturan PII.
    const mv = await moneyViewForReq(req, db);
    const dm = (v: string | null) => mv.dec0(v);
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
      const header = ["NO", "EMPLOYEE_ID", "NAMA", "UNIT", "BANK", "NO_REKENING", "BRUTO", "POTONGAN", "PPh21", "NETTO"].map(H).join(";");
      const rows = lines.map((l, i) => [
        i + 1, l.employeeNo, `"${l.employeeName}"`, `"${l.orgUnitName ?? ""}"`, bankOf(l), accountOf(l),
        Math.round(l.bruto), Math.round(l.deduction), Math.round(l.taxRegular + l.taxIrregular), Math.round(l.net),
      ].join(";"));
      const totals = ["", "", `"${trFor(lang, "TOTAL ({n} karyawan)", "TOTAL ({n} employees)", { n: run.employeeCount })}"`, "", "", "", Math.round(runTotals.totalBruto), Math.round(runTotals.totalDeduction), Math.round(runTotals.totalTax), Math.round(runTotals.totalNet)].join(";");
      const csv = [`${trFor(lang, "RekanKerja Payroll Transfer")} — ${run.runNo} (${locFor(lang, run.period.name)} / ${run.processType.name})`, header, ...rows, totals].join("\n");
      await db.activityLog.create({ data: { action: "Exported", entity: "PayrollRun", entityId: run.id, detail: `Ekspor CSV umum run ${run.runNo}` } });
      return csvResponse(csv, `rekankerja-transfer-${run.runNo}.csv`);
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
    // Format bank = format SISTEM EKSTERNAL (portal BCA/Mandiri/BNI mengharapkan
    // header & field persis) → SELALU Indonesia, jangan ikut bahasa UI (satu
    // prinsip dgn format regulator BPJS/e-SPT). Hanya rekap "umum" yang bilingual.
    const ket = `GAJI ${run.period.name} ${run.runNo}`;
    // baris judul file bank: “PR-001 · 5 pegawai · Rp …” — “pegawai” diterjemahkan.
    const bankTitle = (label: string) =>
      `${label} — ${run.runNo} · ${matched.length} pegawai · Rp ${Math.round(totalNet).toLocaleString("id-ID")}`;

    let csv: string;
    if (bankKey === "bca") {
      // BCA payroll: NO;NO_REKENING;NAMA;NOMINAL;KETERANGAN
      const header = ["NO", "NO_REKENING", "NAMA", "NOMINAL", "KETERANGAN"].join(";");
      const rows = matched.map((l, i) => [i + 1, accountOf(l), `"${l.employeeName}"`, Math.round(l.net), `"${ket}"`].join(";"));
      csv = [bankTitle("BCA PAYROLL TRANSFER"), header, ...rows].join("\n");
    } else if (bankKey === "mandiri") {
      // Mandiri: NO;NO_REKENING;NAMA_PENERIMA;NOMINAL;BERITA1;BERITA2
      const header = ["NO", "NO_REKENING", "NAMA_PENERIMA", "NOMINAL", "BERITA1", "BERITA2"].join(";");
      const rows = matched.map((l, i) => [i + 1, accountOf(l), `"${l.employeeName}"`, Math.round(l.net), `"${ket}"`, `"${l.employeeNo}"`].join(";"));
      csv = [bankTitle("MANDIRI TRANSFER"), header, ...rows].join("\n");
    } else {
      // BNI: NO;NO_REKENING;NAMA;NOMINAL;REF
      const header = ["NO", "NO_REKENING", "NAMA", "NOMINAL", "REF"].join(";");
      const rows = matched.map((l, i) => [i + 1, accountOf(l), `"${l.employeeName}"`, Math.round(l.net), `"${l.employeeNo}"`].join(";"));
      csv = [bankTitle("BNI PAYROLL TRANSFER"), header, ...rows].join("\n");
    }

    await db.activityLog.create({
      data: { action: "Exported", entity: "PayrollRun", entityId: run.id, detail: `Ekspor file bank ${bank.label} run ${run.runNo} (${matched.length} pegawai)` },
    });
    return csvResponse(csv, `rekankerja-${bankKey}-${run.runNo}.csv`);
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
