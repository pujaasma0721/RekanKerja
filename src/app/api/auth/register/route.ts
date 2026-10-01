import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, freshSessionToken, sessionCookieOptions, hashPassword, buildSessionInfo, currentSessionVersion,
} from "@/rekankerja/shared/lib/auth";
import { provisionTenantSchema, seedTenantReference, schemaNameForSlug, dropTenantSchema } from "@/rekankerja/shared/lib/provisioning";
import { hostTenantOf, requestHostOf } from "@/rekankerja/shared/lib/tenant-host";
import { invalidateTenantHost } from "@/rekankerja/shared/lib/tenant-host-server";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { validatePassword } from "@/rekankerja/shared/lib/password-policy";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";

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
// validasi → slug unik → provision schema PostgreSQL tenant_<slug> (DDL + seed referensi
// + record Company pakai KODE PERUSAHAAN dari form) → Tenant + User(owner) + UserTenant
// → session cookie.
// Task 33: kata sandi owner baru divalidasi KEBIJAKAN DEFAULT (kompleksitas
// lengkap — sama aturan dengan menu Keamanan & Akses).
// Task 78 (subdomain): daftar lewat <slug>.<base> → workspace TEPAT di alamat
// itu: slug tenant = subdomain (BUKAN dari nama), slug bentrok → 409 (alamat
// sudah dipakai tenant lain — pilih alamat lain), tanpa auto-pilih ganda.
/** Sanitasi kode perusahaan → huruf besar A-Z0-9 (sama aturan prefix nomor karyawan). */
function sanitizeCompanyCode(raw: string): string {
  return String(raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const workspaceName = String(b.workspaceName ?? "").trim();
    const companyCode = sanitizeCompanyCode(String(b.companyCode ?? ""));
    const fullName = String(b.fullName ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");

    // ---- Task 78d: alamat = KODE PERUSAHAAN (bukan nama workspace) ----
    // slug tenant = lowercase(companyCode): SAYONE → sayone.<base>.
    // Daftar via subdomain: subdomain WAJIB format kode ([a-z0-9], 2–12) —
    // companyCode otomatis = upper(subdomain); kode dari form harus cocok.
    const { slug: hostSlug } = hostTenantOf(requestHostOf(req));
    let forcedSlug: string | null = null;
    let forcedCode: string | null = null;
    if (hostSlug) {
      if (!/^[a-z0-9]{2,12}$/.test(hostSlug)) {
        return NextResponse.json(
          { error: "Alamat workspace harus 2–12 huruf/angka tanpa tanda hubung — sama dengan kode perusahaan Anda." },
          { status: 400 },
        );
      }
      forcedSlug = hostSlug;
      forcedCode = hostSlug.toUpperCase();
      if (companyCode && companyCode !== forcedCode) {
        return NextResponse.json(
          { error: `Kode perusahaan harus ${forcedCode} — mengikuti alamat ${hostSlug}.` },
          { status: 400 },
        );
      }
    }
    const effectiveCode = forcedCode ?? companyCode;

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
    if (companyCode.length < 2) {
      return NextResponse.json({ error: "Kode perusahaan wajib diisi (2–12 karakter huruf/angka)" }, { status: 400 });
    }
    if (fullName.length < 2) return NextResponse.json({ error: "Nama lengkap wajib diisi" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Format email tidak valid" }, { status: 400 });
    const pv = validatePassword({}, password, { username: email.split("@")[0], fullName, email });
    if (!pv.ok) {
      return NextResponse.json({ error: `Kata sandi belum memenuhi syarat: ${pv.errors.join("; ")}` }, { status: 400 });
    }

    const clash = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (clash) return NextResponse.json({ error: "Email sudah terdaftar — silakan masuk" }, { status: 400 });

    // Task 78d: slug = lowercase(kode perusahaan) — bentrok → 409 (alamat =
    // identitas, TIDAK pernah di-suffix -2/-3 karena harus tetap sama dengan kode).
    const slug = await assertSlugFree(forcedSlug ?? effectiveCode.toLowerCase());
    const schemaName = schemaNameForSlug(slug);

    // 1) schema PostgreSQL + tabel + referensi (komponen gaji, pajak, TER, akun, benefit)
    // Semua kegagalan SETELAH schema dibuat → drop schema agar TIDAK tertinggal
    // setengah jadi (registrasi ulang slug sama menabrak seed duplikat unik,
    // kasus nyata: Lookup(category,code) saat workspace SAYONE dibuat).
    try {
      await provisionTenantSchema(schemaName);
      const tenantDb = getTenantClient(schemaName);
      try {
        await seedTenantReference(tenantDb);
        // Record Company (profil perusahaan) langsung dibuat saat registrasi:
        // kode dari form → prefix nomor karyawan (MII00001) & template import;
        // detail profil (NPWP, alamat, dll) dilengkapi lewat menu Profil Perusahaan.
        await tenantDb.company.create({ data: { code: effectiveCode, name: workspaceName, shortName: effectiveCode } });
      } finally {
        await tenantDb.$disconnect();
      }
    } catch (e) {
      await dropTenantSchema(schemaName);
      throw e;
    }

    // 2) registry platform — companyCode tersimpan utk tampilan workspace & fallback prefix.
    // Gagal di sini (setelah DB tenant siap) → rollback: drop schema tenant agar
    // registry & DB tetap konsisten (tidak ada orphan schema tanpa Tenant).
    let tenant: Awaited<ReturnType<typeof db.tenant.create>>;
    try {
      tenant = await db.tenant.create({ data: { name: workspaceName, companyCode: effectiveCode, slug, schemaName } });
    } catch (e) {
      await dropTenantSchema(schemaName);
      throw e;
    }
    let userId: string | null = null;
    try {
      const user = await db.user.create({
        data: { email, name: fullName, passwordHash: hashPassword(password) },
      });
      userId = user.id;
      await db.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
    } catch (e) {
      // Gagal buat user/membership → rollback TOTAL: bersihkan user/tenant/schema
      // agar tidak ada registry tanpa owner ataupun schema orphan.
      if (userId) {
        await db.userTenant.deleteMany({ where: { userId } }).catch(() => {});
        await db.user.delete({ where: { id: userId } }).catch(() => {});
      }
      await db.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      await dropTenantSchema(schemaName);
      throw e;
    }
    if (!userId) throw new Error("user gagal dibuat");

    // Task 78d: bust cache negatif host — probe sebelum pendaftaran (oleh
    // pendaftar sendiri di layar register) menyimpan "slug belum ada" 60 dtk;
    // tanpa ini login pertama di alamat barunya bisa 404 sesaat.
    invalidateTenantHost(slug);

    const info = (await buildSessionInfo(userId, tenant.id))!;
    const res = NextResponse.json(info, { status: 201 });
    // T1-SECURITY: token membawa sessionVersion (user baru = 0, dibaca utk aman).
    const sv = await currentSessionVersion(userId);
    res.cookies.set(SESSION_COOKIE, freshSessionToken(userId, tenant.id, sv), sessionCookieOptions(req));
    return res;
  } catch (e) {
    if (e instanceof SlugTakenError) {
      return NextResponse.json({ error: "Alamat workspace ini sudah dipakai — pilih alamat lain." }, { status: 409 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

class SlugTakenError extends Error {
  constructor() { super("slug taken"); }
}
async function assertSlugFree(slug: string): Promise<string> {
  const clash = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (clash) throw new SlugTakenError();
  return slug;
}
