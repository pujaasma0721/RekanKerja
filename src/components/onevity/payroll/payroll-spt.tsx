"use client";
// OneVity Payroll — SPT & Pajak Tahunan (P4): rekap PPh21 1721-A1 per karyawan,
// ekspor CSV 1721-A1 + bukti potong bulanan siap upload Coretax.
import { useState } from "react";
import { useApi, fmtIDR, fmtIDRShort } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TAX_STATUS_LABEL, SptReportData, PeriodRow } from "@/components/onevity/payroll/payroll-types";
import { FileSpreadsheet, FileDown, Landmark, Calculator, ArrowDownUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function PayrollSptPage() {
  const periodsApi = useApi<{ periods: PeriodRow[] }>("/api/onevity/payroll-periods");
  const years = [...new Set((periodsApi.data?.periods ?? []).map((p) => p.sptYear))].sort((a, b) => b - a);
  const [year, setYear] = useState<number>(years[0] ?? new Date().getFullYear());
  const [coretaxPeriod, setCoretaxPeriod] = useState<string>("");

  const { data, loading } = useApi<SptReportData>(`/api/onevity/payroll-spt?year=${year}`);
  const report = data;
  const t = report?.totals;

  const confirmedPeriods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Processed" || p.status === "Closed" || p.status === "Locked");

  const kpi = [
    {
      label: "Bruto Kena Pajak Setahun", value: t ? fmtIDRShort(t.brutoTaxable) : "—",
      sub: report ? `${t?.employees} pegawai · ${report.employees.reduce((s, r) => s + r.runs, 0)} baris run` : "",
      icon: Landmark, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
    },
    {
      label: "PPh21 Dipotong (Bulanan)", value: t ? fmtIDRShort(t.taxWithheld) : "—",
      sub: "Akumulasi taxR + taxI dari run final",
      icon: Calculator, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    },
    {
      label: "PPh21 Pasal 17 Setahun", value: t ? fmtIDRShort(t.pph21Annual) : "—",
      sub: report ? `Biaya jabatan ${(report.regulation.biayaJabatanRate * 100).toFixed(0)}% cap ${fmtIDRShort(report.regulation.biayaJabatanCapAnnual)}/thn` : "",
      icon: FileSpreadsheet, tone: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
    },
    {
      label: "Kurang / (Lebih) Bayar", value: t ? fmtIDRShort(t.delta) : "—",
      sub: "PPh21 setahun − telah dipotong",
      icon: ArrowDownUp, tone: t && t.delta > 0
        ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="SPT & Pajak Tahunan"
        description="Rekap PPh21 tahunan (1721-A1) dari seluruh run final — bruto, biaya jabatan, iuran JSTK, PKP, progresif setahun vs telah dipotong"
        actions={
          <a
            href={`/api/onevity/payroll-spt?year=${year}&export=a1`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <FileDown className="h-4 w-4" /> Ekspor 1721-A1 (CSV)
          </a>
        }
      />

      {/* Tahun + Coretax bulanan */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="h-9 w-[150px] text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(years.length ? years : [new Date().getFullYear()]).map((y) => (
                <SelectItem key={y} value={String(y)}>Tahun Pajak {y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-bold text-stone-400">Bukti potong Coretax bulanan</span>
            <Select value={coretaxPeriod} onValueChange={setCoretaxPeriod}>
              <SelectTrigger className="h-9 w-[190px] text-xs font-bold"><SelectValue placeholder="Pilih period" /></SelectTrigger>
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
                  ? "border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-500/40 dark:text-teal-400 dark:hover:bg-teal-500/10"
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
              title={`Belum ada run final pada tahun ${year}`}
              description="SPT tahunan terbentuk otomatis dari run yang dikonfirmasi/dibayar. Proses payroll pada tahun pajak ini terlebih dahulu."
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
                      <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                      <TableHead className="text-[11px] font-bold">PTKP</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Bruto Reguler</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Bruto Irreguler</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Biaya Jabatan</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Iuran JSTK</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Neto / PKP</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">PPh21 Setahun</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Dipotong</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Kurang/(Lebih)</TableHead>
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
                                <p>PTKP Rp {fmtIDR(r.ptkpAnnual)}/thn · {r.runs} run · {r.hasNpwp ? "NPWP" : "non-NPWP (+20%)"}</p>
                                {!r.hasNpwp && <p className="text-rose-500">Dipotong dgn penalti non-NPWP</p>}
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
                        <TableCell className="text-right text-xs text-amber-700 dark:text-amber-400">{fmtIDR(r.taxWithheld)}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold",
                            r.delta > 0
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                          )}>
                            {r.delta > 0 ? "+" : ""}{fmtIDR(r.delta)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                      <TableCell className="text-[11px] font-bold uppercase tracking-wide text-stone-500">Total ({t?.employees} pegawai)</TableCell>
                      <TableCell />
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(report.employees.reduce((s, r) => s + r.incomeRegular, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(report.employees.reduce((s, r) => s + r.incomeIrregular, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(t?.biayaJabatan ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(t?.iuranJstk ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(t?.neto ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(t?.pph21Annual ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold text-amber-700 dark:text-amber-400">{fmtIDR(t?.taxWithheld ?? 0)}</TableCell>
                      <TableCell className="text-right text-xs font-extrabold">{fmtIDR(t?.delta ?? 0)}</TableCell>
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
                Metode: bruto kena pajak (reguler + irreguler) − biaya jabatan 5% (cap Rp 6.000.000/thn) − iuran JHT/JP pegawai = neto;
                neto − PTKP tahunan = PKP → <b>progresif Pasal 17 setahun</b>. Dipotong = akumulasi PPh21 bulanan (TER/progresif annualized) dari run final.
                Selisih positif = <b>kurang bayar</b> (pelunasan via tahunan/Year End Adjustment). Karyawan non-NPWP dikenai penalti tarif ×1,2 sesuai bracket.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
