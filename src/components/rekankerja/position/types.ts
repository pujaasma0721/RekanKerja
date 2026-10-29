"use client";
// Shared types for RekanKerja Posisi module (positions, jobs, grades, org-unit lite)

export interface OrgUnitLite {
  id: string;
  code: string;
  name: string;
  level: number;
}

export interface OrgUnitsLiteRes {
  units: OrgUnitLite[];
}

export interface EmployeeOnPosition {
  id: string;
  employeeNo: string;
  fullName: string;
  status: string;
}

export interface PositionRow {
  id: string;
  code: string;
  title: string;
  jobId: string | null;
  orgUnitId: string | null;
  gradeId: string | null;
  level: string | null;
  headcount: number;
  filled: number;
  reportsToId: string | null;
  active: boolean;
  createdAt: string;
  job: { id: string; code: string; title: string; category: string | null } | null;
  orgUnit: { id: string; code: string; name: string } | null;
  grade: { id: string; code: string; name: string; minSalary: number; maxSalary: number } | null;
  reportsTo: { id: string; code: string; title: string } | null;
  employees: EmployeeOnPosition[];
  _count: { employees: number };
}

export interface PositionsRes {
  positions: PositionRow[];
  total: number;
}

export interface JobRow {
  id: string;
  code: string;
  title: string;
  category: string | null;
  description: string | null;
  active: boolean;
  createdAt: string;
  _count: { positions: number };
}

export interface JobsRes {
  jobs: JobRow[];
}

export interface GradeRow {
  id: string;
  code: string;
  name: string;
  minSalary: number;
  maxSalary: number;
  sortOrder: number;
  active: boolean;
  _count: { employees: number; positions: number };
}

export interface GradesRes {
  grades: GradeRow[];
}

export const JOB_CATEGORIES = ["Executive", "Managerial", "Supervisory", "Staff"] as const;

export function jobCategoryIcon(category: string | null): { icon: string; cls: string; label: string } {
  switch (category) {
    case "Executive":
      return { icon: "crown", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", label: "Executive" };
    case "Managerial":
      return { icon: "briefcase", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400", label: "Managerial" };
    case "Supervisory":
      return { icon: "user-cog", cls: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400", label: "Supervisory" };
    default:
      return { icon: "user", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", label: category ?? "Staff" };
  }
}
