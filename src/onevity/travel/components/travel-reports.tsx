"use client";
// OneVity Travel — Laporan: klaim per rentang + komposisi biaya per jenis & kode
// (padanan TravelClaim report + Summary per jenis oranHR)
import { useMemo, useState } from "react";
import { useApi } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  TravelClaimRowUI, ClaimExpenseUI, EmployeeOption,
  TRAVEL_STATUS_LABEL, EXPENSE_KIND_LABEL, fmtIDR, fmtIDRShort, fmtDateID,
} from "./travel-types";
import { BarChart3, Search, FileText, Landmark, TrendingUp, RotateCcw } from "lucide-react";

interface ReportData {
  rows: (TravelClaimRowUI & { expenses: ClaimExpenseUI[] })[];
  summary: {
    claims: number;
    totalSettlement: number;
    totalExpenses: number;
    payableEmployee: number;
    payableCompany: number;
    byKind: { kind: string; amount: number; lines: number }[];
    byExpense: { code: string; amount: number; lines: number }[];
  };
}

const yearStartISO = () => `${new Date().getFullYear()}-01-01`;
const todayISO = () => new Date().toISOString().slice(0, 10);

export function TravelReportsPage() {
  const [from, setFrom] = useState(yearStartISO());
  const [to, setTo] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState("");
  const [query, setQuery] = useState("");

  const url = `/api/onevity/travel/reports?from=${from}&to=${to}${employeeId ? `&employeeId=${employeeId}` : ""}`;
  const api = useApi<ReportData>(url);
  const master = useApi<{ employees: EmployeeOption[] }>("/api/onevity/travel/templates");

  const rows = useMemo(() => (api.data?.rows ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase()),
  ), [api.data, query]);
  const summary = api.data?.summary;

  const maxKind = summary?.byKind[0]?.amount || 1;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL TRAVEL"
        title="Laporan Klaim Perjalanan"
        description="Rekap klaim settlement per rentang tanggal — komposisi biaya per kelompok (General/Allowance/Mileage/Entertainment) dan per kode biaya, padanan laporan Travel oranHR"
      />

      <Card className="mb-4 border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Dari Tanggal</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Sampai Tanggal</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Karyawan</Label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="h-9 w-full rounded-md border border-stone-200 bg-transparent px-3 text-sm shadow-sm focus:border-orange-400 dark:border-stone-800 dark:bg-stone-900"
            >
              <option value="">Semua karyawan</option>
              {(master.data?.employees ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" className="gap-2 font-bold" onClick={() => { setFrom(yearStartISO()); setTo(todayISO()); setEmployeeId(""); setQuery(""); }}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-orange-200 bg-orange-50/50 shadow-sm dark:border-orange-800 dark:bg-orange-950/20">
            <CardContent className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400">Total Settlement</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(summary.totalSettlement)}</p>
              <p className="text-[11px] text-stone-500">{summary.claims} klaim</p>
            </CardContent>
          </Card>
          <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
            <CardContent className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Total Rincian Biaya</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(summary.totalExpenses)}</p>
              <p className="text-[11px] text-stone-500">sebelum (a)/(b)/(c)</p>
            </CardContent>
          </Card>
          <Card className="border-teal-200 bg-teal-50/50 shadow-sm dark:border-teal-800 dark:bg-teal-950/20">
            <CardContent className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">(b) Dibayar Karyawan</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(summary.payableEmployee)}</p>
            </CardContent>
          </Card>
          <Card className="border-rose-200 bg-rose-50/50 shadow-sm dark:border-rose-800 dark:bg-rose-950/20">
            <CardContent className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">(c) Kembali Perusahaan</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(summary.payableCompany)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80 lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <BarChart3 className="h-4 w-4 text-orange-600" /> Komposisi per Kelompok
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {api.loading && !api.data ? (
              <LoadingRows rows={3} />
            ) : !summary?.byKind.length ? (
              <EmptyState icon={BarChart3} title="Belum ada data" description="Tidak ada klaim dalam rentang ini." />
            ) : (
              summary.byKind.map((k) => (
                <div key={k.kind}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-stone-700 dark:text-stone-300">
                      {EXPENSE_KIND_LABEL[k.kind] ?? k.kind}
                      <span className="ml-1 font-normal text-stone-400">({k.lines} baris)</span>
                    </span>
                    <span className="font-bold text-stone-700 dark:text-stone-300">{fmtIDRShort(k.amount)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${(k.amount / maxKind) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
            {summary?.byExpense.length ? (
              <div className="border-t border-stone-100 pt-3 dark:border-stone-800">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-stone-500">
                  <TrendingUp className="h-3 w-3" /> Teratas per Kode
                </p>
                <div className="space-y-1">
                  {summary.byExpense.slice(0, 8).map((x) => (
                    <div key={x.code} className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-stone-600 dark:text-stone-400">{x.code}</span>
                      <span className="text-stone-600 dark:text-stone-400">{fmtIDR(x.amount)} <span className="text-stone-400">({x.lines}×)</span></span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80 lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base font-bold">
              <FileText className="h-4 w-4 shrink-0 text-orange-600" /> Daftar Klaim ({rows.length})
            </CardTitle>
            <div className="relative w-full min-w-0 sm:w-44">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari…" className="w-full pl-9 text-sm" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {api.loading && !api.data ? (
              <LoadingRows rows={5} />
            ) : rows.length === 0 ? (
              <EmptyState icon={FileText} title="Tidak ada klaim" description="Tidak ada klaim dalam rentang tanggal terpilih." />
            ) : (
              <div className="max-h-[560px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white dark:bg-stone-900">
                    <TableRow>
                      <TableHead>Nomor</TableHead>
                      <TableHead>Karyawan</TableHead>
                      <TableHead className="hidden md:table-cell">Biaya</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="hidden lg:table-cell">Jurnal</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.docNo} className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                        <TableCell>
                          <p className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{r.docNo}</p>
                          <p className="text-[11px] text-stone-500">{fmtDateID(r.claimDate)}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{r.fullName}</p>
                          <p className="text-[11px] text-stone-500">
                            {r.requestDocNo ? `dari ${r.requestDocNo}` : "mandiri"}{r.costCenter ? ` · CC ${r.costCenter}` : ""}
                          </p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <p className="text-xs font-bold text-stone-700 dark:text-stone-300">{fmtIDRShort(r.totalExpenses)}</p>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {r.expenses.slice(0, 4).map((e, i) => (
                              <Badge key={i} variant="outline" className="text-[8px] font-bold">{e.expenseCode}</Badge>
                            ))}
                            {r.expenses.length > 4 && <Badge variant="secondary" className="text-[8px] font-bold">+{r.expenses.length - 4}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="text-sm font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(r.totalSettlement)}</p>
                          {r.payableEmployee > 0 && <p className="text-[10px] font-bold text-teal-700 dark:text-teal-400">(b) {fmtIDRShort(r.payableEmployee)}</p>}
                          {r.payableCompany > 0 && <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400">(c) {fmtIDRShort(r.payableCompany)}</p>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {r.journalNo ? (
                            <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-teal-700 dark:text-teal-400">
                              <Landmark className="h-3 w-3" /> {r.journalNo}
                            </span>
                          ) : (
                            <span className="text-[11px] text-stone-400">—</span>
                          )}
                        </TableCell>
                        <TableCell><StatusPill status={TRAVEL_STATUS_LABEL[r.status] ?? r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
