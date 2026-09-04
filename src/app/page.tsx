"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useNav } from "@/onevity/shared/lib/store";
import { AuthGate } from "@/onevity/shared/components/auth/auth-gate";
import { AppShell } from "@/onevity/shared/components/shell/app-shell";
import { I18nProvider } from "@/onevity/shared/lib/i18n";
// Design Lab — mockup desain menu (terisolasi, akses ?mockup=menu; bukan produksi)
import { MenuDesignLab } from "@/onevity/shared/components/design/menu-design-lab";
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
import { ModulePlaceholder } from "@/onevity/shared/components/module-placeholder";

export default function Page() {
  // useSearchParams butuh boundary Suspense pada halaman statis (Next 16)
  return (
    <Suspense fallback={null}>
      <PageInner />
    </Suspense>
  );
}

function PageInner() {
  // Hooks dipanggil selalu (sebelum branch mockup) agar urutan konsisten.
  const { section, view, syncFromUrl } = useNav();
  const searchParams = useSearchParams();

  useEffect(() => { syncFromUrl(); }, [syncFromUrl]);

  // Mode mockup desain menu (?mockup=menu) — render lab tanpa AuthGate/shell,
  // benar-benar terisolasi dari menu live (dan dari provider bahasa).
  if (searchParams.get("mockup") === "menu") return <MenuDesignLab />;

  return (
    <I18nProvider>
      <AuthGate>
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
      </AuthGate>
    </I18nProvider>
  );
}
