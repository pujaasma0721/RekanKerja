"use client";
// AuthGate — render anak hanya bila session ready (tenant terpilih).
// status: "loading" → splash; "anonymous" → CareerPortal (F2-PORTAL: portal
// karier publik — tombol "Masuk" men-toggle ke AuthScreen + tombol kembali
// kecil); "select-tenant" → TenantSelect; "ready" → children.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useAccentTheme, applyAccentTheme } from "@/rekankerja/shared/lib/accent-theme";
import { useSessionLifecycle } from "@/rekankerja/shared/lib/session-lifecycle";
import { AuthScreen } from "./auth-screen";
import { CareerPortal } from "./career-portal";
import { TenantSelect } from "./tenant-select";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, load } = useSession();
  const { t } = useI18n();
  const bootstrapped = useRef(false);
  // F2-PORTAL — pengunjung anonymous mendarat di portal karier; "Masuk"
  // men-toggle ke AuthScreen (state lokal, tidak menyentuh AuthScreen).
  const [anonView, setAnonView] = useState<"portal" | "auth">("portal");
  // Task 64k — keepalive sliding refresh + idle timeout + intersep 401 global.
  useSessionLifecycle();

  useEffect(() => {
    if (bootstrapped.current) return; // guard double-invoke StrictMode
    bootstrapped.current = true;
    void load();
  }, [load]);

  // Task 64f — tema aksen pilihan pengguna tetap berlaku di layar auth
  // (login/pilih tenant terbuka sebelum shell, jadi hydrate & apply di sini).
  const { accent: accentId, hydrate: hydrateAccent } = useAccentTheme();
  const { resolvedTheme } = useTheme();
  useEffect(() => { hydrateAccent(); }, [hydrateAccent]);
  useEffect(() => { if (resolvedTheme) applyAccentTheme(accentId); }, [resolvedTheme, accentId]);

  if (status === "loading") {
    // splash senada Ivory Editorial — latar ivory + lockup resmi + spinner brand
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          {/* Task logo-1: lockup PNG resmi (transparan), menyatu dengan latar */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/rekankerja-lockup.png" alt="RekanKerja" className="h-10 w-auto" draggable={false} />
          <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-brand-deep dark:text-brand" aria-hidden />
            {t("Memuat sesi…", "Loading session…")}
          </div>
        </div>
      </div>
    );
  }

  if (status === "anonymous") {
    // F2-PORTAL (D1): anonymous mendarat di portal karier publik; tombol
    // "Masuk" di header portal menampilkan layar login (AuthScreen utuh,
    // tidak diubah) + tombol kecil fixed utk kembali ke portal.
    if (anonView === "portal") return <CareerPortal onLogin={() => setAnonView("auth")} />;
    return (
      <div className="relative min-h-screen bg-background">
        <button
          type="button"
          onClick={() => setAnonView("portal")}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-50 flex items-center gap-1.5 rounded-full border border-slate-300 bg-white/95 px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-md backdrop-blur transition-colors hover:border-orange-400 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-300 dark:hover:border-orange-800 dark:hover:text-orange-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t("Kembali ke Portal Karier", "Back to Career Portal")}
        </button>
        <AuthScreen />
      </div>
    );
  }
  if (status === "select-tenant") return <TenantSelect />;
  return <>{children}</>;
}
