"use client";
// OneVity Attendance — Import Mesin Absen (27-a P0) =======================
// Import log presensi mentah mesin sidik jari/face (CSV/Excel): unggah →
// dry-run preview klasifikasi per baris (OK / Duplikat / Tidak dikenal /
// Tidak valid) → konfirmasi AlertDialog (guard op:import attendance:machine-
// import) → komit → toast + riwayat batch. Dedupe idempoten: file yang sama
// diimport ulang → 0 baru, semua duplikat. Contoh CSV digenerate klien.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  FileUp, FileSpreadsheet, Loader2, Upload, Download, RotateCcw, TriangleAlert,
  CheckCircle2, Copy, UserX, FileX2, History, Fingerprint, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtDateTime } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ============ kontrak respons server ============

type RowStatus = "ok" | "duplicate" | "unknown" | "invalid";

interface PreviewRow {
  row: number;
  employeeNo: string;
  fullName: string | null;
  timestamp: string | null;
  direction: "IN" | "OUT" | null;
  status: RowStatus;
  message: string | null;
}

interface DryRunReport {
  dryRun: true;
  file: string;
  summary: { total: number; ok: number; duplicate: number; unknown: number; invalid: number };
  unknownIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  preview: PreviewRow[];
}

interface CommitReport {
  dryRun: false;
  file: string;
  summary: { total: number; ok: number; duplicate: number; unknown: number; invalid: number };
  unknownIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  batchId: string;
}

interface BatchRow {
  id: string;
  fileName: string;
  rowCount: number;
  inserted: number;
  skipped: number;
  unknownEmployees: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  importedAt: string;
}
interface BatchesRes { batches: BatchRow[] }

const IMPORT_URL = "/api/onevity/attendance/machine-import";
const MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS = 50;

/** Karyawan contoh MII (seed sandbox) — dipakai template CSV. */
const SAMPLE_EMPLOYEES = ["MII00001", "MII00002", "MII00003", "MII00004", "MII00005"];

type Phase = "idle" | "checking" | "preview" | "committing" | "done";

const STATUS_META: Record<RowStatus, { id: string; en: string; icon: React.ElementType; cls: string; rowCls: string }> = {
  ok: { id: "OK — baru", en: "OK — new", icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", rowCls: "bg-emerald-50/40 dark:bg-emerald-500/5" },
  duplicate: { id: "Duplikat", en: "Duplicate", icon: Copy, cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", rowCls: "bg-amber-50/40 dark:bg-amber-500/5" },
  unknown: { id: "Tidak dikenal", en: "Unknown", icon: UserX, cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400", rowCls: "bg-orange-50/40 dark:bg-orange-500/5" },
  invalid: { id: "Tidak valid", en: "Invalid", icon: FileX2, cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", rowCls: "bg-rose-50/40 dark:bg-rose-500/5" },
};

export function AttendanceMachineImportPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const inputRef = useRef<HTMLInputElement>(null);
  const batchesApi = useApi<BatchesRes>(IMPORT_URL);

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [result, setResult] = useState<CommitReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canImport = perms.canOp("attendance", "machine-import", "import");
  const busy = phase === "checking" || phase === "committing";

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setReport(null);
    setResult(null);
    setError(null);
    setConfirmOpen(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pickFile = (f: File | null) => {
    reset();
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt") && !lower.endsWith(".xlsx")) {
      setError(t("Hanya file .csv atau .xlsx yang didukung.", "Only .csv or .xlsx files are supported."));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("File terlalu besar (maks 5 MB) — pecah file atau hapus baris tidak perlu.", "File too large (max 5 MB) — split the file or remove unnecessary rows."));
      return;
    }
    setFile(f);
  };

  /** Unduh contoh CSV (dibuat klien — tanggal hari ini, karyawan contoh MII). */
  const downloadSample = () => {
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const dmy = `${p(today.getDate())}/${p(today.getMonth() + 1)}/${today.getFullYear()}`;
    const ymd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    const lines = [
      "employeeNo,date,time,direction",
      `${SAMPLE_EMPLOYEES[0]},${dmy},07:32,IN`,
      `${SAMPLE_EMPLOYEES[1]},${dmy},07:45,masuk`,
      `${SAMPLE_EMPLOYEES[2]},${ymd} 08:05:00,checkout`,
      `${SAMPLE_EMPLOYEES[3]},${dmy},17:10,OUT`,
      `${SAMPLE_EMPLOYEES[4]},${dmy},17:25,keluar`,
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contoh-log-mesin-absen.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.info(t("Contoh CSV diunduh — 5 baris contoh (2 format tanggal + 4 label arah).", "Sample CSV downloaded — 5 example rows (2 date formats + 4 direction labels)."));
  };

  /** Kirim file ke server (dryRun true/false) — multipart. */
  const send = async (dryRun: boolean): Promise<DryRunReport | CommitReport> => {
    if (!file) throw new Error(t("Pilih file CSV/XLSX dulu", "Pick a CSV/XLSX file first"));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dryRun", String(dryRun));
    const res = await fetch(IMPORT_URL, { method: "POST", body: fd });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json as DryRunReport | CommitReport;
  };

  const runDryRun = async () => {
    if (!file) { toast.error(t("Pilih file CSV/XLSX dulu", "Pick a CSV/XLSX file first")); return; }
    setPhase("checking");
    setError(null);
    try {
      const r = (await send(true)) as DryRunReport;
      setReport(r);
      setPhase("preview");
      if (r.summary.ok === 0) {
        toast.warning(t("Tidak ada baris baru yang bisa diimport dari file ini.", "No importable new rows in this file."));
      } else if (r.summary.duplicate + r.summary.unknown + r.summary.invalid > 0) {
        toast.warning(t("{n} baris dilewati — periksa badge pada pratinjau.", "{n} rows will be skipped — check the badges in the preview.", { n: r.summary.duplicate + r.summary.unknown + r.summary.invalid }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
      setPhase("idle");
    }
  };

  const runCommit = async () => {
    setPhase("committing");
    setError(null);
    try {
      const r = (await send(false)) as CommitReport;
      setResult(r);
      setPhase("done");
      setConfirmOpen(false); // tutup dialog konfirmasi saat sukses (hanya error yang membiarkannya terbuka utk retry)
      if (r.summary.ok > 0) {
        toast.success(t("{n} log mesin diimport — rekap harian dihitung ulang.", "{n} machine logs imported — daily recaps recalculated.", { n: r.summary.ok }));
      } else {
        toast.warning(t("0 log baru disisipkan — semua baris duplikat/dilewati.", "0 new logs inserted — all rows duplicates/skipped."));
      }
      batchesApi.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
      setPhase("preview");
      setConfirmOpen(false);
    }
  };

  const fmtTs = (v: string | null) => {
    if (!v) return "—";
    return fmtDateTime(v);
  };

  const batches = batchesApi.data?.batches ?? [];
  const summary = report?.summary ?? result?.summary ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Import Mesin Absen", "Attendance Machine Import")}
        description={t(
          "Import log presensi mentah mesin sidik jari/face (CSV/Excel) dengan dedupe idempoten — baris yang sudah ada otomatis dilewati.",
          "Import raw fingerprint/face machine attendance logs (CSV/Excel) with idempotent dedupe — existing rows are skipped automatically.",
        )}
        actions={
          <Button variant="outline" size="sm" onClick={downloadSample} className="gap-1.5 font-bold">
            <Download className="h-4 w-4" /> {t("Unduh Contoh CSV", "Download Sample CSV")}
          </Button>
        }
      />

      {/* ===== upload card ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[13px] font-bold">
                <Fingerprint className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Unggah Log Mesin", "Upload Machine Log")}
              </p>
              <p className="text-[11px] text-stone-400">
                {t("Format fleksibel: kolom employeeNo/NIK + tanggal + jam (atau datetime gabungan) + arah (IN/OUT, masuk/keluar, check-in/check-out).", "Flexible format: employeeNo/NIK + date + time columns (or a combined datetime) + direction (IN/OUT, masuk/keluar, check-in/check-out).")}
              </p>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label={t("Area unggah file CSV atau XLSX", "CSV or XLSX file drop zone")}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragOver
                ? "border-amber-400 bg-amber-50/70 dark:border-amber-500/50 dark:bg-amber-500/10"
                : "border-stone-300 bg-stone-50/50 hover:border-amber-300 hover:bg-amber-50/40 dark:border-stone-700 dark:bg-stone-900/40 dark:hover:border-amber-500/40",
            )}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm dark:bg-stone-900">
              <FileUp className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
            </span>
            <p className="text-[13px] font-bold text-stone-700 dark:text-stone-200">
              {file ? file.name : t("Tarik file ke sini atau klik untuk memilih", "Drag a file here or click to browse")}
            </p>
            <p className="text-[11px] text-stone-400">
              {file
                ? `${file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(0)} KB`} · ${t("klik area untuk mengganti file", "click the area to replace the file")}`
                : t(".csv / .xlsx · maks 5 MB · maks 20.000 baris", ".csv / .xlsx · max 5 MB · max 20,000 rows")}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt,.xlsx"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              aria-label={t("Pilih file log mesin", "Pick machine log file")}
            />
          </div>

          {error && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </div>
          )}

          {phase !== "done" && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={runDryRun} disabled={!file || busy} size="sm" className="gap-1.5 font-bold">
                {phase === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {phase === "checking" ? t("Memeriksa…", "Checking…") : t("Periksa Data (Dry-Run)", "Validate Data (Dry-Run)")}
              </Button>
              {file && (
                <Button variant="ghost" size="sm" onClick={reset} disabled={busy} className="gap-1.5 text-[12px] text-stone-500">
                  <RotateCcw className="h-3.5 w-3.5" /> {t("Ganti File", "Replace File")}
                </Button>
              )}
              {report && (
                <span className="text-[12px] text-stone-500">
                  {t("{n} baris terbaca", "{n} rows parsed", { n: report.summary.total })}
                  {report.dateFrom ? ` · ${fmtTs(report.dateFrom)} → ${fmtTs(report.dateTo)}` : ""}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== pratinjau dry-run ===== */}
      {report && phase !== "done" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3 dark:border-stone-800">
                <p className="flex items-center gap-2 text-[13px] font-bold">
                  <FileSpreadsheet className="h-4 w-4 ov-text-accent" aria-hidden />
                  {t("Pratinjau Klasifikasi — {f}", "Classification Preview — {f}", { f: report.file })}
                </p>
                <p className="text-[11px] text-stone-400">
                  {t("maks 50 baris pertama", "first 50 rows max")}
                </p>
              </div>

              {/* chips ringkasan */}
              <div className="grid grid-cols-2 gap-3 px-5 py-3 sm:grid-cols-5">
                {[
                  { label: t("Baris Terbaca", "Rows Parsed"), value: report.summary.total, tone: "text-stone-700 dark:text-stone-200" },
                  { label: t("Baru (OK)", "New (OK)"), value: report.summary.ok, tone: "text-emerald-600 dark:text-emerald-400" },
                  { label: t("Duplikat", "Duplicates"), value: report.summary.duplicate, tone: "text-amber-600 dark:text-amber-400" },
                  { label: t("Tak Dikenal", "Unknown"), value: report.summary.unknown, tone: "text-orange-600 dark:text-orange-400" },
                  { label: t("Tak Valid", "Invalid"), value: report.summary.invalid, tone: "text-rose-600 dark:text-rose-400" },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-stone-200/80 bg-stone-50/60 p-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{c.label}</p>
                    <p className={cn("text-base font-extrabold tabular-nums", c.tone)}>{c.value}</p>
                  </div>
                ))}
              </div>

              {report.unknownIds.length > 0 && (
                <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-[12px] text-orange-700 dark:bg-orange-500/10 dark:text-orange-300">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    <strong>{t("ID tidak dikenal:", "Unknown IDs:")}</strong>{" "}
                    <span className="font-mono">{report.unknownIds.slice(0, 20).join(", ")}</span>
                    {report.unknownIds.length > 20 ? t(" … dan {n} lainnya", " … and {n} more", { n: report.unknownIds.length - 20 }) : ""}
                    {" — "}
                    {t("pastikan nomor karyawan/NIK sesuai data direktori aktif.", "make sure the employee number/NIK matches the active directory.")}
                  </span>
                </div>
              )}

              {/* tabel preview */}
              <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar]:w-1.5">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-900">
                    <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                      <TableHead className="text-[11px] font-bold">{t("Baris", "Row")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Karyawan", "Employee")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Waktu", "Timestamp")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Arah", "Direction")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Status", "Status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.preview.slice(0, PREVIEW_ROWS).map((r) => {
                      const meta = STATUS_META[r.status];
                      const Icon = meta.icon;
                      return (
                        <TableRow key={r.row} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", meta.rowCls)}>
                          <TableCell className="tabular-nums text-[11px] text-stone-400">{r.row}</TableCell>
                          <TableCell>
                            <p className="font-mono text-[12px] font-bold text-stone-700 dark:text-stone-200">{r.employeeNo || "—"}</p>
                            <p className="max-w-[200px] truncate text-[10px] text-stone-400">
                              {r.fullName ?? (r.status === "unknown" ? t("tidak dikenal", "not found") : "—")}
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-[11.5px] tabular-nums text-stone-600 dark:text-stone-300">
                            {r.timestamp ? fmtTs(r.timestamp) : "—"}
                          </TableCell>
                          <TableCell>
                            {r.direction ? (
                              <Badge variant="outline" className={cn("text-[10px] font-bold", r.direction === "IN" ? "border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400" : "border-rose-200 text-rose-700 dark:border-rose-500/30 dark:text-rose-400")}>
                                {r.direction}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-stone-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", meta.cls)} title={r.message ?? undefined}>
                              <Icon className="h-3 w-3" aria-hidden />
                              {t(meta.id, meta.en)}
                            </span>
                            {r.message && <p className="mt-0.5 max-w-[260px] text-[10px] text-stone-400">{r.message}</p>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {report.summary.total > PREVIEW_ROWS && (
                <p className="border-t border-stone-100 bg-stone-50/60 px-5 py-2 text-[11px] text-stone-500 dark:border-stone-800 dark:bg-stone-900/40">
                  {t("Menampilkan {n} dari {m} baris.", "Showing {n} of {m} rows.", { n: Math.min(PREVIEW_ROWS, report.preview.length), m: report.summary.total })}
                </p>
              )}

              {/* tombol konfirmasi — guard op:import */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-5 py-3 dark:border-stone-800">
                <p className="text-[11px] text-stone-400">
                  {t("Komit menyisipkan log source \"Machine\" lalu menghitung ulang rekap harian per karyawan/tanggal.", "Committing inserts logs with source \"Machine\" then recalculates daily recaps per employee/date.")}
                </p>
                {canImport ? (
                  <Button size="sm" disabled={busy || !report || report.summary.ok === 0} onClick={() => setConfirmOpen(true)} className="gap-1.5 font-bold">
                    <Upload className="h-4 w-4" />
                    {t("Import {n} Baris", "Import {n} Rows", { n: report?.summary.ok ?? 0 })}
                  </Button>
                ) : (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] font-bold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                    {t("Tanpa hak op import", "No import operation right")}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ===== hasil komit ===== */}
      {phase === "done" && result && summary && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="rounded-2xl border-emerald-200/80 shadow-sm dark:border-emerald-500/25">
            <CardContent className="p-5">
              <div className={cn("flex items-start gap-2.5 rounded-xl p-3.5 text-[13px] font-semibold", result.summary.ok > 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-stone-50 text-stone-600 dark:bg-stone-800 dark:text-stone-300")}>
                {result.summary.ok > 0 ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Copy className="mt-0.5 h-4 w-4 shrink-0" />}
                {result.summary.ok > 0
                  ? t("Import selesai — {n} log disisipkan, {s} dilewati.", "Import finished — {n} logs inserted, {s} skipped.", { n: result.summary.ok, s: result.summary.duplicate + result.summary.unknown + result.summary.invalid })
                  : t("Import selesai — 0 log baru (semua baris duplikat/dilewati). Idempoten terverifikasi.", "Import finished — 0 new logs (all rows duplicates/skipped). Idempotency verified.")}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: t("Baru", "New"), value: result.summary.ok },
                  { label: t("Duplikat", "Duplicates"), value: result.summary.duplicate },
                  { label: t("Tak Dikenal", "Unknown"), value: result.summary.unknown },
                  { label: t("Tak Valid", "Invalid"), value: result.summary.invalid },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-stone-200/80 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{c.label}</p>
                    <p className="text-lg font-extrabold tabular-nums text-stone-800 dark:text-stone-100">{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> {t("Import File Lain", "Import Another File")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ===== AlertDialog konfirmasi import ===== */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Konfirmasi Import Mesin Absen", "Confirm Machine Import")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "{n} baris OK akan disisipkan permanen sebagai log presensi source \"Machine\" (baris duplikat/tidak dikenal/tidak valid otomatis dilewati). Lanjutkan?",
                "{n} OK rows will be permanently inserted as attendance logs with source \"Machine\" (duplicate/unknown/invalid rows are skipped automatically). Continue?",
                { n: report?.summary.ok ?? 0 },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={phase === "committing"}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void runCommit(); }}
              disabled={phase === "committing"}
              className="gap-1.5 font-bold"
            >
              {phase === "committing" && <Loader2 className="h-4 w-4 animate-spin" />}
              {phase === "committing" ? t("Mengimport…", "Importing…") : t("Ya, Import", "Yes, Import")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== riwayat batch ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div>
              <p className="flex items-center gap-2 text-[13px] font-bold">
                <History className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Riwayat Import Batch", "Import Batch History")}
              </p>
              <p className="text-[11px] text-stone-400">{t("20 batch terakhir — jejak audit file yang pernah diimport", "Last 20 batches — audit trail of imported files")}</p>
            </div>
          </div>
          {batchesApi.loading && !batchesApi.data ? (
            <div className="p-5"><LoadingRows rows={4} /></div>
          ) : batches.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={t("Belum ada import", "No imports yet")}
                description={t("Riwayat batch akan muncul setelah file log mesin pertama diimport.", "Batch history appears after the first machine log file is imported.")}
                icon={History}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("File", "File")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Rentang Tanggal", "Date Range")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Baris", "Rows")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Disisipkan", "Inserted")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Dilewati", "Skipped")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Diimport", "Imported")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="max-w-[220px] truncate text-[12.5px] font-bold text-stone-700 dark:text-stone-200" title={b.fileName}>{b.fileName}</p>
                        {b.unknownEmployees && (
                          <p className="max-w-[220px] truncate text-[10px] text-orange-500" title={b.unknownEmployees}>
                            {t("tak dikenal:", "unknown:")} <span className="font-mono">{b.unknownEmployees}</span>
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                        {b.dateFrom ? `${fmtDateShort(b.dateFrom, locale)} → ${fmtDateShort(b.dateTo ?? b.dateFrom, locale)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums text-stone-600 dark:text-stone-300">{b.rowCount}</TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{b.inserted}</TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-amber-600 dark:text-amber-400">{b.skipped}</TableCell>
                      <TableCell className="text-[11px] text-stone-500 dark:text-stone-400">{fmtDateTime(b.importedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** "7 Sep 2026" ringkas utk kolom riwayat batch. */
function fmtDateShort(v: string, locale: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
}
