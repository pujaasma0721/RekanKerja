"use client";
// Shared types + helpers for Personnel Action module
import { fmtIDR, fmtDate } from "@/lib/onevity/api";

export interface LayerApprover {
  id: string;
  fullName: string;
  username: string;
  role: string;
}

export interface PALayer {
  id: string;
  layerNo: number;
  approverRole: string;
  approverId: string | null;
  status: string; // Pending|Approved|Rejected
  note: string | null;
  decidedAt: string | null;
  approver?: LayerApprover | null;
}

export interface PAEmployee {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  photoUrl: string | null;
  email: string | null;
  employmentStatus: string;
  status: string;
  baseSalary: number;
  joinDate: string;
  endDate: string | null;
  workShift: string;
  position: { id: string; code: string; title: string } | null;
  orgUnit: { id: string; code: string; name: string } | null;
  grade: { id: string; code: string; name: string } | null;
  company: { name: string; shortName: string } | null;
}

export interface PAShort {
  id: string;
  docNo: string;
  employeeId: string;
  type: string;
  effectiveDate: string;
  reason: string | null;
  detailJson: string | null;
  status: string;
  currentLayer: number;
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  processedAt: string | null;
  employee: {
    id: string;
    employeeNo: string;
    fullName: string;
    photoUrl: string | null;
    position: { title: string; code: string } | null;
    orgUnit: { name: string; code: string } | null;
    grade: { code: string } | null;
  };
  layers: PALayer[];
}

export interface PAActivity {
  id: string;
  action: string;
  entity: string;
  detail: string | null;
  createdAt: string;
  appUser?: { fullName: string; username: string; role: string } | null;
}

export interface PADetail {
  id: string;
  docNo: string;
  employeeId: string;
  type: string;
  effectiveDate: string;
  reason: string | null;
  detailJson: string | null;
  status: string;
  currentLayer: number;
  createdBy: string | null;
  createdAt: string;
  submittedAt: string | null;
  processedAt: string | null;
  employee: PAEmployee;
  layers: PALayer[];
  activities: PAActivity[];
}

export interface ActingUser {
  id: string;
  fullName: string;
  username: string;
  role: string;
}

export interface PAListResp {
  actions: PAShort[];
  counts: Record<string, number>;
  total: number;
  actingUser: ActingUser | null;
}

export interface PADetailResp {
  action: PADetail;
  actingUser: ActingUser | null;
  canAct: boolean;
}

// ---------- detail payload rendering ----------
export const DETAIL_LABELS: Record<string, string> = {
  fromPosition: "Posisi Lama",
  toPosition: "Posisi Baru",
  plannedPosition: "Posisi Direncanakan",
  newGrade: "Grade Baru",
  oldSalary: "Gaji Pokok Lama",
  newSalary: "Gaji Pokok Baru",
  plannedSalary: "Gaji Direncanakan",
  lastDay: "Hari Kerja Terakhir",
  months: "Durasi (bulan)",
  newEndDate: "Tanggal Berakhir Baru",
  fromUnit: "Unit Lama",
  toUnit: "Unit Baru",
  newUnit: "Unit Baru",
  newEmploymentStatus: "Status Kepegawaian Baru",
  percent: "Persentase Kenaikan",
};

export function parseDetail(detailJson: string | null): Record<string, unknown> {
  if (!detailJson) return {};
  try {
    const d = JSON.parse(detailJson) as Record<string, unknown>;
    return typeof d === "object" && d !== null ? d : {};
  } catch {
    return {};
  }
}

// pretty value for a detail field
export function detailValue(key: string, v: unknown): string {
  if (v == null) return "—";
  if (key.toLowerCase().includes("salary")) return fmtIDR(Number(v));
  if (key === "percent") return `${Number(v).toFixed(1)}%`;
  if (key === "lastDay" || key === "newEndDate" || key === "effectiveDate") return fmtDate(String(v));
  return String(v);
}

// side-effect description shown before "Proses Sekarang"
export function processEffectSummary(pa: PADetail): string[] {
  const d = parseDetail(pa.detailJson);
  const out: string[] = [];
  switch (pa.type) {
    case "Promotion":
    case "Demotion":
      if (d.toPosition) out.push(`Posisi karyawan dipindahkan ke ${d.toPosition}`);
      if (d.newGrade) out.push(`Grade diubah menjadi ${d.newGrade}`);
      if (d.newSalary != null) out.push(`Gaji pokok diubah menjadi ${fmtIDR(Number(d.newSalary))}`);
      break;
    case "Transfer":
    case "Mutation":
      if (d.toUnit) out.push(`Unit organisasi dipindahkan ke ${d.toUnit}`);
      if (d.toPosition) out.push(`Posisi diubah menjadi ${d.toPosition}`);
      if (d.newSalary != null) out.push(`Gaji pokok diubah menjadi ${fmtIDR(Number(d.newSalary))}`);
      break;
    case "SalaryAdjustment":
      out.push(`Gaji pokok diubah menjadi ${d.newSalary != null ? fmtIDR(Number(d.newSalary)) : "—"}`);
      break;
    case "Resignation":
      out.push(`Status karyawan menjadi Resigned, tanggal akhir ${d.lastDay ? fmtDate(String(d.lastDay)) : fmtDate(pa.effectiveDate)}`);
      break;
    case "Termination":
      out.push(`Status karyawan menjadi Terminated, tanggal akhir ${d.lastDay ? fmtDate(String(d.lastDay)) : fmtDate(pa.effectiveDate)}`);
      break;
    case "Retirement":
      out.push("Pensiun — status karyawan menjadi Resigned dengan tanggal akhir kerja");
      break;
    case "Hire":
      out.push("Data karyawan terhubung dengan dokumen rekrutmen (tanpa perubahan data)");
      break;
    case "ChangeStatus":
      out.push(`Status kepegawaian diubah menjadi ${d.newEmploymentStatus ?? "—"}`);
      break;
    case "ContractRenewal":
      out.push(`Kontrak diperpanjang ${d.months ?? "—"} bulan — tercatat sebagai catatan saja`);
      break;
    case "ExtendProbation":
      out.push(`Masa probation diperpanjang ${d.months ?? "—"} bulan — tercatat sebagai catatan saja`);
      break;
    default:
      out.push("Perubahan data karyawan sesuai detail dokumen");
  }
  return out;
}
