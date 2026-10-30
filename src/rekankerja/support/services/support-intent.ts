// RekanKerja — Online Support: FEAT-SUPPORT-P10 — FILTER LAPIS PERTAMA.
// =====================================================================
// Layanan support = kanal LAPORAN MASALAH/BUG aplikasi — BUKAN tempat
// pertanyaan umum. Semua pertanyaan umum (data aplikasi: jumlah karyawan,
// gaji, sisa cuti, jumlah kantor; cara pakai fitur; sapaan/obrolan) sudah
// ditangani widget "Asisten AI" (bubble chat mengambang pojok kanan bawah).
// Token & provider LLM support disetel pemilik aplikasi — jangan sampai
// terbakar untuk hal yang bukan permasalahan sistem.
//
// Dua lapis filter (pola P4.7/P4.8/P9: aturan murah + LLM hemat):
//   1. ATURAN (biaya NOL token):
//      · sinyal MASALAH jelas (error/gagal/tidak bisa/…) → LOLOS tanpa
//        biaya apa pun (kasus mayoritas tiket support);
//      · sapaan/chit-chat murni (halo, ok, makasih, …) → BLOKIR;
//      · pertanyaan data/umum khas (berapa jumlah karyawan/gaji/kantor,
//        gimana cara …, siapa CEO) → BLOKIR.
//   2. KLASIFIKASI LLM MURAH (hanya utk pesan ambigu): SATU panggilan kecil
//      (system prompt ±100 token, maxTokens 8, temperature 0) memutuskan
//      MASALAH vs UMUM dengan konteks judul tiket. Biayanya ratusan token —
//      dibanding giliran agent penuh (system prompt besar + hingga 14
//      langkah LLM + loop tool + VLM lampiran: puluhan ribu token).
//
// P10.1 — SADAR-ALUR PERCAKAPAN: klasifikasi LLM menerima riwayat ringkas
// utas (lihat classifySupportIntentLlm); pemanggil memutuskan kapan aturan
// cukup vs kapan riwayat wajib (utas aktif — pesan lanjutan penanganan
// masalah yang sedang berjalan tidak boleh salah blokir).
//
// Pesan UMUM yang terblokir → balasan REDIRECT tetap (tanpa LLM agent):
// jelaskan fungsi layanan support + arahkan ke Asisten AI. Gagal klasifikasi
// LLM → fail-open MASALAH (laporan masalah nyata TIDAK BOLEH tertahan
// karena infrastruktur filter bermasalah).
//
// Privasi (H1 audit-2): log hanya metadata — isi pesan pengguna TIDAK
// pernah ditulis ke log server bersama dari modul ini.
import { aiCompleteSupport } from "@/rekankerja/support/services/support-provider";
import { SUPPORT_AI_NAME } from "@/rekankerja/support/services/support-agent";

export type SupportIntentVerdict = "MASALAH" | "UMUM_GREETING" | "UMUM";

/** Pemakaian klasifikasi (atribusi biaya — classifier pun token nyata). */
export interface SupportIntentUsage {
  llmSteps: number;
  tokensIn: number;
  tokensOut: number;
  provider: string;
}

// ---------------------------------------------------------------------------
// LAPIS 1a — sinyal MASALAH jelas (lolos, biaya nol). Kalibrasi dari
// ERROR_REPORT_RE support-agent.ts + kosakata keluhan data nyata. Fail-open:
// kalau ragu → dianggap MASALAH (giliran agent tetap jalan).
// ---------------------------------------------------------------------------
const PROBLEM_SIGNAL_RE = new RegExp(
  [
    // kosakata error/kendala inti (mewarisi ERROR_REPORT_RE)
    "\\b(?:error|eror|erorr|gagal|failed|failure|crash|bug|exception|traceback|stack\\s*trace|blank|hang|macet|mati|rusak|lemot|lambat)\\b",
    "\\b(?:tidak|tak|nggak|ngga|gak|gk|ga|gk)\\s+(?:bisa|muncul|ada|terkirim|tersimpan|sesuai|berhasil|normal|jalan|konek|kebaca|kedeteksi|masuk|keluar|terbuka|terunduh|tercetak)\\b",
    "\\bbelum\\s+(?:muncul|terkirim|tersimpan|masuk|berhasil|bisa|terproses)\\b",
    "\\b(?:kenapa|kok|gimana nih|kok gak|kok nggak)\\b[^.?!]{0,60}?",
    "\\b(?:data|hasil|nominal|angka|total)\\s+(?:hilang|salah|dobel|duplikat|berubah)\\b",
    "\\b(?:hilang|salah|dobel|duplikat|kendala|masalah|issue|trouble|gangguan|ditolak|stuck|loading terus|berulang)\\b",
    "\\blupa\\s+(?:password|sandi|kata\\s+sandi|pin)\\b",
    "\\bakun\\s+(?:terkunci|diblokir|kenapa|error|tidak\\s+bisa)\\b",
    "\\b(?:gagal|tidak\\s+bisa|tak\\s+bisa|nggak\\s+bisa)\\s+(?:login|masuk|simpan|kirim|buka|cetak|unduh|download|upload|proses|daftar|verifikasi)\\b",
    "\\blayar\\s+putih\\b|\\binternal\\s+server\\s+error\\b|\\bhttp\\s*5\\d\\d\\b|\\bprisma\\.[a-z]+\\.|\\bECONNREFUSED\\b|\\bETIMEDOUT\\b|\\bFATAL\\b",
    "\\b(?:otp|kode\\s+verifikasi|email|notifikasi|slack|wa|whatsapp)\\s+(?:tidak|tak|nggak|belum)\\s+(?:masuk|terkirim|diterima)\\b",
    "\\b(?:can'?t|cannot|won'?t|doesn'?t|isn'?t|not\\s+working|not\\s+loading|broken|crashed|wrong\\s+(?:data|amount|number)|missing|doesn'?t\\s+appear)\\b",
  ].join("|"),
  "i",
);

// ---------------------------------------------------------------------------
// LAPIS 1b — sapaan/chit-chat MURNI (blokir, biaya nol): seluruh kata pesan
// adalah kosakata sapaan/persetujuan singkat ("halo", "selamat pagi",
// "ok makasih ya", "test", "assalamualaikum").
// ---------------------------------------------------------------------------
const GREETING_WORDS = new Set([
  "halo", "hallo", "helo", "hai", "hay", "hi", "hello", "helo", "hey",
  "pagi", "siang", "sore", "malam", "selamat", "met", "siangg",
  "assalamualaikum", "asalamualaikum", "warahmatullahi", "wabarakatuh",
  "test", "tes", "testing", "coba",
  "ok", "oke", "okeh", "okay", "okey", "sip", "siap", "mantap", "keren", "good",
  "iya", "iyah", "yes", "ya", "yaa", "y", "p", "pp", "oh", "oia", "nih",
  "thanks", "thank", "you", "terima", "kasih", "makasih", "makasi", "mksh",
  "thx", "ty", "tq", "suwun", "ngabsen", "absen",
]);

/** True bila pesan (setelah normalisasi) HANYA terdiri dari kata sapaan. */
function isGreetingOnly(text: string): boolean {
  const norm = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return true;
  const words = norm.split(" ");
  return words.every((w) => GREETING_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// LAPIS 1c — pertanyaan UMUM/DATA khas (blokir, biaya nol). Cakup pola
// contoh nyata pemakaian: "berapa jumlah employee", "berapa gaji saya",
// "berapa jumlah company office", "sisa cuti saya berapa", "gimana cara …".
// Urutan pemeriksaan di classifySupportIntentRules: MASALAH dulu → pesan
// bermasalah yang kebetutan memuat "berapa" (mis. "gaji saya tidak muncul,
// harusnya berapa?") tidak pernah salah blokir.
// ---------------------------------------------------------------------------
const GENERAL_QUESTION_RE = new RegExp(
  [
    // "berapa (jumlah/banyak/total/sisa) <benda data>"
    "\\bberapa\\b[^.!?]{0,50}?(?:karyawan|employee|pegawai|staff|orang|kantor|office|cabang|perusahaan|company|divisi|departemen|department|dept|gaji|salary|upah|thr|bonus|cuti|izin|absensi|absen|klien|client|proyek|projek|project|kontrak|user|pengguna|admin|anggota|tim|team|data|dokumen|surat|aset)",
    "\\b(?:jumlah|banyaknya|total|banyak)\\s+(?:karyawan|employee|pegawai|staff|orang|kantor|office|cabang|perusahaan|company|divisi|departemen|department|gaji|cuti|absensi|absen|klien|client|proyek|project|user|pengguna|admin)\\b",
    // gaji & slip milik sendiri
    "\\b(?:gaji|salary|upah|slip\\s+gaji|slipgaji)\\s+(?:saya|aku|gue|sy|saya\\s+sekarang)\\b",
    "\\b(?:berapa|kapan)\\s+(?:gaji|salary|thr|payroll|slip\\s+gaji)\\b",
    // sisa cuti / saldo
    "\\b(?:sisa|saldo)\\s+(?:cuti|izin|saldo\\s+cuti)\\b",
    // identitas organisasi
    "\\bsiapa\\s+(?:nama\\s+)?(?:ceo|direktur|owner|bos|boss|manajer|manager|kepala|pemilik|atasan)\\b",
    // cara pakai (how-to) — ranah Asisten AI
    "^(?:bagaimana|gimana|gmn|bgmn|caranya)\\s+cara\\b",
    "\\bcara\\s+(?:menggunakan|memakai|pakai|menambah|menyimpan|membuat|mengajukan|menghapus|mengubah|mengunduh|mencetak|menghitung|mendaftar|menyetujui)\\b",
    "\\b(?:how\\s+many|how\\s+much)\\b",
  ].join("|"),
  "i",
);

/**
 * Klasifikasi ATURAN (biaya nol). Return null bila ambigu → panggil
 * classifySupportIntentLlm.
 */
export function classifySupportIntentRules(body: string): SupportIntentVerdict | null {
  const text = body.trim();
  if (!text) return null;
  if (PROBLEM_SIGNAL_RE.test(text)) return "MASALAH";
  if (isGreetingOnly(text)) return "UMUM_GREETING";
  if (GENERAL_QUESTION_RE.test(text)) return "UMUM";
  return null;
}

// ---------------------------------------------------------------------------
// LAPIS 2 — klasifikasi LLM murah utk pesan ambigu (HANYA satu panggilan
// kecil; tanpa tool, tanpa system prompt besar). P10.1 (analisa tiket
// SP-2026-005 "tanya lagi"): klasifikator kini menerima RIWAYAT RINGKAS
// utas — pesan lanjutan penanganan masalah yang sedang berjalan (koreksi
// atas diagnosis, info tambahan, jawaban atas pertanyaan support) sering
// tampak seperti pertanyaan umum bila dibaca SENDIRIAN (mis. "cuti itu sudah
// ada : CT-LAHIR") dan tanpa riwayat salah diblokir → agent tampak tidak
// tahu alur percakapan. Riwayat membuat klasifikator membedakan "lanjutan
// masalah" vs "pertanyaan umum sungguhan".
// ---------------------------------------------------------------------------
const INTENT_SYSTEM = [
  "Kamu filter pesan layanan support aplikasi HRIS RekanKerja.",
  "Layanan support HANYA untuk: laporan masalah/bug/error aplikasi, gangguan akun/login, permintaan fitur, atau lanjutan penanganan masalah yang sedang berjalan di tiket yang sama.",
  "Pertanyaan UMUM — data/info aplikasi (jumlah karyawan, gaji, sisa cuti, jumlah kantor, data pegawai), cara pakai fitur, sapaan/obrolan, atau topik di luar aplikasi — BUKAN ranah support (sudah ada chat Asisten AI yang menanganinya).",
  "PENTING: bila PESAN TERAKHIR adalah lanjutan dari percakapan masalah pada riwayat — koreksi atas temuan/diagnosis support, info tambahan utk masalah yang sedang ditangani, atau jawaban atas pertanyaan support — klasifikasikan MASALAH, WALAU kalimatnya sendiri tampak seperti pertanyaan umum atau sapaan.",
  "Klasifikasikan maksud PESAN TERAKHIR pengguna memakai konteks judul percakapan dan riwayat.",
  "Balas TEPAT SATU kata tanpa tanda baca: MASALAH atau UMUM.",
].join(" ");

/**
 * Klasifikasi LLM (murah) atas pesan ambigu. FAIL-OPEN: pemanggil menangkap
 * error → perlakukan sebagai MASALAH (jangan pernah menahan laporan masalah).
 * P10.1 — `history` (opsional): transkrip ringkas pesan-pesan terakhir utas
 * (sebelum pesan yang diklasifikasikan), format "PENGGUNA: …" / "SUPPORT: …".
 * Kosong/null = utas baru tanpa percakapan sebelumnya.
 */
export async function classifySupportIntentLlm(
  ticketSubject: string,
  body: string,
  history?: string | null,
): Promise<{ verdict: "MASALAH" | "UMUM"; usage: SupportIntentUsage }> {
  const r = await aiCompleteSupport({
    system: INTENT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Judul percakapan: ${ticketSubject.slice(0, 120)}`,
          ...(history
            ? [`Riwayat percakapan sebelum pesan ini (terlama di atas):\n${history}`]
            : []),
          `Pesan terakhir pengguna: ${body.slice(0, 1000)}`,
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    maxTokens: 8,
  });
  // kata PERTAMA yang cocok menang; tak ada / ambigu → MASALAH (fail-open).
  const m = r.text.match(/\b(MASALAH|UMUM)\b/i);
  return {
    verdict: m?.[1]?.toUpperCase() === "UMUM" ? "UMUM" : "MASALAH",
    usage: { llmSteps: 1, tokensIn: r.tokensIn, tokensOut: r.tokensOut, provider: r.provider },
  };
}

// ---------------------------------------------------------------------------
// Balasan REDIRECT tetap (ditulis sebagai pesan AI tanpa giliran agent).
// Bilingual tidak perlu — layanan berbahasa Indonesia; gaya mengikuti
// greetingBody support-agent.ts.
// ---------------------------------------------------------------------------
export function supportRedirectBody(kind: "greeting" | "umum", userName: string | null): string {
  const nama = userName?.trim();
  if (kind === "greeting") {
    const sapa = nama ? `Halo, **${nama}**!` : "Halo!";
    return (
      `${sapa} Saya **${SUPPORT_AI_NAME}** — layanan ini khusus menangani **laporan masalah/bug/error aplikasi RekanKerja** (mis. gagal menyimpan data, tampilan error, tidak bisa login, hasil perhitungan tidak sesuai).\n\n` +
      `Untuk pertanyaan umum — jumlah karyawan, gaji & slip gaji, sisa cuti, cara memakai fitur, info perusahaan — silakan tanyakan ke **Asisten AI**: tombol chat mengambang di **pojok kanan bawah** aplikasi, lalu pilih tab **Asisten AI**. Asisten AI memang ditugaskan menjawab pertanyaan umum & data aplikasi.\n\n` +
      `Sedang mengalami kendala/error di aplikasi? Ceritakan di sini: apa yang terjadi, langkah yang Anda lakukan, dan pesan errornya — saya siap memeriksa dan menindaklanjutinya. 🛠️`
    );
  }
  const sapa = nama ? `Terima kasih, **${nama}**.` : "Terima kasih.";
  return (
    `${sapa} Mohon maaf, layanan support ini khusus menangani **laporan masalah/bug/error aplikasi** — bukan pertanyaan umum atau data aplikasi.\n\n` +
    `Pertanyaan seperti itu lebih tepat ditanyakan ke **Asisten AI**: tombol chat mengambang di **pojok kanan bawah** aplikasi, lalu pilih tab **Asisten AI** — asisten itu siap menjawab pertanyaan umum & data aplikasi (jumlah karyawan, gaji & slip gaji, sisa cuti, cara memakai fitur, info perusahaan, dan sebagainya).\n\n` +
    `Namun bila yang Anda maksud justru **kendala/error** di aplikasi (gagal simpan, tampilan error, tidak bisa login, data tidak sesuai, dsb.) — ceritakan di sini: apa yang terjadi, langkah yang dilakukan, dan pesan errornya, dan saya akan memeriksanya.`
  );
}
