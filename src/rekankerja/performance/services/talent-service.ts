// B3-BL — HEURISTIK ATTRISI EXPLAINABLE (DEVELOPMENT-PLAN-BACKLOG.md §4 B3;
// keputusan D-BL10…D-BL12). Service ON-DEMAND STATELESS: TIDAK ada tabel baru,
// TIDAK ada migrasi, TIDAK ada skor yang disimpan — semua dihitung dari data
// domain yang ada tiap kali dibaca (audit ulang kapan saja = hasil identik).
//   • BUKAN ML (D-BL10): skor 0–100 dari faktor bobot TETAP ter-audit —
//     rating 30 + trend 10 + pip 20 + tenure 10 + compa 15 + reward 15 = 100.
//   • Explainable: setiap faktor mengembalikan {key, score, max, available,
//     note} — rincian kontribusi SELALU tampil bersama skor (mitigasi risiko
//     §5 "disalahartikan prediksi pasti").
//   • Netralisasi data (D-BL11): faktor yang datanya tak tersedia keluar dari
//     PEMBILANG & PENYEBUT (skor dinormalisasi thd max yang tersedia) — tidak
//     difabrikasi; UI menampilkan chip "data terbatas".
//   • Akses (D-BL12, pola §11.3): HR/admin (menu guard) semua karyawan;
//     Direksi semua; selain itu hanya bawahan LANGSUNG (assignment aktif
//     managerId = actor.employeeId). ESS bukan atasan → 403.
// Level: ≥50 Tinggi · 25–49 Sedang · <25 Rendah. Urut skor desc, take 200.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { Prisma } from "@/generated/tenant";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

// ============ error bermuatan status (pola okr-service) ============

/** 403 — aktor tidak berhak melihat data attrisi siapa pun (D-BL12). */
export class TalentForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) { super(message); }
}

/** Map error service → HTTP status (dipakai api/talent.ts). */
export function talentErrStatus(e: unknown): number {
  if (e instanceof TalentForbiddenError) return 403;
  return 400;
}

// ============ aktor & helper HR (pola okrHrActor okr-service) ============

export interface TalentActor {
  name: string;
  /** employeeId aktor — null = akun HR tanpa data karyawan (akses penuh). */
  employeeId: string | null;
  /** true = HR/admin (atas menu guard — melihat semua karyawan). */
  isHr: boolean;
}

const HR_ROLES = ["OWNER", "ADMIN", "HR"];
const HR_APP_ROLES = ["Admin", "HR Manager", "HR Staff"];

/** Aktor = HR/admin (akses penuh attrisi — D-BL12). */
export function talentHrActor(role: string | null | undefined, appUserRole: string | null | undefined): boolean {
  return HR_ROLES.includes(role ?? "") || HR_APP_ROLES.includes(appUserRole ?? "");
}

/** Judul posisi tergolong Direksi (D-BL12) — "Director"/"Chief"/"Direktur". */
export function isDirectorTitle(title: string | null | undefined): boolean {
  const s = (title ?? "").toLowerCase();
  return s.includes("director") || s.includes("chief") || s.includes("direktur");
}

// ============ struktur faktor (D-BL10 — explainable) ============

export interface AttritionFactor {
  /** key stabil utk UI: rating|trend|pip|tenure|compa|reward. */
  key: string;
  /** skor faktor (0..max; 0 bila tidak berisiko / data tidak menandakan). */
  score: number;
  /** bobot maksimum faktor (keluar dari penyebut bila !available — D-BL11). */
  max: number;
  /** false = data tidak tersedia → DINETRALKAN (bukan 0!. */
  available: boolean;
  /** rincian data pendukung (ringkas, berisi angka — label via t() di UI). */
  note: string;
}

export interface AttritionRiskRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  unitName: string | null;
  positionName: string | null;
  gradeCode: string | null;
  /** skor 0–100 (round(Σscore/Σmax tersedia × 100)). */
  score: number;
  /** "Tinggi" | "Sedang" | "Rendah" — label UI dwibahasa via t(). */
  level: "Tinggi" | "Sedang" | "Rendah";
  factors: AttritionFactor[];
}

export interface AttritionRiskResult {
  rows: AttritionRiskRow[];
  stats: { tinggi: number; sedang: number; rendah: number; total: number };
  /** key disclaimer dwibahasa — UI merender via t() (D-BL11). */
  disclaimer: string;
  /** cakupan akses aktor (info UI). */
  scope: "all" | "team";
}

/** Key disclaimer (D-BL11) — UI punya pasangan t() lengkap. */
export const ATTRITION_DISCLAIMER_KEY = "attrition-heuristic-explainable-not-ml";

// status appraisal terhitung sebagai "terpublikasi" (hasil final karyawan)
const PUBLISHED_STATUS_SET: Record<string, true> = { Published: true, Closed: true };
const PUBLISHED_STATUSES: string[] = Object.keys(PUBLISHED_STATUS_SET);

// changeReason yang dihitung sebagai peristiwa reward/karier (faktor reward)
const REWARD_REASON_SET: Record<string, true> = { Promotion: true, SalaryAdjustment: true, Mutation: true };

// status PIP yang berarti program BERJALAN (Extended = perpanjangan 1× §35-21)
const PIP_ONGOING_SET: Record<string, true> = { Active: true, Extended: true };

// ============ kalkulasi faktor murni (deterministik, mudah diaudit) ============

/** Faktor 1 — rating terakhir (max 30): ≤2 → 30; =3 → 10; ≥4 → 0. */
export function ratingScore(lastRating: number | null): number {
  if (lastRating == null) return 0;
  if (lastRating <= 2) return 30;
  if (lastRating === 3) return 10;
  return 0;
}

/** Faktor 2 — tren rating 2 siklus (max 10): turun ≥1 poin → 10. */
export function trendScore(prev: number, last: number): number {
  return prev - last >= 1 ? 10 : 0;
}

/** Faktor 3 — tenure tahun (max 10): <1 → 5; 1–2 → 8; 2–5 → 5; >5 → 0. */
export function tenureScore(years: number): number {
  if (years < 1) return 5;
  if (years < 2) return 8;
  if (years <= 5) return 5;
  return 0;
}

/** Faktor 4 — kompa-rasio gaji pokok vs midpoint grade (max 15): <0.80 → 15; 0.80–0.95 → 8; sisanya 0. */
export function compaScore(ratio: number): number {
  if (ratio < 0.80) return 15;
  if (ratio < 0.95) return 8;
  return 0;
}

/** Faktor 5 — bulan sejak peristiwa reward terakhir (max 15):
 *  >24 bln & rating ≥4 → 15 (performa bagus tak tereward);
 *  >24 bln & rating ≤3 (atau tak ada rating) → 8; ≤24 bln → 0. */
export function rewardScore(months: number, lastRating: number | null): number {
  if (months <= 24) return 0;
  return lastRating != null && lastRating >= 4 ? 15 : 8;
}

/** Selisih bulan (pecahan — konsisten utk pembandingan ambang 24). */
export function monthsSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / (30.4375 * 86_400_000);
}

/** Level dari skor (D-BL10). */
export function levelOf(score: number): "Tinggi" | "Sedang" | "Rendah" {
  if (score >= 50) return "Tinggi";
  if (score >= 25) return "Sedang";
  return "Rendah";
}

const round0 = (n: number) => Math.round(n);
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

// ============ perhitungan satu karyawan (SATU sumber logika faktor) ============

/** Data karyawan minimal utk perhitungan attrition (listAttritionRisk & attritionRiskOf). */
export interface AttritionEmployeeData {
  id: string;
  employeeNo: string;
  fullName: string;
  joinDate: Date;
  assignments: {
    validFrom: Date;
    validTo: Date | null;
    changeReason: string;
    baseSalary: string | null;
    orgUnit: { name: string } | null;
    position: { title: string } | null;
    grade: { code: string; minSalary: number; maxSalary: number } | null;
  }[];
}

/** Satu baris risiko attrisi dari data ter-fetch — dipakai listAttritionRisk
 * (populasi) DAN attritionRiskOf (satu karyawan; B4 succession flightRisk
 * snapshot D-BL10) — SATU sumber logika faktor, tanpa duplikasi. */
export function attritionRowOf(
  e: AttritionEmployeeData,
  cycles: { finalRating: number | null; cycleCode: string; periodEnd: Date }[],
  pips: { status: string; docNo: string }[],
  now: Date,
  tc: { decryptMoney(stored: string | null | undefined): number | null },
): AttritionRiskRow {
  const active = e.assignments.find((a) => a.validTo == null);
  const lastCycle = cycles[0] ?? null;
  const prevCycle = cycles[1] ?? null;
  const lastRating = lastCycle?.finalRating ?? null;

  const factors: AttritionFactor[] = [];

  // (1) rating terakhir — max 30; tanpa siklus terpublikasi → dinetralkan (D-BL11)
  factors.push({
    key: "rating",
    score: lastRating == null ? 0 : ratingScore(lastRating),
    max: 30,
    available: lastRating != null,
    note: lastRating == null
      ? "belum ada siklus terpublikasi"
      : `rating ${lastRating} (${cycles.length} siklus terdata${cycles.length < 2 ? " — data terbatas" : ""})`,
  });

  // (2) tren 2 siklus — max 10; butuh keduanya ber-rating
  const trendReady = lastCycle != null && prevCycle != null
    && lastCycle.finalRating != null && prevCycle.finalRating != null;
  factors.push({
    key: "trend",
    score: trendReady
      ? trendScore(prevCycle.finalRating as number, lastCycle.finalRating as number)
      : 0,
    max: 10,
    available: trendReady,
    note: trendReady
      ? `${prevCycle.finalRating} → ${lastCycle.finalRating} (${prevCycle.cycleCode} → ${lastCycle.cycleCode})`
      : "butuh 2 siklus terpublikasi ber-rating",
  });

  // (3) tenure — max 10 (selalu tersedia: joinDate NOT NULL)
  const tenureYears = (now.getTime() - e.joinDate.getTime()) / (365.25 * 86_400_000);
  factors.push({
    key: "tenure",
    score: tenureScore(tenureYears),
    max: 10,
    available: true,
    note: `${tenureYears.toFixed(1)} tahun (join ${fmtDate(e.joinDate)})`,
  });

  // (4) kompa-rasio — max 15; gaji null / grade null / midpoint 0 → dinetralkan
  const baseSalary = active ? tc.decryptMoney(active.baseSalary) : null;
  const grade = active?.grade ?? null;
  const midpoint = grade ? (grade.minSalary + grade.maxSalary) / 2 : 0;
  const ratio = baseSalary != null && midpoint > 0 ? baseSalary / midpoint : null;
  factors.push({
    key: "compa",
    score: ratio != null ? compaScore(ratio) : 0,
    max: 15,
    available: ratio != null,
    note: ratio != null && grade != null
      ? `kompa-rasio ${ratio.toFixed(2)} (midpoint grade ${grade.code})`
      : active?.grade == null && baseSalary == null
        ? "gaji pokok & grade belum diisi"
        : active?.grade == null ? "grade belum diisi" : "gaji pokok belum diisi",
  });

  // (5) reward — max 15; sejak assignment Promotion/SalaryAdjustment/Mutation
  // terbaru; tak pernah → sejak joinDate
  const rewardAsg = e.assignments.find((a) => REWARD_REASON_SET[a.changeReason] === true);
  const rewardFrom = rewardAsg?.validFrom ?? e.joinDate;
  const rewardMonths = monthsSince(rewardFrom, now);
  factors.push({
    key: "reward",
    score: rewardScore(rewardMonths, lastRating),
    max: 15,
    available: true,
    note: rewardAsg
      ? `${rewardMonths.toFixed(0)} bulan sejak ${rewardAsg.changeReason} (${fmtDate(rewardAsg.validFrom)})`
      : `${rewardMonths.toFixed(0)} bulan sejak join (tak pernah promosi/penyesuaian)`,
  });

  // (6) PIP — max 20; aktif → 20; riwayat NotRecovered → 15; Recovered → 0
  const ongoing = pips.find((p) => PIP_ONGOING_SET[p.status] === true);
  const notRecovered = pips.find((p) => p.status === "NotRecovered");
  const pipScoreV = ongoing ? 20 : notRecovered ? 15 : 0;
  factors.push({
    key: "pip",
    score: pipScoreV,
    max: 20,
    available: true,
    note: ongoing
      ? `PIP berjalan (${ongoing.docNo})`
      : notRecovered
        ? `riwayat PIP tidak pulih (${notRecovered.docNo})`
        : pips.some((p) => p.status === "Recovered")
          ? "riwayat PIP pulih (Recovered)"
          : "tidak ada PIP",
  });

  // urutan faktor konsisten utk tampilan: rating, trend, pip, tenure, compa, reward
  const order: Record<string, number> = { rating: 0, trend: 1, pip: 2, tenure: 3, compa: 4, reward: 5 };
  factors.sort((a, b) => order[a.key] - order[b.key]);

  // skor = Σscore / Σmax YANG TERSEDIA × 100 (D-BL11 — netralisasi penyebut)
  const avail = factors.filter((f) => f.available);
  const sumScore = avail.reduce((s, f) => s + f.score, 0);
  const sumMax = avail.reduce((s, f) => s + f.max, 0);
  const score = sumMax > 0 ? round0((sumScore / sumMax) * 100) : 0;

  return {
    employeeId: e.id,
    employeeNo: e.employeeNo,
    fullName: e.fullName,
    unitName: active?.orgUnit?.name ?? null,
    positionName: active?.position?.title ?? null,
    gradeCode: active?.grade?.code ?? null,
    score,
    level: levelOf(score),
    factors,
  };
}

/** Skor heuristik attrisi SATU karyawan on-demand (B4-BL succession flightRisk
 * snapshot D-BL10 — memanggil logika faktor yang sama dgn listAttritionRisk,
 * tanpa duplikasi). null bila karyawan tidak ditemukan. */
export async function attritionRiskOf(
  db: TenantDb,
  employeeId: string,
): Promise<AttritionRiskRow | null> {
  const e = await db.employee.findFirst({
    where: { id: employeeId },
    select: {
      id: true, employeeNo: true, fullName: true, joinDate: true,
      assignments: {
        orderBy: { validFrom: "desc" },
        select: {
          validFrom: true, validTo: true, changeReason: true, baseSalary: true,
          orgUnit: { select: { name: true } },
          position: { select: { title: true } },
          grade: { select: { code: true, minSalary: true, maxSalary: true } },
        },
      },
    },
  });
  if (!e) return null;
  const [appraisals, pips] = await Promise.all([
    db.appraisalRecord.findMany({
      where: { employeeId, status: { in: PUBLISHED_STATUSES } },
      select: { finalRating: true, cycle: { select: { code: true, periodEnd: true } } },
      orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
    }),
    db.pipPlan.findMany({ where: { employeeId }, select: { status: true, docNo: true } }),
  ]);
  const cycles = appraisals.map((a) => ({
    finalRating: a.finalRating, cycleCode: a.cycle.code, periodEnd: a.cycle.periodEnd,
  }));
  return attritionRowOf(e, cycles, pips, new Date(), tenantCryptoForDb(db));
}

// ============ daftar risiko attrisi (on-read — stateless) ============

/**
 * Papan risiko attrisi seluruh karyawan Active (atau bawahan langsung aktor).
 * Akses D-BL12 (dijalankan SETELAH menu guard di API):
 *   • isHr → semua karyawan (HR/admin via menu guard performance:talent);
 *   • posisi aktif aktor berjudul Direksi → semua;
 *   • selain itu → HANYA bawahan langsung (assignment aktif managerId);
 *     bukan atasan siapa pun → 403 (ESS bukan atasan tidak melihat).
 */
export async function listAttritionRisk(
  db: TenantDb,
  actor: TalentActor,
  opt: { unitId?: string; q?: string; onlyHigh?: boolean } = {},
): Promise<AttritionRiskResult> {
  // ---- resolusi cakupan akses (D-BL12) ----
  let scope: "all" | "team" = "all";
  if (!actor.isHr) {
    let director = false;
    if (actor.employeeId) {
      const myAsg = await db.employeeAssignment.findFirst({
        where: { employeeId: actor.employeeId, validTo: null },
        select: { position: { select: { title: true } } },
        orderBy: { validFrom: "desc" },
      });
      director = isDirectorTitle(myAsg?.position?.title);
    }
    if (!director) {
      if (!actor.employeeId) {
        throw new TalentForbiddenError(
          "Akses ditolak: risiko attrisi hanya untuk HR/admin, Direksi, atau atasan langsung (tim sendiri).",
        );
      }
      // atasan LANGSUNG siapa pun? tidak → 403 (ESS bukan atasan tidak melihat)
      const subCount = await db.employeeAssignment.count({
        where: { managerId: actor.employeeId, validTo: null },
      });
      if (subCount === 0) {
        throw new TalentForbiddenError(
          "Akses ditolak: Anda bukan atasan langsung karyawan mana pun — risiko attrisi hanya untuk HR/admin, Direksi, atau atasan langsung (tim sendiri).",
        );
      }
      scope = "team"; // filter bawahan langsung via query di bawah
    }
  }

  // ---- populasi karyawan Active (+ filter cakupan tim / unit / pencarian) ----
  const now = new Date();
  const tc = tenantCryptoForDb(db);
  // filter gabungan AND (diketik eksplisit — literal array campuran tak menginfers)
  const filters: Prisma.EmployeeWhereInput[] = [];
  if (scope === "team" && actor.employeeId) {
    // cakupan tim: bawahan LANGSUNG aktor (assignment aktif managerId)
    filters.push({ assignments: { some: { validTo: null, managerId: actor.employeeId } } });
  }
  if (opt.unitId) filters.push({ assignments: { some: { validTo: null, orgUnitId: opt.unitId } } });
  if (opt.q) {
    filters.push({
      OR: [
        { fullName: { contains: opt.q, mode: "insensitive" } },
        { employeeNo: { contains: opt.q, mode: "insensitive" } },
      ],
    });
  }
  const employees = await db.employee.findMany({
    where: { status: "Active", AND: filters },
    select: {
      id: true, employeeNo: true, fullName: true, joinDate: true,
      assignments: {
        orderBy: { validFrom: "desc" },
        select: {
          validFrom: true, validTo: true, changeReason: true, baseSalary: true,
          orgUnit: { select: { name: true } },
          position: { select: { title: true } },
          grade: { select: { code: true, minSalary: true, maxSalary: true } },
        },
      },
    },
    orderBy: { employeeNo: "asc" },
  });

  // ---- data pendukung massal (2 siklus terpublikasi + PIP) ----
  const empIds = employees.map((e) => e.id);
  const [appraisals, pips] = await Promise.all([
    empIds.length
      ? db.appraisalRecord.findMany({
          where: { employeeId: { in: empIds }, status: { in: PUBLISHED_STATUSES } },
          select: {
            employeeId: true, finalRating: true,
            cycle: { select: { code: true, periodEnd: true } },
          },
          orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    empIds.length
      ? db.pipPlan.findMany({
          where: { employeeId: { in: empIds } },
          select: { employeeId: true, status: true, docNo: true },
        })
      : Promise.resolve([]),
  ]);

  // 2 siklus TERPUBLIKASI terakhir per karyawan (periodEnd desc)
  const apprByEmp = new Map<string, { finalRating: number | null; cycleCode: string; periodEnd: Date }[]>();
  for (const a of appraisals) {
    const list = apprByEmp.get(a.employeeId) ?? [];
    list.push({ finalRating: a.finalRating, cycleCode: a.cycle.code, periodEnd: a.cycle.periodEnd });
    apprByEmp.set(a.employeeId, list);
  }
  const pipByEmp = new Map<string, { status: string; docNo: string }[]>();
  for (const p of pips) {
    const list = pipByEmp.get(p.employeeId) ?? [];
    list.push({ status: p.status, docNo: p.docNo });
    pipByEmp.set(p.employeeId, list);
  }

  // ---- hitung per karyawan (logika faktor SATU sumber: attritionRowOf) ----
  const rows: AttritionRiskRow[] = employees.map((e) =>
    attritionRowOf(e, apprByEmp.get(e.id) ?? [], pipByEmp.get(e.id) ?? [], now, tc),
  );

  // statistik level dihitung atas populasi SEBELUM filter onlyHigh (distribusi
  // sejati — tile tetap informatif saat daftar dipadatkan ke Tinggi saja)
  const stats = {
    tinggi: rows.filter((r) => r.level === "Tinggi").length,
    sedang: rows.filter((r) => r.level === "Sedang").length,
    rendah: rows.filter((r) => r.level === "Rendah").length,
    total: rows.length,
  };

  const filtered = opt.onlyHigh ? rows.filter((r) => r.level === "Tinggi") : rows;
  filtered.sort((a, b) => b.score - a.score || a.employeeNo.localeCompare(b.employeeNo));

  return {
    rows: filtered.slice(0, 200),
    stats,
    disclaimer: ATTRITION_DISCLAIMER_KEY,
    scope,
  };
}
