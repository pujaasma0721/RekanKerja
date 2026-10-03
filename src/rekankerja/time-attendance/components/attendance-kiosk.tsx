"use client";
// RekanKerja Attendance — Kios QR presensi (Task 100 F1, G17 — impl-E).
// =====================================================================
// Layar kios fisik (MODE TAMPILAN di dalam sesi admin — bukan halaman
// publik): jam besar real-time + QR berputar tiap 30 detik berisi payload
// `ovqr:{schemaName}:{token}`. Token TIDAK dihitung client — diambil dari
// GET /api/rekankerja/attendance/kiosk-token (guard attendance:liveboard;
// HMAC secret = sha256(SESSION_SECRET|schemaName) — logika sama seperti
// validator ess/api/clock.ts G17). Kios poll tiap 25 detik (bucket 30 dtk,
// toleransi ±1 di validator). Karyawan memindai dari Portal Karyawan (ESS).
import { useCallback, useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode as QrCodeIcon, X, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const KIOSK_TOKEN_URL = "/api/rekankerja/attendance/kiosk-token";
const POLL_MS = 25_000; // segar tiap 30 dtk — poll 25 dtk supaya QR tidak pernah basi

export function AttendanceKioskPage() {
  const { t, locale } = useI18n();
  const { navigate } = useNav();
  const [now, setNow] = useState(() => new Date());
  const [payload, setPayload] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  // jam besar — tick 1 detik (HH:MM:SS zona lokal).
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadToken = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(KIOSK_TOKEN_URL, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { payload?: string; expiresAt?: string; error?: string };
      if (!r.ok || !j.payload) throw new Error(j.error ?? `HTTP ${r.status}`);
      setPayload(j.payload);
      setExpiresAt(j.expiresAt ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // fetch pertama + poll tiap 25 detik (QR berputar tiap bucket 30 detik).
  useEffect(() => {
    void loadToken(false);
    const id = setInterval(() => void loadToken(true), POLL_MS);
    return () => clearInterval(id);
  }, [loadToken]);

  // render QR dari payload server (client-only — pakai `qrcode` toDataURL).
  useEffect(() => {
    if (!payload) {
      setQrSrc(null);
      return;
    }
    let alive = true;
    toDataURL(payload, { width: 480, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (alive) setQrSrc(url);
      })
      .catch(() => {
        if (alive) setQrSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [payload]);

  const secondsLeft = expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - now.getTime()) / 1000)) : null;
  const clock = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <div className="relative overflow-hidden rounded-3xl bg-slate-950 text-slate-100 shadow-2xl">
      {/* aksen latar kios */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" aria-hidden />

      <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 py-12">
        {/* tombol keluar (mode tampilan — sesi admin tetap aktif) */}
        <div className="absolute right-4 top-4">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-slate-700 bg-slate-900/80 font-bold text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100"
            onClick={() => navigate("attendance", "schedules")}
          >
            <X className="h-4 w-4" /> {t("Tutup Kios", "Close Kiosk")}
            <span className="sr-only">{t("Kembali ke tampilan modul biasa", "Back to the regular module view")}</span>
          </Button>
        </div>

        {/* jam besar real-time */}
        <div className="text-center">
          <p className="font-mono text-6xl font-black tabular-nums tracking-tight text-white sm:text-7xl" aria-live="off">
            {clock}
          </p>
          <p className="mt-1 text-[13px] font-semibold text-slate-400">
            {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>

        {/* QR rotasi 30 detik */}
        <div className="flex flex-col items-center gap-3">
          {loading && !payload ? (
            <div className="flex h-64 w-64 flex-col items-center justify-center gap-3 rounded-3xl bg-white/5 ring-1 ring-white/10">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <p className="text-[12px] text-slate-400">{t("Menyiapkan token QR…", "Preparing QR token…")}</p>
            </div>
          ) : error ? (
            <div className="flex h-64 w-64 flex-col items-center justify-center gap-3 rounded-3xl bg-rose-500/10 px-6 text-center ring-1 ring-rose-500/30">
              <p className="text-[12px] font-bold text-rose-300">{t("Token QR gagal dimuat", "QR token failed to load")}</p>
              <p className="text-[11px] leading-relaxed text-rose-200/80">{error}</p>
              <Button variant="outline" size="sm" className="gap-1.5 border-rose-400/40 bg-transparent font-bold text-rose-200 hover:bg-rose-500/20" onClick={() => void loadToken(false)}>
                <RefreshCw className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
              </Button>
            </div>
          ) : qrSrc ? (
            <div className="rounded-3xl bg-white p-5 shadow-2xl ring-4 ring-white/10">
              {/* data-URL QR lokal dari `qrcode` — render <img> disengaja (bukan asset Next) */}
              <img src={qrSrc} alt={t("Kode QR presensi berputar", "Rotating attendance QR code")} className="h-56 w-56 sm:h-64 sm:w-64" width={256} height={256} />
            </div>
          ) : (
            <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 rounded-3xl bg-white/5 ring-1 ring-white/10">
              <QrCodeIcon className="h-10 w-10 text-slate-500" />
              <p className="text-[12px] text-slate-400">{t("QR sedang dirender…", "Rendering QR…")}</p>
            </div>
          )}

          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-[13px] font-bold text-slate-200">
              {t("Segar tiap 30 detik — pindai dari Portal Karyawan", "Refreshed every 30 seconds — scan from the Employee Portal")}
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {secondsLeft !== null
                ? t("token berputar dalam {n} detik (TOTP-style, toleransi ±1)", "token rotates in {n} s (TOTP-style, ±1 tolerance)", { n: secondsLeft })
                : t("token ditandatangani HMAC server", "token is HMAC-signed by the server")}
            </p>
          </div>
        </div>

        {/* indikator bucket kecil */}
        <div className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-6 rounded-full transition-colors",
                secondsLeft !== null && secondsLeft > i * 5 ? "bg-brand" : "bg-slate-800",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
