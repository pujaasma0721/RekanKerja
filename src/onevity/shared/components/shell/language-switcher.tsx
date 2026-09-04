"use client";
// OneVity — saklar bahasa ID/EN (dipakai topbar AppShell + layar auth/tenant).
import { Check, Languages } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n, LANG_OPTIONS } from "@/onevity/shared/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("Ganti bahasa", "Change language")}
          title={t("Ganti bahasa", "Change language")}
          className={cn(
            "flex items-center gap-1.5 rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200",
            className,
          )}
        >
          <Languages className="h-[18px] w-[18px]" aria-hidden />
          <span className="hidden text-[11px] font-extrabold tracking-wide sm:inline">{lang.toUpperCase()}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs">{t("Bahasa", "Language")}</DropdownMenuLabel>
        {LANG_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => setLang(o.id)} className="gap-2">
            <Check className={cn("h-4 w-4 shrink-0", lang === o.id ? "opacity-100" : "opacity-0")} aria-hidden />
            <span className="flex-1">{o.label}</span>
            <span className="text-[10px] font-bold text-stone-400">{o.short}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
