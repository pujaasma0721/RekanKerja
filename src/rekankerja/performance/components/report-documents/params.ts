// P8-PERF — definisi parameter awal per laporan kinerja (sebelum generate) ====
// Mirror pola medical/report-documents/params.ts. Jenis field:
//  - select : dropdown satu-pilih (opsi dari ?id=_params: cycle/year/unit/
//             status/employee/session/groupBy)
//  - year   : dropdown tahun
// "Semua" memakai sentinel "all" (Radix SelectItem TIDAK BOLEH value="").
// Default cycle = siklus aktif pertama / terbaru (dari pool — di-set form).
export type ParamKind =
  | "cycle" | "year" | "unit" | "status" | "groupBy" | "employee" | "session";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "year";
  /** pool opsi dari server (?id=_params) — groupBy statis di form. */
  optionsFrom?: "cycles" | "years" | "units" | "cycleStatuses" | "appraisalStatuses" | "meritStatuses" | "pipStatuses" | "employees" | "sessions";
  /** field wajib (tidak boleh "Semua") — mis. cycle pf12/pf24, employee pf23. */
  required?: boolean;
  hintId?: string;
  hintEn?: string;
};

// ---------- field dasar ----------

const F_CYCLE_REQ: ParamField = { key: "cycle", labelId: "Siklus Penilaian", labelEn: "Appraisal Cycle", type: "select", optionsFrom: "cycles", required: true };
const F_CYCLE_OPT: ParamField = { key: "cycle", labelId: "Siklus Penilaian", labelEn: "Appraisal Cycle", type: "select", optionsFrom: "cycles", hintId: "Kosongkan utk seluruh riwayat", hintEn: "Leave empty for full history" };
const F_YEAR: ParamField = { key: "year", labelId: "Tahun", labelEn: "Year", type: "year", optionsFrom: "years" };
const F_UNIT: ParamField = { key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit", type: "select", optionsFrom: "units" };
const F_STATUS_CYCLE: ParamField = { key: "status", labelId: "Status Siklus", labelEn: "Cycle Status", type: "select", optionsFrom: "cycleStatuses" };
const F_STATUS_APPR: ParamField = { key: "status", labelId: "Status Penilaian", labelEn: "Appraisal Status", type: "select", optionsFrom: "appraisalStatuses" };
const F_STATUS_MERIT: ParamField = { key: "status", labelId: "Status Usulan Merit", labelEn: "Merit Status", type: "select", optionsFrom: "meritStatuses" };
const F_STATUS_PIP: ParamField = { key: "status", labelId: "Status PIP", labelEn: "PIP Status", type: "select", optionsFrom: "pipStatuses" };
const F_GROUPBY: ParamField = { key: "groupBy", labelId: "Kelompokkan per", labelEn: "Group by", type: "select", hintId: "unit = unit kerja · atasan = penilai", hintEn: "unit = work unit · atasan = appraiser" };
const F_EMPLOYEE: ParamField = {
  key: "employee", labelId: "Karyawan", labelEn: "Employee", type: "select", optionsFrom: "employees", required: true,
  hintId: "Register riwayat per karyawan (PP 35/2021 §7.2)", hintEn: "Per-employee history register (PP 35/2021 §7.2)",
};
const F_SESSION: ParamField = { key: "session", labelId: "Sesi Kalibrasi", labelEn: "Calibration Session", type: "select", optionsFrom: "sessions", hintId: "Kosongkan utk semua sesi", hintEn: "Leave empty for all sessions" };

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // G1 — Siklus & Partisipasi
  pf11: [F_YEAR, F_STATUS_CYCLE],
  pf12: [F_CYCLE_REQ],
  pf13: [F_CYCLE_REQ, F_UNIT],
  // G2 — Penilaian & Hasil
  pf21: [F_CYCLE_REQ, F_UNIT, F_STATUS_APPR],
  pf22: [F_CYCLE_REQ, F_GROUPBY],
  pf23: [F_EMPLOYEE, F_CYCLE_OPT],
  pf24: [F_CYCLE_REQ],
  // G3 — Kualitas & Kepatuhan
  pf31: [F_CYCLE_REQ, F_SESSION],
  pf32: [F_CYCLE_REQ],
  pf33: [F_YEAR],
  // G4 — Konsekuensi & Analitik
  pf41: [F_CYCLE_REQ, F_STATUS_MERIT],
  pf42: [F_YEAR, F_STATUS_PIP],
  pf43: [F_CYCLE_REQ],
  pf44: [F_UNIT],
};

// ---------- util nilai & query ----------

export type ParamValues = Record<string, string>;

/** Nilai bawaan saat laporan dipilih: tahun = berjalan, select = "Semua".
 *  `defaultCycleId` = siklus aktif pertama / terbaru dari pool _params (server). */
export function defaultsFor(reportId: string, defaultCycleId?: string | null): ParamValues {
  const now = new Date();
  const v: ParamValues = {};
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    if (f.type === "year") v[f.key] = String(now.getFullYear());
    else if (f.key === "cycle") v[f.key] = defaultCycleId ?? "";
    else v[f.key] = ""; // select (Semua …)
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
export function summarizeParams(
  reportId: string,
  values: ParamValues,
  optionLabel: (field: ParamField, id: string) => string,
): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    const raw = (values[f.key] ?? "").trim();
    if (!raw) continue;
    out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${optionLabel(f, raw)}` });
  }
  return out;
}
