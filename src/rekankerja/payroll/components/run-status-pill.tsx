"use client";
// RekanKerja Payroll — status pill run dgn status baru "PendingConfirm"
// (P1.4-BM D-BM8: menunggu persetujuan finalisasi). StatusPill ui-kit bersifat
// shared read-only — wrapper lokal modul payroll menambahkan gaya amber utk
// PendingConfirm, selain itu didelegasikan ke StatusPill apa adanya.
import { StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

export function RunStatusPill({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  if (status !== "PendingConfirm") return <StatusPill status={status} className={className} />;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
      {t("Menunggu Persetujuan", "Pending Confirmation")}
    </span>
  );
}
