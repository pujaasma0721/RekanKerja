import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { DEFAULT_PASSWORD_POLICY, validatePassword, type PasswordPolicyData } from "@/rekankerja/shared/lib/password-policy";
import { getTenantPolicy } from "@/rekankerja/shared/services/password-security";

// ============ KEBIJAKAN KATA SANDI (Task 33) ============
// GET  — baca kebijakan aktif (self-heal: seed default bila belum ada)
// PUT  — simpan kebijakan (admin; guard aksi update menu settings:security)
// POST — UJI Coba: validasi sebuah kata sandi terhadap kebijakan saat ini
//        (tanpa menyimpan apa pun — dipakai panel "Uji Coba" & dialog).

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parsePolicyBody(b: Record<string, unknown>): Partial<PasswordPolicyData> {
  const p: Partial<PasswordPolicyData> = {};
  if (b.minLength !== undefined) p.minLength = clampInt(b.minLength, 4, 256, DEFAULT_PASSWORD_POLICY.minLength);
  if (b.maxLength !== undefined) p.maxLength = clampInt(b.maxLength, 8, 256, DEFAULT_PASSWORD_POLICY.maxLength);
  if (b.minUniqueChars !== undefined) p.minUniqueChars = clampInt(b.minUniqueChars, 0, 64, DEFAULT_PASSWORD_POLICY.minUniqueChars);
  if (b.maxRepeated !== undefined) p.maxRepeated = clampInt(b.maxRepeated, 0, 64, DEFAULT_PASSWORD_POLICY.maxRepeated);
  if (b.maxSequential !== undefined) p.maxSequential = clampInt(b.maxSequential, 0, 64, DEFAULT_PASSWORD_POLICY.maxSequential);
  if (b.lifetimeDays !== undefined) p.lifetimeDays = clampInt(b.lifetimeDays, 0, 3650, DEFAULT_PASSWORD_POLICY.lifetimeDays);
  if (b.warnDays !== undefined) p.warnDays = clampInt(b.warnDays, 0, 90, DEFAULT_PASSWORD_POLICY.warnDays);
  if (b.historyCount !== undefined) p.historyCount = clampInt(b.historyCount, 0, 24, DEFAULT_PASSWORD_POLICY.historyCount);
  if (b.maxFailedAttempts !== undefined) p.maxFailedAttempts = clampInt(b.maxFailedAttempts, 0, 20, DEFAULT_PASSWORD_POLICY.maxFailedAttempts);
  if (b.lockoutMinutes !== undefined) p.lockoutMinutes = clampInt(b.lockoutMinutes, 0, 1440, DEFAULT_PASSWORD_POLICY.lockoutMinutes);
  // Task 64k — idle timeout sesi: 0 = nonaktif; maksimum 8 jam (480 menit).
  if (b.idleTimeoutMinutes !== undefined) p.idleTimeoutMinutes = clampInt(b.idleTimeoutMinutes, 0, 480, DEFAULT_PASSWORD_POLICY.idleTimeoutMinutes);
  for (const k of ["requireUppercase", "requireLowercase", "requireNumber", "requireSpecial", "blockUsername", "blockName", "blockCommon"] as const) {
    if (b[k] !== undefined) p[k] = Boolean(b[k]);
  }
  return p;
}

// GET — kebijakan aktif
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const policy = await getTenantPolicy(db);
    return NextResponse.json({ policy });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PUT — simpan kebijakan
export async function PUT(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:security", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = parsePolicyBody(b);

    // keabsahan lintas-field
    if (patch.minLength != null && patch.maxLength != null && patch.minLength > patch.maxLength) {
      return NextResponse.json({ error: "Panjang minimum tidak boleh melebihi panjang maksimum" }, { status: 400 });
    }
    if (patch.warnDays != null && patch.lifetimeDays != null && patch.lifetimeDays > 0 && patch.warnDays > patch.lifetimeDays) {
      return NextResponse.json({ error: "Masa peringatan tidak boleh melebihi masa berlaku kata sandi" }, { status: 400 });
    }

    await db.passwordPolicy.updateMany({ where: { active: true }, data: { active: false } });
    const saved = await db.passwordPolicy.create({
      data: { active: true, ...patch, updatedById: m.actor.appUserId ?? null },
    });
    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "PasswordPolicy", entityId: saved.id,
        detail: `Kebijakan kata sandi diperbarui oleh ${m.actor.name}`,
      },
    });
    const policy = { ...DEFAULT_PASSWORD_POLICY, ...saved } as PasswordPolicyData;
    return NextResponse.json({ policy });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — uji coba kata sandi terhadap kebijakan saat ini (tanpa menyimpan)
export async function POST(req: NextRequest | Request) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const password = String(b.password ?? "");
    const policy = await getTenantPolicy(db);
    const v = validatePassword(policy, password, {
      username: b.username ? String(b.username) : null,
      fullName: b.fullName ? String(b.fullName) : null,
      email: b.email ? String(b.email) : null,
    });
    return NextResponse.json({ ok: v.ok, checks: v.checks, errors: v.errors });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
