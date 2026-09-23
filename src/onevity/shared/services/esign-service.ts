import type { NextRequest } from "next/server";
import { resolveMenuPerms } from "@/onevity/shared/services/menu-access";
import type { MenuActor } from "@/onevity/shared/services/menu-access";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { hashPassword, verifyPassword } from "@/onevity/shared/lib/auth";
import { sendSystemEmail } from "@/onevity/shared/services/email-service";
import {
  ESIGN_ALG, GENESIS_HASH, chainHash, computeDocHash, generateChallengeCode,
  generateKeyPair, signHash, verifyHash,
} from "@/onevity/shared/lib/esign-crypto";
import { tenantCryptoForDb, TENANT_SCHEMA_BRAND } from "@/onevity/shared/lib/field-crypto";

// ============ E-SIGN SERVICE (Task 80) ======================================
// Alur: challenge (PIN personal / OTP email) → sign (RSA-PSS over docHash)
//       → SignatureRecord + hash-chain per tenant → verifikasi publik /v/[id].
// Faktor: PIN personal (scrypt, terpisah password login) ATAU OTP email 6
// digit (5 menit, 3 percobaan, satu pakai). VIEWER tidak boleh menandatangani.
// ============================================================================

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 3;
export const ESIGN_DOC_TYPES = ["LetterDocument", "PersonnelAction", "PayrollRun"] as const;
export type EsignDocType = (typeof ESIGN_DOC_TYPES)[number];

interface EsignCtx { db: TenantDb; actor: MenuActor; tenantSlug: string; schema: string; }

/** Nama schema dari brand symbol yang ditempel getTenantClient(). */
function schemaOfDb(db: TenantDb): string {
  return (db as unknown as Record<string, unknown>)[TENANT_SCHEMA_BRAND] as string ?? "";
}

/**
 * Sesi + tenant aktif utk e-sign. resolveMenuPerps-like: super admin / semua
 * role non-VIEWER boleh ttd (guard menu spesifik dilakukan endpoint sumber —
 * ttd adalah bukti atas aksi yang sudah berhak dilakukan).
 */
export async function resolveEsignCtx(req: NextRequest | Request): Promise<EsignCtx | null> {
  const payload = await resolveMenuPerms(req);
  if (!payload) return null;
  if (payload.actor.role === "VIEWER") return null;
  const schema = schemaOfDb(payload.db);
  if (!schema) return null;
  const tenantSlug = await slugOfSchema(schema);
  return { db: payload.db, actor: payload.actor, tenantSlug, schema };
}

async function slugOfSchema(schema: string): Promise<string> {
  // SATU sumber slug untuk sign & verifikasi: registry platform (Tenant.slug).
  // JANGAN derivasi manual dari nama schema (strip underscore dsb.) — hasilnya
  // bisa beda dengan slug saat hash dibuat → verifikasi selalu gagal.
  const { db: platformDb } = await import("@/lib/db");
  const row = await platformDb.tenant.findUnique({
    where: { schemaName: schema },
    select: { slug: true },
  }).catch(() => null);
  return row?.slug ?? schema.replace(/^tenant_/, "");
}

// ---------- kunci per pengguna ----------

export interface EnsureKeyResult { ok: boolean; message: string; }

/** Kunci aktif pengguna; buat otomatis saat pertama (privat dibungkus vault). */
export async function ensureKeyOf(db: TenantDb, appUserId: string): Promise<EnsureKeyResult> {
  const existing = await db.signatureKey.findUnique({ where: { appUserId } });
  if (existing && existing.status === "Active" && existing.encryptedPrivateKey) {
    return { ok: true, message: "kunci aktif" };
  }
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  const enc = tenantCryptoForDb(db);
  const encryptedPrivateKey = enc.encryptText(privateKeyPem);
  if (!encryptedPrivateKey) return { ok: false, message: "Vault tenant belum termuat — kunci tidak dapat dibuat" };
  const data = { publicKey: publicKeyPem, encryptedPrivateKey, algorithm: ESIGN_ALG, status: "Active", rotatedAt: new Date() };
  if (existing) await db.signatureKey.update({ where: { appUserId }, data });
  else await db.signatureKey.create({ data: { appUserId, ...data } });
  return { ok: true, message: "kunci baru" };
}

// ---------- PIN tanda tangan ----------

export async function setSignaturePin(db: TenantDb, appUserId: string, pin: string): Promise<{ ok: boolean; message: string }> {
  if (!/^\d{6}$/.test(pin)) return { ok: false, message: "PIN harus 6 digit angka" };
  await ensureKeyOf(db, appUserId);
  await db.signatureKey.update({
    where: { appUserId },
    data: { pinHash: hashPassword(pin), pinSetAt: new Date() },
  });
  return { ok: true, message: "PIN tanda tangan tersimpan" };
}

export async function clearSignaturePin(db: TenantDb, appUserId: string): Promise<void> {
  await db.signatureKey.updateMany({ where: { appUserId }, data: { pinHash: null, pinSetAt: null } });
}

export async function pinStatusOf(db: TenantDb, appUserId: string): Promise<{ hasPin: boolean; hasKey: boolean }> {
  const k = await db.signatureKey.findUnique({ where: { appUserId }, select: { pinHash: true, encryptedPrivateKey: true } }).catch(() => null);
  return { hasPin: !!k?.pinHash, hasKey: !!k?.encryptedPrivateKey };
}

// ---------- challenge ----------

export interface ChallengeResult { ok: boolean; message: string; factor?: "pin" | "otp"; }

/**
 * Terbitkan challenge utk dokumen. PIN sudah set → klien minta PIN (tanpa
 * kirim apa pun); belum → OTP 6 digit ke email sesi. Response tak membocorkan kode.
 */
export async function createChallenge(db: TenantDb, appUserId: string, email: string, fullName: string, docType: string, docId: string): Promise<ChallengeResult> {
  if (!(ESIGN_DOC_TYPES as readonly string[]).includes(docType)) return { ok: false, message: "Jenis dokumen tidak didukung" };
  const doc = await loadDoc(db, docType, docId);
  if (!doc) return { ok: false, message: "Dokumen tidak ditemukan" };

  const key = await db.signatureKey.findUnique({ where: { appUserId } });
  // buang challenge kedaluwarsa pengguna ini (lazy cleanup)
  await db.signatureChallenge.deleteMany({
    where: { appUserId, expiresAt: { lt: new Date() } },
  }).catch(() => {});

  if (key?.pinHash) return { ok: true, factor: "pin", message: "Masukkan PIN tanda tangan" };

  const code = generateChallengeCode();
  await db.signatureChallenge.create({
    data: { appUserId, docType, docId, codeHash: hashPassword(code), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
  const sent = await sendSystemEmail(db, {
    event: "esign.challenge",
    to: { email, name: fullName },
    subject: `Kode tanda tangan OneVity: ${code}`,
    body: `Halo ${fullName},\n\nKode verifikasi tanda tangan elektronik Anda:\n\n${code}\n\nBerlaku 5 menit untuk 1 dokumen. Jangan bagikan kode ini kepada siapa pun.\n\n--- Email otomatis OneVity HRIS.`,
    secrets: [code],
  });
  if (!sent.ok) {
    return { ok: false, message: "PIN belum diset dan OTP gagal terkirim — " + sent.message };
  }
  return { ok: true, factor: "otp", message: `Kode 6 digit dikirim ke ${maskEmail(email)} — berlaku 5 menit` };
}

function maskEmail(e: string): string {
  const [u, ...rest] = e.split("@");
  return `${u.slice(0, 2)}***@${rest.join("@")}`;
}

/** Verifikasi kode (PIN dulu, lalu OTP satu-pakai dengan batas percobaan). */
async function verifyChallenge(db: TenantDb, appUserId: string, docType: string, docId: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const key = await db.signatureKey.findUnique({ where: { appUserId }, select: { pinHash: true } });
  if (key?.pinHash && verifyPassword(code, key.pinHash)) return true;

  const row = await db.signatureChallenge.findFirst({
    where: { appUserId, docType, docId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return false;
  const matched = verifyPassword(code, row.codeHash);
  const attempts = row.attempts + 1;
  if (!matched) {
    await db.signatureChallenge.update({ where: { id: row.id }, data: { attempts } }).catch(() => {});
    return false;
  }
  if (attempts > CHALLENGE_MAX_ATTEMPTS) return false;
  await db.signatureChallenge.update({ where: { id: row.id }, data: { usedAt: new Date(), attempts } }).catch(() => {});
  return true;
}

// ---------- snapshot dokumen ----------

/** Snapshot identitas dokumen saat ttd (deterministik — sumber docHash). */
async function loadDoc(db: TenantDb, docType: string, docId: string): Promise<Record<string, unknown> | null> {
  if (docType === "LetterDocument") {
    const d = await db.letterDocument.findUnique({
      where: { id: docId },
      select: { id: true, refNo: true, subject: true, body: true, category: true, employeeId: true, issuedAt: true },
    });
    if (!d) return null;
    return { refNo: d.refNo, subject: d.subject, body: d.body, category: d.category, employeeId: d.employeeId, issuedAt: d.issuedAt.toISOString() };
  }
  if (docType === "PersonnelAction") {
    const p = await db.personnelAction.findUnique({
      where: { id: docId },
      select: { id: true, docNo: true, type: true, status: true, effectiveDate: true, reason: true, detailJson: true, employeeId: true },
    });
    if (!p) return null;
    return { docNo: p.docNo, type: p.type, status: p.status, effectiveDate: p.effectiveDate.toISOString(), reason: p.reason, detailJson: p.detailJson, employeeId: p.employeeId };
  }
  if (docType === "PayrollRun") {
    const r = await db.payrollRun.findUnique({
      where: { id: docId },
      select: { id: true, runNo: true, status: true, processTypeId: true, periodId: true, allEmployee: true },
    });
    if (!r) return null;
    return { runNo: r.runNo, status: r.status, processTypeId: r.processTypeId, periodId: r.periodId, allEmployee: r.allEmployee };
  }
  return null;
}

function docRefOf(snap: Record<string, unknown>): string {
  return String(snap.refNo ?? snap.docNo ?? snap.runNo ?? "");
}

// ---------- signing ----------

export interface SignResult { ok: boolean; message: string; signatureId?: string; }

/** Tanda tangani: challenge → snapshot → docHash → RSA-PSS → record + chain. */
export async function signDocument(req: NextRequest, ctx: EsignCtx, docType: string, docId: string, code: string): Promise<SignResult> {
  if (!(ESIGN_DOC_TYPES as readonly string[]).includes(docType)) return { ok: false, message: "Jenis dokumen tidak didukung" };
  const { db, actor } = ctx;
  if (!actor.appUserId) return { ok: false, message: "Hanya pengguna aplikasi (AppUser) yang dapat menandatangani" };

  const snap = await loadDoc(db, docType, docId);
  if (!snap) return { ok: false, message: "Dokumen tidak ditemukan" };

  if (!(await verifyChallenge(db, actor.appUserId, docType, docId, code))) {
    await db.activityLog.create({
      data: { action: "Updated", entity: "SignatureChallenge", entityId: docId, appUserId: actor.appUserId, detail: `Percobaan tanda tangan ${docType} gagal — kode salah/kedaluwarsa` },
    }).catch(() => { /* trail tidak boleh menggagalkan */ });
    return { ok: false, message: "Kode tanda tangan salah atau kedaluwarsa" };
  }

  const ensured = await ensureKeyOf(db, actor.appUserId);
  if (!ensured.ok) return { ok: false, message: ensured.message };
  const key = await db.signatureKey.findUnique({ where: { appUserId: actor.appUserId } });
  if (!key) return { ok: false, message: "Kunci tanda tangan tidak tersedia" };
  const enc = tenantCryptoForDb(db);
  const privateKeyPem = enc.decryptText(key.encryptedPrivateKey);
  if (!privateKeyPem) return { ok: false, message: "Kunci tanda tangan tidak dapat dibuka (vault)" };

  const signedAtIso = new Date().toISOString();
  const docRef = docRefOf(snap);
  // Task 80-fix: signedAt masuk SNAPSHOT (sumber tunggal hash) — kolom DB
  // signedAt diisi now() DB yang bisa beda milidetik dari jam app, sehingga
  // verifikasi yang menghitung ulang dari kolom selalu gagal.
  const snapWithMeta = { ...snap, esign: { signedAt: signedAtIso, tenant: ctx.tenantSlug, alg: ESIGN_ALG } };
  const docHash = computeDocHash({ docType, docId, docRef, snapshot: snapWithMeta, signedAtIso, tenantSlug: ctx.tenantSlug });
  const signature = signHash(docHash, privateKeyPem);

  const last = await db.signatureRecord.findFirst({ orderBy: { signedAt: "desc" }, select: { ownHash: true } });
  const prevHash = last?.ownHash ?? GENESIS_HASH;
  const ownHash = chainHash(prevHash, { docType, docId, docHash, signerAppUserId: actor.appUserId, signedAtIso });

  const rec = await db.signatureRecord.create({
    data: {
      docType, docId, docRef, docHash,
      snapshotJson: JSON.stringify(snapWithMeta), signature, algorithm: ESIGN_ALG,
      signerAppUserId: actor.appUserId, signerName: actor.name,
      signerRole: actor.appUserRole ?? actor.role,
      signerIp: req.headers.get("x-forwarded-for") ?? null,
      signerUa: req.headers.get("user-agent")?.slice(0, 200) ?? null,
      prevHash, ownHash,
    },
  });

  await db.activityLog.create({
    data: { action: "Approved", entity: "SignatureRecord", entityId: rec.id, appUserId: actor.appUserId, detail: `e-Sign ${docType} ${docRef} oleh ${actor.name} — hash ${docHash.slice(0, 12)}…` },
  }).catch(() => { /* trail tidak boleh menggagalkan */ });

  return { ok: true, message: "Dokumen ditandatangani", signatureId: rec.id };
}

// ---------- verifikasi ----------

export interface VerifyResult {
  found: boolean;
  valid?: boolean;
  reason?: string;
  docType?: string; docRef?: string;
  signerName?: string; signerRole?: string | null; signedAt?: string;
  tenantSlug?: string;
  chainIntact?: boolean;
  chainLength?: number;
}

/**
 * Verifikasi kriptografis + keutuhan rantai. Snapshot tersimpan → hash ulang
 * deterministik → verify RSA-PSS → cek prevHash = ownHash predesesor.
 */
export async function verifySignature(db: TenantDb, tenantSlug: string, id: string): Promise<VerifyResult> {
  const rec = await db.signatureRecord.findUnique({ where: { id } });
  if (!rec) return { found: false };

  const snap = JSON.parse(rec.snapshotJson || "{}") as Record<string, unknown>;
  // Task 80-fix: signedAtIso dibaca dari SNAPSHOT (disimpan saat sign) — bukan
  // kolom DB (now() DB ≠ jam app saat hash dibuat).
  const meta = (snap.esign ?? {}) as { signedAt?: string };
  const signedAtIso = meta.signedAt ?? rec.signedAt.toISOString();
  const docHash = computeDocHash({
    docType: rec.docType, docId: rec.docId, docRef: rec.docRef, snapshot: snap,
    signedAtIso, tenantSlug,
  });
  if (docHash !== rec.docHash) {
    return { found: true, valid: false, reason: "Metadata tanda tangan berubah sejak ditandatangani", tenantSlug };
  }

  const key = await db.signatureKey.findUnique({ where: { appUserId: rec.signerAppUserId }, select: { publicKey: true } });
  if (!key) return { found: true, valid: false, reason: "Kunci penandatangan tidak ditemukan", tenantSlug };
  if (!verifyHash(rec.docHash, rec.signature, key.publicKey)) {
    return { found: true, valid: false, reason: "Tanda tangan tidak cocok dengan kunci penandatangan", tenantSlug };
  }

  const prev = await db.signatureRecord.findFirst({
    where: { signedAt: { lt: rec.signedAt } },
    orderBy: { signedAt: "desc" },
    select: { ownHash: true },
  });
  const expectedPrev = prev?.ownHash ?? GENESIS_HASH;
  const chainLength = await db.signatureRecord.count();

  return {
    found: true, valid: true,
    chainIntact: expectedPrev === rec.prevHash,
    chainLength,
    docType: rec.docType, docRef: rec.docRef,
    signerName: rec.signerName, signerRole: rec.signerRole, signedAt: rec.signedAt.toISOString(),
    tenantSlug,
  };
}

// ---------- stempel PDF (Task 80b) ==========================================

export interface PdfEsignStamp {
  verifyUrl: string; // absolut — dienkode ke QR + dicetak teks
  qrPng: Uint8Array; // buffer QR (png)
  signerName: string;
  signerRole: string | null;
  signedAtIso: string; // dari SNAPSHOT (sumber tunggal hash)
  docRef: string;
  docHashShort: string; // 16 hex pertama
}

/** "12 Sep 2026 14:35 WIB" — deterministik, tanpa locale host. */
export function formatWib(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const wib = new Date(d.getTime() + 7 * 60 * 60_000); // UTC+7 tanpa DST
  return `${p(wib.getUTCDate())} ${BULAN[wib.getUTCMonth()]} ${wib.getUTCFullYear()} ${p(wib.getUTCHours())}:${p(wib.getUTCMinutes())} WIB`;
}

/**
 * Stempel e-Sign utk PDF dokumen tertandatangani (ttd TERAKHIR dokumen tsb).
 * Null bila belum ada ttd valid — PDF tetap dicetak tanpa blok e-sign.
 * URL verifikasi dari header request (publicBaseUrlOf) agar QR mengarah ke
 * host yang benar (subdomain tenant).
 */
export async function pdfStampFor(
  db: TenantDb, docType: string, docId: string,
  req: { headers: { get(name: string): string | null } },
): Promise<PdfEsignStamp | null> {
  // slug HARUS sama dengan saat sign — resolusi dari schema via registry (satu sumber)
  const tenantSlug = await slugOfSchema(schemaOfDb(db));
  const rec = await db.signatureRecord.findFirst({
    where: { docType, docId },
    orderBy: { signedAt: "desc" },
  });
  if (!rec) return null;

  const v = await verifySignature(db, tenantSlug, rec.id);
  if (!v.valid) return null; // ttd rusak → jangan mencap "valid" di PDF

  // host request langsung (BUKAN APP_PUBLIC_URL — QR harus ke alamat yang
  // benar per tenant subdomain; /v sendiri tetap bisa verifikasi lintas host)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("192.168.") ? "http" : "https");
  const verifyUrl = `${proto}://${host}/v/${rec.id}`;
  const QRCode = (await import("qrcode")).default;
  const qrPng = await QRCode.toBuffer(verifyUrl, {
    type: "png", margin: 0, width: 152, errorCorrectionLevel: "M",
  });
  const snap = JSON.parse(rec.snapshotJson || "{}") as { esign?: { signedAt?: string } };
  return {
    verifyUrl,
    qrPng: new Uint8Array(qrPng),
    signerName: rec.signerName,
    signerRole: rec.signerRole,
    signedAtIso: snap.esign?.signedAt ?? rec.signedAt.toISOString(),
    docRef: rec.docRef,
    docHashShort: rec.docHash.slice(0, 16),
  };
}
