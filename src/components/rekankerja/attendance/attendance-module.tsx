"use client";
// RekanKerja — Modul Attendance: router view (padanan Time Attendance oranHR)
import { AttendanceOverview } from "@/components/rekankerja/attendance/attendance-overview";
import { AttendanceTemplatesPage } from "@/components/rekankerja/attendance/attendance-templates";
import { AttendanceAssignmentsPage } from "@/components/rekankerja/attendance/attendance-assignments";
import { AttendanceMatrixPage } from "@/components/rekankerja/attendance/attendance-matrix";
import { AttendanceClockingPage } from "@/components/rekankerja/attendance/attendance-clocking";
import { AttendanceAbsencePage } from "@/components/rekankerja/attendance/attendance-absence";
import { AttendanceOvertimePage } from "@/components/rekankerja/attendance/attendance-overtime";
import { AttendanceWorkoffPage } from "@/components/rekankerja/attendance/attendance-workoff";

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
