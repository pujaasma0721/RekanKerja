"use client";
// T13-IMPORT — Bulk Import/Export Karyawan via Excel =======================
// Komponen trigger ganda utk dipasang koordinator di direktori karyawan:
//   <EmployeeImportDialog onImported={refresh} />
// • Tombol "Import Excel" (guard hr:directory create) → dialog:
//   unduh template → pilih file → dry-run preview (valid hijau / invalid
//   merah + pesan; advisory kuning) → konfirmasi → komit → toast + refresh.
// • Tombol "Export Excel" (guard hr:directory view) → unduh XLSX direktori
//   (endpoint mengikuti scope akses pengguna).
// Tidak mengimpor exceljs di sisi klien — semua parsing di server.
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, TriangleAlert, Upload, XCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// ============ kontrak respons server ============

interface DryRunRowReport {
  row: number;
  nik: string;
  fullName: string;
  errors: string[];
  warnings?: string[];
  error?: string | null;
}

interface DryRunPreviewRow {
  row: number;
  nik: string;
  fullName: string;
  joinDate: string | null;
  orgUnit: string | null;
  position: string | null;
  grade: string | null;
  level: string | null;
  employmentStatus: string;
  baseSalary: number;
  employeeNoPrefix: string;
}

interface DryRunReport {
  dryRun: true;
  file: string;
  totalRows: number;
  skippedExample: number;
  valid: number;
  invalid: number;
  rows: DryRunRowReport[];
  preview: DryRunPreviewRow[];
}

interface CommitReport {
  created: number;
  failed: { row: number; error: string }[];
  employees: { row: number; employeeNo: string; fullName: string }[];
}

const TEMPLATE_URL = "/api/onevity/employees/import?template=1";
const IMPORT_URL = "/api/onevity/employees/import";
const EXPORT_URL = "/api/onevity/employees/export";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 150;

type Phase = "idle" | "checking" | "preview" | "committing" | "done";

/**
 * Dialog import + tombol export. Pasang di header direktori karyawan:
 *   <EmployeeImportDialog onImported={() => refresh()} />
 * `onImported` dipanggil setelah komit sukses agar daftar karyawan dimuat ulang.
 */
export function EmployeeImportDialog({ onImported }: { onImported?: () => void }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [result, setResult] = useState<CommitReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canImport = perms.can("hr", "directory", "create");
  const canExport = perms.can("hr", "directory", "view");

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setReport(null);
    setResult(null);
    setConfirming(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const closeDialog = () => {
    setOpen(false);
    reset();
  };

  const pickFile = (f: File | null) => {
    setError(null);
    setReport(null);
    setResult(null);
    setConfirming(false);
    setPhase("idle");
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setError(t("Hanya file .xlsx yang didukung — simpan ulang sebagai Excel Workbook.", "Only .xlsx files are supported — re-save as an Excel Workbook."));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("File terlalu besar (maks 2 MB) — pecah file atau hapus baris tidak perlu.", "File too large (max 2 MB) — split the file or remove unnecessary rows."));
      return;
    }
    setFile(f);
  };

  /** Kirim file ke server (dryRun true/false) — multipart, tanpa exceljs klien. */
  const send = async (dryRun: boolean): Promise<DryRunReport | CommitReport> => {
    if (!file) throw new Error(t("Pilih file XLSX dulu", "Pick an XLSX file first"));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dryRun", String(dryRun));
    const res = await fetch(IMPORT_URL, { method: "POST", body: fd });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json as DryRunReport | CommitReport;
  };

  const runDryRun = async () => {
    if (!file) {
      toast.error(t("Pilih file XLSX dulu", "Pick an XLSX file first"));
      return;
    }
    setPhase("checking");
    setError(null);
    try {
      const r = (await send(true)) as DryRunReport;
      setReport(r);
      setPhase("preview");
      if (r.invalid > 0) toast.warning(t("{n} baris bermasalah — periksa pesan merah sebelum komit.", "{n} rows have issues — check the red messages before committing.", { n: r.invalid }));
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
      if (r.created > 0) {
        toast.success(t("{n} karyawan berhasil diimport", "{n} employees imported successfully", { n: r.created }));
      } else {
        toast.warning(t("Tidak ada karyawan yang dibuat", "No employees were created"));
      }
      if (r.failed.length > 0) toast.error(t("{n} baris gagal — lihat rincian di dialog", "{n} rows failed — see details in the dialog", { n: r.failed.length }));
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
      setPhase("preview");
    }
  };

  const busy = phase === "checking" || phase === "committing";

  return (
    <>
      {canImport && (
        <Button onClick={() => { setOpen(true); reset(); }} size="sm" variant="outline" className="h-9 gap-1.5 px-3.5 font-medium">
          <FileSpreadsheet className="h-4 w-4" /> {t("Import Excel", "Import Excel")}
        </Button>
      )}
      {canExport && (
        <Button
          onClick={() => { window.location.href = EXPORT_URL; }}
          size="sm" variant="outline" className="h-9 gap-1.5 px-3.5 font-medium"
          aria-label={t("Unduh direktori karyawan sebagai Excel", "Download the employee directory as Excel")}
        >
          <Download className="h-4 w-4" /> {t("Export Excel", "Export Excel")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog(); else setOpen(true); }}>
        <DialogContent className="max-h-[90vh] w-[min(920px,94vw)] overflow-y-auto sm:max-w-[920px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-slate-500" />
              {t("Import Karyawan dari Excel", "Import Employees from Excel")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Unduh template, isi datanya, lalu periksa dengan dry-run sebelum komit. Maksimum 500 baris / 2 MB per file.",
                "Download the template, fill in the data, then run a dry-run check before committing. Max 500 rows / 2 MB per file.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* langkah 1 — template + file */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={TEMPLATE_URL}
                download
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-4 w-4" /> {t("Unduh Template", "Download Template")}
              </a>
              <div className="flex-1">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-2 text-[13px] text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:file:bg-slate-100 dark:file:text-slate-900"
                  aria-label={t("Pilih file XLSX", "Pick an XLSX file")}
                />
                {file && (
                  <p className="mt-1.5 text-[12px] text-slate-500">
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            {/* langkah 2 — dry-run */}
            {phase !== "done" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={runDryRun} disabled={!file || busy} size="sm" className="gap-1.5">
                  {phase === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {phase === "checking" ? t("Memeriksa…", "Checking…") : t("Periksa Data (Dry-Run)", "Validate Data (Dry-Run)")}
                </Button>
                {report && phase === "preview" && (
                  <span className="text-[13px] text-slate-500">
                    {t(
                      "{v} valid · {i} bermasalah · {n} baris",
                      "{v} valid · {i} issues · {n} rows",
                      { v: report.valid, i: report.invalid, n: report.totalRows },
                    )}
                    {report.skippedExample > 0 ? t(` · ${report.skippedExample} contoh diabaikan`, ` · ${report.skippedExample} examples skipped`) : ""}
                  </span>
                )}
              </div>
            )}

            {/* langkah 3 — preview tabel hasil dry-run */}
            {report && phase !== "done" && (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{t("Baris", "Row")}</th>
                        <th className="px-3 py-2 font-semibold">NIK</th>
                        <th className="px-3 py-2 font-semibold">{t("Nama", "Name")}</th>
                        <th className="px-3 py-2 font-semibold">{t("Status")}</th>
                        <th className="px-3 py-2 font-semibold">{t("Pesan", "Messages")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.slice(0, MAX_PREVIEW_ROWS).map((r) => {
                        const invalid = r.errors.length > 0;
                        return (
                          <tr key={r.row} className={cn("border-t border-slate-100 dark:border-slate-800", invalid ? "bg-rose-50/60 dark:bg-rose-500/5" : "bg-brand/10/50 dark:bg-brand/5")}>
                            <td className="px-3 py-1.5 tabular-nums text-slate-500">{r.row}</td>
                            <td className="px-3 py-1.5 font-mono text-[11.5px]">{r.nik || "—"}</td>
                            <td className="max-w-40 truncate px-3 py-1.5 font-medium">{r.fullName || "—"}</td>
                            <td className="px-3 py-1.5">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", invalid ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/75")}>
                                {invalid ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                                {invalid ? t("Invalid") : t("Valid")}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">
                              {r.errors.length > 0 ? (
                                <span className="text-rose-700 dark:text-rose-300">{r.errors.join(" · ")}</span>
                              ) : r.warnings && r.warnings.length > 0 ? (
                                <span className="flex items-start gap-1 text-amber-700 dark:text-amber-300"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.warnings.join(" · ")}</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {report.rows.length > MAX_PREVIEW_ROWS && (
                  <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[12px] text-slate-500 dark:border-slate-800 dark:bg-slate-800">
                    {t("Menampilkan {n} dari {m} baris.", "Showing {n} of {m} rows.", { n: MAX_PREVIEW_ROWS, m: report.rows.length })}
                  </p>
                )}
              </div>
            )}

            {/* preview resolved (10 baris valid pertama) */}
            {report && report.preview.length > 0 && phase !== "done" && (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                  {t("Pratinjau data valid (maks 10)", "Valid data preview (max 10)")} · {t("nomor karyawan akan berprefix {p}", "employee numbers will be prefixed {p}", { p: report.preview[0]?.employeeNoPrefix ?? "—" })}
                </p>
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{t("Baris", "Row")}</th>
                        <th className="px-3 py-2 font-semibold">{t("Nama", "Name")}</th>
                        <th className="px-3 py-2 font-semibold">{t("Masuk", "Joined")}</th>
                        <th className="px-3 py-2 font-semibold">{t("Unit", "Unit")}</th>
                        <th className="px-3 py-2 font-semibold">{t("Posisi", "Position")}</th>
                        <th className="px-3 py-2 font-semibold">Grade</th>
                        <th className="px-3 py-2 font-semibold">{t("Status Pegawai", "Employment")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.preview.map((p) => (
                        <tr key={p.row} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-1.5 tabular-nums text-slate-500">{p.row}</td>
                          <td className="max-w-40 truncate px-3 py-1.5 font-medium">{p.fullName}</td>
                          <td className="px-3 py-1.5 tabular-nums">{p.joinDate ?? "—"}</td>
                          <td className="max-w-40 truncate px-3 py-1.5">{p.orgUnit ?? "—"}</td>
                          <td className="max-w-40 truncate px-3 py-1.5">{p.position ?? "—"}</td>
                          <td className="px-3 py-1.5">{p.grade ?? "—"}</td>
                          <td className="px-3 py-1.5">{p.employmentStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* langkah 4 — konfirmasi komit */}
            {report && phase === "preview" && report.valid > 0 && !confirming && (
              <Button onClick={() => setConfirming(true)} size="sm" className="w-fit gap-1.5">
                <Upload className="h-4 w-4" /> {t("Komit Import", "Commit Import")}
              </Button>
            )}
            {confirming && (phase === "preview" || phase === "committing") && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="flex items-start gap-2 text-[13px] text-amber-800 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {t(
                    "{n} baris valid akan dibuat permanen sebagai karyawan baru (tidak bisa dibatalkan dari dialog). Lanjutkan?",
                    "{n} valid rows will be permanently created as new employees (cannot be undone from this dialog). Continue?",
                    { n: report?.valid ?? 0 },
                  )}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button onClick={runCommit} disabled={phase === "committing"} size="sm" className="gap-1.5">
                    {phase === "committing" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {phase === "committing" ? t("Mengkomit…", "Committing…") : t("Ya, Komit", "Yes, Commit")}
                  </Button>
                  <Button onClick={() => setConfirming(false)} disabled={phase === "committing"} size="sm" variant="outline">
                    {t("Batal", "Cancel")}
                  </Button>
                </div>
              </div>
            )}

            {/* hasil komit */}
            {phase === "done" && result && (
              <div className="flex flex-col gap-3">
                <div className={cn("flex items-center gap-2 rounded-xl p-3 text-[13px] font-medium", result.created > 0 ? "bg-brand/10 text-brand-deep dark:bg-brand/10 dark:text-brand/75" : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                  <CheckCircle2 className="h-4 w-4" />
                  {t("{n} karyawan dibuat", "{n} employees created", { n: result.created })}
                  {result.failed.length > 0 ? t(` · ${result.failed.length} gagal`, ` · ${result.failed.length} failed`) : ""}
                </div>
                {result.employees.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-[12.5px]">
                      <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-semibold">{t("Baris", "Row")}</th>
                          <th className="px-3 py-2 font-semibold">{t("No Karyawan", "Employee No")}</th>
                          <th className="px-3 py-2 font-semibold">{t("Nama", "Name")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.employees.map((e) => (
                          <tr key={e.row} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-1.5 tabular-nums text-slate-500">{e.row}</td>
                            <td className="px-3 py-1.5 font-mono text-[11.5px] font-semibold">{e.employeeNo}</td>
                            <td className="px-3 py-1.5 font-medium">{e.fullName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {result.failed.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-rose-200 dark:border-rose-500/30">
                    <table className="w-full text-[12.5px]">
                      <thead className="bg-rose-50 text-left text-[11px] uppercase tracking-wide text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
                        <tr>
                          <th className="px-3 py-2 font-semibold">{t("Baris", "Row")}</th>
                          <th className="px-3 py-2 font-semibold">{t("Pesan Gagal", "Failure Message")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failed.map((f) => (
                          <tr key={f.row} className="border-t border-rose-100 dark:border-rose-500/20">
                            <td className="px-3 py-1.5 tabular-nums text-slate-500">{f.row}</td>
                            <td className="px-3 py-1.5 text-rose-700 dark:text-rose-300">{f.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-2 gap-2">
            {phase === "done" ? (
              <>
                <Button onClick={reset} size="sm" variant="outline" className="gap-1.5">
                  <RotateCcw className="h-4 w-4" /> {t("Import File Lain", "Import Another File")}
                </Button>
                <Button onClick={closeDialog} size="sm">{t("Selesai", "Done")}</Button>
              </>
            ) : (
              <Button onClick={closeDialog} size="sm" variant="outline" disabled={busy}>
                {t("Tutup", "Close")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default EmployeeImportDialog;
