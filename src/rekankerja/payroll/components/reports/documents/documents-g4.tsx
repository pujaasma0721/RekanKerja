"use client";
// RekanKerja Payroll — GRUP 4: ANALISIS BIAYA TENAGA KERJA ==================
// R4.1 Payroll Variance (bulan berjalan vs bulan lalu + deteksi anomali)
// R4.2 Total Cost of Workforce (per departemen: THP + pajak + BPJS perusahaan)
// R4.3 Pencairan Uang Lembur (indeks resmi 1/173 × multiplier).
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocMeta } from "../params";
import {
  PrintDoc, DocHeader, useStandardMeta, DocSection, TotalBand, SignOff, Confidentiality,
  money, pct1, num, minutesLabel, docPlace, EmptyDocRow,
} from "../doc-kit";

// ================== R4.1 — PAYROLL VARIANCE ================================

interface VariancePayload extends DocMeta {
  current: { id: string; name: string; code: string; sptMonth: number; sptYear: number };
  previous: { id: string; name: string; code: string; sptMonth: number; sptYear: number } | null;
  summary: {
    label: string; current: number; previous: number | null; delta: number | null;
    deltaPct: number | null; money: boolean; anomaly: boolean;
  }[];
  byUnit: {
    unit: string; employeesCur: number; employeesPrev: number;
    brutoCur: number | null; brutoPrev: number | null; netCur: number | null;
    delta: number | null; deltaPct: number | null;
  }[];
}

export function VarianceDoc({ data }: { data: VariancePayload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Bulan Berjalan", "Current Month"), value: data.current.name },
    { label: t("Bulan Lalu (pembanding)", "Previous Month (comparison)"), value: data.previous?.name ?? t("— tidak ada", "— none") },
  ]);

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Laporan Variansi Biaya Payroll", "Payroll Variance Report")}
        subtitle={`${data.current.name} vs ${data.previous?.name ?? "—"}`}
        reportNo="R4.1"
        meta={meta}
      />
      <DocSection
        title={t("Ringkasan Variansi — Bulan Berjalan vs Bulan Lalu", "Variance Summary — Current vs Previous Month")}
        note={t(
          "Δ% ≥ ±10% ditandai ANOMALI untuk investigasi (kenaikan gaji, rapel, THR, karyawan masuk/keluar, atau kesalahan input).",
          "Δ% ≥ ±10% is flagged as ANOMALY for investigation (raises, back pay, THR, headcount changes, or input errors).",
        )}
      >
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Komponen Biaya", "Cost Component")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{data.previous?.name ?? t("Bulan Lalu", "Previous")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{data.current.name}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">Δ</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">Δ%</th>
              <th className="w-[26mm] border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("Status", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.map((s, i) => (
              <tr key={s.label} className={cn(i % 2 === 1 && "bg-slate-50/70", s.anomaly && "bg-amber-50 font-semibold")}>
                <td className="border border-slate-300 px-2 py-1 font-semibold">{s.label}</td>
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{s.money ? money(s.previous) : num(s.previous)}</td>
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{s.money ? money(s.current) : num(s.current)}</td>
                <td className={cn(
                  "border border-slate-300 px-2 py-1 text-right tabular-nums",
                  s.delta != null && s.delta > 0 && "text-rose-700",
                  s.delta != null && s.delta < 0 && "text-emerald-700",
                )}>
                  {s.delta == null ? "—" : (s.delta > 0 ? "+" : "") + (s.money ? money(s.delta) : num(s.delta))}
                </td>
                <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{pct1(s.deltaPct)}</td>
                <td className="border border-slate-300 px-2 py-1 text-center">
                  {s.anomaly ? (
                    <span className="inline-block rounded-sm bg-amber-500/15 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide text-amber-700 ring-1 ring-amber-500/40">
                      ⚠ {t("Anomali", "Anomaly")}
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase tracking-wide text-slate-400">{t("Wajar", "Normal")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DocSection>

      <DocSection title={t("Rincian per Unit Kerja (basis bruto)", "Breakdown per Org Unit (gross basis)")}>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Org Unit")}</th>
              <th className="border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("Karyawan (lalu)", "Employees (prev.)")}</th>
              <th className="border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("Karyawan (kini)", "Employees (cur.)")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Bruto Bulan Lalu", "Gross Previous")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Bruto Bulan Berjalan", "Gross Current")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Net THP Berjalan", "Net THP Current")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">Δ Bruto</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">Δ%</th>
            </tr>
          </thead>
          <tbody>
            {data.byUnit.length === 0 && <EmptyDocRow colSpan={8} message="—" />}
            {data.byUnit.map((u, i) => (
              <tr key={u.unit} className={cn(i % 2 === 1 && "bg-slate-50/70", u.deltaPct != null && Math.abs(u.deltaPct) >= 10 && "bg-amber-50 font-semibold")}>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-0.5 font-semibold">{u.unit}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">{u.employeesPrev}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">{u.employeesCur}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(u.brutoPrev)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(u.brutoCur)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(u.netCur)}</td>
                <td className={cn("border border-slate-300 px-2 py-0.5 text-right tabular-nums", u.delta != null && u.delta > 0 && "text-rose-700", u.delta != null && u.delta < 0 && "text-emerald-700")}>
                  {u.delta == null ? "—" : (u.delta > 0 ? "+" : "") + money(u.delta)}
                </td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{pct1(u.deltaPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DocSection>

      <TotalBand
        items={data.summary.slice(1, 5).map((s) => ({
          label: `${s.label} (Δ ${pct1(s.deltaPct)})`,
          value: s.money ? money(s.current) : num(s.current),
          tone: s.anomaly ? "red" as const : "dark" as const,
        }))}
      />

      <SignOff
        place={docPlace(data.company?.city, data.officer.printedAt)}
        preparedBy={data.officer.name}
        notes={t(
          "Perbandingan memakai run Confirmed/Paid pada masing-masing periode. Perubahan headcount, rapel, THR/bonus, dan koreksi data memengaruhi variansi — lampirkan justifikasi untuk setiap anomali.",
          "Comparison uses Confirmed/Paid runs in each period. Headcount changes, back pay, THR/bonus, and data corrections affect variance — attach justification for every anomaly.",
        )}
      />
      <Confidentiality />
    </PrintDoc>
  );
}

// ================== R4.2 — TOTAL COST OF WORKFORCE ===========================

interface TcowPayload extends DocMeta {
  period: { id: string; name: string; code: string; sptMonth: number; sptYear: number };
  runs: string[];
  rows: {
    unit: string; employees: number; net: number | null; tax: number | null;
    taxAllowance: number | null; bpjsCompany: number | null; totalCost: number | null;
  }[];
  totals: {
    employees: number; net: number; tax: number; taxAllowance: number; bpjsCompany: number;
    totalCost: number; costPerEmployee: number;
  } | null;
}

export function TcowDoc({ data }: { data: TcowPayload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Periode", "Period"), value: data.period.name },
    { label: t("Sumber Run", "Source Runs"), value: data.runs.join(", ") },
    { label: t("Jumlah Karyawan", "Employees"), value: `${data.totals?.employees ?? 0} ${t("orang", "persons")}` },
  ]);
  const grand = data.totals?.totalCost ?? 0;

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Laporan Total Cost of Workforce (TCOW)", "Total Cost of Workforce (TCOW) Report")}
        subtitle={`${data.period.name} · ${t("biaya per departemen", "cost per department")}`}
        reportNo="R4.2"
        meta={meta}
      />
      <DocSection
        title={t("Total Biaya Tenaga Kerja per Departemen — Gaji Bersih + Pajak Ditanggung + Iuran BPJS Perusahaan", "Total Workforce Cost per Department — Net Salary + Tax Borne + Company BPJS")}
        note={t(
          "TCOW = Σ Take Home Pay (gaji bersih yang diterima karyawan) + Σ PPh 21 dipotong dari karyawan + Σ tunjangan PPh (gross-up) + Σ iuran BPJS porsi perusahaan. Angka ini mencerminkan total arus kas perusahaan untuk tenaga kerja — bukan hanya gaji bersih.",
          "TCOW = Σ Take Home Pay (net salary received by employees) + Σ PPh 21 withheld from employees + Σ PPh allowance (gross-up) + Σ company-portion BPJS premiums. This reflects the company's total cash outflow for workforce — not just net salary.",
        )}
      >
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">No</th>
              <th className="border border-slate-700 px-2 py-1 text-left text-[9px] font-bold uppercase">{t("Departemen / Unit", "Department / Unit")}</th>
              <th className="border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">{t("Karyawan", "Employees")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Net Salary (THP)", "Net Salary (THP)")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("PPh 21 Dipotong", "PPh 21 Withheld")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Tunjangan PPh (Gross-Up)", "PPh Allowance (Gross-Up)")}</th>
              <th className="border border-slate-700 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("BPJS Perusahaan", "Company BPJS")}</th>
              <th className="border border-slate-700 bg-teal-800 px-2 py-1 text-right text-[9px] font-bold uppercase">{t("Total Cost", "Total Cost")}</th>
              <th className="w-[18mm] border border-slate-700 px-2 py-1 text-center text-[9px] font-bold uppercase">%</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && <EmptyDocRow colSpan={9} message="—" />}
            {data.rows.map((r, i) => (
              <tr key={r.unit} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="whitespace-nowrap border border-slate-300 px-2 py-0.5 font-semibold">{r.unit}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">{r.employees}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.net)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.tax)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.taxAllowance)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-right tabular-nums">{money(r.bpjsCompany)}</td>
                <td className="border border-slate-300 bg-teal-50 px-2 py-0.5 text-right font-extrabold tabular-nums">{money(r.totalCost)}</td>
                <td className="border border-slate-300 px-2 py-0.5 text-center tabular-nums">
                  {r.totalCost && grand > 0 ? pct1((r.totalCost / grand) * 100) : "—"}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={2} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total Perusahaan", "Company Total")}
              </td>
              <td className="border border-slate-400 px-2 py-1 text-center tabular-nums">{data.totals?.employees ?? 0}</td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals?.net ?? null)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals?.tax ?? null)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals?.taxAllowance ?? null)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals?.bpjsCompany ?? null)}</td>
              <td className="border border-slate-400 bg-teal-200 px-2 py-1 text-right font-extrabold tabular-nums">{money(data.totals?.totalCost ?? null)}</td>
              <td className="border border-slate-400 px-2 py-1 text-center font-extrabold">100%</td>
            </tr>
          </tbody>
        </table>
      </DocSection>

      <TotalBand
        items={[
          { label: t("Total Net Salary (THP)", "Total Net Salary (THP)"), value: money(data.totals?.net ?? null), tone: "dark" },
          { label: t("Total Pajak Ditanggung/Dipotong", "Total Tax Borne/Withheld"), value: money((data.totals?.tax ?? 0) + (data.totals?.taxAllowance ?? 0)), tone: "red" },
          { label: t("Total BPJS Perusahaan", "Total Company BPJS"), value: money(data.totals?.bpjsCompany ?? null), tone: "dark" },
          { label: t("TCOW + per Karyawan", "TCOW + per Employee"), value: `${money(data.totals?.totalCost ?? null)} · ${money(data.totals?.costPerEmployee ?? null)}/kry.`, tone: "green" },
        ]}
      />

      <SignOff
        place={docPlace(data.company?.city, data.officer.printedAt)}
        preparedBy={data.officer.name}
        notes={t(
          "Dasar pengambilan keputusan eksekutif: alokasi anggaran SDM, efisiensi departemen, dan negosiasi remunerasi. Data run Confirmed/Paid pada periode terpilih.",
          "Basis for executive decision making: HR budget allocation, departmental efficiency, and remuneration negotiation. Data from Confirmed/Paid runs in the selected period.",
        )}
      />
      <Confidentiality />
    </PrintDoc>
  );
}

// ================== R4.3 — PENCAIRAN UANG LEMBUR ===========================

interface OvertimePayload extends DocMeta {
  rows: {
    employeeNo: string; employeeName: string; orgUnitName: string;
    orders: number; minutes: number; index: string;
    hourlyRate: number | null; estimated: number | null; runAmount: number | null;
  }[];
  orders: {
    orderNo: string; date: string; minutes: number; dayCategory: string;
    multiplier: number; employeeName: string; employeeNo: string;
  }[];
  totals: { employees: number; orders: number; minutes: number; estimated: number | null; runAmount: number | null };
}

export function OvertimeSheetDoc({ data }: { data: OvertimePayload }) {
  const { t } = useI18n();
  const meta = useStandardMeta(data, [
    { label: t("Order Lembur Dibayar", "Paid OT Orders"), value: `${data.totals.orders} order · ${data.totals.employees} ${t("karyawan", "employees")}` },
    { label: t("Total Jam Lembur", "Total Overtime Hours"), value: minutesLabel(data.totals.minutes) },
  ]);

  return (
    <PrintDoc orientation="landscape">
      <DocHeader
        company={data.company}
        title={t("Rincian Pencairan Uang Lembur ke Payroll", "Overtime Financial Disbursement Sheet")}
        subtitle={`${data.run?.runNo ?? "—"} · ${data.run?.periodName ?? ""} · ${t("indeks resmi", "official index")}`}
        reportNo="R4.3"
        meta={meta}
      />
      <DocSection
        title={t("Rekap per Karyawan — Jam Lembur × Indeks Resmi × Upah/Jam", "Recap per Employee — Overtime Hours × Official Index × Hourly Wage")}
        note={t(
          "Estimasi memakai rumus resmi: upah/jam = 1/173 × gaji pokok bulanan (Kepmenakertrans 102/MEN/VI/2004), dikali indeks hari (PP 35/2021: 1,5× hari kerja pertama, 2× hari libur/istirahat). Kolom “Nominal di Run” = komponen LEMBUR yang benar-benar ditransfer ke run payroll (bila sudah ditransfer).",
          "Estimate uses the official formula: hourly wage = 1/173 × monthly base salary (Kepmenakertrans 102/MEN/VI/2004), times the day index (PP 35/2021: 1.5× first working-day hours, 2× rest day/holiday). The “Amount in Run” column = the LEMBUR component actually transferred into the payroll run (when already transferred).",
        )}
      >
        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-8 border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">No</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("No. Karyawan", "Emp. No.")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Nama", "Name")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Unit Kerja", "Unit")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Order", "Orders")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Jam Lembur", "Overtime")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Indeks", "Index")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Upah/Jam (1/173)", "Hourly Wage (1/173)")}</th>
              <th className="border border-slate-700 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Estimasi Nominal", "Estimated Amount")}</th>
              <th className="border border-slate-700 bg-emerald-800 px-1.5 py-1 text-right text-[9px] font-bold uppercase">{t("Nominal di Run (LEMBUR)", "Amount in Run (Overtime)")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <EmptyDocRow
                colSpan={10}
                message={t(
                  "Tidak ada lembur yang dibayar pada run ini. Transfer lembur via menu Presensi → Lembur (Overtime) → Transfer ke Payroll.",
                  "No overtime paid in this run. Transfer overtime via Attendance → Overtime → Transfer to Payroll.",
                )}
              />
            )}
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{r.employeeNo}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5 font-semibold">{r.employeeName}</td>
                <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{r.orgUnitName}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{r.orders || "—"}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{r.minutes ? minutesLabel(r.minutes) : "—"}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-center font-semibold">{r.index}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.hourlyRate)}</td>
                <td className="border border-slate-300 px-1.5 py-0.5 text-right tabular-nums">{money(r.estimated)}</td>
                <td className="border border-slate-300 bg-emerald-50 px-1.5 py-0.5 text-right font-bold tabular-nums">{r.runAmount ? money(r.runAmount) : t("belum ditransfer", "not transferred")}</td>
              </tr>
            ))}
            <tr className="bg-slate-200 font-bold">
              <td colSpan={4} className="border border-slate-400 px-2 py-1 text-[10px] uppercase tracking-wide">
                {t("Total ({n} karyawan)", "Total ({n} employees)", { n: String(data.totals.employees) })}
              </td>
              <td className="border border-slate-400 px-1.5 py-1 text-center font-extrabold tabular-nums">{data.totals.orders}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-center font-extrabold tabular-nums">{minutesLabel(data.totals.minutes)}</td>
              <td className="border border-slate-400 px-1.5 py-1 text-center">Σ</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold">1/173</td>
              <td className="border border-slate-400 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.estimated)}</td>
              <td className="border border-slate-400 bg-emerald-100 px-1.5 py-1 text-right font-extrabold tabular-nums">{money(data.totals.runAmount)}</td>
            </tr>
          </tbody>
        </table>
      </DocSection>

      {data.orders.length > 0 && (
        <DocSection title={t("Lampiran — Daftar Order Lembur yang Dibayar Run Ini", "Appendix — Overtime Orders Paid in This Run")}>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-slate-700 text-white">
                <th className="border border-slate-600 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("No. Order", "Order No.")}</th>
                <th className="border border-slate-600 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Tanggal", "Date")}</th>
                <th className="border border-slate-600 px-1.5 py-1 text-left text-[9px] font-bold uppercase">{t("Karyawan", "Employee")}</th>
                <th className="border border-slate-600 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Kategori Hari", "Day Category")}</th>
                <th className="border border-slate-600 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Jam Dibayar", "Paid Hours")}</th>
                <th className="border border-slate-600 px-1.5 py-1 text-center text-[9px] font-bold uppercase">{t("Indeks", "Index")}</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o, i) => (
                <tr key={o.orderNo} className={cn(i % 2 === 1 && "bg-slate-50/70")}>
                  <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{o.orderNo}</td>
                  <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">
                    {new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(o.date))}
                  </td>
                  <td className="whitespace-nowrap border border-slate-300 px-1.5 py-0.5">{o.employeeNo} · {o.employeeName}</td>
                  <td className="border border-slate-300 px-1.5 py-0.5 text-center">
                    {o.dayCategory === "Holiday" ? t("Hari Libur", "Holiday") : o.dayCategory === "Weekend" ? t("Hari Istirahat", "Rest Day") : t("Hari Kerja", "Working Day")}
                  </td>
                  <td className="border border-slate-300 px-1.5 py-0.5 text-center tabular-nums">{minutesLabel(o.minutes)}</td>
                  <td className="border border-slate-300 px-1.5 py-0.5 text-center font-semibold tabular-nums">×{o.multiplier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSection>
      )}

      <TotalBand
        items={[
          { label: t("Total Jam Lembur", "Total Overtime Hours"), value: minutesLabel(data.totals.minutes), tone: "dark" },
          { label: t("Estimasi Nominal (1/173 × indeks)", "Estimated Amount (1/173 × index)"), value: money(data.totals.estimated), tone: "dark" },
          { label: t("Nominal di Run Payroll", "Amount in Payroll Run"), value: money(data.totals.runAmount), tone: "green" },
          { label: t("Order Dibayar", "Paid Orders"), value: `${data.totals.orders} order`, tone: "dark" },
        ]}
      />

      <SignOff
        place={docPlace(data.company?.city, data.officer.printedAt)}
        preparedBy={data.officer.name}
        notes={t(
          "Lembur hanya sah dengan persetujuan atasan (order Approved) dan dibayar sesuai indeks resmi. Batas maksimum lembur 4 jam/hari dan 18 jam/minggu (PP 35/2021).",
          "Overtime is only valid with supervisor approval (Approved order) and paid per the official index. Overtime caps: 4 hours/day and 18 hours/week (PP 35/2021).",
        )}
      />
      <Confidentiality />
    </PrintDoc>
  );
}
