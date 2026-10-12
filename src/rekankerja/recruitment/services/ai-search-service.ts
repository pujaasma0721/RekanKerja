// ============================================================================
// RECRUITMENT F6c — AI Search + Recruiter Copilot + Bias check (HRX B4/B5/B6)
// DEVELOPMENT-PLAN-RECRUITMENT.md §7 F6c.
//
// 1) aiSearch        — pencarian talent pool bahasa natural: AI menerjemahkan
//                     query → filter terstruktur (JSON), gagal/timeout →
//                     ekstraksi regex simulated BERLABEL. Filter dijalankan
//                     dua lapis: SQL where HANYA kolom non-enkripsi
//                     (status/source/highestEduLevel/totalExpMonths) →
//                     decrypt city/expectedSalary IN-MEMORY → filter
//                     lanjutan (kota/gaji/keahlian/kata kunci). PII terenkripsi
//                     TIDAK PERNAH masuk where/sort SQL (aturan §2.4/W28).
//                     `interpreted` menjelaskan filter yang dipakai (P2).
// 2) copilotAction   — aksi recruiter terkurasi (draft JD, ringkas kandidat,
//                     pertanyaan interview, outreach, tanya-jawab pipeline,
//                     cek bias). AI via aiComplete (satu-satunya gerbang
//                     LLM) → fallback simulated deterministik — error AI
//                     TIDAK PERNAH dilempar ke pemanggil (D7 label jujur).
// 3) check-bias      — daftar statis kata terlarang/berkode + AI kontekstual
//                     digabung & didedupe → teks terformat per temuan.
//
// BL-REC-3: parameter `lang: "id" | "en"` (default "id") end-to-end —
//   (a) mode AI: satu baris instruksi bahasa jawaban ditambahkan ke system
//       prompt tiap aksi copilot (LANG_LINE);
//   (b) mode simulasi: SEMUA template user-visible dwibahasa via helper L()
//       (frasa deteksi BIAS_RULES.phrases tetap Indonesia BY DESIGN — itu
//       pola bahasa iklan lowongan yang dideteksi, bukan teks tampilan).
// ============================================================================

import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { aiComplete } from "@/rekankerja/shared/services/ai-provider";
import {
  APPLICANT_STATUSES, APPLICANT_SOURCES, EDU_LEVELS, fullNameOf,
  type ApplicantRow, type ApplicantStatus,
} from "@/rekankerja/recruitment/services/applicant-service";
import { getRubric, type RubricFactor } from "@/rekankerja/recruitment/services/ai-score-service";

// ============ tipe kontrak (dipakai UI F6c) ============

/** Baris hasil pencarian — ApplicantRow serializer listApplicants + info ekstra. */
export type AiSearchRow = ApplicantRow & {
  totalExpYears: number;
  skills: string[];
};

export interface AiSearchResult {
  mode: "ai" | "simulated";
  /** Penjelasan filter yang diterapkan (id/en sesuai lang) — transparansi P2. */
  interpreted: string;
  rows: AiSearchRow[];
  total: number;
}

export interface CopilotResult {
  mode: "ai" | "simulated";
  /** Teks siap-baca (markdown ringan: baris & bullet). */
  text: string;
}

export const COPILOT_ACTIONS = [
  "draft-jd", "summarize-candidate", "interview-questions",
  "outreach", "pipeline-qa", "check-bias",
] as const;
export type CopilotAction = (typeof COPILOT_ACTIONS)[number];

/** Batas aman beban scan in-memory (kota/gaji terenkripsi — dua fase). */
const SCAN_LIMIT = 300;
/** Kota umum Indonesia — dideteksi dari query (city TIDAK ada di skema AI & TIDAK bisa di-where). */
const COMMON_CITIES = [
  "bandar lampung", "yogyakarta", "bandung", "surabaya", "jakarta", "medan", "bekasi",
  "tangerang", "depok", "bogor", "semarang", "jogja", "solo", "surakarta", "malang",
  "makassar", "palembang", "pekanbaru", "batam", "lampung", "denpasar", "bali",
  "padang", "samarinda", "balikpapan", "banjarmasin", "pontianak", "manado",
  "kendari", "kupang", "mataram", "banda aceh", "aceh", "jayapura", "cimahi",
  "tasikmalaya", "cirebon", "sukabumi", "magelang", "salatiga", "kediri",
  "madiun", "jember", "banyuwangi", "semarang",
];
/** Sinonim jenjang pendidikan → kode highestEduLevel. */
const EDU_SYNONYMS: Record<string, string> = {
  sarjana: "S1", s1: "S1", magister: "S2", s2: "S2", msi: "S2",
  doktor: "S3", s3: "S3", doktoral: "S3", prof: "PROF", profesi: "PROF",
  diploma: "D3", d3: "D3", d1: "D1", d2: "D2", d4: "D4",
  sma: "SMA", smk: "SMK", smp: "SMP", slta: "SMA", sltp: "SMP",
};
const STOPWORDS = new Set([
  "di", "yang", "dengan", "dan", "atau", "kota", "domisili", "berdomisili", "tinggal",
  "pengalaman", "berpengalaman", "minim", "minimal", "min", "paling", "sekurang", "kurang",
  "pendidikan", "berpendidikan", "lulusan", "usia", "berusia", "umur", "tahun", "gaji",
  "ekspektasi", "salary", "budget", "kompen", "kompensasi", "maks", "maksimal", "max",
  "dibawah", "bawah", "atas", "diatas", "sumber", "dari", "berasal", "carilah", "cari",
  "tampilkan", "tolong", "mohon", "punya", "memiliki", "kandidat", "pelamar", "orang",
  "untuk", "buat", "sebagai", "seorang", "berbasis", "sesuai", "kerja", "perbulan",
  "per", "bulan", "juta", "jt", "ribu", "rb", "rp", "idr",
]);

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

/** Pilih varian string template output sesuai bahasa UI (id default — BL-REC-3). */
const L = (lang: "id" | "en", id: string, en: string): string => (lang === "en" ? en : id);

/** Satu baris instruksi bahasa jawaban model — ditambahkan ke system prompt copilot. */
const LANG_LINE = (lang: "id" | "en"): string =>
  L(lang, "Jawab dalam Bahasa Indonesia.", "Answer in English.");

// ============ helper umum ============

/** Jalur AI tunggal — null bila gagal/timeout (pemanggil pakai fallback simulated). */
async function aiText(
  db: TenantDb, system: string, user: string,
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string | null> {
  try {
    const r = await aiComplete(db, {
      system,
      messages: [{ role: "user", content: user }],
      temperature: opts?.temperature ?? 0.4,
      maxTokens: opts?.maxTokens ?? 2000,
    });
    const t = r.text?.trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Strip code fence + ambil objek JSON pertama-balasan terakhir. */
function extractJson(raw: string): unknown | null {
  let t = (raw ?? "").trim();
  if (!t) return null;
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ============================================================================
// 1) PENCARIAN NATURAL-LANGUAGE TALENT POOL
// ============================================================================

const SEARCH_SYSTEM_PROMPT = [
  "Terjemahkan query pencarian rekrutmen bahasa natural ke JSON filter.",
  'HANYA JSON: {"status":string|null,"educationLevel":string|null,"minExpYears":number|null,"maxExpectedSalary":number|null,"skill":string|null,"source":string|null,"keyword":string|null}.',
  "Kolom null bila tidak disebut. Nilai valid:",
  "status = Active|Rejected|Outdated|Employed; source = Advertisement|Agency|Referral|Web|Internal|Other;",
  "educationLevel = SMP|SMA|SMK|D3|S1|S2|S3|PROF (boleh sinonim umum, tetap satu string);",
  "minExpYears = tahun pengalaman minimal (angka); maxExpectedSalary = angka rupiah per bulan;",
  "skill = nama keahlian spesifik bila disebut; keyword = frasa bebas sisanya (posisi/jurusan), string kosong bila tak ada.",
].join(" ");

interface SearchFilter {
  status: string | null;
  educationLevel: string | null;
  minExpYears: number | null;
  maxExpectedSalary: number | null;
  skill: string | null;
  source: string | null;
  keyword: string | null;
  /** kota dideteksi lokal dari query (bukan keluaran AI — city tidak di skema). */
  city: string | null;
}

const EMPTY_FILTER: SearchFilter = {
  status: null, educationLevel: null, minExpYears: null, maxExpectedSalary: null,
  skill: null, source: null, keyword: null, city: null,
};

function isBlankFilter(f: SearchFilter): boolean {
  return !f.status && !f.educationLevel && f.minExpYears == null && f.maxExpectedSalary == null
    && !f.skill && !f.source && !f.keyword && !f.city;
}

/** Normalisasi nilai AI ke enum domain — nilai tak dikenal dibuang (bukan ditelan mentah). */
function sanitizeAiFilter(o: Record<string, unknown>): SearchFilter {
  const f: SearchFilter = { ...EMPTY_FILTER };

  const st = typeof o.status === "string" ? o.status.trim() : "";
  f.status = APPLICANT_STATUSES.find((s) => s.toLowerCase() === st.toLowerCase()) ?? null;

  const src = typeof o.source === "string" ? o.source.trim() : "";
  f.source = APPLICANT_SOURCES.find((s) => s.toLowerCase() === src.toLowerCase()) ?? null;

  const edu = typeof o.educationLevel === "string" ? o.educationLevel.trim().toLowerCase() : "";
  if (edu) {
    const mapped = EDU_SYNONYMS[edu] ?? (EDU_LEVELS as readonly string[]).find((l) => l.toLowerCase() === edu) ?? null;
    f.educationLevel = mapped;
  }

  const exp = Number(o.minExpYears);
  if (Number.isFinite(exp) && exp > 0 && exp <= 45) f.minExpYears = Math.round(exp);

  let sal = Number(o.maxExpectedSalary);
  if (!Number.isFinite(sal) && typeof o.maxExpectedSalary === "string") sal = parseFloat(o.maxExpectedSalary);
  if (Number.isFinite(sal) && sal > 0) {
    // heuristik: angka kecil tanpa digit rupiah penuh diartikan "juta" (10 → 10.000.000)
    if (sal < 1000) sal *= 1_000_000;
    if (sal <= 1_000_000_000) f.maxExpectedSalary = Math.round(sal);
  }

  if (typeof o.skill === "string" && o.skill.trim()) f.skill = o.skill.trim().slice(0, 60);
  if (typeof o.keyword === "string" && o.keyword.trim()) f.keyword = o.keyword.trim().slice(0, 120);
  return f;
}

/** Deteksi kota umum di teks (kata utuh / frasa, case-insensitive). */
function detectCity(text: string): string | null {
  const lower = ` ${text.toLowerCase()} `;
  for (const city of COMMON_CITIES) {
    if (lower.includes(` ${city} `) || lower.includes(` ${city},`) || lower.includes(`${city} `)) return city;
  }
  return null;
}

// ---- ekstraksi regex simulated (deterministik, berlabel) ----

function simulateStatus(q: string): string | null {
  const l = q.toLowerCase();
  if (/\b(aktif|active)\b/.test(l)) return "Active";
  if (/\b(outdated|usang)\b/.test(l)) return "Outdated";
  if (/\b(rejected|ditolak)\b/.test(l)) return "Rejected";
  if (/\b(employed|bekerja)\b/.test(l)) return "Employed";
  return null;
}

function simulateSource(q: string): string | null {
  const l = q.toLowerCase();
  if (/\bweb\b/.test(l)) return "Web";
  if (/\b(referral|referal)\b/.test(l)) return "Referral";
  if (/\b(agency|agensi)\b/.test(l)) return "Agency";
  if (/\b(iklan|advertisement)\b/.test(l)) return "Advertisement";
  if (/\binternal\b/.test(l)) return "Internal";
  return null;
}

function simulateEdu(q: string): string | null {
  const l = q.toLowerCase();
  const m = l.match(/\b(sarjana|magister|doktor|doktoral|profesi|diploma|smp|sma|smk|s1|s2|s3|prof|d3|d4|d1|d2|slta|sltp)\b/);
  return m ? EDU_SYNONYMS[m[1]!] ?? null : null;
}

/** "3 tahun" → pengalaman minimal ("di bawah/atas 30 tahun" = konteks usia → dilewati). */
function simulateExpYears(q: string): number | null {
  const re = /(\d{1,2})\s*\+?\s*tahun/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const before = q.slice(Math.max(0, m.index - 16), m.index).toLowerCase();
    if (/(di\s?bawah|dibawah|di\s?atas|diatas|usia|umur|maks)/.test(before)) continue;
    const n = parseInt(m[1]!, 10);
    if (n >= 1 && n <= 45) return n;
  }
  return null;
}

/** Ekspektasi gaji maks dari query (butuh konteks kata gaji/ekspektasi/budget). */
function simulateMaxSalary(q: string): number | null {
  const l = q.toLowerCase();
  if (!/(gaji|ekspektasi|salary|budget|kompen)/.test(l)) return null;
  const juta = l.match(/(\d+(?:[.,]\d+)?)\s*(?:juta|jt)\b/);
  if (juta) {
    const n = parseFloat(juta[1]!.replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n <= 1000) return Math.round(n * 1_000_000);
  }
  const rpFull = l.match(/rp\.?\s*([\d.]{7,12})/);
  if (rpFull) {
    const n = parseInt(rpFull[1]!.replace(/\./g, ""), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // "gaji maks 10" (tanpa unit) — angka kecil menempel konteks gaji → juta
  const plain = l.match(/(?:gaji|ekspektasi|salary|budget)[^.\d]{0,18}(\d{1,3})\b(?!\s*tahun)/);
  if (plain) {
    const n = parseInt(plain[1]!, 10);
    if (n > 0 && n < 100) return n * 1_000_000;
  }
  return null;
}

/** Buang frasa yang sudah terkonsumsi + stopwords → kata kunci sisa. */
function residueKeyword(q: string, consumed: string[]): string | null {
  let masked = q;
  for (const c of consumed) {
    if (!c) continue;
    masked = masked.replace(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  const words = masked
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const kw = words.join(" ").trim();
  return kw.length >= 3 ? kw.slice(0, 120) : null;
}

/** Ekstraksi filter tanpa AI — pola regex sederhana (fallback berlabel). */
async function simulateFilter(db: TenantDb, q: string): Promise<SearchFilter> {
  const f: SearchFilter = { ...EMPTY_FILTER };
  f.status = simulateStatus(q);
  f.source = simulateSource(q);
  f.educationLevel = simulateEdu(q);
  f.minExpYears = simulateExpYears(q);
  f.maxExpectedSalary = simulateMaxSalary(q);
  f.city = detectCity(q);

  // skill: cocokkan nama master Skill yang disebut di query (DB-driven)
  try {
    const masters = await db.skill.findMany({ select: { name: true }, take: 400 });
    const lower = q.toLowerCase();
    const hit = masters.map((s) => s.name).filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .find((name) => lower.includes(name.toLowerCase()));
    f.skill = hit ?? null;
  } catch {
    f.skill = null;
  }

  const consumed = [
    f.city ?? "",
    ...(f.status ? [f.status.toLowerCase()] : []),
    ...(f.source ? [f.source.toLowerCase()] : []),
    ...(f.educationLevel ? [f.educationLevel.toLowerCase()] : []),
    ...(f.skill ? [f.skill] : []),
  ];

  // buang pola angka yang sudah terkonsumsi filter (N tahun / N juta / Rp …)
  let masked = q.replace(/\d{1,2}\s*\+?\s*tahun/gi, " ");
  if (f.maxExpectedSalary != null) {
    masked = masked
      .replace(/(?:\d+(?:[.,]\d+)?)\s*(?:juta|jt|ribu|rb)\b/gi, " ")
      .replace(/rp\.?\s*[\d.]{7,12}/gi, " ");
  }
  f.keyword = residueKeyword(masked, consumed);
  return f;
}

// ---- include & serializer ----

const SEARCH_INCLUDE = {
  referralEmployee: { select: { fullName: true } },
  _count: { select: { applications: true } },
  skills: { include: { skill: { select: { name: true } } } },
  educations: true,
  experiences: { orderBy: { startYear: "desc" as const } },
} satisfies Prisma.ApplicantInclude;

type ApplicantScan = Prisma.ApplicantGetPayload<{ include: typeof SEARCH_INCLUDE }>;

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 1) return "•••@***";
  return `${email.slice(0, 2)}•••${email.slice(at)}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function searchRowOf(
  a: ApplicantScan,
  tc: ReturnType<typeof tenantCryptoForDb>,
  moneyVisible: boolean,
  salaryPlain: number | null,
): AiSearchRow {
  const expYears = Math.round((a.totalExpMonths / 12) * 10) / 10;
  return {
    id: a.id,
    applicantNo: a.applicantNo,
    fullName: fullNameOf(a),
    firstName: a.firstName, middleName: a.middleName, lastName: a.lastName, displayName: a.displayName,
    status: a.status as ApplicantStatus,
    blacklist: a.blacklist,
    suspend: a.suspend,
    source: a.source,
    sourceLabel: a.source,
    dateApplied: a.dateApplied.toISOString(),
    dateAvailable: iso(a.dateAvailable),
    keepOnFileMonths: a.keepOnFileMonths,
    keepOnFileUntil: iso(a.keepOnFileUntil),
    emailMasked: maskEmail(tc.decryptText(a.email)),
    phoneMasked: maskPhone(tc.decryptText(a.phone)),
    city: tc.decryptText(a.city),
    birthDate: iso(a.birthDate),
    gender: a.gender,
    highestEduLevel: a.highestEduLevel,
    highestGpa: a.highestGpa,
    totalExpMonths: a.totalExpMonths,
    expectedSalary: moneyVisible ? salaryPlain : null,
    applicationCount: a._count.applications,
    referralName: a.referralEmployee?.fullName ?? null,
    totalExpYears: expYears,
    skills: a.skills.map((s) => s.skill?.name).filter((n): n is string => !!n),
  };
}

/** Deskripsi filter yang diterapkan (id/en) — transparansi utk UI. */
function describeFilter(f: SearchFilter, total: number, scanned: number, q: string, mode: "ai" | "simulated", lang: "id" | "en"): string {
  const parts: string[] = [`Query "${q.trim().slice(0, 120)}"`];
  if (f.status) parts.push(`status = ${f.status}`);
  if (f.source) parts.push(L(lang, `sumber = ${f.source}`, `source = ${f.source}`));
  if (f.educationLevel) parts.push(L(lang, `pendidikan mengandung "${f.educationLevel}"`, `education contains "${f.educationLevel}"`));
  if (f.minExpYears != null) parts.push(L(lang, `pengalaman ≥ ${f.minExpYears} tahun`, `experience ≥ ${f.minExpYears} years`));
  if (f.city) parts.push(L(lang, `kota mengandung "${f.city}" (filter in-memory — kolom terenkripsi)`, `city contains "${f.city}" (in-memory filter — encrypted column)`));
  if (f.maxExpectedSalary != null) parts.push(L(lang, `ekspektasi gaji ≤ ${rp(f.maxExpectedSalary)} (filter in-memory — vault uang)`, `expected salary ≤ ${rp(f.maxExpectedSalary)} (in-memory filter — money vault)`));
  if (f.skill) parts.push(L(lang, `keahlian mengandung "${f.skill}"`, `skill contains "${f.skill}"`));
  if (f.keyword) parts.push(L(lang, `kata kunci "${f.keyword}" (nama/posisi/bidang studi)`, `keyword "${f.keyword}" (name/position/field of study)`));
  if (parts.length === 1) parts.push(L(lang, "tanpa filter spesifik — menampilkan pelamar terbaru", "no specific filters — showing the latest applicants"));
  const label = mode === "ai"
    ? L(lang, "interpretasi AI", "AI interpretation")
    : L(lang, "interpretasi pola (simulasi — AI tidak tersedia)", "pattern interpretation (simulated — AI unavailable)");
  return L(
    lang,
    `${parts.join(" · ")} → ${total} pelamar cocok dari ${scanned} terpindai — ${label}.`,
    `${parts.join(" · ")} → ${total} matching applicants out of ${scanned} scanned — ${label}.`,
  );
}

/**
 * Pencarian natural-language talent pool.
 * q kosong → Error("Query kosong") (→ 400 di API). TIDAK pernah melempar error AI.
 */
export async function aiSearch(
  db: TenantDb,
  input: { q: string; limit?: number; moneyVisible?: boolean; lang?: "id" | "en" },
): Promise<AiSearchResult> {
  const q = (input.q ?? "").trim();
  if (!q) throw new Error("Query kosong");
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const moneyVisible = input.moneyVisible ?? false;
  const lang = input.lang === "en" ? "en" : "id";
  const tc = tenantCryptoForDb(db);

  // ---- interpretasi: AI → fallback simulated ----
  let mode: "ai" | "simulated" = "simulated";
  let filter: SearchFilter | null = null;

  const ai = await aiText(db, SEARCH_SYSTEM_PROMPT, q, { temperature: 0.1, maxTokens: 400 });
  if (ai) {
    const parsed = extractJson(ai);
    if (parsed && typeof parsed === "object") {
      const f = sanitizeAiFilter(parsed as Record<string, unknown>);
      f.city = detectCity(q); // kota selalu deteksi lokal (bukan keluaran AI)
      if (f.keyword && f.city) {
        // jangan biarkan nama kota mengotori kata kunci — sudah difilter via city
        const stripped = f.keyword.replace(new RegExp(f.city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ").replace(/\s+/g, " ").trim();
        f.keyword = stripped.length >= 3 ? stripped : null;
      }
      if (!isBlankFilter(f)) {
        filter = f;
        mode = "ai";
      }
    }
  }
  if (!filter) filter = await simulateFilter(db, q);

  // ---- fase SQL: hanya kolom non-enkripsi ----
  const where: Prisma.ApplicantWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.source) where.source = filter.source;
  if (filter.educationLevel) where.highestEduLevel = { contains: filter.educationLevel, mode: "insensitive" };
  if (filter.minExpYears != null) where.totalExpMonths = { gte: filter.minExpYears * 12 };

  const scanned = await db.applicant.findMany({
    where,
    include: SEARCH_INCLUDE,
    orderBy: [{ dateApplied: "desc" }, { applicantNo: "asc" }],
    take: SCAN_LIMIT,
  });

  // ---- fase in-memory: kota/gaji (terenkripsi) + keahlian + kata kunci ----
  const keywordLower = filter.keyword?.toLowerCase() ?? "";
  const skillLower = filter.skill?.toLowerCase() ?? "";
  const cityLower = filter.city?.toLowerCase() ?? "";

  const kept: { a: ApplicantScan; salary: number | null }[] = [];
  for (const a of scanned) {
    const salary = a.expectedSalary ? tc.decryptMoney(a.expectedSalary) ?? null : null;
    if (filter.maxExpectedSalary != null && (salary == null || salary > filter.maxExpectedSalary)) continue;

    if (cityLower) {
      const city = tc.decryptText(a.city);
      if (!city || !city.toLowerCase().includes(cityLower)) continue;
    }

    if (skillLower && !a.skills.some((s) => s.skill?.name?.toLowerCase().includes(skillLower))) continue;

    if (keywordLower) {
      // nama (polos) + SEMUA posisi/perusahaan pengalaman + bidang studi + institusi
      // (superset "posisi terakhir" — riwayat posisi tetap bukti relevansi kata kunci)
      const haystack = [
        fullNameOf(a),
        ...a.experiences.map((e) => `${e.position ?? ""} ${e.company ?? ""}`),
        ...a.educations.map((e) => e.fieldOfStudy ?? ""),
        a.institutionName ?? "",
      ].join(" | ").toLowerCase();
      if (!haystack.includes(keywordLower)) continue;
    }

    kept.push({ a, salary });
  }

  const rows = kept.slice(0, limit).map((k) => searchRowOf(k.a, tc, moneyVisible, k.salary));
  return {
    mode,
    interpreted: describeFilter(filter, kept.length, scanned.length, q, mode, lang),
    rows,
    total: kept.length,
  };
}

// ============================================================================
// 2) RECRUITER COPILOT — aksi terkurasi
// ============================================================================

const TERMINAL_STEP = ["Passed", "Failed", "Cancelled"];

// ---------- data loader kecil (dipakai beberapa aksi) ----------

interface CandidateBundle {
  candidate: { id: string; fullName: string; status: string; source: string };
  pr: { prNo: string; positionTitle: string | null; employmentStatus: string };
  applicant: {
    applicantNo: string | null;
    city: string | null;
    expectedSalary: number | null;
    totalExpMonths: number;
    educations: { level: string; fieldOfStudy: string | null; institution: string | null; graduationYear: number | null; gpa: number | null }[];
    experiences: { position: string | null; company: string | null; startYear: number | null; endYear: number | null; months: number | null }[];
    skills: string[];
  } | null;
  currentStep: { name: string; planDate: Date | null } | null;
  aiScore: { total: number; mode: string; factors: { factor: string; score: number; evidence: string }[] } | null;
  scorecardPanels: number;
}

async function loadCandidateBundle(db: TenantDb, candidateId: string): Promise<CandidateBundle> {
  if (!candidateId) throw new Error("candidateId wajib");
  const c = await db.jobCandidate.findUnique({
    where: { id: candidateId },
    include: {
      pr: { select: { prNo: true, employmentStatus: true, position: { select: { title: true } } } },
      applicant: {
        select: {
          applicantNo: true, city: true, expectedSalary: true, totalExpMonths: true,
          educations: { orderBy: { graduationYear: "desc" } },
          experiences: { orderBy: { startYear: "desc" } },
          skills: { include: { skill: { select: { name: true } } } },
        },
      },
      selectionSteps: {
        include: { selectionProcess: { select: { name: true } } },
        orderBy: { seqNo: "asc" },
      },
    },
  });
  if (!c) throw new Error("Kandidat tidak ditemukan");

  const tc = tenantCryptoForDb(db);
  const cur = c.selectionSteps.find((s) => !TERMINAL_STEP.includes(s.status)) ?? null;

  let aiScore: CandidateBundle["aiScore"] = null;
  const lastScore = await db.candidateAiScore.findFirst({
    where: { candidateId: c.id },
    orderBy: { generatedAt: "desc" },
  });
  if (lastScore) {
    try {
      const factors = JSON.parse(lastScore.factorsJson) as { factor: string; score: number; evidence: string }[];
      aiScore = { total: lastScore.total, mode: lastScore.mode, factors };
    } catch {
      aiScore = { total: lastScore.total, mode: lastScore.mode, factors: [] };
    }
  }

  const scorecardPanels = await db.candidateScorecard.count({
    where: { candidateId: c.id, submittedAt: { not: null } },
  });

  return {
    candidate: { id: c.id, fullName: c.fullName, status: c.status, source: c.source },
    pr: { prNo: c.pr.prNo, positionTitle: c.pr.position?.title ?? null, employmentStatus: c.pr.employmentStatus },
    applicant: c.applicant
      ? {
          applicantNo: c.applicant.applicantNo,
          city: tc.decryptText(c.applicant.city),
          expectedSalary: c.applicant.expectedSalary ? tc.decryptMoney(c.applicant.expectedSalary) ?? null : null,
          totalExpMonths: c.applicant.totalExpMonths,
          educations: c.applicant.educations.map((e) => ({
            level: e.level, fieldOfStudy: e.fieldOfStudy, institution: e.institution,
            graduationYear: e.graduationYear, gpa: e.gpa,
          })),
          experiences: c.applicant.experiences.map((e) => ({
            position: e.position, company: e.company, startYear: e.startYear, endYear: e.endYear, months: e.months,
          })),
          skills: c.applicant.skills.map((s) => s.skill?.name).filter((n): n is string => !!n),
        }
      : null,
    currentStep: cur ? { name: cur.selectionProcess.name, planDate: cur.planDate } : null,
    aiScore,
    scorecardPanels,
  };
}

const MONTHS_SHORT: Record<"id" | "en", string[]> = {
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const fmtDateId = (d: Date | null | undefined, lang: "id" | "en" = "id"): string =>
  !d ? "—" : `${d.getDate()} ${MONTHS_SHORT[lang][d.getMonth()]} ${d.getFullYear()}`;

// ---------- draft-jd ----------

async function copilotDraftJd(db: TenantDb, params: Record<string, unknown>, lang: "id" | "en"): Promise<CopilotResult> {
  const prId = String(params.prId ?? "");
  if (!prId) throw new Error("prId wajib");
  const pr = await db.personnelRequisition.findUnique({
    where: { id: prId },
    select: {
      prNo: true, employmentStatus: true, requiredNo: true, reason: true,
      miscSpec: true, additionalQualification: true,
      position: { select: { title: true } },
      job: { select: { title: true } },
      orgUnit: { select: { name: true } },
      companyOffice: { select: { name: true, city: true } },
      openings: {
        select: {
          titleToShow: true, salaryMin: true, salaryMax: true,
          workLocation: { select: { name: true, city: true } },
          jobDescSummary: true, jobSpecSummary: true,
        },
        take: 5,
      },
    },
  });
  if (!pr) throw new Error("PR tidak ditemukan");

  // slot JO: rentang gaji IKLAN publik by design (bukan salaryBudget vault —
  // data uang internal TIDAK didekripsi utk dimasukkan ke teks JD).
  const slot = pr.openings[0] ?? null;
  const title = pr.position?.title ?? pr.job?.title ?? slot?.titleToShow ?? pr.prNo;
  const data = {
    pr_no: pr.prNo,
    posisi: title,
    unit_organisasi: pr.orgUnit?.name ?? null,
    kantor: pr.companyOffice?.name ?? null,
    lokasi: slot?.workLocation?.name ?? slot?.workLocation?.city ?? pr.companyOffice?.city ?? null,
    status_kerja: pr.employmentStatus,
    kebutuhan_orang: pr.requiredNo,
    alasan: pr.reason ?? null,
    spesifikasi_lain: pr.miscSpec ?? null,
    kualifikasi_tambahan: pr.additionalQualification ?? null,
    ringkasan_tugas_iklan: slot?.jobDescSummary ?? null,
    ringkasan_kualifikasi_iklan: slot?.jobSpecSummary ?? null,
    rentang_gaji_iklan: slot?.salaryMin != null && slot?.salaryMax != null
      ? `${rp(slot.salaryMin)}–${rp(slot.salaryMax)}`
      : null,
  };

  const ai = await aiText(
    db,
    "Kamu copywriter lowongan kerja Indonesia profesional. Buat job description ringkas profesional (judul; tentang peran; tanggung jawab 5-7 bullet; kualifikasi 5-7 bullet; info gaji rentang bila ada; cara melamar via portal karir). Bahasa Indonesia."
      + ` ${LANG_LINE(lang)}`,
    JSON.stringify(data),
    { temperature: 0.4, maxTokens: 1800 },
  );
  if (ai) return { mode: "ai", text: ai };

  // fallback simulated — template jelas-meski-tapi-informatif dari field PR
  const duties = (slot?.jobDescSummary ?? "").split(/\n+|;\s*/).map((s) => s.trim()).filter(Boolean);
  while (duties.length < 5) {
    duties.push([
      L(lang, `Menjalankan tanggung jawab utama sesuai deskripsi posisi ${title}.`, `Carry out the core responsibilities described for the ${title} position.`),
      L(lang, "Berkolaborasi lintas tim untuk mencapai target kerja unit.", "Collaborate across teams to meet the work unit's targets."),
      L(lang, "Menyusun & melaporkan hasil pekerjaan secara berkala ke atasan.", "Prepare & report work results to the supervisor on a regular basis."),
      L(lang, "Memastikan kepatuhan prosedur & kebijakan perusahaan.", "Ensure compliance with company procedures & policies."),
      L(lang, "Berpartisipasi dalam perbaikan proses berkelanjutan.", "Participate in continuous process improvement."),
    ][duties.length] ?? L(lang, "Melaksanakan tugas lain sesuai arahan atasan.", "Carry out other tasks as instructed by the supervisor."));
  }
  const quals = [
    ...(pr.additionalQualification ?? "").split(/\n+|;\s*/).map((s) => s.trim()).filter(Boolean),
    ...(pr.miscSpec ?? "").split(/\n+|;\s*/).map((s) => s.trim()).filter(Boolean),
    ...(slot?.jobSpecSummary ?? "").split(/\n+|;\s*/).map((s) => s.trim()).filter(Boolean),
  ].slice(0, 7);
  while (quals.length < 5) quals.push(L(lang, "Kualifikasi sesuai kebutuhan posisi (rincian tersedia saat proses).", "Qualifications per the position's requirements (details available during the process)."));

  const lines = [
    `${title}${pr.orgUnit ? ` — ${pr.orgUnit.name}` : ""}`,
    L(
      lang,
      `${pr.employmentStatus} · kebutuhan ${pr.requiredNo} orang${data.lokasi ? ` · lokasi ${data.lokasi}` : ""} · ref ${pr.prNo}`,
      `${pr.employmentStatus} · ${pr.requiredNo} ${pr.requiredNo === 1 ? "opening" : "openings"}${data.lokasi ? ` · location ${data.lokasi}` : ""} · ref ${pr.prNo}`,
    ),
    "",
    L(lang, "Tentang Peran", "About the Role"),
    pr.reason ?? L(lang, `Posisi ${title} dibuka untuk mendukung kebutuhan operasional unit kerja.`, `The ${title} position is opened to support the work unit's operational needs.`),
    "",
    L(lang, "Tanggung Jawab", "Responsibilities"),
    ...duties.slice(0, 7).map((d) => `- ${d}`),
    "",
    L(lang, "Kualifikasi", "Qualifications"),
    ...quals.map((qq) => `- ${qq}`),
    "",
    data.rentang_gaji_iklan
      ? L(lang, `Gaji: ${data.rentang_gaji_iklan} (rentang iklan slot lowongan).`, `Salary: ${data.rentang_gaji_iklan} (advertised range for the job slot).`)
      : L(lang, "Gaji: dibahas saat proses rekrutmen.", "Salary: to be discussed during the recruitment process."),
    L(lang, "Cara Melamar: kirim lamaran melalui portal karir perusahaan.", "How to Apply: submit your application via the company's careers portal."),
    "",
    L(
      lang,
      "— Dibuat otomatis (mode simulasi — AI tidak tersedia) dari data PR; silakan sunting sebelum dipublikasikan.",
      "— Auto-generated (simulated mode — AI unavailable) from PR data; please edit before publishing.",
    ),
  ];
  return { mode: "simulated", text: lines.join("\n") };
}

// ---------- summarize-candidate ----------

async function copilotSummarize(db: TenantDb, params: Record<string, unknown>, lang: "id" | "en"): Promise<CopilotResult> {
  const bundle = await loadCandidateBundle(db, String(params.candidateId ?? ""));
  const { candidate, pr, applicant, currentStep, aiScore, scorecardPanels } = bundle;

  const data = {
    nama: candidate.fullName,
    sumber: candidate.source,
    posisi_dilamar: pr.positionTitle,
    pr: pr.prNo,
    status_kandidat: candidate.status,
    tahap_aktif: currentStep?.name ?? "—",
    scorecard_panel_submitted: scorecardPanels,
    pendidikan: applicant?.educations ?? [],
    pengalaman: applicant?.experiences ?? [],
    total_bulan_pengalaman: applicant?.totalExpMonths ?? 0,
    keahlian: applicant?.skills ?? [],
    kota: applicant?.city ?? null,
    ekspektasi_gaji: applicant?.expectedSalary ?? null,
    skor_ai_terakhir: aiScore ? { total: aiScore.total, mode: aiScore.mode, faktor: aiScore.factors.map((f) => `${f.factor}: ${f.score} (${f.evidence})`) } : null,
  };

  const ai = await aiText(
    db,
    "Ringkas profil kandidat rekrutmen jadi 5 poin utama + 1 kalimat rekomendasi. Objektif dari data saja."
      + ` ${LANG_LINE(lang)}`,
    JSON.stringify(data),
    { temperature: 0.3, maxTokens: 900 },
  );
  if (ai) return { mode: "ai", text: ai };

  // fallback: 5 baris fakta dari data
  const edu = applicant?.educations[0];
  const lastExp = applicant?.experiences[0];
  const years = applicant ? Math.round((applicant.totalExpMonths / 12) * 10) / 10 : 0;
  const lines = [
    L(
      lang,
      `Ringkasan Kandidat — ${candidate.fullName}${applicant?.applicantNo ? ` (${applicant.applicantNo})` : ""}`,
      `Candidate Summary — ${candidate.fullName}${applicant?.applicantNo ? ` (${applicant.applicantNo})` : ""}`,
    ),
    "",
    L(
      lang,
      `1. Pendidikan: ${edu ? `${edu.level}${edu.fieldOfStudy ? ` ${edu.fieldOfStudy}` : ""}${edu.institution ? ` — ${edu.institution}` : ""}${edu.gpa != null ? ` (IPK ${edu.gpa.toFixed(2)})` : ""}` : "belum terdata pada profil pelamar"}.`,
      `1. Education: ${edu ? `${edu.level}${edu.fieldOfStudy ? ` ${edu.fieldOfStudy}` : ""}${edu.institution ? ` — ${edu.institution}` : ""}${edu.gpa != null ? ` (GPA ${edu.gpa.toFixed(2)})` : ""}` : "not yet recorded on the applicant profile"}.`,
    ),
    L(
      lang,
      `2. Pengalaman: ±${years} tahun${lastExp ? ` — terakhir ${lastExp.position ?? "-"}${lastExp.company ? ` di ${lastExp.company}` : ""}` : " — belum ada riwayat tercatat"}.`,
      `2. Experience: ~${years} years${lastExp ? ` — latest ${lastExp.position ?? "-"}${lastExp.company ? ` at ${lastExp.company}` : ""}` : " — no recorded history yet"}.`,
    ),
    L(
      lang,
      `3. Keahlian: ${applicant?.skills.length ? applicant.skills.join(", ") : "belum terdata"}.`,
      `3. Skills: ${applicant?.skills.length ? applicant.skills.join(", ") : "not yet recorded"}.`,
    ),
    L(
      lang,
      `4. Pipeline: ${candidate.status} di ${pr.prNo}${pr.positionTitle ? ` (${pr.positionTitle})` : ""} — tahap aktif: ${currentStep?.name ?? "—"}${scorecardPanels > 0 ? ` (${scorecardPanels} scorecard panel terisi)` : ""}.`,
      `4. Pipeline: ${candidate.status} in ${pr.prNo}${pr.positionTitle ? ` (${pr.positionTitle})` : ""} — active stage: ${currentStep?.name ?? "—"}${scorecardPanels > 0 ? ` (${scorecardPanels} scorecard panel${scorecardPanels > 1 ? "s" : ""} submitted)` : ""}.`,
    ),
    L(
      lang,
      `5. Skor AI terakhir: ${aiScore ? `${aiScore.total.toFixed(1)}/100 (${aiScore.mode})` : "belum ada skor"}. Ekspektasi gaji: ${applicant?.expectedSalary != null ? rp(applicant.expectedSalary) : "—"}.`,
      `5. Latest AI score: ${aiScore ? `${aiScore.total.toFixed(1)}/100 (${aiScore.mode})` : "no score yet"}. Expected salary: ${applicant?.expectedSalary != null ? rp(applicant.expectedSalary) : "—"}.`,
    ),
    "",
    L(
      lang,
      `Rekomendasi: ${aiScore ? (aiScore.total >= 70 ? "diprioritaskan untuk lanjut ke tahap berikutnya." : aiScore.total >= 55 ? "layak dilanjutkan ke tahap berikutnya." : "tinjau kelengkapan data & hasil tahap sebelum lanjut.") : "lengkapi data profil & hasil penilaian sebelum memutuskan."}`,
      `Recommendation: ${aiScore ? (aiScore.total >= 70 ? "prioritize to advance to the next stage." : aiScore.total >= 55 ? "worth advancing to the next stage." : "review data completeness & stage results before advancing.") : "complete the profile data & assessment results before deciding."}`,
    ),
    "",
    L(
      lang,
      "— Ringkasan otomatis (mode simulasi — AI tidak tersedia); keputusan tetap pada recruiter.",
      "— Automated summary (simulated mode — AI unavailable); the decision remains with the recruiter.",
    ),
  ];
  return { mode: "simulated", text: lines.join("\n") };
}

// ---------- interview-questions ----------

async function copilotInterview(db: TenantDb, params: Record<string, unknown>, lang: "id" | "en"): Promise<CopilotResult> {
  const candidateId = String(params.candidateId ?? "");
  if (!candidateId) throw new Error("candidateId wajib");
  const c = await db.jobCandidate.findUnique({
    where: { id: candidateId },
    include: {
      pr: { select: { id: true, prNo: true, position: { select: { title: true } } } },
      selectionSteps: {
        include: { selectionProcess: { select: { id: true, name: true } } },
        orderBy: { seqNo: "asc" },
      },
    },
  });
  if (!c) throw new Error("Kandidat tidak ditemukan");

  const rubric: RubricFactor[] = await getRubric(db, c.pr.id);

  // scorecard template tahap aktif bila ada (kompetensi anchored 1–5)
  const cur = c.selectionSteps.find((s) => !TERMINAL_STEP.includes(s.status)) ?? null;
  let templateCompetencies: { name: string; description: string | null }[] = [];
  if (cur) {
    const tpl = await db.scorecardTemplate.findFirst({
      where: { active: true, OR: [{ selectionProcessId: cur.selectionProcess.id }, { selectionProcessId: null }] },
      include: { competencies: { orderBy: { orderNo: "asc" } } },
    });
    if (tpl) templateCompetencies = tpl.competencies.map((k) => ({ name: k.name, description: k.description }));
  }

  const data = {
    kandidat: c.fullName,
    posisi_dilamar: c.pr.position?.title ?? null,
    pr: c.pr.prNo,
    tahap_aktif: cur?.selectionProcess.name ?? "—",
    rubrik_skor_pr: rubric.map((r) => ({ kompetensi: r.name, panduan: r.guide ?? undefined })),
    kompetensi_scorecard: templateCompetencies,
  };

  const ai = await aiText(
    db,
    "Buat 8 pertanyaan interview terstruktur (campuran behavioral & teknis) berdasarkan rubrik/kompetensi ini, masing-masing 1 baris + indikator jawaban baik singkat."
      + ` ${LANG_LINE(lang)}`,
    JSON.stringify(data),
    { temperature: 0.4, maxTokens: 1500 },
  );
  if (ai) return { mode: "ai", text: ai };

  // fallback: pertanyaan generik per kompetensi rubrik/scorecard
  const comps = [
    ...rubric.map((r) => ({ name: r.name, guide: r.guide ?? null })),
    ...templateCompetencies.map((t) => ({ name: t.name, guide: t.description })),
  ].slice(0, 8);
  const generic = [
    { name: L(lang, "Pengalaman relevan", "Relevant experience"), guide: null },
    { name: L(lang, "Pemecahan masalah", "Problem solving"), guide: null },
    { name: L(lang, "Kolaborasi tim", "Team collaboration"), guide: null },
    { name: L(lang, "Motivasi & kecocokan peran", "Motivation & role fit"), guide: null },
    { name: L(lang, "Etos kerja & manajemen waktu", "Work ethic & time management"), guide: null },
    { name: L(lang, "Kommunikasi", "Communication"), guide: null },
    { name: L(lang, "Adaptabilitas terhadap perubahan", "Adaptability to change"), guide: null },
    { name: L(lang, "Rencana pengembangan diri", "Self-development plan"), guide: null },
  ];
  while (comps.length < 8) comps.push(generic[comps.length]!);

  const lines = [
    L(
      lang,
      `Pertanyaan Interview Terstruktur — ${c.fullName}${c.pr.position?.title ? ` (${c.pr.position.title})` : ""} · tahap ${cur?.selectionProcess.name ?? "—"}`,
      `Structured Interview Questions — ${c.fullName}${c.pr.position?.title ? ` (${c.pr.position.title})` : ""} · stage ${cur?.selectionProcess.name ?? "—"}`,
    ),
    "",
    ...comps.slice(0, 8).map((comp, i) => {
      const kind = i % 2 === 0 ? "Behavioral" : L(lang, "Teknis", "Technical");
      const q = kind === "Behavioral"
        ? L(
          lang,
          `Ceritakan situasi nyata yang paling menunjukkan ${comp.name.toLowerCase()} Anda — apa peran Anda dan hasilnya?`,
          `Tell us about a real situation that best demonstrates your ${comp.name.toLowerCase()} — what was your role and the outcome?`,
        )
        : L(
          lang,
          `Bagaimana Anda menerapkan ${comp.name.toLowerCase()} dalam pekerjaan sehari-hari${comp.guide ? ` (${comp.guide})` : ""}?`,
          `How do you apply ${comp.name.toLowerCase()} in your day-to-day work${comp.guide ? ` (${comp.guide})` : ""}?`,
        );
      return `${i + 1}. [${kind}] ${q}\n   ${L(lang, "Indikator jawaban baik: menjelaskan contoh spesifik dengan hasil terukur & refleksi.", "Good-answer indicator: explains a specific example with measurable results & reflection.")}`;
    }),
    "",
    L(
      lang,
      "— Disusun otomatis (mode simulasi — AI tidak tersedia) dari rubrik PR & kompetensi scorecard.",
      "— Auto-generated (simulated mode — AI unavailable) from the PR rubric & scorecard competencies.",
    ),
  ];
  return { mode: "simulated", text: lines.join("\n") };
}

// ---------- outreach ----------

async function copilotOutreach(db: TenantDb, params: Record<string, unknown>, lang: "id" | "en"): Promise<CopilotResult> {
  const channel = String(params.channel ?? "email") === "wa" ? "wa" : "email";
  const bundle = await loadCandidateBundle(db, String(params.candidateId ?? ""));
  const { candidate, pr, applicant, currentStep } = bundle;

  const data = {
    nama_kandidat: candidate.fullName,
    posisi: pr.positionTitle ?? `posisi pada ${pr.prNo}`,
    pr: pr.prNo,
    tahap_selanjutnya: currentStep?.name ?? "tahap seleksi lanjutan",
    jadwal: currentStep?.planDate ? fmtDateId(currentStep.planDate, lang) : null,
    kota: applicant?.city ?? null,
    sumber_kandidat: candidate.source,
  };

  const ai = await aiText(
    db,
    channel === "wa"
      ? "Kamu recruiter Indonesia profesional. Buat pesan WhatsApp undangan lanjutan proses rekrutmen: SOPAN, maksimal 3 baris, tanpa markdown, tanpa embel-embel berlebihan. Bahasa Indonesia."
        + ` ${LANG_LINE(lang)}`
      : "Kamu recruiter Indonesia profesional. Buat email formal undangan lanjutan proses rekrutmen: tepat 3 paragraf (pembuka & apresiasi; undangan tahap berikutnya + jadwal; penutup & cara konfirmasi), sertakan baris subjek. Bahasa Indonesia."
        + ` ${LANG_LINE(lang)}`,
    JSON.stringify(data),
    { temperature: 0.5, maxTokens: 900 },
  );
  if (ai) return { mode: "ai", text: ai };

  // fallback template
  const stage = currentStep?.name ?? L(lang, "tahap seleksi lanjutan", "the next selection stage");
  const when = currentStep?.planDate ? fmtDateId(currentStep.planDate, lang) : L(lang, "akan dikonfirmasi", "to be confirmed");
  if (channel === "wa") {
    return {
      mode: "simulated",
      text: [
        L(lang, `Yth. ${candidate.fullName},`, `Dear ${candidate.fullName},`),
        L(
          lang,
          `Kami mengundang Anda mengikuti ${stage} proses rekrutmen ${pr.positionTitle ?? ""} (${pr.prNo}) — jadwal: ${when}.`,
          `We invite you to attend the ${stage} of the ${pr.positionTitle ?? ""} recruitment process (${pr.prNo}) — scheduled: ${when}.`,
        ),
        L(
          lang,
          `Mohon konfirmasi kehadiran dengan membalas pesan ini. Terima kasih. — Tim Rekrutmen`,
          `Please confirm your attendance by replying to this message. Thank you. — Recruitment Team`,
        ),
        "",
        L(lang, "— Draf otomatis (mode simulasi — AI tidak tersedia).", "— Automated draft (simulated mode — AI unavailable)."),
      ].join("\n"),
    };
  }
  return {
    mode: "simulated",
    text: [
      L(lang, `Perihal: Undangan Lanjutan Proses Rekrutmen — ${pr.positionTitle ?? pr.prNo}`, `Subject: Recruitment Next-Step Invitation — ${pr.positionTitle ?? pr.prNo}`),
      "",
      L(lang, `Yth. ${candidate.fullName},`, `Dear ${candidate.fullName},`),
      "",
      L(
        lang,
        `Terima kasih atas ketertarikan Anda pada posisi ${pr.positionTitle ?? "yang dilamar"} (${pr.prNo}). Melalui email ini kami ingin menyampaikan bahwa Anda dinyatakan lolos untuk mengikuti tahap selanjutnya dari proses seleksi kami.`,
        `Thank you for your interest in the ${pr.positionTitle ?? "applied"} position (${pr.prNo}). Through this email, we would like to inform you that you have passed to the next stage of our selection process.`,
      ),
      "",
      L(
        lang,
        `Tahap berikutnya adalah ${stage}, dijadwalkan pada ${when}. Mohon kesediaan Anda untuk menghadiri sesuai jadwal tersebut; detail teknis akan kami sampaikan lebih lanjut.`,
        `The next stage is ${stage}, scheduled for ${when}. We kindly request your availability to attend as scheduled; technical details will be shared with you shortly.`,
      ),
      "",
      L(
        lang,
        "Apabila terdapat kendala jadwal atau pertanyaan, silakan membalas email ini. Kami menantikan kehadiran Anda dan mengucapkan sukses untuk persiapan.",
        "Should you have scheduling conflicts or questions, please reply to this email. We look forward to your attendance and wish you the best in your preparation.",
      ),
      "",
      L(lang, "Hormat kami,", "Sincerely,"),
      L(lang, "Tim Rekrutmen", "Recruitment Team"),
      "",
      L(lang, "— Draf otomatis (mode simulasi — AI tidak tersedia); mohon sunting sebelum dikirim.", "— Automated draft (simulated mode — AI unavailable); please edit before sending."),
    ].join("\n"),
  };
}

// ---------- pipeline-qa ----------

async function buildPipelineData(db: TenantDb, lang: "id" | "en"): Promise<Record<string, unknown>> {
  const [activePrs, groups, activeCands, openSlots, stagingPending, hiredTotal] = await Promise.all([
    db.personnelRequisition.findMany({
      where: { status: { in: ["Submitted", "Approved", "OnHold"] } },
      select: { id: true, prNo: true, status: true, requiredNo: true, position: { select: { title: true } } },
      orderBy: { prNo: "asc" }, take: 15,
    }),
    db.jobCandidate.groupBy({ by: ["prId", "status"], _count: { _all: true } }),
    db.jobCandidate.findMany({
      where: { status: { in: ["Nominated", "InProcess"] } },
      select: {
        prId: true, fullName: true, status: true,
        selectionSteps: { select: { status: true, selectionProcess: { select: { name: true } } }, orderBy: { seqNo: "asc" } },
      },
      take: 150,
    }),
    db.jobOpening.count({ where: { status: "Open" } }),
    db.publicApplication.count({ where: { status: "Pending" } }),
    db.jobCandidate.count({ where: { status: "Hired" } }),
  ]);

  // lengkapi PR yang punya kandidat tapi non-aktif (mis. Fulfilled) supaya Q&A akurat
  const extraIds = [...new Set(groups.map((g) => g.prId))].filter((id) => !activePrs.some((p) => p.id === id));
  const extraPrs = extraIds.length > 0
    ? await db.personnelRequisition.findMany({
        where: { id: { in: extraIds } },
        select: { id: true, prNo: true, status: true, requiredNo: true, position: { select: { title: true } } },
        take: 15,
      })
    : [];
  const allPrs = [...activePrs, ...extraPrs];
  const prById = new Map(allPrs.map((p) => [p.id, p]));

  const byPr = new Map<string, Record<string, number>>();
  for (const g of groups) {
    const cur = byPr.get(g.prId) ?? {};
    cur[g.status] = (cur[g.status] ?? 0) + g._count._all;
    byPr.set(g.prId, cur);
  }
  const activeByPr = new Map<string, { stage: string; names: string[] }[]>();
  for (const c of activeCands) {
    const cur = c.selectionSteps.find((s) => !TERMINAL_STEP.includes(s.status));
    const stage = cur?.selectionProcess.name ?? L(lang, "Belum ada tahap", "No stage yet");
    const list = activeByPr.get(c.prId) ?? [];
    const bucket = list.find((x) => x.stage === stage);
    if (bucket) bucket.names.push(c.fullName);
    else list.push({ stage, names: [c.fullName] });
    activeByPr.set(c.prId, list);
  }

  return {
    pr_aktif_total: activePrs.length,
    slot_lowongan_terbuka: openSlots,
    lamaran_publik_menunggu_verifikasi: stagingPending,
    total_kandidat_dihire: hiredTotal,
    per_pr: allPrs.map((p) => ({
      pr_no: p.prNo,
      posisi: p.position?.title ?? null,
      status_pr: p.status,
      kebutuhan_orang: p.requiredNo,
      kandidat_per_status: byPr.get(p.id) ?? {},
      kandidat_aktif: (activeByPr.get(p.id) ?? []).map((x) => ({ tahap: x.stage, kandidat: x.names })),
    })),
  };
}

async function copilotPipelineQa(db: TenantDb, params: Record<string, unknown>, lang: "id" | "en"): Promise<CopilotResult> {
  const question = String(params.q ?? "").trim();
  if (!question) throw new Error("q wajib");

  const data = await buildPipelineData(db, lang);

  const ai = await aiText(
    db,
    "Jawab pertanyaan recruiter tentang pipeline rekrutmen berdasar DATA berikut. Ringkas, angka akurat, sebutkan nama bila relevan."
      + ` ${LANG_LINE(lang)}`,
    `${JSON.stringify(data)}\n\nPertanyaan: ${question}`,
    { temperature: 0.2, maxTokens: 900 },
  );
  if (ai) return { mode: "ai", text: ai };

  // fallback: ringkasan data mentah
  const perPr = (data.per_pr as {
    pr_no: string; posisi: string | null; status_pr: string;
    kandidat_per_status: Record<string, number>;
    kandidat_aktif: { tahap: string; kandidat: string[] }[];
  }[]);
  const lines = [
    L(
      lang,
      "Ringkasan pipeline rekrutmen (data mentah — mode simulasi, AI tidak tersedia):",
      "Recruitment pipeline summary (raw data — simulated mode, AI unavailable):",
    ),
    L(
      lang,
      `- PR aktif: ${data.pr_aktif_total} · slot lowongan terbuka: ${data.slot_lowongan_terbuka} · lamaran publik menunggu verifikasi: ${data.lamaran_publik_menunggu_verifikasi} · total kandidat hired: ${data.total_kandidat_dihire}`,
      `- Active PRs: ${data.pr_aktif_total} · open job slots: ${data.slot_lowongan_terbuka} · public applications pending verification: ${data.lamaran_publik_menunggu_verifikasi} · total candidates hired: ${data.total_kandidat_dihire}`,
    ),
    "",
    ...perPr.map((p) => {
      const status = Object.entries(p.kandidat_per_status).map(([k, v]) => `${v} ${k}`).join(", ") || L(lang, "belum ada kandidat", "no candidates yet");
      const aktif = p.kandidat_aktif.map((a) => `${a.tahap}: ${a.kandidat.join(", ")}`).join("; ") || "—";
      return L(
        lang,
        `- ${p.pr_no}${p.posisi ? ` (${p.posisi})` : ""} [${p.status_pr}]: ${status}. Kandidat aktif — ${aktif}`,
        `- ${p.pr_no}${p.posisi ? ` (${p.posisi})` : ""} [${p.status_pr}]: ${status}. Active candidates — ${aktif}`,
      );
    }),
    "",
    L(
      lang,
      `Pertanyaan Anda: "${question}" — jawaban rinci memerlukan AI; data di atas adalah fakta pipeline saat ini.`,
      `Your question: "${question}" — a detailed answer requires AI; the data above reflects the pipeline as of now.`,
    ),
  ];
  return { mode: "simulated", text: lines.join("\n") };
}

// ---------- check-bias (HRX B6) ----------

interface BiasFinding {
  phrase: string;
  issue: string;
  suggestion: string;
}

const BIAS_RULES: { issue: string; suggestion: string; suggestionEn: string; phrases: string[] }[] = [
  {
    issue: "gender",
    suggestion: "Hapus referensi gender — cukup tulis 'kandidat' (semua gender dipersilakan melamar)",
    suggestionEn: "Remove the gender reference — just write 'candidate' (all genders are welcome to apply)",
    phrases: [
      "pria/wanita", "laki-laki/perempuan", "laki laki", "pria", "wanita", "laki-laki",
      "perempuan", "lelaki", "cewek", "cowok", "maskulin", "feminin", "gentleman", "guys",
    ],
  },
  {
    issue: "usia",
    suggestion: "Hapus batasan usia — gunakan kriteria kompetensi/kualifikasi (batasan usia berisiko diskriminatif)",
    suggestionEn: "Remove the age limit — use competency/qualification criteria instead (age limits carry discrimination risk)",
    phrases: [
      "di bawah 30", "dibawah 30", "di bawah 35", "di atas 40", "di atas 30", "usia maks",
      "usia maksimal", "maksimal usia", "umur maks", "max 30 tahun", "max 35 tahun",
      "muda", "remaja", "fresh graduate only", "fresh",
    ],
  },
  {
    issue: "penampilan",
    suggestion: "Hapus kriteria penampilan fisik — tidak relevan dengan kompetensi kerja",
    suggestionEn: "Remove the physical appearance criterion — it is not relevant to job competency",
    phrases: ["menarik", "cantik", "tampan", "good looking", "berpenampilan menarik"],
  },
  {
    issue: "status",
    suggestion: "Hapus syarat status pernikahan — masuk ranah privasi & berisiko diskriminatif",
    suggestionEn: "Remove the marital-status requirement — it is a privacy matter & carries discrimination risk",
    phrases: ["belum menikah", "lajang", "single", "menikah", "berstatus single"],
  },
  {
    issue: "fisik",
    suggestion: "Hapus syarat fisik (tinggi/postur) kecuali benar-benar syarat esensial pekerjaan yang terukur (BFOQ)",
    suggestionEn: "Remove the physical requirement (height/build) unless it is truly a measurable, essential job requirement (BFOQ)",
    phrases: ["tinggi minimal", "postur", "berpostur", "minimal tb"],
  },
];

/** Regex tambahan utk pola angka usia ("usia maks 35", "maks. 30 thn", "dibawah 28 tahun"). */
const BIAS_AGE_REGEXES = [
  /\b(?:usia|umur)\s*(?:maks(?:imal)?|max|paling tinggi)?\s*\.?\s*\d{2}\s*(?:tahun|thn|th)?\b/gi,
  /\b(?:di\s?bawah|di\s?atas|dibawah|diatas)\s*\d{2}\s*(?:tahun|thn|th)?\b/gi,
  /\bmaks(?:imal)?\s*\.?\s*\d{2}\s*(?:tahun|thn|th)\b/gi,
];

function staticBiasFindings(text: string, lang: "id" | "en"): BiasFinding[] {
  const lower = text.toLowerCase();
  const spans: [number, number][] = [];
  const taken = (s: number, e: number) => spans.some(([a, b]) => s < b && e > a);

  const candidates: BiasFinding[] = [];
  for (const rule of BIAS_RULES) {
    for (const phrase of rule.phrases) {
      candidates.push({ phrase, issue: rule.issue, suggestion: L(lang, rule.suggestion, rule.suggestionEn) });
    }
  }
  for (const re of BIAS_AGE_REGEXES) {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(lower))) {
      candidates.push({
        phrase: m[0].trim(),
        issue: "usia",
        suggestion: L(lang, BIAS_RULES[1]!.suggestion, BIAS_RULES[1]!.suggestionEn),
      });
    }
  }

  // frasa terpanjang menang → "belum menikah" tidak terpotong jadi "menikah" dobel
  candidates.sort((a, b) => b.phrase.length - a.phrase.length);
  const out: BiasFinding[] = [];
  for (const c of candidates) {
    if (!c.phrase) continue;
    let from = 0;
    for (;;) {
      const i = lower.indexOf(c.phrase, from);
      if (i < 0) break;
      if (!taken(i, i + c.phrase.length)) {
        spans.push([i, i + c.phrase.length]);
        out.push(c);
        break;
      }
      from = i + 1;
    }
  }
  return out;
}

const BIAS_ISSUE_LABEL: Record<string, string> = {
  gender: "gender", age: "usia", usia: "usia", appearance: "penampilan", penampilan: "penampilan",
  status: "status", fisik: "fisik", physical: "fisik", lainnya: "lainnya", other: "lainnya",
};

/** Label kategori temuan utk tampilan EN (internal tetap key ID — BL-REC-3). */
const BIAS_ISSUE_LABEL_EN: Record<string, string> = {
  gender: "gender", usia: "age", penampilan: "appearance", status: "status", fisik: "physical", lainnya: "other",
};

async function copilotCheckBias(db: TenantDb, params: Record<string, unknown>, lang: "id" | "en"): Promise<CopilotResult> {
  const text = String(params.text ?? "").trim();
  if (!text) throw new Error("text wajib");

  const findings = staticBiasFindings(text, lang);
  const seen = (phrase: string) => findings.some((f) => {
    const a = f.phrase.toLowerCase();
    const b = phrase.toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  });

  let mode: "ai" | "simulated" = "simulated";
  let aiParticipated = false;
  const ai = await aiText(
    db,
    'Deteksi frasa berpotensi diskriminatif/bias dalam teks lowongan. Output HANYA JSON {"findings":[{"phrase":"","issue":"gender|age|appearance|status|fisik|lainnya","suggestion":"pengganti netral"}]}'
      + ` ${LANG_LINE(lang)}`,
    text,
    { temperature: 0.1, maxTokens: 900 },
  );
  if (ai) {
    const parsed = extractJson(ai);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { findings?: unknown }).findings)) {
      aiParticipated = true; // AI menghasilkan JSON sah — ikut serta (walau temuan terdedupe)
      for (const f of (parsed as { findings: Record<string, unknown>[] }).findings) {
        const phrase = typeof f?.phrase === "string" ? f.phrase.trim().slice(0, 120) : "";
        if (!phrase || !text.toLowerCase().includes(phrase.toLowerCase())) continue; // jangan halusinasi frasa
        if (seen(phrase)) continue; // dedupe vs statis
        const rawIssue = typeof f?.issue === "string" ? f.issue.trim().toLowerCase() : "lainnya";
        const issue = BIAS_ISSUE_LABEL[rawIssue] ?? "lainnya";
        const suggestion = typeof f?.suggestion === "string" && f.suggestion.trim()
          ? f.suggestion.trim().slice(0, 200)
          : L(lang, "Ganti frasa dengan kriteria netral berbasis kompetensi", "Replace the phrase with neutral, competency-based criteria");
        findings.push({ phrase, issue, suggestion });
      }
      if (aiParticipated) mode = "ai";
    }
  }

  if (findings.length === 0) {
    return {
      mode,
      text: [
        L(lang, "✓ Tidak terdeteksi frasa berpotensi berbias/diskriminatif pada teks.", "✓ No potentially biased/discriminatory phrases detected in the text."),
        "",
        L(
          lang,
          "Catatan: deteksi kata berkode (gender/usia/penampilan/status/fisik) bersifat indikatif — tetap tinjau manual konteks keseluruhan lowongan.",
          "Note: coded-word detection (gender/age/appearance/status/physical) is indicative — always manually review the posting as a whole.",
        ),
        mode === "ai"
          ? L(lang, "— Diperiksa otomatis (deteksi statis + analisis kontekstual AI).", "— Checked automatically (static detection + AI contextual analysis).")
          : L(lang, "— Diperiksa otomatis (deteksi statis — mode simulasi, AI tidak tersedia).", "— Checked automatically (static detection — simulated mode, AI unavailable)."),
      ].join("\n"),
    };
  }

  const byIssue = new Map<string, number>();
  for (const f of findings) byIssue.set(f.issue, (byIssue.get(f.issue) ?? 0) + 1);
  const issueLabel = (k: string) => (lang === "en" ? BIAS_ISSUE_LABEL_EN[k] ?? k : k);
  const lines = [
    L(
      lang,
      `Ditemukan ${findings.length} frasa berpotensi berbias/diskriminatif:`,
      `Found ${findings.length} potentially biased/discriminatory phrase${findings.length > 1 ? "s" : ""}:`,
    ),
    "",
    ...findings.map((f) => L(
      lang,
      `⚠ Frasa: "${f.phrase}" — masalah: ${f.issue} — saran: ${f.suggestion}`,
      `⚠ Phrase: "${f.phrase}" — issue: ${issueLabel(f.issue)} — suggestion: ${f.suggestion}`,
    )),
    "",
    L(
      lang,
      `Ringkasan: ${[...byIssue.entries()].map(([k, v]) => `${v} ${k}`).join(", ")}. Lowongan yang baik menilai kandidat dari kompetensi & kualifikasi — hindari syarat yang merujuk identitas pribadi (gender/usia/penampilan/status/kondisi fisik non-esensial).`,
      `Summary: ${[...byIssue.entries()].map(([k, v]) => `${v} ${issueLabel(k)}`).join(", ")}. Good job postings assess candidates on competencies & qualifications — avoid requirements that reference personal identity (gender/age/appearance/status/non-essential physical condition).`,
    ),
    mode === "ai"
      ? L(lang, "— Deteksi statis + analisis kontekstual AI.", "— Static detection + AI contextual analysis.")
      : L(lang, "— Deteksi statis (mode simulasi — AI tidak tersedia).", "— Static detection (simulated mode — AI unavailable)."),
  ];
  return { mode, text: lines.join("\n") };
}

// ---------- dispatcher ----------

/**
 * Aksi Recruiter Copilot — SEMUA hasil berupa teks siap-baca.
 * Params invalid → throw Error (→ 400/404 di API); kegagalan AI TIDAK pernah
 * dilempar — jatuh ke fallback simulated berlabel jujur.
 */
export async function copilotAction(
  db: TenantDb,
  input: { action: string; params?: unknown; lang?: "id" | "en" },
): Promise<CopilotResult> {
  const params = (input.params && typeof input.params === "object" ? input.params : {}) as Record<string, unknown>;
  const lang = input.lang === "en" ? "en" : "id";
  switch (input.action) {
    case "draft-jd": return copilotDraftJd(db, params, lang);
    case "summarize-candidate": return copilotSummarize(db, params, lang);
    case "interview-questions": return copilotInterview(db, params, lang);
    case "outreach": return copilotOutreach(db, params, lang);
    case "pipeline-qa": return copilotPipelineQa(db, params, lang);
    case "check-bias": return copilotCheckBias(db, params, lang);
    default:
      throw new Error(`Aksi copilot tidak dikenal: ${input.action || "(kosong)"}`);
  }
}
