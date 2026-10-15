// ============================================================================
// RECRUITMENT B8 — REFERRAL SERVICE (referral tracker)
// Sumber: DEVELOPMENT-PLAN-BACKLOG.md §4 B8 + §5 risiko "Insentif referral
// disalahpahami otomatis".
//
// Insentif referral = CATATAN MANUAL HR — DI LUAR payroll (§5). Tidak ada
// perhitungan gaji yang menyentuh kolom ini; UI wajib menampilkan banner
// tegas "dicatat MANUAL oleh HR — TIDAK otomatis masuk payroll".
//
// Tiga pintu:
//   · listReferrals(db, actor, {q, status, rewardOnly}) — REGISTER HR:
//     SEMUA Applicant ber-referralEmployeeId + perujuk (nama, no, unit via
//     assignment aktif) + lamaran slot terakhir + status pipeline ringkas
//     (status applicant + tahap terakhir bila kandidat — TANPA data internal
//     evaluator/skor) + referralNote + referralRewardNote. Urut createdAt desc.
//   · updateRewardNote(db, actor, {applicantId, referralRewardNote}) — HR
//     SAJA (guard service + op menu "reward"); trim, ≤500 char, kosong →
//     null; setiap mutasi ter-audit ActivityLog "ReferralRewardNote".
//   · myReferrals(db, employeeId) — ESS "Referral Saya" SELF-SCOPE:
//     Applicant WHERE referralEmployeeId = employeeId. TANPA
//     referralRewardNote (internal HR), TANPA catatan internal/skor.
//     Read-only — ESS tidak bisa mengubah apa pun.
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { fullNameOf } from "@/rekankerja/recruitment/services/applicant-service";

// ============ error terpetakan HTTP (pola okr-service) ============

/** 404 — pelamar tidak ditemukan. */
export class ReferralNotFoundError extends Error {}
/** 403 — aktor bukan HR (guard service — lapis kedua setelah op menu). */
export class ReferralForbiddenError extends Error {}
/** 400 — payload tidak valid (panjang catatan dll.). */
export class ReferralBadRequestError extends Error {}

export function referralErrStatus(e: unknown): number {
  if (e instanceof ReferralNotFoundError) return 404;
  if (e instanceof ReferralForbiddenError) return 403;
  if (e instanceof ReferralBadRequestError) return 400;
  return 500;
}

/** Aktor ringan utk service (nama utk ActivityLog + role utk guard HR). */
export interface ReferralActor {
  name: string;
  /** role workspace platform: OWNER | ADMIN | HR | VIEWER | … */
  role?: string;
  /** role AppUser tenant: Admin | HR Manager | HR Staff | ESS | … */
  appUserRole?: string | null;
}

/** HR boleh memutasi catatan insentif? (guard SERVICE — lapisan kedua; op menu
 *  "reward" sudah dicek route. Owner/Admin platform + Admin/HR AppUser lolos.) */
export function referralCanManage(actor: ReferralActor): boolean {
  if (["OWNER", "ADMIN", "HR"].includes(actor.role ?? "")) return true;
  return ["Admin", "HR Manager", "HR Staff"].includes(actor.appUserRole ?? "");
}

// ============ tipe payload ============

export interface ReferralRegisterRow {
  id: string;
  applicantNo: string;
  fullName: string;
  /** status pipeline applicant: Active|Rejected|Outdated|Employed */
  status: string;
  /** perujuk — karyawan yang mereferensikan (nama, no, unit aktif). */
  referrer: { employeeNo: string; fullName: string; unit: string | null } | null;
  /** lamaran slot terakhir (slot title + joRefNo + tanggal + status). */
  latestApplication: { slotTitle: string; joRefNo: string; dateApplied: string; status: string } | null;
  /** tahap seleksi terakhir bila pelamar jadi kandidat — TANPA evaluator/note. */
  lastStage: { name: string; status: string } | null;
  /** konteks/pesan perujuk (kenapa merujuk). */
  referralNote: string | null;
  /** catatan insentif MANUAL HR — di luar payroll (register HR saja). */
  referralRewardNote: string | null;
  /** tanggal masuk talent pool. */
  dateApplied: string;
}

export interface ReferralRegisterStats {
  total: number;
  /** terkonversi — pelamar ber-referral berstatus Employed. */
  employed: number;
  /** ber-insentif tercatat (rewardNote terisi — manual, bukan payroll). */
  rewarded: number;
}

/** Baris ESS "Referral Saya" — TANPA referralRewardNote (internal HR). */
export interface MyReferralRow {
  id: string;
  applicantNo: string;
  fullName: string;
  status: string;
  referralNote: string | null;
  latestApplication: { slotTitle: string; joRefNo: string; dateApplied: string; status: string } | null;
  dateApplied: string;
}

export interface MyReferralStats {
  total: number;
  active: number;
  rejected: number;
  outdated: number;
  employed: number;
}

// ============ include bersama ============

const REFERRAL_INCLUDE = {
  referralEmployee: {
    select: {
      employeeNo: true,
      fullName: true,
      // unit via assignment aktif (validTo null — pola benchmark-service)
      assignments: {
        where: { validTo: null },
        orderBy: { validFrom: "desc" },
        select: { orgUnit: { select: { name: true } } },
      },
    },
  },
  applications: {
    orderBy: { dateApplied: "desc" as const },
    select: {
      dateApplied: true,
      status: true,
      jobOpening: { select: { titleToShow: true, jobOpportunity: { select: { refNo: true } } } },
    },
  },
  // kandidat PR → tahap terakhir (status pipeline ringkas, TANPA data internal)
  candidates: {
    orderBy: { nominatedAt: "desc" as const },
    select: {
      selectionSteps: {
        orderBy: { seqNo: "desc" as const },
        take: 1,
        select: { status: true, selectionProcess: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.ApplicantInclude;

type ReferralApplicant = Prisma.ApplicantGetPayload<{ include: typeof REFERRAL_INCLUDE }>;

/** Batas aman register (tenant demo kecil; register HR dibuka penuh per halaman UI). */
const REGISTER_TAKE = 500;

function registerRow(a: ReferralApplicant): ReferralRegisterRow {
  const latest = a.applications[0] ?? null;
  const cand = a.candidates[0] ?? null;
  const lastStep = cand?.selectionSteps[0] ?? null;
  const e = a.referralEmployee;
  return {
    id: a.id,
    applicantNo: a.applicantNo,
    fullName: fullNameOf(a),
    status: a.status,
    referrer: e ? { employeeNo: e.employeeNo, fullName: e.fullName, unit: e.assignments[0]?.orgUnit?.name ?? null } : null,
    latestApplication: latest
      ? {
          slotTitle: latest.jobOpening.titleToShow,
          joRefNo: latest.jobOpening.jobOpportunity.refNo,
          dateApplied: latest.dateApplied.toISOString(),
          status: latest.status,
        }
      : null,
    lastStage: lastStep ? { name: lastStep.selectionProcess.name, status: lastStep.status } : null,
    referralNote: a.referralNote,
    referralRewardNote: a.referralRewardNote,
    dateApplied: a.dateApplied.toISOString(),
  };
}

// ============ REGISTER HR ============

export interface ListReferralOptions {
  q?: string | null;
  status?: string | null;
  /** true → hanya yang referralRewardNote terisi. */
  rewardOnly?: boolean;
}

export async function listReferrals(
  db: TenantDb,
  _actor: ReferralActor,
  opts: ListReferralOptions,
): Promise<{ rows: ReferralRegisterRow[]; stats: ReferralRegisterStats }> {
  void _actor; // register view-only — aktor dipakai caller utk op reward (route)
  const base: Prisma.ApplicantWhereInput = { referralEmployeeId: { not: null } };

  const where: Prisma.ApplicantWhereInput = { ...base };
  if (opts.status) where.status = opts.status;
  if (opts.rewardOnly) where.referralRewardNote = { not: null };
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { applicantNo: { contains: q, mode: "insensitive" } },
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
      { referralEmployee: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [rows, total, employed, rewarded] = await Promise.all([
    db.applicant.findMany({ where, include: REFERRAL_INCLUDE, orderBy: { createdAt: "desc" }, take: REGISTER_TAKE }),
    db.applicant.count({ where: base }),
    db.applicant.count({ where: { ...base, status: "Employed" } }),
    db.applicant.count({ where: { ...base, referralRewardNote: { not: null } } }),
  ]);

  return {
    rows: rows.map(registerRow),
    // stats populasi referral PENUH (bukan hasil filter — pola tile stats modul lain)
    stats: { total, employed, rewarded },
  };
}

// ============ CATAT INSENTIF (rewardNote — manual, di luar payroll) ============

export const REFERRAL_REWARD_NOTE_MAX = 500;

export async function updateRewardNote(
  db: TenantDb,
  actor: ReferralActor,
  input: { applicantId: string; referralRewardNote: string | null | undefined },
): Promise<ReferralRegisterRow> {
  if (!referralCanManage(actor)) {
    throw new ReferralForbiddenError("Hanya HR yang dapat mencatat insentif referral (catatan manual — di luar payroll).");
  }
  const applicantId = input.applicantId?.trim();
  if (!applicantId) throw new ReferralBadRequestError("applicantId wajib diisi");

  const a = await db.applicant.findUnique({
    where: { id: applicantId },
    select: { id: true, applicantNo: true, referralEmployeeId: true, referralRewardNote: true },
  });
  if (!a) throw new ReferralNotFoundError("Pelamar tidak ditemukan");
  if (!a.referralEmployeeId) throw new ReferralBadRequestError("Pelamar ini tidak memiliki karyawan perujuk — tidak ada insentif untuk dicatat");

  // trim; kosong → null (clear); ≤500 char
  const note = (input.referralRewardNote ?? "").trim();
  if (note.length > REFERRAL_REWARD_NOTE_MAX) {
    throw new ReferralBadRequestError(`Catatan insentif maksimal ${REFERRAL_REWARD_NOTE_MAX} karakter (terima ${note.length})`);
  }
  const next = note === "" ? null : note;

  await db.applicant.update({ where: { id: a.id }, data: { referralRewardNote: next } });

  // ActivityLog — audit trail mutasi insentif manual (before/after ringkas)
  const brief = (v: string | null) => (v == null ? "(kosong)" : v.length > 80 ? `${v.slice(0, 80)}…` : v);
  await db.activityLog.create({
    data: {
      action: "ReferralRewardNote",
      entity: "Applicant",
      entityId: a.applicantNo,
      detail:
        `Catatan insentif referral pelamar ${a.applicantNo} diubah oleh ${actor.name} — SEBELUM: ${brief(a.referralRewardNote)} → SESUDAH: ${brief(next)} ` +
        "(catatan MANUAL HR — di luar payroll, tidak memengaruhi perhitungan gaji)",
    },
  });

  const fresh = await db.applicant.findUnique({ where: { id: a.id }, include: REFERRAL_INCLUDE });
  if (!fresh) throw new ReferralNotFoundError("Pelamar tidak ditemukan");
  return registerRow(fresh);
}

// ============ ESS "REFERRAL SAYA" (self-scope) ============

export async function myReferrals(
  db: TenantDb,
  employeeId: string,
): Promise<{ rows: MyReferralRow[]; stats: MyReferralStats }> {
  const where: Prisma.ApplicantWhereInput = { referralEmployeeId: employeeId };

  const [rows, group] = await Promise.all([
    db.applicant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, applicantNo: true, firstName: true, middleName: true, lastName: true,
        displayName: true, status: true, referralNote: true, dateApplied: true,
        applications: {
          orderBy: { dateApplied: "desc" as const },
          take: 1,
          select: {
            dateApplied: true, status: true,
            jobOpening: { select: { titleToShow: true, jobOpportunity: { select: { refNo: true } } } },
          },
        },
      },
    }),
    db.applicant.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  const st = (s: string) => group.find((g) => g.status === s)?._count._all ?? 0;

  return {
    rows: rows.map((a) => ({
      id: a.id,
      applicantNo: a.applicantNo,
      fullName: fullNameOf(a),
      status: a.status,
      referralNote: a.referralNote, // konteks perujuk — milik perujuk sendiri
      latestApplication: a.applications[0]
        ? {
            slotTitle: a.applications[0].jobOpening.titleToShow,
            joRefNo: a.applications[0].jobOpening.jobOpportunity.refNo,
            dateApplied: a.applications[0].dateApplied.toISOString(),
            status: a.applications[0].status,
          }
        : null,
      dateApplied: a.dateApplied.toISOString(),
      // referralRewardNote SENGAJA TIDAK disertakan — catatan internal HR (B8 §B).
    })),
    stats: {
      total: group.reduce((n, g) => n + g._count._all, 0),
      active: st("Active"), rejected: st("Rejected"), outdated: st("Outdated"), employed: st("Employed"),
    },
  };
}
