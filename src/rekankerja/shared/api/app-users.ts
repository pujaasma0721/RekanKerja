import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { readSessionCookie } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { validatePassword } from "@/rekankerja/shared/lib/password-policy";
import { getTenantPolicy, checkPasswordHistory, recordPasswordSet } from "@/rekankerja/shared/services/password-security";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET — users + access groups (passwordChangedAt & umur sandi utk tabel Pengguna)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const users = await db.appUser.findMany({
      include: { accessGroups: { include: { accessGroup: { select: { name: true, code: true } } } } },
      orderBy: { username: "asc" },
    });
    const groups = await db.accessGroup.findMany({
      include: { members: { include: { appUser: { select: { id: true, fullName: true, role: true } } } } },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id, username: u.username, fullName: u.fullName, email: u.email,
        role: u.role, active: u.active, lastLogin: u.lastLogin,
        employeeId: u.employeeId,
        passwordChangedAt: u.passwordChangedAt,
        groups: u.accessGroups.map((m) => m.accessGroup),
      })),
      groups: groups.map((g) => ({
        id: g.id, code: g.code, name: g.name, description: g.description,
        modules: JSON.parse(g.modulesJson) as { module: string; view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean }[],
        members: g.members.map((m) => ({ id: m.appUser.id, fullName: m.appUser.fullName, role: m.appUser.role, isApprover: m.isApprover })),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — TAMBAH PENGGUNA (Task 33): AppUser + akun login platform (email+sandi
// tervalidasi kebijakan) + riwayat sandi + umur. Guard aksi create menu security.
export async function POST(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:security", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const username = String(b.username ?? "").trim();
    const fullName = String(b.fullName ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");

    if (!username || !fullName) return NextResponse.json({ error: "Username & nama wajib diisi" }, { status: 400 });
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Email wajib diisi dengan format valid (untuk login)" }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Kata sandi awal wajib diisi" }, { status: 400 });

    // validasi kebijakan kata sandi (kompleksitas lengkap)
    const policy = await getTenantPolicy(db);
    const v = validatePassword(policy, password, { username, fullName, email });
    if (!v.ok) {
      return NextResponse.json(
        { error: "Kata sandi belum memenuhi kebijakan:", details: v.errors },
        { status: 400 },
      );
    }

    // keunikan di tenant
    const exists = await db.appUser.findUnique({ where: { username } });
    if (exists) return NextResponse.json({ error: `Username ${username} sudah dipakai` }, { status: 400 });
    const emailTaken = await db.appUser.findFirst({ where: { email } });
    if (emailTaken) return NextResponse.json({ error: `Email ${email} sudah dipakai pengguna lain di workspace ini` }, { status: 400 });

    // email tidak boleh menimpa akun platform orang lain (sandi mereka tidak diutak-atik)
    const platformUser = await platformDb.user.findUnique({ where: { email }, select: { id: true } });
    if (platformUser) {
      return NextResponse.json(
        { error: `Email ${email} sudah terdaftar sebagai akun SaaS — gunakan email lain (sandi akun terdaftar tidak boleh ditimpa).` },
        { status: 400 },
      );
    }

    // buat AppUser tenant
    const user = await db.appUser.create({
      data: {
        username, fullName, email,
        role: b.role ?? "Viewer",
        employeeId: b.employeeId ? String(b.employeeId) : null,
        active: b.active !== false,
        passwordChangedAt: new Date(),
        ...(b.accessGroupId ? { accessGroups: { create: { accessGroupId: b.accessGroupId } } } : {}),
      },
    });

    // akun login platform + membership + riwayat + umur
    const payload = readSessionCookie(req);
    await recordPasswordSet({
      db, appUserId: user.id, email, newPassword: password,
      setByAppUserId: m.actor.appUserId ?? null,
      appRole: user.role, fullName, tenantId: payload?.tid ?? null,
    });

    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Created", entity: "AppUser", entityId: user.id,
        detail: `Pengguna ${user.username} (${fullName}) dibuat — akun login ${email} dengan kata sandi tervalidasi kebijakan`,
      },
    });
    // ===== Notifikasi email otomatis (Task 34) — kirim kredensial ke user baru =====
    void (async () => {
      try {
        notifyEmailEvent(db, {
          event: "user.created",
          to: [{ email, name: fullName }],
          data: { nama: fullName, email, password },
        });
      } catch { /* never */ }
    })();

    return NextResponse.json(
      { user: { ...user, passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null } },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — ubah user & RESET KATA SANDI (password) dengan kebijakan + riwayat.
export async function PATCH(req: Request) {
  try {
    const b = await req.json();
    // guard: reset sandi = aksi update menu security (route yang sama dipakai edit biasa)
    const m = await requireMenuAction(req, "settings:security", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const current = await db.appUser.findUnique({ where: { id: b.id } });
    if (!current) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

    // ---- RESET KATA SANDI ----
    if (b.password !== undefined) {
      const password = String(b.password ?? "");
      if (!password) return NextResponse.json({ error: "Kata sandi baru wajib diisi" }, { status: 400 });
      if (!current.email) return NextResponse.json({ error: "Pengguna tanpa email — tidak punya akun login untuk direset" }, { status: 400 });

      const policy = await getTenantPolicy(db);
      const v = validatePassword(policy, password, {
        username: current.username, fullName: b.fullName ?? current.fullName, email: current.email,
      });
      if (!v.ok) {
        return NextResponse.json({ error: "Kata sandi baru belum memenuhi kebijakan:", details: v.errors }, { status: 400 });
      }

      // riwayat: tidak boleh sama dengan N sandi terakhir
      const history = await checkPasswordHistory(db, current.id, password, policy.historyCount);
      if (!history.ok) {
        return NextResponse.json(
          {
            error: `Kata sandi baru sama dengan kata sandi lama Anda (riwayat ke-${history.matchedIndex}) — tidak boleh sama dengan ${policy.historyCount} kata sandi terakhir.`,
          },
          { status: 400 },
        );
      }

      const payload = readSessionCookie(req);
      await recordPasswordSet({
        db, appUserId: current.id, email: current.email, newPassword: password,
        setByAppUserId: m.actor.appUserId ?? null,
        appRole: b.role ?? current.role,
        fullName: b.fullName ?? current.fullName,
        tenantId: payload?.tid ?? null,
      });
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? null,
          action: "ResetPassword", entity: "AppUser", entityId: current.id,
          detail: `Kata sandi ${current.username} direset oleh ${m.actor.name} (divalidasi kebijakan + riwayat)`,
        },
      });
      return NextResponse.json({ user: current, passwordReset: true });
    }

    // ---- EDIT BIASA (nama/email/role/status/employee) ----
    let newEmail = current.email;
    if (b.email !== undefined && b.email !== null && b.email !== current.email) {
      const email = String(b.email).trim().toLowerCase();
      if (email && !EMAIL_RE.test(email)) return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
      if (email) {
        const taken = await db.appUser.findFirst({ where: { email, id: { not: current.id } } });
        if (taken) return NextResponse.json({ error: `Email ${email} sudah dipakai pengguna lain` }, { status: 400 });
        const platformTaken = await platformDb.user.findUnique({ where: { email }, select: { id: true } });
        if (platformTaken) return NextResponse.json({ error: `Email ${email} sudah terdaftar akun SaaS lain` }, { status: 400 });
      }
      newEmail = email || null;
      // best-effort: sinkronkan email akun platform lama agar tautan login tetap
      if (current.email) {
        const pu = await platformDb.user.findUnique({ where: { email: current.email } });
        if (pu) {
          if (newEmail) {
            await platformDb.user.update({ where: { id: pu.id }, data: { email: newEmail } }).catch(() => {});
          } else {
            await platformDb.user.update({ where: { id: pu.id }, data: { name: b.fullName ?? current.fullName } }).catch(() => {});
          }
        }
      }
    }

    const user = await db.appUser.update({
      where: { id: b.id },
      data: {
        fullName: b.fullName ?? undefined,
        email: newEmail,
        role: b.role ?? undefined,
        active: b.active ?? undefined,
        employeeId: b.employeeId !== undefined ? (b.employeeId ? String(b.employeeId) : null) : undefined,
        ...(b.accessGroupId !== undefined && b.accessGroupId
          ? { accessGroups: { deleteMany: {}, create: { accessGroupId: b.accessGroupId } } }
          : b.accessGroupId === "" ? { accessGroups: { deleteMany: {} } } : {}),
      },
    });
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE ?id= — guard aksi delete; minimal satu user tersisa.
export async function DELETE(req: Request) {
  try {
    const m = await requireMenuAction(req, "settings:security", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const target = await db.appUser.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
    if (target.role === "Admin") {
      return NextResponse.json({ error: "Pengguna super admin (role Admin) tidak boleh dihapus dari sini" }, { status: 400 });
    }
    const count = await db.appUser.count();
    if (count <= 1) return NextResponse.json({ error: "Minimal satu user harus tersisa" }, { status: 400 });
    await db.appUser.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Deleted", entity: "AppUser", entityId: id,
        detail: `Pengguna ${target.username} dihapus oleh ${m.actor.name} (akun login platform dipertahankan)`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
