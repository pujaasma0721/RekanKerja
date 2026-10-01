// RekanKerja — SERVICE WHATSAPP (Task 28-a) ==============================
// =====================================================================
// Pengiriman WhatsApp otomatis oleh sistem (kanal kedua selain email —
// arsitektur menyalin email-service.ts Task 34):
//   sendWa(db, {event, toPhone, placeholders})   — never-throw, fire-and-forget
//   sendWaBatch(db, {event, recipients[]})       — fanout (announcement, dsb.)
//   sendWaTest(db, toPhone)                      — tes kirim + status terakhir
//   getWaConfig(db)                              — config (self-heal baris default)
//
// Provider (kontrak diverifikasi via web-search saat Task 28-a):
//   · Fonnte  — POST https://api.fonnte.com/send, header
//     `Authorization: <token>` (TANPA Bearer — docs.fonnte.com/api-send-message),
//     body JSON { target, message, countryCode } (target harus string,
//     countryCode "0" menonaktifkan filter nomor — kita pre-normalisasi 62).
//   · Wablas  — POST https://<region>.wablas.com/api/send-message, header
//     `Authorization: <token>` (dokumentasi wablas.com/documentation/api;
//     varian token.secret_key atau query ?token= juga ada — token polos
//     di header adalah bentuk terdokumentasi), body JSON { phone, message }.
//   · Custom  — POST endpoint apa pun (self-hosted/gateway sendiri),
//     body JSON { target, phone, message, event } — diterima longgar.
//
// Prinsip: kegagalan pengiriman TIDAK PERNAH mengganggu proses bisnis
// utama; setiap percobaan dicatat ke WaLog (Sent/Failed/Skipped) untuk
// audit tab "Riwayat Kirim". Urutan cek: config → template → nomor HP —
// nomor kosong hanya tercatat Skipped saat config & template aktif
// (menghindari spam log ketika kanal mati, menyalin semantik email).
// =====================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { WA_DEFAULT_TEMPLATES } from "@/rekankerja/shared/services/wa-defaults";

// ---------- tipe ----------

export type WaProvider = "Fonnte" | "Wablas" | "Custom";

export const WA_PROVIDERS: WaProvider[] = ["Fonnte", "Wablas", "Custom"];

/** Endpoint default per provider (dipakai bila kolom endpoint kosong). */
export const WA_PROVIDER_ENDPOINTS: Record<WaProvider, string> = {
  Fonnte: "https://api.fonnte.com/send",
  Wablas: "", // region spesifik: https://<region>.wablas.com/api/send-message — wajib diisi admin
  Custom: "", // wajib diisi admin (mis. gateway internal)
};

interface WaConfigRow {
  id: string; active: boolean;
  provider: string; endpoint: string; token: string; sender: string;
  lastTestOk: boolean | null; lastTestAt: Date | null; lastTestMessage: string | null;
  updatedAt: Date;
}

export interface SendWaInput {
  event: string;               // "leave.submitted" dst — kunci WaTemplate
  toPhone: string | null;      // nomor tujuan (dinormalisasi otomatis; null → Skipped)
  placeholders?: Record<string, string>;
}

export interface SendWaBatchInput {
  event: string;
  recipients: { phone: string | null; placeholders?: Record<string, string> }[];
}

export interface SendWaResult {
  ok: boolean;
  status: "Sent" | "Failed" | "Skipped";
  phone: string;
  error?: string;
}

// ---------- konfigurasi ----------

/**
 * Ambil baris config WhatsApp; LAZILY CREATE baris default bila tabel masih
 * kosong (self-heal menyalin getActiveConfig + POST email-config).
 * Default: MATI, provider Fonnte — aman: tanpa token, semua kirim → Skipped.
 */
export async function getWaConfig(db: TenantDb): Promise<WaConfigRow> {
  const row = await db.waConfig.findFirst();
  if (row) return row;
  try {
    return await db.waConfig.create({ data: {} }); // default schema: active=false, provider=Fonnte
  } catch {
    // race create ganda (paralel) → baca ulang baris pertama
    return (await db.waConfig.findFirst()) as WaConfigRow;
  }
}

/** Endpoint efektif kirim (kolom config → fallback default provider). */
function effectiveEndpoint(cfg: WaConfigRow): string {
  const ep = (cfg.endpoint ?? "").trim();
  if (ep) return ep;
  return WA_PROVIDER_ENDPOINTS[(cfg.provider as WaProvider) ?? "Custom"] ?? "";
}

/** Provider siap kirim? (token + endpoint terisi). */
export function waReady(cfg: WaConfigRow): boolean {
  return (cfg.token ?? "").trim().length > 0 && effectiveEndpoint(cfg).length > 0;
}

// ---------- util ----------

/** Render placeholder {{key}} → nilai (kunci tak dikenal → tetap). */
export function renderWaTemplate(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) => {
    const v = data[key];
    return v != null && v !== "" ? v : m;
  });
}

/**
 * Normalisasi nomor HP Indonesia → format 62xxxxxxxxxx:
 *   0812… → 62812… · +628… → 628… · 628… → tetap · 812… → 62812…
 */
export function normalizePhone(raw: string | null | undefined): string {
  let p = (raw ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!p) return "";
  if (p.startsWith("0")) p = `62${p.slice(1)}`;
  else if (p.startsWith("8")) p = `62${p}`; // tanpa prefix sama sekali
  return p;
}

/** Apakah nomor valid untuk dikirim (≥ 10 digit, mulai 62). */
function phoneValid(p: string): boolean {
  return /^62\d{8,13}$/.test(p);
}

async function writeLog(
  db: TenantDb,
  entry: { event: string; toPhone: string; body?: string | null; status: string; error?: string },
): Promise<void> {
  try {
    await db.waLog.create({
      data: {
        event: entry.event,
        toPhone: entry.toPhone.slice(0, 40),
        body: (entry.body ?? null)?.slice(0, 500) ?? null,
        status: entry.status,
        error: entry.error ? entry.error.slice(0, 500) : null,
      },
    });
  } catch {
    // log gagal tidak boleh melempar
  }
}

// ---------- kirim ke provider ----------

interface ProviderPostResult { ok: boolean; error?: string; detail?: string }

function buildProviderBody(provider: string, phone: string, message: string, event: string): Record<string, string> {
  if (provider === "Fonnte") {
    // docs.fonnte.com: target (string, wajib) + message + countryCode "0"
    // (nonaktifkan filter — nomor sudah 62-prefixed oleh normalizePhone).
    return { target: phone, message, countryCode: "0" };
  }
  if (provider === "Wablas") {
    // wablas.com/documentation/api: POST /api/send-message { phone, message }.
    return { phone, message };
  }
  // Custom: longgar — kunci umum gateway internal / mini-service catcher.
  return { target: phone, phone, message, event };
}

/**
 * POST ke endpoint provider dengan timeout 10 dtk (AbortController).
 * Fonnte/Wablas mengembalikan HTTP 200 + {"status":false,...} saat gagal —
 * status:false dicek eksplisit selain kode HTTP.
 */
async function postToProvider(
  cfg: WaConfigRow,
  input: { phone: string; message: string; event: string },
): Promise<ProviderPostResult> {
  const endpoint = effectiveEndpoint(cfg);
  if (!endpoint) return { ok: false, error: "Endpoint provider belum diisi" };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if ((cfg.token ?? "").trim()) headers.Authorization = cfg.token.trim(); // Fonnte/Wablas: token polos, tanpa Bearer
    const body = buildProviderBody(cfg.provider, input.phone, input.message, input.event);

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text().catch(() => "");
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* body non-JSON */ }

    const providerFailed = json != null && "status" in json && json.status === false;
    if (!res.ok || providerFailed) {
      const reason =
        (json && (json.reason ?? json.message ?? json.error)) ? String(json.reason ?? json.message ?? json.error)
        : text ? text.slice(0, 200)
        : `HTTP ${res.status}`;
      return { ok: false, error: String(reason).slice(0, 300) };
    }
    return { ok: true, detail: json?.id != null ? String(json.id) : undefined };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    const msg = e instanceof Error ? e.message : "unknown";
    return { ok: false, error: (isAbort ? `Timeout 10 detik — ${msg}` : msg).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- template resolution ----------

interface WaTemplateRow { id: string; event: string; label: string; active: boolean; body: string }

/** Template by event + self-heal upsert dari default (edit aman). */
async function resolveTemplate(db: TenantDb, event: string): Promise<WaTemplateRow | null> {
  let tpl = await db.waTemplate.findUnique({ where: { event } });
  if (!tpl) {
    const def = WA_DEFAULT_TEMPLATES.find((t) => t.event === event);
    if (def) {
      tpl = await db.waTemplate
        .upsert({ where: { event }, update: {}, create: { event: def.event, label: def.label, active: def.active, body: def.body } })
        .catch(() => null);
    }
  }
  return tpl;
}

// ---------- kirim utama ----------

/**
 * KIRIM SATU PESAN WHATSAPP — never-throw. Selalu resolve result + tulis
 * WaLog. Urutan cek (setiap langkah gagal → satu baris Skipped):
 *   1. config tidak aktif / tidak siap (token/endpoint) → Skipped
 *   2. template event tidak ada / dimatikan admin → Skipped
 *   3. nomor HP kosong / invalid → Skipped (hanya tercapai saat 1&2 lolos —
 *      nomor kosong tidak menambah log saat kanal mati)
 *   4. POST sukses → Sent; gagal → Failed + error.
 */
export async function sendWa(db: TenantDb, input: SendWaInput): Promise<SendWaResult> {
  const phone = normalizePhone(input.toPhone);
  try {
    // 1 — config
    const cfg = await getWaConfig(db);
    if (!cfg.active) {
      await writeLog(db, { event: input.event, toPhone: phone || (input.toPhone ?? "-"), status: "Skipped", error: "Kanal WhatsApp belum aktif" });
      return { ok: false, status: "Skipped", phone, error: "Kanal WhatsApp belum aktif" };
    }
    if (!waReady(cfg)) {
      await writeLog(db, { event: input.event, toPhone: phone || (input.toPhone ?? "-"), status: "Skipped", error: "Provider belum dikonfigurasi (token/endpoint kosong)" });
      return { ok: false, status: "Skipped", phone, error: "Provider belum dikonfigurasi (token/endpoint kosong)" };
    }

    // 2 — template (self-heal; dimatikan admin → Skipped tercatat)
    const tpl = await resolveTemplate(db, input.event);
    if (!tpl) {
      await writeLog(db, { event: input.event, toPhone: phone || (input.toPhone ?? "-"), status: "Skipped", error: `Template "${input.event}" tidak ditemukan` });
      return { ok: false, status: "Skipped", phone, error: `Template "${input.event}" tidak ditemukan` };
    }
    if (!tpl.active) {
      await writeLog(db, { event: input.event, toPhone: phone || (input.toPhone ?? "-"), status: "Skipped", error: `Template "${tpl.label}" dinonaktifkan admin` });
      return { ok: false, status: "Skipped", phone, error: `Template "${tpl.label}" dinonaktifkan admin` };
    }

    // 3 — nomor tujuan
    if (!phone || !phoneValid(phone)) {
      const err = !input.toPhone ? "Nomor WhatsApp karyawan kosong" : `Nomor tidak valid: ${input.toPhone}`;
      await writeLog(db, { event: input.event, toPhone: phone || (input.toPhone ?? "(kosong)"), status: "Skipped", error: err });
      return { ok: false, status: "Skipped", phone: input.toPhone ?? "", error: err };
    }

    // 4 — render + kirim
    const message = renderWaTemplate(tpl.body, input.placeholders ?? {});
    const res = await postToProvider(cfg, { phone, message, event: input.event });
    if (res.ok) {
      await writeLog(db, { event: input.event, toPhone: phone, body: message, status: "Sent" });
      return { ok: true, status: "Sent", phone };
    }
    await writeLog(db, { event: input.event, toPhone: phone, body: message, status: "Failed", error: res.error });
    return { ok: false, status: "Failed", phone, error: res.error };
  } catch (e) {
    // safety net — notifikasi tidak pernah merusak proses utama
    const msg = e instanceof Error ? e.message : "unknown";
    try {
      await writeLog(db, { event: input.event, toPhone: phone || (input.toPhone ?? "-"), status: "Failed", error: msg });
    } catch { /* never */ }
    return { ok: false, status: "Failed", phone, error: msg };
  }
}

/**
 * KIRIM BATCH (fanout — mis. pengumuman). Config + template dicek SEKALI
 * (satu baris Skipped ringkasan bila kanal mati — anti spam log), lalu tiap
 * penerima dikirim & dicatat terpisah.
 */
export async function sendWaBatch(db: TenantDb, input: SendWaBatchInput): Promise<SendWaResult[]> {
  const n = input.recipients.length;
  if (n === 0) return [];
  try {
    // 1 — config (sekali)
    const cfg = await getWaConfig(db);
    if (!cfg.active || !waReady(cfg)) {
      const err = !cfg.active ? "Kanal WhatsApp belum aktif" : "Provider belum dikonfigurasi (token/endpoint kosong)";
      await writeLog(db, { event: input.event, toPhone: `(batch ${n} penerima)`, status: "Skipped", error: err });
      return input.recipients.map(() => ({ ok: false, status: "Skipped" as const, phone: "", error: err }));
    }

    // 2 — template (sekali)
    const tpl = await resolveTemplate(db, input.event);
    if (!tpl || !tpl.active) {
      const err = !tpl ? `Template "${input.event}" tidak ditemukan` : `Template "${tpl.label}" dinonaktifkan admin`;
      await writeLog(db, { event: input.event, toPhone: `(batch ${n} penerima)`, status: "Skipped", error: err });
      return input.recipients.map(() => ({ ok: false, status: "Skipped" as const, phone: "", error: err }));
    }

    // 3 — per penerima (nomor kosong → Skipped per orang)
    const out: SendWaResult[] = [];
    for (const r of input.recipients) {
      const phone = normalizePhone(r.phone);
      if (!phone || !phoneValid(phone)) {
        const err = !r.phone ? "Nomor WhatsApp karyawan kosong" : `Nomor tidak valid: ${r.phone}`;
        await writeLog(db, { event: input.event, toPhone: phone || (r.phone ?? "(kosong)"), status: "Skipped", error: err });
        out.push({ ok: false, status: "Skipped", phone: r.phone ?? "", error: err });
        continue;
      }
      const message = renderWaTemplate(tpl.body, r.placeholders ?? {});
      const res = await postToProvider(cfg, { phone, message, event: input.event });
      if (res.ok) {
        await writeLog(db, { event: input.event, toPhone: phone, body: message, status: "Sent" });
        out.push({ ok: true, status: "Sent", phone });
      } else {
        await writeLog(db, { event: input.event, toPhone: phone, body: message, status: "Failed", error: res.error });
        out.push({ ok: false, status: "Failed", phone, error: res.error });
      }
    }
    return out;
  } catch {
    // safety net
    return input.recipients.map(() => ({ ok: false, status: "Failed" as const, phone: "", error: "unknown" }));
  }
}

// ---------- tes kirim ----------

/**
 * Tes kirim (tombol "Tes Kirim") — pesan langsung tanpa template.
 * Memperbarui lastTestOk/At/Message pada config. Selalu resolve
 * {ok, message}; tidak pernah throw.
 */
export async function sendWaTest(db: TenantDb, toPhone: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await getWaConfig(db);
  if (!waReady(cfg)) {
    const msg = "Provider belum dikonfigurasi — isi token & endpoint lalu simpan";
    await writeLog(db, { event: "config.test", toPhone: normalizePhone(toPhone) || toPhone, status: "Skipped", error: msg });
    return { ok: false, message: msg };
  }
  const phone = normalizePhone(toPhone);
  if (!phone || !phoneValid(phone)) {
    return { ok: false, message: "Nomor tujuan tidak valid (contoh: 081234567899)" };
  }

  const message = `Tes kirim WhatsApp dari RekanKerja HRIS${cfg.sender ? ` (${cfg.sender})` : ""} — bila Anda menerima pesan ini, kanal notifikasi WhatsApp sudah benar.`;
  const res = await postToProvider(cfg, { phone, message, event: "config.test" });
  try {
    await db.waConfig.update({
      where: { id: cfg.id },
      data: {
        lastTestOk: res.ok,
        lastTestAt: new Date(),
        lastTestMessage: res.ok ? "OK — pesan WhatsApp terkirim" : (res.error ?? "unknown").slice(0, 300),
      },
    });
  } catch { /* status tes best-effort */ }
  await writeLog(db, { event: "config.test", toPhone: phone, body: message, status: res.ok ? "Sent" : "Failed", error: res.error });
  return res.ok
    ? { ok: true, message: `Pesan uji terkirim ke ${phone}` }
    : { ok: false, message: `Gagal: ${res.error ?? "unknown"}` };
}

// ---------- helper penerima (menyalin email-service) ----------

/** Nomor WhatsApp karyawan (Employee.phone) — null bila kosong. */
export async function employeePhoneOf(db: TenantDb, employeeId: string | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { phone: true } });
  return emp?.phone ?? null;
}

/**
 * Nomor WA approver: AppUser admin/HR aktif (maks 5) → Employee.phone.
 * Mirror approverEmailsOf (fallback demo single-approver).
 */
export async function approverPhonesOf(db: TenantDb, excludeEmployeeId?: string | null): Promise<string[]> {
  const users = await db.appUser.findMany({
    where: { active: true, role: { in: ["HR Manager", "Admin"] } },
    select: { employeeId: true },
    take: 5,
  });
  const ids = users
    .map((u) => u.employeeId)
    .filter((x): x is string => !!x && x !== excludeEmployeeId);
  if (ids.length === 0) return [];
  const emps = await db.employee.findMany({ where: { id: { in: ids } }, select: { phone: true } });
  return emps.map((e) => e.phone).filter((p): p is string => !!p);
}
