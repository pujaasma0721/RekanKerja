"use client";
// RekanKerja Leave — Laporan: siapa sedang cuti (Query Emp on Leave) + ringkasan per jenis
// (padanan History: Summary Based on Leave Type / Employee).
import { useMemo, useState } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SESSION_LABEL, SESSION_LABEL_EN, fmtDay } from "./leave-types";
import { BarChart3, CalendarSearch, CalendarDays, RefreshCw, Palmtree } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

const iso = (d: Date) => d.toISOString().slice(0, 10);

interface OnLeaveRow {
  id: string; docNo: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; leaveTypeName: string; paid: boolean;
  dateFrom: string; sessionFrom: string; dateTo: string; sessionTo: string;
  workingDays: number; status: string; reason: string | null;
}

interface TypeUsageRow {
  leaveTypeId: string; code: string; name: string; unit: string;
  employees: number; carriedOver: number; taken: number;
}

export function LeaveReportsPage() {
  const { t, locale } = useI18n();
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [year, setYear] = useState(now.getFullYear());

  const api = useApi<{ window: { from: string; to: string }; year: number; onLeave: OnLeaveRow[]; typeUsage: TypeUsageRow[]; onLeaveToday: number }>(
    `/api/rekankerja/leave/reports?from=${from}&to=${to}&year=${year}`,
    [from, to, year],
  );

  const onLeave = useMemo(() => api.data?.onLeave ?? [], [api.data]);
  const today = new Date();

  const maxTaken = Math.max(1, ...(api.data?.typeUsage ?? []).map((ty) => ty.taken));

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Laporan Cuti")}
        description={t("Siapa yang sedang cuti pada rentang tanggal + ringkasan penggunaan per jenis cuti (padanan Query Employee on Leave & History)", "Who is on leave within a date range + usage summary per leave type (Query Employee on Leave & History equivalent)")}
        actions={
          <Button variant="outline" onClick={() => api.refresh()} className="gap-2 font-bold">
            <RefreshCw className="h-4 w-4" /> {t("Segarkan")}
          </Button>
        }
      />

      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("Dari Tanggal", "From Date")}</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("Sampai Tanggal", "To Date")}</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("Tahun Ringkasan", "Summary Year")}</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-8 w-24 text-xs font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-xl ov-soft px-3 py-2">
            <CalendarDays className="h-4 w-4" />
            <p className="text-xs font-bold">{t("{n} karyawan sedang cuti hari ini", "{n} employees on leave today", { n: api.data?.onLeaveToday ?? 0 })}</p>
          </div>
        </CardContent>
      </Card>

      {api.loading && !api.data ? <LoadingRows rows={8} /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="min-w-0 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800 lg:col-span-2">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                <CalendarSearch className="h-4 w-4 ov-text-accent" />
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {t("Karyawan Cuti", "Employees on Leave")} {new Date(from).toLocaleDateString(locale, { day: "2-digit", month: "short" })} – {new Date(to).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })} — {onLeave.length} {t("orang", "people")}
                </p>
              </div>
              {onLeave.length === 0 ? (
                <div className="p-5"><EmptyState title={t("Tidak ada karyawan cuti", "No employees on leave")} description={t("Tidak ada cuti disetujui pada rentang tanggal ini.", "No approved leave in this date range.")} icon={<Palmtree className="h-6 w-6" />} /></div>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                        <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Jenis")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Rentang", "Range")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Hari", "Days")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Alasan", "Reason")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onLeave.map((r) => {
                        const isToday = new Date(r.dateFrom) <= today && new Date(r.dateTo) >= today;
                        return (
                          <TableRow key={r.id} className={cn("hover:bg-slate-50 dark:hover:bg-slate-900/60", isToday && "ov-soft")}>
                            <TableCell>
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{r.employeeNo} {isToday && t("· hari ini", "· today")}</p>
                              <p className="text-[10px] text-slate-400">{r.fullName} · {r.orgUnitName ?? "—"}</p>
                            </TableCell>
                            <TableCell>
                              <p className="text-xs text-slate-700 dark:text-slate-200">{r.leaveTypeName}</p>
                              {!r.paid && <Badge className="mt-0.5 bg-slate-100 text-[9px] font-bold text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300">{t("Tidak dibayar", "Unpaid")}</Badge>}
                            </TableCell>
                            <TableCell className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                              {new Date(r.dateFrom).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionFrom], SESSION_LABEL_EN[r.sessionFrom])} → {new Date(r.dateTo).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionTo], SESSION_LABEL_EN[r.sessionTo])}
                            </TableCell>
                            <TableCell className="text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtDay(r.workingDays)}</TableCell>
                            <TableCell className="max-w-52 text-[10px] text-slate-400">{r.reason ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                <BarChart3 className="h-4 w-4 ov-text-accent" />
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{t("Penggunaan per Jenis", "Usage by Type")} {year}</p>
              </div>
              {(api.data?.typeUsage ?? []).length === 0 ? (
                <div className="p-5"><EmptyState title={t("Belum ada data", "No data yet")} description={t("Generate saldo tahun ini terlebih dahulu.", "Generate this year's balances first.")} /></div>
              ) : (
                <div className="space-y-2.5 p-4">
                  {(api.data?.typeUsage ?? []).slice(0, 14).map((ty) => (
                    <div key={ty.leaveTypeId}>
                      <div className="flex items-baseline justify-between">
                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{ty.name}</p>
                        <p className="text-[11px] font-bold tabular-nums text-slate-500">{ty.taken} {ty.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")} · {ty.employees} {t("kry", "emp")}</p>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full ov-chart"
                          style={{ width: `${Math.max(3, (ty.taken / maxTaken) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
