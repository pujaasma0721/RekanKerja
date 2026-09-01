import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { PTKP_ANNUAL } from "@/lib/onevity/payroll-engine";

// GET /api/onevity/tax-parameters — bracket + TER + regulasi aktif + PTKP referensi
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const [brackets, ter, regulation] = await Promise.all([
      db.taxBracket.findMany({ where: { bracketType: "Income" }, orderBy: { lowerLimit: "asc" } }),
      db.terRate.findMany({ orderBy: [{ category: "asc" }, { lowerLimit: "asc" }] }),
      db.payrollRegulation.findFirst({ where: { active: true }, orderBy: { validFrom: "desc" } }),
    ]);
    return NextResponse.json({ brackets, ter, regulation, ptkp: PTKP_ANNUAL });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/tax-parameters — update parameter regulasi (BPJS, biaya jabatan, TER)
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    const regulation = await db.payrollRegulation.findFirst({ where: { active: true }, orderBy: { validFrom: "desc" } });
    if (!regulation) return NextResponse.json({ error: "Regulasi aktif tidak ditemukan" }, { status: 404 });

    const num = (v: unknown) => (v == null ? undefined : Number(v));
    const updated = await db.payrollRegulation.update({
      where: { id: regulation.id },
      data: {
        biayaJabatanRate: num(b.biayaJabatanRate),
        biayaJabatanCapMonthly: num(b.biayaJabatanCapMonthly),
        jhtEmployeeRate: num(b.jhtEmployeeRate),
        jhtCompanyRate: num(b.jhtCompanyRate),
        jpEmployeeRate: num(b.jpEmployeeRate),
        jpCompanyRate: num(b.jpCompanyRate),
        jpSalaryCap: num(b.jpSalaryCap),
        jkkRate: num(b.jkkRate),
        jkmRate: num(b.jkmRate),
        jpkCompanyRate: num(b.jpkCompanyRate),
        jpkEmployeeRate: num(b.jpkEmployeeRate),
        jpkSalaryCap: num(b.jpkSalaryCap),
        nonNpwpSurcharge: num(b.nonNpwpSurcharge),
        useTer: b.useTer,
      },
    });
    await db.activityLog.create({
      data: { action: "Updated", entity: "PayrollRegulation", entityId: regulation.id, detail: `Parameter regulasi ${regulation.code} diperbarui (useTer=${updated.useTer})` },
    });
    return NextResponse.json({ regulation: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
