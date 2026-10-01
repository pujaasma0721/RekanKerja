"use client";
// RekanKerja — pemilih TEMA AKSEN global (topbar AppShell).
// Satu warna dipilih → semua modul & halaman memakai tema yang sama.
import { Check, Palette } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCENT_THEMES, useAccentTheme } from "@/rekankerja/shared/lib/accent-theme";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

export function AccentSwitcher({ className }: { className?: string }) {
  const { accent, setAccent } = useAccentTheme();
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("Ganti tema warna", "Change accent theme")}
          title={t("Ganti tema warna", "Change accent theme")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
            className,
          )}
        >
          <Palette className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="text-xs">{t("Tema Warna", "Accent Theme")}</DropdownMenuLabel>
        {ACCENT_THEMES.map((th) => (
          <DropdownMenuItem key={th.id} onClick={() => setAccent(th.id)} className="gap-2.5">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10"
              style={{ background: th.hex }}
              aria-hidden
            >
              {accent === th.id && <Check className="h-3.5 w-3.5 text-white" />}
            </span>
            <span className="flex-1">{t(th.label, th.labelEn)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
