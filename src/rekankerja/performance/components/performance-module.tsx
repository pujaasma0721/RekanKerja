"use client";
// RekanKerja Performance — shell modul (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md
// §13/§14): switch view seperti recruitment-module; sidebar = tab bar.
// Fase P1+ mengisi: cycles, goals, checkins, appraisals, calibration,
// results, pip, probation, reports.
import { PerformanceOverview } from "./performance-overview";
import { PerformanceCyclesPage } from "./performance-cycles";
import { PerformanceGoalsPage } from "./performance-goals";
import { PerformanceMastersPage } from "./performance-masters";
import { PerformanceSettingsPage } from "./performance-settings";
import { PerformanceCheckinsPage } from "./performance-checkins";
import { PerformanceAppraisalsPage } from "./performance-appraisals";
import { PerformanceCalibrationPage } from "./performance-calibration";
import { PerformanceResultsPage } from "./performance-results";
import { PerformancePipPage } from "./performance-pip";
import { PerformanceProbationPage } from "./performance-probation";

export function PerformanceModule({ view }: { view: string }) {
  switch (view) {
    case "masters":
      return <PerformanceMastersPage />;
    case "cycles":
      return <PerformanceCyclesPage />;
    case "checkins":
      return <PerformanceCheckinsPage />;
    case "goals":
      return <PerformanceGoalsPage />;
    case "appraisals":
      return <PerformanceAppraisalsPage />;
    case "calibration":
      return <PerformanceCalibrationPage />;
    case "results":
      return <PerformanceResultsPage />;
    case "pip":
      return <PerformancePipPage />;
    case "probation":
      return <PerformanceProbationPage />;
    case "settings":
      return <PerformanceSettingsPage />;
    default:
      return <PerformanceOverview />;
  }
}
