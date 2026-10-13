"use client";
// RekanKerja Performance — shell modul (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md
// §13/§14): switch view seperti recruitment-module; sidebar = tab bar.
// Fase P1+ mengisi: cycles, goals, checkins, appraisals, calibration,
// results, pip, probation, reports.
import { PerformanceOverview } from "./performance-overview";
import { PerformanceMastersPage } from "./performance-masters";
import { PerformanceSettingsPage } from "./performance-settings";

export function PerformanceModule({ view }: { view: string }) {
  switch (view) {
    case "masters":
      return <PerformanceMastersPage />;
    case "settings":
      return <PerformanceSettingsPage />;
    default:
      return <PerformanceOverview />;
  }
}
