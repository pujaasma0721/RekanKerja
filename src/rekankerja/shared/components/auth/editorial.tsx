"use client";
// ============================================================================
// RekanKerja — fragmen layar auth (dipakai bersama oleh auth-screen & tenant-select).
// Task 85 — restyle tema SayOne-Learning: hero gradient biru brand + panel putih
// bersih; aksen biru #2563EB; marquee putih-biru di atas gradient.
// ============================================================================
import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
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

/** Lockup logo — Task 85: varian "hero" (kaca di atas gradient biru) atau
 * default (biru solid di atas latar terang). */
export function EditorialLogo({ compact = false, variant = "default" }: { compact?: boolean; variant?: "default" | "hero" }) {
  const hero = variant === "hero";
  // Brand asset resmi (Task logo-1): lockup PNG transparan hasil generator
  // scripts/generate-brand-logo.ts. Varian "hero" = versi putih agar menyatu
  // (blend) dengan panel gradient biru — tanpa kotak latar, hanya gambar.
  return (
    <div className="flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={hero ? "/brand/rekankerja-lockup-white.png" : "/brand/rekankerja-lockup.png"}
        alt="RekanKerja — Human Resource Information System"
        className={cn("w-auto", compact ? "h-9" : hero ? "h-14" : "h-12")}
      />
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
      <div className="flex w-max items-center motion-safe:animate-[rekankerja-marquee_28s_linear_infinite]">
        {doubled.map((c, i) => (
          <span
            key={i}
            className="flex items-center whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.22em] text-blue-200/80"
          >
            {c}
            <span aria-hidden className="mx-10 block h-1.5 w-1.5 rotate-45 bg-blue-300/60" />
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
      className="flex items-center gap-2 rounded-lg border border-brand/25 bg-brand/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-brand dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      {message}
    </motion.p>
  );
}
