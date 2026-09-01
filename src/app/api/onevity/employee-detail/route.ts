import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/employee-detail?id=
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, code: true } },
        orgUnit: { select: { name: true, code: true } },
        position: { select: { title: true, code: true, level: true } },
        grade: { select: { code: true, name: true, minSalary: true, maxSalary: true } },
        manager: { select: { id: true, fullName: true, employeeNo: true, position: { select: { title: true } } } },
        directReports: { select: { id: true, fullName: true, employeeNo: true, position: { select: { title: true } } }, orderBy: { employeeNo: "asc" } },
        family: { orderBy: { birthDate: "asc" } },
        education: { orderBy: { endYear: "desc" } },
        experiences: { orderBy: { endDate: "desc" } },
        disciplinary: { orderBy: { issuedAt: "desc" } },
        actions: {
          orderBy: { createdAt: "desc" },
          select: { id: true, docNo: true, type: true, status: true, effectiveDate: true },
        },
      },
    });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ employee });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/employee-detail?id=
export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const b = await req.json();
    const data: Record<string, unknown> = {};
    const fields = [
      "fullName", "gender", "birthPlace", "nationalId", "taxId", "bpjsHealth", "bpjsEmpSkill",
      "maritalStatus", "religion", "bloodType", "email", "phone", "address", "city",
      "bankName", "bankAccount", "employmentStatus", "workShift", "orgUnitId", "positionId",
      "gradeId", "managerId",
    ];
    for (const f of fields) if (b[f] !== undefined) data[f] = b[f];
    if (b.birthDate !== undefined) data.birthDate = b.birthDate ? new Date(b.birthDate) : null;
    if (b.joinDate !== undefined) data.joinDate = b.joinDate ? new Date(b.joinDate) : undefined;
    if (b.baseSalary !== undefined) data.baseSalary = Number(b.baseSalary);

    const employee = await db.employee.update({ where: { id }, data });
    await db.activityLog.create({
      data: { action: "Updated", entity: "Employee", entityId: id, employeeId: id, detail: `Data ${employee.fullName} diperbarui` },
    });
    return NextResponse.json({ employee });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
