"use client";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNav } from "@/lib/onevity/store";
import { AppShell } from "@/components/onevity/shell/app-shell";
import { DashboardModule } from "@/components/onevity/dashboard/dashboard-module";
import { OrgModule } from "@/components/onevity/org/org-module";
import { PositionModule } from "@/components/onevity/position/position-module";
import { EmployeeModule } from "@/components/onevity/employee/employee-module";
import { ActionsModule } from "@/components/onevity/actions/actions-module";
import { PayrollModule } from "@/components/onevity/payroll/payroll-module";
import { SettingsModule } from "@/components/onevity/settings/settings-module";

export default function Page() {
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
          {section === "settings" && <SettingsModule view={view} />}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}
