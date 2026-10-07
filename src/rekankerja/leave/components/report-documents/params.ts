// T112 — definisi parameter awal per laporan Leave (sebelum generate) ==========
// Mirror pola HR report-documents/params.ts (T110). Jenis field:
//  - select : dropdown satu-pilih (opsi dari ?id=_params: office/unit/leaveType/status/year)
//  - multi  : chip multi-pilih (opsi statis: skd)
//  - month  : input bulan YYYY-MM (default: bulan berjalan)
//  - date   : input tanggal YYYY-MM-DD (dipakai berpasangan from/to)
export type ParamKind =
  | "office" | "unit" | "leaveType" | "status" | "skd" | "month" | "year" | "from" | "to";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "multi" | "month" | "year" | "date";
  optionsFrom?: "offices" | "units" | "leaveTypes" | "statuses" | "years";
  staticOptions?: { id: string; labelId: string; labelEn: string }[];
  hintId?: string;
  hintEn?: string;
};

// ---------- opsi statis ----------

const SKD_OPTS: ParamField["staticOptions"] = [
  { id: "complete", labelId: "SKD Lengkap", labelEn: "SKD Complete" },
  { id: "incomplete", labelId: "SKD Tidak Lengkap", labelEn: "SKD Incomplete" },
];

// ---------- field dasar ----------

const F_OFFICE: ParamField = { key: "office", labelId: "Cabang / Kantor", labelEn: "Branch / Office", type: "select", optionsFrom: "offices" };
const F_UNIT: ParamField = { key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit", type: "select", optionsFrom: "units" };
const F_TYPE: ParamField = { key: "leaveType", labelId: "Jenis Cuti", labelEn: "Leave Type", type: "select", optionsFrom: "leaveTypes" };
const F_TYPE_DEF: ParamField = {
  ...F_TYPE,
  hintId: "Kosong = Cuti Tahunan (CT-THN) — jenis laporan saldo tahunan.",
  hintEn: "Empty = Annual Leave (CT-THN) — this is an annual balance report.",
};
const F_STATUS: ParamField = { key: "status", labelId: "Status Pengajuan", labelEn: "Request Status", type: "select", optionsFrom: "statuses" };
const F_SKD: ParamField = {
  key: "skd", labelId: "Audit SKD", labelEn: "SKD Audit", type: "multi", staticOptions: SKD_OPTS,
  hintId: "Kosong = semua (lengkap & tidak lengkap).", hintEn: "Empty = all (complete & incomplete).",
};
const F_MONTH: ParamField = { key: "month", labelId: "Bulan Data", labelEn: "Data Month", type: "month" };
const F_YEAR: ParamField = { key: "year", labelId: "Tahun Data", labelEn: "Data Year", type: "year", optionsFrom: "years" };
const F_FROM: ParamField = { key: "from", labelId: "Dari Tanggal", labelEn: "From Date", type: "date" };
const F_TO: ParamField = { key: "to", labelId: "Sampai Tanggal", labelEn: "To Date", type: "date" };

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Saldo & Hak Cuti (R1.1/R1.3 = laporan saldo tahunan → default CT-THN)
  lr11: [F_TYPE_DEF, F_YEAR, F_OFFICE, F_UNIT],
  lr12: [F_YEAR, F_OFFICE, F_UNIT],
  lr13: [F_TYPE_DEF, F_YEAR, F_OFFICE, F_UNIT],
  // Grup 2 — Transaksi & Riwayat
  lr21: [F_FROM, F_TO, F_TYPE, F_STATUS, F_OFFICE, F_UNIT],
  lr22: [F_OFFICE, F_UNIT, F_TYPE],
  lr23: [F_MONTH, F_OFFICE, F_UNIT],
  // Grup 3 — Analisis Ketidakhadiran
  lr31: [F_MONTH, F_OFFICE, F_UNIT],
  lr32: [F_FROM, F_TO, F_SKD, F_OFFICE, F_UNIT],
  lr33: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 4 — Kepatuhan & Cuti Khusus
  lr41: [F_YEAR, F_OFFICE, F_UNIT],
  lr42: [F_OFFICE, F_UNIT],
  lr43: [F_FROM, F_TO, F_OFFICE, F_UNIT],
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
    } else {
      out.push({ key: f.key, label: `${f.labelId.split(" /")[0]}: ${optionLabel(f, raw)}` });
    }
  }
  return out;
}
