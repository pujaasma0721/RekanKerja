// POST /api/admin/seed-demo — picu restore demo jarak jauh (fire-and-forget).
// GET  /api/admin/seed-demo — status: jumlah tenant/user + log tail + laporan
//       parity per langkah (tabel/kolom wave-26/27/28 + enkripsi).
//
// Guard: header "x-seed-token" ATAU query ?token= harus cocok DEMO_SEED_TOKEN
// (default token repo privat; override env di server). Endpoint idempoten —
// tenant yang sudah ada di-skip; token salah → 401.
//
// Task 30: POST kini menjalankan (A) parity runner IN-PROCESS (migrasi semua
// tenant — bekerja juga di server node tanpa bun) dan (B) subproses
// scripts/restore-demo.ts fresh-install bila bun tersedia. Poll GET untuk
// progres; parity.ok = true berarti seluruh tenant paritas penuh.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { demoSeedToken, platformCounts, seedRuntimeStatus, startDemoSeed } from "@/rekankerja/shared/lib/demo-seed";

export const dynamic = "force-dynamic";

// AUD-DEPLOY (2-b LOW-4): bandingkan token secara konstan-waktu (timingSafeEqual)
// + batasi percobaan gagal per IP (429) agar brute-force token tidak lewat
// unlimited; token tetap hanya via HEADER (query terhapus — rentan tercatat di
// log akses proxy).
const seedFail = new Map<string, { n: number; until: number }>();

function authorized(req: NextRequest): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const st = seedFail.get(ip);
  if (st && st.n >= 5 && now < st.until) return false;
  const provided = req.headers.get("x-seed-token") || "";
  const expected = demoSeedToken();
  const ok =
    provided.length > 0 &&
    expected.length > 0 &&
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) {
    seedFail.set(ip, st && now < st.until ? { n: st.n + 1, until: st.until } : { n: 1, until: now + 15 * 60_000 });
  } else {
    seedFail.delete(ip);
  }
  return ok;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Token seed tidak valid" }, { status: 401 });
  try {
    const counts = await platformCounts();
    return NextResponse.json({ ...counts, ...seedRuntimeStatus() });
  } catch (e) {
    return NextResponse.json(
      { error: `Platform DB tidak dapat diakses: ${e instanceof Error ? e.message : String(e)}` },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Token seed tidak valid" }, { status: 401 });
  try {
    const counts = await platformCounts();
    const r = startDemoSeed();
    return NextResponse.json(
      {
        ok: r.ok,
        running: r.running,
        note: r.note,
        counts,
        hint: r.ok
          ? "Poll GET endpoint ini — field parity.ok=true & running=false berarti seluruh tenant paritas penuh (MII ±1-3 menit)."
          : undefined,
      },
      { status: r.ok ? 202 : 409 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Platform DB tidak dapat diakses: ${e instanceof Error ? e.message : String(e)}` },
      { status: 503 },
    );
  }
}
