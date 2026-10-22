// SUITE 04 — PILAR 4: Feature Gating, Usage Limits & Idempotensi ===========
// Target: GL-01..GL-07 pada QA-TEST-PLAN.md.
// Dijalankan: bun test scripts/qa/04-limits.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { api, jsonOf, loginAs, USERS, type Session } from "./helpers";

let hrd: Session; // OWNER MII — pengelola kunci API + pengaju leave (uji idempotensi)
let apiKey = "";
let keyRecordId = "";
let key2 = "";
let key2Id = "";

beforeAll(async () => {
  hrd = await loginAs(USERS.mii);
});

async function revokeKey(id: string): Promise<void> {
  await api(hrd.cookie, "PATCH", "/api/rekankerja/api-keys", { id, action: "revoke" }).catch(() => {});
}

afterAll(async () => {
  if (key2Id) await revokeKey(key2Id);
});

describe("GL-01/06 · alur kunci API end-to-end (tenant-bound)", () => {
  test("generate kunci scope employees → 201 + kunci penuh sekali tampil", async () => {
    const res = await api(hrd.cookie, "POST", "/api/rekankerja/api-keys", { name: "QA Suite 04", scopes: ["employees"] });
    expect([200, 201]).toContain(res.status);
    const j = (await jsonOf(res)) as { key?: string; record?: { id?: string } };
    expect(j.key ?? "").not.toBe("");
    apiKey = j.key ?? "";
    keyRecordId = j.record?.id ?? "";
  });
  test("public API dengan kunci → 200 data karyawan MII (schema pemilik kunci)", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/public/employees?limit=200", {
      headers: { "x-api-key": apiKey },
    });
    expect(res.status).toBe(200);
    const j = (await jsonOf(res)) as { data?: { employees?: unknown[] } };
    const rows = (j.data?.employees ?? []) as unknown[];
    expect(rows.length).toBeGreaterThan(0); // MII 44 karyawan — kunci TERIKAT schema MII
  });
});

describe("GL-02 · autentikasi kunci public API", () => {
  test("tanpa header → 401", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/public/employees");
    expect(res.status).toBe(401);
  });
  test("kunci sampah → 401", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/public/employees", {
      headers: { "x-api-key": "rk_bukan_kunci_valid" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GL-03 · revoke berlaku SEKETIKA (cache 5 mnt tidak menutupi)", () => {
  test("setelah revoke → 401", async () => {
    const rev = await api(hrd.cookie, "PATCH", "/api/rekankerja/api-keys", { id: keyRecordId, action: "revoke" });
    expect(rev.status).toBe(200);
    const res = await fetch("http://127.0.0.1:3000/api/public/employees", {
      headers: { "x-api-key": apiKey },
    });
    expect(res.status).toBe(401);
  });
});

describe("GL-04 · rate limit 60 req/menit per kunci", () => {
  test("burst 70 request cepat → menerima 429 setelah batas", async () => {
    const gen = await api(hrd.cookie, "POST", "/api/rekankerja/api-keys", { name: "QA Burst 04", scopes: ["employees"] });
    const j = (await jsonOf(gen)) as { key?: string; record?: { id?: string } };
    key2 = j.key ?? "";
    key2Id = j.record?.id ?? "";
    expect(key2).not.toBe("");

    let saw429 = false;
    let okCount = 0;
    for (let i = 0; i < 70; i++) {
      const res = await fetch("http://127.0.0.1:3000/api/public/employees?limit=1", {
        headers: { "x-api-key": key2 },
      });
      if (res.status === 429) {
        saw429 = true;
        break;
      }
      okCount++;
      expect(res.status).toBe(200);
    }
    expect(okCount).toBeGreaterThan(50); // batas 60/menit tercapai sebelum 70
    expect(saw429).toBe(true);
  });
});

describe("GL-05 · scope enforcement", () => {
  test("kunci scope employees → endpoint leave-balances ditolak 403", async () => {
    // kunci SEGAR (jangan pakai key2 — window rate-limit-nya sudah terbakar GL-04)
    const gen = await api(hrd.cookie, "POST", "/api/rekankerja/api-keys", { name: "QA Scope 04", scopes: ["employees"] });
    const j = (await jsonOf(gen)) as { key?: string; record?: { id?: string } };
    expect(j.key ?? "").not.toBe("");
    const res = await fetch("http://127.0.0.1:3000/api/public/leave-balances?year=2026", {
      headers: { "x-api-key": j.key ?? "" },
    });
    expect(res.status).toBe(403);
    await revokeKey(j.record?.id ?? "");
  });
});

describe("GL-07 · anti-double-submit leave request (idempotensi bisnis)", () => {
  // Uji dilakukan SEKALI dengan tanggal jauh di masa depan (2027) — aman utk saldo demo.
  test("pengajuan duplikat persis (karyawan+jenis+tanggal sama) ditolak guard overlap", async () => {
    // 1) jenis cuti aktif tanpa dokumen wajib
    const types = await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/leave/types"));
    const rows = ((types.types ?? types.rows ?? []) as { id: string; name?: string; needDocs?: boolean; active?: boolean; genderEligibility?: string }[]).filter(
      (t) => t.active !== false && !t.needDocs,
    );
    expect(rows.length).toBeGreaterThan(0);
    const type = rows[0]!;

    // 2) karyawan aktif MII (diambil dari direktori — hrd adalah OWNER dgn scope ALL)
    const emp = ((await jsonOf(await api(hrd.cookie, "GET", "/api/rekankerja/employees?limit=1"))).employees ?? []) as { id: string }[];
    const employeeId = emp[0]?.id ?? "";
    expect(employeeId).not.toBe("");

    const payload = {
      employeeId,
      leaveTypeId: type.id,
      dateFrom: "", // diisi kandidat di bawah
      dateTo: "",
      sessionFrom: "AM",
      sessionTo: "PM",
      reason: "QA double-submit probe — baris pertama",
    };
    // Jendela tanggal DINAMIS (mulai hari ini + offset) — kebal terhadap jam
    // sandbox & periode saldo anniversary (selalu ~1 thn ke depan, jadi offset
    // pendek selalu masuk periode berjalan). Hindari backdate guard.
    const day = (offset: number): string => {
      const d = new Date(Date.now() + offset * 86400000);
      return d.toISOString().slice(0, 10);
    };
    const candidates: [string, string][] = [7, 10, 14, 17, 21, 25, 28].map((o) => [day(o), day(o + 1)] as [string, string]);
    let first: Response | null = null;
    let createdId = "";
    for (const [from, to] of candidates) {
      const attempt = await api(hrd.cookie, "POST", "/api/rekankerja/leave/requests", { ...payload, dateFrom: from, dateTo: to });
      if (attempt.status === 200 || attempt.status === 201) {
        first = attempt;
        payload.dateFrom = from;
        payload.dateTo = to;
        const created = (await jsonOf(attempt)) as { request?: { id?: string }; id?: string };
        createdId = created.request?.id ?? created.id ?? "";
        break;
      }
      expect(attempt.status).toBe(400); // hanya bentrok periode/saldo yang boleh gagal
    }
    expect(first).not.toBeNull();

    // 3) duplikat persis — HARUS ditolak guard overlap (bukan membuat baris kedua)
    const second = await api(hrd.cookie, "POST", "/api/rekankerja/leave/requests", {
      ...payload,
      reason: "QA double-submit probe — baris kedua",
    });
    expect([400, 409]).toContain(second.status);
    const errBody = (await jsonOf(second)) as { error?: string };
    expect(String(errBody.error ?? "").toLowerCase()).toContain("bentrok");
    // 4) bersihkan: batalkan pengajuan pertama
    if (createdId) {
      const cancel = await api(hrd.cookie, "PATCH", "/api/rekankerja/leave/requests", { id: createdId, action: "cancel" });
      expect([200, 400, 409]).toContain(cancel.status); // 200 bila masih draft/pending
    }
  });
});
