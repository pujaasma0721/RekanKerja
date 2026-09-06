import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, freshSessionToken, sessionCookieOptions, hashPassword, buildSessionInfo, currentSessionVersion,
} from "@/onevity/shared/lib/auth";
import { provisionTenantSchema, seedTenantReference, slugify, schemaNameForSlug, uniqueSlug } from "@/onevity/shared/lib/provisioning";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { validatePassword } from "@/onevity/shared/lib/password-policy";

// POST /api/auth/register — daftar + BUAT WORKSPACE BARU (self-service SaaS):
// validasi → slug unik → provision schema PostgreSQL tenant_<slug> (DDL + seed referensi)
// → Tenant + User(owner) + UserTenant → session cookie.
// Task 33: kata sandi owner baru divalidasi KEBIJAKAN DEFAULT (kompleksitas
// lengkap — sama aturan dengan menu Keamanan & Akses).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const workspaceName = String(b.workspaceName ?? "").trim();
    const fullName = String(b.fullName ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");

    if (workspaceName.length < 3) return NextResponse.json({ error: "Nama workspace minimal 3 karakter" }, { status: 400 });
    if (fullName.length < 2) return NextResponse.json({ error: "Nama lengkap wajib diisi" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
    const pv = validatePassword({}, password, { username: email.split("@")[0], fullName, email });
    if (!pv.ok) {
      return NextResponse.json({ error: `Kata sandi belum memenuhi syarat: ${pv.errors.join("; ")}` }, { status: 400 });
    }

    const clash = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "Email sudah terdaftar — silakan masuk" }, { status: 400 });

    const slug = await uniqueSlug(slugify(workspaceName));
    const schemaName = schemaNameForSlug(slug);

    // 1) schema PostgreSQL + tabel + referensi (komponen gaji, pajak, TER, akun, benefit)
    await provisionTenantSchema(schemaName);
    try {
      await seedTenantReference(getTenantClient(schemaName));
    } catch (e) {
      // seed gagal → drop schema agar tidak setengah jadi
      const { Client } = await import("pg");
      const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL });
      await c.connect();
      await c.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await c.end();
      throw e;
    }

    // 2) registry platform
    const tenant = await db.tenant.create({ data: { name: workspaceName, slug, schemaName } });
    const user = await db.user.create({
      data: { email, name: fullName, passwordHash: hashPassword(password) },
    });
    await db.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });

    const info = (await buildSessionInfo(user.id, tenant.id))!;
    const res = NextResponse.json(info, { status: 201 });
    // T1-SECURITY: token membawa sessionVersion (user baru = 0, dibaca utk aman).
    const sv = await currentSessionVersion(user.id);
    res.cookies.set(SESSION_COOKIE, freshSessionToken(user.id, tenant.id, sv), sessionCookieOptions());
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
