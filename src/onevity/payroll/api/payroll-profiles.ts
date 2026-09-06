import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { PTKP_ANNUAL } from "@/onevity/payroll/services/payroll-engine";

// GET /api/onevity/payroll-profiles?q= — daftar karyawan aktif + profil payroll + assignment aktif
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const q = req.nextUrl.searchParams.get("q")?.trim();
    const employees = await db.employee.findMany({
      where: {
        status: "Active",
        ...(q ? { OR: [{ fullName: { contains: q } }, { employeeNo: { contains: q } }] } : {}),
      },
      include: {
        payrollProfile: { include: { wageTemplate: true } },
        assignments: {
          where: { validTo: null },
          include: { orgUnit: true, position: true, grade: true },
          take: 1,
        },
      },
      orderBy: { employeeNo: "asc" },
    });
    const rows = employees.map((e) => {
      const a = e.assignments[0];
      const p = e.payrollProfile;
      return {
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        orgUnitName: a?.orgUnit?.name ?? null,
        positionName: a?.position?.title ?? null,
        gradeName: a?.grade?.name ?? null,
        baseSalary: a?.baseSalary ?? 0,
        profile: p
          ? {
              id: p.id,
              npwp: p.npwp ?? e.taxId ?? null,
              hasNpwp: p.hasNpwp,
              processMethod: p.processMethod,
              paymentFrequency: p.paymentFrequency,
              wageTemplateId: p.wageTemplateId,
              wageTemplateName: p.wageTemplate?.name ?? null,
              taxStatus: p.taxStatus,
              ptkpValue: PTKP_ANNUAL[p.taxStatus] ?? PTKP_ANNUAL.TK0,
              dependents: p.dependents,
              bankName: p.bankName ?? e.bankName ?? null,
              bankAccount: p.bankAccount ?? e.bankAccount ?? null,
            }
          : null,
      };
    });
    return NextResponse.json({ employees: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/payroll-profiles — upsert profil karyawan
// T1-SECURITY: guard hak AKSI menu payroll:profiles (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:profiles", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });

    const validStatus = Object.keys(PTKP_ANNUAL);
    const taxStatus = b.taxStatus ?? undefined;
    if (taxStatus && !validStatus.includes(taxStatus)) {
      return NextResponse.json({ error: `Status PTKP tidak valid (${validStatus.join(", ")})` }, { status: 400 });
    }

    const data = {
      npwp: b.npwp,
      hasNpwp: b.hasNpwp,
      processMethod: b.processMethod,
      paymentFrequency: b.paymentFrequency,
      wageTemplateId: b.wageTemplateId === "" ? null : b.wageTemplateId,
      taxStatus,
      dependents: b.dependents != null ? Math.max(0, Math.min(3, Number(b.dependents))) : undefined,
      bankName: b.bankName,
      bankAccount: b.bankAccount,
    };

    const existing = await db.employeePayrollProfile.findUnique({ where: { employeeId: b.employeeId } });
    const profile = existing
      ? await db.employeePayrollProfile.update({ where: { employeeId: b.employeeId }, data, include: { wageTemplate: true } })
      : await db.employeePayrollProfile.create({ data: { ...data, employeeId: b.employeeId }, include: { wageTemplate: true } });

    await db.activityLog.create({
      data: { action: "Updated", entity: "EmployeePayrollProfile", entityId: profile.id, employeeId: b.employeeId, detail: `Data payroll karyawan diperbarui (PTKP ${profile.taxStatus}, ${profile.processMethod})` },
    });
    return NextResponse.json({ profile });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
