import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listBenefitTypes, upsertBenefitType } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/types — master jenis benefit (padanan MedicalBenefitTypeDetail.jsp).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const types = await listBenefitTypes(db);
    return NextResponse.json({ types });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat/ubah jenis benefit (kebijakan limit/frekuensi/dependent/unused).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.name || (!b.id && !b.code)) {
      return NextResponse.json({ error: "code & name wajib" }, { status: 400 });
    }
    const id = await upsertBenefitType(db, {
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
