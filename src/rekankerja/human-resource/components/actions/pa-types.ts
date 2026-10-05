"use client";
// Shared types + helpers for Personnel Action module
import { fmtIDR, fmtDate } from "@/rekankerja/shared/lib/api";
import { translate, currentLocale } from "@/rekankerja/shared/lib/i18n-core";

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
  pesangonMultiplier: "Faktor UPMK Pesangon",
  uangPisahPct: "Uang Pisah (% pesangon)",
  includeBonusProRata: "Bonus Pro-rata (penggantian hak)",
};

// En paralel untuk DETAIL_LABELS di atas (map ID dipertahankan; render t(MAP[k], MAP_EN[k]) — Task I-3)
export const DETAIL_LABELS_EN: Record<string, string> = {
  fromPosition: "Previous Position",
  toPosition: "New Position",
  plannedPosition: "Planned Position",
  newGrade: "New Grade",
  oldSalary: "Previous Base Salary",
  newSalary: "New Base Salary",
  plannedSalary: "Planned Salary",
  lastDay: "Last Working Day",
  months: "Duration (months)",
  newEndDate: "New End Date",
  fromUnit: "Previous Unit",
  toUnit: "New Unit",
  newUnit: "New Unit",
  newEmploymentStatus: "New Employment Status",
  percent: "Raise Percentage",
  pesangonMultiplier: "UPMK Severance Factor",
  uangPisahPct: "Separation Pay (% of severance)",
  includeBonusProRata: "Pro-rata Bonus (replacement entitlement)",
};

// En paralel untuk label PA_TYPES (ui-kit, di luar scope I-3) — dipakai render t(v.label, PA_TYPE_LABEL_EN[k])
export const PA_TYPE_LABEL_EN: Record<string, string> = {
  Hire: "Hire", Promotion: "Promotion", Demotion: "Demotion", Transfer: "Transfer",
  Mutation: "Mutation", SalaryAdjustment: "Salary Adjustment", ContractRenewal: "Contract Renewal",
  ChangeStatus: "Status Change", ExtendProbation: "Probation Extension",
  Resignation: "Resignation", Termination: "Termination", Retirement: "Retirement",
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
  if (v == null || v === "" || v === false) return "—";
  if (key.toLowerCase().includes("salary")) return fmtIDR(Number(v));
  if (key === "percent" || key === "uangPisahPct") return `${Number(v).toFixed(0)}%`;
  if (key === "pesangonMultiplier") return `×${Number(v).toLocaleString(currentLocale())}`;
  if (key === "lastDay" || key === "newEndDate" || key === "effectiveDate") return fmtDate(String(v));
  if (key === "includeBonusProRata") return v === true || v === "true" ? "Ya" : "—";
  return String(v);
}

// side-effect description shown before "Proses Sekarang"
export function processEffectSummary(pa: PADetail): string[] {
  const d = parseDetail(pa.detailJson);
  const out: string[] = [];
  switch (pa.type) {
    case "Promotion":
    case "Demotion":
      if (d.toPosition) out.push(translate("Posisi karyawan dipindahkan ke {p}", "Employee position moved to {p}", { p: String(d.toPosition) }));
      if (d.newGrade) out.push(translate("Grade diubah menjadi {g}", "Grade changed to {g}", { g: String(d.newGrade) }));
      if (d.newSalary != null) out.push(translate("Gaji pokok diubah menjadi {s}", "Base salary changed to {s}", { s: fmtIDR(Number(d.newSalary)) }));
      break;
    case "Transfer":
    case "Mutation":
      if (d.toUnit) out.push(translate("Unit organisasi dipindahkan ke {u}", "Organizational unit moved to {u}", { u: String(d.toUnit) }));
      if (d.toPosition) out.push(translate("Posisi diubah menjadi {p}", "Position changed to {p}", { p: String(d.toPosition) }));
      if (d.newSalary != null) out.push(translate("Gaji pokok diubah menjadi {s}", "Base salary changed to {s}", { s: fmtIDR(Number(d.newSalary)) }));
      break;
    case "SalaryAdjustment":
      out.push(translate("Gaji pokok diubah menjadi {s}", "Base salary changed to {s}", { s: d.newSalary != null ? fmtIDR(Number(d.newSalary)) : "—" }));
      break;
    case "Resignation":
      out.push(translate("Status karyawan menjadi Resigned, tanggal akhir {d}", "Employee status becomes Resigned, end date {d}", { d: d.lastDay ? fmtDate(String(d.lastDay)) : fmtDate(pa.effectiveDate) }));
      break;
    case "Termination":
      out.push(translate("Status karyawan menjadi Terminated, tanggal akhir {d}", "Employee status becomes Terminated, end date {d}", { d: d.lastDay ? fmtDate(String(d.lastDay)) : fmtDate(pa.effectiveDate) }));
      out.push(translate("Final settlement PHK dihitung otomatis saat diproses — pesangon UPMK ×{m} + uang pisah {p}% + THR prorata + uang cuti − pinjaman − PPh21 final (komponen payroll TERMINATION)", "Final termination settlement computed automatically upon processing — UPMK severance ×{m} + separation pay {p}% + pro-rata THR + leave pay − loans − final income tax (TERMINATION payroll components)", { m: String(d.pesangonMultiplier ?? 1), p: String(d.uangPisahPct ?? 0) }));
      break;
    case "Retirement":
      out.push(translate("Pensiun — status karyawan menjadi Resigned dengan tanggal akhir kerja", "Retirement — employee status becomes Resigned with a last working date"));
      break;
    case "Hire":
      out.push(translate("Data karyawan terhubung dengan dokumen rekrutmen (tanpa perubahan data)", "Employee data linked to the recruitment document (no data changes)"));
      break;
    case "ChangeStatus":
      out.push(translate("Status kepegawaian diubah menjadi {s}", "Employment status changed to {s}", { s: String(d.newEmploymentStatus ?? "—") }));
      break;
    case "ContractRenewal":
      out.push(translate("Kontrak diperpanjang {n} bulan — tercatat sebagai catatan saja", "Contract extended by {n} months — recorded as a note only", { n: String(d.months ?? "—") }));
      break;
    case "ExtendProbation":
      out.push(translate("Masa probation diperpanjang {n} bulan — tercatat sebagai catatan saja", "Probation extended by {n} months — recorded as a note only", { n: String(d.months ?? "—") }));
      break;
    default:
      out.push(translate("Perubahan data karyawan sesuai detail dokumen", "Employee data changes per document details"));
  }
  return out;
}
