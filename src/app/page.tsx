"use client";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNav } from "@/lib/onevity/store";
import { AuthGate } from "@/components/onevity/auth/auth-gate";
import { AppShell } from "@/components/onevity/shell/app-shell";
import { DashboardModule } from "@/components/onevity/dashboard/dashboard-module";
import { OrgModule } from "@/components/onevity/org/org-module";
import { PositionModule } from "@/components/onevity/position/position-module";
import { EmployeeModule } from "@/components/onevity/employee/employee-module";
import { ActionsModule } from "@/components/onevity/actions/actions-module";
import { PayrollModule } from "@/components/onevity/payroll/payroll-module";
import { AttendanceModule } from "@/components/onevity/attendance/attendance-module";
import { LeaveModule } from "@/components/onevity/leave/leave-module";
import { TravelModule } from "@/components/onevity/travel/travel-module";
import { MedicalModule } from "@/components/onevity/medical/medical-module";
import { SettingsModule } from "@/components/onevity/settings/settings-module";
import { ModulePlaceholder } from "@/components/onevity/module-placeholder";

export default function Page() {
  const { section, view, syncFromUrl } = useNav();

  useEffect(() => { syncFromUrl(); }, [syncFromUrl]);

  return (
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
  );
}
