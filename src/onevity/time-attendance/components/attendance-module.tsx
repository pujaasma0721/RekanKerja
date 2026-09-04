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

export function AttendanceModule({ view }: { view: string }) {
  switch (view) {
    case "templates-schedule": return <AttendanceTemplatesPage />;
    case "assignment-schedule": return <AttendanceAssignmentsPage />;
    case "matrix": return <AttendanceMatrixPage />;
    case "clocking": return <AttendanceClockingPage />;
    case "absence": return <AttendanceAbsencePage />;
    case "overtime": return <AttendanceOvertimePage />;
    case "workoff": return <AttendanceWorkoffPage />;
    default: return <AttendanceOverview />;
  }
}
