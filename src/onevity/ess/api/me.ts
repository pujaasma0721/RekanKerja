// GET /api/onevity/ess/me — profil karyawan aktor (kontrak T8-ESS-FRONTEND).
import { NextResponse } from "next/server";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { requireEss, fmtIsoDate, essCanAdmin } from "@/onevity/ess/api/ess-auth";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      include: {
        company: { select: { name: true } },
        position: { select: { title: true, positionLevel: { select: { code: true } } } },
        orgUnit: { select: { name: true } },
        grade: { select: { code: true } },
        positionLevel: { select: { code: true } },
        assignments: {
          where: { validTo: null },
          orderBy: { validFrom: "desc" },
          take: 1,
          select: {
            employmentStatus: true,
            orgUnit: { select: { name: true } },
            position: { select: { title: true, positionLevel: { select: { code: true } } } },
            grade: { select: { code: true } },
            manager: { select: { fullName: true } },
          },
        },
      },
    });
    if (!emp) {
      return NextResponse.json({ error: "Data karyawan tidak ditemukan" }, { status: 404 });
    }
    const a = emp.assignments[0];

    return NextResponse.json({
      employee: {
        id: emp.id,
        employeeNo: emp.employeeNo,
        fullName: emp.fullName,
        photoUrl: emp.photoUrl,
        email: emp.email,
        phone: emp.phone,
        positionTitle: a?.position?.title ?? emp.position?.title ?? null,
        orgUnitName: a?.orgUnit?.name ?? emp.orgUnit?.name ?? null,
        gradeCode: a?.grade?.code ?? emp.grade?.code ?? null,
        levelCode: a?.position?.positionLevel?.code ?? emp.position?.positionLevel?.code
          ?? emp.positionLevel?.code ?? null,
        managerName: a?.manager?.fullName ?? null,
        joinDate: fmtIsoDate(emp.joinDate),
        employmentStatus: a?.employmentStatus ?? null,
        taxId: tenantCryptoForDb(db).decryptText(emp.taxId),
        // Task 52-d — no. BPJS terenkripsi (migrate-encrypt-pii) — dekripsi utk profil sendiri.
        // Task 55 — kunci respons dibetulkan bpjsEmpSkill (semula "bpjsEmpskill"
        // casing salah; ESS lama tidak membacanya — kini konsisten dgn serializer lain).
        bpjsHealth: tenantCryptoForDb(db).decryptText(emp.bpjsHealth),
        bpjsEmpSkill: tenantCryptoForDb(db).decryptText(emp.bpjsEmpSkill),
      },
      companyName: emp.company?.name ?? null,
      role: m.actor.appUserRole,
      canAdmin: essCanAdmin(m.actor),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
