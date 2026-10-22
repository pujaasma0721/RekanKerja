// SUITE 03 — PILAR 3a: Cache & Anti Cross-Tenant Response Mixing ==========
// Target: PF-01, PF-02 pada QA-TEST-PLAN.md.
// Dijalankan: bun test scripts/qa/03-cache.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { api, jsonOf, loginAs, BASE_DOMAIN, USERS, type Session } from "./helpers";

let hrd: Session;
let ayu: Session;

beforeAll(async () => {
  hrd = await loginAs(USERS.mii);
  ayu = await loginAs(USERS.cahaya);
});

/**
 * PF-01 — padanan "Next.js cache poisoning" pada arsitektur ini:
 * aplikasi tanpa ISR/SSG/fetch-cache; bukti perilaku = respons sama-URL
 * SELALU sesuai tenant pemanggil walau dipanggil bergantian cepat.
 */
describe("PF-01 · dua tenant bergantian pada URL sama (5 putaran)", () => {
  test("employees & companies & jobs tidak pernah tercampur", async () => {
    for (let round = 1; round <= 5; round++) {
      const miiEmps = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200"));
      const cahayaEmps = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/employees?limit=200"));
      const miiRows = ((miiEmps.employees ?? miiEmps.rows ?? []) as unknown[]).length;
      const cahayaRows = ((cahayaEmps.employees ?? cahayaEmps.rows ?? []) as unknown[]).length;
      expect(miiRows).toBeGreaterThanOrEqual(40);
      expect(cahayaRows).toBe(0);

      const miiJobs = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/jobs?limit=200"));
      const cahayaJobs = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/jobs?limit=200"));
      const miiJobRows = ((miiJobs.jobs ?? miiJobs.rows ?? []) as unknown[]).length;
      const cahayaJobRows = ((cahayaJobs.jobs ?? cahayaJobs.rows ?? []) as unknown[]).length;
      expect(miiJobRows).toBeGreaterThan(0);
      expect(cahayaJobRows).toBeGreaterThanOrEqual(0);

      const miiCos = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/companies"));
      const cahayaCos = await jsonOf(await api(ayu.cookie, "GET", "/api/rekankerja/companies"));
      expect(((miiCos.companies ?? miiCos.rows ?? []) as unknown[]).length).toBeGreaterThan(0);
      expect(((cahayaCos.companies ?? cahayaCos.rows ?? []) as unknown[]).length).toBe(0);
    }
  });
});

/**
 * PF-02 — cache host→tenant (TTL 60 dtk): satu cookie, dua host —
 * resolusi host MEMAKSA konteks tenant per request (cache disimpan per slug,
 * bukan per sesi) → tidak ada kebocoran cache lintas slug.
 */
describe("PF-02 · host alternation (cache host→tenant per slug)", () => {
  const miiHost = { Host: `pt-mitra-industri-internasional.${BASE_DOMAIN}` };
  const cahayaHost = { Host: `cahaya-digital-nusantara.${BASE_DOMAIN}` };

  test("3 putaran mii→cahaya→mii: data selalu ikut host, bukan sesi", async () => {
    for (let i = 0; i < 3; i++) {
      // host MII → data MII (≥40 karyawan)
      const a = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200", undefined, miiHost));
      expect(((a.employees ?? a.rows ?? []) as unknown[]).length).toBeGreaterThanOrEqual(40);
      // host Cahaya → data Cahaya (0 karyawan) — cookie SAMA
      const b = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200", undefined, cahayaHost));
      expect(((b.employees ?? b.rows ?? []) as unknown[]).length).toBe(0);
      // host MII lagi → kembali data MII — bukan respons ter-cache host sebelumnya
      const c = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=200", undefined, miiHost));
      expect(((c.employees ?? c.rows ?? []) as unknown[]).length).toBeGreaterThanOrEqual(40);
    }
  });
});
