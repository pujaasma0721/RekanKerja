// RekanKerja Payroll — MATRIKS PARAMETER PER LAPORAN ========================
// Deskripsi field parameter tiap laporan (dipakai ReportParamsForm + builder
// query). Konvensi: Radix SelectItem dilarang value="" → sentinel "all"
// (kebijakan codebase, lihat attendance-liveboard / medical-claims).
import type { ReportId } from "./catalog";

export type ParamKind = "run" | "period" | "year" | "employee-by-run" | "employee-by-year" | "bank" | "units";

export interface ParamDef {
  kind: ParamKind;
  labelId: string;
  labelEn: string;
  required: boolean;
  hint?: string;
}

export const PARAM_MATRIX: Record<ReportId, ParamDef[]> = {
  r11: [
    { kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true },
    { kind: "employee-by-run", labelId: "Karyawan", labelEn: "Employee", required: true },
  ],
  r12: [
    { kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true },
    { kind: "units", labelId: "Unit Kerja (opsional)", labelEn: "Org Unit (optional)", required: false },
  ],
  r13: [
    { kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true },
    { kind: "bank", labelId: "Bank", labelEn: "Bank", required: false },
    { kind: "units", labelId: "Unit Kerja (opsional)", labelEn: "Org Unit (optional)", required: false },
  ],
  r21: [
    { kind: "period", labelId: "Periode (masa pajak)", labelEn: "Period (tax month)", required: true },
    { kind: "units", labelId: "Unit Kerja (opsional)", labelEn: "Org Unit (optional)", required: false },
  ],
  r22: [
    { kind: "year", labelId: "Tahun Pajak", labelEn: "Tax Year", required: true },
    { kind: "employee-by-year", labelId: "Karyawan", labelEn: "Employee", required: true },
  ],
  r23: [{ kind: "period", labelId: "Periode (masa pajak)", labelEn: "Period (tax month)", required: true }],
  r31: [
    { kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true },
    { kind: "units", labelId: "Unit Kerja (opsional)", labelEn: "Org Unit (optional)", required: false },
  ],
  r32: [{ kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true }],
  r33: [{ kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true }],
  r41: [{ kind: "period", labelId: "Periode Berjalan", labelEn: "Current Period", required: true }],
  r42: [{ kind: "period", labelId: "Periode", labelEn: "Period", required: true }],
  r43: [{ kind: "run", labelId: "Run Payroll", labelEn: "Payroll Run", required: true }],
};

// ================= TIPE POOL & PAYLOAD (kontrak API) =====================

export interface RunOpt {
  id: string; runNo: string; status: string;
  periodId: string; periodName: string; periodCode: string;
  sptMonth: number; sptYear: number;
  processTypeName: string; employeeCount: number;
  paidAt: string | null; confirmedAt: string | null;
}
export interface PeriodOpt {
  id: string; name: string; code: string; sptMonth: number; sptYear: number;
  status: string; runCount: number;
}
export interface Pools {
  runs: RunOpt[];
  periods: PeriodOpt[];
  orgUnits: { name: string; count: number }[];
  banks: { name: string }[];
  years: number[];
}
export interface EmployeeOpt {
  lineId?: string; employeeId?: string;
  employeeNo: string; name: string; unit?: string | null;
}

export interface DocCompany {
  name: string | null; code: string | null; taxId: string | null;
  address: string | null; city: string | null; phone: string | null; email: string | null;
}
export interface DocMeta {
  company: DocCompany | null;
  run?: RunOpt & { processTypeName: string; calculatedAt?: string | null };
  period?: { id: string; name: string; code: string; sptMonth?: number; sptYear?: number; status?: string };
  officer: { name: string; printedAt: string };
  filters?: Record<string, unknown>;
}
