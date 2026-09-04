"use client";
// OneVity — EmployeeAvatar: foto karyawan (photoUrl) dengan fallback inisial gradient elegan.
// Dipakai di direktori, grid kartu, dan quick-view panel. SSR-safe: img murni + onError state.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

const GRADIENTS = [
  "from-emerald-200 to-teal-100 text-emerald-900",
  "from-amber-200 to-orange-100 text-amber-900",
  "from-rose-200 to-pink-100 text-rose-900",
  "from-teal-200 to-cyan-100 text-teal-900",
  "from-lime-200 to-emerald-100 text-lime-900",
  "from-orange-200 to-amber-100 text-orange-900",
  "from-fuchsia-200 to-rose-100 text-fuchsia-900",
  "from-stone-200 to-stone-100 text-stone-700",
];

function hashName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return h;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLS: Record<Size, { box: string; text: string; dot: string; dotRing: string }> = {
  xs: { box: "h-9 w-9", text: "text-[11px]", dot: "h-2.5 w-2.5", dotRing: "ring-2" },
  sm: { box: "h-11 w-11", text: "text-xs", dot: "h-3 w-3", dotRing: "ring-2" },
  md: { box: "h-12 w-12", text: "text-sm", dot: "h-3 w-3", dotRing: "ring-[3px]" },
  lg: { box: "h-[76px] w-[76px]", text: "text-xl", dot: "h-4 w-4", dotRing: "ring-[3px]" },
  xl: { box: "h-24 w-24", text: "text-2xl", dot: "h-5 w-5", dotRing: "ring-4" },
};

/** Status akun → warna titik status pada avatar. */
const STATUS_DOT: Record<string, string> = {
  Active: "bg-emerald-500",
  Resigned: "bg-stone-400",
  Terminated: "bg-rose-400",
  Blacklisted: "bg-rose-500",
};

export function EmployeeAvatar({
  name,
  photoUrl,
  size = "sm",
  status,
  showStatus = false,
  className,
  ringClassName,
}: {
  name: string;
  photoUrl?: string | null;
  size?: Size;
  status?: string | null;
  showStatus?: boolean;
  className?: string;
  ringClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const { t } = useI18n();
  const s = SIZE_CLS[size];
  const grad = GRADIENTS[hashName(name) % GRADIENTS.length];
  const hasPhoto = !!photoUrl && !broken;
  const dot = STATUS_DOT[status ?? ""] ?? "bg-stone-400";

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {hasPhoto ? (
        // foto avatar dinamis dari DB (bukan aset build) — img murni agar bisa fallback onError
        <img
          src={photoUrl!}
          alt={t("Foto {name}", "Photo of {name}", { name })}
          onError={() => setBroken(true)}
          className={cn(s.box, "rounded-full bg-stone-100 object-cover", ringClassName ?? "ring-1 ring-stone-200/80 dark:ring-stone-700")}
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            s.box, "flex select-none items-center justify-center rounded-full bg-gradient-to-br font-bold tracking-wide",
            grad, ringClassName ?? "ring-1 ring-black/[0.04]",
          )}
        >
          {initials(name)}
        </span>
      )}
      {showStatus && (
        <span
          aria-hidden="true"
          className={cn("absolute bottom-0 right-0 rounded-full ring-white dark:ring-stone-900", s.dot, dot, s.dotRing)}
        />
      )}
      <span className="sr-only">{hasPhoto ? t("Foto {name}", "Photo of {name}", { name }) : t("Inisial {name}", "Initials of {name}", { name })}</span>
    </span>
  );
}
