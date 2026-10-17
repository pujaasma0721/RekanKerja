// SB-RC-RD — definisi parameter awal per laporan Recruitment ==============
// Mirror pola HR/Leave/Attendance report-documents/params.ts (T110–T113).
// Jenis field:
//  - select : dropdown satu-pilih (opsi dari ?id=_params: office/prStatus/
//             offerStatus/applicantStatus)
//  - year   : input tahun (opsi dari ?id=_params: years)
//  - date   : input tanggal YYYY-MM-DD dipakai berpasangan from/to
export type ParamKind =
  | "office" | "prStatus" | "offerStatus" | "applicantStatus" | "year" | "from" | "to";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "year" | "date";
  optionsFrom?: "offices" | "prStatuses" | "offerStatuses" | "applicantStatuses" | "years";
  hintId?: string;
  hintEn?: string;
};

// ---------- field dasar ----------

const F_OFFICE: ParamField = { key: "office", labelId: "Cabang / Kantor", labelEn: "Branch / Office", type: "select", optionsFrom: "offices" };
const F_PRSTATUS: ParamField = { key: "prStatus", labelId: "Status Permintaan", labelEn: "Requisition Status", type: "select", optionsFrom: "prStatuses" };
const F_OFFERSTATUS: ParamField = { key: "offerStatus", labelId: "Status Offer", labelEn: "Offer Status", type: "select", optionsFrom: "offerStatuses" };
const F_APPSTATUS: ParamField = {
  key: "applicantStatus", labelId: "Status Pelamar", labelEn: "Applicant Status", type: "select", optionsFrom: "applicantStatuses",
  hintId: "Status baris talent pool (bukan hasil seleksi).", hintEn: "Talent-pool row status (not the selection outcome).",
};
const F_YEAR: ParamField = { key: "year", labelId: "Tahun Data", labelEn: "Data Year", type: "year", optionsFrom: "years" };
const F_FROM: ParamField = { key: "from", labelId: "Dari Tanggal", labelEn: "From Date", type: "date" };
const F_TO: ParamField = { key: "to", labelId: "Sampai Tanggal", labelEn: "To Date", type: "date" };

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Rencana & Permintaan Karyawan
  rc11: [F_YEAR, F_OFFICE],
  rc12: [F_FROM, F_TO, F_OFFICE, F_PRSTATUS],
  rc13: [F_FROM, F_TO, F_OFFICE],
  // Grup 2 — Lowongan & Sumber Pelamar
  rc21: [F_FROM, F_TO, F_OFFICE],
  rc22: [F_FROM, F_TO],
  rc23: [F_FROM, F_TO, F_APPSTATUS],
  // Grup 3 — Seleksi & Penilaian
  rc31: [F_FROM, F_TO],
  rc32: [F_FROM, F_TO],
  rc33: [F_FROM, F_TO],
  // Grup 4 — Offer, Pengangkatan & Biaya
  rc41: [F_FROM, F_TO, F_OFFERSTATUS],
  rc42: [F_FROM, F_TO, F_OFFICE],
  rc43: [F_YEAR, F_OFFICE],
};

// ---------- util nilai & query ----------

export type ParamValues = Record<string, string>;

/** Nilai bawaan saat laporan dipilih: periode = bulan/hari berjalan, cakupan = semua. */
export function defaultsFor(reportId: string): ParamValues {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const v: ParamValues = {};
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    if (f.type === "year") {
      v[f.key] = String(now.getFullYear());
    } else if (f.key === "from") {
      v[f.key] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    } else if (f.key === "to") {
      v[f.key] = today;
    } else {
      v[f.key] = ""; // select (Semua ...)
    }
  }
  return v;
}

/** Query string dari nilai form — hanya parameter terisi yang dikirim. */
export function buildQuery(reportId: string, values: ParamValues): string {
  const fields = REPORT_PARAMS[reportId] ?? [];
  const parts = [`id=${reportId}`];
  for (const f of fields) {
    const val = (values[f.key] ?? "").trim();
    if (val) parts.push(`${f.key}=${encodeURIComponent(val)}`);
  }
  return parts.join("&");
}

/** Ringkasan parameter terpasang utk chip pratinjau (label pendek). */
export function summarizeParams(reportId: string, values: ParamValues, optionLabel: (field: ParamField, id: string) => string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    const raw = (values[f.key] ?? "").trim();
    if (!raw) continue;
    if (f.type === "date") {
      out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${dateLabelOf(raw)}` });
    } else {
      out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${optionLabel(f, raw)}` });
    }
  }
  return out;
}

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export const monthLabelOf = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_ID[m - 1] ?? m} ${y}`;
};

const dateLabelOf = (d: string): string => {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};
