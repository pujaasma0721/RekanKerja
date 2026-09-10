import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, freshSessionToken, sessionCookieOptions, hashPassword, buildSessionInfo, currentSessionVersion,
} from "@/onevity/shared/lib/auth";
import { provisionTenantSchema, seedTenantReference, slugify, schemaNameForSlug, uniqueSlug } from "@/onevity/shared/lib/provisioning";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { validatePassword } from "@/onevity/shared/lib/password-policy";
import { hitRateLimit } from "@/onevity/shared/lib/rate-limit";

// M-3 (audit 42) — rate limit pendaftaran self-service (anti spam tenant):
// 5 percobaan / 15 menit per IP klien + 3 / jam per email. In-memory per
// instance (lihat catatan kapasitas di shared/lib/rate-limit.ts).
const REGISTER_IP_LIMIT = 5;
const REGISTER_IP_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_EMAIL_LIMIT = 3;
const REGISTER_EMAIL_WINDOW_MS = 60 * 60 * 1000;

/** IP klien: nilai PERTAMAA x-forwarded-for (proxy/load balancer menempatkannya), fallback "unknown". */
function clientIp(req: NextRequest): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

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

    // M-3: pembatasan paling awal — SEMUA percobaan dihitung (termasuk payload
    // tidak valid) supaya probing/abuse terhenti sebelum menyentuh kebijakan
    // sandi, query DB, atau DDL schema. Cek IP dulu (broadcast), lalu per-email.
    const ip = clientIp(req);
    const ipHit = hitRateLimit(`register:ip:${ip}`, REGISTER_IP_LIMIT, REGISTER_IP_WINDOW_MS);
    if (!ipHit.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan pendaftaran dari jaringan ini. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(ipHit.retryAfterSec) } },
      );
    }
    if (email) {
      const emailHit = hitRateLimit(`register:email:${email}`, REGISTER_EMAIL_LIMIT, REGISTER_EMAIL_WINDOW_MS);
      if (!emailHit.allowed) {
        return NextResponse.json(
          { error: "Pendaftaran dengan email ini terlalu sering. Coba lagi nanti atau gunakan email lain." },
          { status: 429, headers: { "Retry-After": String(emailHit.retryAfterSec) } },
        );
      }
    }

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
