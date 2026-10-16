// ============================================================================
// RECRUITMENT F5 — Demografi pelamar + segmen talent pool + silver medalist
// (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F5 + analisa §2.5
// ApplicantDemography "Display Chart").
//
// Semua agregat dari kolom polos Applicant (gender/birthDate/highestEduLevel/
// source/status — bukan PII terenkripsi) → aman groupBy SQL.
// Silver medalist (auto-saran HRX): JobCandidate status Passed TANPA
// pengangkatan — kandidat kuat yang layak diajak ulang saat slot serupa buka.
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// ============ tipe (bentuk JSON API) ============

export interface DemogSlice {
  key: string;
  label: string;
  labelEn: string;
  count: number;
}

export interface DemographicsData {
  total: number;
  byGender: DemogSlice[];
  byAge: DemogSlice[];
  byEdu: DemogSlice[];
  bySource: DemogSlice[];
  byStatus: DemogSlice[];
  segments: {
    active: number;
    rejected: number;
    outdated: number;
    employed: number;
    blacklisted: number;
    expiringSoon: number; // keepOnFileUntil ≤ 60 hari & masih Active
  };
  silver: {
    rows: {
      candidateId: string;
      fullName: string;
      source: string; // Internal|External
      status: string;
      prNo: string;
      positionTitle: string | null;
      applicantNo: string | null; // eksternal saja
      nominatedAt: string;
      note: string | null;
    }[];
    count: number;
  };
}

const EDU_ORDER = ["SMP", "SMA", "SMK", "D3", "S1", "S2", "S3", "PROF"];
const AGE_BUCKETS: { key: string; label: string; labelEn: string; min: number; max: number }[] = [
  { key: "lt25", label: "< 25", labelEn: "< 25", min: 0, max: 24 },
  { key: "25-34", label: "25–34", labelEn: "25–34", min: 25, max: 34 },
  { key: "35-44", label: "35–44", labelEn: "35–44", min: 35, max: 44 },
  { key: "45-54", label: "45–54", labelEn: "45–54", min: 45, max: 54 },
  { key: "ge55", label: "≥ 55", labelEn: "≥ 55", min: 55, max: 200 },
];

const SOURCE_LABELS: Record<string, { id: string; en: string }> = {
  Advertisement: { id: "Iklan", en: "Advertisement" },
  Agency: { id: "Agency", en: "Agency" },
  Referral: { id: "Referral karyawan", en: "Employee referral" },
  Web: { id: "Web", en: "Web" },
  Internal: { id: "Internal", en: "Internal" },
  Other: { id: "Lainnya", en: "Other" },
};

const STATUS_LABELS: Record<string, { id: string; en: string }> = {
  Active: { id: "Aktif", en: "Active" },
  Rejected: { id: "Ditolak", en: "Rejected" },
  Outdated: { id: "Kedaluwarsa", en: "Outdated" },
  Employed: { id: "Dipekerjakan", en: "Employed" },
};

function ageOf(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let a = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) a--;
  return a;
}

// ============ agregat ============

export async function applicantDemographics(db: TenantDb): Promise<DemographicsData> {
  const applicants = await db.applicant.findMany({
    select: { gender: true, birthDate: true, highestEduLevel: true, source: true, status: true, blacklist: true, suspend: true, keepOnFileUntil: true },
    take: 2000,
  });
  const total = applicants.length;

  // gender — REC-AUDIT-FIX L7: kolom menyimpan konvensi campuran (portal
  // publik mengirim L/P; form admin lama M/F) → normalisasi dulu ke L/P.
  const g: Record<string, number> = {};
  for (const a of applicants) {
    const v = (a.gender ?? "").trim().toUpperCase();
    const k = v === "L" || v === "M" ? "L" : v === "P" || v === "F" ? "P" : "unknown";
    g[k] = (g[k] ?? 0) + 1;
  }
  const byGender: DemogSlice[] = [
    { key: "L", label: "Laki-laki", labelEn: "Male", count: g["L"] ?? 0 },
    { key: "P", label: "Perempuan", labelEn: "Female", count: g["P"] ?? 0 },
    { key: "unknown", label: "Tak diisi", labelEn: "Unspecified", count: g["unknown"] ?? 0 },
  ];

  // umur
  const ages = applicants.map((a) => ageOf(a.birthDate)).filter((x): x is number => x != null);
  const byAge: DemogSlice[] = AGE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    labelEn: b.labelEn,
    count: ages.filter((x) => x >= b.min && x <= b.max).length,
  }));
  const noAge = total - ages.length;
  if (noAge > 0) byAge.push({ key: "unknown", label: "Tak diisi", labelEn: "Unspecified", count: noAge });

  // pendidikan tertinggi (kolom turunan — di-maintain applicant-service)
  const e: Record<string, number> = {};
  for (const a of applicants) e[a.highestEduLevel ?? "unknown"] = (e[a.highestEduLevel ?? "unknown"] ?? 0) + 1;
  const byEdu: DemogSlice[] = EDU_ORDER
    .filter((lv) => (e[lv] ?? 0) > 0)
    .map((lv) => ({ key: lv, label: lv, labelEn: lv, count: e[lv] ?? 0 }));
  if ((e["unknown"] ?? 0) > 0) byEdu.push({ key: "unknown", label: "Tak diisi", labelEn: "Unspecified", count: e["unknown"] ?? 0 });

  // sumber & status
  const s: Record<string, number> = {};
  for (const a of applicants) s[a.source ?? "unknown"] = (s[a.source ?? "unknown"] ?? 0) + 1;
  const bySource: DemogSlice[] = Object.entries(s)
    .map(([k, count]) => {
      const lb = SOURCE_LABELS[k] ?? { id: k === "unknown" ? "Tak diisi" : k, en: k === "unknown" ? "Unspecified" : k };
      return { key: k, label: lb.id, labelEn: lb.en, count };
    })
    .sort((a, b) => b.count - a.count);

  const st: Record<string, number> = {};
  for (const a of applicants) st[a.status] = (st[a.status] ?? 0) + 1;
  const byStatus: DemogSlice[] = Object.entries(st)
    .map(([k, count]) => ({ key: k, label: STATUS_LABELS[k]?.id ?? k, labelEn: STATUS_LABELS[k]?.en ?? k, count }))
    .sort((a, b) => b.count - a.count);

  // segmen talent pool
  const soonLimit = new Date(Date.now() + 60 * 86_400_000);
  const segments = {
    active: st["Active"] ?? 0,
    rejected: st["Rejected"] ?? 0,
    outdated: st["Outdated"] ?? 0,
    employed: st["Employed"] ?? 0,
    blacklisted: applicants.filter((a) => a.blacklist).length,
    expiringSoon: applicants.filter(
      (a) => a.status === "Active" && a.keepOnFileUntil != null && a.keepOnFileUntil <= soonLimit,
    ).length,
  };

  // silver medalist: Passed tanpa pengangkatan (auto-saran talent pool).
  // F9 (UU PDP): pelamar yang menarik consent "talent-pool" (ada & sudah
  // ditarik) TIDAK lagi disarankan; pelamar Anonymized juga dikeluarkan.
  const silverWhere: Prisma.JobCandidateWhereInput = {
    status: "Passed",
    appointments: { none: {} },
    OR: [
      { applicantId: null }, // kandidat internal — tidak ada data pelamar
      {
        applicant: {
          status: { not: "Anonymized" },
          consents: { none: { purpose: "talent-pool", withdrawnAt: { not: null } } },
        },
      },
    ],
  };
  const silverRows = await db.jobCandidate.findMany({
    where: silverWhere,
    include: {
      pr: { select: { prNo: true, position: { select: { title: true } } } },
      applicant: { select: { applicantNo: true } },
    },
    orderBy: { nominatedAt: "desc" },
    take: 25,
  });

  return {
    total,
    byGender,
    byAge,
    byEdu,
    bySource,
    byStatus,
    segments,
    silver: {
      rows: silverRows.map((c) => ({
        candidateId: c.id,
        fullName: c.fullName,
        source: c.source,
        status: c.status,
        prNo: c.pr.prNo,
        positionTitle: c.pr.position?.title ?? null,
        applicantNo: c.applicant?.applicantNo ?? null,
        nominatedAt: c.nominatedAt.toISOString(),
        note: c.note,
      })),
      count: silverRows.length,
    },
  };
}
