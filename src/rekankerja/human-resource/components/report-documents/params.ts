// T110 — definisi parameter awal per laporan (sebelum generate) ================
// Dipakai form parameter (report-params-form.tsx): setiap laporan mendeklarasi
// field parameter yang relevan. Nilai dikirim sebagai query string ke API
// report-documents.ts dan diterapkan SERVER-SIDE sebelum builder berjalan.
//
// Jenis field:
//  - select : dropdown satu-pilih (opsi dari ?id=_params: office/unit/status/year)
//  - multi  : chip multi-pilih (opsi statis: urgency/category/certStatus)
//  - month  : input bulan YYYY-MM (default: bulan berjalan)
//  - date   : input tanggal YYYY-MM-DD (dipakai berpasangan from/to)
export type ParamKind =
  | "office" | "unit" | "status" | "urgency" | "category" | "certStatus"
  | "month" | "year" | "from" | "to";

export type ParamField = {
  key: ParamKind;
  labelId: string;
  labelEn: string;
  type: "select" | "multi" | "month" | "year" | "date";
  /** sumber opsi select dari endpoint ?id=_params */
  optionsFrom?: "offices" | "units" | "statuses" | "years";
  /** opsi statis utk field multi */
  staticOptions?: { id: string; labelId: string; labelEn: string }[];
  hintId?: string;
  hintEn?: string;
};

// ---------- opsi statis (mirror label server) ----------

const URGENCY_OPTS: ParamField["staticOptions"] = [
  { id: "overdue", labelId: "Lewat Jatuh Tempo", labelEn: "Overdue" },
  { id: "critical", labelId: "Kritis (< 30 hari)", labelEn: "Critical (< 30 days)" },
  { id: "warning", labelId: "Perhatian (30–60 hari)", labelEn: "Warning (30–60 days)" },
  { id: "caution", labelId: "Waspada (60–90 hari)", labelEn: "Caution (60–90 days)" },
  { id: "safe", labelId: "Aman (> 90 hari)", labelEn: "Safe (> 90 days)" },
];

const CATEGORY_OPTS: ParamField["staticOptions"] = [
  { id: "Keselamatan Kerja (K3)", labelId: "Keselamatan Kerja (K3)", labelEn: "Occupational Safety (K3)" },
  { id: "Sertifikat Profesional", labelId: "Sertifikat Profesional", labelEn: "Professional Certificate" },
  { id: "SIM (Lisensi Mengemudi)", labelId: "SIM (Lisensi Mengemudi)", labelEn: "Driver License (SIM)" },
  { id: "Paspor (Perjalanan Dinas)", labelId: "Paspor (Perjalanan Dinas)", labelEn: "Passport (Business Travel)" },
];

const CERT_STATUS_OPTS: ParamField["staticOptions"] = [
  { id: "expired", labelId: "Kedaluwarsa", labelEn: "Expired" },
  { id: "expiring", labelId: "Segera Berakhir (≤ 90 hari)", labelEn: "Expiring (≤ 90 days)" },
  { id: "active", labelId: "Aktif", labelEn: "Active" },
  { id: "no-expiry", labelId: "Tanpa Masa Berlaku", labelEn: "No Expiry" },
];

// ---------- field dasar ----------

const F_OFFICE: ParamField = { key: "office", labelId: "Cabang / Kantor", labelEn: "Branch / Office", type: "select", optionsFrom: "offices" };
const F_UNIT: ParamField = { key: "unit", labelId: "Divisi / Unit Kerja", labelEn: "Division / Work Unit", type: "select", optionsFrom: "units" };
const F_STATUS: ParamField = { key: "status", labelId: "Status Kepegawaian", labelEn: "Employment Status", type: "select", optionsFrom: "statuses" };
const F_MONTH: ParamField = { key: "month", labelId: "Bulan Data", labelEn: "Data Month", type: "month" };
const F_YEAR: ParamField = { key: "year", labelId: "Tahun Data", labelEn: "Data Year", type: "year", optionsFrom: "years" };
const F_FROM: ParamField = { key: "from", labelId: "Dari Tanggal", labelEn: "From Date", type: "date" };
const F_TO: ParamField = { key: "to", labelId: "Sampai Tanggal", labelEn: "To Date", type: "date" };
const F_URGENCY: ParamField = {
  key: "urgency", labelId: "Urgensi Jatuh Tempo", labelEn: "Expiry Urgency", type: "multi", staticOptions: URGENCY_OPTS,
  hintId: "Kosong = semua level urgensi.", hintEn: "Empty = all urgency levels.",
};
const F_CATEGORY: ParamField = { key: "category", labelId: "Kategori Sertifikasi", labelEn: "Certification Category", type: "multi", staticOptions: CATEGORY_OPTS };
const F_CERT_STATUS: ParamField = {
  key: "certStatus", labelId: "Status Sertifikasi", labelEn: "Certification Status", type: "multi", staticOptions: CERT_STATUS_OPTS,
  hintId: "Kosong = semua status.", hintEn: "Empty = all statuses.",
};

// ---------- matriks parameter per laporan ----------

export const REPORT_PARAMS: Record<string, ParamField[]> = {
  // Grup 1 — Demografi & Profil
  r11: [F_OFFICE, F_UNIT, F_STATUS],
  r12: [F_OFFICE, F_UNIT, F_STATUS],
  r13: [F_OFFICE, F_UNIT, F_STATUS],
  r14: [F_OFFICE, F_UNIT, F_STATUS],
  // R1.5 memetakan per cabang — cabang adalah dimensi tabelnya, jadi filter
  // cabang tidak ditawarkan (laporan memang lintas cabang).
  r15: [F_STATUS],
  // Grup 2 — Masa Kerja & Kontrak
  r21: [F_URGENCY, F_OFFICE, F_UNIT, F_STATUS],
  r22: [F_OFFICE, F_UNIT, F_STATUS],
  r23: [F_OFFICE, F_UNIT],
  // Grup 3 — Pergerakan Karyawan
  r31: [F_MONTH, F_OFFICE, F_UNIT, F_STATUS],
  r32: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  r33: [F_YEAR, F_OFFICE, F_UNIT],
  r34: [F_FROM, F_TO, F_OFFICE, F_UNIT],
  // Grup 4 — Kepatuhan & Legal
  r41: [F_YEAR, F_OFFICE, F_UNIT, F_STATUS],
  r42: [F_OFFICE, F_UNIT, F_STATUS],
  r43: [F_OFFICE, F_UNIT, F_STATUS],
  r44: [F_CATEGORY, F_CERT_STATUS, F_OFFICE, F_UNIT],
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
