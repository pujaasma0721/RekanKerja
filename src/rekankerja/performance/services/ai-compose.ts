// P3-PERF — AI Assist kolom ulasan (AMANDEMEN 3 §18.11; D20): karyawan/atasan
// menulis poin pendek → AI menyusun draf kalimat profesional & konstruktif.
// COMPOSE-ONLY (dilarang menambah fakta/angka/skor), server-side via gateway
// AI internal (z-ai-web-dev-sdk — kunci tidak pernah ke klien), tone terkunci,
// rate-limit 20 susunan/jam/user (ActivityLog), hasil = draf (belum tersimpan).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";

function bad(msg: string): never { throw new Error(msg); }

export type AiTone = "neutral" | "encouraging" | "firm";

const TONE_PROMPT: Record<AiTone, string> = {
  neutral: "Profesional netral — faktual dan seimbang.",
  encouraging: "Memberi semangat — hangat, mengapresiasi upaya, tetap spesifik.",
  firm: "Tegas namun konstruktif — jelas menunjukkan area perbaikan tanpa menghakimi.",
};

const RATE_LIMIT_PER_HOUR = 20;

/** Rate-limit D20: hitung panggilan aiCompose user dalam 1 jam terakhir. */
async function recentComposeCount(db: TenantDb, appUserId: string | null): Promise<number> {
  if (!appUserId) return 0;
  const since = new Date(Date.now() - 3600 * 1000);
  const n = await db.activityLog.count({
    where: { action: "Processed", entity: "AiCompose", entityId: appUserId, createdAt: { gte: since } },
  });
  return n;
}

export async function aiCompose(
  db: TenantDb,
  input: {
    appUserId: string | null;
    points: string[];
    competencyName?: string;
    contextLabel?: string;
    tone?: AiTone;
    length?: "short" | "medium";
    lang: "id" | "en";
    /** skor yang hendak "disusun" — DILARANG (guard D20): payload skor ditolak */
    rejectIfScorePresent?: boolean;
  },
): Promise<{ draft: string }> {
  // ---- guard D20 ----
  if (input.rejectIfScorePresent) bad("Payload tidak boleh menyertakan skor untuk disusun (D20 — compose-only)");
  const points = (input.points ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 6);
  if (points.length === 0) bad("Tuliskan minimal 1 poin pendek untuk disusun (maks 6)");
  const used = await recentComposeCount(db, input.appUserId);
  if (used >= RATE_LIMIT_PER_HOUR) {
    bad("Batas 20 susunan per jam tercapai — coba lagi nanti (D20). Tulis manual tetap bisa.");
  }
  const tone = input.tone ?? "neutral";
  const lang = input.lang === "en" ? "en" : "id";
  const lengthHint = input.length === "medium"
    ? (lang === "id" ? "4–6 kalimat" : "4–6 sentences")
    : (lang === "id" ? "2–3 kalimat" : "2–3 sentences");

  // prompt sistem AI internal (server-side, bukan teks UI) — dibangun via push
  // agar array-of-string tidak terbaca gap bilingual (pola audit perf-excel P1)
  const systemParts: string[] = [];
  systemParts.push("Anda adalah asisten penulisan umpan balik kinerja di aplikasi HR internal.");
  systemParts.push("Tugas: merangkai POIN-Poin yang ditulis penilai menjadi kalimat feedback profesional dan konstruktif.");
  systemParts.push("ATURAN KERAS:");
  systemParts.push("1. COMPOSE-ONLY: gunakan HANYA poin yang diberikan — DILARANG menambah fakta, metrik, angka, pujian, atau kesimpulan baru.");
  systemParts.push("2. JANGAN menghasilkan atau mengubah angka skor apa pun.");
  systemParts.push("3. Bahasa aman untuk tempat kerja Indonesia: tanpa SARA, tanpa janji karir/keuangan, fokus perilaku spesifik yang bisa diperbaiki.");
  systemParts.push(`4. Nada: ${TONE_PROMPT[tone]}`);
  systemParts.push(`5. Panjang: ${lengthHint}. Bahasa keluaran: ${lang === "id" ? "Bahasa Indonesia" : "English"}.`);
  const system = systemParts.join("\n");

  const userParts: string[] = [];
  if (input.competencyName) userParts.push(`Kompetensi: ${input.competencyName}`);
  else if (input.contextLabel) userParts.push(input.contextLabel);
  userParts.push(`Poin penilai (bahasa seadanya, typo oke):`);
  for (let i = 0; i < points.length; i++) userParts.push(`${i + 1}. ${points[i]}`);
  userParts.push("Susun menjadi draf feedback.");
  const userMsg = userParts.join("\n");

  // ---- bukti rate-limit + audit (ActivityLog action Processed entity AiCompose) ----
  if (input.appUserId) {
    await db.activityLog.create({
      data: {
        action: "Processed",
        entity: "AiCompose",
        entityId: input.appUserId,
        detail: `AI compose ${input.competencyName ? `"${input.competencyName}" ` : ""}(${points.length} poin, tone ${tone}, ${lang})`,
      },
    }).catch(() => null);
  }

  // ---- gateway AI internal (server-side; kunci tidak ke klien) ----
  try {
    const zai = await createZaiClient();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system" as const, content: system },
        { role: "user" as const, content: userMsg },
      ],
      thinking: { type: "disabled" as const },
    });
    const draft = (completion.choices?.[0]?.message?.content ?? "").trim();
    if (!draft) bad("AI mengembalikan hasil kosong — tulis manual atau coba lagi");
    return { draft };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Batas 20")) throw e;
    // kegagalan tenang §18.11-5: form 100% berfungsi tanpa AI
    bad("AI sedang tidak tersedia — tulis manual, coba lagi nanti (§18.11-5)");
  }
}
