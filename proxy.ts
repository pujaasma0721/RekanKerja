import { NextRequest, NextResponse } from "next/server";
import { hostTenantOf, requestHostOf } from "@/onevity/shared/lib/tenant-host";

// OneVity proxy.ts (Next.js 16 — pengganti middleware.ts) — Task 78 subdomain.
//
// Peran: menandai request yang datang lewat ALAMAT TENANT (subdomain) dengan
// header internal x-onevity-tenant-host: <slug>. API auth membacanya untuk
// auto-select workspace tenant tersebut. Tanpa env ONEVITY_BASE_DOMAINS file
// ini pasif (passthrough murni) — perilaku lama utuh.
//
// CATATAN: proxy hanya MENANDAI — tidak pernah menolak request (zero-risk),
// semua keputusan otorisasi tetap di route (defense in depth).
export function proxy(req: NextRequest) {
  const { slug } = hostTenantOf(requestHostOf(req));
  if (!slug) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set("x-onevity-tenant-host", slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Semua kecuali asset statis Next (_next/static, _next/image) & favicon.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
