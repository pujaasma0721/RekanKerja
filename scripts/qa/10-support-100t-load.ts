// QA-SCALING-SUPPORT-100T — load test support service dgn 100 tenant nyata. ==
// ==============================================================================
// Menjawab: "100 tenant, case berbeda-beda, dikirim BERSAMAAN — masih handle?"
// Fase (lihat laporan akhir):
//   W  warmup    : 1 giliran agent tunggal (kompilasi route dev + baseline latensi)
//   R  read-burst: 100 concurrent GET /tickets (1 per tenant — jalur auth+DB penuh)
//   M  msg-burst : 100 concurrent POST messages (1 per tenant — tulis 100 schema)
//   A  anti-dobel: 4 concurrent POST /agent pada SATU tiket → harus 1×201 + 3×409
//   L  llm-burst : 10 concurrent POST /agent pada 10 tiket beda tenant → latensi&
//                  keberhasilan giliran agent nyata (provider = bottleneck)
//   Z  provider  : probe konkurensi langsung ke ZAI (24 lalu 48 tiny completion)
// Jalankan: bun scripts/qa/10-support-100t-load.ts   (SKIP_LLM=1 utk skip A/L/Z)
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";

const BASE = "http://127.0.0.1:3000";
const N_LOAD = 97;
const PASSWORD = "LoadTest123!";
const pad = (i: number) => String(i).padStart(3, "0");

interface Sess { label: string; cookie: string; ticketId: string; kind: "usage" | "bug" | "akun" }

function stats(name: string, rs: { status: number; ms: number; err?: string }[]) {
  const ok = rs.filter((r) => r.status >= 200 && r.status < 400);
  const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
  const byStatus: Record<number, number> = {};
  for (const r of rs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const errs = [...new Set(rs.filter((r) => r.status >= 400).map((r) => `${r.status}: ${(r.err ?? "").slice(0, 90)}`))].slice(0, 3);
  console.log(
    `  ${name}: ${ok.length}/${rs.length} sukses · p50 ${p(0.5)}ms · p95 ${p(0.95)}ms · max ${lat[lat.length - 1] ?? 0}ms · status ${JSON.stringify(byStatus)}${errs.length ? " · err: " + errs.join(" | ") : ""}`,
  );
  return { ok: ok.length, total: rs.length };
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ status: number; ms: number; err?: string; res?: Response }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    const err = res.status >= 400 ? ((await res.clone().json().catch(() => ({}))) as any).error ?? "" : "";
    return { status: res.status, ms: Date.now() - t0, err, res };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, err: e instanceof Error ? e.message : String(e) };
  }
}

async function login(email: string, password: string, preferSlug?: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login ${email} → ${res.status}`);
  let cookie = (res.headers.getSetCookie?.() ?? [])[0]?.split(";")[0] ?? "";
  const j = (await res.json()) as any;
  if (preferSlug && j.tenant?.slug !== preferSlug) {
    const w = (j.workspaces ?? []).find((x: any) => x.slug === preferSlug);
    if (!w) throw new Error(`workspace ${preferSlug} tak tersedia utk ${email}`);
    const sel = await fetch(`${BASE}/api/auth/select-tenant`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ tenantId: w.id }),
    });
    if (sel.status !== 200) throw new Error(`select-tenant ${email} → ${sel.status}`);
    const c2 = (sel.headers.getSetCookie?.() ?? [])[0]?.split(";")[0] ?? "";
    if (c2) cookie = c2;
  }
  return cookie;
}

async function healthMem(): Promise<number> {
  try {
    const r = await fetch(`${BASE}/api/health`);
    const j = (await r.json()) as any;
    return j.memoryRssMb ?? -1;
  } catch { return -1; }
}

async function main() {
  const skipLlm = process.env.SKIP_LLM === "1";
  console.log(`== QA-SCALING-SUPPORT-100T — ${new Date().toISOString()} ==`);
  console.log(`memori server awal: ${await healthMem()} MB`);

  // ---------- login 100 tenant ----------
  console.log("[0] login 100 tenant…");
  const t0 = Date.now();
  const sessions: Sess[] = [];
  const demo: [string, string, string][] = [
    ["hrd@mii.co.id", "onevity123", "pt-mitra-industri-internasional"],
    ["ayu@cahaya.id", "cahaya12345", "cahaya-digital-nusantara"],
    ["bambang@sentra.co.id", "sentra12345", "sentra-logistik-prima"],
  ];
  for (const [email, pw, slug] of demo) {
    const cookie = await login(email, pw, slug);
    const mk = await fetch(`${BASE}/api/rekankerja/support/tickets`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ subject: "Loadtest 100T — pertanyaan penggunaan" }),
    });
    if (mk.status !== 201) throw new Error(`buat tiket demo ${email} → ${mk.status}`);
    const ticketId = ((await mk.json()) as any).ticket.id;
    sessions.push({ label: email, cookie, ticketId, kind: "usage" });
  }
  for (let i = 1; i <= N_LOAD; i++) {
    const cookie = await login(`load${pad(i)}@loadtest.local`, PASSWORD);
    const list = await timedFetch(`${BASE}/api/rekankerja/support/tickets`, { headers: { cookie } });
    const tickets = ((await list.res!.json()) as any).tickets as { id: string; ticketNo: string }[];
    const t = tickets.find((x) => x.ticketNo.startsWith("LT-"));
    if (!t) throw new Error(`tiket LT- tidak ditemukan utk load${pad(i)}`);
    const kind = i % 4 === 0 ? "bug" : i % 4 === 3 ? "akun" : i % 4 === 2 ? "usage" : "usage";
    sessions.push({ label: `load${pad(i)}`, cookie, ticketId: t.id, kind });
  }
  console.log(`  100 sesi siap dalam ${Date.now() - t0}ms`);

  // ---------- W: warmup 1 giliran agent tunggal ----------
  const warm = sessions.find((s) => s.label === "load001")!;
  {
    const fd = new FormData();
    fd.append("body", "Halo, bagaimana cara melihat riwayat slip gaji saya?");
    const m = await timedFetch(`${BASE}/api/rekankerja/support/tickets/${warm.ticketId}/messages`, { method: "POST", body: fd, headers: { cookie: warm.cookie } });
    console.log(`[W] pesan warmup: ${m.status} (${m.ms}ms)`);
    if (skipLlm) { console.log("[W] SKIP_LLM — lewati giliran agent"); }
    else {
      const a = await timedFetch(`${BASE}/api/rekankerja/support/tickets/${warm.ticketId}/agent`, { method: "POST", headers: { cookie: warm.cookie } });
      console.log(`[W] giliran agent TUNGGAL: ${a.status} (${(a.ms / 1000).toFixed(1)}s)${a.status >= 400 ? " — " + a.err : ""}`);
    }
  }

  // ---------- R: 100 concurrent GET /tickets ----------
  console.log("[R] 100 concurrent GET /tickets…");
  const r0 = Date.now();
  const R = await Promise.all(sessions.map((s) => timedFetch(`${BASE}/api/rekankerja/support/tickets`, { headers: { cookie: s.cookie } })));
  stats("GET /tickets ×100", R);
  console.log(`  durasi total fase: ${Date.now() - r0}ms · memori: ${await healthMem()} MB`);

  // ---------- M: 100 concurrent POST message (case beda-beda) ----------
  console.log("[M] 100 concurrent POST message (case campuran)…");
  const m0 = Date.now();
  const M = await Promise.all(sessions.map((s, idx) => {
    const fd = new FormData();
    const cases: Record<string, string[]> = {
      usage: [
        "Bagaimana cara mengajukan cuti tahunan di aplikasi ini?",
        "Di mana saya bisa melihat riwayat slip gaji saya?",
      ],
      bug: ["Saat membuka menu absensi muncul error 'Gagal memuat data' — mohon dibantu."],
      akun: ["Saya lupa kata sandi akun saya, bagaimana cara resetnya?"],
    };
    const pool = cases[s.kind];
    fd.append("body", `[${s.label}] ${pool[idx % pool.length]}`);
    return timedFetch(`${BASE}/api/rekankerja/support/tickets/${s.ticketId}/messages`, { method: "POST", body: fd, headers: { cookie: s.cookie } });
  }));
  stats("POST message ×100", M);
  console.log(`  durasi total fase: ${Date.now() - m0}ms · memori: ${await healthMem()} MB`);

  if (!skipLlm) {
    // ---------- A: anti-dobel — 4 concurrent POST /agent pada SATU tiket ----------
    console.log("[A] 4 concurrent POST /agent pada SATU tiket (guard turnsInFlight)…");
    const dbl = sessions.find((s) => s.label === "load002")!;
    const A = await Promise.all(Array.from({ length: 4 }, () =>
      timedFetch(`${BASE}/api/rekankerja/support/tickets/${dbl.ticketId}/agent`, { method: "POST", headers: { cookie: dbl.cookie } })));
    stats("POST /agent ×4 (tiket sama)", A);
    const ok201 = A.filter((x) => x.status === 201).length;
    const c409 = A.filter((x) => x.status === 409).length;
    console.log(`  VERDIKT GUARD: ${ok201}×201 + ${c409}×409 ${ok201 === 1 ? "✓ (tepat satu giliran jalan)" : "⚠ POLA TAK TERDUGA"}`);

    // ---------- L: 10 concurrent giliran agent nyata ----------
    console.log("[L] 10 concurrent POST /agent pada 10 tiket beda tenant…");
    const llmSessions = sessions.filter((s) => /^load(00[3-9]|01[0-2])$/.test(s.label));
    const l0 = Date.now();
    const L = await Promise.all(llmSessions.map((s) =>
      timedFetch(`${BASE}/api/rekankerja/support/tickets/${s.ticketId}/agent`, {
        method: "POST", headers: { cookie: s.cookie },
        signal: AbortSignal.timeout(280_000),
      })));
    stats("POST /agent ×10 (tiket beda)", L);
    const lats = L.map((x) => x.ms / 1000).sort((a, b) => a - b);
    console.log(`  latensi giliran (s): min ${lats[0]?.toFixed(1)} · median ${lats[Math.floor(lats.length / 2)]?.toFixed(1)} · max ${lats[lats.length - 1]?.toFixed(1)} · total fase ${((Date.now() - l0) / 1000).toFixed(0)}s`);
    console.log(`  memori: ${await healthMem()} MB`);

    // ---------- Z: probe konkurensi provider ZAI ----------
    console.log("[Z] probe provider ZAI — 24 concurrent tiny completion…");
    const zai = await createZaiClient();
    async function zProbe(n: number) {
      const Z = await Promise.all(Array.from({ length: n }, () =>
        (async () => {
          const t0 = Date.now();
          try {
            const r = await zai.chat.completions.create({ messages: [{ role: "user", content: "Balas PERSIS satu kata: OK" }], thinking: { type: "disabled" } });
            return { status: r.choices?.[0]?.message?.content ? 200 : 204, ms: Date.now() - t0, err: "" };
          } catch (e) {
            return { status: 0, ms: Date.now() - t0, err: e instanceof Error ? e.message.slice(0, 90) : String(e) };
          }
        })()));
      return stats(`ZAI ×${n}`, Z);
    }
    const z24 = await zProbe(24);
    if (z24.ok >= 23) {
      console.log("  lanjut gelombang 48…");
      await zProbe(48);
    }
  }

  console.log(`memori server akhir: ${await healthMem()} MB`);
  console.log("== SELESAI ==");
}

main().catch((e) => {
  console.error("LOAD TEST GAGAL:", e);
  process.exit(1);
});
