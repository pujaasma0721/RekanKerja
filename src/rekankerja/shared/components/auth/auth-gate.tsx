"use client";
// AuthGate — render anak hanya bila session ready (tenant terpilih).
// status: "loading" → splash; "anonymous" → AuthScreen; "select-tenant" → TenantSelect; "ready" → children.
import { useEffect, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useAccentTheme, applyAccentTheme } from "@/rekankerja/shared/lib/accent-theme";
import { useSessionLifecycle } from "@/rekankerja/shared/lib/session-lifecycle";
import { AuthScreen } from "./auth-screen";
import { TenantSelect } from "./tenant-select";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, load } = useSession();
  const { t } = useI18n();
  const bootstrapped = useRef(false);
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

  if (status === "anonymous") return <AuthScreen />;
  if (status === "select-tenant") return <TenantSelect />;
  return <>{children}</>;
}
