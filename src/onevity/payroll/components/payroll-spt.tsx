"use client";
// OneVity Payroll — SPT & Pajak Tahunan (P4): rekap PPh21 1721-A1 per karyawan,
// ekspor CSV 1721-A1 + bukti potong bulanan siap upload Coretax.
import { useState } from "react";
import { useApi, fmtIDR, fmtIDRShort } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TAX_STATUS_LABEL, SptReportData, PeriodRow } from "@/onevity/payroll/components/payroll-types";
import { FileSpreadsheet, FileDown, Landmark, Calculator, ArrowDownUp, Info, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

export function PayrollSptPage() {
  const { t } = useI18n();
  const periodsApi = useApi<{ periods: PeriodRow[] }>("/api/onevity/payroll-periods");
  const years = [...new Set((periodsApi.data?.periods ?? []).map((p) => p.sptYear))].sort((a, b) => b - a);
  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());
  const [coretaxPeriod, setCoretaxPeriod] = useState<string>("");

  const { data, loading } = useApi<SptReportData>(`/api/onevity/payroll-spt?year=${year}`);
  const report = data;
  const totals = report?.totals;

  const confirmedPeriods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Processed" || p.status === "Closed" || p.status === "Locked");

  const kpi = [
    {
      label: t("Bruto Kena Pajak Setahun", "Annual Taxable Gross"), value: totals ? fmtIDRShort(totals.brutoTaxable) : "—",
      sub: report ? t("{e} pegawai · {r} baris run", "{e} employees · {r} run rows", { e: totals?.employees ?? 0, r: report.employees.reduce((s, r) => s + r.runs, 0) }) : "",
      icon: Landmark, tone: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
    },
    {
      label: t("PPh21 Dipotong (Bulanan)", "PPh21 Withheld (Monthly)"), value: totals ? fmtIDRShort(totals.taxWithheld) : "—",
      sub: t("Akumulasi taxR + taxI dari run final", "Accumulated taxR + taxI from final runs"),
      icon: Calculator, tone: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
    },
    {
      label: t("PPh21 Pasal 17 Setahun", "Annual PPh21 Article 17"), value: totals ? fmtIDRShort(totals.pph21Annual) : "—",
      sub: report ? t("Biaya jabatan {r}% cap {c}/thn", "Employment expense {r}% capped at {c}/yr", { r: (report.regulation.biayaJabatanRate * 100).toFixed(0), c: fmtIDRShort(report.regulation.biayaJabatanCapAnnual) }) : "",
      icon: FileSpreadsheet, tone: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    },
    {
      label: t("Kurang / (Lebih) Bayar", "Under / (Over) Paid"), value: totals ? fmtIDRShort(totals.delta) : "—",
      sub: t("PPh21 setahun − telah dipotong", "Annual PPh21 − already withheld"),
      icon: ArrowDownUp, tone: totals && totals.delta > 0
        ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
        : "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("SPT & Pajak Tahunan", "SPT & Annual Tax")}
        description={t("Rekap PPh21 tahunan (1721-A1) dari seluruh run final — bruto, biaya jabatan, iuran JSTK, PKP, progresif setahun vs telah dipotong", "Annual PPh21 recap (1721-A1) from all final runs — gross, employment expense, JSTK contributions, PKP, annual progressive vs withheld")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/onevity/payroll-spt?year=${year}&export=a1`}
              className="ov-fill hover:ov-fill-deep inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-bold shadow-sm transition"
            >
              <FileDown className="h-4 w-4" /> {t("Ekspor 1721-A1 (CSV)", "Export 1721-A1 (CSV)")}
            </a>
            {/* 27-c — e-SPT 1721-A1 format resmi DJP (siap tempel ke template impor
                e-Bupot 21/26 sheet A1 / Coretax BP A1). Tooltip = peta kolom. */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={`/api/onevity/payroll-spt?year=${year}&export=espt`}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-4 text-[13px] font-bold text-brand-deep shadow-sm transition hover:bg-brand/15 dark:border-brand/40 dark:bg-brand/10 dark:text-brand/85 dark:hover:bg-brand/20"
                  >
                    <FileUp className="h-4 w-4" /> {t("e-SPT 1721-A1 (CSV DJP)", "e-SPT 1721-A1 (DJP CSV)")}
                    <Info className="h-3.5 w-3.5 text-brand/70" />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="w-80 text-[11px] leading-relaxed">
                  <p className="mb-1 font-bold">{t("Peta kolom template A1 DJP (e-Bupot 21/26 v1.4 Tabel 3.3, 39 kolom, semicolon)", "DJP A1 template map (e-Bupot 21/26 v1.4 Table 3.3, 39 columns, semicolon)")}</p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>{t("Gaji/Pensiun ← komponen Gaji Pokok", "Salary/Pension ← Base Salary components")}</li>
                    <li>{t("Tunjangan PPh ← Tunjangan PPh21 ditanggung perusahaan (gross-up)", "Tax Allowance ← company-borne PPh21 allowance (gross-up)")}</li>
                    <li>{t("Tunjangan Lainnya/Lembur ← tunjangan reguler + iuran JHT/JP perusahaan (objek pajak)", "Other Allowances/Overtime ← regular allowances + company JHT/JP (taxable)")}</li>
                    <li>{t("Premi Asuransi ← JKK + JKM + JKN perusahaan", "Insurance Premium ← company JKK + JKM + JKN")}</li>
                    <li>{t("Tantiem/Bonus/THR ← komponen irreguler (THR, bonus)", "Bonus/THR ← irregular components")}</li>
                    <li>{t("Biaya Jabatan ← 5% (cap Rp 6 jt/thn)", "Employment expense ← 5% (capped Rp 6M/yr)")}</li>
                    <li>{t("Iuran Pensiun/THT/JHT ← potongan JHT 2% + JP 1% pegawai", "Pension/JHT contributions ← employee JHT 2% + JP 1%")}</li>
                    <li>{t("Bruto & PPh21 masa terakhir/sebelumnya ← pecahan per masa pajak dari run final", "Last & prior-masa gross/PPh21 ← per-tax-month split from final runs")}</li>
                  </ul>
                  <p className="mt-1 font-semibold text-stone-500">
                    {t("Angka tanpa tanda baca · tanggal dd/mm/yyyy · NPWP 15 digit · Honorarium/Natura/Zakat = 0 (belum dipisah). Tempel ke sheet A1 Template Impor e-Bupot 21/26 (maks 2 MB/10.000 baris, masa pajak = masa terakhir) — hati-hati Excel mengubah kolom NPWP jadi notasi ilmiah saat CSV dibuka & disimpan ulang.", "Numbers without punctuation · dates dd/mm/yyyy · NPWP 15 digits · Honorarium/Natura/Zakat = 0 (not split yet). Paste into sheet A1 of the e-Bupot 21/26 import template (max 2 MB/10,000 rows, tax period = last period) — beware Excel converting the NPWP column to scientific notation when the CSV is re-opened & re-saved.")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        }
      />

      {/* Tahun + Coretax bulanan */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[150px] text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(years.length ? years : [new Date().getFullYear()]).map((y) => (
                <SelectItem key={y} value={String(y)}>{t("Tahun Pajak {y}", "Tax Year {y}", { y })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-bold text-stone-400">{t("Bukti potong Coretax bulanan", "Monthly Coretax withholding slips")}</span>
            <Select value={coretaxPeriod} onValueChange={setCoretaxPeriod}>
              <SelectTrigger className="h-9 w-[190px] text-xs font-bold"><SelectValue placeholder={t("Pilih period", "Select period")} /></SelectTrigger>
              <SelectContent>
                {confirmedPeriods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <a
              href={coretaxPeriod ? `/api/onevity/payroll-spt?export=coretax&periodId=${coretaxPeriod}` : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[12px] font-bold transition",
                coretaxPeriod
                  ? "border-brand/40 text-brand-deep hover:bg-brand/10 dark:border-brand/40 dark:text-brand/85 dark:hover:bg-brand/10"
                  : "pointer-events-none border-stone-200 text-stone-300 dark:border-stone-700 dark:text-stone-600"
              )}
            >
              <FileDown className="h-3.5 w-3.5" /> CSV
            </a>
          </div>
        </CardContent>
      </Card>

      {loading && !report ? (
        <LoadingRows rows={6} />
      ) : !report || report.employees.length === 0 ? (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-5">
            <EmptyState
              title={t("Belum ada run final pada tahun {y}", "No final runs in year {y}", { y: year })}
              description={t("SPT tahunan terbentuk otomatis dari run yang dikonfirmasi/dibayar. Proses payroll pada tahun pajak ini terlebih dahulu.", "The annual SPT is generated automatically from confirmed/paid runs. Run payroll for this tax year first.")}
              icon={<FileSpreadsheet className="h-6 w-6" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpi.map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.label} className="flex items-start gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p>
                    <p className="truncate text-lg font-extrabold text-stone-900 dark:text-stone-50">{k.value}</p>
                    <p className="truncate text-[11px] text-stone-400">{k.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                      <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("PTKP")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Bruto Reguler", "Regular Gross")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Bruto Irreguler", "Irregular Gross")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Biaya Jabatan", "Employment Expense")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Iuran JSTK", "JSTK Contributions")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Neto / PKP", "Net / PKP")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("PPh21 Setahun", "Annual PPh21")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Dipotong", "Withheld")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Kurang/(Lebih)", "Under/(Over)")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.employees.map((r) => (
                      <TableRow key={r.employeeId} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                        <TableCell>
                          <p className="text-[13px] font-semibold">{r.employeeName}</p>
                          <p className="text-[10px] text-stone-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="cursor-help text-[10px] font-mono">{r.taxStatus}</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="text-[11px]">
                                <p className="font-bold">{TAX_STATUS_LABEL[r.taxStatus] ?? r.taxStatus}</p>
                                <p>{t("PTKP Rp {v}/thn · {n} run · {s}", "PTKP Rp {v}/yr · {n} runs · {s}", { v: fmtIDR(r.ptkpAnnual), n: r.runs, s: r.hasNpwp ? "NPWP" : "non-NPWP (+20%)" })}</p>
                                {!r.hasNpwp && <p className="text-rose-500">{t("Dipotong dgn penalti non-NPWP", "Withheld with non-NPWP penalty")}</p>}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmtIDR(r.incomeRegular)}</TableCell>
                        <TableCell className="text-right text-xs text-stone-500">{r.incomeIrregular ? fmtIDR(r.incomeIrregular) : "—"}</TableCell>
                        <TableCell className="text-right text-xs text-stone-500">{fmtIDR(r.biayaJabatan)}</TableCell>
                        <TableCell className="text-right text-xs text-stone-500">{fmtIDR(r.iuranJstk)}</TableCell>
                        <TableCell className="text-right text-xs">
                          <p>{fmtIDR(r.neto)}</p>
                          <p className="text-[10px] text-stone-400">PKP {fmtIDR(r.pkp)}</p>
                        </TableCell>
                        <TableCell className="text-right text-xs font-bold text-stone-700 dark:text-stone-300">{fmtIDR(r.pph21Annual)}</TableCell>
                        <TableCell className="text-right text-xs text-brand-deep dark:text-brand/85">{fmtIDR(r.taxWithheld)}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold",
                            r.delta > 0
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                              : "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85"
                          )}>
                            {r.delta > 0 ? "+" : ""}{fmtIDR(r.delta)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                      <TableCell className="text-[11px] font-bold uppercase tracking-wide text-stone-500">{t("Total ({n} pegawai)", "Total ({n} employees)", { n: totals?.employees ?? 0 })}</TableCell>
                      <TableCell />
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(report.employees.reduce((s, r) => s + r.incomeRegular, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(report.employees.reduce((s, r) => s + r.incomeIrregular, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(totals?.biayaJabatan ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(totals?.iuranJstk ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(totals?.neto ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(totals?.pph21Annual ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold text-brand-deep dark:text-brand/85">{fmtIDR(totals?.taxWithheld ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(totals?.delta ?? 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="flex items-start gap-3 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
              <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                {t("Metode: bruto kena pajak (reguler + irreguler) − biaya jabatan 5% (cap Rp 6.000.000/thn) − iuran JHT/JP pegawai = neto; neto − PTKP tahunan = PKP → ", "Method: taxable gross (regular + irregular) − employment expense 5% (capped at Rp 6,000,000/yr) − employee JHT/JP contributions = net; net − annual PTKP = PKP → ")}
                <b>{t("progresif Pasal 17 setahun", "annual Article 17 progressive")}</b>
                {t(". Dipotong = akumulasi PPh21 bulanan (TER/progresif annualized) dari run final. Selisih positif = ", ". Withheld = accumulated monthly PPh21 (TER/annualized progressive) from final runs. A positive difference means ")}
                <b>{t("kurang bayar", "underpaid")}</b>
                {t(" (pelunasan via tahunan/Year End Adjustment). Karyawan non-NPWP dikenai penalti tarif ×1,2 sesuai bracket.", " (settled via annual/Year End Adjustment). Non-NPWP employees are charged a ×1.2 rate penalty per bracket.")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
