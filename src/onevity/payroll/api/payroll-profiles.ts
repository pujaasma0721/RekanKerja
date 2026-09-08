import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { PTKP_ANNUAL } from "@/onevity/payroll/services/payroll-engine";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

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
      // 28-c: konteks dekripsi per-tenant di batas serializer.
      const tc = tenantCryptoForDb(db);
      return {
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        orgUnitName: a?.orgUnit?.name ?? null,
        positionName: a?.position?.title ?? null,
        gradeName: a?.grade?.name ?? null,
        // 28-c: baseSalary + npwp/rekening terenkripsi — dekripsi di batas serializer.
        baseSalary: a ? (tc.decryptMoney(a.baseSalary) ?? 0) : 0,
        profile: p
          ? {
              id: p.id,
              npwp: tc.decryptText(p.npwp) ?? tc.decryptText(e.taxId),
              hasNpwp: p.hasNpwp,
              processMethod: p.processMethod,
              paymentFrequency: p.paymentFrequency,
              wageTemplateId: p.wageTemplateId,
              wageTemplateName: p.wageTemplate?.name ?? null,
              taxStatus: p.taxStatus,
              ptkpValue: PTKP_ANNUAL[p.taxStatus] ?? PTKP_ANNUAL.TK0,
              dependents: p.dependents,
              bankName: p.bankName ?? e.bankName ?? null,
              bankAccount: tc.decryptText(p.bankAccount) ?? tc.decryptText(e.bankAccount),
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

    // 28-c: npwp/rekening dienkripsi saat disimpan (enc:v1:t:…).
    const tcW = tenantCryptoForDb(db);
    const data = {
      npwp: b.npwp != null ? tcW.encryptText(String(b.npwp)) : undefined,
      hasNpwp: b.hasNpwp,
      processMethod: b.processMethod,
      paymentFrequency: b.paymentFrequency,
      wageTemplateId: b.wageTemplateId === "" ? null : b.wageTemplateId,
      taxStatus,
      dependents: b.dependents != null ? Math.max(0, Math.min(3, Number(b.dependents))) : undefined,
      bankName: b.bankName,
      bankAccount: b.bankAccount != null ? tcW.encryptText(String(b.bankAccount)) : undefined,
    };

    const existing = await db.employeePayrollProfile.findUnique({ where: { employeeId: b.employeeId } });
    const profile = existing
      ? await db.employeePayrollProfile.update({ where: { employeeId: b.employeeId }, data, include: { wageTemplate: true } })
      : await db.employeePayrollProfile.create({ data: { ...data, employeeId: b.employeeId }, include: { wageTemplate: true } });

    await db.activityLog.create({
      data: { action: "Updated", entity: "EmployeePayrollProfile", entityId: profile.id, employeeId: b.employeeId, detail: `Data payroll karyawan diperbarui (PTKP ${profile.taxStatus}, ${profile.processMethod})` },
    });
    // 28-c: response profil di-dekripsi (bentuk lama utk UI).
    return NextResponse.json({ profile: { ...profile, npwp: tcW.decryptText(profile.npwp), bankAccount: tcW.decryptText(profile.bankAccount) } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
