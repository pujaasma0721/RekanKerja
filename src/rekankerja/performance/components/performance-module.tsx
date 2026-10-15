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
import { PerformanceReportsPage } from "./performance-reports";
import { PerformanceCompliancePage } from "./performance-compliance";
import { PerformanceOkrPage } from "./performance-okr";

export function PerformanceModule({ view }: { view: string }) {
  switch (view) {
    case "masters":
      return <PerformanceMastersPage />;
    case "cycles":
      return <PerformanceCyclesPage />;
    case "checkins":
      return <PerformanceCheckinsPage />;
    // B1-BL — OKR kuartalan + board transparan (D-BL1…D-BL5)
    case "okr":
      return <PerformanceOkrPage />;
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
    case "reports":
      return <PerformanceReportsPage />;
    // P9-PERF — kepatuhan UU PDP: DSR karyawan (data kinerja) + retensi arsip
    // + matriks akses §11.3.
    case "compliance":
      return <PerformanceCompliancePage />;
    case "settings":
      return <PerformanceSettingsPage />;
    default:
      return <PerformanceOverview />;
  }
}
