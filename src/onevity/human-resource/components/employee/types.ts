"use client";
// OneVity — Employee module shared types (strict API response interfaces)

// ============ directory (/api/onevity/employees) ============
export interface EmployeeRow {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  email: string | null;
  phone: string | null;
  photoUrl?: string | null;
  employmentStatus: string;
  joinDate: string;
  endDate: string | null;
  baseSalary: number;
  status: string;
  // 26-b — PKWT PP 35/2021 (badge masa kontrak + filter jatuh tempo)
  contractStart: string | null;
  contractEnd: string | null;
  renewalCount: number;
  position: { title: string; code: string } | null;
  orgUnit: { name: string; code: string } | null;
  grade: { code: string; name: string } | null;
}

export interface DirectoryResp {
  employees: EmployeeRow[];
  total: number;
  limit: number;
  offset: number;
  stats: {
    total: number;
    active: number;
    probation: number;
    contract: number;
    inactive: number;
    /** 26-b — PKWT: jumlah Active dengan contractEnd ≤ band (30/60/90 hari). */
    contract30: number;
    contract60: number;
    contract90: number;
  };
}

// ============ detail (/api/onevity/employee-detail) ============
export interface RefName {
  id: string;
  code: string;
  name: string;
  level?: number | null;
}

export interface GradeRef {
  id: string;
  code: string;
  name: string;
  minSalary: number;
  maxSalary: number;
}

export interface ManagerRef {
  id: string;
  fullName: string;
  employeeNo: string;
  position: { title: string } | null;
}

export interface DirectReportRef {
  id: string;
  fullName: string;
  employeeNo: string;
  photoUrl?: string | null;
  employmentStatus: string;
  status: string;
  position: { title: string } | null;
}

export interface FamilyRow {
  id: string;
  employeeId: string;
  relation: string;
  name: string;
  gender: string;
  birthDate: string | null;
  occupation: string | null;
  isDependent: boolean;
}

export interface EducationRow {
  id: string;
  employeeId: string;
  level: string;
  institution: string;
  major: string | null;
  startYear: number | null;
  endYear: number | null;
  gpa: number | null;
}

export interface ExperienceRow {
  id: string;
  employeeId: string;
  company: string;
  position: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}

export interface DisciplinaryRow {
  id: string;
  employeeId: string;
  warningLevel: string;
  violation: string;
  sanction: string | null;
  issuedAt: string;
  expiresAt: string | null;
  notes: string | null;
  employee?: {
    id: string;
    fullName: string;
    employeeNo: string;
    status: string;
    position: { title: string } | null;
    orgUnit: { name: string } | null;
  } | null;
}

export interface EmployeeDetail {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  birthPlace: string | null;
  birthDate: string | null;
  nationalId: string | null;
  taxId: string | null;
  bpjsHealth: string | null;
  bpjsEmpSkill: string | null;
  maritalStatus: string | null;
  religion: string | null;
  bloodType: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  photoUrl: string | null;
  bankName: string | null;
  bankAccount: string | null;
  companyId: string;
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  /** snapshot parameter penempatan (Task 25) — dimensi mesin approval berjenjang */
  companyOfficeId?: string | null;
  workLocationId?: string | null;
  positionLevelId?: string | null;
  employmentStatus: string;
  joinDate: string;
  endDate: string | null;
  managerId: string | null;
  baseSalary: number;
  workShift: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  company: { id: string; code: string; name: string; shortName: string } | null;
  orgUnit: RefName | null;
  position: { id: string; code: string; title: string; level: string | null } | null;
  grade: GradeRef | null;
  /** referensi penempatan berjenjang (Task 25) — dikirim flatten bila tersedia */
  companyOffice?: { code: string; name: string; city: string | null } | null;
  workLocation?: { code: string; name: string; city: string | null } | null;
  positionLevel?: { code: string; name: string } | null;
  manager: ManagerRef | null;
  directReports: DirectReportRef[];
  family: FamilyRow[];
  education: EducationRow[];
  experiences: ExperienceRow[];
  disciplinary: DisciplinaryRow[];
  orgUnitPath: string[];
}

export interface EmployeeDetailResp {
  employee: EmployeeDetail;
}

// ============ options (/api/onevity/employee-options) ============
export interface OptionUnit {
  id: string;
  code: string;
  name: string;
  level: number;
  parentId: string | null;
}

export interface OptionPosition {
  id: string;
  code: string;
  title: string;
  orgUnitId: string | null;
  gradeId: string | null;
}

export interface OptionGrade {
  id: string;
  code: string;
  name: string;
  minSalary: number;
  maxSalary: number;
}

export interface EmployeeOptions {
  orgUnits: OptionUnit[];
  positions: OptionPosition[];
  grades: OptionGrade[];
  managers: ManagerRef[];
}

// ============ org units lite (/api/onevity/org-units) ============
export interface OrgUnitsLiteResp {
  units: { id: string; code: string; name: string; level: number }[];
}

// ============ shared label maps ============
// (Task I-1 i18n) map EN paralel — render: t(MAP[k], MAP_EN[k]); nilai k tetap dikirim ke server.
export const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  Permanent: "Tetap",
  Probation: "Probation",
  Contract: "Kontrak",
  Outsourcing: "Outsourcing",
};

export const EMPLOYMENT_STATUS_LABEL_EN: Record<string, string> = {
  Permanent: "Permanent",
  Probation: "Probation",
  Contract: "Contract",
  Outsourcing: "Outsourcing",
};

export const EMPLOYMENT_STATUS_CLS: Record<string, string> = {
  Permanent: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  Probation: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  Contract: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  Outsourcing: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
};

export const RELATION_LABEL: Record<string, string> = {
  Spouse: "Pasangan",
  Child: "Anak",
  Parent: "Orang Tua",
  Sibling: "Saudara",
};

export const RELATION_LABEL_EN: Record<string, string> = {
  Spouse: "Spouse",
  Child: "Child",
  Parent: "Parent",
  Sibling: "Sibling",
};

export const WARNING_LEVEL_META: Record<string, { label: string; cls: string; bar: string }> = {
  Verbal: {
    label: "Peringatan Verbal",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    bar: "bg-amber-400",
  },
  Written: {
    label: "Surat Peringatan",
    cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
    bar: "bg-orange-500",
  },
  Final: {
    label: "Peringatan Akhir",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    bar: "bg-rose-500",
  },
};

export const WARNING_LEVEL_LABEL_EN: Record<string, string> = {
  Verbal: "Verbal Warning",
  Written: "Written Warning",
  Final: "Final Warning",
};

export const RELIGIONS = ["Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Konghucu"] as const;
export const MARITAL_STATUSES = ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"] as const;
export const BLOOD_TYPES = ["A", "B", "AB", "O"] as const;
export const BANKS = ["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "BTN", "Danamon", "Maybank"] as const;
export const WORK_SHIFTS = ["Regular", "Shift Pagi", "Shift Siang", "Shift Malam"] as const;
export const EDUCATION_LEVELS = ["SMA", "SMK", "D3", "S1", "S2", "S3"] as const;
export const RELATIONS = ["Spouse", "Child", "Parent", "Sibling"] as const;
export const WARNING_LEVELS = ["Verbal", "Written", "Final"] as const;

// label EN paralel untuk array opsi (nilai array = nilai yang disimpan server)
export const RELIGIONS_EN: Record<string, string> = {
  Islam: "Islam",
  "Kristen Protestan": "Protestant",
  Katolik: "Catholic",
  Hindu: "Hindu",
  Buddha: "Buddhist",
  Konghucu: "Confucian",
};
export const MARITAL_STATUSES_EN: Record<string, string> = {
  "Belum Menikah": "Single",
  Menikah: "Married",
  Cerai: "Divorced",
  "Janda/Duda": "Widowed",
};
export const WORK_SHIFTS_EN: Record<string, string> = {
  Regular: "Regular",
  "Shift Pagi": "Morning Shift",
  "Shift Siang": "Day Shift",
  "Shift Malam": "Night Shift",
};

export const employmentStatusBadge = (s: string) =>
  EMPLOYMENT_STATUS_CLS[s] ?? "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25";
