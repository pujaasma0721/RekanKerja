// RekanKerja — Online Support P3 (FEAT-SUPPORT-P3): tools browser agen. =====
// =====================================================================
// Level otonomi L3 — REPRODUKSI BROWSER HEADLESS + ANALISA TANGKAPAN LAYAR:
//   5. reproduce_browser  — jalankan SATU AKSI browser headless per panggilan
//      (pola ReAct: agen melihat hasil tiap aksi → putuskan aksi berikutnya).
//      Dieksekusi mini-service browser-runner (port 3020, Playwright global
//      sandbox) yang TERKURUNG origin aplikasi sendiri: request lintas-origin
//      di-abort, path goto wajib relatif, download dibatalkan, dialog JS
//      ditolak otomatis, budget 2 sesi/24 aksi/3 tangkapan/TTL 3 menit.
//   6. analyze_screenshot — periksa bukti tangkapan layar hasil reproduce_
//      browser via VLM (createVision — pola describeRecentImages P1).
//
// TATA KELOLA & KEAMANAN:
//   · SupportAgentConfig.browserEnabled (baris ABSEN → true, pola P2).
//   · Login browser MEMAKAI AKUN UJI khusus (browserLoginEmail +
//     browserLoginPassEnc terenkripsi field-crypto) — kata sandi TIDAK
//     PERNAH lewat ke LLM/args; browser TIDAK bertindak sebagai pengguna
//     pelapor. Akun uji idealnya role terbatas (HR), bukan super admin.
//   · Tangkapan layar = bukti; dikumpulkan ephemeral per giliran lalu
//     disimpan sebagai Attachment pesan AI tiket (terlihat pengguna).
//   · Layanan runner tidak tersedia → gagal jujur (agen menyampaikan
//     keterbatasan, bukan mengarang hasil reproduksi).
// =====================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb, tenantSchemaOfDb } from "@/rekankerja/shared/lib/field-crypto";
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";
import { saveAttachment } from "@/rekankerja/shared/services/attachment-service";
import type { SupportToolResult } from "@/rekankerja/support/services/support-tools";

/** URL mini-service browser-runner (server-ke-server, tanpa gateway). */
const RUNNER_URL = (process.env.SUPPORT_BROWSER_RUNNER_URL ?? "http://127.0.0.1:3020").replace(/\/+$/, "");

/** Timeout klien ke runner — aksi terberat (goto) 15s + settle di dalamnya. */
const RUNNER_TIMEOUT_MS = 25_000;

// ------------------------------ config -------------------------------

/** Apakah reproduksi browser diaktifkan utk tenant ini? (ABSEN → true). */
export async function browserEnabledFor(db: TenantDb): Promise<boolean> {
  try {
    const row = await db.supportAgentConfig.findFirst();
    return row ? row.browserEnabled !== false : true;
  } catch {
    return true; // tabel/kolom belum termigrasi (parity akan menyembuhkan)
  }
}

/** Kredensial akun uji browser (null bila belum diatur admin). */
export async function browserLoginFor(db: TenantDb): Promise<{ email: string; password: string } | null> {
  try {
    const row = await db.supportAgentConfig.findFirst();
    const email = row?.browserLoginEmail?.trim();
    if (!email || !row?.browserLoginPassEnc) return null;
    const password = tenantCryptoForDb(db).decryptText(row.browserLoginPassEnc);
    if (!password) return null; // ciphertext tak terbaca (ganti kunci?) — anggap belum diatur
    return { email, password };
  } catch {
    return null;
  }
}

// --------------------------- runner client ---------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

async function runnerJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(RUNNER_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RUNNER_TIMEOUT_MS),
    });
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null; // layanan tak terjangkau / timeout — pemanggil gagal jujur
  }
}

function runnerDown(): SupportToolResult {
  return {
    ok: false,
    output:
      "LAYANAN REPRODUKSI BROWSER TIDAK TERSEDIA di server saat ini (browser-runner tidak merespons). " +
      "Jangan mengklaim telah mencoba apa pun — sampaikan terus terang ke pengguna bahwa reproduksi otomatis sedang tidak dapat dijalankan, lalu bantu dengan informasi yang ada.",
  };
}

function sessionKey(ticketId: string): string {
  return `t${ticketId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}`;
}

// --------------------------- shot collector ---------------------------

export interface BrowserShot {
  label: string;
  mime: string;
  b64: string;
  bytes: number;
}

/** Bukti tangkapan layar per tiket (ephemeral — dipindah ke Attachment saat
 *  balasan final AI disimpan; dibersihkan tiap awal giliran baru). */
const shotCollector = new Map<string, BrowserShot[]>();

export function clearShotCollector(ticketId: string): void {
  shotCollector.delete(ticketId);
}

function sanitizeLabel(raw: unknown, fallbackNo: number): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || `bukti-${fallbackNo || 1}`;
}

// ------------------------- tool: reproduce_browser -------------------

export async function runBrowserTool(db: TenantDb, ticketId: string, args: Record<string, unknown>): Promise<SupportToolResult> {
  if (!(await browserEnabledFor(db))) {
    return {
      ok: false,
      output:
        "DITOLAK: mode reproduksi browser dimatikan admin tenant ini. Sampaikan kepada pengguna bahwa reproduksi otomatis sedang nonaktif, lalu bantu mendiagnosa dengan alat lain (kode/data/log) atau informasi dari pengguna.",
    };
  }
  const action = (args.action && typeof args.action === "object" ? args.action : null) as Record<string, unknown> | null;
  if (!action) {
    return { ok: false, output: "Parameter 'action' (objek JSON) wajib — mis. {\"action\":{\"type\":\"goto\",\"path\":\"/\"}}. Lihat daftar aksi pada instruksi alat." };
  }
  const key = sessionKey(ticketId);
  const type = String(action.type ?? "");

  // ---- login: kredensial SELALU dari config admin — bukan dari args LLM ----
  if (type === "login") {
    const creds = await browserLoginFor(db);
    if (!creds) {
      return {
        ok: false,
        output:
          "AKUN UJI BELUM DIATUR: admin belum mengonfigurasi akun uji browser (Pengaturan → AI → Agen Support). Tanpa akun uji, sesi browser berjalan TANPA login (hanya halaman publik). Katakan keterbatasan ini terus terang bila halaman internal diperlukan.",
      };
    }
    const r = await runnerJson("/session", { key, login: creds });
    if (!r) return runnerDown();
    if (r.ok !== true) return { ok: false, output: `Login akun uji gagal: ${str(r.error) || "tidak diketahui"}. Laporkan ke pengguna bahwa reproduksi internal belum bisa dilakukan (masalah konfigurasi akun uji).` };
    const id = (r.identity ?? {}) as Record<string, unknown>;
    const who = [str(id.name) || str(id.email) || "akun uji", str(id.email) ? `<${str(id.email)}>` : ""].filter(Boolean).join(" ");
    return {
      ok: true,
      output:
        `Sesi browser AKTIF — login berhasil sebagai ${who}${str(id.tenantName) ? ` (workspace: ${str(id.tenantName)})` : ""}.\n` +
        `URL: ${str(r.url)}\nLanjutkan: goto halaman terkait laporan pengguna → snapshot → amati/interaksi → screenshot bukti → close.`,
    };
  }

  if (type === "close") {
    const r = await runnerJson("/action", { key, action: { type: "close" } });
    if (!r) return runnerDown();
    return { ok: true, output: "Sesi browser ditutup." };
  }

  const r = await runnerJson("/action", { key, action });
  if (!r) return runnerDown();
  const head = `URL: ${str(r.url) || "(kosong)"} · Judul: ${str(r.title) || "(kosong)"}`;

  if (r.ok !== true) {
    return {
      ok: false,
      output:
        `Aksi "${type}" GAGAL: ${str(r.error) || "tidak diketahui"}\n${head}\n` +
        `Petunjuk: bila "ref" tidak dikenal/halaman sudah berubah, jalankan aksi {"type":"snapshot"} dulu untuk ref baru; bila elemen belum termuat, tunggu ({"type":"wait","ms":1500}).`,
    };
  }

  const budgets = (r.budgets ?? {}) as Record<string, unknown>;
  const budgetLine = `Aksi terpakai ${str(budgets.actions) || "?"} · tangkapan layar ${str(budgets.screenshots) || "?"}`;
  const fresh = r.fresh === true;

  if (type === "screenshot") {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const img = str(data.image);
    if (!img) return { ok: false, output: `Tangkapan layar gagal (data kosong).\n${head}` };
    const shots = shotCollector.get(ticketId) ?? [];
    const label = sanitizeLabel(action.label, shots.length + 1);
    shots.push({ label, mime: "image/jpeg", b64: img, bytes: Number(data.bytes) || 0 });
    shotCollector.set(ticketId, shots);
    return {
      ok: true,
      output:
        `Tangkapan layar "${label}" TERSIMPAN — SISTEM melampirkannya OTOMATIS sebagai file di bawah balasan final Anda (terlihat pengguna sebagai bukti).\n` +
        `JANGAN menulis link/gambar markdown atas nama tangkapan layar ini — cukup sebut "tangkapan layar terlampir di bawah".\n${head}\n${budgetLine}\n` +
        `Bila perlu memeriksa detail visual (pesan error kecil, kondisi UI), panggil analyze_screenshot dengan {"shot":"${label}","question":"…"}.`,
    };
  }

  if (type === "snapshot") {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items.map(String) : [];
    const headings = Array.isArray(data.headings) ? data.headings.map(String) : [];
    const skipped = Number(data.skipped) || 0;
    const lines: string[] = [
      ...(fresh ? ["(sesi browser baru dibuat — TANPA login; panggil {\"action\":{\"type\":\"login\"}} bila halaman internal diperlukan)"] : []),
      ...headings.map((h) => `# ${h}`),
      ...items,
      ...(skipped > 0 ? [`… (${skipped} elemen lain tidak tercantum)`] : []),
    ];
    let out = lines.join("\n");
    if (out.length > 3500) out = out.slice(0, 3500) + "\n… (daftar elemen dipotong)";
    return { ok: true, output: `ELEMEN HALAMAN (ref e1..eN — pakai untuk click/fill/select):\n${out}\n${head}\n${budgetLine}` };
  }

  if (type === "console") {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (lines.length === 0) return { ok: true, output: `Tidak ada error/peringatan console maupun request gagal yang tertangkap.\n${head}` };
    const out = lines
      .map((l) => {
        const o = l as Record<string, unknown>;
        return `[${str(o.type)}] ${str(o.text)}`;
      })
      .join("\n");
    return { ok: true, output: `ERROR/PERINGATAN TERTANGKAP (${lines.length} terakhir):\n${out.slice(0, 3000)}\n${head}` };
  }

  // aksi generik: goto/click/fill/select/press/check/uncheck/scroll/wait
  const consoleNew = Array.isArray(r.consoleNew) ? r.consoleNew : [];
  const cNew =
    consoleNew.length > 0
      ? "\nERROR BARU TERTANGKAP: " +
        consoleNew
          .map((l) => {
            const o = l as Record<string, unknown>;
            return `[${str(o.type)}] ${str(o.text).slice(0, 160)}`;
          })
          .join(" | ")
          .slice(0, 800)
      : "";
  return { ok: true, output: `OK — aksi "${type}" dijalankan.\n${head}${cNew}\n${budgetLine}` };
}

// ----------------------- tool: analyze_screenshot --------------------

export async function analyzeScreenshotTool(_db: TenantDb, ticketId: string, args: Record<string, unknown>): Promise<SupportToolResult> {
  void _db; // klien AI builtin — tanpa query DB
  const raw = String(args.shot ?? "").trim();
  const shots = shotCollector.get(ticketId) ?? [];
  const shot = shots.find((s) => s.label === raw);
  if (!shot) {
    return {
      ok: false,
      output: shots.length
        ? `Tangkapan layar "${raw.slice(0, 40)}" tidak ditemukan. Yang tersedia giliran ini: ${shots.map((s) => s.label).join(", ")}.`
        : `Belum ada tangkapan layar giliran ini — jalankan reproduce_browser dengan {"action":{"type":"screenshot","label":"…"}} dulu.`,
    };
  }
  const question = String(args.question ?? "").trim().slice(0, 300) || "Deskripsikan apa yang terlihat dan apa yang tampak tidak beres.";
  const prompt =
    `Anda asisten tim support yang memeriksa BUKTI TANGKAPAN LAYAR hasil reproduksi otomatis di aplikasi HRIS RekanKerja. ` +
    `Pertanyaan pemeriksa: "${question}". Jawab faktual HANYA dari yang terlihat di gambar: pesan error (kutip persis teksnya), ` +
    `elemen/halaman yang terlihat, dan apa yang tampak tidak beres. Maksimal 150 kata. Jangan menebak di luar gambar.`;
  try {
    const zai = await createZaiClient();
    // d.ts menuntut field `model` tapi runtime SDK mengabaikannya (pola
    // describeRecentImages di support-agent.ts) — kompromi tipe:
    // @ts-expect-error field model tidak diperlukan runtime createVision
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${shot.mime};base64,${shot.b64}` } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { ok: false, output: "Analisa gambar mengembalikan hasil kosong — periksa langsung ringkasan reproduksi Anda." };
    return { ok: true, output: `[Analisa AI vision atas tangkapan layar "${shot.label}"]\n${text}` };
  } catch (e) {
    return { ok: false, output: `Analisa gambar gagal: ${e instanceof Error ? e.message : "unknown"} — andalkan fakta lain yang sudah Anda kumpulkan.` };
  }
}

// --------------------- persistensi bukti (attachment) ------------------

/** Slug tenant dari brand schema client (reversi schemaNameForSlug). */
function slugOfDb(db: TenantDb): string {
  return tenantSchemaOfDb(db).replace(/^tenant_/, "").replace(/_/g, "-");
}

/** Simpan seluruh tangkapan layar giliran ini sebagai lampiran pesan AI
 *  (entityType SupportMessage) — otomatis terlihat di utas chat. */
export async function persistShots(db: TenantDb, ticketId: string, aiMessageId: string): Promise<number> {
  const shots = shotCollector.get(ticketId) ?? [];
  if (shots.length === 0) return 0;
  const slug = slugOfDb(db);
  let saved = 0;
  for (const shot of shots) {
    try {
      await saveAttachment(db, slug, {
        file: Buffer.from(shot.b64, "base64"),
        fileName: `reproduksi-${shot.label}.jpg`,
        mimeType: "image/jpeg",
        entityType: "SupportMessage",
        entityId: aiMessageId,
        uploadedBy: null,
      });
      saved += 1;
    } catch (e) {
      console.warn(`[support-browser] gagal menyimpan screenshot ${shot.label}:`, e instanceof Error ? e.message : e);
    }
  }
  shotCollector.delete(ticketId);
  return saved;
}
