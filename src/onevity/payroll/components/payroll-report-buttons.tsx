"use client";
// OneVity Payroll — tombol export laporan (T12-REPORTS), export-only:
//   • BpjsExportButton — rekap iuran BPJS per karyawan (XLSX)
//   • PayrollRegisterExportButton — payroll register per unit kerja (XLSX)
// File BARU — koordinator/step berikut mem-wire ke UI (payroll-run-detail
// milik agen paralel T10, TIDAK disentuh dari sini).
// Anchor langsung ke endpoint download (pola BankExportMenu): respons
// Content-Disposition attachment → browser mengunduh tanpa navigasi.
import { ShieldCheck, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

const btnCls = (compact?: boolean) =>
  cn(
    "inline-flex items-center gap-1 rounded-lg border border-stone-200 font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:text-stone-300",
    compact ? "h-7 px-2.5 text-[11px]" : "h-9 gap-2 px-4 text-[13px]"
  );

export function BpjsExportButton({ runId, runNo, compact }: { runId: string; runNo?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <a
      href={`/api/onevity/payroll-reports/bpjs?runId=${runId}&export=xlsx`}
      className={btnCls(compact)}
      aria-label={t("Ekspor rekap BPJS run {no}", "Export BPJS recap for run {no}", { no: runNo ?? runId })}
    >
      <ShieldCheck className={compact ? "h-3 w-3" : "h-4 w-4"} />
      {compact ? "BPJS" : t("Rekap BPJS (XLSX)", "BPJS Recap (XLSX)")}
    </a>
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
