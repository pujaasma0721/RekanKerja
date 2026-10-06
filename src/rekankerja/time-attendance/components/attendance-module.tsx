"use client";
// RekanKerja — Modul Attendance: router view (padanan Time Attendance)
import { AttendanceOverview } from "@/rekankerja/time-attendance/components/attendance-overview";
import { AttendanceTemplatesPage } from "@/rekankerja/time-attendance/components/attendance-templates";
import { AttendanceAssignmentsPage } from "@/rekankerja/time-attendance/components/attendance-assignments";
import { AttendanceMatrixPage } from "@/rekankerja/time-attendance/components/attendance-matrix";
import { AttendanceClockingPage } from "@/rekankerja/time-attendance/components/attendance-clocking";
import { AttendanceAbsencePage } from "@/rekankerja/time-attendance/components/attendance-absence";
import { AttendanceOvertimePage } from "@/rekankerja/time-attendance/components/attendance-overtime";
import { AttendanceWorkoffPage } from "@/rekankerja/time-attendance/components/attendance-workoff";
import { AttendanceHolidaysPage } from "@/rekankerja/time-attendance/components/attendance-holidays";
// Task 27-a/e/g — import mesin, liveboard, tukar shift (terimplementasi)
import { AttendanceLiveboardPage } from "@/rekankerja/time-attendance/components/attendance-liveboard";
import { AttendanceShiftSwapPage } from "@/rekankerja/time-attendance/components/attendance-shift-swap";
import { AttendanceMachineImportPage } from "@/rekankerja/time-attendance/components/attendance-machine-import";
// Task 100 F1 (impl-E) — open shift marketplace (G19) + kios QR (G17)
import { AttendanceOpenShiftPage } from "@/rekankerja/time-attendance/components/attendance-open-shift";
import { AttendanceKioskPage } from "@/rekankerja/time-attendance/components/attendance-kiosk";
// T12-REPORTS — laporan attendance agregat (padanan Laporan HR)
import { AttendanceReportsPage } from "@/rekankerja/time-attendance/components/attendance-reports";

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
    // Task 100 F1 (impl-E) — G19 open shift marketplace + G17 kios QR
    case "open-shift": return <AttendanceOpenShiftPage />;
    case "kiosk-qr": return <AttendanceKioskPage />;
    // T12-REPORTS — laporan attendance (menu attendance:reports)
    case "reports": return <AttendanceReportsPage />;
    default: return <AttendanceOverview />;
  }
}
