import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { CURRENT_ASSIGNMENT_INCLUDE, flattenEmployee } from "@/lib/onevity/assignment";

// GET /api/onevity/employees?q=...&status=...&unit=...&employmentStatus=...&limit=&offset=
// Multi-tenant: db = schema tenant dari session cookie (isolasi per workspace).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
        { assignments: { some: { validTo: null, position: { title: { contains: q } } } } },
      ];
    }
    if (status && status !== "all") {
      // "inactive" = agregat semua status non-aktif
      where.status = status === "inactive" ? { in: ["Resigned", "Terminated", "Blacklisted"] } : status;
    }
    // filter pekerjaan via assignment aktif
    const assignSome: Record<string, unknown> = { validTo: null };
    if (employmentStatus && employmentStatus !== "all") assignSome.employmentStatus = employmentStatus;
    if (unit && unit !== "all") assignSome.orgUnitId = unit;
    if (Object.keys(assignSome).length > 1) where.assignments = { some: assignSome };

    const [employeesRaw, total, statusAgg, empStatusAgg] = await Promise.all([
      db.employee.findMany({
        where,
        include: CURRENT_ASSIGNMENT_INCLUDE,
        orderBy: [{ status: "asc" }, { employeeNo: "asc" }],
        take: limit,
        skip: offset,
      }),
      db.employee.count({ where }),
      db.employee.groupBy({ by: ["status"], _count: true }),
      db.employeeAssignment.groupBy({ by: ["employmentStatus"], where: { validTo: null }, _count: true }),
    ]);

    const employees = employeesRaw.map((e) => {
      const flat = flattenEmployee(e);
      // strip array dari response agar payload ramping
      const { assignments, ...rest } = flat as Record<string, unknown>;
      return rest;
    });

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
// Membuat employee (data personal + lifecycle) + assignment awal (data pekerjaan).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    const company = await db.company.findFirst();
    if (!company) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    // auto employeeNo
    const last = await db.employee.findFirst({ orderBy: { employeeNo: "desc" }, select: { employeeNo: true } });
    const nextNo = last ? Number(last.employeeNo.replace(/\D/g, "")) + 1 : 1;
    const employeeNo = `MII${String(nextNo).padStart(5, "0")}`;

    const joinDate = b.joinDate ? new Date(b.joinDate) : new Date();

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
        joinDate,
        status: "Active",
      },
    });

    // penempatan awal → riwayat pekerjaan baris pertama
    await db.employeeAssignment.create({
      data: {
        employeeId: employee.id,
        orgUnitId: b.orgUnitId ?? null,
        positionId: b.positionId ?? null,
        gradeId: b.gradeId ?? null,
        managerId: b.managerId ?? null,
        employmentStatus: b.employmentStatus ?? "Probation",
        workShift: b.workShift ?? "Regular",
        baseSalary: b.baseSalary ?? 0,
        validFrom: joinDate,
        validTo: null,
        changeReason: "Initial",
        notes: "Penempatan awal saat onboarding",
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
