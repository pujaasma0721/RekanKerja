"use client";
// Shared types for RekanKerja Organisasi module (org-units, company, employees-by-unit)

export interface OrgUnitLite {
  id: string;
  code: string;
  name: string;
}

export interface OrgUnitNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  companyId: string;
  level: number;
  headcountBudget: number;
  active: boolean;
  createdAt: string;
  parent?: OrgUnitLite | null;
  _count: { employees: number; positions: number; children: number };
  children?: OrgUnitNode[];
}

export interface OrgUnitsRes {
  units: OrgUnitNode[];
}

export interface OrgTreeRes {
  tree: OrgUnitNode[];
}

export interface CompanyData {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  currency: string;
  active: boolean;
  createdAt: string;
}

export interface CompanyRes {
  company: CompanyData;
  stats: { activeEmployees: number; orgUnits: number; activePositions: number };
}

export interface EmployeeBrief {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  status: string;
  employmentStatus: string;
  joinDate: string;
  position: { code: string; title: string } | null;
  orgUnit: { code: string; name: string } | null;
  grade: { code: string; name: string } | null;
}

export interface EmployeesRes {
  employees: EmployeeBrief[];
  total: number;
}

// level metadata (icon + label) shared across tree & chart views
export const LEVEL_META: Record<number, { label: string; icon: string }> = {
  1: { label: "Kantor CEO", icon: "crown" },
  2: { label: "Manajemen", icon: "landmark" },
  3: { label: "Divisi", icon: "building" },
  4: { label: "Sub-Unit", icon: "network" },
};

export function levelLabel(level: number): string {
  return LEVEL_META[level]?.label ?? `Level ${level}`;
}
