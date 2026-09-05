// POST /api/admin/seed-demo — picu restore demo jarak jauh (fire-and-forget).
// GET  /api/admin/seed-demo — status: jumlah tenant/user + log tail subproses.
//
// Guard: header "x-seed-token" ATAU query ?token= harus cocok DEMO_SEED_TOKEN
// (default token repo privat; override env di server). Endpoint idempoten —
// restore-demo skip tenant yang sudah ada; token salah → 401.
import { NextRequest, NextResponse } from "next/server";
import { demoSeedToken, platformCounts, seedRuntimeStatus, spawnRestoreDemo } from "@/onevity/shared/lib/demo-seed";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const provided = req.headers.get("x-seed-token") || new URL(req.url).searchParams.get("token") || "";
  return provided.length > 0 && provided === demoSeedToken();
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
    const r = spawnRestoreDemo();
    return NextResponse.json(
      {
        ok: r.ok,
        running: r.running,
        note: r.note,
        counts,
        hint: r.ok ? "Poll GET endpoint ini — tenants menjadi 3 berarti selesai (MII ±1-2 menit)." : undefined,
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
