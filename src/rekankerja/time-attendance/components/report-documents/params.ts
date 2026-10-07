// T113 — definisi parameter awal per laporan Attendance (sebelum generate) ===
// Mirror pola HR/Leave report-documents/params.ts (T110/T112). Jenis field:
//  - select : dropdown satu-pilih (opsi dari ?id=_params: office/unit/otStatus/year)
//  - multi  : chip multi-pilih (opsi statis: exception)
//  - month  : input bulan YYYY-MM (default: bulan berjalan)
//  - date   : input tanggal tunggal YYYY-MM-DD (R1.2 timesheet — default: hari ini)
//  - date   : input tanggal YYYY-MM-DD dipakai berpasangan from/to
export type ParamKind =
  | "office" | "unit" | "otStatus" | "exception" | "month" | "date" | "year" | "from" | "to";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "multi" | "month" | "year" | "date";
  optionsFrom?: "offices" | "units" | "otStatuses" | "years";
  staticOptions?: { id: string; labelId: string; labelEn: string }[];
  hintId?: string;
  hintEn?: string;
};

// ---------- opsi statis ----------

const EXC_OPTS: ParamField["staticOptions"] = [
  { id: "missing-out", labelId: "Lupa Absen Pulang", labelEn: "Missing Clock-out" },
  { id: "no-punch", labelId: "Tanpa Absen (Import Mesin)", labelEn: "No Punch (Machine)" },
  { id: "revised", labelId: "Koreksi Manual", labelEn: "Manual Correction" },
];

// ---------- field dasar ----------

const F_OFFICE: ParamField = { key: "office", labelId: "Cabang / Kantor", labelEn: "Branch / Office", type: "select", optionsFrom: "offices" };
const F_UNIT: ParamField = { key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit", type: "select", optionsFrom: "units" };
const F_OTSTATUS: ParamField = { key: "otStatus", labelId: "Status Perintah Lembur", labelEn: "Overtime Order Status", type: "select", optionsFrom: "otStatuses" };
const F_EXC: ParamField = {
  key: "exception", labelId: "Jenis Anomali", labelEn: "Exception Type", type: "multi", staticOptions: EXC_OPTS,
  hintId: "Kosong = semua jenis anomali presensi.", hintEn: "Empty = all attendance exception types.",
};
const F_MONTH: ParamField = { key: "month", labelId: "Bulan Data", labelEn: "Data Month", type: "month" };
const F_DATE: ParamField = {
  key: "date", labelId: "Tanggal Data", labelEn: "Data Date", type: "date",
  hintId: "Pilih hari kerja yang datanya sudah direkap (mis. kemarin).", hintEn: "Pick a workday whose recap already exists (e.g. yesterday).",
};
const F_YEAR: ParamField = { key: "year", labelId: "Tahun Data", labelEn: "Data Year", type: "year", optionsFrom: "years" };
const F_FROM: ParamField = { key: "from", labelId: "Dari Tanggal", labelEn: "From Date", type: "date" };
const F_TO: ParamField = { key: "to", labelId: "Sampai Tanggal", labelEn: "To Date", type: "date" };

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Rekapitulasi Presensi Berkala
  ar11: [F_MONTH, F_OFFICE, F_UNIT],
  ar12: [F_DATE, F_OFFICE, F_UNIT],
  ar13: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 2 — Keterlambatan & Jam Kerja Kurang
  ar21: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  ar22: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  ar23: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 3 — Lembur & Jam Kerja Efektif
  ar31: [F_FROM, F_TO, F_OTSTATUS, F_OFFICE, F_UNIT],
  ar32: [F_FROM, F_TO, F_OTSTATUS, F_OFFICE, F_UNIT],
  ar33: [F_MONTH, F_OFFICE, F_UNIT],
  // Grup 4 — Variasi Jadwal & Kerja Shift
  ar41: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  ar42: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  ar43: [F_FROM, F_TO, F_EXC, F_OFFICE, F_UNIT],
};

// ---------- util nilai & query ----------

export type ParamValues = Record<string, string>;

/** Nilai bawaan saat laporan dipilih: periode = bulan/hari berjalan, cakupan = semua. */
export function defaultsFor(reportId: string): ParamValues {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const v: ParamValues = {};
  for (const f of REPORT_PARAMS[reportId] ?? []) {
    if (f.type === "month") {
      v[f.key] = today.slice(0, 7);
    } else if (f.type === "year") {
      v[f.key] = String(now.getFullYear());
    } else if (f.key === "from") {
      v[f.key] = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    } else if (f.key === "to" || f.key === "date") {
      v[f.key] = today;
    } else {
      v[f.key] = ""; // select (Semua ...) & multi (kosong)
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
    if (f.type === "multi") {
      const labels = raw.split(",").filter(Boolean).map((x) => optionLabel(f, x));
      out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${labels.join(", ")}` });
    } else if (f.type === "month") {
      out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${monthLabelOf(raw)}` });
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
