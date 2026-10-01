"use client";
// RekanKerja PWA (Task 27-d) — registrasi service worker + banner instal aplikasi.
// · Registrasi SW "best-effort": kegagalan TIDAK boleh mengganggu aplikasi
//   (log senyap via console.info, error ditangkap).
// · Banner instal muncul HANYA saat browser menembakkan beforeinstallprompt
//   (Chrome/Edge/Android) dan pengguna belum menolak dalam 7 hari terakhir
//   (localStorage "rekankerja:pwa-dismissed" menyimpan timestamp penolakan).
// · Dipasang sebagai sibling shell di page.tsx → admin & ESS sama-sama dapat.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Waypoints, X } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

const DISMISS_KEY = "rekankerja:pwa-dismissed";
const RESHOW_MS = 7 * 24 * 60 * 60 * 1000; // tampil lagi setelah 7 hari

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaRegister() {
  const { t } = useI18n();
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [hidden, setHidden] = useState(false);

  // --- 1) Registrasi service worker (sekali, setelah window load) ---
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;

    // Task 87 — saat SW BARU mengambil alih halaman (pasca deploy sw.js baru,
    // mis. rebrand/theme change), muat ulang SEKALI agar chunk JS yang berjalan
    // selalu berasal dari SW terbaru. Hanya dipasang bila sudah ada SW lama
    // yang mengontrol halaman (controller != null) — kunjungan pertama tidak
    // pernah reload, dan flag `refreshing` mencegah loop.
    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (refreshing || cancelled) return;
      refreshing = true;
      try {
        window.location.reload();
      } catch {
        /* non-fatal */
      }
    };
    if (hadController) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (!cancelled) console.info("[pwa] service worker terdaftar, scope:", reg.scope);
        })
        .catch((err: unknown) => {
          console.info("[pwa] service worker gagal terdaftar:", err);
        });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      if (hadController) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, []);

  // --- 2) Tangkap event instal native + bersihkan setelah terpasang ---
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      // Cek penolakan terakhir hanya saat event datang (menghindari flash
      // banner bagi pengguna yang sudah menolak).
      let recentlyDismissed = false;
      try {
        const raw = window.localStorage.getItem(DISMISS_KEY);
        recentlyDismissed = raw ? Date.now() - Number(raw) < RESHOW_MS : false;
      } catch {
        /* storage bisa diblokir — tampilkan saja */
      }
      setCanInstall(!recentlyDismissed);
    };
    const onInstalled = () => {
      deferredRef.current = null;
      setCanInstall(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    const ev = deferredRef.current;
    if (!ev) return;
    setHidden(true); // tutup banner saat dialog native terbuka
    try {
      await ev.prompt();
      await ev.userChoice.catch(() => undefined);
    } catch {
      /* prompt bisa gagal di sebagian browser — abaikan */
    }
    deferredRef.current = null; // event sekali pakai
    setCanInstall(false);
  };

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage bisa diblokir — tutup untuk sesi ini saja */
    }
    setHidden(true);
  };

  return (
    <AnimatePresence>
      {canInstall && !hidden && (
        <motion.div
          role="dialog"
          aria-label={t("Instal aplikasi RekanKerja", "Install the RekanKerja app")}
          // Di atas tab bar ESS mobile (±84px + safe-area); desktop bebas.
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[45] w-[min(20rem,calc(100vw-2rem))] md:right-6 md:bottom-6"
        >
          <div className="relative rounded-2xl border border-slate-700/60 bg-slate-900 p-4 text-slate-100 shadow-2xl shadow-slate-900/40 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("Tutup", "Dismiss")}
              className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
            <div className="flex items-start gap-3 pr-8">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white shadow-lg shadow-amber-900/30">
                <Waypoints className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold">{t("Instal aplikasi RekanKerja", "Install the RekanKerja app")}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                  {t(
                    "Akses lebih cepat dan tampil layaknya aplikasi asli di perangkat Anda.",
                    "Faster access and a native-like experience on your device.",
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={install}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white transition-colors hover:bg-amber-500 active:scale-[0.98]"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {t("Instal Aplikasi", "Install App")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-700 px-4 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
              >
                {t("Nanti", "Later")}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
