"use client";
// AuthGate — render anak hanya bila session ready (tenant terpilih).
// status: "loading" → splash; "anonymous" → AuthScreen; "select-tenant" → TenantSelect; "ready" → children.
import { useEffect, useRef, type ReactNode } from "react";
import { Loader2, Waypoints } from "lucide-react";
import { useSession } from "@/onevity/shared/lib/session-store";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { AuthScreen } from "./auth-screen";
import { TenantSelect } from "./tenant-select";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, load } = useSession();
  const { t } = useI18n();
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return; // guard double-invoke StrictMode
    bootstrapped.current = true;
    void load();
  }, [load]);

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/40">
            <Waypoints className="h-7 w-7" />
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-stone-500 dark:text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-400" />
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
