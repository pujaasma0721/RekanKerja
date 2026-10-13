// ============================================================================
// RECRUITMENT F6a — CV Intelligence service (HRX B1).
// DEVELOPMENT-PLAN-RECRUITMENT.md §7 F6a + §5 (F6).
//
// Alur: teks CV (paste / ekstraksi dokumen) → parsing AI via aiComplete
// (satu-satunya gerbang LLM — aturan §2.4, TIDAK import SDK langsung) →
// fieldsJson {field: {value, confidence}} di tabel CvParseResult → UI
// human-verify (op verify). Bila AI gagal/tak tersedia → mode `simulated`
// (heuristik regex, confidence maks 0.5) — LABEL JUJUR, tidak pernah
// mengklaim AI. Form manual tetap jalan (fallback penuh).
// ============================================================================

import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { aiComplete } from "@/rekankerja/shared/services/ai-provider";
import { readAttachmentFile } from "@/rekankerja/shared/services/attachment-service";
import { extractCvText } from "./cv-text-extract";

// ============ kontrak serializer (dipakai UI human-verify F6a) ============

export interface CvField<T> {
  value: T | null;
  /** keyakinan 0–1 (simulated maks 0.5). */
  confidence: number;
}

export interface CvEducationItem {
  level: string; // SMP|SMA|SMK|D3|S1|S2|S3|PROF
  fieldOfStudy: string | null;
  institution: string | null;
  graduationYear: number | null;
  gpa: number | null;
}

export interface CvExperienceItem {
  position: string;
  company: string | null;
  years: number | null;
}

export interface CvParsedFields {
  fullName: CvField<string>;
  email: CvField<string>;
  phone: CvField<string>;
  city: CvField<string>;
  /** YYYY-MM-DD (atau string mentah yang belum dinormalkan). */
  birthDate: CvField<string>;
  education: CvField<CvEducationItem[]>;
  experiences: CvField<CvExperienceItem[]>;
  skills: CvField<string[]>;
  /** rupiah per bulan. */
  expectedSalary: CvField<number>;
}

export interface CvParseSerializer {
  id: string;
  applicantId: string;
  sourceKind: string; // pdf|docx|txt|paste
  mode: string; // ai|simulated (manual via UI nanti)
  model: string | null;
  fields: CvParsedFields;
  verifiedAt: string | null;
  createdAt: string;
}

function emptyFields(): CvParsedFields {
  return {
    fullName: { value: null, confidence: 0 },
    email: { value: null, confidence: 0 },
    phone: { value: null, confidence: 0 },
    city: { value: null, confidence: 0 },
    birthDate: { value: null, confidence: 0 },
    education: { value: null, confidence: 0 },
    experiences: { value: null, confidence: 0 },
    skills: { value: null, confidence: 0 },
    expectedSalary: { value: null, confidence: 0 },
  };
}

function serializeRow(row: {
  id: string;
  applicantId: string;
  sourceKind: string;
  mode: string;
  model: string | null;
  fieldsJson: string;
  verifiedAt: Date | null;
  createdAt: Date;
}): CvParseSerializer {
  let fields: CvParsedFields;
  try {
    const parsed = JSON.parse(row.fieldsJson) as Partial<CvParsedFields>;
    fields = { ...emptyFields(), ...parsed };
  } catch {
    fields = emptyFields();
  }
  return {
    id: row.id,
    applicantId: row.applicantId,
    sourceKind: row.sourceKind,
    mode: row.mode,
    model: row.model,
    fields,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ============ prompt AI ============

const CV_PARSE_SYSTEM_PROMPT = [
  "Kau adalah mesin ekstraksi data CV RekanKerja. Satu tugas: mengekstrak data terstruktur dari teks CV (bahasa Indonesia/Inggris).",
  "Balas HANYA JSON VALID — tanpa penjelasan, tanpa kalimat pembuka/penutup, tanpa markdown, tanpa code fence.",
  "Skema jawaban (ikuti PERSIS; field tak diketahui → null untuk value dan confidence 0, array kosong bila tak ada):",
  '{"fullName":{"value":"string|null","confidence":0.95},"email":{"value":"string|null","confidence":0.9},"phone":{"value":"string|null","confidence":0.9},"city":{"value":"string|null","confidence":0.6},"birthDate":{"value":"YYYY-MM-DD|null","confidence":0.5},"education":[{"level":"SMP|SMA|SMK|D3|S1|S2|S3|PROF","fieldOfStudy":"string|null","institution":"string|null","graduationYear":2017,"gpa":3.6}],"experiences":[{"position":"string","company":"string|null","years":3}],"skills":["string"],"expectedSalary":{"value":12000000,"confidence":0.6}}',
  "Aturan: confidence = keyakinan 0–1; expectedSalary DALAM RUPIAH per bulan (angka, mis. 12 juta → 12000000); years = estimasi jumlah tahun pengalaman (angka bulat, hitung dari rentang tanggal); education diurut dari jenjang tertinggi; jangan mengarang data yang tidak ada di CV.",
].join("\n");

/** Batas teks CV yang dikirim ke LLM (input) — CV panjang dipotong. */
const MAX_AI_INPUT_CHARS = 24_000;

// ============ parsing utama ============

export async function parseCvText(
  db: TenantDb,
  input: {
    applicantId: string;
    sourceKind: string;
    text: string;
    mode?: "auto" | "ai" | "simulated";
    storagePath?: string;
  },
): Promise<CvParseSerializer> {
  const a = await db.applicant.findUnique({
    where: { id: input.applicantId },
    select: { applicantNo: true },
  });
  if (!a) throw new Error("Pelamar tidak ditemukan");

  const text = (input.text ?? "").slice(0, 120_000);
  const wantAi = (input.mode ?? "auto") !== "simulated";

  let fields: CvParsedFields | null = null;
  let mode = "simulated";
  let model: string | null = null;

  if (wantAi && text.trim().length > 0) {
    try {
      const ai = await aiComplete(db, {
        system: CV_PARSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: text.slice(0, MAX_AI_INPUT_CHARS) }],
        temperature: 0.1,
        maxTokens: 2000,
      });
      const parsed = fieldsFromAiText(ai.text);
      if (parsed) {
        fields = parsed;
        mode = "ai";
        model = ai.provider; // builtin|openai (label provider aktif tenant)
      }
    } catch {
      fields = null; // AI gagal → fallback simulated (tidak boleh lempar error)
    }
  }

  if (!fields) {
    fields = simulateFields(text);
    mode = "simulated";
    model = null;
  }

  const row = await db.cvParseResult.create({
    data: {
      applicantId: input.applicantId,
      sourceKind: input.sourceKind,
      storagePath: input.storagePath ?? null,
      fieldsJson: JSON.stringify(fields),
      mode,
      model,
    },
  });
  await db.activityLog.create({
    data: {
      action: "CvParsed",
      entity: "CvParseResult",
      entityId: row.id,
      detail: `CV pelamar ${a.applicantNo} diparsing (mode ${mode}, sumber ${input.sourceKind}) — ${countFilled(fields)} field terdeteksi`,
    },
  });
  return serializeRow(row);
}

/** Parse dokumen CV pelamar (ApplicantDocument → Attachment → ekstraksi). */
export async function parseCvDocument(
  db: TenantDb,
  input: { applicantId: string; documentId: string; mode?: "auto" | "simulated" },
): Promise<CvParseSerializer> {
  const doc = await db.applicantDocument.findFirst({
    where: { id: input.documentId, applicantId: input.applicantId },
    include: { attachment: true },
  });
  if (!doc) throw new Error("Dokumen pelamar tidak ditemukan");
  const att = doc.attachment;
  if (!att) throw new Error("Dokumen tidak memiliki file fisik — unggah ulang CV-nya");
  let buf: Buffer;
  try {
    buf = await readAttachmentFile(att); // guard path-traversal di attachment-service
  } catch {
    throw new Error("File dokumen tidak dapat dibaca dari penyimpanan — unggah ulang CV-nya");
  }
  const extracted = extractCvText(buf, att.fileName || doc.title, att.mimeType);
  if (!extracted) {
    throw new Error(
      "CV berupa gambar/scan — ekstraksi teks tidak didukung; isi manual atau unggah PDF/DOCX/TXT",
    );
  }
  return parseCvText(db, {
    applicantId: input.applicantId,
    sourceKind: extracted.sourceKind,
    text: extracted.text,
    mode: input.mode,
    storagePath: att.storagePath,
  });
}

/** Tandai hasil parsing terverifikasi manusia (human-in-the-loop). */
export async function verifyCvParse(
  db: TenantDb,
  input: { parseId: string; employeeId: string },
): Promise<void> {
  const row = await db.cvParseResult.findUnique({
    where: { id: input.parseId },
    include: { applicant: { select: { applicantNo: true } } },
  });
  if (!row) throw new Error("Hasil parsing tidak ditemukan");
  await db.cvParseResult.update({
    where: { id: row.id },
    data: { verifiedById: input.employeeId, verifiedAt: new Date() },
  });
  await db.activityLog.create({
    data: {
      action: "CvParseVerified",
      entity: "CvParseResult",
      entityId: row.id,
      employeeId: input.employeeId,
      detail: `Hasil parsing CV pelamar ${row.applicant.applicantNo} diverifikasi manusia`,
    },
  });
}

/** Hasil parsing TERBARU milik pelamar (utk pre-fill UI human-verify). */
export async function latestCvParse(db: TenantDb, applicantId: string): Promise<CvParseSerializer | null> {
  const row = await db.cvParseResult.findFirst({
    where: { applicantId },
    orderBy: { createdAt: "desc" },
  });
  return row ? serializeRow(row) : null;
}

// ============ pemetaan respons AI → CvParsedFields ============

function clampConf(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function strField(raw: unknown): CvField<string> {
  const o = (raw ?? {}) as { value?: unknown; confidence?: unknown };
  const val = typeof o.value === "string" ? o.value.trim() : null;
  if (!val) return { value: null, confidence: 0 };
  return { value: val.slice(0, 120), confidence: clampConf(o.confidence, 0.5) };
}

function numField(raw: unknown): CvField<number> {
  const o = (raw ?? {}) as { value?: unknown; confidence?: unknown };
  const n = typeof o.value === "number" ? o.value : Number(o.value);
  if (!Number.isFinite(n) || n < 0) return { value: null, confidence: 0 };
  return { value: Math.round(n), confidence: clampConf(o.confidence, 0.5) };
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalkan tanggal umum → YYYY-MM-DD (gagal → null). */
export function normalizeDateText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const MONTHS: Record<string, string> = {
    januari: "01", februari: "02", maret: "03", april: "04", mei: "05", juni: "06",
    juli: "07", agustus: "08", september: "09", oktober: "10", november: "11", desember: "12",
    // EN — april/september/november ejaannya sama persis dgn ID (sudah di baris atas)
    january: "01", february: "02", march: "03", may: "05", june: "06",
    july: "07", august: "08", october: "10", december: "12",
  };
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function fieldsFromAiText(raw: string): CvParsedFields | null {
  let t = (raw ?? "").trim();
  if (!t) return null;
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("fullName" in (parsed as object))) return null;
  const o = parsed as Record<string, unknown>;

  const education: CvEducationItem[] = Array.isArray(o.education)
    ? (o.education as Record<string, unknown>[])
        .filter((e) => e && typeof e === "object")
        .map((e) => ({
          level: e.level ? String(e.level).trim().toUpperCase().slice(0, 12) : "",
          fieldOfStudy: e.fieldOfStudy ? String(e.fieldOfStudy).trim().slice(0, 120) : null,
          institution: e.institution ? String(e.institution).trim().slice(0, 160) : null,
          graduationYear: numOrNull(e.graduationYear),
          gpa: numOrNull(e.gpa),
        }))
        .filter((e) => e.level)
        .slice(0, 8)
    : [];

  const experiences: CvExperienceItem[] = Array.isArray(o.experiences)
    ? (o.experiences as Record<string, unknown>[])
        .filter((e) => e && typeof e === "object" && e.position)
        .map((e) => ({
          position: String(e.position).trim().slice(0, 120),
          company: e.company ? String(e.company).trim().slice(0, 120) : null,
          years: numOrNull(e.years),
        }))
        .slice(0, 12)
    : [];

  const skills: string[] = Array.isArray(o.skills)
    ? o.skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 60))
        .slice(0, 40)
    : [];

  const birth = strField(o.birthDate);
  const birthNorm = birth.value ? normalizeDateText(birth.value) ?? birth.value : null;

  return {
    fullName: strField(o.fullName),
    email: strField(o.email),
    phone: strField(o.phone),
    city: strField(o.city),
    birthDate: { value: birthNorm, confidence: birth.confidence },
    education: {
      value: education.length > 0 ? education : null,
      confidence: education.length > 0 ? 0.7 : 0,
    },
    experiences: {
      value: experiences.length > 0 ? experiences : null,
      confidence: experiences.length > 0 ? 0.7 : 0,
    },
    skills: { value: skills.length > 0 ? skills : null, confidence: skills.length > 0 ? 0.7 : 0 },
    expectedSalary: numField(o.expectedSalary),
  };
}

function countFilled(fields: CvParsedFields): number {
  return [fields.fullName, fields.email, fields.phone, fields.city, fields.birthDate,
    fields.education, fields.experiences, fields.skills, fields.expectedSalary]
    .filter((f) => f.value != null && f.value !== "" && !(Array.isArray(f.value) && f.value.length === 0))
    .length;
}

// ============ mode simulated — heuristik regex (confidence maks 0.5) ============

const SKILL_KEYWORDS = [
  "Excel", "Word", "PowerPoint", "Outlook", "SAP", "Oracle", "Python", "Java", "Javascript",
  "Typescript", "PHP", "SQL", "MySQL", "PostgreSQL", "HTML", "CSS", "React", "Vue", "Angular",
  "Node.js", "Golang", "Laravel", "Codeigniter", "Flutter", "Android", "iOS", "Figma", "AutoCAD",
  "Photoshop", "CorelDraw", "Canva", "Tableau", "Power BI", "e-SPT", "e-Filing", "e-Bupot",
  "Pembukuan", "Bookkeeping", "Payroll", "PPH 21", "Pajak", "Taxation", "Akuntansi", "Accounting",
  "Audit", "Marketing", "Digital Marketing", "SEO", "SEM", "Social Media", "Sales", "Negosiasi",
  "Negotiation", "Leadership", "Kepemimpinan", "Komunikasi", "Communication", "Problem Solving",
  "Time Management", "Manajemen Waktu", "Customer Service", "Administrasi", "Administration",
  "Recruitment", "HRIS", "Logistics", "Supply Chain", "Warehouse", "Gudang", "Quality Control",
  "ISO", "K3", "Mesin", "Maintenance", "Drawing", "Editing", "Copywriting",
];

const CITY_KEYWORDS = [
  "Jakarta", "Bandung", "Surabaya", "Medan", "Semarang", "Yogyakarta", "Denpasar", "Makassar",
  "Bekasi", "Depok", "Tangerang", "Bogor", "Malang", "Palembang", "Pekanbaru", "Balikpapan",
  "Solo", "Batam", "Padang", "Banjarmasin", "Manado", "Samarinda", "Jayapura",
];

function simulateFields(text: string): CvParsedFields {
  const out = emptyFields();
  const t = (text ?? "").replace(/\r\n?/g, "\n");
  const lines = t.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // --- fullName: baris pertama non-header, tanpa '@', ≤ 60 kar ---
  const headerRe = /^(curriculum\s+vitae|cv|resume|daftar\s+riwayat\s+hidup|profil|personal\s+(data|info))/i;
  for (const l of lines) {
    if (l.length < 3 || l.includes("@") || headerRe.test(l)) continue;
    if (/^[=\-–—_*#.|]{2,}$/.test(l)) continue; // garis pemisah
    out.fullName = { value: l.slice(0, 60), confidence: 0.35 };
    break;
  }

  // --- email ---
  const email = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(t);
  if (email) out.email = { value: email[0].toLowerCase(), confidence: 0.5 };

  // --- telepon Indonesia (08xx / +62) ---
  const phone = /(?:\+?62|0)[\s.-]?8\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{3,5}/.exec(t);
  if (phone) {
    const digits = phone[0].replace(/\D/g, "");
    out.phone = {
      value: digits.startsWith("62") ? `0${digits.slice(2)}` : digits,
      confidence: 0.4,
    };
  }

  // --- kota: label ("Domisili: Bandung") — kota umum diprioritaskan, buang kata label ikutan ---
  const LABEL_WORD = /^(tanggal|tempat|lahir|email|telepon|phone|domisili|kota|alamat|pendidikan|pengalaman|keahlian|ekspektasi|gaji|riwayat|lulus|jurusan)$/i;
  const cityLabel = /(?:kota|domisili)\s*[:\-]?\s*([A-Za-z][A-Za-z\s]{2,28})/i.exec(t);
  if (cityLabel) {
    const captured = cityLabel[1].toLowerCase();
    const known = CITY_KEYWORDS.find((c) => captured.includes(c.toLowerCase()));
    if (known) {
      out.city = { value: known, confidence: 0.4 };
    } else {
      const words = cityLabel[1].trim().split(/\s+/).slice(0, 2).filter((w) => !LABEL_WORD.test(w));
      const name = words.join(" ").trim();
      if (name.length >= 4) out.city = { value: name, confidence: 0.3 };
    }
  }
  if (!out.city.value) {
    for (const c of CITY_KEYWORDS) {
      if (new RegExp(`\\b${c}\\b`, "i").test(t)) {
        out.city = { value: c, confidence: 0.25 };
        break;
      }
    }
  }

  // --- tanggal lahir (12/03/1995 · 12-03-1995 · 12 Maret 1995) ---
  const bd = /(?:tanggal\s+lahir|tgl\s+lahir|tempat[^,\n]*,?\s*tanggal\s+lahir|birth\s*date|born)\s*[:\-]?\s*(\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(t);
  if (bd) {
    const norm = normalizeDateText(bd[1].trim());
    if (norm) out.birthDate = { value: norm, confidence: 0.3 };
  }

  // --- pendidikan: jenjang + tahun & institusi terdekat ---
  const normEdu = t.replace(/\bS[\s-]?([123])\b/g, "S$1").replace(/\bD[\s-]?([134])\b/g, "D$1");
  const eduRe = /\b(SMP|SMA|SMK|D3|D1|D4|S1|S2|S3|PROF)\b/g;
  const seen = new Set<string>();
  const edu: CvEducationItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = eduRe.exec(normEdu)) && edu.length < 4) {
    const level = m[1].toUpperCase();
    if (seen.has(level)) continue;
    const from = m.index;
    const after = normEdu.slice(from, Math.min(normEdu.length, from + 140));
    const before = normEdu.slice(Math.max(0, from - 60), from);
    const window = `${before} ${after}`;
    // tahun lulus: utamakan 4-digit SETELAH jenjang (tahun lahir sering mendahului)
    const year = /\b(19[89]\d|20[0-2]\d)\b/.exec(after) ?? /\b(19[89]\d|20[0-2]\d)\b/.exec(before);
    const instMatch = /\b(Universitas|Institut|Sekolah\s+Tinggi|STIE|STMIK|STT|Politeknik|Akademi|Perguruan\s+Tinggi)\s+([A-Z][A-Za-z'&.()\-]+(?:\s+[A-Z][A-Za-z'&.()\-]+){0,5})/.exec(window);
    const jurusan = /\b(?:Jurusan|Program\s+Studi|Prodi|Fakultas)\s*[:\-]?\s*([A-Za-z][A-Za-z\s&.,-]{2,50})/i.exec(window);
    let gpa: number | null = null;
    if (/S[123]|D[134]|PROF|SMA|SMK/.test(level)) {
      const ipk = /(?:IPK|GPA)\s*[:\-]?\s*([0-4](?:[.,]\d{1,2})?)/i.exec(window);
      if (ipk) {
        const g = Number(ipk[1].replace(",", "."));
        if (Number.isFinite(g) && g >= 0 && g <= 4) gpa = g;
      }
    }
    seen.add(level);
    edu.push({
      level,
      fieldOfStudy: jurusan ? jurusan[1].trim().slice(0, 80) : null,
      institution: instMatch ? `${instMatch[1]} ${instMatch[2]}`.replace(/\s+/g, " ").trim().slice(0, 120) : null,
      graduationYear: year ? Number(year[1]) : null,
      gpa,
    });
  }
  if (edu.length > 0) out.education = { value: edu, confidence: 0.4 };

  // --- pengalaman: segmen dgn rentang tahun → posisi (di|-|,) perusahaan ---
  const exps: CvExperienceItem[] = [];
  const rangeRe = /\b((?:19|20)\d{2})\s*(?:[-–—]|hingga|sampai|s\/d)\s*((?:19|20)\d{2}|sekarang|kini|present|now)\b/i;
  // beberapa pengalaman dalam satu baris dipisah ";" → proses per segmen
  const segments: string[] = [];
  for (const l of lines) {
    for (const seg of l.split(/;|\u2022/)) {
      if (seg.trim()) segments.push(seg.trim());
    }
  }
  for (const l of segments) {
    if (exps.length >= 6) break;
    const r = rangeRe.exec(l);
    if (!r) continue;
    const rest = l.replace(rangeRe, "").replace(/[()\[\]]/g, " ").replace(/\s{2,}/g, " ").trim();
    const tail = rest.replace(/[-–—,•·|]\s*$/, "").trim();
    if (!tail || tail.length < 3) continue;
    const parts = tail.split(/\s+di\s+|\s+at\s+|\s+[-–—]\s+|,\s+/).filter((x) => x.trim().length > 1);
    const position = (parts[0] ?? tail).replace(/^(pengalaman|experience)\s*(kerja)?\s*[:\-]?\s*/i, "").trim();
    const company = parts.length > 1 ? parts.slice(1).join(" ").trim() : null;
    const startYear = Number(r[1]);
    const endYear = /^\d{4}$/.test(r[2]) ? Number(r[2]) : new Date().getFullYear();
    if (!position) continue;
    exps.push({
      position: position.slice(0, 80),
      company: company ? company.slice(0, 80) : null,
      years: endYear >= startYear && endYear - startYear <= 60 ? endYear - startYear : null,
    });
  }
  if (exps.length > 0) out.experiences = { value: exps, confidence: 0.35 };

  // --- skills: keyword umum (case-insensitive) ---
  const skills: string[] = [];
  const lower = t.toLowerCase();
  for (const k of SKILL_KEYWORDS) {
    if (skills.length >= 25) break;
    if (lower.includes(k.toLowerCase())) skills.push(k);
  }
  if (skills.length > 0) out.skills = { value: skills, confidence: 0.4 };

  // --- ekspektasi gaji ---
  let salary: number | null = null;
  const rpJuta = /rp\.?\s*([\d][\d.,]*)\s*(juta|jt)\b/i.exec(t);
  const plainJuta = /([\d][\d.,]*)\s*(?:juta|jt)\b/i.exec(t);
  const rpPlain = /rp\.?\s*([\d][\d.,\s]{2,15})/i.exec(t);
  if (rpJuta) {
    const n = parseIndoNumber(rpJuta[1]);
    if (n != null) salary = Math.round(n * 1_000_000);
  } else if (plainJuta && /gaji|salary|ekspektasi|per\b.*\bbulan|\/bulan/i.test(t)) {
    const n = parseIndoNumber(plainJuta[1]);
    if (n != null) salary = Math.round(n * 1_000_000);
  } else if (rpPlain) {
    const n = parseIndoNumber(rpPlain[1]);
    if (n != null && n >= 1_000_000) salary = Math.round(n); // < 1 jt → nominal tak wajar, abaikan
  }
  if (salary != null && salary > 0 && salary <= 500_000_000) {
    out.expectedSalary = { value: salary, confidence: 0.35 };
  }

  return out;
}

/** Parse angka gaya Indonesia ("12.500.000" → 12500000; "12,5" → 12.5). */
function parseIndoNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, "")); // 12.500.000
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(",", ".")); // 12,5
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // "12.5" ambigu: ≤ 2 desimal & nilai kecil → desimal; selain itu → ribuan
    if (s.includes(".") && /^\d+\.\d$/.test(s) && n < 1000) return n;
    return Number(s.replace(/\./g, "")) || n;
  }
  return null;
}
