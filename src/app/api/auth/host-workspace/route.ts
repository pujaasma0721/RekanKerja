import { NextResponse } from "next/server";
import { resolveTenantByHost } from "@/onevity/shared/lib/tenant-host-server";

// GET /api/auth/host-workspace — info workspace untuk SUBDOMAIN saat ini (Task 78).
// Respons: { isTenantHost, exists, slug } — dipakai layar auth:
//   · isTenantHost=false → host utama/host tak dikenal: UI berperilaku lama;
//   · isTenantHost=true & exists=true → subdomain sudah punya workspace →
//     layar daftar otomatis jadi "masuk" (alamat tak bisa didaftar ulang);
//   · isTenantHost=true & exists=false → workspace belum ada → daftar di
//     alamat ini membuat workspace dengan slug = subdomain.
export async function GET(req: Request) {
  const { host, tenant } = await resolveTenantByHost(req);
  return NextResponse.json({ isTenantHost: host.slug != null, exists: tenant != null, slug: host.slug });
}
