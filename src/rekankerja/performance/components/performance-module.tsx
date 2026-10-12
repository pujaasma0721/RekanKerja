"use client";
// P0-PERF — switcher view modul Performance (pola recruitment-module.tsx).
// P0: overview + masters + settings hidup; view lain = placeholder fase (P1+).
import { PerformanceOverviewPage } from "./performance-overview";
import { PerformanceMastersPage } from "./performance-masters";
import { PerformanceSettingsPage } from "./performance-settings";
import { PerfComingSoon } from "./perf-coming-soon";
import { PerformanceCyclesPage } from "./performance-cycles";
import { PerformanceGoalsPage } from "./performance-goals";
import { PerformanceCheckinsPage } from "./performance-checkins";

export function PerformanceModule({ view }: { view: string }) {
  switch (view) {
    case "overview":
      return <PerformanceOverviewPage />;
    case "cycles":
      return <PerformanceCyclesPage />;
    case "goals":
      return <PerformanceGoalsPage />;
    case "checkins":
      return <PerformanceCheckinsPage />;
    case "appraisals":
      return <PerfComingSoon view="appraisals" phase="P3" />;
    case "calibration":
      return <PerfComingSoon view="calibration" phase="P4" />;
    case "results":
      return <PerfComingSoon view="results" phase="P4" />;
    case "pip":
      return <PerfComingSoon view="pip" phase="P6" />;
    case "probation":
      return <PerfComingSoon view="probation" phase="P7" />;
    case "reports":
      return <PerfComingSoon view="reports" phase="P8" />;
    case "masters":
      return <PerformanceMastersPage />;
    case "settings":
      return <PerformanceSettingsPage />;
    default:
      return <PerformanceOverviewPage />;
  }
}
