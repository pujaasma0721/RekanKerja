import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/employees?q=...&status=...&unit=...&limit=&offset=
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";
    const status = sp.get("status") ?? undefined;
    const unit = sp.get("unit") ?? undefined;
    const employmentStatus = sp.get("employmentStatus") ?? undefined;
    const limit = Math.min(Number(sp.get("limit") ?? 50), 200);
    const offset = Number(sp.get("offset") ?? 0);

    const where: Record<string, unknown> = {};
    if (q) {
      where.OR = [
        { fullName: { contains: q } },
        { employeeNo: { contains: q } },
        { email: { contains: q } },
        { position: { title: { contains: q } } },
      ];
    }
    if (status && status !== "all") {
      // "inactive" = agregat semua status non-aktif
      where.status = status === "inactive" ? { in: ["Resigned", "Terminated", "Blacklisted"] } : status;
    }
    if (employmentStatus && employmentStatus !== "all") where.employmentStatus = employmentStatus;
    if (unit && unit !== "all") where.orgUnitId = unit;

    const [employees, total, statusAgg, empStatusAgg] = await Promise.all([
      db.employee.findMany({
        where,
        include: {
          position: { select: { title: true, code: true } },
          orgUnit: { select: { name: true, code: true } },
          grade: { select: { code: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { employeeNo: "asc" }],
        take: limit,
        skip: offset,
      }),
      db.employee.count({ where }),
      db.employee.groupBy({ by: ["status"], _count: true }),
      db.employee.groupBy({ by: ["employmentStatus"], _count: true }),
    ]);

    const statusCount = (s: string) => statusAgg.find((r) => r.status === s)?._count ?? 0;
    const empCount = (s: string) => empStatusAgg.find((r) => r.employmentStatus === s)?._count ?? 0;

    return NextResponse.json({
      employees,
      total,
      limit,
      offset,
      stats: {
        total,
        active: statusCount("Active"),
        probation: empCount("Probation"),
        contract: empCount("Contract"),
        inactive: statusCount("Resigned") + statusCount("Terminated") + statusCount("Blacklisted"),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/employees — create employee (wizard final step)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const company = await db.company.findFirst();
    if (!company) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    // auto employeeNo
    const last = await db.employee.findFirst({ orderBy: { employeeNo: "desc" }, select: { employeeNo: true } });
    const nextNo = last ? Number(last.employeeNo.replace(/\D/g, "")) + 1 : 1;
    const employeeNo = `MII${String(nextNo).padStart(5, "0")}`;

    const employee = await db.employee.create({
      data: {
        employeeNo,
        fullName: b.fullName,
        gender: b.gender ?? "M",
        birthPlace: b.birthPlace ?? null,
        birthDate: b.birthDate ? new Date(b.birthDate) : null,
        nationalId: b.nationalId ?? null,
        taxId: b.taxId ?? null,
        maritalStatus: b.maritalStatus ?? null,
        religion: b.religion ?? null,
        bloodType: b.bloodType ?? null,
        email: b.email ?? null,
        phone: b.phone ?? null,
        address: b.address ?? null,
        city: b.city ?? null,
        bankName: b.bankName ?? null,
        bankAccount: b.bankAccount ?? null,
        companyId: b.companyId ?? company.id,
        orgUnitId: b.orgUnitId ?? null,
        positionId: b.positionId ?? null,
        gradeId: b.gradeId ?? null,
        employmentStatus: b.employmentStatus ?? "Probation",
        joinDate: b.joinDate ? new Date(b.joinDate) : new Date(),
        managerId: b.managerId ?? null,
        baseSalary: b.baseSalary ?? 0,
        workShift: b.workShift ?? "Regular",
        status: "Active",
      },
    });

    await db.activityLog.create({
      data: {
        action: "Created",
        entity: "Employee",
        entityId: employee.id,
        employeeId: employee.id,
        detail: `Onboarding karyawan ${employee.fullName} (${employeeNo})`,
      },
    });

    return NextResponse.json({ employee }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
