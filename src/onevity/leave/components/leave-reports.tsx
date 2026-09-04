"use client";
// OneVity Leave — Laporan: siapa sedang cuti (Query Emp on Leave) + ringkasan per jenis
// (padanan History: Summary Based on Leave Type / Employee).
import { useMemo, useState } from "react";
import { useApi } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SESSION_LABEL, fmtDay } from "./leave-types";
import { BarChart3, CalendarSearch, CalendarDays, RefreshCw, Palmtree } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [year, setYear] = useState(now.getFullYear());

  const api = useApi<{ window: { from: string; to: string }; year: number; onLeave: OnLeaveRow[]; typeUsage: TypeUsageRow[]; onLeaveToday: number }>(
    `/api/onevity/leave/reports?from=${from}&to=${to}&year=${year}`,
    [from, to, year],
  );

  const onLeave = useMemo(() => api.data?.onLeave ?? [], [api.data]);
  const today = new Date();

  const maxTaken = Math.max(1, ...(api.data?.typeUsage ?? []).map((t) => t.taken));

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Laporan Cuti"
        description="Siapa yang sedang cuti pada rentang tanggal + ringkasan penggunaan per jenis cuti (padanan Query Employee on Leave & History)"
        actions={
          <Button variant="outline" onClick={() => api.refresh()} className="gap-2 font-bold">
            <RefreshCw className="h-4 w-4" /> Segarkan
          </Button>
        }
      />

      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Dari Tanggal</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Sampai Tanggal</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Tahun Ringkasan</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-8 w-24 text-xs font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2 dark:bg-orange-950/30">
            <CalendarDays className="h-4 w-4 text-orange-600" />
            <p className="text-xs font-bold text-orange-700 dark:text-orange-400">{api.data?.onLeaveToday ?? 0} karyawan sedang cuti hari ini</p>
          </div>
        </CardContent>
      </Card>

      {api.loading && !api.data ? <LoadingRows rows={8} /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="min-w-0 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800 lg:col-span-2">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
                <CalendarSearch className="h-4 w-4 text-orange-600" />
                <p className="text-xs font-bold text-stone-600 dark:text-stone-300">
                  Karyawan Cuti {new Date(from).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} – {new Date(to).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} — {onLeave.length} orang
                </p>
              </div>
              {onLeave.length === 0 ? (
                <div className="p-5"><EmptyState title="Tidak ada karyawan cuti" description="Tidak ada cuti disetujui pada rentang tanggal ini." icon={<Palmtree className="h-6 w-6" />} /></div>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                        <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                        <TableHead className="text-[11px] font-bold">Jenis</TableHead>
                        <TableHead className="text-[11px] font-bold">Rentang</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Hari</TableHead>
                        <TableHead className="text-[11px] font-bold">Alasan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onLeave.map((r) => {
                        const isToday = new Date(r.dateFrom) <= today && new Date(r.dateTo) >= today;
                        return (
                          <TableRow key={r.id} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", isToday && "bg-orange-50/60 dark:bg-orange-950/20")}>
                            <TableCell>
                              <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{r.employeeNo} {isToday && "· hari ini"}</p>
                              <p className="text-[10px] text-stone-400">{r.fullName} · {r.orgUnitName ?? "—"}</p>
                            </TableCell>
                            <TableCell>
                              <p className="text-xs text-stone-700 dark:text-stone-200">{r.leaveTypeName}</p>
                              {!r.paid && <Badge className="mt-0.5 bg-stone-100 text-[9px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">Tidak dibayar</Badge>}
                            </TableCell>
                            <TableCell className="text-[11px] font-semibold text-stone-700 dark:text-stone-200">
                              {new Date(r.dateFrom).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} {SESSION_LABEL[r.sessionFrom]} → {new Date(r.dateTo).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} {SESSION_LABEL[r.sessionTo]}
                            </TableCell>
                            <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">{fmtDay(r.workingDays)}</TableCell>
                            <TableCell className="max-w-52 text-[10px] text-stone-400">{r.reason ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
                <BarChart3 className="h-4 w-4 text-teal-600" />
                <p className="text-xs font-bold text-stone-600 dark:text-stone-300">Penggunaan per Jenis {year}</p>
              </div>
              {(api.data?.typeUsage ?? []).length === 0 ? (
                <div className="p-5"><EmptyState title="Belum ada data" description="Generate saldo tahun ini terlebih dahulu." /></div>
              ) : (
                <div className="space-y-2.5 p-4">
                  {(api.data?.typeUsage ?? []).slice(0, 14).map((t) => (
                    <div key={t.leaveTypeId}>
                      <div className="flex items-baseline justify-between">
                        <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200">{t.name}</p>
                        <p className="text-[11px] font-bold tabular-nums text-stone-500">{t.taken} {t.unit === "MONTH" ? "bln" : "hr"} · {t.employees} kry</p>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-orange-400 to-rose-400"
                          style={{ width: `${Math.max(3, (t.taken / maxTaken) * 100)}%` }}
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
