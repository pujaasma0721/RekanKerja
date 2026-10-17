"use client";
// RekanKerja Payroll — Menu ekspor file transfer bank per format: rekap umum +
// format simple (lama) + KORPORAT (P1.4-BM D-BM10: layout upload portal payroll
// BCA/Mandiri CMS/BNI — nominal angka polos). Dipakai di halaman Proses & Hasil
// dan Detail Run.
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileDown, Building2, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

export function BankExportMenu({ runId, runNo, compact }: { runId: string; runNo: string; compact?: boolean }) {
  const { t, lang } = useI18n();
  const base = `/api/rekankerja/payroll-run-export?id=${runId}&lang=${lang}`;
  const items = [
    { key: "umum", label: t("Rekap Umum (semua bank)", "General Recap (all banks)"), hint: t("kolom lengkap + total", "full columns + total"), href: `${base}&bank=umum` },
    { key: "bca", label: t("BCA Payroll", "BCA Payroll"), hint: t("hanya rekening BCA", "BCA accounts only"), href: `${base}&bank=bca` },
    { key: "mandiri", label: t("Mandiri Transfer", "Mandiri Transfer"), hint: t("hanya rekening Mandiri", "Mandiri accounts only"), href: `${base}&bank=mandiri` },
    { key: "bni", label: t("BNI Payroll", "BNI Payroll"), hint: t("hanya rekening BNI", "BNI accounts only"), href: `${base}&bank=bni` },
  ];
  // P1.4-BM (D-BM10) — layout korporat utk upload portal payroll per bank.
  const corporateItems = [
    { key: "bca-corp", label: t("BCA — Korporat", "BCA — Corporate"), hint: t("nominal angka polos", "plain-digit amounts"), href: `${base}&bank=bca&layout=corporate` },
    { key: "mandiri-corp", label: t("Mandiri — Korporat (CMS)", "Mandiri — Corporate (CMS)"), hint: t("nominal angka polos", "plain-digit amounts"), href: `${base}&bank=mandiri&layout=corporate` },
    { key: "bni-corp", label: t("BNI — Korporat", "BNI — Corporate"), hint: t("nominal angka polos", "plain-digit amounts"), href: `${base}&bank=bni&layout=corporate` },
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
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {t("File transfer — {no}", "Bank transfer file — {no}", { no: runNo })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((it) => (
          <DropdownMenuItem key={it.key} asChild>
            <a href={it.href} className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-[12px] font-semibold">{it.label}</span>
              <span className="text-[10px] text-slate-400">{it.hint}</span>
            </a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          <Landmark className="h-3 w-3" aria-hidden /> {t("Layout korporat (upload portal bank)", "Corporate layout (bank portal upload)")}
        </DropdownMenuLabel>
        {corporateItems.map((it) => (
          <DropdownMenuItem key={it.key} asChild>
            <a href={it.href} className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-[12px] font-semibold">{it.label}</span>
              <span className="text-[10px] text-slate-400">{it.hint}</span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
