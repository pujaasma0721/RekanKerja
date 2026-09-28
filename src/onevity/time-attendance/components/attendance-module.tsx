"use client";
// OneVity — Modul Attendance: router view (padanan Time Attendance)
import { AttendanceOverview } from "@/onevity/time-attendance/components/attendance-overview";
import { AttendanceTemplatesPage } from "@/onevity/time-attendance/components/attendance-templates";
import { AttendanceAssignmentsPage } from "@/onevity/time-attendance/components/attendance-assignments";
import { AttendanceMatrixPage } from "@/onevity/time-attendance/components/attendance-matrix";
import { AttendanceClockingPage } from "@/onevity/time-attendance/components/attendance-clocking";
import { AttendanceAbsencePage } from "@/onevity/time-attendance/components/attendance-absence";
import { AttendanceOvertimePage } from "@/onevity/time-attendance/components/attendance-overtime";
import { AttendanceWorkoffPage } from "@/onevity/time-attendance/components/attendance-workoff";
import { AttendanceHolidaysPage } from "@/onevity/time-attendance/components/attendance-holidays";
// Task 27-a/e/g — import mesin, liveboard, tukar shift (terimplementasi)
import { AttendanceLiveboardPage } from "@/onevity/time-attendance/components/attendance-liveboard";
import { AttendanceShiftSwapPage } from "@/onevity/time-attendance/components/attendance-shift-swap";
import { AttendanceMachineImportPage } from "@/onevity/time-attendance/components/attendance-machine-import";

export function AttendanceModule({ view }: { view: string }) {
  switch (view) {
    case "templates-schedule": return <AttendanceTemplatesPage />;
    case "assignment-schedule": return <AttendanceAssignmentsPage />;
    case "matrix": return <AttendanceMatrixPage />;
    case "clocking": return <AttendanceClockingPage />;
    case "absence": return <AttendanceAbsencePage />;
    case "overtime": return <AttendanceOvertimePage />;
    case "workoff": return <AttendanceWorkoffPage />;
    // T9-HOLIDAY: view kalender libur (overlay resolveDayType) — item menu
    // app-shell (attendance:holidays) di-wire koordinator.
    case "holidays": return <AttendanceHolidaysPage />;
    // Task 27-a/e/g — liveboard, tukar shift, import mesin
    case "liveboard": return <AttendanceLiveboardPage />;
    case "shift-swap": return <AttendanceShiftSwapPage />;
    case "machine-import": return <AttendanceMachineImportPage />;
    default: return <AttendanceOverview />;
  }
}
