"use client";
// RekanKerja Payroll — GRUP 2: PAJAK PPh 21/26 =============================
// R2.1 Rekapitulasi PPh 21 Bulanan (kolom PTKP, bruto, kategori TER, pajak
// terutang) · R2.3 Laporan PPh 26 Non-Residen (20% final). R2.2 (1721-A1)
// berada di file terpisah bukti-potong-a1.tsx (form DJP).
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocMeta } from "../params";
import {
  PrintDoc, DocHeader, useStandardMeta, DocSection, TotalBand, SignOff, Confidentiality,
  money, pct1, docPlace, EmptyDocRow,
} from "../doc-kit";

// ================== R2.1 — REKAP PPh 21 BULANAN =============================

interface Pph21Payload extends DocMeta {
  period: { id: string; name: string; code: string; sptMonth: number; sptYear: number };
  runs: string[];
  rows: {
    employeeNo: string; name: string; orgUnitName: string; npwp: string | null;
    ptkpStatus: string; terCategory: string; bruto: number | null; tax: number | null;
    net: number | null; effectiveRatePct: number | null;
  }[];
  totals: { employees: number; totalBruto: number | null; totalTax: number | null; totalNet: number | null };
  regulation: { useTer: boolean };
}

const TER_LABEL: Record<string, string> = { A: "A", B: "B", C: "C" };

export function Pph21MonthlyDoc({ data }: { data: Pph21Payload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Masa Pajak", "Tax Period"), value: `${String(data.period.sptMonth).padStart(2, "0")}/${data.period.sptYear}` },
    { label: t("Sumber Run", "Source Runs"), value: data.runs.join(", ") },
    { label: t("Jumlah Karyawan", "Employees"), value: `${data.totals.employees} ${t("orang", "persons")}` },
  ]);

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Laporan Rekapitulasi Potongan PPh 21 Bulanan", "PPh 21 Monthly Withholding Summary")}
        subtitle={`${data.period.name}${data.runs.length > 1 ? ` · agregasi ${data.runs.length} run final` : ""}`}
        reportNo="R2.1"
        meta={meta}
      />
      <DocSection
        title={t("PPh 21 Dipotong per Karyawan — Status PTKP · Penghasilan Bruto · Tarif Efektif Rata-rata (TER) · Pajak Terutang", "PPh 21 Withheld per Employee — PTKP Status · Gross Income · Effective Average Rate (TER) · Tax Due")}
        note={t(
          "Kategori TER per PMK 168/2023: A (TK/0, TK/1, K/0) · B (TK/2, TK/3, K/1, K/2, K/I/0, K/I/1) · C (K/3, K/I/2, K/I/3). Tarif efektif = PPh 21 ÷ penghasilan bruto bulan berjalan. Pengaturan regulasi tenant saat ini: {mode}.",
          "TER category per PMK 168/2023: A (TK/0, TK/1, K/0) · B (TK/2, TK/3, K/1, K/2, K/I/0, K/I/1) · C (K/3, K/I/2, K/I/3). Effective rate = PPh 21 ÷ current-month gross income. Current tenant regulation mode: {mode}.",
          { mode: data.regulation.useTer ? t("TER BULANAN (useTer aktif)", "MONTHLY TER (useTer active)") : t("Pasal 17 tahunan (useTer nonaktif) + true-up Desember", "Annual Article 17 (useTer off) + December true-up") },
        )}
      >
        <div className="rk-doc-table overflow-x-auto"><table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">No</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Nama Karyawan", "Employee Name")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="w-[42mm] border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">NPWP</th>
              <th className="w-[18mm] border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">PTKP</th>
              <th className="w-[16mm] border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">TER</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Penghasilan Bruto", "Gross Income")}</th>
              <th className="w-[22mm] border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Tarif Efektif", "Effective Rate")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("PPh 21 Terutang", "PPh 21 Due")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Netto Dibayarkan", "Net Paid")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyDocRow colSpan={11} message={t("Belum ada data potongan PPh 21 pada periode ini.", "No PPh 21 withholding data for this period.")} />}
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{r.employeeNo}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5 font-semibold">{r.name}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.orgUnitName}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center font-mono text-[10px]">{r.npwp ?? "—"}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center font-bold tabular-nums">{r.ptkpStatus}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center">
                  <span className={cn(
                    "inline-block w-6 rounded-sm px-1 py-px text-[10px] font-extrabold",
                    r.terCategory === "A" && "bg-emerald-100 text-emerald-800",
                    r.terCategory === "B" && "bg-amber-100 text-amber-800",
                    r.terCategory === "C" && "bg-rose-100 text-rose-800",
                  )}>
                    {TER_LABEL[r.terCategory] ?? "—"}
                  </span>
                </td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.bruto)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{pct1(r.effectiveRatePct)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right font-bold tabular-nums">{money(r.tax)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.net)}</td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={7} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total ({n} karyawan)", "Total ({n} employees)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalBruto)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-center">Σ</td>
              <td className="border border-slate-400 bg-rose-100 px-1.5 py-1 text-right font-extrabold text-rose-800 tabular-nums">{money(data.totals.totalTax)}</td>
              <td className="border border-slate-400 bg-emerald-100 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalNet)}</td>
            </tr>
          </tbody>
        </table></div>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Gross (Dasar Pengenaan)", "Total Gross (Withholding Base)"), value: money(data.totals.totalBruto), tone: "dark" },
          { label: t("Total PPh 21 Dipotong (Setor ke Negara)", "Total PPh 21 Withheld (Payable to State)"), value: money(data.totals.totalTax), tone: "red" },
          { label: t("Total Netto Dibayarkan Karyawan", "Total Net Paid to Employees"), value: money(data.totals.totalNet), tone: "green" },
          { label: t("Jumlah Karyawan", "Employees"), value: `${data.totals.employees} ${t("orang", "persons")}`, tone: "dark" },
        ]}
      />

      <SignOff
        place={docPlace(data.company?.city, data.officer.printedAt)}
        preparedBy={data.officer.name}
        notes={t(
          "Laporan ini menjadi dasar pelaporan SPT Masa PPh 21/26 (e-Bupot/Coretax) — pastikan rekonsiliasi dengan bukti potong bulanan sebelum penyetoran paling lambat tanggal 10 bulan berikutnya.",
          "This report is the basis for the Monthly PPh 21/26 Return (e-Bupot/Coretax) — reconcile with monthly withholding slips before remitting no later than the 10th of the following month.",
        )}
      />
      <Confidentiality />
    </PrintDoc>
  );
}

// ================== R2.3 — PPh 26 NON-RESIDEN ==============================

interface Pph26Payload extends DocMeta {
  period: { id: string; name: string; code: string; sptMonth: number; sptYear: number };
  rows: {
    employeeNo: string; name: string; orgUnitName: string; npwp: string | null;
    country: string; brutoFinal: number | null; tax26: number | null;
  }[];
  totals: { employees: number; totalBrutoFinal: number | null; totalTax26: number | null };
}

export function Pph26Doc({ data }: { data: Pph26Payload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Masa Pajak", "Tax Period"), value: `${String(data.period.sptMonth).padStart(2, "0")}/${data.period.sptYear}` },
    { label: t("Tarif Pasal 26", "Article 26 Rate"), value: "20% final" },
    { label: t("Jumlah WNA", "Foreign Nationals"), value: `${data.totals.employees} ${t("orang", "persons")}` },
  ]);

  return (
    <PrintDoc orientation="portrait">
      <DocHeader
        company={data.company}
        title={t("Laporan Potongan PPh Pasal 26 — Tenaga Kerja Asing / Ekspatriat", "PPh Article 26 Withholding Report — Foreign Workers / Expatriates")}
        subtitle={`${data.period.name} · ${t("subjek pajak luar negeri", "non-resident taxpayers")}`}
        reportNo="R2.3"
        meta={meta}
      />
      <DocSection
        title={t("Penghasilan Bersifat Final Subjek PPh 26 (Tarif 20%)", "Final Income Subject to PPh 26 (20% Rate)")}
        note={t(
          "Populasi: karyawan dengan komponen upah ber-metode pajak FINAL (FixedRateFinal / SeveranceFinal / PensionFinal / Final2Years) pada periode terpilih — basis pemotongan 20% dari bruto sesuai Pasal 26 ayat (1) huruf a UU PPh. Tenaga kerja asing tanpa NPWP dipotong final dan TIDAK digabung dengan PPh 21 pegawai tetap.",
          "Population: employees with FINAL tax-method wage components (FixedRateFinal / SeveranceFinal / PensionFinal / Final2Years) in the selected period — 20% of gross withheld per Article 26(1)(a) of the Income Tax Law. Foreign workers without an NPWP are withheld at the final rate and NOT merged into permanent-employee PPh 21.",
        )}
      >
        <div className="rk-doc-table overflow-x-auto"><table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">No</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Nama", "Name")}</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("Identitas (NPWP/ID)", "ID (NPWP/Other)")}</th>
              <th className="w-[20mm] border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("Kode Negara", "Country Code")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Penghasilan Bruto", "Gross Income")}</th>
              <th className="w-[16mm] border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">Tarif</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("PPh 26 Dipotong", "PPh 26 Withheld")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <EmptyDocRow
                colSpan={9}
                message={t(
                  "Tidak ada tenaga kerja asing / penghasilan final PPh 26 pada periode ini. Saat mempekerjakan WNA, tandai komponen upahnya dengan metode pajak Final agar masuk populasi laporan ini.",
                  "No foreign workers / PPh 26 final income in this period. When employing foreign nationals, flag their wage components with the Final tax method so they appear in this report.",
                )}
              />
            )}
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-2 py-0.5 font-mono">{r.employeeNo}</td>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-0.5 font-semibold">{r.name}</td>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-0.5">{r.orgUnitName}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center font-mono text-[10px]">{r.npwp ?? t("Tanpa NPWP", "No NPWP")}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center">{r.country}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.brutoFinal)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center font-bold">20%</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right font-bold tabular-nums">{money(r.tax26)}</td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={6} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total ({n} wajib pajak luar negeri)", "Total ({n} non-resident taxpayers)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalBrutoFinal)}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">Σ</td>
              <td className="border border-slate-400 bg-rose-100 px-2 py-1 text-right font-extrabold text-rose-800 tabular-nums">{money(data.totals.totalTax26)}</td>
            </tr>
          </tbody>
        </table></div>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Bruto Final", "Total Final Gross"), value: money(data.totals.totalBrutoFinal), tone: "dark" },
          { label: t("Total PPh 26 (Setor ke Negara)", "Total PPh 26 (Payable to State)"), value: money(data.totals.totalTax26), tone: "red" },
          { label: t("Tarif", "Rate"), value: "20% × bruto", tone: "dark" },
          { label: t("Dasar Hukum", "Legal Basis"), value: "UU PPh Ps. 26(1)(a)", tone: "dark" },
        ]}
      />

      <SignOff place={docPlace(data.company?.city, data.officer.printedAt)} preparedBy={data.officer.name} />
      <Confidentiality />
    </PrintDoc>
  );
}
