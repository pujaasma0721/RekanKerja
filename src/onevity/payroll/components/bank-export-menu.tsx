"use client";
// OneVity Payroll — Menu ekspor file transfer bank per format (umum/BCA/Mandiri/BNI).
// Dipakai di halaman Proses & Hasil dan Detail Run.
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileDown, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

export function BankExportMenu({ runId, runNo, compact }: { runId: string; runNo: string; compact?: boolean }) {
  const { t } = useI18n();
  const base = `/api/onevity/payroll-run-export?id=${runId}`;
  const items = [
    { key: "umum", label: t("Rekap Umum (semua bank)", "General Recap (all banks)"), hint: t("kolom lengkap + total", "full columns + total") },
    { key: "bca", label: "BCA Payroll", hint: t("hanya rekening BCA", "BCA accounts only") },
    { key: "mandiri", label: "Mandiri Transfer", hint: t("hanya rekening Mandiri", "Mandiri accounts only") },
    { key: "bni", label: "BNI Payroll", hint: t("hanya rekening BNI", "BNI accounts only") },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border border-slate-200 font-bold text-slate-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-slate-700 dark:text-slate-300",
          compact ? "h-7 px-2.5 text-[11px]" : "h-9 gap-2 px-4 text-[13px]"
        )}
        aria-label={t("Ekspor file bank run {no}", "Export bank transfer file for run {no}", { no: runNo })}
      >
        <Building2 className={compact ? "h-3 w-3" : "h-4 w-4"} />
        {compact ? "Bank" : t("Ekspor Bank", "Bank Export")}
        <FileDown className={compact ? "h-3 w-3" : "h-4 w-4"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {t("File transfer — {no}", "Bank transfer file — {no}", { no: runNo })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((it) => (
          <DropdownMenuItem key={it.key} asChild>
            <a href={`${base}&bank=${it.key}`} className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-[12px] font-semibold">{it.label}</span>
              <span className="text-[10px] text-slate-400">{it.hint}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
