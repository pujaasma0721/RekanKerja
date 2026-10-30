// QA-100T — probe batas konkurensi provider ZAI (utk skenario 100 tenant). ====
// Tangguh terhadap error (semua kegagalan dicatat, tak pernah crash):
//   1. 10 sekuensial (kontrol — buktikan limit = konkurensi, bukan RPM)
//   2. gelombang N = 2,4,6,8 (jeda 4s antar gelombang) → ambang 429
//   3. backoff: temukan 429 → tunggu 3s → ulang (maks 3×) → berhasil?
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";

interface R { ok: boolean; status: number | string; ms: number }

async function one(zai: Awaited<ReturnType<typeof createZaiClient>>): Promise<R> {
  const t0 = Date.now();
  try {
    const r = await zai.chat.completions.create({
      messages: [{ role: "user", content: "Balas PERSIS satu kata: OK" }],
      thinking: { type: "disabled" },
    });
    const txt = r.choices?.[0]?.message?.content;
    return { ok: !!txt, status: txt ? 200 : 204, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/status (\d+)/);
    return { ok: false, status: m ? Number(m[1]) : "ERR", ms: Date.now() - t0 };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function report(tag: string, rs: R[]) {
  const ok = rs.filter((r) => r.ok).length;
  const byS: Record<string, number> = {};
  for (const r of rs) byS[String(r.status)] = (byS[String(r.status)] ?? 0) + 1;
  const lat = rs.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${tag}: ${ok}/${rs.length} OK · latensi-OK p50 ${lat[Math.floor(lat.length / 2)] ?? "-"}ms max ${lat[lat.length - 1] ?? "-"}ms · status ${JSON.stringify(byS)}`);
}

async function main() {
  const zai = await createZaiClient();

  console.log("[1] 10 SEKUENSIAL (kontrol RPM)…");
  const seq: R[] = [];
  for (let i = 0; i < 10; i++) seq.push(await one(zai));
  report("  sekuensial ×10", seq);

  for (const n of [2, 4, 6, 8]) {
    await sleep(4000);
    console.log(`[2] gelombang ${n} concurrent…`);
    const w = await Promise.all(Array.from({ length: n }, () => one(zai)));
    report(`  wave ×${n}`, w);
  }

  console.log("[3] uji BACKOFF (429 → tunggu 3s → ulang, maks 3×)…");
  await sleep(4000);
  const attempts: number[] = [];
  const results: R[] = [];
  for (let k = 0; k < 4; k++) {
    let r = await one(zai);
    let tries = 1;
    while (!r.ok && tries < 3) {
      await sleep(3000);
      r = await one(zai);
      tries++;
    }
    attempts.push(tries);
    results.push(r);
    await sleep(500);
  }
  report("  backoff ×4", results);
  console.log(`  percobaan per-request: ${JSON.stringify(attempts)} (1 = langsung OK)`);
}

main().catch((e) => { console.error("PROBE GAGAL:", e); process.exit(1); });
