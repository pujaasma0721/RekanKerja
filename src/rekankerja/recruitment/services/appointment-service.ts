// ============================================================================
// RECRUITMENT F4 — Appointment & integrasi Onboarding (DEVELOPMENT-PLAN-
// RECRUITMENT.md §7 F4 + HRX H1/H2): dialog pengangkatan (penempatan prefill
// dari PR — posisi/office/work location/supervisor/employmentStatus, boleh
// override) + surat pengangkatan REC_APPOINT + surat penolakan BATCH
// (REC_REJECT) ke kandidat lain di PR yang sama saat PR fulfilled +
// verifikasi checklist dokumen pre-employment + tombol "Lanjutkan ke
// Onboarding" → Employee + EmployeeAssignment dibuat via
// createEmployeeWithAssignment (inti wizard — tanpa double-entry) +
// Onboarding checklist per bagian → backlink employeeId/onboardingId +
// Applicant.status=Employed + JobCandidate.status=Hired.
//
// PR → Fulfilled otomatis saat jumlah appointed mencapai requiredNo (hook
// di dalam appoint()).
//
// Kandidat INTERNAL (karyawan): pengangkatan = mutasi/promosi — dilarang di
// sini (guard) agar tidak double-entry; gunakan modul Aksi Kepegawaian
// (Personnel Action) setelah kandidat internal lulus.
// ============================================================================
import type { NextRequest } from "next/server";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { Prisma } from "@/generated/tenant";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";
import { sendWa, employeePhoneOf } from "@/rekankerja/shared/services/wa-service";
import { createEmployeeWithAssignment, type AssignmentSeed } from "@/rekankerja/human-resource/api/employees";
import { createOnboardingWithTasks, emailOnboardingChecklist } from "@/rekankerja/human-resource/api/onboarding";
import { reconcileJoOpenSlots } from "@/rekankerja/recruitment/services/opening-service";
import { emitWebhookEvent } from "@/rekankerja/recruitment/services/webhook-service";

// ============ konstanta domain ============

export const APPOINT_TEMPLATE_KEY = "REC_APPOINT";
export const REJECT_TEMPLATE_KEY = "REC_REJECT";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function fmtDateId(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtMoneyId(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00.000Z`);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ============ tipe serializer (batas API) ============

export interface AppointmentDocRow {
  id: string;
  title: string;
  verified: boolean;
  fileName: string | null;
}

export interface AppointmentContext {
  offer: {
    id: string;
    offerNo: string;
    status: string;
    salary: number | null;
    startDate: string | null;
    expiryDate: string | null;
  };
  candidate: {
    id: string;
    fullName: string;
    source: string;
    applicantNo: string | null;
    email: string | null;
    phone: string | null;
  };
  pr: {
    id: string;
    prNo: string;
    positionTitle: string | null;
    requiredNo: number;
    employmentStatus: string;
    orgUnitId: string | null;
    orgUnitName: string | null;
    companyOfficeId: string | null;
    officeName: string | null;
    officerId: string | null;
  };
  /** verifikasi checklist dokumen pre-employment (final). */
  documents: AppointmentDocRow[];
  /** kandidat lain di PR yang sama yang akan menerima surat penolakan saat PR fulfilled. */
  otherActiveCandidates: { id: string; fullName: string; status: string }[];
  /** jumlah pengangkatan yang sudah ada utk PR ini. */
  appointedCount: number;
  /** opsi picker: karyawan utk supervisor. */
  employees: { id: string; employeeNo: string; fullName: string; positionTitle: string | null }[];
  grades: { id: string; code: string; name: string }[];
  positions: { id: string; title: string; code: string }[];
  offices: { id: string; name: string }[];
  workLocations: { id: string; name: string }[];
}

export interface AppointInput {
  offerId: string;
  appointmentDate: string; // YYYY-MM-DD
  positionId?: string | null;
  orgUnitId?: string | null;
  companyOfficeId?: string | null;
  workLocationId?: string | null;
  supervisorId?: string | null;
  gradeId?: string | null;
  employmentStatus?: string | null;
  workShift?: string | null;
  note?: string | null;
}

export interface AppointResult {
  appointmentId: string;
  letterNo: string;
  prStatus: string;
  rejectedCount: number;
}

export interface OnboardResult {
  employeeId: string;
  employeeNo: string;
  onboardingId: string;
  emailsSent: number;
}

// ============ konteks dialog pengangkatan ============

/** Prefill dialog pengangkatan + checklist dokumen + preview penolakan batch. */
export async function appointmentContext(db: TenantDb, offerId: string): Promise<AppointmentContext | null> {
  const tc = tenantCryptoForDb(db);
  const offer = await db.candidateOffer.findUnique({
    where: { id: offerId },
    include: {
      candidate: {
        select: {
          id: true, fullName: true, source: true, applicantId: true,
          pr: {
            select: {
              id: true, prNo: true, requiredNo: true, employmentStatus: true,
              positionId: true, orgUnitId: true, companyOfficeId: true, recruitmentOfficerId: true,
              position: { select: { title: true } },
              orgUnit: { select: { name: true } },
              companyOffice: { select: { name: true } },
              candidates: { where: { status: { in: ["Nominated", "InProcess", "Passed"] } }, select: { id: true, fullName: true, status: true } },
              appointments: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!offer) return null;

  let email: string | null = null;
  let phone: string | null = null;
  let applicantNo: string | null = null;
  const documents: AppointmentDocRow[] = [];
  if (offer.candidate.applicantId) {
    const a = await db.applicant.findUnique({
      where: { id: offer.candidate.applicantId },
      include: {
        documents: {
          include: { attachment: { select: { fileName: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (a) {
      applicantNo = a.applicantNo;
      email = tc.decryptText(a.email) || null;
      phone = tc.decryptText(a.phone) || null;
      for (const d of a.documents) {
        documents.push({ id: d.id, title: d.title, verified: d.verified, fileName: d.attachment?.fileName ?? null });
      }
    }
  }

  const [employees, grades, positions, offices, workLocations] = await Promise.all([
    db.employee.findMany({
      where: { status: "Active" },
      select: { id: true, employeeNo: true, fullName: true, position: { select: { title: true } } },
      orderBy: { fullName: "asc" },
      take: 300,
    }),
    db.grade.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { sortOrder: "asc" } }),
    db.position.findMany({ where: { active: true }, select: { id: true, title: true, code: true }, orderBy: { title: "asc" }, take: 300 }),
    db.companyOffice.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.workLocation.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const pr = offer.candidate.pr;
  return {
    offer: {
      id: offer.id,
      offerNo: offer.offerNo,
      status: offer.status,
      salary: tc.decryptMoney(offer.salary),
      startDate: offer.startDate?.toISOString() ?? null,
      expiryDate: offer.expiryDate?.toISOString() ?? null,
    },
    candidate: {
      id: offer.candidate.id,
      fullName: offer.candidate.fullName,
      source: offer.candidate.source,
      applicantNo,
      email,
      phone,
    },
    pr: {
      id: pr.id,
      prNo: pr.prNo,
      positionTitle: pr.position?.title ?? null,
      requiredNo: pr.requiredNo,
      employmentStatus: pr.employmentStatus,
      orgUnitId: pr.orgUnitId,
      orgUnitName: pr.orgUnit?.name ?? null,
      companyOfficeId: pr.companyOfficeId,
      officeName: pr.companyOffice?.name ?? null,
      officerId: pr.recruitmentOfficerId,
    },
    documents,
    otherActiveCandidates: pr.candidates.filter((c) => c.id !== offer.candidate.id),
    appointedCount: pr.appointments.length,
    employees: employees.map((e) => ({ id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, positionTitle: e.position?.title ?? null })),
    grades: grades.map((g) => ({ id: g.id, code: g.code, name: g.name })),
    positions: positions.map((p) => ({ id: p.id, title: p.title, code: p.code })),
    offices: offices.map((o) => ({ id: o.id, name: o.name })),
    workLocations: workLocations.map((w) => ({ id: w.id, name: w.name })),
  };
}

// ============ surat (REC_APPOINT / REC_REJECT — mesin surat) ============

/** Nomor surat rekrutmen berikutnya NNN/HR-RC/{romawi}/{tahun} (counter sama
 *  dengan undangan/offer — satu deret per tahun, pola letter-service). */
async function nextRecruitmentLetterNo(db: TenantDb): Promise<string> {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const countSame = await db.recruitmentLetter.count({ where: { issuedAt: { gte: yearStart, lt: yearEnd } } });
  return `${String(countSame + 1).padStart(3, "0")}/HR-RC/${ROMAN[now.getMonth()]}/${now.getFullYear()}`;
}

async function renderLetter(
  db: TenantDb,
  templateKey: string,
  ctxBase: Record<string, string>,
): Promise<{ letterNo: string; body: string; subject: string | null }> {
  const template = await db.letterTemplate.findFirst({ where: { key: templateKey, active: true } });
  if (!template) {
    const any = await db.letterTemplate.findUnique({ where: { key: templateKey } });
    throw new Error(`Template surat (${templateKey}) belum tersedia${any ? " — aktifkan di menu Template Surat" : " — hubungi admin untuk seeding"}`);
  }
  const letterNo = await nextRecruitmentLetterNo(db);
  const company = await db.company.findFirst({ select: { name: true, city: true } });
  const now = new Date();
  const ctx: Record<string, string> = {
    letter_no: letterNo,
    letter_date: fmtDateId(now),
    city: company?.city ?? "Jakarta",
    company_name: company?.name ?? "RekanKerja HRIS",
    signatory_name: template.signatoryName?.trim() || "HR Manager",
    signatory_title: template.signatoryTitle,
    ...ctxBase,
  };
  const body = template.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    const v = ctx[token];
    return v != null && v.trim() !== "" ? v : "—";
  });
  return { letterNo, body, subject: template.subject };
}

// ============ pengangkatan ============

/** Pengangkatan kandidat: surat REC_APPOINT + tanda appointed + cek PR
 *  fulfilled (batch surat penolakan REC_REJECT ke kandidat lain). */
export async function appoint(
  db: TenantDb,
  input: AppointInput,
  actor?: { id?: string | null; name?: string | null },
): Promise<AppointResult> {
  const offer = await db.candidateOffer.findUnique({
    where: { id: input.offerId },
    include: {
      candidate: {
        select: {
          id: true, fullName: true, source: true, applicantId: true,
          pr: {
            select: {
              id: true, prNo: true, status: true, requiredNo: true, employmentStatus: true,
              position: { select: { title: true } },
            },
          },
        },
      },
      appointment: { select: { id: true } },
    },
  });
  if (!offer) throw new Error("Offer tidak ditemukan");
  if (offer.status !== "Accepted") {
    throw new Error(`Offer ${offer.offerNo} berstatus ${offer.status} — hanya offer DITERIMA (Accepted) yang bisa diangkat`);
  }
  if (offer.appointment) throw new Error(`Offer ${offer.offerNo} sudah mempunyai pengangkatan`);
  if (offer.candidate.source === "Internal") {
    throw new Error("Kandidat internal (karyawan) tidak diangkat lewat modul ini — gunakan Aksi Kepegawaian (Personnel Action) untuk mutasi/promosi");
  }
  if (!offer.candidate.applicantId) throw new Error("Kandidat eksternal tanpa data pelamar (talent pool)");

  const pr = offer.candidate.pr;
  if (pr.status !== "Approved" && pr.status !== "OnHold") {
    throw new Error(`PR ${pr.prNo} berstatus ${pr.status} — pengangkatan hanya utk PR Approved/OnHold`);
  }

  const appointmentDate = parseDate(input.appointmentDate);
  if (!appointmentDate) throw new Error("Tanggal pengangkatan wajib diisi (YYYY-MM-DD)");

  const tc = tenantCryptoForDb(db);
  const salary = tc.decryptMoney(offer.salary);

  // surat pengangkatan
  const supervisor = input.supervisorId
    ? await db.employee.findUnique({ where: { id: input.supervisorId }, select: { fullName: true } })
    : null;
  const positionTitle = input.positionId
    ? (await db.position.findUnique({ where: { id: input.positionId }, select: { title: true } }))?.title ?? pr.position?.title
    : pr.position?.title;
  const officeName = input.companyOfficeId
    ? (await db.companyOffice.findUnique({ where: { id: input.companyOfficeId }, select: { name: true } }))?.name
    : null;
  const letter = await renderLetter(db, APPOINT_TEMPLATE_KEY, {
    candidate_name: offer.candidate.fullName,
    pr_no: pr.prNo,
    offer_no: offer.offerNo,
    position_name: positionTitle ?? "posisi sesuai PR",
    appointment_date: fmtDateId(appointmentDate),
    start_date: fmtDateId(offer.startDate),
    employment_status: input.employmentStatus?.trim() || pr.employmentStatus,
    office_name: officeName ?? "kantor sesuai penempatan",
    supervisor_name: supervisor?.fullName ?? "atasan langsung penempatan",
    salary: fmtMoneyId(salary),
  });

  const appointment = await db.candidateAppointment.create({
    data: {
      offerId: offer.id,
      candidateId: offer.candidate.id,
      prId: pr.id,
      appointmentDate,
      positionId: input.positionId ?? null,
      orgUnitId: input.orgUnitId ?? null,
      companyOfficeId: input.companyOfficeId ?? null,
      workLocationId: input.workLocationId ?? null,
      supervisorId: input.supervisorId ?? null,
      gradeId: input.gradeId ?? null,
      employmentStatus: input.employmentStatus?.trim() || pr.employmentStatus,
      workShift: input.workShift?.trim() || "Regular",
      letterNo: letter.letterNo,
      status: "Appointed",
      note: input.note?.trim() || null,
    },
  });
  await db.recruitmentLetter.create({
    data: {
      letterNo: letter.letterNo, kind: "Appointment", templateKey: APPOINT_TEMPLATE_KEY,
      candidateId: offer.candidate.id, selectionStepId: null,
      subject: letter.subject, body: letter.body,
      metaJson: JSON.stringify({ templateName: "Surat Pengangkatan", offerNo: offer.offerNo, appointmentId: appointment.id }),
      createdById: actor?.id ?? null,
    },
  });
  await db.candidateOffer.update({ where: { id: offer.id }, data: { appointedAt: new Date() } });

  await db.activityLog.create({
    data: {
      action: "Created", entity: "CandidateAppointment", entityId: letter.letterNo,
      detail: `Pengangkatan kandidat ${offer.candidate.fullName} (PR ${pr.prNo}, offer ${offer.offerNo}) — surat ${letter.letterNo}${actor?.name ? `, oleh ${actor.name}` : ""}`,
    },
  });

  // ---- PR fulfilled? (jumlah appointed ≥ requiredNo) → batch penolakan ----
  const appointedCount = await db.candidateAppointment.count({ where: { prId: pr.id } });
  let prStatus = pr.status;
  let rejectedCount = 0;
  if (appointedCount >= pr.requiredNo && (pr.status === "Approved" || pr.status === "OnHold")) {
    prStatus = "Fulfilled";
    await db.personnelRequisition.update({ where: { id: pr.id }, data: { status: "Fulfilled" } });

    // REC-AUDIT-FIX H1+L3 — PROPAGASI saat PR Fulfilled (dulu tidak terjadi
    // apa-apa ke slot/JO → iklan masih tayang & menerima lamaran utk kebutuhan
    // yang sudah terpenuhi): slot offer yang dilayani → status Fulfilled
    // (state mati JobOpening.Fulfilled kini DITULIS — L3), sisa slot Open milik
    // PR ditutup, lalu JO yang kehabisan slot Open otomatis Closed.
    const nowFulfilled = new Date();
    const affectedJoIds = new Set<string>();
    if (offer.jobOpeningId) {
      const slot = await db.jobOpening.findUnique({ where: { id: offer.jobOpeningId }, select: { id: true, status: true, jobOpportunityId: true } });
      if (slot) {
        affectedJoIds.add(slot.jobOpportunityId);
        if (slot.status === "Open") {
          await db.jobOpening.update({ where: { id: slot.id }, data: { status: "Fulfilled", closedAt: nowFulfilled } });
          await db.activityLog.create({
            data: {
              action: "Updated", entity: "JobOpening", entityId: pr.prNo,
              detail: `Slot lowongan menjadi FULFILLED — kandidat diangkat dari offer ${offer.offerNo} (PR ${pr.prNo})`,
            },
          }).catch(() => {});
        }
      }
    }
    const otherOpen = await db.jobOpening.findMany({ where: { prId: pr.id, status: "Open" }, select: { id: true, titleToShow: true, jobOpportunityId: true } });
    if (otherOpen.length > 0) {
      await db.jobOpening.updateMany({ where: { prId: pr.id, status: "Open" }, data: { status: "Closed", closedAt: nowFulfilled } });
      for (const s of otherOpen) {
        affectedJoIds.add(s.jobOpportunityId);
        await db.activityLog.create({
          data: {
            action: "Closed", entity: "JobOpening", entityId: pr.prNo,
            detail: `Slot "${s.titleToShow}" ditutup otomatis — kebutuhan PR ${pr.prNo} telah terpenuhi`,
          },
        }).catch(() => {});
      }
    }
    for (const joId of affectedJoIds) {
      await reconcileJoOpenSlots(db, joId, actor?.name ?? null);
    }

    rejectedCount = await rejectOtherCandidates(db, { prId: pr.id, excludeCandidateId: offer.candidate.id, actorName: actor?.name });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "PersonnelRequisition", entityId: pr.prNo,
        detail: `PR ${pr.prNo} otomatis FULFILLED — ${appointedCount} kandidat diangkat (kebutuhan ${pr.requiredNo})${rejectedCount > 0 ? `; ${rejectedCount} kandidat lain ditolak (surat penolakan terbit)` : ""}`,
      },
    });
  }

  return { appointmentId: appointment.id, letterNo: letter.letterNo, prStatus, rejectedCount };
}

/** Batch surat penolakan REC_REJECT ke sisa kandidat aktif PR (saat PR
 *  fulfilled): kandidat → Failed + sisa tahap Cancelled + lamaran pelamar ke
 *  slot PR ini → Rejected (+ nomor surat). Idempoten by filter status. */
async function rejectOtherCandidates(
  db: TenantDb,
  input: { prId: string; excludeCandidateId: string; actorName?: string | null },
): Promise<number> {
  const others = await db.jobCandidate.findMany({
    where: {
      prId: input.prId,
      id: { not: input.excludeCandidateId },
      status: { in: ["Nominated", "InProcess", "Passed"] },
    },
    include: {
      pr: { select: { prNo: true, position: { select: { title: true } } } },
      selectionSteps: { where: { status: { in: ["Planned", "Acknowledged", "Performed"] } }, select: { id: true } },
    },
    take: 100,
  });

  let n = 0;
  for (const c of others) {
    const letter = await renderLetter(db, REJECT_TEMPLATE_KEY, {
      candidate_name: c.fullName,
      pr_no: c.pr.prNo,
      position_name: c.pr.position?.title ?? "posisi sesuai PR",
    });
    await db.recruitmentLetter.create({
      data: {
        letterNo: letter.letterNo, kind: "Rejection", templateKey: REJECT_TEMPLATE_KEY,
        candidateId: c.id, selectionStepId: null,
        subject: letter.subject, body: letter.body,
        metaJson: JSON.stringify({ templateName: "Surat Penolakan", prNo: c.pr.prNo, batchReason: "PR fulfilled" }),
        createdById: null,
      },
    });

    await db.jobCandidate.update({
      where: { id: c.id },
      data: {
        status: "Failed",
        note: [c.note, `Ditolak — kebutuhan PR ${c.pr.prNo} telah terpenuhi (${letter.letterNo})`].filter(Boolean).join(" · "),
      },
    });
    for (const s of c.selectionSteps) {
      await db.candidateSelectionStep.update({
        where: { id: s.id },
        data: { status: "Cancelled", comment: "Proses dihentikan — kebutuhan PR telah terpenuhi" },
      });
    }

    // lamaran pelamar ke slot PR ini → Rejected (jejak per slot)
    if (c.applicantId) {
      await db.applicantApplication.updateMany({
        where: { applicantId: c.applicantId, jobOpening: { prId: input.prId }, status: { in: ["Received", "Screening"] } },
        data: { status: "Rejected", rejectionLetterNo: letter.letterNo },
      });
    }

    await db.activityLog.create({
      data: {
        action: "Rejected", entity: "JobCandidate", entityId: c.pr.prNo,
        detail: `Surat penolakan ${letter.letterNo} utk kandidat ${c.fullName} (PR ${c.pr.prNo} fulfilled)${input.actorName ? ` oleh ${input.actorName}` : ""}`,
      },
    });
    n++;
  }
  return n;
}

// ============ lanjutkan ke onboarding (HRX H1 — tanpa double-entry) ============

/** Buat Employee + penempatan awal + Onboarding checklist dari pengangkatan.
 *  Data prefill: nama/PII pelamar (decrypt), posisi/office/workLocation/
 *  supervisor/employmentStatus dari appointment (override PR), gaji pokok =
 *  gaji final offer. Backlink employeeId + onboardingId + status Hired +
 *  Applicant.status=Employed + lamaran → Hired. */
export async function continueToOnboarding(
  db: TenantDb,
  input: { appointmentId: string; actor?: { id?: string | null; name?: string | null }; req?: NextRequest },
): Promise<OnboardResult> {
  const appt = await db.candidateAppointment.findUnique({
    where: { id: input.appointmentId },
    include: {
      offer: { select: { offerNo: true, salary: true, startDate: true } },
      candidate: { select: { id: true, fullName: true, applicantId: true, pr: { select: { prNo: true } } } },
    },
  });
  if (!appt) throw new Error("Pengangkatan tidak ditemukan");
  if (appt.status !== "Appointed" || appt.employeeId) {
    throw new Error(`Pengangkatan sudah ${appt.employeeId ? "dilanjutkan ke onboarding" : `berstatus ${appt.status}`}`);
  }
  if (!appt.candidate.applicantId) throw new Error("Kandidat tanpa data pelamar — tidak bisa dibuatkan karyawan");

  const tc = tenantCryptoForDb(db);
  const applicant = await db.applicant.findUnique({ where: { id: appt.candidate.applicantId } });
  if (!applicant) throw new Error("Data pelamar tidak ditemukan");

  const company = await db.company.findFirst({ select: { id: true, code: true } });
  if (!company) throw new Error("Company belum di-set — tidak bisa membuat karyawan");
  const prefix = String(company.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "EMP";

  const salary = tc.decryptMoney(appt.offer.salary) ?? 0;
  const joinDate = appt.appointmentDate;

  // PII pelamar → Employee (PLAIN — createEmployeeWithAssignment yang mengenkripsi)
  const plainNationalId = tc.decryptText(applicant.identityNo);
  const email = tc.decryptText(applicant.email) || null;
  const phone = tc.decryptText(applicant.phone) || null;
  const address = tc.decryptText(applicant.address) || null;
  const city = tc.decryptText(applicant.city) || null;

  const employeeData: Omit<Prisma.EmployeeUncheckedCreateInput, "employeeNo"> = {
    fullName: appt.candidate.fullName,
    gender: applicant.gender || "M",
    birthPlace: applicant.placeOfBirth,
    birthDate: applicant.birthDate,
    nationalId: plainNationalId || null,
    maritalStatus: applicant.maritalStatus,
    email,
    phone,
    address,
    city,
    companyId: company.id,
    joinDate,
    status: "Active",
  };

  const assignment: AssignmentSeed = {
    orgUnitId: appt.orgUnitId,
    positionId: appt.positionId,
    gradeId: appt.gradeId,
    managerId: appt.supervisorId,
    companyOfficeId: appt.companyOfficeId,
    workLocationId: appt.workLocationId,
    employmentStatus: appt.employmentStatus,
    workShift: appt.workShift,
    baseSalary: salary,
    validFrom: joinDate,
    changeReason: "Initial",
    notes: `Pengangkatan rekrutmen — offer ${appt.offer.offerNo} (PR ${appt.candidate.pr.prNo})`,
  };

  // REC-AUDIT-FIX M6 — TRANSAKSIONAL: Employee + penempatan awal + onboarding
  // + backlink + status terminal ATOMIK. Dulu berantai lepas — kegagalan di
  // tengah (mis. onboarding gagal) meninggalkan Employee TANPA backlink
  // appointment (data yatim yang tak bisa dilanjutkan/diulang).
  // Probation/email/WA/webhook tetap DI LUAR (best-effort, pasca-commit).
  const { employee, onboarding } = await db.$transaction(async (tx) => {
    const employee = await createEmployeeWithAssignment(tx, prefix, { ...employeeData }, assignment, tc);

    // Onboarding + checklist per bagian (hook sama seperti karyawan baru wizard)
    const onboarding = await createOnboardingWithTasks(tx, {
      employeeId: employee.id,
      startDate: joinDate,
      note: `Hasil rekrutmen — offer ${appt.offer.offerNo}, surat pengangkatan ${appt.letterNo ?? "-"}`,
    });

    // backlink + status terminal (SEKATU DENGAN pembuatan — in-tx)
    await tx.candidateAppointment.update({
      where: { id: appt.id },
      data: { employeeId: employee.id, onboardingId: onboarding.id, status: "Onboarded" },
    });
    await tx.jobCandidate.update({ where: { id: appt.candidate.id }, data: { status: "Hired" } });
    await tx.applicant.update({ where: { id: applicant.id }, data: { status: "Employed" } });
    await tx.applicantApplication.updateMany({
      where: { applicantId: applicant.id, jobOpening: { prId: appt.prId }, status: { in: ["Received", "Screening"] } },
      data: { status: "Hired" },
    });
    // pelamar sudah dipekerjakan → lamaran aktifnya ke PR LAIN ditutup (Rejected)
    await tx.applicantApplication.updateMany({
      where: {
        applicantId: applicant.id,
        status: { in: ["Received", "Screening"] },
        jobOpening: { prId: { not: appt.prId } },
      },
      data: { status: "Rejected", sourceNote: "Pelamar telah dipekerjakan melalui permintaan karyawan lain" },
    });

    await tx.activityLog.create({
      data: {
        action: "Created", entity: "Employee", entityId: employee.employeeNo,
        employeeId: employee.id,
        detail: `Karyawan ${employee.employeeNo} "${employee.fullName}" dibuat dari rekrutmen (offer ${appt.offer.offerNo}, PR ${appt.candidate.pr.prNo}) + onboarding ${onboarding.tasks.length} tugas${input.actor?.name ? ` oleh ${input.actor.name}` : ""}`,
      },
    });
    return { employee, onboarding };
  });

  // P7-PERF D9 — evaluasi masa percobaan otomatis dari onboarding (tenggat =
  // joinDate + 90 hari — maks 3 bulan UU 13/2003 Ps.60 §7.1). Failure-safe &
  // DI LUAR TRANSAKSI (M6): best-effort — evaluasi gagal tidak boleh
  // membatalkan karyawan+onboarding yang sudah commit.
  try {
    const { createProbationFromOnboarding } = await import("@/rekankerja/performance/services/perf-probation-service");
    await createProbationFromOnboarding(db, {
      employeeId: employee.id,
      onboardingId: onboarding.id,
      joinDate,
      actor: input.actor?.name ?? "system-onboarding",
    });
  } catch (e) {
    console.error("[probation] auto-create evaluasi percobaan dari onboarding gagal:", e instanceof Error ? e.message : e);
  }

  // email checklist per bagian (butuh req utk link publik — best effort,
  // pasca-commit supaya link menunjuk data yang pasti tersimpan)
  let emailsSent = 0;
  if (input.req) {
    emailsSent = await emailOnboardingChecklist(db, onboarding.id, input.req).catch(() => 0);
    if (emailsSent > 0) {
      await db.activityLog.create({
        data: {
          action: "Updated", entity: "Employee", entityId: employee.employeeNo,
          detail: `Email checklist onboarding dikirim ke ${emailsSent} bagian`,
        },
      }).catch(() => {});
    }
  }

  // notif officer
  const officer = await db.personnelRequisition.findUnique({
    where: { id: appt.prId },
    select: { recruitmentOfficer: { select: { id: true, email: true, fullName: true } }, prNo: true, position: { select: { title: true } } },
  });
  if (officer?.recruitmentOfficer) {
    await notifyEvent(db, {
      to: "employee", employeeId: officer.recruitmentOfficer.id, docType: "CandidateAppointment", docNo: employee.employeeNo,
      title: `Kandidat ${appt.candidate.fullName} resmi karyawan — ${employee.employeeNo}`,
      body: `Onboarding dibuat dari offer ${appt.offer.offerNo} (${officer.prNo}${officer.position?.title ? ` · ${officer.position.title}` : ""}) — ${onboarding.tasks.length} tugas checklist`,
      kind: "recruitment", link: "recruitment:offers",
    }).catch(() => undefined);
    if (officer.recruitmentOfficer.email) {
      void notifyEmailEvent(db, {
        event: "recruitment.appointment.hired",
        to: [{ email: officer.recruitmentOfficer.email, name: officer.recruitmentOfficer.fullName }],
        data: {
          nama: officer.recruitmentOfficer.fullName,
          kandidat: appt.candidate.fullName,
          employeeNo: employee.employeeNo,
          posisi: officer.position?.title ?? "-",
          docNo: appt.offer.offerNo,
        },
      });
    }
    // B6 — WhatsApp paralel (fire-and-forget, never-throw): officer
    // rekrutmen + KARYAWAN BARU (sambutan onboarding — nomor Employee.phone).
    const officerEmp = officer.recruitmentOfficer;
    void (async () => {
      const ph = (nama: string) => ({
        nama,
        kandidat: appt.candidate.fullName,
        employeeNo: employee.employeeNo,
        posisi: officer.position?.title ?? "-",
        docNo: appt.offer.offerNo,
      });
      const [officerPhone, newHirePhone] = await Promise.all([
        employeePhoneOf(db, officerEmp.id),
        employeePhoneOf(db, employee.id),
      ]);
      if (officerPhone) {
        void sendWa(db, { event: "recruitment.appointment.hired", toPhone: officerPhone, placeholders: ph(officerEmp.fullName) });
      }
      if (newHirePhone) {
        void sendWa(db, { event: "recruitment.appointment.hired", toPhone: newHirePhone, placeholders: ph(employee.fullName) });
      }
    })().catch(() => { /* notifikasi tidak boleh mengganggu proses utama */ });
  }

  // (ActivityLog pembuatan karyawan sudah ditulis DI DALAM transaksi — M6;
  //  email checklist tercatat terpisah setelah pengiriman.)

  // F7 — emit webhook candidate.hired (antrean; TANPA PII kandidat)
  void emitWebhookEvent(db, "candidate.hired", {
    employeeNo: employee.employeeNo,
    positionTitle: officer?.position?.title ?? null,
    hiredAt: new Date().toISOString(),
  }).catch(() => {});

  return { employeeId: employee.id, employeeNo: employee.employeeNo, onboardingId: onboarding.id, emailsSent };
}
