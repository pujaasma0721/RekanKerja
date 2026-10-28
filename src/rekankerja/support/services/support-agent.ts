// RekanKerja — Online Support: AI support agent (P1: L1 · P2: L2 tools). ==
// =====================================================================
// Agen percakapan layanan dukungan internal RekanKerja — berperan sebagai
// "tim support" yang menjawab laporan/kendala pengguna secara interaktif.
//   · LLM via aiComplete() — provider aktif tenant (builtin ZAI default /
//     OpenAI-compatible per tenant; lihat shared/services/ai-provider.ts).
//   · Lampiran gambar pada pesan terbaru dianalisa dulu via VLM
//     (createVision — pola travel/api/ocr.ts) lalu hasilnya disuntikkan
//     sebagai konteks ke pesan user terakhir.
//   · FEAT-SUPPORT-P2 (L2 — alat baca read-only): bila SupportAgentConfig
//     mengaktifkannya, agen menjalankan LOOP REACT berbasis protokol teks
//     (provider tanpa native function calling):
//       balasan antara  "TOOL_CALL: <nama>\nARGS: {json satu baris}"
//     → runtime menjalankan tool (support-tools.ts — search_code /
//       read_file / query_db / read_logs, seluruhnya read-only + diguard)
//     → hasil disuntikkan sebagai pesan "[HASIL TOOL …]" → ulangi hingga
//       agen menghasilkan jawaban final. Semua langkah tool EPHEMERAL —
//       hanya balasan final yang disimpan; satu pill SYSTEM ringkas
//       dicatat demi transparansi ke pengguna.
//   · Triase otomatis: setiap balasan final diakhiri marker metadata
//     [[META:KATEGORI|PRIORITAS]] — di-strip sebelum disimpan; kategori &
//     prioritas tiket diperbarui (guard whitelist).
//   · Fase berikutnya (P3+): reproduksi browser headless + screenshot ·
//     P4: usulan patch (diff) dengan approval developer.
// =====================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { aiComplete, type AiMessage } from "@/rekankerja/shared/services/ai-provider";
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";
import { readAttachmentFile } from "@/rekankerja/shared/services/attachment-service";
import type { SupportTicket, SupportMessage } from "@/generated/tenant";
import {
  runSupportTool, toolsEnabledFor, TOOL_LABELS,
  type SupportToolName,
} from "@/rekankerja/support/services/support-tools";

export const SUPPORT_CATEGORIES = ["BUG", "PENGGUNAAN", "DATA", "AKUN", "FITUR", "LAINNYA"] as const;
export const SUPPORT_PRIORITIES = ["RENDAH", "SEDANG", "TINGGI", "KRITIS"] as const;

export const SUPPORT_AI_NAME = "Support AI";

/** Marker metadata triase di akhir balasan AI (di-strip sebelum disimpan). */
const META_RE = /\s*\[\[META:([A-Z_]+)\|([A-Z]+)\]\]\s*$/;

/** Batas riwayat yang dikirim ke LLM (pesan lama dipangkas). */
const HISTORY_LIMIT = 16;

/** Maksimum gambar yang dianalisa VLM per giliran (batas waktu/kuota). */
const MAX_IMAGES_PER_TURN = 3;

// ---- anggaran giliran ReAct (P2) ----
/** Maksimum total panggilan LLM per giliran (1 awal + N tool + final). */
const MAX_LLM_STEPS = 8;
/** Maksimum eksekusi tool per giliran. */
const MAX_TOOL_CALLS = 5;
/** Batas dana waktu satu giliran (ms) — lewat → paksa jawab sekarang. */
const TURN_BUDGET_MS = 150_000;

/** Parser protokol tool — pindai di mana pun di keluaran (model kadang
 *  menulis kalimat pembuka singkat sebelum blok TOOL_CALL; hanya BLOK
 *  PERTAMA yang dieksekusi — protokol satu-tool-per-giliran).
 *  Nama & ARGS dicocokkan TERPISAH (regex gabungan berisiko: `\s*`
 *  melahap `\n` sehingga grup ARGS yang opsional tak pernah terisi).
 *  Toleran dekorasi markdown (model kadang menebalkan: **TOOL_CALL:**). */
const TOOL_NAME_RE = /TOOL_CALL\*{0,2}\s*:\s*\*{0,2}\s*([a-z_]+)/;
const TOOL_ARGS_LINE_RE = /ARGS\*{0,2}\s*:\s*\*{0,2}\s*([^\n]+)/;

/** Ekstrak blok JSON kurung-seimbang pertama (toleran spasi/prosa).
 *  Return teks JSON + posisi karakter SETELAH blok (untuk pemotongan). */
function extractArgsJson(text: string): { json: string; end: number } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return { json: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null; // tak seimbang
}

/** Nama tampilan aktor di prompt (fallback bila profil tanpa nama). */
function who(ticket: SupportTicket): string {
  return ticket.createdByName?.trim() || "pengguna";
}

/** Bagian prompt ALAT BACA (P2/L2) — hanya bila tools aktif utk tenant. */
function toolsPromptSection(): string {
  return [
    ``,
    `ALAT PEMERIKSAAN READ-ONLY (mode diagnosis — diaktifkan admin tenant Anda):
Saat menjawab perlu FAKTA (pesan error, kondisi data nyata, perilaku kode), Anda boleh menjalankan alat pemeriksaan internal. Protokol: untuk memanggil alat, keluarkan HANYA dua baris persis begini TANPA kalimat pembuka/penutup apa pun:
TOOL_CALL: <nama_alat>
ARGS: <argumen JSON satu baris>
Runtime akan menjalankan alat dan mengirim hasilnya sebagai pesan "[HASIL TOOL …]" pada giliran berikutnya — lalu Anda melanjutkan. Ulangi sampai cukup, lalu tulis jawaban final normal (TANPA TOOL_CALL). PENTING: setelah menulis baris ARGS, BERHENTI — jangan menulis hasil/tebakan/diagnosis apa pun setelahnya; hasil asli hanya datang dari runtime.`,
    ``,
    `CONTOH ALUR LENGKAP (WAJIB ditiru persis polanya):
pengguna: "berapa jumlah karyawan aktif saat ini? periksa langsung datanya"
ANDA: TOOL_CALL: query_db
ARGS: {"sql":"SELECT count(*) AS n FROM \"Employee\" WHERE status='Active'"}
(system mengirim: [HASIL TOOL query_db — OK] 1 baris: n | 43)
ANDA: Saat ini ada **43 karyawan** berstatus aktif. Ada lagi yang bisa saya bantu? [[META:DATA|RENDAH]]

DILARANG KERAS: menulis "Hasil Pemeriksaan…"/"berdasarkan query…"/"saya periksa…" SEBELUM ada pesan [HASIL TOOL …] pada percakapan — itu sama dengan mengarang.`,
    ``,
    `Alat yang tersedia:
1. search_code — cari teks di kode sumber aplikasi (src/, prisma/, scripts/).
   ARGS: {"query":"teks yang dicari","glob":"filter nama file opsional (substring sederhana, mis. leave — kosongkan bila ragu)"}
   Contoh: mencari arti pesan error — query dengan TEKS ERROR PERSISnya.
2. read_file — baca potongan file kode (maks 250 baris per panggilan; path relatif root proyek).
   ARGS: {"path":"src/...","startLine":1,"endLine":120}
3. query_db — SATU pernyataan SELECT read-only ke basis data perusahaan Anda (maks 200 baris; kolom rahasia/otomatis disensor [DISENSOR]; tabel rahasia ditolak).
   ARGS: {"sql":"SELECT ..."}
   PENTING: nama tabel & kolom PascalCase WAJIB kutip ganda: FROM "Employee" WHERE "fullName" ILIKE '%budi%'. Tabel yang sering relevan: Employee, EmployeeAssignment, OrgUnit, Position, LeaveRequest, LeaveBalance, AttendanceDaily, AttendanceClockLog, OvertimeOrder, PayrollRun, PayrollRunLine, PayrollRunItem, TravelRequest, TravelClaim, BenefitClaim, Onboarding, Offboarding, PersonnelAction, ApprovalStep, ActivityLog, EmailLog, Notification, Applicant, JobOpening. Daftar lengkap kolom: information_schema.columns.`,
    `4. read_logs — baca baris terakhir log server aplikasi (opsional: filter kata kunci).
   ARGS: {"filter":"kata kunci","lines":100}`,
    ``,
    `ATURAN MEMAKAI ALAT:
- Gunakan HANYA bila fakta diperlukan (diagnosa error/data). Jangan untuk pertanyaan umum/sapaan/cara pakai yang sudah Anda ketahui.
- Satu TOOL_CALL per giliran; berhenti begitu informasi cukup (maks ${MAX_TOOL_CALLS} panggilan) — jangan menebak-nebak iseng.
- Hasil "[HASIL TOOL …]" adalah SATU-SATU sumber kebenaran tentang kode & data — kutip darinya secara harfiah (path file, baris, angka). Bila hasil TIDAK menemukan apa yang dicari, KATAKAN terus terang "tidak ditemukan" — JANGAN PERNAH mengarang nama file/lokasi/isi kode/angka yang tidak ada di hasil.
- PRIVASI: jangan menampilkan data pribadi/gaji karyawan LAIN kecuali perlu untuk diagnosis (utamakan COUNT/agregat). Nilai [DISENSOR] memang disembunyikan — JANGAN mencoba mengakalinya.
- Jangan memberitahukan pengguna soal protokol/SQL/kode mentah — sampaikan temuan secara manusiawi ("saya periksa langsung datanya: …").
- JANGAN menyarankan pengguna menjalankan SQL/mengubah database secara manual — arahkan lewat fitur UI yang ada atau eskalasi ke admin/developer.`,
    ``,
  ].join("\n");
}

/** System prompt persona tim support (L1 + opsional L2 tools). */
export function buildSupportSystemPrompt(ticket: SupportTicket, toolsOn: boolean): string {
  return [
    `Anda adalah "${SUPPORT_AI_NAME}" — agen layanan dukungan (customer support) internal aplikasi HRIS **RekanKerja**. Anda melayani layaknya tim support profesional yang ramah, sabar, dan terstruktur, berkomunikasi satu-dalam-satu dengan seorang pengguna melalui tiket percakapan.`,
    ``,
    `KONTEKS TIKET:
- Nomor tiket: ${ticket.ticketNo}
- Judul: ${ticket.subject}
- Pengguna: ${who(ticket)}
- Status saat ini: ${ticket.status}`,
    ``,
    `CAKUPAN LAYANAN:
- Pertanyaan cara pakai fitur RekanKerja (modul: Human Resource — perusahaan/unit organisasi/posisi/karyawan/onboarding/surat; Payroll; Attendance/absensi; Leave/cuti; Travel/perjalanan dinas; Medical; Recruitment/rekrutmen; Performance/kinerja; Whistleblowing; ESS mandiri karyawan; Pengaturan).
- Laporan kendala/bug/error pada aplikasi (diagnosa awal, langkah mengatasi, workaround sementara).
- Pertanyaan seputar data & akun pengguna sendiri (jika perlu data spesifik yang tidak Anda miliki, minta pengguna menyalin teks error/mengirim tangkay layar — jangan menebak).`,
    toolsOn ? toolsPromptSection() : "",
    `ATURAN MENJAWAB:
1. Bahasa: ikuti bahasa pengguna (default: Indonesia yang ramah dan profesional).
2. Format: Markdown ringkas & terstruktur. Untuk kendala: **diagnosis singkat → langkah penyelesaian bernomor → workaround bila ada**. Untuk pertanyaan cara pakai: langkah-langkah bernomor singkat.
3. Jujur & faktual. JANGAN mengarang nama menu/fitur yang tidak Anda yakini ada. Bila tidak yakin atau di luar cakupan Anda, katakan terus terang dan tawarkan untuk diteruskan ke tim HR/developer manusia.
4. Bila informasi kurang, ajukan pertanyaan klarifikasi (maksimal 3, seperlunya saja) — jangan meminta data sensitif (kata sandi, kode OTP, data sensitif orang lain).
5. Empati: akui frustrasi pengguna bila melaporkan kendala; jangan menyalahkan pengguna.
6. Ringkas — maksimal sekitar 250 kata kecuali memang perlu langkah panjang.
7. Bila masalah tampak selesai, sarankan pengguna menandai percakapan "Selesai" (tombol di atas chat).`,
    ``,
    `FORMAT WAJIB DI AKHIR BALASAN (triase internal — TIDAK boleh dijelaskan ke pengguna, TIDAK ditulis di tempat lain):
Akhiri SETIAP balasan dengan tepat satu baris metadata pola:
[[META:<kategori>|<prioritas>]]
dengan <kategori> DIGANTI salah satu nilai persis: BUG (kendala/error aplikasi) atau PENGGUNAAN (cara pakai) atau DATA (masalah data) atau AKUN (login/akses) atau FITUR (permintaan fitur) atau LAINNYA — dan <prioritas> DIGANTI salah satu nilai persis: RENDAH atau SEDANG atau TINGGI atau KRITIS (KRITIS hanya bila menghalangi pekerjaan utama dan tanpa workaround).
CONTOH — pengguna melaporkan error saat menyimpan (bug, prioritas tinggi):
[[META:BUG|TINGGI]]
CONTOH — pengguna bertanya cara mengajukan cuti (cara pakai, prioritas rendah):
[[META:PENGGUNAAN|RENDAH]]`,
  ].filter((s) => s !== "").join("\n");
}

/** Prompt VLM untuk mendeskripsikan lampiran gambar pengguna. */
const VLM_PROMPT =
  "Anda asisten tim support aplikasi HRIS RekanKerja. Deskripsikan gambar/tangkapan layar ini secara ringkas dan faktual — fokus pada: pesan error (kutip persis teksnya), halaman/menu yang terlihat, aksi apa yang tampak dilakukan, dan apa yang tampak tidak beres. Maksimal 120 kata. Jangan menebak di luar yang terlihat.";

/** Ambil id pesan USER sejak balasan AI terakhir (lampiran gambar di antaranya
 *  dianalisa ulang oleh VLM — tidak perlu flag tersimpan). */
function userIdsSinceLastAi(messages: SupportMessage[]): SupportMessage[] {
  const out: SupportMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.senderRole === "AI") break;
    if (m.senderRole === "USER") out.unshift(m);
  }
  // belum ada balasan AI sama sekali → ambil semua pesan USER
  if (out.length === 0 && !messages.some((m) => m.senderRole === "AI")) {
    return messages.filter((m) => m.senderRole === "USER");
  }
  return out;
}

/** Analisa VLM lampiran gambar pada pesan user terbaru → teks konteks (null bila tidak ada). */
async function describeRecentImages(
  db: TenantDb,
  messages: SupportMessage[],
): Promise<string | null> {
  const targets = userIdsSinceLastAi(messages);
  if (targets.length === 0) return null;
  const rows = await db.attachment.findMany({
    where: {
      entityType: "SupportMessage",
      entityId: { in: targets.map((m) => m.id) },
      mimeType: { startsWith: "image/" },
    },
    orderBy: { createdAt: "asc" },
    // storagePath WAJIB ikut ter-select — readAttachmentFile membacanya.
    select: { id: true, fileName: true, mimeType: true, storagePath: true },
  });
  if (rows.length === 0) return null;
  const parts: string[] = [];
  for (const row of rows.slice(0, MAX_IMAGES_PER_TURN)) {
    try {
      const bytes = await readAttachmentFile(row);
      const b64 = Buffer.from(bytes).toString("base64");
      const zai = await createZaiClient();
      // d.ts menuntut field `model` tapi runtime SDK mengabaikannya (pola
      // travel/api/ocr.ts) — kompromi tipe:
      // @ts-expect-error field model tidak diperlukan runtime createVision
      const completion = await zai.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VLM_PROMPT },
              { type: "image_url", image_url: { url: `data:${row.mimeType};base64,${b64}` } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) parts.push(`- ${row.fileName}: ${text}`);
    } catch (e) {
      parts.push(`- ${row.fileName}: (analisa gambar gagal: ${e instanceof Error ? e.message : "unknown"} — minta pengguna menjelaskan isi gambar)`);
    }
  }
  if (parts.length === 0) return null;
  return `[Konteks lampiran gambar yang dianalisa AI vision]\n${parts.join("\n")}`;
}

/** Susun riwayat LLM dari pesan tiket (SYSTEM → catatan; sisipkan konteks gambar). */
function toLlmMessages(messages: SupportMessage[], imageContext: string | null): AiMessage[] {
  const recent = messages.slice(-HISTORY_LIMIT);
  const out: AiMessage[] = recent.map((m) => ({
    role: m.senderRole === "AI" ? ("assistant" as const) : ("user" as const),
    content: m.senderRole === "SYSTEM" ? `[catatan sistem] ${m.body}` : m.body,
  }));
  if (imageContext && out.length > 0) {
    const last = out[out.length - 1];
    out[out.length - 1] = { ...last, content: `${last.content}\n\n${imageContext}` };
  }
  return out;
}

/** Bersihkan sisa protokol internal yang lolos ke jawaban final
 *  (termasuk varian ditebalkan markdown). */
function stripToolSyntax(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*\*{0,2}(TOOL_CALL|ARGS)\*{0,2}\s*:/i.test(l))
    .join("\n");
}

/** Hasil satu giliran agen: pesan AI + triase (null = tidak berubah). */
export interface AgentTurnResult {
  message: SupportMessage;
  category: string | null;
  priority: string | null;
}

/** Susun teks pill transparansi dari penggunaan tool giliran ini. */
function toolUsagePill(usage: Map<string, number>): string | null {
  if (usage.size === 0) return null;
  const parts = [...usage.entries()].map(([tool, n]) => `${TOOL_LABELS[tool as SupportToolName] ?? tool} ×${n}`);
  return `🔎 Pemeriksaan internal oleh ${SUPPORT_AI_NAME}: ${parts.join(" · ")}`;
}

/**
 * Jalankan satu giliran AI support:
 *   analisa gambar → (loop ReAct bila tools aktif) → jawaban final → parse
 *   META → simpan pesan AI (+ pill SYSTEM bila memakai tool) + perbarui
 *   triase/lastMessageAt tiket.
 * Melempar Error bila provider gagal (route → 502, pesan user TERSIMPAN).
 */
export async function agentRespond(db: TenantDb, ticket: SupportTicket): Promise<AgentTurnResult> {
  const messages = await db.supportMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
  });
  if (messages.length === 0) throw new Error("Tiket tanpa pesan");

  const imageContext = await describeRecentImages(db, messages).catch((e) => {
    console.warn("[support-agent] analisa lampiran gambar gagal:", e instanceof Error ? e.message : e);
    return null;
  });
  const base = toLlmMessages(messages, imageContext);
  const toolsOn = await toolsEnabledFor(db);
  const system = buildSupportSystemPrompt(ticket, toolsOn);

  // ---------- loop ReAct (P2) ----------
  const convo: AiMessage[] = [...base];
  const usage = new Map<string, number>();
  let toolCalls = 0;
  let raw = "";
  let lastCallSig = "";
  let lastResult: { ok: boolean; output: string } | null = null;
  let antiConfabRetry = 0;
  const deadline = Date.now() + TURN_BUDGET_MS;

  for (let step = 1; step <= MAX_LLM_STEPS; step++) {
    const forceFinal = step === MAX_LLM_STEPS || Date.now() > deadline;
    if (forceFinal && step > 1) {
      convo.push({
        role: "user",
        content: "[CATATAN RUNTIME: batas langkah/waktu pemeriksaan tercapai — jawab pengguna SEKARANG dengan informasi yang sudah Anda kumpulkan, tanpa TOOL_CALL.]",
      });
    }

    const result = await aiComplete(db, { system, messages: convo, temperature: 0.35, maxTokens: 1400 });
    raw = result.text.trim();
    // Diagnostik ops (muncul di log server — memudahkan audit protokol tool).
    console.log(`[support-agent] tiket ${ticket.ticketNo} langkah ${step}/${MAX_LLM_STEPS} (tools=${toolsOn ? "on" : "off"}, tool terpakai=${toolCalls}): ${raw.slice(0, 300).replace(/\n/g, " ¶ ")}`);

    const nameMatch = toolsOn && !forceFinal ? raw.match(TOOL_NAME_RE) : null;
    if (!nameMatch) {
      // Guard anti-konfabulasi: jawaban "final" mengklaim telah memeriksa
      // kode/data padahal tool belum dijalankan giliran ini (atau mode
      // diagnosis dimatikan admin) → tolak sekali, minta jujur.
      if (
        !forceFinal && antiConfabRetry < 1 &&
        (toolsOn ? usage.size === 0 : true) &&
        /hasil pemeriksaan|berdasarkan (hasil )?(pemeriksaan|query|kode|data (terkini|di database|di sistem))|sudah (saya )?(periksa|cek) (langsung|ke )|telah (saya )?periksa|saya (periksa|cek) (langsung|ke (database|sistem|data))/i.test(raw)
      ) {
        antiConfabRetry += 1;
        convo.push({ role: "assistant", content: stripToolSyntax(raw).slice(0, 2000) });
        convo.push({
          role: "user",
          content: toolsOn
            ? "[CATATAN RUNTIME — PENTING] Anda menulis hasil pemeriksaan padahal BELUM ada pesan [HASIL TOOL …] pada percakapan ini. Itu terlarang (mengarang). Ulangi sekarang: (a) bila perlu fakta, panggil tool dengan protokol TOOL_CALL/ARGS; atau (b) bila tidak perlu, jawab langsung TANPA mengklaim telah memeriksa apa pun."
            : "[CATATAN RUNTIME — PENTING] Mode pemeriksaan sedang DIMATIKAN admin — Anda TIDAK memiliki akses baca ke database/kode giliran ini, sehingga mengklaim \"berdasarkan data\" adalah mengarang. Jawab ulang secara jujur: jelaskan bahwa Anda tidak dapat memeriksa data saat ini, lalu arahkan pengguna ke menu/kolom yang relevan (mis. ESS → sisa cuti) atau minta admin mengaktifkan mode diagnosis.",
        });
        continue;
      }
      break; // jawaban final
    }

    // ---- eksekusi satu tool ----
    const name = nameMatch[1];
    // ARGS: baris "ARGS: …" bila ada; kalau tak ada, coba blok JSON seimbang
    // pertama di seluruh keluaran (model kadang menaruh JSON tanpa label).
    const argsLine = raw.match(TOOL_ARGS_LINE_RE);
    const balanced = extractArgsJson(raw);
    const argsRaw = argsLine ? argsLine[1].trim() : balanced?.json ?? null;
    // POTONG giliran assistant TEPAT di akhir blok TOOL_CALL/ARGS — model
    // kadang melanjutkan menulis "hasil" khayalan setelah protokol; bagian
    // itu TIDAK boleh masuk konteks (satu-satunya hasil yang sah adalah
    // [HASIL TOOL …] yang disuntikkan runtime pada giliran berikutnya).
    const callEnd =
      (argsLine?.index != null ? argsLine.index + argsLine[0].length : 0) ||
      (balanced?.end ?? 0) ||
      ((nameMatch.index ?? 0) + nameMatch[0].length);
    const assistantTurn = raw.slice(0, callEnd).trim();
    let args: Record<string, unknown> = {};
    let argError: string | null = null;
    if (argsRaw) {
      try {
        const parsed = JSON.parse(argsRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        else argError = "ARGS harus objek JSON.";
      } catch {
        argError = "ARGS bukan JSON valid.";
      }
    }
    convo.push({ role: "assistant", content: assistantTurn });
    if (argError) {
      convo.push({ role: "user", content: `[HASIL TOOL ${name}] GAGAL: ${argError} Ulangi dengan format benar (ARGS: {json satu baris}) atau jawab langsung.` });
      continue; // format salah tidak dihitung sbg eksekusi tool
    }
    if (toolCalls >= MAX_TOOL_CALLS) {
      convo.push({ role: "user", content: "[HASIL TOOL] DITOLAK: kuota pemeriksaan giliran ini habis — jawab pengguna sekarang dengan informasi yang ada." });
      continue;
    }

    // dedup: panggilan identik berturut-turut → jangan eksekusi ulang.
    const sig = `${name}|${argsRaw ?? ""}`;
    if (sig === lastCallSig && lastResult) {
      convo.push({
        role: "user",
        content: `[CATATAN RUNTIME] Panggilan ${name} identik dengan langkah sebelumnya — hasilnya sama. Jangan ulangi panggilan yang sama; gunakan informasi yang sudah ada atau jawab pengguna sekarang.`,
      });
      continue;
    }

    toolCalls += 1;
    let toolResult;
    try {
      toolResult = await runSupportTool(db, name, args);
    } catch (e) {
      toolResult = { ok: false, output: `Tool error: ${e instanceof Error ? e.message : "unknown"}` };
    }
    lastCallSig = sig;
    lastResult = toolResult;
    usage.set(name, (usage.get(name) ?? 0) + 1);
    if (!toolResult.ok) {
      console.warn(`[support-agent] tool ${name} gagal (tiket ${ticket.ticketNo}): ${toolResult.output.slice(0, 300)}`);
    }
    convo.push({
      role: "user",
      content: `[HASIL TOOL ${name} — ${toolResult.ok ? "OK" : "DITOLAK/GAGAL"}]\n${toolResult.output}`,
    });
  }

  // ---------- parse + strip marker triase ----------
  let body = stripToolSyntax(raw).trim();
  let category: string | null = null;
  let priority: string | null = null;
  const m = body.match(META_RE);
  if (m?.index != null) {
    const rawBody = body.slice(0, m.index).trimEnd();
    if (rawBody.length > 0) {
      if ((SUPPORT_CATEGORIES as readonly string[]).includes(m[1])) category = m[1];
      if ((SUPPORT_PRIORITIES as readonly string[]).includes(m[2])) priority = m[2];
      body = rawBody;
    }
  }
  // buang baris pemisah horizontal (--- / *** / ===) di awal & akhir — sisa
  // narasi model; hati-hati JANGAN sentuh heading/bold konten.
  body = body
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})[^\S\n]*\n?/, "")
    .replace(/\n?[^\S\n]*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/, "")
    .trim();
  if (!body) throw new Error("AI mengembalikan jawaban kosong — coba ulangi");

  // ---------- persistensi ----------
  const pill = toolUsagePill(usage);
  if (pill) {
    await db.supportMessage.create({
      data: { ticketId: ticket.id, senderRole: "SYSTEM", senderName: SUPPORT_AI_NAME, body: pill },
    });
  }
  const now = new Date();
  const message = await db.supportMessage.create({
    data: {
      ticketId: ticket.id,
      senderRole: "AI",
      senderName: SUPPORT_AI_NAME,
      body,
    },
  });
  await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: now,
      ...(category ? { category } : {}),
      ...(priority ? { priority } : {}),
    },
  });
  return { message, category, priority };
}

/** Pesan sambutan tetap saat tiket dibuat (tanpa panggilan LLM — murah & instan). */
export function greetingBody(userName: string | null): string {
  const sapa = userName?.trim() ? `Halo, **${userName.trim()}**!` : "Halo!";
  return (
    `${sapa} Saya **${SUPPORT_AI_NAME}** — layanan dukungan RekanKerja yang siap membantu Anda.\n\n` +
    `Ceritakan kendala atau pertanyaan Anda seputar aplikasi — misalnya:\n` +
    `- ❓ *cara menggunakan fitur* (payroll, absensi, cuti, klaim, …)\n` +
    `- 🐛 *laporan bug/error* — sertakan langkah yang dilakukan & pesan errornya\n` +
    `- 🔐 *masalah akun/login*\n\n` +
    `Anda juga bisa melampirkan **tangkapan layar** atau dokumen (JPG/PNG/WEBP/PDF, maks 5 MB) — saya akan membacanya langsung. Bila perlu, saya juga dapat memeriksa data & kondisi sistem secara langsung untuk mendiagnosa masalah Anda.`
  );
}
