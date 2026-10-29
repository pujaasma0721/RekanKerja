// OneVity Public API guard (T18-API) — middleware kunci API + scope + audit.
// =====================================================================
// Pola respons KONSISTEN: sukses → { data }, gagal → { error } (tanpa { data}).
// Urutan cek: header x-api-key → rate limit → resolusi tenant (hash SHA-256)
// → revoked → SCOPE. Audit: 1 baris ActivityLog per request — aktor
// "apikey:{prefix}" (fail-safe: audit gagal tidak menggagalkan request).
import { NextResponse } from "next/server";
import { verifyApiKey, type ApiScope } from "@/onevity/shared/services/apikey-service";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

export type { ApiScope };

export interface PublicAuth {
  db: TenantDb;
  tenant: { id: string; name: string; slug: string };
  key: { id: string; name: string; prefix: string; scopes: string[]; actor: string };
}

export type GuardResult =
  | { ok: true; auth: PublicAuth }
  | { ok: false; response: NextResponse };

/** Respons sukses standar Public API: { data }. */
export function publicOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/** Respons gagal standar Public API: { error }. */
export function publicError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Guard Public API: kunci (x-api-key) + rate limit + scope.
 * Pemakaian di tiap endpoint:
 *   const g = await requirePublicApi(req, "employees");
 *   if (!g.ok) return g.response;
 *   const auth = g.auth; // { db, tenant, key } — auth.key.actor = "apikey:ov_…"
 */
export async function requirePublicApi(req: Request, scope: ApiScope): Promise<GuardResult> {
  const v = await verifyApiKey(req);
  if (!v.ok) {
    return { ok: false, response: publicError(v.status, v.error) };
  }
  if (!v.key.scopes.includes(scope)) {
    return {
      ok: false,
      response: publicError(
        403,
        `Kunci API tidak memiliki scope "${scope}" — scope kunci ini: ${v.key.scopes.join(", ") || "(kosong)"}. Minta admin menambahkan scope pada kunci.`,
      ),
    };
  }
  return {
    ok: true,
    auth: { db: v.db, tenant: v.tenant, key: v.key },
  };
}

/** Audit trail Public API — aktor "apikey:{prefix}" (fire-and-forget). */
export function auditPublicApi(
  db: TenantDb,
  auth: PublicAuth,
  info: { method: string; path: string; status: number; scope: string; detail?: string },
): void {
  const action = info.method === "POST" ? "Created" : info.method === "GET" ? "Queried" : info.method;
  const detail =
    `${info.method} ${info.path} → ${info.status} oleh ${auth.key.actor} (kunci "${auth.key.name}", scope ${info.scope}, tenant ${auth.tenant.slug})` +
    (info.detail ? ` — ${info.detail}` : "");
  void db.activityLog
    .create({ data: { actorType: "system", action, entity: "PublicApi", detail } })
    .catch(() => { /* audit gagal — jangan gagalkan request */ });
}
