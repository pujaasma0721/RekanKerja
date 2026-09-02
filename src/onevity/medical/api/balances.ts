import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listBalances, generateBalances, listBenefitTypes } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/balances?year=&employeeId=&typeId= — saldo medis
// karyawan per jenis (padanan Employee Medical Information / My Medical Information)
// + jenis & karyawan utk filter form.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") ?? new Date().getFullYear());
    const [balances, types, employees] = await Promise.all([
      listBalances(db, {
        year,
        employeeId: sp.get("employeeId") ?? undefined,
        typeId: sp.get("typeId") ?? undefined,
      }),
      listBenefitTypes(db),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    const years = await db.medicalBalance.findMany({
      select: { year: true }, distinct: ["year"], orderBy: { year: "desc" },
    });
    return NextResponse.json({
      balances, types, employees,
      years: years.map((y) => y.year),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — generate saldo medis per tahun (padanan GenerateMedicalBenefitInfo.jsp:
// period + jenis opsional + Benefit Limit Correction + semua/spesifik karyawan).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    const year = Number(b.year ?? 0);
    if (!year) return NextResponse.json({ error: "year wajib" }, { status: 400 });
    const res = await generateBalances(db, {
      year,
      typeId: b.typeId ? String(b.typeId) : undefined,
      limitCorrection: Boolean(b.limitCorrection),
      employeeIds: Array.isArray(b.employeeIds) ? b.employeeIds.map(String) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
