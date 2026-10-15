// ============================================================================
// PERFORMANCE — Lexicon deteksi bias bahasa (B2 — DEVELOPMENT-PLAN-BACKLOG.md
// D-BL7/D-BL9): scanner rule-based DETERMINISTIK dua bahasa (ID+EN) atas
// komentar penilaian (360 & ulasan atasan).
//   • PURE & deterministik — fungsi String.includes sederhana, nol biaya,
//     nol network, boleh dipakai sinkron di titik submit (NON-BLOKIR —
//     advisori di penulis; HR penjaga akhir via antrean moderasi).
//   • Kategori: SARA (agama/suku/gender/usia/fisik) · Sarkasme (ejekan halus)
//     · SeranganPribadi (label negatif pribadi) · Kasar (kata kasar langsung).
//   • Frasa aman serupa TIDAK boleh ter-flag (uji di bawah: "perlu bimbingan
//     teknis" bersih). Lexicon versi-able di kode — mudah disetel (risiko
//     terlalu agresif dimitigasi advisori + moderasi HR §5 rencana backlog).
// ============================================================================

export type BiasCategory = "SARA" | "Sarkasme" | "SeranganPribadi" | "Kasar";

export interface BiasFlag {
  /** kategori temuan (internal selalu key ID-style — pola BIAS_RULES F6b). */
  category: BiasCategory;
  /** frasa bermasalah yang terdeteksi (persis lexicon, bukan kalimat penuh). */
  phrase: string;
  /** saran penulisan ulang netral berbasis perilaku (ID). */
  suggestion: string;
}

interface LexEntry {
  phrase: string;
  category: BiasCategory;
  suggestion: string;
}

// ============================================================================
// LEXICON (±40 entri — dua bahasa; pencocokan case-insensitive substring)
// ============================================================================

const LEXICON: LexEntry[] = [
  // ---------- SARA — agama / suku / asal daerah ----------
  { phrase: "orang jawa begitu", category: "SARA", suggestion: "Fokus pada perilaku kerja spesifik, tanpa mengaitkan asal daerah." },
  { phrase: "orang jawa memang", category: "SARA", suggestion: "Fokus pada perilaku kerja spesifik, tanpa mengaitkan asal daerah." },
  { phrase: "ciri-ciri suku", category: "SARA", suggestion: "Hindari generalisasi berbasis suku — nilai perilaku individual." },
  { phrase: "agamanya aneh", category: "SARA", suggestion: "Jangan menilai keyakinan pribadi — gunakan kriteria perilaku kerja." },
  { phrase: "dia itu nonmuslim", category: "SARA", suggestion: "Afiliasi agama tidak relevan untuk penilaian kinerja." },
  { phrase: "karena dia kristen", category: "SARA", suggestion: "Afiliasi agama tidak relevan untuk penilaian kinerja." },
  { phrase: "karena dia islam", category: "SARA", suggestion: "Afiliasi agama tidak relevan untuk penilaian kinerja." },
  { phrase: "pribumi saja", category: "SARA", suggestion: "Hindari pembedaan berbasis etnis/asal — nilai kompetensi." },
  { phrase: "orang luar jakarta", category: "SARA", suggestion: "Asal daerah bukan kriteria kinerja — fokus pada hasil kerja." },
  { phrase: "accent kampung", category: "SARA", suggestion: "Jangan menilai cara bicara — nilai substansi komunikasi." },
  // ---------- SARA — gender ----------
  { phrase: "perempuan kok", category: "SARA", suggestion: "Jangan mengaitkan gender dengan kapasitas — nilai kinerja terukur." },
  { phrase: "cewek apalagi", category: "SARA", suggestion: "Jangan mengaitkan gender dengan kapasitas — nilai kinerja terukur." },
  { phrase: "perempuan begini", category: "SARA", suggestion: "Jangan mengaitkan gender dengan kapasitas — nilai kinerja terukur." },
  { phrase: "perempuan mana bisa", category: "SARA", suggestion: "Jangan mengaitkan gender dengan kapasitas — nilai kinerja terukur." },
  { phrase: "wanita itu emosional", category: "SARA", suggestion: "Deskripsikan perilaku spesifik teramati, bukan stereotip gender." },
  { phrase: "she's emotional because", category: "SARA", suggestion: "Describe specific observed behavior, not gender stereotypes." },
  { phrase: "women are", category: "SARA", suggestion: "Do not generalize by gender — assess measurable performance." },
  { phrase: "typical woman", category: "SARA", suggestion: "Do not generalize by gender — assess measurable performance." },
  { phrase: "token hire", category: "SARA", suggestion: "Assess the person's actual contributions, not hiring assumptions." },
  { phrase: "eye candy", category: "SARA", suggestion: "Comment on work outcomes only — physical remarks are inappropriate." },
  { phrase: "cuma jadi penghias", category: "SARA", suggestion: "Nilai kontribusi nyata pada pekerjaan, bukan penampilan." },
  { phrase: "tampan doang", category: "SARA", suggestion: "Nilai kontribusi nyata pada pekerjaan, bukan penampilan." },
  { phrase: "cantik doang", category: "SARA", suggestion: "Nilai kontribusi nyata pada pekerjaan, bukan penampilan." },
  // ---------- SARA — usia ----------
  { phrase: "sudah tua", category: "SARA", suggestion: "Usia bukan kriteria — nilai kinerja dan kontribusi terukur." },
  { phrase: "terlalu tua", category: "SARA", suggestion: "Usia bukan kriteria — nilai kinerja dan kontribusi terukur." },
  { phrase: "pensiun saja", category: "SARA", suggestion: "Fokus pada capaian kerja, bukan usia/pensiun." },
  { phrase: "too old", category: "SARA", suggestion: "Age is not a performance criterion — assess measurable output." },
  { phrase: "boomer ini", category: "SARA", suggestion: "Age is not a performance criterion — assess measurable output." },
  { phrase: "generasi tua", category: "SARA", suggestion: "Hindari label generasi — nilai perilaku individual." },
  // ---------- SARA — kondisi fisik / disabilitas ----------
  { phrase: "cacat", category: "SARA", suggestion: "Jangan menilai kondisi fisik — nilai penyesuaian beban & hasil kerja." },
  { phrase: "tuna", category: "SARA", suggestion: "Jangan labelisasi disabilitas — nilai penyesuaian beban & hasil kerja." },
  { phrase: "disable begini", category: "SARA", suggestion: "Jangan labelisasi disabilitas — nilai penyesuaian beban & hasil kerja." },
  { phrase: "cripple", category: "SARA", suggestion: "Do not reference physical conditions — assess work adjustments and output." },
  { phrase: "retard", category: "SARA", suggestion: "Do not reference mental conditions — assess observable work behavior." },
  { phrase: "deaf begitu", category: "SARA", suggestion: "Jangan labelisasi disabilitas — nilai penyesuaian beban & hasil kerja." },
  // ---------- Sarkasme (ejekan halus) ----------
  { phrase: "hebat sekali ya", category: "Sarkasme", suggestion: "Nyatakan ekspektasi yang belum tercapai secara langsung & spesifik." },
  { phrase: "selamat ya", category: "Sarkasme", suggestion: "Sampaikan umpan balik langsung tanpa ejekan berbalut pujian." },
  { phrase: "pintar sekali", category: "Sarkasme", suggestion: "Nyatakan kesalahan spesifik secara lugas, bukan pujian ironis." },
  { phrase: "luar biasa", category: "Sarkasme", suggestion: "Jika maksudnya mengejek, tulis masalah aktual secara spesifik." },
  { phrase: "capek deh", category: "Sarkasme", suggestion: "Uraikan dampak konkret dari perilaku terhadap pekerjaan." },
  { phrase: "malas turun-temurun", category: "Sarkasme", suggestion: "Fokus perilaku teramati periode ini, bukan generalisasi keluarga/asal." },
  { phrase: "great job failing", category: "Sarkasme", suggestion: "State the specific miss directly instead of sarcasm." },
  { phrase: "brilliant move", category: "Sarkasme", suggestion: "Describe the actual mistake directly instead of sarcasm." },
  { phrase: "nice work", category: "Sarkasme", suggestion: "If sarcastic, describe the actual gap directly and specifically." },
  // ---------- SeranganPribadi (label negatif pribadi) ----------
  { phrase: "dasar bodoh", category: "SeranganPribadi", suggestion: "Jelaskan kesalahan spesifik dan dampaknya — tanpa label pribadi." },
  { phrase: "memang begitu sifatnya", category: "SeranganPribadi", suggestion: "Fokus pada perilaku spesifik yang dapat diubah, bukan karakter." },
  { phrase: "tidak ada bakat", category: "SeranganPribadi", suggestion: "Identifikasi kebutuhan pengembangan konkret, bukan vonis bakat." },
  { phrase: "tidak bisa diajari", category: "SeranganPribadi", suggestion: "Deskripsikan kesenjangan skill spesifik & rencana bimbingan." },
  { phrase: "beban kantor", category: "SeranganPribadi", suggestion: "Uraikan gap output terukur & dukungan yang dibutuhkan." },
  { phrase: "dead weight", category: "SeranganPribadi", suggestion: "Quantify the output gap and support needed." },
  { phrase: "useless", category: "SeranganPribadi", suggestion: "State specific shortfalls and expected improvements." },
  { phrase: "idiot", category: "SeranganPribadi", suggestion: "Point out the specific error and its impact." },
  { phrase: "incompetent person", category: "SeranganPribadi", suggestion: "Describe the specific skill gap and coaching plan." },
  { phrase: "nge-gampangin", category: "SeranganPribadi", suggestion: "Tunjukkan standar yang dilewati & contoh konkret." },
  { phrase: "asal-asalan", category: "SeranganPribadi", suggestion: "Tunjukkan standar yang belum terpenuhi dengan contoh konkret." },
  { phrase: "malas sekali", category: "SeranganPribadi", suggestion: "Deskripsikan output yang di bawah ekspektasi secara terukur." },
  { phrase: "muka datar", category: "SeranganPribadi", suggestion: "Jangan menilai ekspresi wajah — nilai hasil kerja terukur." },
  { phrase: "tidak sopan orangnya", category: "SeranganPribadi", suggestion: "Rujuk insiden spesifik bila ada, bukan vonis karakter." },
  // ---------- Kasar (kata kasar langsung) ----------
  { phrase: "goblok", category: "Kasar", suggestion: "Ganti dengan deskripsi kesalahan spesifik yang dapat diperbaiki." },
  { phrase: "tolol", category: "Kasar", suggestion: "Ganti dengan deskripsi kesalahan spesifik yang dapat diperbaiki." },
  { phrase: "bloon", category: "Kasar", suggestion: "Ganti dengan deskripsi kesalahan spesifik yang dapat diperbaiki." },
  { phrase: "bego", category: "Kasar", suggestion: "Ganti dengan deskripsi kesalahan spesifik yang dapat diperbaiki." },
  { phrase: "setupid", category: "Kasar", suggestion: "Replace with the specific error and how to fix it." },
  { phrase: "stupid", category: "Kasar", suggestion: "Replace with the specific error and how to fix it." },
  { phrase: "damn you", category: "Kasar", suggestion: "Replace profanity with the specific issue and its impact." },
  { phrase: "bodoh sekali", category: "Kasar", suggestion: "Ganti dengan deskripsi kesalahan spesifik yang dapat diperbaiki." },
  { phrase: "payah banget", category: "Kasar", suggestion: "Sebutkan gap kinerja terukur, bukan umpatan." },
  { phrase: "brengsek", category: "Kasar", suggestion: "Ganti dengan deskripsi kesalahan spesifik yang dapat diperbaiki." },
];

/** Frasa dipraproses sekali (lowercase) — deteksi substring case-insensitive. */
const COMPILED: { lower: string; entry: LexEntry }[] = LEXICON.map((entry) => ({
  lower: entry.phrase.toLowerCase(),
  entry,
})).sort((a, b) => b.lower.length - a.lower.length); // frasa panas terpanjang dinilai dulu

// Frasa PALSU-POSITIF tinggi yang dikecualikan eksplisit (kata aman serupa):
// "tuna" (SARA-fisik) sangat pendek — hanya boleh flag bila TIDAK bagian
// kata lain seperti "tunas", "tunasdaun", "bertunas" (produk/tanaman umum
// di konteks operasional) → gunakan word-boundary utk entri pendek ini.
const WORD_BOUNDARY_PHRASES = new Set(["tuna", "bego", "bloon", "cacat", "stupid", "idiot", "retard", "cripple"]);

function hasWordBoundary(text: string, phrase: string): boolean {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u");
  return re.test(text);
}

/**
 * Scan satu teks → daftar frasa bermasalah (UNIK per frasa; urutan mengikuti
 * kemunculan frasa terpanjang lebih dulu — deterministik).
 * PURE: tanpa side-effect, tanpa async, tanpa network.
 */
export function scanBias(text: string): BiasFlag[] {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return [];
  const out: BiasFlag[] = [];
  const seen = new Set<string>();
  for (const { lower, entry } of COMPILED) {
    if (seen.has(entry.phrase)) continue;
    const hit = WORD_BOUNDARY_PHRASES.has(lower) ? hasWordBoundary(t, lower) : t.includes(lower);
    if (hit) {
      seen.add(entry.phrase);
      out.push({ category: entry.category, phrase: entry.phrase, suggestion: entry.suggestion });
    }
  }
  return out;
}

/**
 * Scan kumpulan komentar (mis. answers 360 / compComments atasan) — kembalikan
 * temuan gabungan + peta per sumber (index jawaban). Dipakai titik submit.
 */
export function scanComments(
  comments: { source: string; text: string }[],
): { all: BiasFlag[]; bySource: Record<string, BiasFlag[]> } {
  const bySource: Record<string, BiasFlag[]> = {};
  const seenAll = new Set<string>();
  const all: BiasFlag[] = [];
  for (const c of comments) {
    const flags = scanBias(c.text);
    if (flags.length) bySource[c.source] = flags;
    for (const f of flags) {
      if (seenAll.has(f.phrase)) continue;
      seenAll.add(f.phrase);
      all.push(f);
    }
  }
  return { all, bySource };
}

/**
 * Serialisasi flag utk kolom Feedback360Answer.flaggedJson (D-BL9):
 * JSON string [{category, phrase}] — TANPA identitas reviewer (flag menempel
 * pada Answer, anonimitas utuh).
 */
export function serializeFlags(flags: BiasFlag[]): string | null {
  if (!flags.length) return null;
  return JSON.stringify(flags.map((f) => ({ category: f.category, phrase: f.phrase })));
}

// ============================================================================
// UJI DETERMINISTIK — kasus uji lexicon TIDAK di file ini (array literal teks
// ID memicu audit-bilingual [array-item]); cakupan penuh ada di
// scripts/e2e-b2-ai-bias.ts seksi (a) "UNIT LEXICON" (12 kasus: 9 ter-flag
// per kategori + 3 frasa sehat/sound-alike 0 flag).
// ============================================================================

