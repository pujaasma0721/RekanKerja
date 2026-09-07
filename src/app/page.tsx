"use client";
// OneVity — satu route "/" dua area:
// • ?area=ess → Portal Karyawan (shell sendiri, tanpa sidebar)
// • default   → Aplikasi Admin (AppShell + modul)
// Landing: tanpa param area → tanya /api/ess/session sekali — karyawan
// murni (tanpa akses admin) langsung mendarat di Portal Karyawan.
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Waypoints } from "lucide-react";
import { useNav } from "@/onevity/shared/lib/store";
import { AuthGate } from "@/onevity/shared/components/auth/auth-gate";
import { AppShell } from "@/onevity/shared/components/shell/app-shell";
import { DashboardModule } from "@/onevity/shared/components/dashboard/dashboard-module";
import { OrgModule } from "@/onevity/human-resource/components/org/org-module";
import { PositionModule } from "@/onevity/human-resource/components/position/position-module";
import { EmployeeModule } from "@/onevity/human-resource/components/employee/employee-module";
import { ActionsModule } from "@/onevity/human-resource/components/actions/actions-module";
import { PayrollModule } from "@/onevity/payroll/components/payroll-module";
import { AttendanceModule } from "@/onevity/time-attendance/components/attendance-module";
import { LeaveModule } from "@/onevity/leave/components/leave-module";
import { TravelModule } from "@/onevity/travel/components/travel-module";
import { MedicalModule } from "@/onevity/medical/components/medical-module";
import { SettingsModule } from "@/onevity/shared/components/settings/settings-module";
import { EssPortal } from "@/onevity/ess/components/ess-portal";
import { AREA_EVENT, areaFromUrl } from "@/onevity/ess/lib/ess-store";
import { useSession } from "@/onevity/shared/lib/session-store";

function AdminApp() {
  const { section, view, syncFromUrl } = useNav();
  useEffect(() => { syncFromUrl(); }, [syncFromUrl]);
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${section}-${view}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {section === "dashboard" && <DashboardModule />}
          {section === "org" && <OrgModule view={view} />}
          {section === "position" && <PositionModule view={view} />}
          {section === "employee" && <EmployeeModule view={view} />}
          {section === "actions" && <ActionsModule view={view} />}
          {section === "payroll" && <PayrollModule view={view} />}
          {section === "attendance" && <AttendanceModule view={view} />}
          {section === "leave" && <LeaveModule view={view} />}
          {section === "travel" && <TravelModule view={view} />}
          {section === "settings" && <SettingsModule view={view} />}
          {section === "medical" && <MedicalModule view={view} />}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

function AreaSplash({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/40">
          <Waypoints className="h-7 w-7" />
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-stone-500 dark:text-stone-400">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-400" />
          {label}
        </div>
      </div>
    </div>
  );
}

/** Keputusan area: ?area= explicit menang; tanpa param → setelah sesi siap,
 *  tanya /api/ess/session: karyawan murni (canAdminApp=false) → Portal Karyawan. */
function useArea(): "deciding" | "admin" | "ess" {
  const [area, setArea] = useState<"deciding" | "admin" | "ess">("deciding");
  const { status } = useSession();

  // evaluasi setiap kali sesi menjadi siap (reload dengan cookie / setelah login
  // / setelah pilih tenant) — bukan sekali saat mount (saat mount sesi bisa
  // masih anonim → keputusan salah & tersimpan).
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    (async () => {
      const explicit = areaFromUrl();
      if (explicit) {
        if (!cancelled) setArea(explicit);
        return;
      }
      try {
        const r = await fetch("/api/ess/session");
        const j = r.ok ? await r.json() : null;
        const landing: "admin" | "ess" = j && j.canAdminApp === false ? "ess" : "admin";
        if (!cancelled) setArea(landing);
      } catch {
        if (!cancelled) setArea("admin");
      }
    })();
    return () => { cancelled = true; };
  }, [status]);

  // dengarkan perpindahan area (enterEss/exitEss) + tombol back/forward
  useEffect(() => {
    const onArea = () => {
      const explicit = areaFromUrl();
      if (explicit) setArea(explicit);
      else setArea("admin"); // kembali ke URL admin polos (tanpa ?area) → admin
    };
    const onPop = () => onArea();
    window.addEventListener(AREA_EVENT, onArea);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(AREA_EVENT, onArea);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return area;
}

export default function Page() {
  const area = useArea();
  return (
    <AuthGate>
      {area === "deciding" ? (
        <AreaSplash label="Menyiapkan workspace…" />
      ) : area === "ess" ? (
        <EssPortal />
      ) : (
        <AdminApp />
      )}
    </AuthGate>
  );
}
