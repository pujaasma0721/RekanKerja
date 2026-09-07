"use client";
// Portal Karyawan — komponen UI bersama (tanpa sidebar): stat card,
// section, punch clock, bar saldo, peta warna status absensi, dsb.
import { ReactNode, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LogIn, LogOut, Loader2, Clock, Fingerprint } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/onevity/shared/components/ui-kit";

// ============ waktu & sapaan ============

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  // string jadwal "HH:MM" / "HH:MM:SS" (WorkDayType.timeIn/out) — tampil apa adanya
  if (typeof d === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(d.trim())) {
    const parts = d.trim().split(":");
    return `${String(Number(parts[0])).padStart(2, "0")}:${parts[1]}`;
  }
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function fmtMinutes(m: number | null | undefined): string {
  if (!m) return "0";
  if (m < 60) return `${Math.round(m)} mnt`;
  return `${Math.floor(m / 60)} jam ${Math.round(m % 60) ? `${Math.round(m % 60)} mnt` : ""}`.trim();
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 19) return "Selamat sore";
  return "Selamat malam";
}

/** Jam berjalan (detik) — dipakai hero Beranda. */
export function useLiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const raf = requestAnimationFrame(update); // async pertama (aman hydration)
    const t = setInterval(update, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  return now;
}

// ============ kartu & seksi ============

export function EssStat({
  icon, label, value, sub, accent = "emerald", onClick, delay = 0,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: "emerald" | "amber" | "rose" | "teal" | "violet" | "stone";
  onClick?: () => void;
  delay?: number;
}) {
  const accentMap: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
    teal: "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
    stone: "bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400",
  };
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-2 rounded-2xl border border-stone-200/80 bg-card p-4 text-left shadow-sm transition-all dark:border-stone-800",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-500/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl [&>svg]:h-4.5 [&>svg]:w-4.5", accentMap[accent])}>{icon}</span>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">{label}</p>
        <p className="mt-0.5 text-lg font-bold tracking-tight text-stone-900 dark:text-stone-50">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{sub}</p>}
      </div>
    </Comp>
  );
}

export function EssSection({
  title, description, action, children, className, icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {icon && <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">{title}</h2>
            {description && <p className="text-xs text-stone-500 dark:text-stone-400">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ============ punch clock (dipakai Beranda & Absensi) ============

export interface PunchToday {
  date: string;
  dayName: string | null;
  timeIn: string | null;
  timeOut: string | null;
  clockingRequired: boolean;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  workMinutes: number;
}

export function PunchCard({
  today, onClock, compact = false,
}: {
  today: PunchToday | null;
  onClock: (direction: "IN" | "OUT") => Promise<void>;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"IN" | "OUT" | null>(null);
  const clock = useLiveClock();

  const hasIn = !!today?.checkIn;
  const hasOut = !!today?.checkOut;
  const nextAction: "IN" | "OUT" | null = !hasIn ? "IN" : !hasOut ? "OUT" : null;

  const handle = async (direction: "IN" | "OUT") => {
    if (busy) return;
    setBusy(direction);
    try {
      await onClock(direction);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="overflow-hidden border-stone-200/80 shadow-sm dark:border-stone-800">
      <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-5 py-5 text-white">
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-14 -left-6 h-32 w-32 rounded-full bg-teal-400/20 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-200/90">
              <Fingerprint className="h-3.5 w-3.5" /> Absensi Hari Ini
            </p>
            <p className="mt-1 text-sm font-medium text-emerald-50/90">{today?.dayName ?? "Tidak ada jadwal"}</p>
            {today?.timeIn && today?.timeOut && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-200/80">
                <Clock className="h-3 w-3" /> Jadwal {fmtTime(today.timeIn)} – {fmtTime(today.timeOut)}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-bold tabular-nums tracking-tight">
              {clock ? new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(clock) : "--:--:--"}
            </p>
            <p className="text-[11px] text-emerald-200/80">Waktu server</p>
          </div>
        </div>
      </div>
      <CardContent className={cn("grid gap-4", compact ? "p-4" : "p-5", "sm:grid-cols-[1fr_auto]")}>
        <div className="grid grid-cols-2 gap-3">
          <div className={cn("rounded-xl border p-3", hasIn ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/10" : "border-dashed border-stone-300 dark:border-stone-700")}>
            <p className="flex items-center gap-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
              <LogIn className="h-3 w-3" /> Clock In
            </p>
            <p className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums", hasIn ? "text-emerald-700 dark:text-emerald-400" : "text-stone-300 dark:text-stone-600")}>
              {fmtTime(today?.checkIn)}
            </p>
          </div>
          <div className={cn("rounded-xl border p-3", hasOut ? "border-teal-200 bg-teal-50/60 dark:border-teal-500/25 dark:bg-teal-500/10" : "border-dashed border-stone-300 dark:border-stone-700")}>
            <p className="flex items-center gap-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
              <LogOut className="h-3 w-3" /> Clock Out
            </p>
            <p className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums", hasOut ? "text-teal-700 dark:text-teal-400" : "text-stone-300 dark:text-stone-600")}>
              {fmtTime(today?.checkOut)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-stretch justify-center gap-2 sm:w-44">
          {nextAction ? (
            <Button
              size="lg"
              disabled={!!busy || !today?.dayName}
              onClick={() => handle(nextAction)}
              className={cn(
                "h-12 rounded-xl text-sm font-semibold shadow-md transition-transform active:scale-95",
                nextAction === "IN"
                  ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25"
                  : "bg-teal-600 hover:bg-teal-700 shadow-teal-600/25",
              )}
            >
              {busy === nextAction ? <Loader2 className="h-4 w-4 animate-spin" /> : nextAction === "IN" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
              {nextAction === "IN" ? "Clock In Sekarang" : "Clock Out Sekarang"}
            </Button>
          ) : (
            <div className="flex h-12 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50/70 text-sm font-medium text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
              Absensi hari ini lengkap
            </div>
          )}
          <div className="flex items-center justify-center gap-2">
            {today?.status && <StatusPill status={today.status} />}
            {today && today.lateMinutes > 0 && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">terlambat {fmtMinutes(today.lateMinutes)}</span>}
            {!today?.dayName && <span className="text-[11px] text-stone-400">tanpa jadwal</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ bar saldo cuti ============

export function BalanceBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = pct > 40 ? "bg-emerald-500" : pct > 15 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800", className)}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className={cn("h-full rounded-full", color)}
      />
    </div>
  );
}

// ============ peta warna status absensi (konsisten dgn modul admin) ============

export const ATT_STATUS_META: Record<string, { label: string; cell: string; dot: string }> = {
  Present: { label: "Hadir", cell: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/25 dark:text-emerald-400", dot: "bg-emerald-500" },
  Late: { label: "Terlambat", cell: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-400", dot: "bg-amber-500" },
  Absent: { label: "Absen", cell: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/25 dark:text-rose-400", dot: "bg-rose-500" },
  Off: { label: "Libur", cell: "bg-stone-50 border-stone-200 text-stone-400 dark:bg-stone-800/60 dark:border-stone-700 dark:text-stone-500", dot: "bg-stone-300" },
  OnLeave: { label: "Cuti", cell: "bg-teal-50 border-teal-200 text-teal-700 dark:bg-teal-500/10 dark:border-teal-500/25 dark:text-teal-400", dot: "bg-teal-500" },
  WorkOff: { label: "Work Off", cell: "bg-cyan-50 border-cyan-200 text-cyan-700 dark:bg-cyan-500/10 dark:border-cyan-500/25 dark:text-cyan-400", dot: "bg-cyan-500" },
  Holiday: { label: "Hari Libur", cell: "bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-500/10 dark:border-violet-500/25 dark:text-violet-400", dot: "bg-violet-500" },
  "Non-clocking": { label: "Non-clocking", cell: "bg-stone-50 border-stone-200 text-stone-500 dark:bg-stone-800/60 dark:border-stone-700 dark:text-stone-400", dot: "bg-stone-400" },
};

export function attStatusMeta(status: string) {
  return ATT_STATUS_META[status] ?? { label: status, cell: "bg-stone-50 border-stone-200 text-stone-500 dark:bg-stone-800/60 dark:border-stone-700 dark:text-stone-400", dot: "bg-stone-400" };
}

// ============ baris info profil ============

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-stone-100 py-2.5 last:border-0 dark:border-stone-800/70">
      <dt className="w-40 shrink-0 text-xs font-medium text-stone-400 dark:text-stone-500">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-stone-800 dark:text-stone-200">{value ?? "—"}</dd>
    </div>
  );
}

// ============ skeleton halaman ============

export function PageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
