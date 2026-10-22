// SUITE 01 — PILAR 1: Data & Tenant Isolation (Zero Leakage) ===============
// Target: TI-01..TI-12 pada QA-TEST-PLAN.md.
// Dijalankan: bun test scripts/qa/01-isolation.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { api, jsonOf, loginAs, BASE, BASE_DOMAIN, USERS, type Session } from "./helpers";

let hrd: Session; // OWNER MII (+ ADMIN Cahaya)
let ayu: Session; // OWNER Cahaya (bukan anggota MII)
let miiEmployeeNames: string[] = [];
let miiJobs: { id: string }[] = [];

beforeAll(async () => {
  hrd = await loginAs(USERS.mii);
  ayu = await loginAs(USERS.cahaya);
});

describe("TI-01 · dua tenant, dua jar cookie terpisah", () => {
  test("cookie sesi MII ≠ cookie sesi Cahaya", () => {
    expect(hrd.cookie).not.toBe("");
    expect(ayu.cookie).not.toBe("");
    expect(hrd.cookie).not.toBe(ayu.cookie);
  });
  test("tenant aktif sesuai login masing-masing", () => {
    expect(hrd.tenant?.slug).toBe("pt-mitra-industri-internasional");
    expect(ayu.tenant?.slug).toBe("cahaya-digital-nusantara");
  });
});

describe("TI-02 · himpunan data disjoint antar schema", () => {
  test("pekerjaan (jobs) MII ∩ Cahaya = ∅ by id", async () => {
    const rm = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/jobs?limit=200"));
    const rc = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/jobs?limit=200"));
    const miiIds = new Set<string>(((rm.jobs ?? rm.rows ?? []) as { id: string }[]).map((x) => x.id));
    const cahayaIds = new Set<string>(((rc.jobs ?? rc.rows ?? []) as { id: string }[]).map((x) => x.id));
    miiJobs = [...miiIds];
    for (const id of cahayaIds) expect(miiIds.has(id)).toBe(false);
    expect(miiIds.size).toBeGreaterThan(0); // MII punya 16 job teraut
  });
  test("direktori karyawan: MII terlihat penuh, Cahaya TIDAK melihat satu pun karyawan MII", async () => {
    const rm = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200"));
    const rc = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/employees?limit=200"));
    const miiEmps = (rm.employees ?? rm.rows ?? []) as { id: string; fullName: string }[];
    const cahayaEmps = (rc.employees ?? rc.rows ?? []) as { id: string; fullName: string }[];
    miiEmployeeNames = miiEmps.map((e) => e.fullName).slice(0, 5);
    const miiIds = new Set(miiEmps.map((e) => e.id));
    expect(miiEmps.length).toBeGreaterThanOrEqual(40); // demo 44 karyawan
    for (const e of cahayaEmps) expect(miiIds.has(e.id)).toBe(false);
    for (const n of miiEmps.map((e) => e.fullName)) {
      expect(cahayaEmps.some((e) => e.fullName === n)).toBe(false);
    }
  });
});

describe("TI-03/04 · IDOR lintas schema via pencarian (q=)", () => {
  test("sesi MII mencari domain email Cahaya → 0 baris", async () => {
    const r = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?q=" + encodeURIComponent("@cahaya.id")));
    const rows = (r.employees ?? r.rows ?? []) as unknown[];
    expect(rows.length).toBe(0);
  });
  test("sesi Cahaya mencari nama karyawan MII (5 sampel) → 0 baris semua", async () => {
    expect(miiEmployeeNames.length).toBeGreaterThan(0);
    for (const name of miiEmployeeNames) {
      const r = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/employees?q=" + encodeURIComponent(name.split(" ")[0] ?? name)));
      const rows = (r.employees ?? r.rows ?? []) as { fullName?: string }[];
      expect(rows.length).toBe(0);
    }
  });
});

describe("TI-05 · select-tenant ke workspace asing", () => {
  test("sesi Cahaya memilih tenantId MII → 403", async () => {
    const miiId = hrd.tenant?.id;
    expect(miiId).toBeTruthy();
    const res = await api(ayu.cookie, "POST", "/api/auth/select-tenant", { tenantId: miiId });
    expect(res.status).toBe(403);
  });
});

describe("TI-06..08 · subdomain forcing (Task 78)", () => {
  const miiHost = { Host: `pt-mitra-industri-internasional.${BASE_DOMAIN}` };
  const cahayaHost = { Host: `cahaya-digital-nusantara.${BASE_DOMAIN}` };
  const ghostHost = { Host: `ghost-tenant-tidak-ada.${BASE_DOMAIN}` };

  test("TI-06: cookie Cahaya di host subdomain MII → 401 (tidak pernah jatuh ke cookie)", async () => {
    const res = await api(ayu.cookie, "GET", "/api/rekankerja/companies", undefined, miiHost);
    expect(res.status).toBe(401);
  });
  test("TI-07: cookie MII di host subdomain MII → 200 data MII", async () => {
    const res = await api(hrd.cookie, "GET", "/api/rekankerja/companies", undefined, miiHost);
    expect(res.status).toBe(200);
  });
  test("TI-08: subdomain tak dikenal + sesi valid → 401 tanpa fallback cookie", async () => {
    const res = await api(hrd.cookie, "GET", "/api/rekankerja/companies", undefined, ghostHost);
    expect(res.status).toBe(401);
  });
  test("host-workspace: slug dikenali & exists hanya utk tenant terdaftar", async () => {
    const ok = await jsonOf(await api(hrd.cookie, "GET", "/api/auth/host-workspace", undefined, miiHost));
    const ghost = await jsonOf(await api(hrd.cookie, "GET", "/api/auth/host-workspace", undefined, ghostHost));
    expect(ok).toMatchObject({ isTenantHost: true, exists: true, slug: "pt-mitra-industri-internasional" });
    expect(ghost).toMatchObject({ isTenantHost: true, exists: false });
  });
  test("TI-08b: host Cahaya dengan cookie MII (hrd = ADMIN Cahaya) → 200 KONTEN CAHAYA (bukan MII)", async () => {
    // hrd juga anggota Cahaya → host memaksa konteks Cahaya walau cookie tid = MII.
    const res = await api(hrd.cookie, "GET", "/api/rekankerja/jobs?limit=200", undefined, cahayaHost);
    expect(res.status).toBe(200);
    const r = await jsonOf(res);
    const rows = ((r.jobs ?? r.rows ?? []) as { id: string }[]);
    const miiIds = new Set(miiJobs.map((x) => x.id));
    for (const row of rows) expect(miiIds.has(row.id)).toBe(false);
  });
});

describe("TI-09 · enumerasi workspace terbatas membership", () => {
  test("me(hrd) hanya menampilkan MII + Cahaya (bukan Sentra)", async () => {
    const me = await jsonOf(await api(hrd.cookie, "GET", "/api/auth/me"));
    const slugs = ((me.workspaces ?? []) as { slug: string }[]).map((w) => w.slug);
    expect(slugs).toContain("pt-mitra-industri-internasional");
    expect(slugs).toContain("cahaya-digital-nusantara");
    expect(slugs).not.toContain("sentra-logistik-prima");
  });
});

describe("TI-10 · notifikasi antar tenant disjoint", () => {
  test("ID notifikasi MII ∩ Cahaya = ∅", async () => {
    const rm = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/notifications"));
    const rc = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/notifications"));
    const miiIds = new Set<string>(((rm.notifications ?? rm.items ?? rm.rows ?? []) as { id: string }[]).map((x) => x.id));
    const cahayaIds = ((rc.notifications ?? rc.items ?? rc.rows ?? []) as { id: string }[]).map((x) => x.id);
    for (const id of cahayaIds) expect(miiIds.has(id)).toBe(false);
  });
});

describe("TI-11 · ekspor XLSX terisolasi per tenant", () => {
  test("kedua tenant dapat 200 + content-type xlsx", async () => {
    for (const s of [hrd, ayu]) {
      const res = await api(s.cookie, "GET", "/api/rekankerja/employees/export");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("spreadsheetml");
    }
  });
});

describe("TI-12 · perpindahan workspace lengkap (multi-membership hrd)", () => {
  test("switch MII → Cahaya → MII: konteks data berganti total, tanpa bleed", async () => {
    // mulai dari MII (login memilih MII)
    const before = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200"));
    const miiCount = ((before.employees ?? before.rows ?? []) as unknown[]).length;
    expect(miiCount).toBeGreaterThanOrEqual(40);

    const cahaya = hrd.workspaces.find((w) => w.slug === "cahaya-digital-nusantara");
    expect(cahaya).toBeTruthy();
    const sel = await api(hrd.cookie, "POST", "/api/auth/select-tenant", { tenantId: cahaya!.id });
    expect(sel.status).toBe(200);
    const c2 = sel.headers.getSetCookie?.()[0]?.split(";")[0];
    if (c2) hrd.cookie = c2;

    const mid = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200"));
    const cahayaCount = ((mid.employees ?? mid.rows ?? []) as unknown[]).length;
    expect(cahayaCount).toBe(0); // tenant referensi tanpa karyawan

    const mii = hrd.workspaces.find((w) => w.slug === "pt-mitra-industri-internasional")!;
    const back = await api(hrd.cookie, "POST", "/api/auth/select-tenant", { tenantId: mii.id });
    expect(back.status).toBe(200);
    const c3 = back.headers.getSetCookie?.()[0]?.split(";")[0];
    if (c3) hrd.cookie = c3;
    const after = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200"));
    expect(((after.employees ?? after.rows ?? []) as unknown[]).length).toBe(miiCount);
  });
});
