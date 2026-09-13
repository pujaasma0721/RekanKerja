"use client";
// OneVity Payroll — tombol export laporan (T12-REPORTS), export-only:
//   • BpjsExportButton — rekap iuran BPJS per karyawan (XLSX) + 27-c format
//     upload resmi: Laporan Kepegawaian BPJS Ketenagakerjaan (CSV) & Data
//     Peserta BPJS Kesehatan (CSV) — dropdown 3 opsi + peta kolom.
//   • PayrollRegisterExportButton — payroll register per unit kerja (XLSX)
// Anchor langsung ke endpoint download (pola BankExportMenu): respons
// Content-Disposition attachment → browser mengunduh tanpa navigasi.
import { ShieldCheck, FileSpreadsheet, FileUp, ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const btnCls = (compact?: boolean) =>
  cn(
    "inline-flex items-center gap-1 rounded-lg border border-stone-200 font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:text-stone-300",
    compact ? "h-7 px-2.5 text-[11px]" : "h-9 gap-2 px-4 text-[13px]"
  );

export function BpjsExportButton({ runId, runNo, compact }: { runId: string; runNo?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={btnCls(compact)}
        aria-label={t("Menu ekspor BPJS run {no}", "BPJS export menu for run {no}", { no: runNo ?? runId })}
      >
        <ShieldCheck className={compact ? "h-3 w-3" : "h-4 w-4"} />
        {compact ? t("BPJS", "BPJS") : t("Ekspor BPJS", "BPJS Export")}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
          {t("Rekap internal", "Internal recap")}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={`/api/onevity/payroll-reports/bpjs?runId=${runId}&export=xlsx`} className="cursor-pointer">
            <FileSpreadsheet className="h-4 w-4 text-stone-400" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t("Rekap Iuran BPJS (XLSX)", "BPJS Contribution Recap (XLSX)")}</p>
              <p className="text-[10px] text-stone-400">{t("JHT/JP/JKK/JKM/JKN per karyawan untuk run ini", "JHT/JP/JKK/JKM/JKN per employee for this run")}</p>
            </div>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wide text-brand">
          {t("Format upload resmi (CSV)", "Official upload format (CSV)")}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={`/api/onevity/payroll-reports/bpjs?runId=${runId}&format=tk`} className="cursor-pointer">
            <FileUp className="h-4 w-4 text-brand" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t("Laporan Kepegawaian BPJS TK (CSV)", "BPJS TK Employee Report (CSV)")}</p>
              <p className="text-[10px] text-stone-400">
                {t("NO KTP · NAMA · TEMPAT/TGL LAHIR · NO BPJS TK · KODE KANTOR · STATUS · JABATAN · TGL MASUK · GAJI — tanggal DDMMYYYY", "ID Card No. · Name · Birth Place/Date · BPJS TK No. · Office Code · Status · Title · Join Date · Salary — dates DDMMYYYY")}
              </p>
            </div>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/api/onevity/payroll-reports/bpjs?runId=${runId}&format=jkn`} className="cursor-pointer">
            <FileUp className="h-4 w-4 text-brand" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t("Data Peserta BPJS Kesehatan (CSV)", "BPJS Health Members (CSV)")}</p>
              <p className="text-[10px] text-stone-400">
                {t("NIK · NO KARTU · NAMA · TGL LAHIR · JENIS KELAMIN (L/P) · HUBKEL · ALAMAT · STATUS · JABATAN · UPAH · KELAS", "NIK · Card No. · Name · Birth Date · Gender (L/P) · Family Relation · Address · Status · Title · Wage · Class")}
              </p>
            </div>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-start gap-2 px-2 py-2 text-[10px] leading-relaxed text-stone-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <p>
            {t(
              "Populasi = peserta run ini dgn No. BPJS terisi. e-Dabu BPJS Kesehatan v7.6+: unggah via sheet PESERTA (23 kolom, maks 100 baris/1 MB) — sheet lain: GAJI (ubah upah), ANGKEL (tambah keluarga), PENONAKTIFAN (5 kolom). KODE KANTOR & KELAS PERAWATAN kosong (belum ada field) — verifikasi urutan kolom terhadap template yang diunduh dari portal sebelum upload.",
              "Population = this run's members with a BPJS number. e-Dabu BPJS Health v7.6+: upload via sheet PESERTA (23 columns, max 100 rows/1 MB) — other sheets: GAJI (wage change), ANGKEL (add family), PENONAKTIFAN (5 columns). Office code & ward class are blank (no field yet) — verify column order against the template downloaded from the portal before uploading."
            )}
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PayrollRegisterExportButton({ runId, runNo, compact }: { runId: string; runNo?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <a
      href={`/api/onevity/payroll-reports/register?runId=${runId}&export=xlsx`}
      className={btnCls(compact)}
      aria-label={t("Ekspor register payroll run {no}", "Export payroll register for run {no}", { no: runNo ?? runId })}
    >
      <FileSpreadsheet className={compact ? "h-3 w-3" : "h-4 w-4"} />
      {compact ? t("Register") : t("Register Payroll (XLSX)", "Payroll Register (XLSX)")}
    </a>
  );
}

// Task 64 — laporan payroll bulanan LENGKAP: 5 sheet (Ringkasan, Rekap Gaji
// per komponen, Detail Komponen, Rekap Komponen, Pembayaran & Pajak).
export function MonthlyReportExportButton({ runId, runNo, compact }: { runId: string; runNo?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <a
      href={`/api/onevity/payroll-reports/monthly?runId=${runId}&export=xlsx`}
      className={btnCls(compact)}
      aria-label={t("Unduh laporan bulanan payroll run {no}", "Download monthly payroll report for run {no}", { no: runNo ?? runId })}
    >
      <FileSpreadsheet className={compact ? "h-3 w-3" : "h-4 w-4"} />
      {compact ? t("Bulanan") : t("Laporan Bulanan (XLSX)", "Monthly Report (XLSX)")}
    </a>
  );
}
