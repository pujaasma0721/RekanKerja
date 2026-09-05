"use client";
// ============================================================================
// OneVity — fragmen desain "Ivory Editorial" (quiet luxury).
// Dipilih user dari Auth Design Lab (?mockup=auth, opsi B) untuk halaman masuk.
// Dipakai bersama oleh auth-screen (masuk/registrasi) & tenant-select (pilih
// workspace) agar seluruh perjalanan auth satu bahasa visual.
// Karakter: latar ivory hangat + noise film halus + bingkai hairline tipis +
// serif display (Playfair via --font-editorial) + aksen amber + CTA hitam.
// ============================================================================
import { motion } from "framer-motion";
import { AlertCircle, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tekstur noise film SVG inline — kedalaman "kertas premium" tanpa aset. */
const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function NoiseOverlay({ opacity = 0.035, className }: { opacity?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{ backgroundImage: NOISE_URL, opacity, mixBlendMode: "overlay" }}
    />
  );
}

/**
 * Bingkai hairline editorial — margin 12px + border tipis (layar lebar saja).
 * Kesan "majalah premium" pada latar ivory penuh.
 */
export function HairlineFrame({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-3 hidden border border-stone-300/70 lg:block dark:border-stone-700/60", className)}
    />
  );
}

/** Lockup logo versi editorial: kotak tinta + aksen amber pada "Vity". */
export function EditorialLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-stone-900 text-white shadow-[0_10px_28px_-12px_rgba(28,25,23,0.7)] dark:bg-stone-100 dark:text-stone-900 dark:shadow-none",
          compact ? "h-10 w-10" : "h-12 w-12",
        )}
      >
        <Waypoints className={compact ? "h-5 w-5" : "h-6 w-6"} aria-hidden />
      </div>
      <div>
        <p
          className={cn(
            "font-extrabold tracking-tight text-stone-900 dark:text-stone-100",
            compact ? "text-base" : "text-lg",
          )}
        >
          One<span className="text-amber-700 dark:text-amber-500">Vity</span>
        </p>
        <p className="text-[9px] font-bold uppercase tracking-[0.32em] text-stone-400 dark:text-stone-500">
          HR Suite
        </p>
      </div>
    </div>
  );
}

/**
 * Marquee klien — strip nama tenant demo + kapabilitas, berjalan pelan.
 * Track = 2× konten identik (diamond ber-margin seragam menutup tiap item),
 * animasi -50% CSS murni sehingga loop mulus; motion-safe menghormati
 * prefers-reduced-motion (strip berhenti sebagai baris statis).
 */
export function MarqueeStrip({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div
      aria-hidden
      className="relative overflow-hidden py-3"
      style={{
        maskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
      }}
    >
      <div className="flex w-max items-center motion-safe:animate-[onevity-marquee_28s_linear_infinite]">
        {doubled.map((c, i) => (
          <span
            key={i}
            className="flex items-center whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500"
          >
            {c}
            <span aria-hidden className="mx-10 block h-1.5 w-1.5 rotate-45 bg-amber-600/60 dark:bg-amber-500/50" />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Pesan error gaya editorial — muncul dengan goyangan halus (shake). */
export function EditorialError({ id, message }: { id?: string; message: string }) {
  return (
    <motion.p
      id={id}
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0, x: [0, -5, 5, -3, 3, 0] }}
      transition={{ duration: 0.35 }}
      className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      {message}
    </motion.p>
  );
}
