"use client";
// RekanKerja — F3: Kandidat & Proses Seleksi (placeholder — UI lengkap menyusul).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { UserRoundCheck } from "lucide-react";

export function SelectionPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-10">
      <div className="text-center">
        <UserRoundCheck className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden />
        <p className="text-sm text-slate-400">
          {t("Modul Kandidat & Seleksi sedang disiapkan…", "Candidates & Selection module is being prepared…")}
        </p>
      </div>
    </div>
  );
}
