import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listProviders, upsertProvider } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/providers — master rumah sakit & asuransi
// (padanan Hospital.jsp + InsuranceCompany.jsp → 1 view 2 tab).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const providers = await listProviders(db);
    return NextResponse.json({ providers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat/ubah provider (kind HOSPITAL | INSURANCE).
// requireMutator (fix audit aktor/role): VIEWER 403.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.name || (!b.id && !b.code)) {
      return NextResponse.json({ error: "code & name wajib" }, { status: 400 });
    }
    if (!["HOSPITAL", "INSURANCE"].includes(String(b.kind ?? ""))) {
      return NextResponse.json({ error: "kind harus HOSPITAL atau INSURANCE" }, { status: 400 });
    }
    const id = await upsertProvider(m.db, {
      id: b.id ? String(b.id) : undefined,
      code: String(b.code ?? ""),
      name: String(b.name ?? ""),
      kind: String(b.kind ?? "HOSPITAL"),
      city: b.city ? String(b.city) : undefined,
      address: b.address ? String(b.address) : undefined,
      phone: b.phone ? String(b.phone) : undefined,
      active: b.active !== false,
    });
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
