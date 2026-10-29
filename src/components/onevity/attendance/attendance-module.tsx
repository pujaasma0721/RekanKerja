"use client";
// OneVity — Modul Attendance: router view (padanan Time Attendance oranHR)
import { AttendanceOverview } from "@/components/onevity/attendance/attendance-overview";
import { AttendanceTemplatesPage } from "@/components/onevity/attendance/attendance-templates";
import { AttendanceAssignmentsPage } from "@/components/onevity/attendance/attendance-assignments";
import { AttendanceMatrixPage } from "@/components/onevity/attendance/attendance-matrix";
import { AttendanceClockingPage } from "@/components/onevity/attendance/attendance-clocking";
import { AttendanceAbsencePage } from "@/components/onevity/attendance/attendance-absence";
import { AttendanceOvertimePage } from "@/components/onevity/attendance/attendance-overtime";
import { AttendanceWorkoffPage } from "@/components/onevity/attendance/attendance-workoff";

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
