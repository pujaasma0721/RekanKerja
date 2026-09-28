import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/onevity/shared/services/menu-access";
import { listBenefitTypes, upsertBenefitType } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/types — master jenis benefit (padanan MedicalBenefitTypeDetail.jsp).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["medical:medical-benefit-type", "medical:medical-claim", "medical:medical-adjustment"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const types = await listBenefitTypes(db);
    return NextResponse.json({ types });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat/ubah jenis benefit (kebijakan limit/frekuensi/dependent/unused).
// Task 32-d / fix audit 40 §5: requireMutator longgar → requireMenuAction —
// master jenis benefit = medical:medical-benefit-type (view Jenis Benefit;
// aksi dasar create (baru) / update (ubah) per pengguna; VIEWER tetap 403).
// Body dibaca SEKALI sebelum guard (b.id menentukan create vs update).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.name || (!b.id && !b.code)) {
      return NextResponse.json({ error: "code & name wajib" }, { status: 400 });
    }
    const m = await requireMenuAction(req, "medical:medical-benefit-type", b.id ? "update" : "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const id = await upsertBenefitType(m.db, {
      id: b.id ? String(b.id) : undefined,
      code: String(b.code ?? ""),
      name: String(b.name ?? ""),
      description: b.description ? String(b.description) : undefined,
      needReceipt: b.needReceipt !== false,
      limitRule: String(b.limitRule ?? "NOMINAL"),
      limitValue: Number(b.limitValue ?? 0),
      wageCode: b.wageCode ? String(b.wageCode) : undefined,
      freqUnlimited: Boolean(b.freqUnlimited),
      freqValue: Number(b.freqValue ?? 0),
      freqPeriod: String(b.freqPeriod ?? "YEAR"),
      pctCompany: Number(b.pctCompany ?? 100),
      pctInsurance: Number(b.pctInsurance ?? 0),
      insuranceCompany: b.insuranceCompany ? String(b.insuranceCompany) : undefined,
      unusedRule: String(b.unusedRule ?? "FORFEITED"),
      cashWageCode: b.cashWageCode ? String(b.cashWageCode) : undefined,
      maxCarryOver: Number(b.maxCarryOver ?? 0),
      dependentEnabled: b.dependentEnabled !== false,
      maxDependents: Number(b.maxDependents ?? 2),
      maxChildAge: Number(b.maxChildAge ?? 21),
      depLimitRule: String(b.depLimitRule ?? "SHARED"),
      active: b.active !== false,
    });
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
