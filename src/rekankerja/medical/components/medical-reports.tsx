"use client";
// RekanKerja Medical — Laporan: rekap klaim per jenis (SummaryType) + rentang klaim
// per karyawan (SummaryEmployee) + komposisi (padanan 3 laporan History).
// MED-1-b — tab kedua "Dokumen Laporan": katalog 12 laporan distribusi siap-cetak
// (saldo plafon, klaim, analisis biaya, rekonsiliasi asuransi) dgn form parameter
// awal (mirror Leave T112 / HR T110). PageHeader tetap di ATAS Tabs.
import { useMemo, useState } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MedicalReportDocumentsTab } from "./report-documents/report-documents-tab";
import {
  EmployeeOption, fmtIDR, fmtIDRShort, fmtDateID,
} from "./medical-types";
import { BarChart3, Search, FileText, Download, Users, FileBarChart, FolderOpen } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

interface ReportRow {
  docNo: string; employeeNo: string; fullName: string;
  typeCode: string; typeName: string; claimDate: string; state: string;
  forDependent: boolean; totalBill: number; totalApproved: number;
  journalNo: string | null; settleDate: string | null;
}

export function MedicalReportsPage() {
  const { t, lang } = useI18n();
  const currentYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);
  const [employeeId, setEmployeeId] = useState("all");

  const api = useApi<{ rows: ReportRow[]; byType: { typeCode: string; typeName: string; claimCount: number; approvedAmount: number }[]; byEmployee?: { employeeNo: string; fullName: string; claimCount: number; approvedAmount: number }[]; employees: EmployeeOption[] }>(
    `/api/rekankerja/medical/reports?from=${from}&to=${to}&year=${currentYear}` + (employeeId !== "all" ? `&employeeId=${employeeId}` : ""),
  );

  const rows = api.data?.rows ?? [];
  const byType = api.data?.byType ?? [];
  // W2-6 (fix G-9) — rekap per karyawan (padoran SummaryEmployee).
  const byEmployee = api.data?.byEmployee ?? [];

  const totals = useMemo(() => ({
    count: rows.length,
    bill: rows.reduce((s, r) => s + r.totalBill, 0),
    approved: rows.reduce((s, r) => s + r.totalApproved, 0),
    settled: rows.filter((r) => r.state === "Settled").reduce((s, r) => s + r.totalApproved, 0),
  }), [rows]);

  const maxType = byType[0]?.approvedAmount || 1;

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Laporan", "Medical · Reports")}
        title={t("Laporan Medis")}
        description={t("Rekap klaim per jenis benefit, rentang klaim per karyawan, dan komposisi beban — plus 12 laporan distribusi siap-cetak (saldo plafon, klaim, analisis biaya, rekonsiliasi asuransi)", "Claim recap per benefit type, claim range per employee, and expense composition — plus 12 print-ready distribution reports (balances, claims, cost analysis, insurance reconciliation)")}
      />

      <Tabs defaultValue="recap" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recap" className="gap-1.5 text-xs font-bold"><FileBarChart className="h-3.5 w-3.5" /> {t("Rekap Klaim", "Claim Recap")}</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5 text-xs font-bold"><FolderOpen className="h-3.5 w-3.5" /> {t("Dokumen Laporan", "Report Documents")}</TabsTrigger>
        </TabsList>
        <TabsContent value="recap" className="space-y-4">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">{t("Dari", "From")}</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">{t("Sampai", "To")}</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500">{t("Karyawan")}</label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua karyawan", "All employees")}</SelectItem>
              {(api.data?.employees ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Task 82-c: unduh CSV — filter saat ini (rentang + karyawan); kolom uang
            mengikuti money-vault (masked → dikosongkan oleh server).
            BL-5: ?lang= diteruskan — ekspor bilingual. */}
        <a
          href={`/api/rekankerja/medical/reports?from=${from}&to=${to}&year=${currentYear}${employeeId !== "all" ? `&employeeId=${employeeId}` : ""}&export=csv&lang=${lang}`}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          aria-label={t("Unduh daftar klaim medis sebagai CSV", "Download the medical claim list as CSV")}
        >
          <Download className="h-4 w-4" /> {t("Export CSV")}
        </a>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Jumlah Klaim", "Claim Count")}</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{totals.count}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Total Tagihan", "Total Bills")}</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{fmtIDRShort(totals.bill)}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Disetujui", "Approved")}</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{fmtIDRShort(totals.approved)}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Settled (Dibayar)", "Settled (Paid)")}</p>
            <p className="mt-1 text-2xl font-black ov-text-accent">{fmtIDRShort(totals.settled)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <BarChart3 className="h-4 w-4 ov-text-accent" /> {t("Rekap per Jenis (Settled)", "Recap by Type (Settled)")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byType.length === 0 ? (
              <p className="text-sm text-slate-500">{t("Belum ada klaim settled tahun ini.", "No settled claims this year.")}</p>
            ) : byType.map((k) => (
              <div key={k.typeCode}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{k.typeName}</span>
                  <span className="text-slate-500">{fmtIDRShort(k.approvedAmount)} · {k.claimCount}×</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full ov-chart" style={{ width: `${(k.approvedAmount / maxType) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <FileText className="h-4 w-4 ov-text-accent" /> {t("Klaim dalam Rentang", "Claims in Range")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {api.loading && !api.data ? (
              <div className="p-4"><LoadingRows /></div>
            ) : rows.length === 0 ? (
              <div className="p-6"><EmptyState title={t("Tidak ada klaim dalam rentang", "No claims in the selected range")} icon={Search} /></div>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                    <TableRow>
                      <TableHead>No.</TableHead>
                      <TableHead>{t("Karyawan")}</TableHead>
                      <TableHead>{t("Jenis")}</TableHead>
                      <TableHead>{t("Tanggal")}</TableHead>
                      <TableHead className="text-right">{t("Tagihan", "Bill")}</TableHead>
                      <TableHead className="text-right">{t("Disetujui", "Approved")}</TableHead>
                      <TableHead>{t("Status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.docNo}>
                        <TableCell className="font-semibold">{r.docNo}</TableCell>
                        <TableCell>
                          <p className="font-medium">{r.fullName}</p>
                          <p className="text-xs text-slate-500">{r.employeeNo}</p>
                        </TableCell>
                        <TableCell>
                          {r.typeName}
                          {r.forDependent && <span className="ml-1 text-xs text-brand dark:text-brand/85">(dep.)</span>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDateID(r.claimDate)}</TableCell>
                        <TableCell className="text-right">{fmtIDR(r.totalBill)}</TableCell>
                        <TableCell className={cn("text-right font-semibold", r.state === "Settled" && "text-brand dark:text-brand/85")}>
                          {fmtIDR(r.totalApproved)}
                        </TableCell>
                        <TableCell><StatusPill status={r.state} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* W2-6 (fix G-9 BPA-medical): laporan rekap per karyawan — padoran
          MedicalBenefitSummaryEmployee yang dulu tidak diimplementasi. */}
      <Card className="mt-4 min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <Users className="h-4 w-4 ov-text-accent" /> {t("Rekap per Karyawan (Settled)", "Recap by Employee (Settled)")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {byEmployee.length === 0 ? (
            <div className="p-6"><EmptyState title={t("Belum ada klaim settled tahun ini.", "No settled claims this year.")} icon={Users} /></div>
          ) : (
            <div className="max-h-[22rem] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Karyawan")}</TableHead>
                    <TableHead className="text-right">{t("Jumlah Klaim", "Claim Count")}</TableHead>
                    <TableHead className="text-right">{t("Total Approved", "Total Approved")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byEmployee.map((e) => (
                    <TableRow key={e.employeeNo}>
                      <TableCell>
                        <p className="font-medium">{e.fullName}</p>
                        <p className="text-xs text-slate-500">{e.employeeNo}</p>
                      </TableCell>
                      <TableCell className="text-right">{e.claimCount}×</TableCell>
                      <TableCell className="text-right font-semibold text-brand dark:text-brand/85">{fmtIDR(e.approvedAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="documents">
          <MedicalReportDocumentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
