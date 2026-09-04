import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { readSessionCookie, verifyPassword, hashPassword } from "@/onevity/shared/lib/auth";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { validatePassword } from "@/onevity/shared/lib/password-policy";
import { getTenantPolicy, checkPasswordHistory, recordPasswordSet } from "@/onevity/shared/services/password-security";

// POST /api/auth/change-password { currentPassword, newPassword } ==========
// Ganti kata sandi SENDIRI (self-service): verifikasi sandi saat ini, sandi
// baru divalidasi KEBIJAKAN tenant + tidak boleh sama riwayat N terakhir.
// Sesi dipakai utk identitas (uid) & tenant (tid) — policy dari workspace
// aktif (fallback workspace pertama).
export async function POST(req: NextRequest) {
  try {
    const payload = readSessionCookie(req);
    if (!payload?.uid) {
      return NextResponse.json({ error: "Sesi tidak valid — silakan masuk kembali." }, { status: 401 });
    }

    const b = await req.json().catch(() => ({}));
    const currentPassword = String(b.currentPassword ?? "");
    const newPassword = String(b.newPassword ?? "");
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Kata sandi saat ini & kata sandi baru wajib diisi" }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "Kata sandi baru tidak boleh sama dengan kata sandi saat ini" }, { status: 400 });
    }

    const user = await platformDb.user.findUnique({ where: { id: payload.uid } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json({ error: "Kata sandi saat ini salah" }, { status: 401 });
    }

    // tenant konteks: session tid bila valid, selain itu workspace pertama
    let schemaName: string | null = null;
    if (payload.tid) {
      const m = await platformDb.userTenant.findFirst({
        where: { userId: payload.uid, tenantId: payload.tid },
        select: { tenant: { select: { schemaName: true, status: true } } },
      });
      schemaName = m?.tenant.status === "ACTIVE" ? m.tenant.schemaName : null;
    }
    if (!schemaName) {
      const first = await platformDb.userTenant.findFirst({
        where: { userId: payload.uid, tenant: { status: "ACTIVE" } },
        select: { tenant: { select: { schemaName: true } } },
        orderBy: { createdAt: "asc" },
      });
      schemaName = first?.tenant.schemaName ?? null;
    }

    // AppUser tenant (utk username/nama utk aturan block + riwayat + umur)
    const db = schemaName ? getTenantClient(schemaName) : null;
    const appUser = db
      ? await db.appUser.findFirst({ where: { email: user.email } }).catch(() => null)
      : null;

    const policy = db ? await getTenantPolicy(db) : null;
    const v = validatePassword(policy ?? {}, newPassword, {
      username: appUser?.username ?? null,
      fullName: appUser?.fullName ?? user.name,
      email: user.email,
    });
    if (!v.ok) {
      return NextResponse.json({ error: "Kata sandi baru belum memenuhi kebijakan:", details: v.errors }, { status: 400 });
    }

    // riwayat N terakhir (tenant)
    if (db && appUser) {
      const history = await checkPasswordHistory(db, appUser.id, newPassword, policy?.historyCount ?? 6);
      if (!history.ok) {
        return NextResponse.json(
          {
            error: `Kata sandi baru sama dengan kata sandi lama Anda (riwayat ke-${history.matchedIndex}) — tidak boleh sama dengan ${policy?.historyCount ?? 6} kata sandi terakhir.`,
          },
          { status: 400 },
        );
      }
    }

    // perbarui hash platform (langsung — identitas sudah terverifikasi) + meta tenant
    await platformDb.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword), failedAttempts: 0, lockedUntil: null },
    });
    if (db && appUser) {
      try {
        await recordPasswordSet({
          db, appUserId: appUser.id, email: user.email, newPassword,
          setByAppUserId: null, appRole: appUser.role, fullName: appUser.fullName,
          tenantId: payload.tid,
        });
      } catch {
        // meta tenant gagal → sandi platform tetap sudah berganti
      }
    }

    return NextResponse.json({ ok: true, message: "Kata sandi berhasil diganti" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
