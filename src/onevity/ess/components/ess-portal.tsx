"use client";
// EssPortal — root Portal Karyawan: sesi ESS + shell tanpa sidebar +
// switch halaman dengan transisi. Halaman: Beranda, Absensi, Cuti,
// Slip Gaji, Persetujuan, Profil.
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Waypoints, ArrowLeftRight, LogOut, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/onevity/shared/lib/session-store";
import { useEssNav, exitEss } from "@/onevity/ess/lib/ess-store";
import { EssSessionProvider } from "@/onevity/ess/components/ess-session";
import { EssShell } from "@/onevity/ess/components/ess-shell";
import { EssHome } from "@/onevity/ess/components/ess-home";
import { EssAttendance } from "@/onevity/ess/components/ess-attendance";
import { EssLeave } from "@/onevity/ess/components/ess-leave";
import { EssPayslips } from "@/onevity/ess/components/ess-payslips";
import { EssApprovals } from "@/onevity/ess/components/ess-approvals";
import { EssProfile } from "@/onevity/ess/components/ess-profile";

export function EssPortal() {
  const { page, syncFromUrl } = useEssNav();
  const { logout } = useSession();
  const [forbidden, setForbidden] = useState<string | null>(null);
  const onForbidden = useCallback((msg: string) => setForbidden(msg), []);

  useEffect(() => { syncFromUrl(); }, [syncFromUrl]);

  // fallback: akun tidak tertaut ke karyawan → tidak bisa pakai portal
  if (forbidden) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <UserX className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-stone-900 dark:text-stone-50">Portal Karyawan tidak tersedia</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{forbidden}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => exitEss()}>
              <ArrowLeftRight className="h-4 w-4" /> Aplikasi Admin
            </Button>
            <Button variant="outline" className="text-rose-600" onClick={() => void logout()}>
              <LogOut className="h-4 w-4" /> Keluar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <EssSessionProvider onForbidden={onForbidden}>
      <EssShell>
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {page === "home" && <EssHome />}
            {page === "attendance" && <EssAttendance />}
            {page === "leave" && <EssLeave />}
            {page === "payslips" && <EssPayslips />}
            {page === "approvals" && <EssApprovals />}
            {page === "profile" && <EssProfile />}
          </motion.div>
        </AnimatePresence>
      </EssShell>
    </EssSessionProvider>
  );
}
