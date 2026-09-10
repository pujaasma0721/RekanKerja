// GET /api/health — probe kesehatan untuk load balancer / uptime monitor
// (Task 43-e, ops readiness audit 42).
//
// Semantik LB: 200 = aplikasi hidup DAN platform DB menjawab `SELECT 1`;
// 503 = aplikasi hidup tapi DB tidak siap (LB boleh mencabut instance).
// TANPA autentikasi (LB tidak punya session) dan TANPA kebocoran: tidak ada
// nama schema / DSN / host / detail error mentah — hanya kategori status.
//
// Wajib cepat (<500ms) dan tidak pernah menggantung: cek DB dibungkus
// Promise.race timeout 800ms; kegagalan/timeout Prisma di-catch (ditulis ke
// log server untuk diagnosis, klien hanya menerima kategori generik).
import { NextResponse } from "next/server";
import { db as platform } from "@/lib/db";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 800;

type DbResult = { ok: true } | { ok: false; error: "timeout" | "unreachable" };

export async function GET() {
  const startedAt = Date.now();
  let dbResult: DbResult;

  try {
    dbResult = await Promise.race<DbResult>([
      platform
        .$queryRaw`SELECT 1`
        .then(() => ({ ok: true as const }))
        .catch((e: unknown) => {
          // detail hanya ke log server — tidak dikirim ke klien
          console.warn(
            `[health] platform DB tidak siap (${Date.now() - startedAt}ms):`,
            e instanceof Error ? e.message : String(e),
          );
          return { ok: false as const, error: "unreachable" };
        }),
      new Promise<DbResult>((resolve) => {
        setTimeout(() => resolve({ ok: false, error: "timeout" }), DB_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.warn(`[health] cek DB error tak terduga:`, e instanceof Error ? e.message : String(e));
    dbResult = { ok: false, error: "unreachable" };
  }

  const time = new Date().toISOString();
  // info runtime ringan (opsional) — angka saja, tidak membocorkan apa pun
  const info = {
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    checkMs: Date.now() - startedAt,
  };

  if (dbResult.ok) {
    return NextResponse.json(
      { status: "ok", db: "ok", time, ...info },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { status: "error", db: dbResult, time, ...info },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
