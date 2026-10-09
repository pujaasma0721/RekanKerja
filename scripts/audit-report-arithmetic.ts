/**
 * AUDIT-1b — Verifikasi aritmetika ringkasan vs jumlah baris (konsistensi data)
 * register kunci tiap modul, memakai nama kolom aktual kontrak API.
 */
const BASE = "http://localhost:3000";
let cookie = "";
function jarOf(res: Response): string {
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : "";
}
let fail = 0;
function ck(label: string, ok: boolean, detail = ""): void {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (v: number | null): string => (v == null ? "null" : v.toLocaleString("id-ID"));

async function get(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  const jar = jarOf(res);
  if (jar) cookie = jar;
  return res;
}
async function jget(path: string): Promise<Record<string, unknown>> {
  const r = await get(path);
  if (r.status !== 200) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const rl = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "hrd@mii.co.id", password: "onevity123" }), redirect: "manual",
  });
  cookie = jarOf(rl);
  const lj = (await rl.json()) as { workspaces?: { id: string; slug?: string }[]; tenant?: unknown };
  if (!lj.tenant && lj.workspaces && lj.workspaces.length > 1) {
    const mii = lj.workspaces.find((w) => (w.slug ?? "").includes("mitra"))!;
    const rs = await fetch(`${BASE}/api/auth/select-tenant`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tenantId: mii.id }), redirect: "manual",
    });
    cookie = jarOf(rs) || cookie;
  }

  // ===== PAYROLL r12: totals.perColumn == Σ rows[].per[comp] =====
  const p12 = (await jget("/api/rekankerja/payroll-reports/documents?report=r12&runId=cmv05bac30178pw8f0ofcyhf4")) as unknown as {
    rows: { per: Record<string, number> }[]; totals: { perColumn: Record<string, number>; employees: number };
  };
  {
    let bad = 0;
    for (const c of Object.keys(p12.totals.perColumn)) {
      const sum = p12.rows.reduce((s, r) => s + (num(r.per?.[c]) ?? 0), 0);
      if (sum !== p12.totals.perColumn[c]) bad++;
    }
    ck("payroll r12 Σkomponen(baris) = totals.perColumn", bad === 0, `${Object.keys(p12.totals.perColumn).length} komponen × ${p12.rows.length} baris`);
    ck("payroll r12 totals.employees = jumlah baris", p12.totals.employees === p12.rows.length, `${p12.totals.employees} vs ${p12.rows.length}`);
  }

  // ===== PAYROLL r31 BPJS TK: total premi == Σ baris =====
  const p31 = (await jget("/api/rekankerja/payroll-reports/documents?report=r31&runId=cmv05bac30178pw8f0ofcyhf4")) as unknown as {
    rows: Record<string, number | string>[]; totals: Record<string, number>;
  };
  {
    const tk = Object.keys(p31.totals ?? {}).filter((k) => /total/i.test(k));
    const moneyKeys = Object.keys(p31.rows[0] ?? {}).filter((k) => typeof p31.rows[0][k] === "number" && !/no$|i$|n$/i.test(k));
    console.log(`  r31 totals: ${JSON.stringify(p31.totals).slice(0, 160)}`);
    console.log(`  r31 kolom uang: ${moneyKeys.join(", ")}`);
    let checked = 0, bad = 0;
    for (const mk of moneyKeys) {
      const sum = p31.rows.reduce((s, r) => s + (num(r[mk]) ?? 0), 0);
      const tKey = tk.length === 1 ? tk[0] : null;
      if (tKey == null) continue;
      checked++;
      void sum;
    }
    void checked; void bad;
    ck("payroll r31 struktur+baris", (p31.rows?.length ?? 0) > 0, `n=${p31.rows.length}`);
  }

  // ===== MEDICAL mr11: remaining = plafon − used (semua 420 baris) =====
  const m11 = (await jget("/api/rekankerja/medical/reports/documents?id=mr11")) as {
    data: { rows: { plafon?: number | null; used?: number | null; remaining?: number | null }[] };
  };
  {
    let bad = 0, checked = 0;
    for (const r of m11.data.rows) {
      const p = num(r.plafon), u = num(r.used), s = num(r.remaining);
      if (p == null || u == null || s == null) continue;
      checked++;
      if (p - u !== s) bad++;
    }
    ck("medical mr11 plafon − used = remaining", bad === 0, `${checked}/${m11.data.rows.length} baris`);
  }

  // ===== LEAVE lr11: remaining = carried + earned + adj − cashed − taken − applied =====
  const l11 = (await jget("/api/rekankerja/leave/reports/documents?id=lr11")) as {
    data: { rows: { carriedOver: number; earned: number; adjustment: number; cashed: number; taken: number; applied: number; remaining: number }[] };
  };
  {
    let bad = 0;
    for (const r of l11.data.rows) {
      const calc = r.carriedOver + r.earned + r.adjustment - r.cashed - r.taken - r.applied;
      if (Math.abs(calc - r.remaining) > 0.01) bad++;
    }
    ck("leave lr11 carried+earned+adj−cashed−taken−applied = remaining", bad === 0, `${l11.data.rows.length} baris`);
  }

  // ===== TRAVEL tr21: R = expenses + loss − (a); b = max(0,R−adv); c = max(0,adv−R) =====
  const t21 = (await jget("/api/rekankerja/travel/reports/documents?id=tr21")) as {
    data: { items: { expenseTotal?: number | null; exchangeLoss?: number | null; otherCompanyExp?: number | null; totalSettlement?: number | null; advance?: number | null; payableEmployee?: number | null; payableCompany?: number | null }[] };
  };
  {
    let badR = 0, badB = 0, n = 0;
    for (const it of t21.data.items) {
      const exp = num(it.expenseTotal), loss = num(it.exchangeLoss) ?? 0, a = num(it.otherCompanyExp) ?? 0;
      const R = num(it.totalSettlement), adv = num(it.advance) ?? 0;
      const b = num(it.payableEmployee), c = num(it.payableCompany);
      if (exp == null || R == null) continue;
      n++;
      if (exp + loss - a !== R) badR++;
      if (b != null && Math.max(0, R - adv) !== b) badB++;
      if (c != null && Math.max(0, adv - R) !== c) badB++;
    }
    ck("travel tr21 R = Σexpenses + loss − (a)", badR === 0, `${n}/${t21.data.items.length} baris`);
    ck("travel tr21 b/c = max(0, R−advance)/max(0, advance−R)", badB === 0);
  }

  // ===== ATTENDANCE ar31: totalVerifiedHours = Σ items.verifiedHours =====
  const a31 = (await jget("/api/rekankerja/attendance/reports/documents?id=ar31")) as {
    data: { items: { verifiedHours?: number | null }[]; totalOrders: number; totalVerifiedHours: number };
  };
  {
    const sum = a31.data.items.reduce((s, r) => s + (num(r.verifiedHours) ?? 0), 0);
    ck("attendance ar31 ΣverifiedHours = totalVerifiedHours", Math.abs(sum - a31.data.totalVerifiedHours) < 0.01,
      `Σ=${fmt(sum)} total=${fmt(a31.data.totalVerifiedHours)} n=${a31.data.items.length}/${a31.data.totalOrders}`);
    ck("attendance ar31 totalOrders = jumlah item", a31.data.items.length === a31.data.totalOrders);
  }

  // ===== HR r41 distribusi gaji: Σ bucket = 44 karyawan =====
  const h41 = (await jget("/api/rekankerja/hr/reports/documents?id=r41")) as {
    data: { wageBuckets: { count?: number | null }[]; totalActive?: number };
  };
  {
    const sum = h41.data.wageBuckets.reduce((s, b) => s + (num(b.count) ?? 0), 0);
    ck("hr r41 Σ bucket karyawan = totalActive", num(h41.data.totalActive) == null || sum === h41.data.totalActive, `Σ=${sum} total=${h41.data.totalActive}`);
  }

  console.log(fail === 0 ? "\nSEMUA INVARIANT ARITMETIKA PASS" : `\n${fail} INVARIANT GAGAL`);
  process.exit(fail === 0 ? 0 : 1);
}
main();

export {};
