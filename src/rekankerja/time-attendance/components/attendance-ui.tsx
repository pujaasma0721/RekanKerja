"use client";
// RekanKerja Attendance — shared UI helpers (Task 100-impl-B / Fase 0):
// - todayISO()/isoLocal(): tanggal ZONA LOKAL (fix B-10 — toISOString() UTC
//   membuat "hari ini" bergeser satu hari pada 00:00–07:00 WIB; pola helper
//   ess-attendance.tsx todayISO).
// - ApiErrorState: error state useApi (G10) — ikon + pesan server + tombol
//   "Coba Lagi" (pola shift-swap/liveboard + retry; guard GET 403 utk sesi
//   tanpa menu juga jatuh ke state ini).
// - fmtDays: angka hari rekap aman utk nilai fraksional (G3 — setengah hari
//   izin unpaid 0,5 dirender "0,5", bukan dibulatkan ke atas/bawah).
import { AlertTriangle, RefreshCw } from "lucide-react";
import { getLang } from "@/rekankerja/shared/lib/i18n-core";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Tanggal hari ini YYYY-MM-DD mengikuti zona lokal perangkat (bukan UTC). */
export const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

/** Date → YYYY-MM-DD zona lokal (mencegah drift -1 hari pada zona UTC+). */
export const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const numLocale = () => (getLang() === "en" ? "en-US" : "id-ID");

/**
 * G3: format jumlah hari rekap yang boleh fraksional (0,5 hari unpaid) —
 * Intl dengan maks 1 desimal (JANGAN toFixed(0) — setengah hari harus
 * terlihat agar potongan/pembayaran tidak menyesatkan).
 */
export const fmtDays = (n: number | null | undefined) =>
  typeof n !== "number" || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat(numLocale(), { maximumFractionDigits: 1 }).format(n);

/**
 * G10: error state API — menggantikan EmptyState menyesatkan saat gagal load.
 * Dipakai dengan useApi: `<ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />`.
 */
export function ApiErrorState({ message, onRetry, busy = false }: { message: string | null | undefined; onRetry: () => void; busy?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="p-5">
      <EmptyState
        title={t("Gagal memuat", "Failed to load")}
        description={message ?? undefined}
        icon={<AlertTriangle className="h-6 w-6" />}
      />
      <div className="mt-3 flex justify-center">
        <Button variant="outline" size="sm" className="gap-1.5 font-bold" onClick={onRetry} disabled={busy}>
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
          {t("Coba Lagi", "Try Again")}
          <span className="sr-only">{t("Muat ulang data halaman ini", "Reload this page's data")}</span>
        </Button>
      </div>
    </div>
  );
}
