// P8-PERF — definisi parameter awal per laporan Performance (sebelum generate)
// Mirror pola medical/report-documents/params.ts (MED-1-b). Jenis field:
//  - cycle    : dropdown siklus penilaian (opsi dari ?id=_params: cycles)
//  - unit     : dropdown unit kerja (opsional — cakupan subtree)
//  - employee  : dropdown karyawan peserta (opsi mengikuti siklus terpilih)
export type ParamKind = "cycle" | "unit" | "employee";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select";
  optionsFrom?: "cycles" | "units" | "employees";
  /** true = wajib dipilih sebelum generate (disabled tombol bila kosong). */
  required?: boolean;
  hintId?: string;
  hintEn?: string;
};

// ---------- field dasar ----------

const F_CYCLE_REQ: ParamField = {
  key: "cycle", labelId: "Siklus Penilaian", labelEn: "Appraisal Cycle",
  type: "select", optionsFrom: "cycles", required: true,
};
const F_CYCLE_OPT: ParamField = {
  key: "cycle", labelId: "Siklus Penilaian (opsional)", labelEn: "Appraisal Cycle (optional)",
  type: "select", optionsFrom: "cycles",
  hintId: "Kosongkan untuk semua siklus.",
  hintEn: "Leave empty for all cycles.",
};
const F_UNIT: ParamField = {
  key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit",
  type: "select", optionsFrom: "units",
  hintId: "Cakupan subtree — unit beserta seluruh anaknya.",
  hintEn: "Subtree scope — the unit and all of its children.",
};
const F_EMPLOYEE: ParamField = {
  key: "employee", labelId: "Karyawan Peserta", labelEn: "Participant Employee",
  type: "select", optionsFrom: "employees", required: true,
  hintId: "Daftar peserta mengikuti siklus yang dipilih.",
  hintEn: "The participant list follows the selected cycle.",
};

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Siklus & Partisipasi
  pf11: [],
  pf12: [F_CYCLE_REQ],
  pf13: [F_CYCLE_REQ, F_UNIT],
  // Grup 2 — Penilaian & Hasil
  pf21: [F_CYCLE_REQ, F_UNIT],
  pf22: [F_CYCLE_REQ, F_UNIT],
  pf23: [F_CYCLE_REQ, F_EMPLOYEE],
  pf24: [F_CYCLE_REQ],
  // Grup 3 — Kualitas & Kepatuhan
  pf31: [F_CYCLE_REQ],
  pf32: [F_CYCLE_REQ],
  pf33: [F_CYCLE_OPT],
  // Grup 4 — Konsekuensi & Analitik
  pf41: [F_CYCLE_OPT],
  pf42: [],
  pf43: [F_CYCLE_REQ],
  pf44: [F_UNIT],
};

// ---------- util nilai & query ----------

export type ParamValues = Record<string, string>;

/** Nilai bawaan saat laporan dipilih: select kosong (Semua …). */
export function defaultsFor(reportId: string): ParamValues {
  const v: ParamValues = {};
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    v[f.key] = "";
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

/** true bila ada parameter wajib yang belum terisi (tombol generate ditahan). */
export function missingRequired(reportId: string, values: ParamValues): string[] {
  const out: string[] = [];
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    if (f.required && !(values[f.key] ?? "").trim()) out.push(f.key);
  }
  return out;
}

/** Ringkasan parameter terpasang utk chip pratinjau (label pendek). */
export function summarizeParams(reportId: string, values: ParamValues, optionLabel: (field: ParamField, id: string) => string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    const raw = (values[f.key] ?? "").trim();
    if (!raw) continue;
    out.push({ key: f.key, label: `${f.labelId.split(" (")[0]}: ${optionLabel(f, raw)}` });
  }
  return out;
}
