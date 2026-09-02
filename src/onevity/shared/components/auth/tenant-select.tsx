"use client";
// OneVity TenantSelect — layar pilih workspace (status session "select-tenant").
// Daftar workspace milik user; klik → selectTenant(tenantId) → status ready.
import { useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Building2, ChevronRight, Loader2, LogOut, Waypoints } from "lucide-react";
import { useSession } from "@/onevity/shared/lib/session-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function TenantSelect() {
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

  return (
    <div className="relative min-h-screen bg-background">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        disabled={busy}
        className="absolute right-4 top-4 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 sm:right-6 sm:top-6"
      >
        <LogOut className="h-4 w-4" />
        Keluar
      </Button>

      <div className="grid min-h-screen place-items-center px-4 py-16 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          {/* Header kecil + identitas user */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/30">
              <Waypoints className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">
                Pilih Workspace
              </p>
              <p className="truncate text-sm text-stone-500 dark:text-stone-400">{info.user.email}</p>
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            Halo, {info.user.name}
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Pilih workspace untuk melanjutkan ke OneVity.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm font-medium text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {info.workspaces.length === 0 ? (
            <Card className="mt-6 border-dashed border-stone-300 dark:border-stone-700">
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                    Anda belum menjadi anggota workspace
                  </p>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    Silakan keluar, lalu buat workspace baru untuk perusahaan Anda.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout} disabled={busy}>
                  <LogOut className="h-4 w-4" />
                  Keluar
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ul className="mt-6 space-y-3">
              {info.workspaces.map((ws) => {
                const pending = pendingId === ws.id && busy;
                return (
                  <li key={ws.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(ws.id)}
                      disabled={busy}
                      aria-label={`Pilih workspace ${ws.name}`}
                      className="group w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Card className="gap-0 border-stone-200 py-4 transition-all group-hover:border-emerald-400 group-hover:shadow-md group-hover:shadow-emerald-600/10 dark:border-stone-800 dark:group-hover:border-emerald-500/70">
                        <CardContent className="flex items-center gap-3.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition-colors group-hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:group-hover:bg-emerald-500/20">
                            <Building2 className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-stone-800 dark:text-stone-100">
                              {ws.name}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                              {ws.slug}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className="capitalize border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                            >
                              {ws.role}
                            </Badge>
                            <Badge variant="outline" className="capitalize text-stone-500 dark:text-stone-400">
                              {ws.plan}
                            </Badge>
                          </span>
                          {pending ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-stone-400 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
                          )}
                        </CardContent>
                      </Card>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-6 text-center text-[11px] text-stone-400 dark:text-stone-500">
            Satu akun dapat menjadi anggota beberapa workspace — data tiap workspace terisolasi.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
