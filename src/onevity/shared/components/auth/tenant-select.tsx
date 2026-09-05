"use client";
// OneVity TenantSelect — layar pilih workspace (status session "select-tenant").
// Daftar workspace milik user; klik → selectTenant(tenantId) → status ready.
// Desain: "Ivory Editorial" — satu bahasa visual dengan halaman masuk.
import { useState } from "react";
import { motion } from "framer-motion";
import { Building2, ChevronRight, Loader2, LogOut } from "lucide-react";
import { useSession } from "@/onevity/shared/lib/session-store";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { LanguageSwitcher } from "@/onevity/shared/components/shell/language-switcher";
import { NoiseOverlay, HairlineFrame, EditorialLogo, EditorialError } from "./editorial";
import { cn } from "@/lib/utils";

export function TenantSelect() {
  const { t } = useI18n();
  const { info, busy, error, selectTenant, logout } = useSession();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (!info) return null;

  const handleSelect = async (tenantId: string) => {
    if (busy) return;
    setPendingId(tenantId);
    const ok = await selectTenant(tenantId);
    if (!ok) setPendingId(null); // sukses → AuthGate langsung pindah layar
  };

  const handleLogout = () => {
    setPendingId(null);
    void logout();
  };

  const pillCls =
    "flex items-center gap-1.5 rounded-full border border-stone-300 bg-white/80 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-stone-500 backdrop-blur transition hover:border-stone-400 hover:text-stone-900 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-100";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#faf8f3] text-stone-800 dark:bg-stone-950 dark:text-stone-300">
      <NoiseOverlay opacity={0.035} />
      <HairlineFrame />

      {/* saklar bahasa + keluar */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6 sm:top-6">
        <LanguageSwitcher className="rounded-full border border-stone-300 bg-white/80 text-stone-600 shadow-none backdrop-blur hover:border-stone-400 hover:bg-white hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-stone-100" />
        <button type="button" onClick={handleLogout} disabled={busy} className={pillCls}>
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {t("Keluar", "Log out")}
        </button>
      </div>

      <div className="relative z-10 grid min-h-screen place-items-center px-5 py-16 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <EditorialLogo compact />

          <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700 dark:text-amber-500">
            {t("Pilih workspace", "Select workspace")}
          </p>
          <h1 className="mt-2.5 font-serif text-[30px] italic leading-tight text-stone-900 dark:text-stone-100">
            {t("Halo, {name}.", "Hello, {name}.", { name: info.user.name })}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
            {t("Pilih workspace untuk melanjutkan ke OneVity.", "Select a workspace to continue to OneVity.")}
          </p>
          <p className="mt-1 text-[12px] font-medium text-stone-400 dark:text-stone-500">{info.user.email}</p>

          {error && (
            <div className="mt-4">
              <EditorialError message={error} />
            </div>
          )}

          {info.workspaces.length === 0 ? (
            <div className="mt-7 rounded-2xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500">
                <Building2 className="h-6 w-6" aria-hidden />
              </div>
              <div className="mt-4">
                <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                  {t("Anda belum menjadi anggota workspace", "You are not a member of any workspace yet")}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
                  {t(
                    "Silakan keluar, lalu buat workspace baru untuk perusahaan Anda.",
                    "Please log out, then create a new workspace for your company.",
                  )}
                </p>
              </div>
              <button type="button" onClick={handleLogout} disabled={busy} className={cn(pillCls, "mt-5")}>
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                {t("Keluar", "Log out")}
              </button>
            </div>
          ) : (
            <ul className="mt-7 space-y-3">
              {info.workspaces.map((ws) => {
                const pending = pendingId === ws.id && busy;
                return (
                  <li key={ws.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(ws.id)}
                      disabled={busy}
                      aria-label={t("Pilih workspace {name}", "Select workspace {name}", { name: ws.name })}
                      className="group w-full rounded-2xl border border-stone-200/90 bg-white p-4 text-left shadow-[0_24px_48px_-32px_rgba(87,83,78,0.28)] outline-none transition-all focus-visible:ring-2 focus-visible:ring-amber-600/40 hover:border-amber-600/50 hover:shadow-[0_28px_56px_-28px_rgba(87,83,78,0.38)] disabled:cursor-not-allowed disabled:opacity-60 sm:p-5 dark:border-stone-800 dark:bg-stone-900 dark:shadow-[0_24px_48px_-32px_rgba(0,0,0,0.7)] dark:hover:border-amber-500/40"
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-[#faf8f3] text-stone-600 transition-colors group-hover:border-amber-600/40 group-hover:bg-amber-50 group-hover:text-amber-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:group-hover:border-amber-500/30 dark:group-hover:bg-amber-500/10 dark:group-hover:text-amber-400">
                          <Building2 className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-stone-800 dark:text-stone-100">
                            {ws.name}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-xs text-stone-400 dark:text-stone-500">
                            {ws.slug}
                          </span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-2 sm:flex">
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                            {ws.role}
                          </span>
                          <span className="rounded-full border border-stone-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:border-stone-700 dark:text-stone-500">
                            {ws.plan}
                          </span>
                        </span>
                        {pending ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-500" aria-hidden />
                        ) : (
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-stone-400 transition-all group-hover:translate-x-0.5 group-hover:text-amber-700 dark:group-hover:text-amber-500"
                            aria-hidden
                          />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-7 text-center text-[11px] leading-relaxed text-stone-400 dark:text-stone-500">
            {t(
              "Satu akun dapat menjadi anggota beberapa workspace — data tiap workspace terisolasi.",
              "One account can belong to multiple workspaces — each workspace's data is isolated.",
            )}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
