// RekanKerja — Online Support: AI support agent (FEAT-SUPPORT-P1, level L1). =
// =====================================================================
// Agen percakapan layanan dukungan internal RekanKerja — berperan sebagai
// "tim support" yang menjawab laporan/kendala pengguna secara interaktif.
//   · LLM via aiComplete() — provider aktif tenant (builtin ZAI default /
//     OpenAI-compatible per tenant; lihat shared/services/ai-provider.ts).
//   · Lampiran gambar pada pesan terbaru dianalisa dulu via VLM
//     (createVision — pola travel/api/ocr.ts) lalu hasilnya disuntikkan
//     sebagai konteks ke pesan user terakhir.
//   · Triase otomatis: setiap balasan diakhiri marker metadata
//     [[META:KATEGORI|PRIORITAS]] — di-strip sebelum disimpan; kategori &
//     prioritas tiket diperbarui (guard whitelist).
//   · Fase berikutnya (P2+): tools baca kode / query DB read-only /
//     reproduksi browser — service ini titik sambungnya.
// =====================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { aiComplete, type AiMessage } from "@/rekankerja/shared/services/ai-provider";
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";
import { readAttachmentFile } from "@/rekankerja/shared/services/attachment-service";
import type { SupportTicket, SupportMessage } from "@/generated/tenant";

export const SUPPORT_CATEGORIES = ["BUG", "PENGGUNAAN", "DATA", "AKUN", "FITUR", "LAINNYA"] as const;
export const SUPPORT_PRIORITIES = ["RENDAH", "SEDANG", "TINGGI", "KRITIS"] as const;

export const SUPPORT_AI_NAME = "Support AI";

/** Marker metadata triase di akhir balasan AI (di-strip sebelum disimpan). */
const META_RE = /\s*\[\[META:([A-Z_]+)\|([A-Z]+)\]\]\s*$/;

/** Batas riwayat yang dikirim ke LLM (pesan lama dipangkas). */
const HISTORY_LIMIT = 16;

/** Maksimum gambar yang dianalisa VLM per giliran (batas waktu/kuota). */
const MAX_IMAGES_PER_TURN = 3;

/** Nama tampilan aktor di prompt (fallback bila profil tanpa nama). */
function who(ticket: SupportTicket): string {
  return ticket.createdByName?.trim() || "pengguna";
}

/** System prompt persona tim support (L1 — knowledge + triase, tanpa tools). */
export function buildSupportSystemPrompt(ticket: SupportTicket): string {
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
- Pertanyaan seputar data & akun pengguna sendiri (jika perlu data spesifik yang tidak Anda miliki, minta pengguna menyalin teks error/mengirim tangkay layar — jangan menebak).
`,
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
  ].join("\n");
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

/** Hasil satu giliran agen: pesan AI + triase (null = tidak berubah). */
export interface AgentTurnResult {
  message: SupportMessage;
  category: string | null;
  priority: string | null;
}

/**
 * Jalankan satu giliran AI support: analisa gambar → completion → parse META
 * → simpan pesan AI + perbarui triase/lastMessageAt tiket.
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
  const llmMessages = toLlmMessages(messages, imageContext);
  const system = buildSupportSystemPrompt(ticket);

  const result = await aiComplete(db, { system, messages: llmMessages, temperature: 0.4, maxTokens: 1200 });

  // parse + strip marker triase
  let body = result.text.trim();
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
    `Anda juga bisa melampirkan **tangkapan layar** atau dokumen (JPG/PNG/WEBP/PDF, maks 5 MB) — saya akan membacanya langsung.`
  );
}
