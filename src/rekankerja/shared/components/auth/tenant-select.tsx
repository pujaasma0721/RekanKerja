"use client";
// RekanKerja TenantSelect — layar pilih workspace (status session "select-tenant").
// Daftar workspace milik user; klik → selectTenant(tenantId) → status ready.
// Desain: tema SayOne-Learning (Task 85) — satu bahasa visual dengan halaman masuk.
import { useState } from "react";
import { motion } from "framer-motion";
import { Building2, ChevronRight, Loader2, LogOut } from "lucide-react";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { LanguageSwitcher } from "@/rekankerja/shared/components/shell/language-switcher";
import { NoiseOverlay, EditorialLogo, EditorialError } from "./editorial";
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
    "flex items-center gap-1.5 rounded-full border border-slate-300 bg-white/80 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 backdrop-blur transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-100";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <NoiseOverlay opacity={0.035} />

      {/* saklar bahasa + keluar */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6 sm:top-6">
        <LanguageSwitcher className="rounded-full border border-slate-300 bg-white/80 text-slate-600 shadow-none backdrop-blur hover:border-slate-400 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100" />
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

          <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.3em] text-brand-deep dark:text-brand">
            {t("Pilih workspace", "Select workspace")}
          </p>
          <h1 className="mt-2.5 text-[30px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
            {t("Halo, {name}.", "Hello, {name}.", { name: info.user.name })}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t("Pilih workspace untuk melanjutkan ke RekanKerja.", "Select a workspace to continue to RekanKerja.")}
          </p>
          <p className="mt-1 text-[12px] font-medium text-slate-400 dark:text-slate-500">{info.user.email}</p>

          {error && (
            <div className="mt-4">
              <EditorialError message={error} />
            </div>
          )}

          {info.workspaces.length === 0 ? (
            <div className="mt-7 rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
                <Building2 className="h-6 w-6" aria-hidden />
              </div>
              <div className="mt-4">
                <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">
                  {t("Anda belum menjadi anggota workspace", "You are not a member of any workspace yet")}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
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
                      className="group w-full rounded-2xl border border-slate-200/90 bg-card p-4 text-left shadow-[0_24px_48px_-32px_rgba(37,99,235,0.22)] outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/40 hover:border-primary/50 hover:shadow-[0_28px_56px_-28px_rgba(37,99,235,0.32)] disabled:cursor-not-allowed disabled:opacity-60 sm:p-5 dark:border-white/10"
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-surface text-slate-600 transition-colors group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary dark:border-white/10 dark:bg-surface-2 dark:text-slate-300 dark:group-hover:border-primary/30 dark:group-hover:bg-primary/10 dark:group-hover:text-primary">
                          <Building2 className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                            {ws.name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-slate-400 dark:text-slate-500">
                            {ws.companyCode && (
                              <span
                                title={t("Kode perusahaan", "Company code")}
                                className="shrink-0 rounded border border-slate-200 bg-surface px-1.5 py-px font-bold uppercase tracking-[0.1em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                {ws.companyCode}
                              </span>
                            )}
                            <span className="truncate">{ws.slug}</span>
                          </span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-2 sm:flex">
                          <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85">
                            {ws.role}
                          </span>
                          <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-slate-700 dark:text-slate-500">
                            {ws.plan}
                          </span>
                        </span>
                        {pending ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-deep dark:text-brand" aria-hidden />
                        ) : (
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-slate-400 transition-all group-hover:translate-x-0.5 group-hover:text-brand-deep dark:group-hover:text-brand"
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

          <p className="mt-7 text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
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
