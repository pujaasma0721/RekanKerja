// RekanKerja — RECRUITMENT E-SIGN SERVICE (F7 — e-sign kandidat eksternal) ===
// ============================================================================
// Tanda tangan ringkas kandidat EKSTERNAL (tanpa akun sistem) atas surat
// rekrutmen (offer / pengangkatan — RecruitmentLetter):
//   1. HR membuat permintaan (token URL 32-byte) → OTP 6 digit dikirim ke
//      email kandidat (TTL 5 menit — pola challenge Task 80: scrypt hash,
//      JANGAN simpan OTP plaintext; kandidat internal TIDAK lewat sini —
//      mereka memakai mesin tanda tangan karyawan /api/rekankerja/esign).
//   2. Kandidat membuka {CANDIDATE_PORTAL_URL}/sign/<token>, mengetik nama
//      PERSIS + kode OTP.
//   3. Saat ttd: pdfSha256 = SHA-256 byte PDF surat (letterPdf mesin surat
//      rekrutmen) → status Signed — baseline tamper-evident yang bisa
//      diverifikasi ulang (verifyEsignHash).
// ============================================================================
import { createHash, randomBytes } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { hashPassword, verifyPassword } from "@/rekankerja/shared/lib/auth";
import { generateChallengeCode } from "@/rekankerja/shared/lib/esign-crypto";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { letterPdf } from "@/rekankerja/recruitment/services/selection-service";

/** TTL kode OTP (menit). */
const OTP_TTL_MS = 5 * 60_000;
/** Masa berlaku link tanda tangan. */
const ESIGN_EXPIRY_MS = 7 * 24 * 60 * 60_000;

/** Basis URL portal kandidat (halaman /sign/<token> dikerjakan koordinator). */
function portalBase(): string {
  return process.env.CANDIDATE_PORTAL_URL ?? "http://127.0.0.1:3010";
}

// ============ serializer ============

export interface EsignSerializer {
  id: string;
  token: string;
  status: string;
  purpose: string;
  expiresAt: string;
}

export interface EsignRequestRow {
  id: string;
  offerNo: string | null;
  signerName: string;
  status: string;
  purpose: string;
  signedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PublicEsignInfo {
  status: string;
  purpose: string;
  signerName: string;
  letterNo: string | null;
  letterKind: string | null;
  offerNo: string | null;
  companyName: string | null;
  expiresAt: string;
}

// ============ buat / kirim ulang ============

/**
 * Buat permintaan tanda tangan utk offer (surat offer saat Sent/Viewed; surat
 * pengangkatan saat offer Accepted + pengangkatan terbit). Kandidat harus
 * EKSTERNAL dgn email pelamar tersedia.
 */
export async function createEsignRequest(
  db: TenantDb,
  input: { offerId: string; requestedById: string },
): Promise<EsignSerializer> {
  const offer = await db.candidateOffer.findUnique({
    where: { id: input.offerId },
    include: {
      candidate: {
        select: { id: true, fullName: true, source: true, applicantId: true, employeeId: true },
      },
      appointment: { select: { id: true, letterNo: true } },
      pr: { select: { prNo: true } },
    },
  });
  if (!offer) throw new Error("Offer tidak ditemukan");
  if (offer.candidate.employeeId) {
    throw new Error("Kandidat internal memakai mesin tanda tangan karyawan (e-sign HRIS) — bukan tautan kandidat eksternal");
  }
  if (!offer.candidate.applicantId) throw new Error("Kandidat tanpa data pelamar — email OTP tidak tersedia");

  // tujuan surat: offer (Sent/Viewed) | pengangkatan (Accepted + appointed)
  let purpose: "offer" | "appointment";
  let letterNo: string | null = null;
  if (offer.status === "Sent" || offer.status === "Viewed") {
    purpose = "offer";
    letterNo = offer.letterNo;
  } else if (offer.status === "Accepted" && offer.appointment?.letterNo) {
    purpose = "appointment";
    letterNo = offer.appointment.letterNo;
  } else {
    throw new Error(
      `Offer ${offer.offerNo} berstatus ${offer.status} — e-sign diajukan saat offer Sent/Viewed (surat penawaran) atau Accepted setelah pengangkatan terbit (surat pengangkatan)`,
    );
  }
  if (!letterNo) throw new Error("Surat rekrutmen belum tertaut pada offer — kirim offer / terbitkan pengangkatan dulu");

  const letter = await db.recruitmentLetter.findUnique({ where: { letterNo }, select: { id: true, letterNo: true } });
  if (!letter) throw new Error(`Surat ${letterNo} tidak ditemukan — terbitkan ulang surat`);

  // email kandidat eksternal (decrypt)
  const tc = tenantCryptoForDb(db);
  const applicant = await db.applicant.findUnique({
    where: { id: offer.candidate.applicantId },
    select: { email: true },
  });
  const signerEmail = applicant?.email ? tc.decryptText(applicant.email) : null;
  if (!signerEmail) throw new Error("Email pelamar tidak tersedia — OTP tidak dapat dikirim");

  const token = randomBytes(32).toString("hex");
  const otp = generateChallengeCode();
  const row = await db.esignRequest.create({
    data: {
      token,
      letterId: letter.id,
      offerId: offer.id,
      purpose,
      signerName: offer.candidate.fullName,
      signerEmailEnc: tc.encryptText(signerEmail)!,
      status: "Pending",
      otpHash: hashPassword(otp),
      otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      requestedById: input.requestedById,
      expiresAt: new Date(Date.now() + ESIGN_EXPIRY_MS),
    },
  });

  void notifyEmailEvent(db, {
    event: "recruitment.esign.otp",
    to: [{ email: signerEmail, name: offer.candidate.fullName }],
    data: {
      nama: offer.candidate.fullName,
      otp,
      otpSecret: otp, // redaksi salinan log (K-4)
      link: `${portalBase()}/sign/${token}`,
      offerNo: offer.offerNo,
      token,
    },
  });

  await db.activityLog.create({
    data: {
      actorType: "user",
      employeeId: input.requestedById,
      action: "EsignRequested",
      entity: "EsignRequest",
      entityId: offer.offerNo,
      detail: `Permintaan e-sign ${purpose} ${offer.offerNo} (${offer.candidate.fullName}) — surat ${letter.letterNo}, token ${token.slice(0, 8)}…, OTP dikirim ke email kandidat`,
    },
  }).catch(() => {});

  return { id: row.id, token, status: row.status, purpose, expiresAt: row.expiresAt.toISOString() };
}

/** Kirim ulang OTP baru (guard: masih Pending). */
export async function resendEsignOtp(
  db: TenantDb,
  id: string,
  requestedById?: string | null,
): Promise<EsignSerializer> {
  const row = await db.esignRequest.findUnique({ where: { id } });
  if (!row) throw new Error("Permintaan e-sign tidak ditemukan");
  if (row.status !== "Pending") throw new Error(`Permintaan e-sign berstatus ${row.status} — hanya Pending yang bisa dikirim ulang OTP`);

  const tc = tenantCryptoForDb(db);
  const email = tc.decryptText(row.signerEmailEnc);
  if (!email) throw new Error("Email kandidat tidak terbaca — OTP tidak dapat dikirim");
  const offer = row.offerId
    ? await db.candidateOffer.findUnique({ where: { id: row.offerId }, select: { offerNo: true } })
    : null;

  const otp = generateChallengeCode();
  await db.esignRequest.update({
    where: { id: row.id },
    data: { otpHash: hashPassword(otp), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  void notifyEmailEvent(db, {
    event: "recruitment.esign.otp",
    to: [{ email, name: row.signerName }],
    data: {
      nama: row.signerName,
      otp,
      otpSecret: otp, // redaksi salinan log (K-4)
      link: `${portalBase()}/sign/${row.token}`,
      offerNo: offer?.offerNo ?? "-",
      token: row.token,
    },
  });
  await db.activityLog.create({
    data: {
      actorType: "user",
      employeeId: requestedById ?? null,
      action: "EsignRequested",
      entity: "EsignRequest",
      entityId: row.id.slice(-8),
      detail: `OTP e-sign ${row.purpose} dikirim ulang ke kandidat ${row.signerName}`,
    },
  }).catch(() => {});
  return { id: row.id, token: row.token, status: row.status, purpose: row.purpose, expiresAt: row.expiresAt.toISOString() };
}

/** Batalkan permintaan (hanya Pending). */
export async function cancelEsignRequest(db: TenantDb, id: string): Promise<EsignSerializer> {
  const row = await db.esignRequest.findUnique({ where: { id } });
  if (!row) throw new Error("Permintaan e-sign tidak ditemukan");
  if (row.status !== "Pending") throw new Error(`Permintaan e-sign berstatus ${row.status} — tidak bisa dibatalkan`);
  await db.esignRequest.update({ where: { id: row.id }, data: { status: "Cancelled" } });
  await db.activityLog.create({
    data: {
      action: "Cancelled", entity: "EsignRequest", entityId: row.id.slice(-8),
      detail: `Permintaan e-sign ${row.purpose} kandidat ${row.signerName} dibatalkan (token ${row.token.slice(0, 8)}…)`,
    },
  }).catch(() => {});
  return { id: row.id, token: row.token, status: "Cancelled", purpose: row.purpose, expiresAt: row.expiresAt.toISOString() };
}

/** Daftar permintaan (admin) — TANPA token/email (kredensial ttd). */
export async function listEsignRequests(db: TenantDb, limit = 20): Promise<EsignRequestRow[]> {
  const rows = await db.esignRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include: { offer: { select: { offerNo: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    offerNo: r.offer?.offerNo ?? null,
    signerName: r.signerName,
    status: r.status,
    purpose: r.purpose,
    signedAt: r.signedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

// ============ sisi publik (portal kandidat) ============

/** Info publik utk halaman /sign/<token> — TANPA email/PII lain (nama tetap
 *  tampil karena kandidat wajib mengetiknya persis). */
export async function getPublicEsignInfo(db: TenantDb, token: string): Promise<PublicEsignInfo | null> {
  const row = await db.esignRequest.findUnique({
    where: { token },
    include: { letter: { select: { letterNo: true, kind: true } }, offer: { select: { offerNo: true } } },
  });
  if (!row) return null;
  const company = await db.company.findFirst({ select: { name: true } }).catch(() => null);
  return {
    status: row.status,
    purpose: row.purpose,
    signerName: row.signerName,
    letterNo: row.letter?.letterNo ?? null,
    letterKind: row.letter?.kind ?? null,
    offerNo: row.offer?.offerNo ?? null,
    companyName: company?.name ?? null,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export interface SubmitEsignResult {
  status: string;
  signedAt: string;
  pdfSha256: string;
}

/**
 * Tanda tangani dari portal: guard token ada + Pending + belum kedaluwarsa
 * (lewat → status Expired), OTP benar (scrypt verify + TTL 5 mnt), nama
 * diketik persis (case/space-insensitive) → pdfSha256 baseline + status
 * Signed + notif in-app ke HR peminta.
 */
export async function submitPublicEsign(
  db: TenantDb,
  input: { token: string; otp: string; typedName: string; ip?: string | null },
): Promise<SubmitEsignResult> {
  const row = await db.esignRequest.findUnique({
    where: { token: input.token },
    include: { letter: { select: { id: true, letterNo: true } }, offer: { select: { id: true, offerNo: true } } },
  });
  if (!row) throw new Error("Tautan tanda tangan tidak valid atau kedaluwarsa");
  if (row.status !== "Pending") throw new Error(`Permintaan tanda tangan sudah diproses (${row.status})`);
  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.esignRequest.update({ where: { id: row.id }, data: { status: "Expired" } }).catch(() => {});
    throw new Error("Tautan tanda tangan telah kedaluwarsa — minta HR mengirim permintaan baru");
  }

  // OTP: scrypt hash + TTL (pola challenge Task 80 — satu pakai implisit:
  // request berpindah status Signed setelah sukses)
  const otpOk = /^\d{6}$/.test(String(input.otp ?? "")) && verifyPassword(String(input.otp), row.otpHash)
    && row.otpExpiresAt.getTime() > now.getTime();
  if (!otpOk) throw new Error("Kode OTP salah atau kedaluwarsa");

  const typed = String(input.typedName ?? "").trim().toLowerCase();
  if (!typed || typed !== row.signerName.trim().toLowerCase()) {
    throw new Error("Nama yang diketik tidak sesuai dengan nama kandidat pada surat");
  }

  // baseline tamper-evident: hash byte PDF surat (mesin surat rekrutmen)
  if (!row.letter) throw new Error("Surat tidak tersedia — hubungi HR");
  const pdf = await letterPdf(db, row.letter.id);
  if (!pdf) throw new Error("Surat tidak dapat dibuat — hubungi HR");
  const pdfSha256 = createHash("sha256").update(Buffer.from(pdf)).digest("hex");

  const signedAt = new Date();
  await db.esignRequest.update({
    where: { id: row.id },
    data: { status: "Signed", signedAt, typedName: String(input.typedName ?? "").trim(), pdfSha256 },
  });

  await db.activityLog.create({
    data: {
      action: "EsignSigned",
      entity: "EsignRequest",
      entityId: row.offer?.offerNo ?? row.id.slice(-8),
      detail: `Surat ${row.letter.letterNo} (${row.purpose}) DITANDATANGANI kandidat ${row.signerName} — sha256 ${pdfSha256.slice(0, 16)}…${input.ip ? `, ip ${input.ip}` : ""}`,
    },
  }).catch(() => {});

  // notif in-app HR peminta
  if (row.offer) {
    void notifyEvent(db, {
      to: "employee", employeeId: row.requestedById, docType: "RecruitmentOffer", docNo: row.offer.offerNo,
      title: `Surat ${row.purpose === "appointment" ? "pengangkatan" : "penawaran"} ditandatangani — ${row.signerName}`,
      body: `Kandidat telah menandatangani surat ${row.letter.letterNo} (offer ${row.offer.offerNo}) secara elektronik.`,
      kind: "recruitment", link: "recruitment:offers",
    }).catch(() => undefined);
  }

  return { status: "Signed", signedAt: signedAt.toISOString(), pdfSha256 };
}

// ============ verifikasi integritas (endpoint info) ============

export interface EsignHashVerify {
  match: boolean;
  signedHash: string | null;
  currentHash: string | null;
}

/** Bandingkan pdfSha256 saat ttd vs hash PDF surat SAAT INI (deteksi tamper). */
export async function verifyEsignHash(db: TenantDb, token: string): Promise<EsignHashVerify> {
  const row = await db.esignRequest.findUnique({
    where: { token },
    include: { letter: { select: { id: true } } },
  });
  if (!row || !row.pdfSha256) return { match: false, signedHash: row?.pdfSha256 ?? null, currentHash: null };
  if (!row.letter) return { match: false, signedHash: row.pdfSha256, currentHash: null };
  const pdf = await letterPdf(db, row.letter.id);
  if (!pdf) return { match: false, signedHash: row.pdfSha256, currentHash: null };
  const currentHash = createHash("sha256").update(Buffer.from(pdf)).digest("hex");
  return { match: currentHash === row.pdfSha256, signedHash: row.pdfSha256, currentHash };
}
