// OneVity — PKWT PP 35/2021: helper aritmetika kontrak (26-b P0) ============
// =====================================================================
// Pelacakan Perjanjian Kerja Waktu Tertentu:
//   · contractStart = tanggal mulai PKWT PERTAMA (tidak digeser saat
//     perpanjangan — basis hitung total durasi).
//   · contractEnd   = akhir kontrak berjalan (null = tanpa batas / PKS).
//   · renewalCount  = jumlah perpanjangan (generasi kontrak − 1).
// Guard Pasal 8 PP 35/2021: PKWT + seluruh perpanjangannya maksimal 5 tahun
// — lebih dari itu WAJIB ditawarkan konversi ke PKS (Perjanjian Kerja
// Selama Waktu Tidak Tertentu). Warning edukatif (non-bloking), tetapi
// ditampilkan mencolok (banner merah) di profil karyawan.

export interface PkwtEmployeeInput {
  status: string; // Employee.status (Active/…)
  employmentStatus: string | null; // assignment aktif (Contract/Probation/…)
  joinDate: Date | string;
  contractStart: Date | string | null;
  contractEnd: Date | string | null;
  renewalCount: number;
}

export interface PkwtInfo {
  /** true bila karyawan berstatus PKWT (Contract/Probation/Outsourcing). */
  isPkwt: boolean;
  /** sisa hari sampai contractEnd (null bila tanpa tanggal akhir; negatif = lewat). */
  daysRemaining: number | null;
  /** total durasi kontrak (bulan, dari contractStart pertama → contractEnd). */
  totalMonths: number | null;
  /** total durasi > 5 tahun → wajib konversi ke PKS (Pasal 8). */
  over5y: boolean;
  /** kategori urgensi akhir kontrak: overdue | critical (≤7 hr) | soon (≤30) | watch (≤60) | later. */
  due: "overdue" | "critical" | "soon" | "watch" | "later" | null;
  renewals: number;
  start: string | null;
  end: string | null;
}

const DAY_MS = 86_400_000;

/** Bulan penuh antara dua tanggal (pembulatan ke bawah). */
export function monthsBetween(a: Date, b: Date): number {
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return months;
}

const PKWT_STATUSES = new Set(["Contract", "Probation", "Outsourcing"]);

/**
 * Hitung info PKWT satu karyawan (murni, tanpa IO) — dipakai API
 * employee-detail (guard profil) + UI directory (badge masa kontrak).
 */
export function computePkwtInfo(emp: PkwtEmployeeInput): PkwtInfo {
  const isPkwt = PKWT_STATUSES.has(emp.employmentStatus ?? "");
  const start = emp.contractStart != null ? new Date(emp.contractStart) : null;
  const end = emp.contractEnd != null ? new Date(emp.contractEnd) : null;

  let daysRemaining: number | null = null;
  if (end != null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const e = new Date(end);
    e.setHours(0, 0, 0, 0);
    daysRemaining = Math.round((e.getTime() - today.getTime()) / DAY_MS);
  }

  // durasi total: contractStart pertama → contractEnd; fallback mulai = joinDate
  const startRef = start ?? (isPkwt ? new Date(emp.joinDate) : null);
  const totalMonths = startRef != null && end != null ? Math.max(0, monthsBetween(startRef, end)) : null;
  const over5y = totalMonths != null && totalMonths > 60;

  let due: PkwtInfo["due"] = null;
  if (isPkwt && daysRemaining != null) {
    if (daysRemaining < 0) due = "overdue";
    else if (daysRemaining <= 7) due = "critical";
    else if (daysRemaining <= 30) due = "soon";
    else if (daysRemaining <= 60) due = "watch";
    else due = "later";
  }

  return {
    isPkwt,
    daysRemaining,
    totalMonths,
    over5y,
    due,
    renewals: emp.renewalCount ?? 0,
    start: start != null ? start.toISOString() : null,
    end: end != null ? end.toISOString() : null,
  };
}

/** Label durasi bulan → "X tahun Y bulan" / "Y bulan" (t() dipanggil pemanggil UI). */
export function pkwtDurationLabel(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years <= 0) return `${months} bulan`;
  if (months === 0) return `${years} tahun`;
  return `${years} tahun ${months} bulan`;
}
