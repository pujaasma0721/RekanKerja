"use client";
// RekanKerja Payroll — GRUP 1: LAPORAN PENGGAJIAN INTERNAL ==================
// R1.1 Slip Gaji Resmi · R1.2 Rekapitulasi Gaji Bulanan · R1.3 Rekap
// Transfer Bank (Bank-Link). Semua memakai kerangka DocKit (kop, metadata,
// grand total, sign-off, kerahasiaan) + area cetak #rk-print-area.
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocMeta } from "../params";
import {
  PrintDoc, DocHeader, useStandardMeta, DocSection, TotalBand, SignOff, Confidentiality,
  money, docPlace, EmptyDocRow,
} from "../doc-kit";
import type { LucideIcon } from "lucide-react";

// ============================ R1.1 — SLIP GAJI =============================

interface SlipItem { code: string; name: string; wageType: string; type: string; amount: number | null; note: string | null }
interface SlipPayload extends DocMeta {
  slip: {
    employeeNo: string; employeeName: string; positionName: string | null; orgUnitName: string | null;
    ptkpStatus: string; npwp: string | null; bruto: number | null; deduction: number | null;
    taxRegular: number | null; taxIrregular: number | null; net: number | null; notes: string | null;
    items: SlipItem[]; runNo: string; periodName: string; processName: string; runStatus: string;
  };
}

const isCompanyBorne = (it: SlipItem) =>
  it.type === "Earning" && (it.code.endsWith("_C") || it.wageType === "Jamsostek");

export function PayslipDoc({ data }: { data: SlipPayload }) {
  const { t } = useI18n();
  const slip = data.slip;
  const meta = useStandardMeta(data, [
    { label: t("Jenis Proses", "Process Type"), value: slip.processName },
    { label: t("Status Run", "Run Status"), value: slip.runStatus === "Paid" ? t("Dibayar", "Paid") : slip.runStatus === "Confirmed" ? t("Dikonfirmasi", "Confirmed") : slip.runStatus },
  ]);
  const earnings = slip.items.filter((i) => i.type === "Earning" && !isCompanyBorne(i));
  const companyBorne = slip.items.filter(isCompanyBorne);
  const deductions = slip.items.filter((i) => i.type === "Deduction");
  const infos = slip.items.filter((i) => i.type === "Informational");
  const taxTotal = (slip.taxRegular ?? 0) + (slip.taxIrregular ?? 0);

  const itemTable = (rows: SlipItem[], totalLabel: string, totalValue: number | null, tone: "green" | "red" | "slate") => (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className={cn("text-white", tone === "green" ? "bg-emerald-800" : tone === "red" ? "bg-rose-800" : "bg-slate-700")}>
          <th className="border border-slate-600 px-2 py-1 text-left text-[9.5px] font-bold uppercase tracking-wide">{t("Komponen", "Component")}</th>
          <th className="w-[38mm] border border-slate-600 px-2 py-1 text-right text-[9.5px] font-bold uppercase tracking-wide">{t("Jumlah", "Amount")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={2} className="border border-slate-300 px-2 py-2 text-center italic text-slate-400">—</td></tr>
        )}
        {rows.map((it, idx) => (
          <tr key={it.code + idx} className={cn(idx % 2 === 1 && "bg-slate-50")}>
            <td className="border border-slate-300 px-2 py-1">
              {it.name}
              {it.note && <span className="text-slate-400"> — {it.note}</span>}
            </td>
            <td className="border border-slate-300 px-2 py-1 text-right font-semibold tabular-nums">{money(it.amount)}</td>
          </tr>
        ))}
        <tr className="bg-slate-200 font-bold">
          <td className="border border-slate-400 px-2 py-1.5 text-[10px] uppercase tracking-wide">{totalLabel}</td>
          <td className={cn(
            "border border-slate-400 px-2 py-1.5 text-right text-[12px] font-extrabold tabular-nums",
            tone === "green" && "text-emerald-800", tone === "red" && "text-rose-800",
          )}>{money(totalValue)}</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <PrintDoc orientation="portrait">
      <DocHeader
        company={data.company}
        title={t("Slip Gaji Resmi Karyawan", "Official Employee Payslip")}
        subtitle={`${slip.runNo} · ${slip.periodName}`}
        reportNo="R1.1"
        meta={meta}
      />

      {/* identitas karyawan */}
      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md bg-slate-50 px-4 py-3 ring-1 ring-slate-200 md:grid-cols-3">
        {[
          [t("Nama Karyawan", "Employee Name"), slip.employeeName],
          [t("No. Karyawan", "Employee No."), slip.employeeNo],
          [t("Posisi", "Position"), slip.positionName ?? "—"],
          [t("Unit / Departemen", "Unit / Department"), slip.orgUnitName ?? "—"],
          [t("Status Pajak (PTKP)", "Tax Status (PTKP)"), slip.ptkpStatus],
          ["NPWP", slip.npwp ?? "—"],
        ].map(([l, v]) => (
          <div key={l as string}>
            <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">{l}</div>
            <div className="truncate text-[12px] font-bold">{v}</div>
          </div>
        ))}
      </section>

      <DocSection title={t("A. Penghasilan (Pendapatan / Tunjangan)", "A. Earnings (Income / Allowances)")}>
        {itemTable(earnings, t("Jumlah Penghasilan (Bruto)", "Total Gross Income"), slip.bruto, "green")}
      </DocSection>

      <DocSection
        title={t("B. Iuran BPJS Ditanggung Perusahaan", "B. Company-Borne BPJS Contributions")}
        note={t(
          "Iuran porsi perusahaan (kode _C) TIDAK mengurangi Take Home Pay — dibayar di luar THP karyawan.",
          "Company-portion premiums (_C codes) DO NOT reduce Take Home Pay — paid outside employee THP.",
        )}
      >
        {itemTable(companyBorne, t("Total Iuran Ditanggung Perusahaan", "Total Company-Borne Premiums"), companyBorne.reduce((s, i) => s + (i.amount ?? 0), 0) || null, "slate")}
      </DocSection>

      <DocSection title={t("C. Potongan (Deductions)", "C. Deductions")}>
        {itemTable(deductions, t("Jumlah Potongan", "Total Deductions"), slip.deduction, "red")}
      </DocSection>

      {/* band THP */}
      <div className="mt-4 flex items-center justify-between overflow-hidden rounded-md bg-emerald-700 px-4 py-3 text-white">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">{t("Take Home Pay (Net THP)", "Take Home Pay (Net THP)")}</div>
          <div className="text-[9.5px] opacity-70">{t("Bruto − Total Potongan", "Gross − Total Deductions")}</div>
        </div>
        <div className="text-[22px] font-extrabold tabular-nums">{money(slip.net)}</div>
      </div>

      <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[10px] italic leading-snug text-slate-500">
        {taxTotal > 0 && (
          <li>{t("Termasuk potongan PPh Pasal 21 sebesar {v} (regular {r} · irregular {i}).", "Includes PPh Article 21 withholding of {v} (regular {r} · irregular {i}).", { v: money(taxTotal), r: money(slip.taxRegular), i: money(slip.taxIrregular) })}</li>
        )}
        {infos.length > 0 && (
          <li>{t("Informasi: {items}.", "Information: {items}.", { items: infos.map((i) => `${i.name}: ${i.amount == null ? "—" : i.amount}`).join(" · ") })}</li>
        )}
        {slip.notes && <li>{slip.notes}</li>}
      </ul>

      <SignOff place={docPlace(data.company?.city, data.officer.printedAt)} preparedBy={data.officer.name} />
      <Confidentiality />
    </PrintDoc>
  );
}

// ==================== R1.2 — REKAPITULASI GAJI BULANAN =====================

interface RegisterPayload extends DocMeta {
  columns: { code: string; name: string; type: string }[];
  rows: {
    employeeNo: string; employeeName: string; orgUnitName: string; positionName: string;
    ptkpStatus: string; umkWarning: boolean;
    per: Record<string, number | null>;
    bruto: number | null; deduction: number | null; tax: number | null; net: number | null;
  }[];
  totals: {
    employees: number; perColumn: Record<string, number | null>;
    totalBruto: number | null; totalDeduction: number | null; totalTax: number | null; totalNet: number | null;
    umkWarnings: number;
  };
  filters?: { unit?: string[] };
}

export function RegisterDoc({ data }: { data: RegisterPayload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Jumlah Karyawan", "Employees"), value: `${data.totals.employees} ${t("orang", "persons")}` },
    { label: t("Run", "Run"), value: data.run?.runNo ?? "—" },
  ]);
  const earnCols = data.columns.filter((c) => c.type === "Earning");
  const dedCols = data.columns.filter((c) => c.type === "Deduction");
  const infoCols = data.columns.filter((c) => c.type === "Informational");
  const span = 6 + earnCols.length + dedCols.length + infoCols.length;

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Laporan Rekapitulasi Gaji Bulanan", "Payroll Summary Register")}
        subtitle={`${data.run?.runNo ?? "—"} · ${data.run?.processTypeName ?? ""}${data.filters?.unit?.length ? ` · ${data.filters.unit.join(", ")}` : ""}`}
        reportNo="R1.2"
        meta={meta}
      />
      <DocSection
        title={t("Daftar Induk Komponen Upah (untuk ayat jurnal akuntansi)", "Master List of Wage Components (for accounting entries)")}
        note={t(
          "Kolom iuran perusahaan (kode _C, latar kuning) berada di luar Bruto/THP. Baris dengan tanda † berada di bawah UMP/UMK kantor penempatan (peringatan edukatif).",
          "Company-borne premium columns (_C codes, yellow tint) sit outside Gross/THP. Rows marked † fall below the office UMP/UMK (advisory warning).",
        )}
      >
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Nama", "Name")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Jabatan", "Position")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">PTKP</th>
              {earnCols.map((c) => (
                <th key={c.code} className={cn("border border-slate-700 px-1.5 py-1 text-right text-[8.5px] font-bold uppercase leading-tight", isCompanyCode(c.code) && "bg-amber-600")}>
                  {c.name}{isCompanyCode(c.code) ? " ⛭" : ""}
                </th>
              ))}
              {dedCols.map((c) => (
                <th key={c.code} className="border border-slate-700 px-1.5 py-1 text-right text-[8.5px] font-bold uppercase leading-tight">{c.name}</th>
              ))}
              <th className="border border-slate-700 bg-slate-900 px-1.5 py-1 text-right text-[8.5px] font-bold uppercase">{t("Total Bruto", "Gross")}</th>
              <th className="border border-slate-700 bg-slate-900 px-1.5 py-1 text-right text-[8.5px] font-bold uppercase">{t("Total Potongan", "Deductions")}</th>
              <th className="border border-slate-700 bg-slate-900 px-1.5 py-1 text-right text-[8.5px] font-bold uppercase">PPh 21</th>
              <th className="border border-slate-700 bg-emerald-800 px-1.5 py-1 text-right text-[8.5px] font-bold uppercase">{t("Take Home Pay", "THP")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyDocRow colSpan={span} message={t("Tidak ada baris untuk filter ini.", "No rows for this filter.")} />}
            {data.rows.map((r, idx) => (
              <tr key={r.employeeNo} className={cn(idx % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{r.employeeNo}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5 font-semibold">{r.employeeName}{r.umkWarning && <span title="Di bawah UMP/UMK"> †</span>}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.orgUnitName}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.positionName}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{r.ptkpStatus}</td>
                {[...earnCols, ...dedCols, ...infoCols].map((c) => {
                  const v = r.per[c.code];
                  return (
                    <td key={c.code} className={cn(
                      "border border-slate-300 px-1.5 py-0.5 text-right tabular-nums",
                      c.type === "Deduction" && "text-rose-700",
                      isCompanyCode(c.code) && "bg-amber-50 text-slate-500",
                    )}>
                      {v == null || v === 0 ? "—" : new Intl.NumberFormat("id-ID").format(v)}
                    </td>
                  );
                })}
                <td className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-right font-bold tabular-nums">{money(r.bruto)}</td>
                <td className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-right font-bold text-rose-700 tabular-nums">{money(r.deduction)}</td>
                <td className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-right font-bold tabular-nums">{money(r.tax)}</td>
                <td className="border border-slate-300 bg-emerald-50 px-1.5 py-0.5 text-right font-extrabold tabular-nums">{money(r.net)}</td>
              </tr>
            ))}
            {/* baris total */}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={4} className="border border-slate-400 px-1.5 py-1 text-[9.5px] uppercase tracking-wide">
                {t("Total ({n} karyawan)", "Total ({n} employees)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-1.5 py-1 text-center">Σ</td>
              {[...earnCols, ...dedCols, ...infoCols].map((c) => {
                const v = data.totals.perColumn[c.code];
                return (
                  <td key={c.code} className={cn("border border-slate-400 px-1.5 py-1 text-right tabular-nums", isCompanyCode(c.code) && "bg-amber-100")}>
                    {v == null || v === 0 ? "—" : new Intl.NumberFormat("id-ID").format(v)}
                  </td>
                );
              })}
              <td className="border border-slate-400 bg-slate-300 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalBruto)}</td>
              <td className="border border-slate-400 bg-slate-300 px-1.5 py-1 text-right font-extrabold text-rose-800 tabular-nums">{money(data.totals.totalDeduction)}</td>
              <td className="border border-slate-400 bg-slate-300 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalTax)}</td>
              <td className="border border-slate-400 bg-emerald-200 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.totalNet)}</td>
            </tr>
          </tbody>
        </table>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Gross (Bruto)", "Total Gross"), value: money(data.totals.totalBruto), tone: "dark" },
          { label: t("Total Deductions (Potongan)", "Total Deductions"), value: money(data.totals.totalDeduction), tone: "red" },
          { label: t("Total PPh 21", "Total PPh 21"), value: money(data.totals.totalTax), tone: "dark" },
          { label: t("Total Net Payroll (THP)", "Total Net Payroll (THP)"), value: money(data.totals.totalNet), tone: "green" },
        ]}
      />

      <SignOff place={docPlace(data.company?.city, data.officer.printedAt)} preparedBy={data.officer.name} />
      <Confidentiality />
    </PrintDoc>
  );
}

const isCompanyCode = (code: string) => code.endsWith("_C");

// ==================== R1.3 — REKAP TRANSFER BANK ===========================

interface BankPayload extends DocMeta {
  groups: {
    bank: string;
    rows: { employeeNo: string; name: string; orgUnitName: string; account: string; net: number | null; tax: number | null }[];
    subtotalNet: number | null;
  }[];
  totals: { employees: number; banks: number; totalNet: number | null; totalTax: number | null };
  filters?: { bank: string | null; unit?: string[] };
}

export function BankTransferDoc({ data }: { data: BankPayload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Jumlah Penerima", "Beneficiaries"), value: `${data.totals.employees} ${t("orang", "persons")}` },
    { label: t("Bank", "Bank"), value: data.filters?.bank ? data.filters.bank : t("Semua Bank", "All Banks") },
  ]);
  const keterangan = `GAJI ${data.run?.periodName ?? ""} ${data.run?.runNo ?? ""}`.trim();

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Rekap Transfer Bank Payroll (Bank-Link File)", "Payroll Bank Transfer Recap (Bank-Link File)")}
        subtitle={`${data.run?.runNo ?? "—"} · ${data.run?.processTypeName ?? ""}`}
        reportNo="R1.3"
        meta={meta}
      />
      <DocSection
        title={t("Daftar Transfer Take Home Pay per Bank Mitra", "THP Transfer List per Partner Bank")}
        note={t(
          "Dokumen ini adalah rekap distribusi pembayaran — file mesin (CSV) siap unggah ke portal payroll bank mitra (BCA, Mandiri, BNI, BRI, dll). Nominal transfer = Take Home Pay (Net THP).",
          "This document is the payment distribution recap — the machine file (CSV) is ready for upload to partner bank payroll portals (BCA, Mandiri, BNI, BRI, etc.). Transfer amount = Take Home Pay (Net THP).",
        )}
      >
        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">No</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Nama Penerima", "Beneficiary Name")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("No. Rekening", "Account No.")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Bank", "Bank")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("PPh 21", "PPh 21")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Nominal Transfer (Net THP)", "Transfer Amount (Net THP)")}</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.length === 0 && <EmptyDocRow colSpan={8} message={t("Tidak ada baris untuk filter ini.", "No rows for this filter.")} />}
            {data.groups.map((g) => (
              <Fragment key={g.bank}>
                <tr className="bg-slate-700 text-white">
                  <td colSpan={6} className="border border-slate-600 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide">
                    {g.bank} — {g.rows.length} {t("penerima", "beneficiaries")}
                  </td>
                  <td colSpan={2} className="border border-slate-600 px-2 py-1 text-right text-[10px] font-extrabold uppercase tabular-nums">
                    {t("Subtotal", "Subtotal")} {money(g.subtotalNet)}
                  </td>
                </tr>
                {g.rows.map((r, i) => (
                  <tr key={g.bank + r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                    <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{i + 1}</td>
                    <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{r.employeeNo}</td>
                    <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5 font-semibold">{r.name}</td>
                    <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.orgUnitName}</td>
                    <td className="border border-slate-300 px-1.5 py-0.5 text-center font-mono tracking-wide">{r.account || "—"}</td>
                    <td className="border border-slate-300 px-1.5 py-0.5 text-center">{g.bank}</td>
                    <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{money(r.tax)}</td>
                    <td className="border border-slate-300 px-1.5 py-0.5 text-right font-bold tabular-nums">{money(r.net)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="bg-emerald-700 font-bold text-white">
              <td colSpan={7} className="border border-emerald-800 px-2 py-1.5 text-[10px] uppercase tracking-wide">
                {t("Grand Total — {n} penerima · {b} bank", "Grand Total — {n} beneficiaries · {b} banks", { n: String(data.totals.employees), b: String(data.totals.banks) })}
              </td>
              <td className="border border-emerald-800 px-2 py-1.5 text-right text-[12px] font-extrabold tabular-nums">{money(data.totals.totalNet)}</td>
            </tr>
          </tbody>
        </table>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Dana Ditransfer (Net THP)", "Total Funds Transferred (Net THP)"), value: money(data.totals.totalNet), tone: "green" },
          { label: t("Total PPh 21 (sebelum transfer)", "Total PPh 21 (pre-transfer)"), value: money(data.totals.totalTax), tone: "dark" },
          { label: t("Jumlah Penerima", "Beneficiaries"), value: `${data.totals.employees} ${t("orang", "persons")}`, tone: "dark" },
          { label: t("Keterangan Transfer", "Transfer Description"), value: keterangan || "—", tone: "dark" },
        ]}
      />

      <SignOff
        place={docPlace(data.company?.city, data.officer.printedAt)}
        preparedBy={data.officer.name}
        extraBank
        notes={t(
          "Blok tanda tangan ganda (bank & perusahaan) sesuai kebutuhan verifikasi payroll batch bank mitra.",
          "Dual sign-off block (bank & company) as required by partner bank payroll batch verification.",
        )}
      />
      <Confidentiality />
    </PrintDoc>
  );
}
