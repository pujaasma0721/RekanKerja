// T-MED-REPORTS — definisi parameter awal per laporan Medical (sebelum generate)
// Mirror pola leave/report-documents/params.ts (T112). Jenis field:
//  - select : dropdown satu-pilih (opsi dari ?id=_params: office/unit/benefitType/status/year)
//  - month  : input bulan YYYY-MM
//  - date   : input tanggal YYYY-MM-DD (dipakai berpasangan from/to)
export type ParamKind =
  | "office" | "unit" | "benefitType" | "status" | "month" | "year" | "from" | "to";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "month" | "year" | "date";
  optionsFrom?: "offices" | "units" | "benefitTypes" | "statuses" | "years";
  hintId?: string;
  hintEn?: string;
};

// ---------- field dasar ----------

const F_OFFICE: ParamField = { key: "office", labelId: "Cabang / Kantor", labelEn: "Branch / Office", type: "select", optionsFrom: "offices" };
const F_UNIT: ParamField = { key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit", type: "select", optionsFrom: "units" };
const F_TYPE: ParamField = { key: "benefitType", labelId: "Jenis Benefit Medis", labelEn: "Medical Benefit Type", type: "select", optionsFrom: "benefitTypes" };
const F_STATUS: ParamField = { key: "status", labelId: "Status Klaim", labelEn: "Claim Status", type: "select", optionsFrom: "statuses" };
const F_MONTH: ParamField = { key: "month", labelId: "Bulan Data", labelEn: "Data Month", type: "month" };
const F_YEAR: ParamField = { key: "year", labelId: "Tahun Buku", labelEn: "Benefit Year", type: "year", optionsFrom: "years" };
const F_FROM: ParamField = { key: "from", labelId: "Dari Tanggal", labelEn: "From Date", type: "date" };
const F_TO: ParamField = { key: "to", labelId: "Sampai Tanggal", labelEn: "To Date", type: "date" };

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Saldo & Plafon (laporan saldo tahun buku)
  mr11: [F_YEAR, F_TYPE, F_OFFICE, F_UNIT],
  mr12: [F_YEAR, F_TYPE, F_OFFICE, F_UNIT],
  mr13: [F_YEAR, F_OFFICE, F_UNIT],
  // Grup 2 — Transaksi & Rekapitulasi Klaim
  mr21: [F_FROM, F_TO, F_TYPE, F_STATUS, F_OFFICE, F_UNIT],
  mr22: [F_TYPE, F_OFFICE, F_UNIT],
  mr23: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 3 — Analisis Biaya & Utilisasi
  mr31: [F_YEAR, F_OFFICE, F_UNIT],
  mr32: [F_YEAR, F_OFFICE, F_UNIT],
  mr33: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 4 — Rekonsiliasi Asuransi & Kepatuhan
  mr41: [F_YEAR, F_OFFICE, F_UNIT],
  mr42: [F_YEAR, F_OFFICE, F_UNIT],
  mr43: [F_FROM, F_TO, F_TYPE, F_OFFICE, F_UNIT],
};

// ---------- util nilai & query ----------

export type ParamValues = Record<string, string>;

/** Nilai bawaan saat laporan dipilih: periode = periode berjalan, cakupan = semua. */
export function defaultsFor(reportId: string): ParamValues {
  const now = new Date();
  const v: ParamValues = {};
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    if (f.type === "month") {
      v[f.key] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    } else if (f.type === "year") {
      v[f.key] = String(now.getFullYear());
    } else if (f.key === "from") {
      v[f.key] = `${now.getFullYear()}-01-01`;
    } else if (f.key === "to") {
      v[f.key] = now.toISOString().slice(0, 10);
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
    out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${optionLabel(f, raw)}` });
  }
  return out;
}
