import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { listProviders, upsertProvider } from "@/rekankerja/medical/services/medical-service";

// GET /api/rekankerja/medical/providers — master rumah sakit & asuransi
// (padanan Hospital.jsp + InsuranceCompany.jsp → 1 view 2 tab).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["medical:medical-providers"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const providers = await listProviders(db);
    return NextResponse.json({ providers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat/ubah provider (kind HOSPITAL | INSURANCE).
// Task 32-d / fix audit 40 §5: requireMutator longgar → requireMenuAction —
// master RS/asuransi = medical:medical-providers (view Rumah Sakit & Asuransi;
// aksi dasar create (baru) / update (ubah) per pengguna; VIEWER tetap 403).
// Body dibaca SEKALI sebelum guard (b.id menentukan create vs update).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.name || (!b.id && !b.code)) {
      return NextResponse.json({ error: "code & name wajib" }, { status: 400 });
    }
    if (!["HOSPITAL", "INSURANCE"].includes(String(b.kind ?? ""))) {
      return NextResponse.json({ error: "kind harus HOSPITAL atau INSURANCE" }, { status: 400 });
    }
    const m = await requireMenuAction(req, "medical:medical-providers", b.id ? "update" : "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
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
