// ============================================================================
// RECRUITMENT F9 — Compliance Hardening UU PDP
// (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F9 + oranHR §2.5 ApplicantEngine
// + HRX I1–I7): Data Subject Request (DSR akses/ekspor/hapus + SLA),
// consent withdrawal, retensi & anonimisasi otomatis, audit akses PII,
// utilitas pseudonimisasi utk analytics/latih AI.
//
// PRINSIP UU PDP (UU 27/2022):
// • PII pelamar TERENKRIPSI field-level (tenantCryptoForDb) — decrypt
//   HANYA di serializer/package (in-memory), tidak pernah disimpan balik.
// • ANONIMISASI = irreversibel by design: PII di-null + dokumen/CV/parse
//   dihapus (file fisik ikut); LAMARAN (ApplicantApplication) & CONSENT
//   LEDGER (ApplicantConsent) DIPERTAHANKAN sebagai catatan bisnis +
//   bukti kepatuhan (UU PDP Pasal 9 ayat 3 — kewajiban hukum).
// • dedupHash (SHA-256 email|birthDate) dicatat SEBELUM PII di-null —
//   satu-arah; dipakai untuk mendeteksi pelamar yang mendaftar ulang
//   pasca-penghapusan (fair screening tanpa menyimpan PII).
// • PELAMAR EMPLOYED TIDAK DAPAT dianonimkan (data kepegawaian aktif).
// ============================================================================
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { deleteAttachmentsByEntity } from "@/rekankerja/shared/services/attachment-service";
import { getRecruitmentSetting } from "@/rekankerja/recruitment/services/recruitment-setting-service";
import { fullNameOf } from "@/rekankerja/recruitment/services/applicant-service";

// ============ tipe & error ============

export type DsrType = "Access" | "Export" | "Erase";

export interface DsrInput {
  applicantId: string;
  type: DsrType;
  note?: string | null;
}

/** Error kepatuhan dengan kode HTTP (dipetakan API → 400/404/409). */
export class ComplianceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DSR_TYPES: readonly DsrType[] = ["Access", "Export", "Erase"];
/** SLA penanganan DSR (UU PDP — praktik industri 7 hari). */
export const DSR_SLA_DAYS = 7;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ============ DSR (Data Subject Request) — HRX I2 ============

/** Buat permintaan subjek data (hak akses/ekspor/hapus UU PDP Pasal 7–9). */
export async function createDsr(
  db: TenantDb, input: DsrInput, actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<{ id: string }> {
  if (!(DSR_TYPES as readonly string[]).includes(input.type)) {
    throw new ComplianceError(400, `Tipe DSR tidak dikenal: ${input.type} (harus Access|Export|Erase)`);
  }
  const a = await db.applicant.findUnique({
    where: { id: input.applicantId },
    select: { id: true, applicantNo: true, status: true },
  });
  if (!a) throw new ComplianceError(404, "Pelamar tidak ditemukan");
  if (a.status === "Anonymized") {
    throw new ComplianceError(409, `Data pelamar ${a.applicantNo} sudah dianonimkan — tidak ada data pribadi yang tersimpan`);
  }
  const active = await db.dataSubjectRequest.findFirst({
    where: { applicantId: a.id, status: { in: ["New", "InProgress"] } },
    select: { id: true, type: true },
  });
  if (active) {
    throw new ComplianceError(409, `Pelamar ${a.applicantNo} masih punya DSR aktif (${active.type}) — selesaikan dulu`);
  }
  const dueAt = new Date(Date.now() + DSR_SLA_DAYS * 86_400_000);
  const row = await db.dataSubjectRequest.create({
    data: {
      applicantId: a.id,
      type: input.type,
      status: "New",
      note: input.note?.trim() || null,
      dueAt,
    },
  });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "DsrCreated", entity: "DataSubjectRequest", entityId: a.applicantNo,
      detail: `DSR ${input.type} pelamar ${a.applicantNo} dicatat (SLA ${dueAt.toISOString().slice(0, 10)})${actor?.name ? ` oleh ${actor.name}` : ""}${input.note?.trim() ? ` — catatan: ${input.note.trim()}` : ""}`,
    },
  }).catch(() => {});
  return { id: row.id };
}

export interface DsrRow {
  id: string;
  type: string;
  status: string;
  note: string | null;
  dueAt: string;
  createdAt: string;
  handledAt: string | null;
  resultNote: string | null;
  applicantId: string;
  applicantNo: string;
  applicantName: string; // "Anonim" bila sudah dianonimkan
  handlerName: string | null;
  overdue: boolean;
}

const DSR_STATUS_RANK: Record<string, number> = { New: 0, InProgress: 1, Completed: 2, Rejected: 3 };

/** Daftar DSR — status New dulu, lalu dueAt asc (inbox kepatuhan). */
export async function listDsr(db: TenantDb): Promise<DsrRow[]> {
  const rows = await db.dataSubjectRequest.findMany({
    include: {
      applicant: { select: { applicantNo: true, firstName: true, middleName: true, lastName: true, displayName: true, status: true } },
      handledBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      note: r.note,
      dueAt: r.dueAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      handledAt: iso(r.handledAt),
      resultNote: r.resultNote,
      applicantId: r.applicantId,
      applicantNo: r.applicant.applicantNo,
      applicantName: r.applicant.status === "Anonymized"
        ? `Anonim ${r.applicant.applicantNo}`
        : fullNameOf(r.applicant),
      handlerName: r.handledBy?.fullName ?? null,
      overdue: (r.status === "New" || r.status === "InProgress") && r.dueAt.getTime() < Date.now(),
    }))
    .sort((a, b) =>
      (DSR_STATUS_RANK[a.status] ?? 9) - (DSR_STATUS_RANK[b.status] ?? 9) ||
      a.dueAt.localeCompare(b.dueAt),
    );
}

/** Ambil DSR + konteks pelamar (guard umum aksi status). */
async function dsrWithApplicant(db: TenantDb, id: string) {
  const dsr = await db.dataSubjectRequest.findUnique({
    where: { id },
    include: { applicant: { select: { id: true, applicantNo: true, status: true } } },
  });
  if (!dsr) throw new ComplianceError(404, "Permintaan data (DSR) tidak ditemukan");
  return dsr;
}

/** Naikkan status New → InProgress (mulai ditangani). */
export async function updateDsrStatus(
  db: TenantDb, input: { id: string }, actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<void> {
  const dsr = await dsrWithApplicant(db, input.id);
  if (dsr.status !== "New") {
    throw new ComplianceError(409, `DSR ${dsr.type} ${dsr.applicant.applicantNo} berstatus ${dsr.status} — hanya New yang bisa dijalankan`);
  }
  await db.dataSubjectRequest.update({ where: { id: dsr.id }, data: { status: "InProgress" } });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "DsrUpdated", entity: "DataSubjectRequest", entityId: dsr.applicant.applicantNo,
      detail: `DSR ${dsr.type} mulai ditangani${actor?.name ? ` oleh ${actor.name}` : ""}`,
    },
  }).catch(() => {});
}

/** Ringkasan isi data pelamar (utk resultNote DSR Access). */
async function accessSummary(db: TenantDb, applicantId: string, applicantNo: string): Promise<string> {
  const [edu, exp, skl, app, con, cand, doc] = await Promise.all([
    db.applicantEducation.count({ where: { applicantId } }),
    db.applicantExperience.count({ where: { applicantId } }),
    db.applicantSkill.count({ where: { applicantId } }),
    db.applicantApplication.count({ where: { applicantId } }),
    db.applicantConsent.count({ where: { applicantId } }),
    db.jobCandidate.count({ where: { applicantId } }),
    db.applicantDocument.count({ where: { applicantId } }),
  ]);
  return `Akses data diberikan (paket lengkap via modul Kepatuhan): profil identitas + ${edu} pendidikan, ${exp} pengalaman, ${skl} keahlian, ${doc} dokumen, ${app} lamaran, ${cand} kandidat seleksi, ${con} baris consent pelamar ${applicantNo}.`;
}

/** Selesaikan DSR per type (Access/Export → catat; Erase → anonimisasi). */
export async function completeDsr(
  db: TenantDb, input: { id: string; handledById?: string | null }, actorName?: string | null,
): Promise<{ id: string; type: string; resultNote: string }> {
  const dsr = await dsrWithApplicant(db, input.id);
  if (dsr.status !== "New" && dsr.status !== "InProgress") {
    throw new ComplianceError(409, `DSR ${dsr.type} ${dsr.applicant.applicantNo} sudah berstatus ${dsr.status}`);
  }
  let resultNote: string;
  if (dsr.type === "Access") {
    resultNote = await accessSummary(db, dsr.applicantId, dsr.applicant.applicantNo);
  } else if (dsr.type === "Export") {
    resultNote = "Paket data (JSON, hak ekspor UU PDP) tersedia diunduh via tombol Paket Data — unduhan ter-audit di log akses PII.";
  } else {
    // Erase → anonimisasi data pelamar (guard Employed di dalam)
    await anonymizeApplicant(db, { applicantId: dsr.applicantId, reason: "DSR Erase" });
    resultNote = "Data dianonimkan";
  }
  await db.dataSubjectRequest.update({
    where: { id: dsr.id },
    data: { status: "Completed", handledById: input.handledById ?? null, handledAt: new Date(), resultNote },
  });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: input.handledById ?? null,
      action: "DsrCompleted", entity: "DataSubjectRequest", entityId: dsr.applicant.applicantNo,
      detail: `DSR ${dsr.type} pelamar ${dsr.applicant.applicantNo} DISELESAIKAN${actorName ? ` oleh ${actorName}` : ""} — ${resultNote}`,
    },
  }).catch(() => {});
  return { id: dsr.id, type: dsr.type, resultNote };
}

/** Tolak DSR — alasan (resultNote) WAJIB. */
export async function rejectDsr(
  db: TenantDb, input: { id: string; handledById?: string | null; resultNote?: string | null }, actorName?: string | null,
): Promise<void> {
  const reason = input.resultNote?.trim();
  if (!reason) throw new ComplianceError(400, "Alasan penolakan DSR wajib diisi");
  const dsr = await dsrWithApplicant(db, input.id);
  if (dsr.status !== "New" && dsr.status !== "InProgress") {
    throw new ComplianceError(409, `DSR ${dsr.type} ${dsr.applicant.applicantNo} sudah berstatus ${dsr.status}`);
  }
  await db.dataSubjectRequest.update({
    where: { id: dsr.id },
    data: { status: "Rejected", handledById: input.handledById ?? null, handledAt: new Date(), resultNote: reason },
  });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: input.handledById ?? null,
      action: "DsrRejected", entity: "DataSubjectRequest", entityId: dsr.applicant.applicantNo,
      detail: `DSR ${dsr.type} pelamar ${dsr.applicant.applicantNo} DITOLAK${actorName ? ` oleh ${actorName}` : ""} — alasan: ${reason}`,
    },
  }).catch(() => {});
}

// ============ paket data DSR (hak akses/ekspor — data lineage penuh) ============

/**
 * Paket data lengkap pelamar (diunduh sbg JSON — UU PDP Pasal 7 hak akses).
 * PII didekrip IN-MEMORY hanya di titik ini; dokumen hanya metadata
 * (nama + ukuran) — isi file TIDAK dibundel.
 */
export async function getDsrPackage(db: TenantDb, dsrId: string): Promise<Record<string, unknown>> {
  const dsr = await dsrWithApplicant(db, dsrId);
  if (dsr.type !== "Export" && dsr.type !== "Access") {
    throw new ComplianceError(400, `Paket data hanya untuk DSR Export/Access (ini ${dsr.type})`);
  }
  const tc = tenantCryptoForDb(db);
  const a = await db.applicant.findUnique({
    where: { id: dsr.applicantId },
    include: {
      referralEmployee: { select: { fullName: true } },
      adMediaType: { select: { name: true } },
      agency: { select: { name: true } },
      educations: { orderBy: { graduationYear: "asc" } },
      experiences: { orderBy: { startYear: "asc" } },
      skills: { include: { skill: { select: { name: true } } } },
      documents: {
        include: {
          requiredDocument: { select: { title: true } },
          attachment: { select: { fileName: true, sizeBytes: true, mimeType: true } },
        },
      },
      applications: {
        include: {
          jobOpening: { include: { jobOpportunity: { select: { refNo: true, status: true } } } },
          answers: { include: { question: { select: { question: true } } } },
        },
        orderBy: { dateApplied: "asc" },
      },
      consents: { orderBy: { grantedAt: "asc" } },
    },
  });
  if (!a) throw new ComplianceError(404, "Pelamar tidak ditemukan");

  const candidates = await db.jobCandidate.findMany({
    where: { applicantId: a.id },
    include: {
      pr: { select: { prNo: true, position: { select: { title: true } } } },
      selectionSteps: { include: { selectionProcess: { select: { name: true } } }, orderBy: { seqNo: "asc" } },
      offers: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { nominatedAt: "desc" },
  });
  const esigns = await db.esignRequest.findMany({
    where: { offer: { candidate: { applicantId: a.id } } },
    select: { offerNo: true, purpose: true, status: true, signedAt: true, expiresAt: true, letterNo: true },
    orderBy: { createdAt: "desc" },
  }).catch(() => [] as { offerNo: string | null; purpose: string; status: string; signedAt: Date | null; expiresAt: Date; letterNo: string | null }[]);
  const logs = await db.activityLog.findMany({
    where: { entityId: a.applicantNo },
    orderBy: { createdAt: "desc" },
    take: 20,
  }).catch(() => []);

  return {
    generatedAt: new Date().toISOString(),
    notice: "Paket data subjek (UU PDP Pasal 7 — hak akses). Dibuat oleh sistem RekanKerja HRIS; unduhan ter-audit.",
    dsr: {
      id: dsr.id, type: dsr.type, status: dsr.status, note: dsr.note,
      dueAt: iso(dsr.dueAt), createdAt: iso(dsr.createdAt), handledAt: iso(dsr.handledAt), resultNote: dsr.resultNote,
    },
    applicant: {
      applicantNo: a.applicantNo,
      nama: fullNameOf(a),
      firstName: a.firstName, middleName: a.middleName, lastName: a.lastName, displayName: a.displayName,
      status: a.status, blacklist: a.blacklist, suspend: a.suspend,
      dateApplied: iso(a.dateApplied), dateAvailable: iso(a.dateAvailable),
      // PII — decrypt in-memory khusus paket ini
      email: tc.decryptText(a.email),
      phone: tc.decryptText(a.phone),
      address: tc.decryptText(a.address),
      city: tc.decryptText(a.city),
      placeOfBirth: tc.decryptText(a.placeOfBirth),
      identityNo: tc.decryptText(a.identityNo),
      birthDate: iso(a.birthDate), gender: a.gender, maritalStatus: a.maritalStatus,
      expectedSalary: tc.decryptMoney(a.expectedSalary),
      currency: a.currency, salaryUnit: a.salaryUnit,
      source: a.source, referralName: a.referralEmployee?.fullName ?? null,
      adMediaName: a.adMediaType?.name ?? null, agencyName: a.agency?.name ?? null,
      institutionName: a.institutionName,
      highestEduLevel: a.highestEduLevel, highestGpa: a.highestGpa, totalExpMonths: a.totalExpMonths,
      notes: a.notes,
      keepOnFileMonths: a.keepOnFileMonths, keepOnFileUntil: iso(a.keepOnFileUntil),
    },
    pendidikan: a.educations.map((e) => ({ level: e.level, fieldOfStudy: e.fieldOfStudy, institution: e.institution, graduationYear: e.graduationYear, gpa: e.gpa })),
    pengalaman: a.experiences.map((e) => ({ company: e.company, position: e.position, field: e.field, startYear: e.startYear, endYear: e.endYear, months: e.months })),
    keahlian: a.skills.map((s) => ({ skill: s.skill.name, level: s.level })),
    lamaran: a.applications.map((ap) => ({
      slot: ap.jobOpening?.titleToShow ?? null,
      joRefNo: ap.jobOpening?.jobOpportunity.refNo ?? null,
      joStatus: ap.jobOpening?.jobOpportunity.status ?? null,
      dateApplied: iso(ap.dateApplied), status: ap.status, sourceNote: ap.sourceNote,
      knockoutAnswers: ap.answers.map((ans) => ({ pertanyaan: ans.question.question, jawaban: ans.answer })),
    })),
    consentLedger: a.consents.map((c) => ({
      purpose: c.purpose, version: c.version, grantedAt: iso(c.grantedAt), withdrawnAt: iso(c.withdrawnAt), channel: c.channel, note: c.note,
    })),
    kandidat: candidates.map((c) => ({
      prNo: c.pr.prNo, posisi: c.pr.position?.title ?? null, status: c.status, nominatedAt: iso(c.nominatedAt),
      tahapan: c.selectionSteps.map((s) => ({
        tahap: s.selectionProcess.name, seqNo: s.seqNo, status: s.status,
        planDate: iso(s.planDate), dueDate: iso(s.dueDate), performedAt: iso(s.performedAt),
        score: s.score, result: s.result, comment: s.comment,
      })),
      offers: c.offers.map((o) => ({
        offerNo: o.offerNo, status: o.status, startDate: iso(o.startDate), expiryDate: iso(o.expiryDate),
        salary: tc.decryptMoney(o.salary), letterNo: o.letterNo, sentAt: iso(o.sentAt), respondedAt: iso(o.respondedAt),
      })),
    })),
    esign: esigns.map((e) => ({
      offerNo: e.offerNo, purpose: e.purpose, status: e.status,
      signedAt: iso(e.signedAt), expiresAt: iso(e.expiresAt), letterNo: e.letterNo,
    })),
    dokumen: a.documents.map((d) => ({
      judul: d.title, dokumenWajib: d.requiredDocument?.title ?? null, terverifikasi: d.verified,
      fileName: d.attachment?.fileName ?? null, ukuranBytes: d.attachment?.sizeBytes ?? null, mimeType: d.attachment?.mimeType ?? null,
      // isi file TIDAK dibundel — akses file via modul Dokumen (ter-audit)
    })),
    activityLog: logs.map((l) => ({
      waktu: iso(l.createdAt), aksi: l.action, entitas: l.entity, detail: l.detail,
    })),
  };
}

// ============ consent withdrawal (HRX I1) ============

/** Tarik consent (withdrawal) — efek: keluar dari saran talent pool. */
export async function withdrawConsent(
  db: TenantDb,
  input: { applicantId: string; consentId: string; note?: string | null },
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<{ id: string; purpose: string }> {
  const consent = await db.applicantConsent.findUnique({ where: { id: input.consentId } });
  if (!consent || consent.applicantId !== input.applicantId) {
    throw new ComplianceError(404, "Consent tidak ditemukan untuk pelamar ini");
  }
  if (consent.withdrawnAt) {
    throw new ComplianceError(409, `Consent purpose "${consent.purpose}" sudah ditarik sebelumnya`);
  }
  const note = input.note?.trim() || null;
  await db.applicantConsent.update({
    where: { id: consent.id },
    data: {
      withdrawnAt: new Date(),
      note: note ? `Ditarik: ${note}` : "Ditarik oleh pemilik data",
    },
  });
  const a = await db.applicant.findUnique({ where: { id: input.applicantId }, select: { applicantNo: true } });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "ConsentWithdrawn", entity: "ApplicantConsent", entityId: a?.applicantNo ?? input.applicantId,
      detail: `Consent purpose "${consent.purpose}" (v${consent.version}) pelamar ${a?.applicantNo ?? input.applicantId} DITARIK${actor?.name ? ` oleh ${actor.name}` : ""}${note ? ` — catatan: ${note}` : ""} — pelamar dikeluarkan dari saran talent pool`,
    },
  }).catch(() => {});
  return { id: consent.id, purpose: consent.purpose };
}

export interface ConsentLedgerRow {
  id: string;
  applicantId: string | null;
  applicantNo: string | null;
  applicantName: string | null;
  purpose: string;
  version: string;
  grantedAt: string;
  withdrawnAt: string | null;
  channel: string;
  note: string | null;
}

/** Ledger consent semua pelamar (join applicantNo + nama). */
export async function listConsentLedger(db: TenantDb, limit = 300): Promise<ConsentLedgerRow[]> {
  const rows = await db.applicantConsent.findMany({
    where: { applicantId: { not: null } },
    include: { applicant: { select: { applicantNo: true, firstName: true, middleName: true, lastName: true, displayName: true, status: true } } },
    orderBy: { grantedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    applicantId: r.applicantId,
    applicantNo: r.applicant?.applicantNo ?? null,
    applicantName: r.applicant
      ? (r.applicant.status === "Anonymized" ? `Anonim ${r.applicant.applicantNo}` : fullNameOf(r.applicant))
      : null,
    purpose: r.purpose,
    version: r.version,
    grantedAt: r.grantedAt.toISOString(),
    withdrawnAt: iso(r.withdrawnAt),
    channel: r.channel,
    note: r.note,
  }));
}

// ============ retensi & anonimisasi (HRX I3/I7) ============

/**
 * Anonimisasi pelamar (irreversibel by design):
 * 1. SEBELUM PII di-null: dedupHash = sha256(email|birthDate) dicatat di
 *    ActivityLog "ApplicantAnonymized" (audit + dedup re-lamar masa depan).
 * 2. PII di-null (kolom terenkripsi + birthDate + expectedSalary), nama →
 *    "Anonim <applicantNo>", status → "Anonymized", note di-prepend jejak.
 * 3. DIHAPUS: dokumen (+ file fisik), hasil parse CV, pendidikan, pengalaman,
 *    keahlian; snapshot nama kandidat dinonaktifkan ("Anonim (APP-…)").
 * 4. DIPERTAHANKAN: lamaran (ApplicantApplication — catatan bisnis/rekonsiliasi)
 *    + consent ledger (bukti kepatuhan; PII-nya sudah null).
 * GUARD: status Employed → tolak (karyawan aktif — urus via siklus HRIS).
 */
export async function anonymizeApplicant(
  db: TenantDb, input: { applicantId: string; reason: string },
): Promise<{ applicantNo: string; dedupHash: string }> {
  const reason = input.reason?.trim() || "unspecified";
  const a = await db.applicant.findUnique({
    where: { id: input.applicantId },
    select: {
      id: true, applicantNo: true, status: true, notes: true,
      email: true, birthDate: true,
    },
  });
  if (!a) throw new ComplianceError(404, "Pelamar tidak ditemukan");
  if (a.status === "Employed") {
    throw new ComplianceError(409, `Pelamar ${a.applicantNo} sudah bekerja (karyawan aktif) — data dikelola modul HRIS, tidak dapat dianonimkan`);
  }
  if (a.status === "Anonymized") {
    throw new ComplianceError(409, `Pelamar ${a.applicantNo} sudah dianonimkan sebelumnya`);
  }

  // 1. dedup hash SEBELUM PII di-null (email didekrip in-memory sekali ini)
  const tc = tenantCryptoForDb(db);
  const emailPlain = tc.decryptText(a.email) ?? "";
  const birth = a.birthDate ? a.birthDate.toISOString().slice(0, 10) : "";
  const dedupHash = sha256Hex(`${emailPlain}|${birth}`);
  const now = new Date();
  await db.activityLog.create({
    data: {
      actorType: "user",
      action: "ApplicantAnonymized", entity: "Applicant", entityId: a.applicantNo,
      detail: JSON.stringify({
        reason,
        dedupHash,
        catatan: "sha256(email|birthDate) satu-arah — PII sudah di-null; dipakai utk dedup re-lamar",
      }),
    },
  }).catch(() => {});

  // 2. null-kan PII + tandai status
  await db.applicant.update({
    where: { id: a.id },
    data: {
      firstName: "Anonim",
      lastName: a.applicantNo,
      middleName: null,
      displayName: null,
      email: null, phone: null, address: null, city: null, placeOfBirth: null, identityNo: null,
      birthDate: null,
      expectedSalary: null,
      status: "Anonymized",
      notes: `[anonymized ${now.toISOString()}: ${reason}]${a.notes ? ` ${a.notes}` : ""}`,
    },
  });

  // 3a. dokumen + file fisik
  const docs = await db.applicantDocument.findMany({ where: { applicantId: a.id }, select: { id: true } });
  for (const d of docs) {
    await deleteAttachmentsByEntity(db, "ApplicantDocument", d.id).catch(() => {});
  }
  if (docs.length > 0) {
    await db.applicantDocument.deleteMany({ where: { applicantId: a.id } }).catch(() => {});
  }
  // 3b. hasil parse CV (berisi PII hasil ekstraksi)
  await db.cvParseResult.deleteMany({ where: { applicantId: a.id } }).catch(() => {});
  // 3c. pendidikan / pengalaman / keahlian (data pribadi)
  await db.applicantEducation.deleteMany({ where: { applicantId: a.id } }).catch(() => {});
  await db.applicantExperience.deleteMany({ where: { applicantId: a.id } }).catch(() => {});
  await db.applicantSkill.deleteMany({ where: { applicantId: a.id } }).catch(() => {});
  // 3d. snapshot nama kandidat (board seleksi) → topeng
  await db.jobCandidate.updateMany({
    where: { applicantId: a.id },
    data: { fullName: `Anonim (${a.applicantNo})` },
  }).catch(() => {});
  // 4. ApplicantApplication + ApplicantConsent DIPERTAHANKAN (by design)

  await db.activityLog.create({
    data: {
      action: "Updated", entity: "Applicant", entityId: a.applicantNo,
      detail: `Pelamar ${a.applicantNo} dianonimkan (alasan: ${reason}) — PII di-null, ${docs.length} dokumen + file fisik dihapus, pendidikan/pengalaman/keahlian/parse CV dihapus; lamaran & consent ledger dipertahankan sbg catatan bisnis`,
    },
  }).catch(() => {});
  return { applicantNo: a.applicantNo, dedupHash };
}

export interface RetentionResult {
  scanned: number; // pelamar melewati jendela retensi (due)
  anonymized: number; // dianonimkan (atau akan-dianonimkan saat dry-run)
  skippedConsent: number; // ditahan karena consent talent-pool aktif
  dryRun: boolean;
}

/** Umur status (bulan) pelamar — 30 hari = 1 bulan (aproksimasi retensi). */
function statusAgeMonths(updatedAt: Date): number {
  return Math.floor((Date.now() - updatedAt.getTime()) / (30 * 86_400_000));
}

/**
 * Jalankan siklus retensi (job harian / aksi manual):
 * pelamar Rejected|Outdated dgn umur status > retention.months.<status> →
 * periksa consent "talent-pool" AKTIF (ada & belum ditarik → TAHAN data) →
 * anonimisasi. retention.anonymize=false → DRY-RUN (hitung saja, tanpa ubah).
 * Ringkasan ditulis 1× ActivityLog "RetentionRun" per hari (pola claimReminder).
 */
export async function runRetention(db: TenantDb): Promise<RetentionResult> {
  const [rejMonthsRaw, outMonthsRaw, anonymizeOn] = await Promise.all([
    getRecruitmentSetting(db, "retention.months.rejected", "24"),
    getRecruitmentSetting(db, "retention.months.outdated", "24"),
    getRecruitmentSetting(db, "retention.anonymize", "true"),
  ]);
  const rejMonths = Number(rejMonthsRaw) || 24;
  const outMonths = Number(outMonthsRaw) || 24;
  const dryRun = anonymizeOn === "false";

  const result: RetentionResult = { scanned: 0, anonymized: 0, skippedConsent: 0, dryRun };
  const rows = await db.applicant.findMany({
    where: { status: { in: ["Rejected", "Outdated"] } },
    select: { id: true, applicantNo: true, status: true, updatedAt: true },
    take: 1000,
  });
  for (const a of rows) {
    const months = a.status === "Rejected" ? rejMonths : outMonths;
    if (statusAgeMonths(a.updatedAt) <= months) continue; // masih dalam jendela
    result.scanned++;
    const consent = await db.applicantConsent.findFirst({
      where: { applicantId: a.id, purpose: "talent-pool", withdrawnAt: null },
      select: { id: true },
    });
    if (consent) {
      result.skippedConsent++;
      continue;
    }
    if (dryRun) {
      result.anonymized++; // hitung saja (dry-run — retention.anonymize=false)
      continue;
    }
    try {
      await anonymizeApplicant(db, { applicantId: a.id, reason: "retention" });
      result.anonymized++;
    } catch {
      // Employed-guard / race — lewati, siklus berikutnya mengulang
    }
  }

  // ringkasan 1× per hari (dedupe — pola claimReminder; jalur lama
  // WHERE-NOT-EXIST karena action bukan 'Reminder')
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  try {
    const existing = await db.activityLog.findFirst({
      where: { action: "RetentionRun", createdAt: { gte: dayStart } },
      select: { id: true },
    });
    if (!existing) {
      await db.activityLog.create({
        data: {
          actorType: "system",
          action: "RetentionRun", entity: "Retention", entityId: dayStart.toISOString().slice(0, 10),
          detail: `Retensi UU PDP: ${result.scanned} pelamar melewati jendela (Rejected ${rejMonths} bln / Outdated ${outMonths} bln), ${result.anonymized} ${dryRun ? "akan dianonimkan (DRY-RUN — retention.anonymize=false)" : "dianonimkan"}, ${result.skippedConsent} ditahan (consent talent-pool aktif)`,
        },
      });
    }
  } catch {
    // log ringkasan gagal — siklus tetap sah
  }
  return result;
}

export interface RetentionOverview {
  settings: { "retention.months.rejected": string; "retention.months.outdated": string; "retention.anonymize": string };
  lastRun: { at: string; detail: string } | null;
  stats: { rejected: number; outdated: number; anonymized: number; dueForRetention: number; heldByConsent: number };
}

/** Ringkasan utk section retention (settings + run terakhir + stats). */
export async function retentionOverview(db: TenantDb): Promise<RetentionOverview> {
  const [rejMonths, outMonths, anonymize] = await Promise.all([
    getRecruitmentSetting(db, "retention.months.rejected", "24"),
    getRecruitmentSetting(db, "retention.months.outdated", "24"),
    getRecruitmentSetting(db, "retention.anonymize", "true"),
  ]);
  const last = await db.activityLog.findFirst({
    where: { action: "RetentionRun" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, detail: true },
  }).catch(() => null);

  const group = await db.applicant.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => [] as { status: string; _count: { _all: number } }[]);
  const cnt = (s: string) => group.find((g) => g.status === s)?._count._all ?? 0;

  const rows = await db.applicant.findMany({
    where: { status: { in: ["Rejected", "Outdated"] } },
    select: { id: true, status: true, updatedAt: true },
    take: 1000,
  }).catch(() => [] as { id: string; status: string; updatedAt: Date }[]);
  let dueForRetention = 0;
  let heldByConsent = 0;
  for (const a of rows) {
    const months = a.status === "Rejected" ? Number(rejMonths) || 24 : Number(outMonths) || 24;
    if (statusAgeMonths(a.updatedAt) <= months) continue;
    dueForRetention++;
    const consent = await db.applicantConsent.findFirst({
      where: { applicantId: a.id, purpose: "talent-pool", withdrawnAt: null },
      select: { id: true },
    }).catch(() => null);
    if (consent) heldByConsent++;
  }
  return {
    settings: {
      "retention.months.rejected": rejMonths,
      "retention.months.outdated": outMonths,
      "retention.anonymize": anonymize,
    },
    lastRun: last ? { at: last.createdAt.toISOString(), detail: last.detail ?? "" } : null,
    stats: {
      rejected: cnt("Rejected"),
      outdated: cnt("Outdated"),
      anonymized: cnt("Anonymized"),
      dueForRetention,
      heldByConsent,
    },
  };
}

// ============ audit akses PII (HRX I4) ============

/** Catat akses PII pelamar (dipanggil fire-and-forget dari titik baca PII). */
export async function logPiiAccess(
  db: TenantDb, input: { employeeId?: string | null; applicantId: string; what: string },
): Promise<void> {
  const a = await db.applicant.findUnique({
    where: { id: input.applicantId },
    select: { applicantNo: true },
  });
  if (!a) return;
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: input.employeeId ?? null,
      action: "PiiAccess", entity: "Applicant", entityId: a.applicantNo,
      detail: input.what,
    },
  }).catch(() => {});
}

export interface PiiAuditRow {
  id: string;
  createdAt: string;
  employeeId: string | null;
  employeeName: string | null;
  applicantNo: string | null;
  what: string | null;
}

/** Log akses PII terbaru (join nama karyawan; pelamar via applicantNo). */
export async function listPiiAudit(db: TenantDb, limit = 100): Promise<PiiAuditRow[]> {
  const rows = await db.activityLog.findMany({
    where: { action: "PiiAccess" },
    include: { employee: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  }).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    employeeId: r.employeeId,
    employeeName: r.employee?.fullName ?? null,
    applicantNo: r.entityId,
    what: r.detail,
  }));
}

// ============ pseudonimisasi utk analytics / latih AI (HRX I7) ============

const PSEUDONYM_KEYS = new Set([
  "email", "phone", "firstName", "middleName", "lastName", "displayName", "fullName",
  "address", "city", "placeOfBirth", "identityNo", "institution", "company",
]);

/** Token deterministik utk satu nilai (nilai sama → token sama; joinable). */
export function pseudonymToken(value: string): string {
  return `SUBJ-${sha256Hex(value).slice(0, 8)}`;
}

/**
 * Salinan profil dgn PII diganti token "SUBJ-<hash8>" — utk analytics &
 * bahan latih AI (data minimisasi; deterministik supaya tetap bisa
 * digroup per subjek). Objek asli TIDAK dimutasi.
 */
export function pseudonymizeForAnalytics(profile: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = typeof val === "string" && val.trim() !== "" && PSEUDONYM_KEYS.has(k)
          ? pseudonymToken(val)
          : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(profile) as Record<string, unknown>;
}
