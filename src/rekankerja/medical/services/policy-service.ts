// RekanKerja — POLICY SERVICE (P2.5-BM · D-BM20: benefits administration grup)
// ===========================================================================
// Administrasi polis asuransi grup: buat/ubah polis (provider INSURANCE, periode,
// premi bulanan TERENKRIPSI vault, % porsi perusahaan) → enroll karyawan +
// dependen (effective dating, validasi registry keluarga) → terminasi polis /
// akhiri membership → laporan premi per anggota + rekap porsi perusahaan vs
// karyawan.
//
// BATAS SCOPE (DEVELOPMENT-PLAN-BENCHMARK.md §5 — D-BM20): administrasi polis +
// enrollment + laporan premi SAJA. Adjudikasi klaim TETAP di engine reimbursement
// modul Medical existing — file ini tidak menyentuh klaim/jurnal.
//
// Konvensi:
//   · premiumMonthly = String TERENKRIPSI vault uang (enc:v1|v2:n:…) — uang
//     dihitung INTERNAL via tenantCryptoForDb (raw), serializer digerbangi
//     MoneyView (mv.canSee → angka; else null + premiumMasked — pelajaran MR:
//     kolom uang XLSX '' bukan 0 saat vault terkunci).
//   · ActivityLog semua mutasi — detail TANPA nominal (pelajaran audit
//     Performance: nomor polis + provider code cukup).
import { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import type { MoneyView } from "@/rekankerja/shared/lib/money-view";

/** Error kepatuhan dengan kode HTTP (pola ComplianceError — dipetakan API). */
export class PolicyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ============ util ============

const dayStart = (d: Date | string) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const isoDate = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

/** Identitas aktor sesi utk jejak audit (pola MedActorRef — opsional). */
export interface PolicyActorRef {
  appUserId?: string | null;
  employeeId?: string | null;
  name?: string | null;
}

/** Membership aktif pada tanggal referensi (default hari ini): sudah efektif
 *  dan belum berakhir (effectiveTo inklusif — hari terakhir masih tercakup). */
function memberActiveAt(
  m: { effectiveFrom: Date; effectiveTo: Date | null },
  at: Date = new Date(),
): boolean {
  const t = dayStart(at).getTime();
  return dayStart(m.effectiveFrom).getTime() <= t && (m.effectiveTo == null || dayStart(m.effectiveTo).getTime() >= t);
}

/** ActivityLog best-effort — kegagalan log tidak boleh menggagalkan mutasi. */
async function logActivity(
  db: TenantDb,
  data: { action: string; entity: string; entityId?: string | null; employeeId?: string | null; appUserId?: string | null; detail: string },
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        action: data.action,
        entity: data.entity,
        entityId: data.entityId ?? null,
        employeeId: data.employeeId ?? null,
        ...(data.appUserId ? { appUserId: data.appUserId } : {}),
        detail: data.detail,
      },
    });
  } catch {
    // never — audit trail tidak boleh membalikkan mutasi bisnis
  }
}

// ============ daftar polis ============

export interface PolicyRow {
  id: string;
  providerId: string;
  providerCode: string;
  providerName: string;
  kind: string;
  policyNo: string;
  periodStart: string;
  periodEnd: string;
  /** null = vault uang masked (UI menampilkan "••••" + hint brankas). */
  premiumMonthly: number | null;
  premiumMasked: boolean;
  pctCompany: number;
  status: string;
  note: string | null;
  memberCount: number;
  activeMemberCount: number;
  /** sisa hari menuju periodEnd (null bila sudah lewat / tidak relevan). */
  daysToEnd: number | null;
}

/** Daftar polis (join provider) — cari via q (no. polis / provider / catatan).
 *  Premi di-decrypt INTERNAL; serializer mv gate → premiumMonthly null saat
 *  vault terkunci + flag premiumMasked. */
export async function listPolicies(db: TenantDb, q?: string, mv?: MoneyView): Promise<PolicyRow[]> {
  const s = q?.trim().toLowerCase();
  const rows = await db.insurancePolicy.findMany({
    include: {
      provider: { select: { id: true, code: true, name: true, kind: true } },
      members: { select: { effectiveFrom: true, effectiveTo: true } },
    },
    orderBy: [{ status: "asc" }, { periodEnd: "asc" }, { policyNo: "asc" }],
    take: 300,
  });
  const now = dayStart(new Date()).getTime();
  return rows
    .filter((p) =>
      !s
        ? true
        : `${p.policyNo} ${p.provider.name} ${p.provider.code} ${p.note ?? ""}`.toLowerCase().includes(s),
    )
    .map((p) => {
      const active = p.members.filter((m) => memberActiveAt(m)).length;
      const end = dayStart(p.periodEnd).getTime();
      return {
        id: p.id,
        providerId: p.providerId,
        providerCode: p.provider.code,
        providerName: p.provider.name,
        kind: p.provider.kind,
        policyNo: p.policyNo,
        periodStart: isoDate(p.periodStart) ?? "",
        periodEnd: isoDate(p.periodEnd) ?? "",
        // 45-b: mv gate — visible → angka; masked → null + flag (bukan 0).
        premiumMonthly: p.premiumMonthly == null ? null : (mv ? mv.dec(p.premiumMonthly) : null),
        premiumMasked: p.premiumMonthly != null && !(mv?.canSee ?? false),
        pctCompany: p.pctCompany,
        status: p.status,
        note: p.note,
        memberCount: p.members.length,
        activeMemberCount: active,
        daysToEnd: end >= now ? Math.round((end - now) / 86_400_000) : null,
      };
    });
}

// ============ upsert polis ============

export interface UpsertPolicyInput {
  id?: string;
  providerId: string;
  policyNo: string;
  periodStart: string;
  periodEnd: string;
  /** premi bulanan (Rp) — opsional; disimpan TERENKRIPSI vault. */
  premiumMonthly?: number | null;
  /** porsi perusahaan 0–100 (%). */
  pctCompany?: number;
  note?: string | null;
  actor?: PolicyActorRef;
}

/** Buat/ubah polis. Validasi: provider kind INSURANCE + aktif (400),
 *  pctCompany 0–100 (400), periodEnd > periodStart (400), unique
 *  (providerId, policyNo) → 409. Premi tc.encryptMoney; ActivityLog
 *  InsurancePolicy Created/Updated — detail tanpa nominal. */
export async function upsertPolicy(db: TenantDb, input: UpsertPolicyInput): Promise<string> {
  const policyNo = input.policyNo?.trim() ?? "";
  if (!policyNo) throw new PolicyError(400, "Nomor polis wajib diisi");
  if (!input.providerId) throw new PolicyError(400, "Penyedia asuransi wajib dipilih");

  const provider = await db.medicalProvider.findUnique({
    where: { id: input.providerId },
    select: { id: true, code: true, name: true, kind: true, active: true },
  });
  if (!provider) throw new PolicyError(404, "Penyedia asuransi tidak ditemukan");
  if (provider.kind !== "INSURANCE") {
    throw new PolicyError(400, `Provider ${provider.code} bukan perusahaan asuransi (kind ${provider.kind}) — polis grup hanya untuk provider INSURANCE`);
  }
  if (!provider.active) {
    throw new PolicyError(400, `Provider asuransi ${provider.name} tidak aktif — aktifkan dulu di master Rumah Sakit & Asuransi`);
  }

  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new PolicyError(400, "Periode polis tidak valid");
  }
  if (dayStart(periodEnd).getTime() <= dayStart(periodStart).getTime()) {
    throw new PolicyError(400, "Tanggal berakhir polis harus setelah tanggal mulai");
  }

  const pct = input.pctCompany == null ? 100 : Number(input.pctCompany);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new PolicyError(400, "Porsi perusahaan harus 0–100%");
  }
  const premium = input.premiumMonthly == null || Number(input.premiumMonthly) === 0 ? null : Number(input.premiumMonthly);
  if (premium != null && (!Number.isFinite(premium) || premium < 0)) {
    throw new PolicyError(400, "Premi bulanan tidak valid (harus ≥ 0)");
  }

  // unique (providerId, policyNo) — termasuk saat edit (pindah no. ke yang dipakai polis lain).
  const clash = await db.insurancePolicy.findFirst({
    where: { providerId: input.providerId, policyNo, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) throw new PolicyError(409, `No. polis ${policyNo} sudah terdaftar pada provider ${provider.name}`);

  // vault: uang disimpan TERENKRIPSI (enc:v1|v2:n:…) — null tetap null.
  const tc = tenantCryptoForDb(db);
  const premiumStored = premium == null ? null : tc.encryptMoney(premium) ?? String(premium);
  const note = input.note?.toString().trim() || null;

  if (input.id) {
    const existing = await db.insurancePolicy.findUnique({ where: { id: input.id }, select: { id: true } });
    if (!existing) throw new PolicyError(404, "Polis tidak ditemukan");
    await db.insurancePolicy.update({
      where: { id: input.id },
      data: {
        providerId: input.providerId,
        policyNo,
        periodStart: dayStart(periodStart),
        periodEnd: dayStart(periodEnd),
        premiumMonthly: premiumStored,
        pctCompany: pct,
        note,
      },
    });
    await logActivity(db, {
      action: "Updated", entity: "InsurancePolicy", entityId: input.id,
      appUserId: input.actor?.appUserId ?? null,
      // TANPA nominal — pelajaran audit Performance (identitas cukup).
      detail: `Polis ${policyNo} provider ${provider.code} diubah (periode ${isoDate(periodStart)} → ${isoDate(periodEnd)}, porsi perusahaan ${pct}%)${input.actor?.name ? ` oleh ${input.actor.name}` : ""}`,
    });
    return input.id;
  }

  const created = await db.insurancePolicy.create({
    data: {
      providerId: input.providerId,
      policyNo,
      periodStart: dayStart(periodStart),
      periodEnd: dayStart(periodEnd),
      premiumMonthly: premiumStored,
      pctCompany: pct,
      note,
    },
    select: { id: true },
  });
  await logActivity(db, {
    action: "Created", entity: "InsurancePolicy", entityId: created.id,
    appUserId: input.actor?.appUserId ?? null,
    detail: `Polis ${policyNo} provider ${provider.code} dibuat (periode ${isoDate(periodStart)} → ${isoDate(periodEnd)}, porsi perusahaan ${pct}%)${input.actor?.name ? ` oleh ${input.actor.name}` : ""}`,
  });
  return created.id;
}

// ============ terminasi polis ============

/** Akhiri polis: status → "Terminated" + tutup SEMUA membership terbuka
 *  (effectiveTo = hari ini). ActivityLog Updated. */
export async function terminatePolicy(
  db: TenantDb,
  input: { id: string; note?: string | null; actor?: PolicyActorRef },
): Promise<{ id: string; membershipsClosed: number }> {
  const policy = await db.insurancePolicy.findUnique({
    where: { id: input.id },
    include: { provider: { select: { code: true, name: true } } },
  });
  if (!policy) throw new PolicyError(404, "Polis tidak ditemukan");
  if (policy.status === "Terminated") {
    throw new PolicyError(409, `Polis ${policy.policyNo} sudah dihentikan sebelumnya`);
  }
  const today = dayStart(new Date());
  await db.insurancePolicy.update({
    where: { id: policy.id },
    data: { status: "Terminated", note: input.note?.toString().trim() || policy.note },
  });
  const open = await db.policyMember.findMany({
    where: { policyId: policy.id, effectiveTo: null },
    select: { id: true },
  });
  for (const m of open) {
    await db.policyMember.update({ where: { id: m.id }, data: { effectiveTo: today } });
  }
  await logActivity(db, {
    action: "Updated", entity: "InsurancePolicy", entityId: policy.id,
    appUserId: input.actor?.appUserId ?? null,
    detail:
      `Polis ${policy.policyNo} provider ${policy.provider.code} DIHENTIKAN — ${open.length} membership terbuka ditutup efektif ${isoDate(today)}` +
      `${input.note?.trim() ? ` (catatan: ${input.note.trim()})` : ""}${input.actor?.name ? ` oleh ${input.actor.name}` : ""}`,
  });
  return { id: policy.id, membershipsClosed: open.length };
}

// ============ enrollment ============

export interface EnrollMemberInput {
  policyId: string;
  employeeId: string;
  /** opsional — EmployeeFamily MILIK employee (validasi). */
  dependentId?: string | null;
  effectiveFrom: string;
  actor?: PolicyActorRef;
}

/** Enroll karyawan (± dependen) ke polis. Validasi: polis Aktif + periode polis
 *  meng-cover tanggal efektif; karyawan status Active; dependen milik karyawan
 *  + isDependent; bentrok unique / membership aktif sama → 409. */
export async function enrollMember(db: TenantDb, input: EnrollMemberInput): Promise<string> {
  const policy = await db.insurancePolicy.findUnique({
    where: { id: input.policyId },
    include: { provider: { select: { code: true, name: true } } },
  });
  if (!policy) throw new PolicyError(404, "Polis tidak ditemukan");
  if (policy.status !== "Active") {
    throw new PolicyError(400, `Polis ${policy.policyNo} berstatus ${policy.status} — enrollment hanya untuk polis Active`);
  }
  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) throw new PolicyError(400, "Tanggal efektif tidak valid");
  const from = dayStart(effectiveFrom);
  if (from.getTime() < dayStart(policy.periodStart).getTime() || from.getTime() > dayStart(policy.periodEnd).getTime()) {
    throw new PolicyError(
      400,
      `Tanggal efektif ${isoDate(from)} di luar periode polis ${policy.policyNo} (${isoDate(policy.periodStart)} → ${isoDate(policy.periodEnd)})`,
    );
  }

  const emp = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNo: true, fullName: true, status: true },
  });
  if (!emp) throw new PolicyError(404, "Karyawan tidak ditemukan");
  if (emp.status !== "Active") {
    throw new PolicyError(400, `Karyawan ${emp.employeeNo} berstatus ${emp.status} — hanya karyawan Active yang bisa di-enroll`);
  }

  let dep: { id: string; name: string; relation: string } | null = null;
  if (input.dependentId) {
    const fam = await db.employeeFamily.findUnique({
      where: { id: input.dependentId },
      select: { id: true, name: true, relation: true, employeeId: true, isDependent: true },
    });
    if (!fam) throw new PolicyError(404, "Anggota keluarga tidak ditemukan");
    if (fam.employeeId !== input.employeeId) {
      throw new PolicyError(400, `Anggota keluarga ${fam.name} bukan tanggungan karyawan ${emp.employeeNo} — pilih dependen milik karyawan yang di-enroll`);
    }
    if (!fam.isDependent) {
      throw new PolicyError(400, `${fam.name} tidak berstatus tanggungan (isDependent) pada data keluarga karyawan`);
    }
    dep = { id: fam.id, name: fam.name, relation: fam.relation };
  }

  // dedupe: membership AKTIF yang sama (karyawan ± dependen) di polis ini → 409.
  // (unique DB [policyId, employeeId, dependentId, effectiveFrom] tidak menahan
  // dependentId NULL — NULL dianggap berbeda oleh Postgres → cek eksplisit.)
  const activeSame = await db.policyMember.findFirst({
    where: {
      policyId: policy.id,
      employeeId: emp.id,
      dependentId: input.dependentId ?? null,
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
    },
    select: { id: true },
  });
  if (activeSame) {
    throw new PolicyError(
      409,
      `${emp.employeeNo}${dep ? `+${dep.relation}` : ""} sudah terdaftar aktif di polis ${policy.policyNo} — akhiri membership dulu bila ingin mendaftar ulang`,
    );
  }

  let createdId: string;
  try {
    const created = await db.policyMember.create({
      data: { policyId: policy.id, employeeId: emp.id, dependentId: input.dependentId ?? null, effectiveFrom: from },
      select: { id: true },
    });
    createdId = created.id;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      throw new PolicyError(409, `Enrollment ${emp.employeeNo}${dep ? `+${dep.relation}` : ""} pada tanggal efektif sama sudah ada di polis ${policy.policyNo}`);
    }
    throw e;
  }
  await logActivity(db, {
    action: "Created", entity: "PolicyMember", entityId: createdId,
    employeeId: emp.id,
    appUserId: input.actor?.appUserId ?? null,
    detail:
      `Enrollment ${emp.employeeNo}${dep ? `+${dep.relation} (${dep.name})` : ""} ke polis ${policy.policyNo} provider ${policy.provider.code} efektif ${isoDate(from)}` +
      `${input.actor?.name ? ` oleh ${input.actor.name}` : ""}`,
  });
  return createdId;
}

// ============ akhiri membership ============

/** Akhiri SATU membership (effectiveTo diisi) — ActivityLog Updated. */
export async function endMembership(
  db: TenantDb,
  input: { id: string; effectiveTo: string; actor?: PolicyActorRef },
): Promise<{ id: string }> {
  const m = await db.policyMember.findUnique({
    where: { id: input.id },
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true } },
      dependent: { select: { id: true, name: true, relation: true } },
      policy: { select: { id: true, policyNo: true } },
    },
  });
  if (!m) throw new PolicyError(404, "Membership tidak ditemukan");
  const to = dayStart(new Date(input.effectiveTo));
  if (Number.isNaN(to.getTime())) throw new PolicyError(400, "Tanggal berakhir tidak valid");
  if (to.getTime() < dayStart(m.effectiveFrom).getTime()) {
    throw new PolicyError(400, "Tanggal berakhir membership tidak boleh sebelum tanggal efektifnya");
  }
  await db.policyMember.update({ where: { id: m.id }, data: { effectiveTo: to } });
  await logActivity(db, {
    action: "Updated", entity: "PolicyMember", entityId: m.id,
    employeeId: m.employee.id,
    appUserId: input.actor?.appUserId ?? null,
    detail:
      `Membership polis ${m.policy.policyNo} (${m.employee.employeeNo}${m.dependent ? `+${m.dependent.relation}` : ""}) diakhiri efektif ${isoDate(to)}` +
      `${input.actor?.name ? ` oleh ${input.actor.name}` : ""}`,
  });
  return { id: m.id };
}

// ============ daftar anggota ============

export interface PolicyMemberRow {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  employeeStatus: string;
  dependentId: string | null;
  dependentName: string | null;
  dependentRelation: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  policyId: string;
  policyNo: string;
  policyPeriodStart: string;
  policyPeriodEnd: string;
}

/** Daftar anggota polis — join employee (no/nama/status) + dependen (nama,
 *  hubungan) + periode polis. */
export async function listMembers(db: TenantDb, input: { policyId: string }): Promise<PolicyMemberRow[]> {
  const rows = await db.policyMember.findMany({
    where: { policyId: input.policyId },
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true, status: true } },
      dependent: { select: { id: true, name: true, relation: true } },
      policy: { select: { policyNo: true, periodStart: true, periodEnd: true } },
    },
    orderBy: [{ employee: { employeeNo: "asc" } }, { dependent: { name: "asc" } }, { effectiveFrom: "desc" }],
    take: 500,
  });
  return rows.map((m) => ({
    id: m.id,
    employeeId: m.employee.id,
    employeeNo: m.employee.employeeNo,
    employeeName: m.employee.fullName,
    employeeStatus: m.employee.status,
    dependentId: m.dependentId,
    dependentName: m.dependent?.name ?? null,
    dependentRelation: m.dependent?.relation ?? null,
    effectiveFrom: isoDate(m.effectiveFrom) ?? "",
    effectiveTo: isoDate(m.effectiveTo),
    active: memberActiveAt(m),
    policyId: m.policyId,
    policyNo: m.policy.policyNo,
    policyPeriodStart: isoDate(m.policy.periodStart) ?? "",
    policyPeriodEnd: isoDate(m.policy.periodEnd) ?? "",
  }));
}

// ============ laporan premi ============

export interface PremiumRow {
  policyId: string;
  policyNo: string;
  providerName: string;
  memberId: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  dependentId: string | null;
  dependentName: string | null;
  dependentRelation: string | null;
  /** "Karyawan" | "Dependen". */
  memberKind: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** null = vault masked. */
  premiumPerMember: number | null;
  companyShare: number | null;
  employeeShare: number | null;
}

export interface PremiumRekap {
  policyId: string;
  policyNo: string;
  providerName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  pctCompany: number;
  activeMembers: number;
  /** gated — null saat vault masked. */
  premiumMonthly: number | null;
  totalAllocated: number | null;
  totalCompany: number | null;
  totalEmployee: number | null;
  masked: boolean;
}

/** Laporan premi per membership aktif + rekap per policy.
 *  Aritmetika INTERNAL (raw decryptMoney — pola engine, bukan mv): premi per
 *  anggota = premiumMonthly / anggota aktif (dibulatkan); porsi perusahaan =
 *  × pctCompany%; porsi karyawan = sisanya. Serializer mv gate → null + masked. */
export async function premiumReport(
  db: TenantDb,
  input: { policyId?: string },
  mv?: MoneyView,
): Promise<{ rows: PremiumRow[]; rekap: PremiumRekap[] }> {
  const policies = await db.insurancePolicy.findMany({
    where: input.policyId ? { id: input.policyId } : { status: "Active" },
    include: {
      provider: { select: { name: true } },
      members: {
        include: {
          employee: { select: { id: true, employeeNo: true, fullName: true } },
          dependent: { select: { id: true, name: true, relation: true } },
        },
        orderBy: [{ employee: { employeeNo: "asc" } }, { dependent: { name: "asc" } }],
      },
    },
    orderBy: { policyNo: "asc" },
    take: 100,
  });
  const canSee = mv?.canSee ?? false;
  const tc = tenantCryptoForDb(db);
  const rows: PremiumRow[] = [];
  const rekap: PremiumRekap[] = [];
  for (const p of policies) {
    const activeMembers = p.members.filter((m) => memberActiveAt(m));
    // raw decrypt — kalkulasi internal engine (bukan tampilan).
    const premiumRaw = p.premiumMonthly == null ? 0 : tc.decryptMoney(p.premiumMonthly) ?? 0;
    const perMember = activeMembers.length > 0 ? Math.round(premiumRaw / activeMembers.length) : 0;
    const companyPer = Math.round((perMember * p.pctCompany) / 100);
    for (const m of activeMembers) {
      rows.push({
        policyId: p.id,
        policyNo: p.policyNo,
        providerName: p.provider.name,
        memberId: m.id,
        employeeId: m.employee.id,
        employeeNo: m.employee.employeeNo,
        employeeName: m.employee.fullName,
        dependentId: m.dependentId,
        dependentName: m.dependent?.name ?? null,
        dependentRelation: m.dependent?.relation ?? null,
        memberKind: m.dependentId ? "Dependen" : "Karyawan",
        effectiveFrom: isoDate(m.effectiveFrom) ?? "",
        effectiveTo: isoDate(m.effectiveTo),
        premiumPerMember: canSee ? perMember : null,
        companyShare: canSee ? companyPer : null,
        employeeShare: canSee ? perMember - companyPer : null,
      });
    }
    const totalCompany = companyPer * activeMembers.length;
    rekap.push({
      policyId: p.id,
      policyNo: p.policyNo,
      providerName: p.provider.name,
      periodStart: isoDate(p.periodStart) ?? "",
      periodEnd: isoDate(p.periodEnd) ?? "",
      status: p.status,
      pctCompany: p.pctCompany,
      activeMembers: activeMembers.length,
      premiumMonthly: canSee ? (p.premiumMonthly == null ? null : premiumRaw) : null,
      totalAllocated: canSee ? perMember * activeMembers.length : null,
      totalCompany: canSee ? totalCompany : null,
      totalEmployee: canSee ? perMember * activeMembers.length - totalCompany : null,
      masked: !canSee,
    });
  }
  return { rows, rekap };
}

// ============ hook terminasi karyawan (EXPORT — dipakai PA + job) ============

/** Akhiri SEMUA membership polis terbuka seorang karyawan pada tanggal efektif
 *  pengakhiran — dipakai hook post-commit Personnel Action (pola settlement:
 *  best-effort, kegagalan TIDAK menggagalkan PA) + sweep scheduler
 *  jobPolicyMemberExpiry. ActivityLog per baris Updated. */
export async function terminatePolicyMemberships(
  db: TenantDb,
  input: { employeeId: string; effectiveDate: Date | string; actorName?: string | null },
): Promise<number> {
  const to = dayStart(input.effectiveDate);
  const open = await db.policyMember.findMany({
    where: { employeeId: input.employeeId, effectiveTo: null },
    include: {
      employee: { select: { employeeNo: true } },
      dependent: { select: { relation: true } },
      policy: { select: { policyNo: true, provider: { select: { code: true } } } },
    },
    take: 200,
  });
  let closed = 0;
  for (const m of open) {
    try {
      await db.policyMember.update({ where: { id: m.id }, data: { effectiveTo: to } });
      closed++;
      await logActivity(db, {
        action: "Updated", entity: "PolicyMember", entityId: m.id,
        employeeId: input.employeeId,
        detail:
          `Membership polis ${m.policy.policyNo} provider ${m.policy.provider.code} (${m.employee.employeeNo}${m.dependent ? `+${m.dependent.relation}` : ""}) ` +
          `diakhiri (karyawan keluar) efektif ${isoDate(to)}${input.actorName ? ` — via ${input.actorName}` : ""}`,
      });
    } catch {
      // best-effort per baris — baris lain tetap diproses
    }
  }
  return closed;
}
