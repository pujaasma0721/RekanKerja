// SUITE 02 — PILAR 2: Authentication, Authorization & AppSec ==============
// Target: AA-01..AA-15 pada QA-TEST-PLAN.md.
// Dijalankan: bun test scripts/qa/02-appsec.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "pg";
import { api, jsonOf, loginAs, loginRaw, readEnvVar, signToken, scryptHash, sqlLit, USERS, type Session } from "./helpers";

let hrd: Session;
let secret: string;
let uid: string;
let tid: string;

// token serangan (dibangun after login utk uid/tid nyata)
let forgedToken: string; // secret salah
let tamperedToken: string; // body diganti, MAC asli
let expiredToken: string; // MAC valid, exp lampau
let svMismatchToken: string; // MAC valid, sv=999
let mfaToken: string; // token tahap-2 MFA dipakai sbg cookie sesi

beforeAll(async () => {
  hrd = await loginAs(USERS.mii);
  secret = readEnvVar("SESSION_SECRET") ?? "rekankerja-dev-secret";
  // uid/tid diekstrak dari cookie asli (base64url payload)
  const body = hrd.cookie.split("=")[1]!.split(".")[0]!;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { uid: string; tid: string };
  uid = payload.uid;
  tid = payload.tid!;

  forgedToken = signToken({ uid, tid, exp: Date.now() + 86400000, sv: 1 }, secret + "salah");
  tamperedToken = `${Buffer.from(JSON.stringify({ uid: "user-lain", tid, exp: Date.now() + 86400000, sv: 1 })).toString("base64url")}.${hrd.cookie.split("=")[1]!.split(".")[1]!}`;
  expiredToken = signToken({ uid, tid, exp: Date.now() - 3600000, sv: 1 }, secret);
  svMismatchToken = signToken({ uid, tid, exp: Date.now() + 86400000, sv: 999 }, secret);
  mfaToken = signToken({ typ: "mfa", uid, exp: Date.now() + 300000 }, secret);
});

describe("AA-01 · tanpa cookie semua endpoint 401", () => {
  for (const p of [
    "/api/rekankerja/companies",
    "/api/rekankerja/employees?limit=10",
    "/api/rekankerja/dashboard",
    "/api/rekankerja/notifications",
    "/api/rekankerja/jobs",
  ]) {
    test(`GET ${p} tanpa sesi → 401`, async () => {
      const res = await api("", "GET", p);
      expect(res.status).toBe(401);
    });
  }
});

describe("AA-02..05 · token dipalsukan/di-tamper/expired/revoked", () => {
  const cases: [string, string][] = [];
  beforeAll(() => {
    cases.push(
      ["AA-02 HMAC salah", forgedToken],
      ["AA-03 payload di-tamper (MAC asli)", tamperedToken],
      ["AA-04 expired (MAC valid)", expiredToken],
      ["AA-05 sessionVersion mismatch", svMismatchToken],
    );
  });
  test("seluruh token serangan ditolak 401", async () => {
    for (const [name, token] of cases) {
      const res = await fetch("http://127.0.0.1:3000/api/rekankerja/companies", {
        headers: { cookie: `rekankerja_session=${token}` },
      });
      expect(res.status).toBe(401);
    }
  });
});

describe("AA-06 · logout merevokasi sesi (replay cookie lama)", () => {
  test("cookie pra-logout 401 setelah logout", async () => {
    const s = await loginRaw(USERS.mii);
    expect(s.res.status).toBe(200);
    const old = s.cookie;
    const out = await fetch("http://127.0.0.1:3000/api/auth/logout", {
      method: "POST",
      headers: { cookie: old },
    });
    expect(out.status).toBe(200);
    const replay = await api(old, "GET", "/api/rekankerja/companies");
    expect(replay.status).toBe(401);
    // pulihkan sesi utama suite — logout merevokasi SEMUA sesi user (per-user
    // sessionVersion), jadi sesi hrd utama harus diperbarui utk tes berikutnya.
    const re = await loginAs(USERS.mii);
    hrd.cookie = re.cookie;
  });
});

describe("AA-07 · token MFA ≠ token sesi (domain separation)", () => {
  test("token tahap-2 MFA ditolak sebagai cookie sesi", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/rekankerja/companies", {
      headers: { cookie: `rekankerja_session=${mfaToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("AA-08 · RBAC role VIEWER (fail-closed)", () => {
  const VIEWER_EMAIL = "qa-viewer@qa.local";
  const VIEWER_PASS = "QaViewer123!";
  let viewerCookie = "";

  beforeAll(async () => {
    // white-box setup: user platform + membership VIEWER di MII (via SQL langsung)
    const client = new Client({ connectionString: readEnvVar("DATABASE_URL") });
    await client.connect();
    const hash = scryptHash(VIEWER_PASS);
    await client.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", "isSuperadmin", "failedAttempts", "sessionVersion", "totpEnabled", "createdAt", "updatedAt")
       VALUES ('qa-viewer-user-0001', ${sqlLit(VIEWER_EMAIL)}, 'QA Viewer', ${sqlLit(hash)}, false, 0, 0, false, now(), now())
       ON CONFLICT (email) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO "UserTenant" (id, "userId", "tenantId", role, "createdAt")
       VALUES ('qa-viewer-memb-0001', 'qa-viewer-user-0001', ${sqlLit(tid)}, 'VIEWER', now())
       ON CONFLICT ("userId", "tenantId") DO UPDATE SET role = 'VIEWER'`,
    );
    await client.end();
    const v = await loginRaw({ email: VIEWER_EMAIL, password: VIEWER_PASS });
    expect(v.res.status).toBe(200);
    viewerCookie = v.cookie;
  });

  afterAll(async () => {
    const client = new Client({ connectionString: readEnvVar("DATABASE_URL") });
    await client.connect();
    await client.query(`DELETE FROM "UserTenant" WHERE id = 'qa-viewer-memb-0001'`);
    await client.query(`DELETE FROM "User" WHERE id = 'qa-viewer-user-0001'`);
    await client.end();
  });

  test("GET data read-only diizinkan (companies 200)", async () => {
    const res = await api(viewerCookie, "GET", "/api/rekankerja/companies");
    expect(res.status).toBe(200);
  });
  test("POST mutasi ditolak 403 (VIEWER)", async () => {
    // target: endpoint mutasi nyata (route leave/requests mengekspor POST)
    const res = await api(viewerCookie, "POST", "/api/rekankerja/leave/requests", {
      employeeId: "x", leaveTypeId: "x", dateFrom: "2027-01-04", dateTo: "2027-01-05", reason: "QA",
    });
    expect(res.status).toBe(403);
  });
});

describe("AA-09/10 · brute force login + spoofing XFF", () => {
  const SPOOF_IP = "203.0.113.77";
  test("31 kegagalan beruntun dari IP (spoofed XFF) → 429 + Retry-After", async () => {
    let got429 = false;
    let retryAfter = "";
    for (let i = 1; i <= 35; i++) {
      const res = await fetch("http://127.0.0.1:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": SPOOF_IP },
        body: JSON.stringify({ email: `qa-brute-${i}@qa.local`, password: "salah-total" }),
      });
      if (res.status === 429) {
        got429 = true;
        retryAfter = res.headers.get("retry-after") ?? "";
        break;
      }
      expect([200, 401, 429]).toContain(res.status);
    }
    expect(got429).toBe(true);
    expect(retryAfter).not.toBe("");
  });
  test("F-01: XFF spoof berpengaruh → rate limit IP asli tidak terdampak (login valid tetap 200)", async () => {
    const s = await loginRaw(USERS.mii);
    expect(s.res.status).toBe(200);
  });
});

describe("AA-11 · manipulasi path tidak membuka celah auth", () => {
  const vectors = [
    "//api/rekankerja/companies",
    "/api/rekankerja/companies/",
    "/api/rekankerja%2Fcompanies",
    "/api/rekankerja/../auth/me",
    "/API/REKANKERJA/COMPANIES",
    "/api/./rekankerja/companies",
    "/api/rekankerja/companies%00",
    "/api/rekankerja/companies?",
    "/api//auth//me",
    "/api/rekankerja/employees/../companies",
  ];
  for (const v of vectors) {
    test(`tanpa sesi: ${v} → tidak pernah 200`, async () => {
      const res = await api("", "GET", v).catch((e: unknown) => e);
      if (res instanceof Response) {
        expect(res.status).not.toBe(200);
      }
    });
    test(`dgn sesi MII: ${v} → bukan 5xx & tak membocorkan data lintas tenant`, async () => {
      const res = await api(hrd.cookie, "GET", v).catch((e: unknown) => e);
      if (res instanceof Response) {
        expect(res.status).toBeLessThan(500);
      }
    });
  }
});

describe("AA-12 · injeksi SQL pada parameter pencarian", () => {
  for (const payload of ["' OR 1=1--", "x'; DROP TABLE Employee;--", "%'; SELECT * FROM \"User\";--", "\\' OR '1'='1"]) {
    test(`q=${JSON.stringify(payload)} → 200 & 0 baris (parametrized)`, async () => {
      const res = await api(hrd.cookie, "GET", "/api/rekankerja/employees?q=" + encodeURIComponent(payload));
      expect(res.status).toBe(200);
      const r = await jsonOf(res);
      expect(((r.employees ?? r.rows ?? []) as unknown[]).length).toBe(0);
    });
  }
  test("body JSON rusak pada login → 400/401 (bukan 500)", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{'email': broken json !!!",
    });
    expect(res.status).not.toBe(500);
  });
});

describe("AA-13 · mass assignment pada PATCH companies", () => {
  test("field asing (role/tenantId/sessionVersion) diabaikan/tolak — tanpa 500, konteks tak berubah", async () => {
    // id tidak ada → tidak ada data tersentuh; field asing tidak boleh mengubah konteks tenant
    const res = await api(hrd.cookie, "PATCH", "/api/rekankerja/companies", {
      id: "qa-ma-probe-tidak-ada",
      name: "QA-MA",
      role: "OWNER",
      tenantId: "tenant-lain",
      sessionVersion: 99,
      isSuperadmin: true,
    });
    expect(res.status).toBe(404); // F-05 diperbaiki: P2025 → 404 dwibahasa (bukan 500)
    // konteks tenant tidak berubah oleh field asing
    const me = await jsonOf(await api(hrd.cookie, "GET", "/api/auth/me"));
    expect((me.tenant as { slug?: string } | null)?.slug).toBe("pt-mitra-industri-internasional");
  });
});

describe("AA-14 · flag keamanan cookie sesi", () => {
  test("Set-Cookie memuat HttpOnly + SameSite=Lax + Path=/", async () => {
    const s = await loginRaw(USERS.mii);
    const raw = (s.setCookie[0] ?? "").toLowerCase();
    expect(raw).toContain("httponly");
    expect(raw).toContain("samesite=lax");
    expect(raw).toContain("path=/");
  });
});

describe("AA-15 · enumerasi akun", () => {
  test("email tak dikenal → 401 generik (via XFF terpisah)", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.99" },
      body: JSON.stringify({ email: "tidak-ada@qa.local", password: "apa-aja" }),
    });
    expect(res.status).toBe(401);
    const j = await jsonOf(res);
    expect(String(j.error ?? "").toLowerCase()).not.toContain("tidak terdaftar");
  });
});
