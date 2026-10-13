"use client";
// P9-PERF — Kepatuhan Data Kinerja (§20 P9; §7.3 UU PDP No. 27/2022; §37):
// Permintaan Subjek Data (DSR) KARYAWAN atas data kinerjanya — hak
// akses/ekspor/hapus, SLA 7 hari, transisi New → InProgress → Completed|
// Rejected (alasan wajib) + paket Export XLSX (identitas dasar + riwayat
// kinerja PP 35/2021 §7.2) + ringkasan retensi arsip (tandai terarsip oleh
// job harian; penghapusan permanen HANYA keputusan eksplisit HR).
// Pola: recruitment/components/compliance.tsx (DSR) + tabel PIP/probation.
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { trServer } from "@/rekankerja/shared/lib/i18n-core";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { ShieldCheck, Plus, Search, Download, Hourglass, Timer, CheckCircle2, Archive, FileText } from "lucide-react";

const DSR_API = "/api/rekankerja/performance/dsr";

// ============ tipe (mirror JSON API P9) ============

interface DsrRow {
  id: string;
  employeeNo: string;
  employeeName: string;
  unit: string | null;
  type: string; // Access | Export | Erase
  status: string; // New | InProgress | Completed | Rejected
  note: string | null;
  dueAt: string;
  createdAt: string;
  handledAt: string | null;
  resultNote: string | null;
  handlerName: string | null;
  overdue: boolean;
}

interface ArchivedRow {
  docNo: string;
  employeeNo: string;
  employeeName: string;
  cycleCode: string;
  periodEnd: string;
  archivedAt: string;
}

interface DsrStats {
  activeCount: number;
  overdueCount: number;
  completed30d: number;
  retentionYears: number;
  archivedCount: number;
  archivedSample: ArchivedRow[];
}

interface EmpOpt {
  id: string;
  employeeNo: string;
  fullName: string;
  position: string | null;
  orgUnit: string | null;
}

// ============ label dwibahasa (pola recruitment compliance — TANPA indigo/blue) ============

const DSR_TYPES: { key: string; label: string; labelEn: string; tone: string }[] = [
  { key: "Access", label: "Akses Data", labelEn: "Access", tone: "slate" },
  { key: "Export", label: "Ekspor Data", labelEn: "Export", tone: "amber" },
  { key: "Erase", label: "Hapus Data", labelEn: "Erase", tone: "rose" },
];

const DSR_STATUSES: { key: string; label: string; labelEn: string; tone: string }[] = [
  { key: "New", label: "Baru", labelEn: "New", tone: "rose" },
  { key: "InProgress", label: "Diproses", labelEn: "In Progress", tone: "amber" },
  { key: "Completed", label: "Selesai", labelEn: "Completed", tone: "emerald" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected", tone: "zinc" },
];

const TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
};
const TONE_DOT: Record<string, string> = {
  emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500",
  slate: "bg-slate-400", zinc: "bg-zinc-400",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      TONE_CLS[tone] ?? TONE_CLS.slate,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} aria-hidden />
      {children}
    </span>
  );
}

function dsrTypeMeta(key: string, t: (a: string, b?: string) => string) {
  const m = DSR_TYPES.find((x) => x.key === key);
  return { tone: m?.tone ?? "slate", label: t(m?.label ?? key, m?.labelEn ?? key) };
}

function dsrStatusMeta(key: string, t: (a: string, b?: string) => string) {
  const m = DSR_STATUSES.find((x) => x.key === key);
  return { tone: m?.tone ?? "zinc", label: t(m?.label ?? key, m?.labelEn ?? key) };
}

/** DSR yang masih harus ditangani (belum terminal). */
const dsrOpen = (s: string) => s === "New" || s === "InProgress";

// ============ halaman ============

export function PerformanceCompliancePage() {
  const { t, lang } = useI18n();
  const perms = useMenuPerms();
  const canHandle = perms.canOp("performance", "compliance", "dsr");

  const [statusFilter, setStatusFilter] = useState("all");
  const api = useApi<{ list: DsrRow[]; stats: DsrStats }>(DSR_API, []);

  // ---- dialog Buat DSR ----
  const [newOpen, setNewOpen] = useState(false);
  const [empQ, setEmpQ] = useState("");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newType, setNewType] = useState("Access");
  const [newNote, setNewNote] = useState("");
  const [busyNew, setBusyNew] = useState(false);
  const empApi = useApi<{ employees: EmpOpt[] }>(
    newOpen ? `${DSR_API}?employees=1${empQ ? `&q=${encodeURIComponent(empQ)}` : ""}` : null,
    [newOpen, empQ],
  );

  // ---- dialog Proses (transisi status) ----
  const [procTarget, setProcTarget] = useState<DsrRow | null>(null);
  const [procStatus, setProcStatus] = useState("InProgress");
  const [procNote, setProcNote] = useState("");
  const [busyProc, setBusyProc] = useState(false);

  const [busyPkg, setBusyPkg] = useState<string | null>(null);

  const stats = api.data?.stats ?? null;
  const rows = api.data?.list ?? [];
  const visible = statusFilter === "all" ? rows
    : statusFilter === "open" ? rows.filter((r) => dsrOpen(r.status))
    : rows.filter((r) => r.status === statusFilter);

  const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID") : "—");

  const openNew = () => {
    setEmpQ("");
    setNewEmployeeId("");
    setNewType("Access");
    setNewNote("");
    setNewOpen(true);
  };

  const doCreate = async () => {
    if (!newEmployeeId) {
      toast.error(t("Pilih karyawan dulu.", "Pick an employee first."));
      return;
    }
    setBusyNew(true);
    try {
      await apiSend(DSR_API, "POST", {
        action: "create", employeeId: newEmployeeId, type: newType, note: newNote.trim() || null,
      });
      const opt = (empApi.data?.employees ?? []).find((e) => e.id === newEmployeeId);
      toast.success(t(
        `Permintaan ${dsrTypeMeta(newType, t).label} utk ${opt?.fullName ?? t("karyawan", "employee")} dicatat (SLA 7 hari).`,
        `${dsrTypeMeta(newType, t).label} request for ${opt?.fullName ?? t("employee", "employee")} recorded (7-day SLA).`,
      ));
      setNewOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mencatat DSR", "Failed to create the DSR"));
    } finally {
      setBusyNew(false);
    }
  };

  const openProcess = (row: DsrRow) => {
    setProcTarget(row);
    setProcStatus("InProgress");
    setProcNote("");
  };

  const doProcess = async () => {
    if (!procTarget) return;
    const note = procNote.trim();
    if ((procStatus === "Completed" || procStatus === "Rejected") && !note) {
      toast.error(t("Ringkasan hasil / alasan wajib diisi untuk status ini.", "A result summary / reason is required for this status."));
      return;
    }
    if (procStatus === "Rejected" && note.length < 10) {
      toast.error(t("Alasan penolakan minimal 10 karakter.", "Rejection reason must be at least 10 characters."));
      return;
    }
    setBusyProc(true);
    try {
      await apiSend(DSR_API, "POST", {
        action: "update", id: procTarget.id, status: procStatus, resultNote: note || null,
      });
      toast.success(t(
        `DSR ${procTarget.employeeName} → ${dsrStatusMeta(procStatus, t).label}.`,
        `${procTarget.employeeName}'s DSR → ${dsrStatusMeta(procStatus, t).label}.`,
      ));
      setProcTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memperbarui DSR", "Failed to update the DSR"));
    } finally {
      setBusyProc(false);
    }
  };

  const doPackage = async (row: DsrRow) => {
    setBusyPkg(row.id);
    try {
      const res = await fetch(DSR_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "package", id: row.id, lang }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(trServer(j?.error ?? `HTTP ${res.status}`));
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const fm = /filename="([^"]+)"/.exec(cd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fm?.[1] ?? `rekankerja-dsr-package-${row.employeeNo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t(
        `Paket DSR ${row.employeeNo} (identitas dasar + riwayat kinerja) diunduh — unduhan ter-audit.`,
        `DSR package for ${row.employeeNo} (basic identity + performance history) downloaded — the download is audited.`,
      ));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengunduh paket", "Failed to download the package"));
    } finally {
      setBusyPkg(null);
    }
  };

  if (!api.data && api.loading) return <LoadingRows />;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Performance · Penilaian Kinerja")}
        title={t("Kepatuhan Data Kinerja (UU PDP)", "Performance Data Compliance (UU PDP)")}
        description={t(
          "Permintaan subjek data (DSR) karyawan atas data kinerjanya — hak akses, ekspor, dan hapus sesuai UU PDP No. 27/2022 (§7.3); paket ekspor memuat identitas dasar + riwayat penilaian lintas siklus yang eksporabel & ter-audit (PP 35/2021 §7.2). SLA penanganan 7 hari.",
          "Employee data subject requests (DSR) over their performance data — access, export, and erasure rights under UU PDP No. 27/2022 (§7.3); the export package contains basic identity plus the cross-cycle appraisal history that is exportable & auditable (PP 35/2021 §7.2). Handling SLA is 7 days.",
        )}
        actions={(
          canHandle ? (
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden /> {t("Buat DSR", "Create DSR")}
            </Button>
          ) : undefined
        )}
      />

      {/* ---- kartu ringkasan (4) ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
              <Hourglass className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{stats?.activeCount ?? "—"}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{t("DSR aktif (SLA 7 hari)", "Active DSRs (7-day SLA)")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
              <Timer className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{stats?.overdueCount ?? "—"}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{t("Terlambat (lewat SLA)", "Overdue (past SLA)")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{stats?.completed30d ?? "—"}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{t("Selesai 30 hari terakhir", "Completed in last 30 days")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300">
              <Archive className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">
                {stats ? t("{n} tahun", "{n} years", { n: String(stats.retentionYears) }) : "—"}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {stats ? t("retensi aktif · {n} data terarsip", "active retention · {n} archived records", { n: String(stats.archivedCount) }) : t("retensi aktif", "active retention")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- tabel DSR ---- */}
      <Card className="min-w-0">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Permintaan Subjek Data — Karyawan", "Data Subject Requests — Employees")}
            </h2>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44" aria-label={t("Filter status", "Status filter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
                <SelectItem value="open">{t("Sedang berjalan", "Open / running")}</SelectItem>
                <SelectItem value="New">{t("Baru", "New")}</SelectItem>
                <SelectItem value="InProgress">{t("Diproses", "In Progress")}</SelectItem>
                <SelectItem value="Completed">{t("Selesai", "Completed")}</SelectItem>
                <SelectItem value="Rejected">{t("Ditolak", "Rejected")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {visible.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={t("Belum ada DSR karyawan", "No employee DSRs yet")}
              description={t(
                "Karyawan dapat mengajukan hak akses/ekspor/hapus data kinerjanya melalui HR. Klik \u201cBuat DSR\u201d untuk mencatat permintaan pertama.",
                "Employees can exercise their access/export/erasure rights over performance data through HR. Click \u201cCreate DSR\u201d to record the first request.",
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("Karyawan", "Employee")}</TableHead>
                  <TableHead>{t("Tipe", "Type")}</TableHead>
                  <TableHead>{t("Status", "Status")}</TableHead>
                  <TableHead>{t("SLA", "SLA")}</TableHead>
                  <TableHead>{t("Penangan", "Handler")}</TableHead>
                  <TableHead className="min-w-44">{t("Hasil", "Result")}</TableHead>
                  <TableHead className="w-44"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visible.map((r) => {
                    const tm = dsrTypeMeta(r.type, t);
                    const sm = dsrStatusMeta(r.status, t);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">
                          <p className="font-medium">{r.employeeName}</p>
                          <p className="text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"}</p>
                          {r.note && <p className="max-w-56 truncate text-[10px] text-slate-400" title={r.note}>“{r.note}”</p>}
                        </TableCell>
                        <TableCell><Pill tone={tm.tone}>{tm.label}</Pill></TableCell>
                        <TableCell><Pill tone={sm.tone}>{sm.label}</Pill></TableCell>
                        <TableCell className="text-xs">
                          <p>{fmtD(r.dueAt)}</p>
                          {r.overdue && (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              {t("terlambat", "overdue")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <p>{r.handlerName ?? "—"}</p>
                          {r.handledAt && <p className="text-slate-400">{fmtD(r.handledAt)}</p>}
                        </TableCell>
                        <TableCell className="max-w-56">
                          <p className="truncate text-xs text-slate-600 dark:text-slate-300" title={r.resultNote ?? undefined}>
                            {r.resultNote ?? "—"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {canHandle && dsrOpen(r.status) && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openProcess(r)}>
                                {t("Proses", "Process")}
                              </Button>
                            )}
                            {canHandle && r.type === "Export" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={busyPkg === r.id}
                                onClick={() => doPackage(r)}
                              >
                                <Download className="h-3 w-3" aria-hidden /> {t("Unduh Paket", "Download Package")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- bagian retensi ---- */}
      <Card className="min-w-0">
        <CardContent className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Archive className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Retensi Arsip Hasil Penilaian", "Appraisal Records Retention")}
          </h2>
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {t(
                "Retensi arsip hasil penilaian: {n} tahun (default 5). Data melewati retensi ditandai terarsip oleh job harian; penghapusan permanen HANYA melalui keputusan eksplisit HR (tidak otomatis).",
                "Appraisal records retention: {n} years (default 5). Records past the retention window are flagged as archived by the daily job; permanent deletion happens ONLY through an explicit HR decision (never automatic).",
                { n: String(stats?.retentionYears ?? 5) },
              )}
            </span>
          </p>
          {(stats?.archivedSample ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-[11px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              {t("Belum ada data kinerja yang melewati jendela retensi.", "No appraisal records have passed the retention window yet.")}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow className="sticky top-0 bg-white dark:bg-slate-900">
                    <TableHead>{t("No. Dokumen", "Document No.")}</TableHead>
                    <TableHead>{t("Karyawan", "Employee")}</TableHead>
                    <TableHead>{t("Siklus", "Cycle")}</TableHead>
                    <TableHead>{t("Akhir Periode", "Period End")}</TableHead>
                    <TableHead>{t("Tanggal Arsip", "Archived At")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(stats?.archivedSample ?? []).map((a) => (
                      <TableRow key={a.docNo}>
                        <TableCell className="font-mono text-xs">{a.docNo}</TableCell>
                        <TableCell className="text-xs">
                          <p className="font-medium">{a.employeeName}</p>
                          <p className="text-slate-500">{a.employeeNo}</p>
                        </TableCell>
                        <TableCell className="text-xs">{a.cycleCode}</TableCell>
                        <TableCell className="text-xs">{fmtD(a.periodEnd)}</TableCell>
                        <TableCell className="text-xs">{fmtD(a.archivedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- dialog: Buat DSR ---- */}
      <Dialog open={newOpen} onOpenChange={(o) => { if (!o) setNewOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Buat Permintaan Subjek Data (DSR)", "Create Data Subject Request (DSR)")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("Karyawan *", "Employee *")}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={empQ}
                  onChange={(e) => setEmpQ(e.target.value)}
                  placeholder={t("Cari no./nama karyawan…", "Search employee no./name…")}
                  className="h-9 pl-8 text-[12.5px]"
                />
              </div>
              <Select
                value={newEmployeeId}
                onValueChange={setNewEmployeeId}
                disabled={empApi.loading && !empApi.data}
              >
                <SelectTrigger className="h-9 w-full bg-white text-[12.5px] font-semibold dark:bg-slate-900">
                  <SelectValue placeholder={empApi.loading && !empApi.data ? t("Memuat opsi…", "Loading options…") : t("Pilih karyawan…", "Pick an employee…")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(empApi.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id} className="text-[12px] font-semibold">
                      {e.employeeNo} — {e.fullName}{e.orgUnit ? ` · ${e.orgUnit}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {empApi.error && <p className="text-[11px] font-semibold text-rose-600">{t("Opsi karyawan gagal dimuat", "Failed to load employee options")}: {empApi.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t("Jenis permintaan *", "Request type *")}</Label>
              <RadioGroup value={newType} onValueChange={setNewType} className="grid grid-cols-3 gap-2">
                {DSR_TYPES.map((x) => (
                  <label key={x.key} className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-colors",
                    newType === x.key ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400" : "border-slate-200 dark:border-slate-700")}>
                    <RadioGroupItem value={x.key} /> {t(x.label, x.labelEn)}
                  </label>
                ))}
              </RadioGroup>
              <p className="text-[10px] leading-snug text-slate-400">
                {t(
                  "Akses = berikan akses data · Ekspor = paket XLSX identitas dasar + riwayat kinerja (PP 35/2021 §7.2) · Hapus = keputusan ditangani HR manual (data kinerja = bukti keputusan kepegawaian — §37).",
                  "Access = grant data access · Export = XLSX package of basic identity + performance history (PP 35/2021 §7.2) · Erase = decision handled manually by HR (performance data is evidence for employment decisions — §37).",
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Catatan permintaan (opsional)", "Request note (optional)")}</Label>
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                placeholder={t("Permintaan dari karyawan via HR — konteks, kanal, atau klarifikasi…", "Employee's request via HR — context, channel, or clarification…")}
                className="text-[12.5px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={busyNew}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doCreate} disabled={busyNew || !newEmployeeId}>{t("Catat DSR (SLA 7 hari)", "Record DSR (7-day SLA)")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: Proses DSR ---- */}
      <Dialog open={!!procTarget} onOpenChange={(o) => { if (!o) setProcTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {procTarget ? t("Proses DSR — {emp}", "Process DSR — {emp}", { emp: `${procTarget.employeeNo} · ${procTarget.employeeName}` }) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("Status berikutnya *", "Next status *")}</Label>
              <RadioGroup value={procStatus} onValueChange={setProcStatus} className="grid gap-2">
                {DSR_STATUSES.filter((x) => x.key !== "New").map((x) => (
                  <label key={x.key} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors",
                    procStatus === x.key ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400" : "border-slate-200 dark:border-slate-700")}>
                    <RadioGroupItem value={x.key} /> {t(x.label, x.labelEn)}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-1.5">
              <Label>
                {procStatus === "Completed"
                  ? t("Ringkasan hasil * (mis. paket diunduh / akses diberikan)", "Result summary * (e.g. package downloaded / access granted)")
                  : procStatus === "Rejected"
                    ? t("Alasan penolakan * (min. 10 karakter)", "Rejection reason * (min. 10 characters)")
                    : t("Catatan (opsional)", "Note (optional)")}
              </Label>
              <Textarea
                value={procNote}
                onChange={(e) => setProcNote(e.target.value)}
                rows={3}
                disabled={procStatus === "InProgress"}
                placeholder={procStatus === "Rejected"
                  ? t("Dasar penolakan (mis. permintaan tidak relevan / data pihak ketiga)…", "Grounds for rejection (e.g. irrelevant request / third-party data)…")
                  : t("Tindakan yang dilakukan…", "Action taken…")}
                className="text-[12.5px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcTarget(null)} disabled={busyProc}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doProcess} disabled={busyProc}>{t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
