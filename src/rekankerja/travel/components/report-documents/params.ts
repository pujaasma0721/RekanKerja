// T-TRAVEL-REPORTS — definisi parameter awal per laporan Travel (sebelum generate)
// Mirror pola medical/report-documents/params.ts (T-MED-REPORTS) & leave (T112).
// Jenis field:
//  - select     : dropdown satu-pilih (opsi dari ?id=_params: office/unit/template/
//                 expenseType/status/claimStatus/year)
//  - month/date : input bulan YYYY-MM / tanggal YYYY-MM-DD (from/to berpasangan)
export type ParamKind =
  | "office" | "unit" | "template" | "expenseType" | "status" | "claimStatus"
  | "month" | "year" | "from" | "to";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "month" | "year" | "date";
  optionsFrom?: "offices" | "units" | "templates" | "expenseTypes" | "statuses" | "claimStatuses" | "years";
  hintId?: string;
  hintEn?: string;
};

// ---------- field dasar ----------

const F_OFFICE: ParamField = { key: "office", labelId: "Cabang / Kantor", labelEn: "Branch / Office", type: "select", optionsFrom: "offices" };
const F_UNIT: ParamField = { key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit", type: "select", optionsFrom: "units" };
const F_TEMPLATE: ParamField = { key: "template", labelId: "Jenis Perjalanan (Template)", labelEn: "Trip Type (Template)", type: "select", optionsFrom: "templates", hintId: "TRAVEL = umum · LOCAL-150 = harian · KA = kereta · OVERSEAS = luar negeri", hintEn: "TRAVEL = general · LOCAL-150 = day trip · KA = rail · OVERSEAS = abroad" };
const F_EXPTYPE: ParamField = { key: "expenseType", labelId: "Jenis Biaya", labelEn: "Expense Type", type: "select", optionsFrom: "expenseTypes" };
const F_STATUS: ParamField = { key: "status", labelId: "Status Pengajuan", labelEn: "Request Status", type: "select", optionsFrom: "statuses" };
const F_CLAIM_STATUS: ParamField = { key: "claimStatus", labelId: "Status Klaim", labelEn: "Claim Status", type: "select", optionsFrom: "claimStatuses" };
const F_YEAR: ParamField = { key: "year", labelId: "Tahun Buku", labelEn: "Fiscal Year", type: "year", optionsFrom: "years" };
const F_FROM: ParamField = { key: "from", labelId: "Dari Tanggal", labelEn: "From Date", type: "date" };
const F_TO: ParamField = { key: "to", labelId: "Sampai Tanggal", labelEn: "To Date", type: "date" };

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Pengajuan & Validasi Perjalanan Dinas
  tr11: [F_FROM, F_TO, F_TEMPLATE, F_STATUS, F_OFFICE, F_UNIT],
  tr12: [F_FROM, F_TO, F_TEMPLATE, F_STATUS, F_OFFICE, F_UNIT],
  tr13: [F_OFFICE, F_UNIT],
  // Grup 2 — Realisasi & Rekonsiliasi Biaya
  tr21: [F_FROM, F_TO, F_CLAIM_STATUS, F_OFFICE, F_UNIT],
  tr22: [F_YEAR, F_EXPTYPE, F_OFFICE, F_UNIT],
  tr23: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 3 — Analisis Kepatuhan Kebijakan Perjalanan
  tr31: [F_YEAR, F_OFFICE, F_UNIT],
  tr32: [F_YEAR, F_OFFICE, F_UNIT],
  tr33: [F_YEAR, F_OFFICE, F_UNIT],
  // Grup 4 — Distribusi Vendor & Logistik Perjalanan
  tr41: [F_YEAR, F_OFFICE, F_UNIT],
  tr42: [F_YEAR, F_OFFICE, F_UNIT],
  tr43: [F_YEAR, F_OFFICE, F_UNIT],
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
