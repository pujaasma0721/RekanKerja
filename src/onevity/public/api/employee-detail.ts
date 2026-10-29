// GET /api/public/employees/{employeeId} — detail + assignment aktif.
// Scope: employees. employeeId menerima id internal ATAU employeeNo (MII00042).
import { NextRequest, NextResponse } from "next/server";
import { requirePublicApi, publicOk, publicError, auditPublicApi } from "@/onevity/public/api/guard";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ employeeId: string }> },
): Promise<NextResponse> {
  const g = await requirePublicApi(req, "employees");
  if (!g.ok) return g.response;
  const auth = g.auth; // { db, tenant, key }
  const db = auth.db;

  const employeeId = (await ctx.params).employeeId;
  try {
    const emp = await db.employee.findFirst({
      where: { OR: [{ id: employeeId }, { employeeNo: employeeId }] },
      select: {
        id: true, employeeNo: true, fullName: true, gender: true, email: true, phone: true,
        maritalStatus: true, religion: true, status: true, joinDate: true, endDate: true,
        city: true, address: true,
        orgUnit: { select: { code: true, name: true } },
        position: { select: { code: true, title: true } },
        positionLevel: { select: { code: true, name: true } },
        grade: { select: { code: true, name: true } },
        companyOffice: { select: { code: true, name: true } },
        workLocation: { select: { code: true, name: true } },
        assignments: {
          where: { validTo: null },
          select: {
            id: true, validFrom: true, employmentStatus: true, workShift: true,
            orgUnit: { select: { code: true, name: true } },
            position: { select: { code: true, title: true } },
            grade: { select: { code: true, name: true } },
            companyOffice: { select: { code: true, name: true } },
            workLocation: { select: { code: true, name: true } },
            manager: { select: { employeeNo: true, fullName: true } },
          },
          take: 1,
          orderBy: { validFrom: "desc" },
        },
      },
    });

    if (!emp) {
      auditPublicApi(db, auth, { method: "GET", path: `/api/public/employees/${employeeId}`, status: 404, scope: "employees" });
      return publicError(404, `Karyawan "${employeeId}" tidak ditemukan (id internal atau employeeNo)`);
    }

    const a = emp.assignments[0] ?? null;
    const data = {
      id: emp.id,
      employeeNo: emp.employeeNo,
      fullName: emp.fullName,
      gender: emp.gender,
      email: emp.email,
      phone: emp.phone,
      maritalStatus: emp.maritalStatus,
      religion: emp.religion,
      status: emp.status,
      joinDate: emp.joinDate,
      endDate: emp.endDate,
      city: emp.city,
      address: emp.address,
      // snapshot dimensi aktif (dari Employee — didorong assignment aktif)
      orgUnit: emp.orgUnit ? { code: emp.orgUnit.code, name: emp.orgUnit.name } : null,
      position: emp.position ? { code: emp.position.code, title: emp.position.title } : null,
      positionLevel: emp.positionLevel ? { code: emp.positionLevel.code, name: emp.positionLevel.name } : null,
      grade: emp.grade ? { code: emp.grade.code, name: emp.grade.name } : null,
      companyOffice: emp.companyOffice ? { code: emp.companyOffice.code, name: emp.companyOffice.name } : null,
      workLocation: emp.workLocation ? { code: emp.workLocation.code, name: emp.workLocation.name } : null,
      // assignment aktif (validTo null) — data upah SENGAJA tidak diekspos
      assignment: a
        ? {
            id: a.id,
            validFrom: a.validFrom,
            employmentStatus: a.employmentStatus,
            workShift: a.workShift,
            orgUnit: a.orgUnit ? { code: a.orgUnit.code, name: a.orgUnit.name } : null,
            position: a.position ? { code: a.position.code, title: a.position.title } : null,
            grade: a.grade ? { code: a.grade.code, name: a.grade.name } : null,
            companyOffice: a.companyOffice ? { code: a.companyOffice.code, name: a.companyOffice.name } : null,
            workLocation: a.workLocation ? { code: a.workLocation.code, name: a.workLocation.name } : null,
            manager: a.manager ? { employeeNo: a.manager.employeeNo, fullName: a.manager.fullName } : null,
          }
        : null,
    };

    auditPublicApi(db, auth, {
      method: "GET", path: `/api/public/employees/${employeeId}`, status: 200, scope: "employees",
      detail: emp.employeeNo,
    });
    return publicOk(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    auditPublicApi(db, auth, { method: "GET", path: `/api/public/employees/${employeeId}`, status: 500, scope: "employees", detail: msg });
    return publicError(500, msg);
  }
}
