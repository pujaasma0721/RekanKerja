import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { requireScoped, scopeWhere } from "@/onevity/shared/services/access-scope";
import { CURRENT_ASSIGNMENT_INCLUDE, flattenEmployee, syncEmployeePlacementSnapshot } from "@/onevity/human-resource/services/assignment";
import { validateSalaryAgainstGrade, PATargetError } from "@/onevity/human-resource/services/pa-targets";

// GET /api/onevity/employees?q=...&status=...&unit=...&employmentStatus=...&limit=&offset=
// Multi-tenant: db = schema tenant dari session cookie (isolasi per workspace).
// Skema akses data (Task 30): hasil query dibatasi cakupan akses efektif
// pengguna (super admin semua, atasan langsung bawahan, rule parametrik).
export async function GET(req: NextRequest) {
  try {
    const s = await requireScoped(req);
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
    const db = s.db;
    const scopeCond = scopeWhere(s.scope);
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

    // gabungkan dengan cakupan skema akses (AND)
    const scoped: Record<string, unknown> = Object.keys(scopeCond).length > 0 ? { AND: [where, scopeCond] } : where;

    const [employeesRaw, total, statusAgg, empStatusAgg] = await Promise.all([
      db.employee.findMany({
        where: scoped,
        include: CURRENT_ASSIGNMENT_INCLUDE,
        orderBy: [{ status: "asc" }, { employeeNo: "asc" }],
        take: limit,
        skip: offset,
      }),
      db.employee.count({ where: scoped }),
      db.employee.groupBy({ by: ["status"], where: scoped, _count: true }),
      db.employeeAssignment.groupBy({ by: ["employmentStatus"], where: { validTo: null, employee: scoped }, _count: true }),
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
// Fix M-05/M-06: validasi server — gaji dalam rentang grade, FK valid (400 ramah, bukan 500).
// Fix C-02: guard mutasi (VIEWER ditolak; aktor dicatat di ActivityLog).
// Task 32-d: guard hak AKSI menu — create pada menu hr:directory (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.fullName || !String(b.fullName).trim()) {
      return NextResponse.json({ error: "Nama lengkap karyawan wajib diisi" }, { status: 400 });
    }
    const company = await db.company.findFirst();
    if (!company) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    // (d) FK wajib valid → pesan 400 ramah (bukan error 500 prisma)
    if (b.orgUnitId) {
      const u = await db.orgUnit.findUnique({ where: { id: b.orgUnitId }, select: { id: true } });
      if (!u) return NextResponse.json({ error: "Unit organisasi tidak dikenal — pilih ulang unit" }, { status: 400 });
    }
    if (b.positionId) {
      const p = await db.position.findUnique({ where: { id: b.positionId }, select: { id: true } });
      if (!p) return NextResponse.json({ error: "Posisi tidak dikenal — pilih ulang posisi" }, { status: 400 });
    }
    if (b.gradeId) {
      const g = await db.grade.findUnique({ where: { id: b.gradeId }, select: { id: true } });
      if (!g) return NextResponse.json({ error: "Grade tidak dikenal — pilih ulang grade" }, { status: 400 });
    }
    if (b.managerId) {
      const mgr = await db.employee.findUnique({ where: { id: b.managerId }, select: { id: true } });
      if (!mgr) return NextResponse.json({ error: "Atasan langsung tidak dikenal — pilih ulang atasan" }, { status: 400 });
    }
    if (b.companyOfficeId) {
      const o = await db.companyOffice.findUnique({ where: { id: b.companyOfficeId }, select: { id: true } });
      if (!o) return NextResponse.json({ error: "Kantor tidak dikenal — pilih ulang kantor" }, { status: 400 });
    }
    if (b.workLocationId) {
      const w = await db.workLocation.findUnique({ where: { id: b.workLocationId }, select: { id: true } });
      if (!w) return NextResponse.json({ error: "Lokasi kerja tidak dikenal — pilih ulang lokasi" }, { status: 400 });
    }

    // (b) gaji pokok tidak boleh negatif; bila grade dipilih dan mendefinisikan rentang
    // min/max, gaji wajib dalam rentang itu (wizard memang advisory — server yang menegakkan).
    const baseSalary = b.baseSalary !== undefined && b.baseSalary !== null && String(b.baseSalary) !== "" ? Number(b.baseSalary) : 0;
    if (!Number.isFinite(baseSalary) || baseSalary < 0) {
      return NextResponse.json({ error: "Gaji pokok harus berupa angka tidak negatif" }, { status: 400 });
    }
    if (b.gradeId && baseSalary > 0) {
      try {
        await validateSalaryAgainstGrade(db, baseSalary, { gradeId: String(b.gradeId) }, "");
      } catch (e) {
        if (e instanceof PATargetError) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
      }
    }

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
        companyOfficeId: b.companyOfficeId ?? null,
        workLocationId: b.workLocationId ?? null,
        employmentStatus: b.employmentStatus ?? "Probation",
        workShift: b.workShift ?? "Regular",
        baseSalary,
        validFrom: joinDate,
        validTo: null,
        changeReason: "Initial",
        notes: "Penempatan awal saat onboarding",
      },
    });
    // dorong snapshot parameter penempatan (dimensi approval berjenjang — Task 25)
    await syncEmployeePlacementSnapshot(db, employee.id);

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created",
        entity: "Employee",
        entityId: employee.id,
        employeeId: employee.id,
        detail: `Onboarding karyawan ${employee.fullName} (${employeeNo}) oleh ${actor.appUsername ?? actor.name}`,
      },
    });

    return NextResponse.json({ employee }, { status: 201 });
  } catch (e) {
    // FK prisma (P2003) → 400 ramah (fix M-06d: bukan 500)
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "Data referensi tidak valid — periksa unit/posisi/grade/atasan" }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
