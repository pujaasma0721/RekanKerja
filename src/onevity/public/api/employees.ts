// GET /api/public/employees?status=&unit=&limit=&offset= — daftar ringkas.
// Scope: employees. Respons: { data: { employees, total, limit, offset } }.
import { NextRequest, NextResponse } from "next/server";
import { requirePublicApi, publicOk, publicError, auditPublicApi } from "@/onevity/public/api/guard";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await requirePublicApi(req, "employees");
  if (!g.ok) return g.response;
  const auth = g.auth; // { db, tenant, key }
  const db = auth.db;

  try {
    const sp = req.nextUrl.searchParams;
    // default: hanya karyawan AKTIF (direktori publik); ?status=all utk semua,
    // ?status=inactive utk agregat non-aktif, atau nilai eksplisit lain.
    const status = sp.get("status")?.trim() ?? "Active";
    const unit = sp.get("unit")?.trim() ?? "";
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);

    const where: Record<string, unknown> = {};
    if (status !== "all") {
      // "inactive" = agregat status non-aktif (selaras API internal)
      where.status = status === "inactive" ? { in: ["Resigned", "Terminated", "Blacklisted"] } : status;
    }
    // filter unit via assignment aktif: id ATAU kode unit (case-insensitive)
    if (unit && unit !== "all") {
      where.assignments = {
        some: {
          validTo: null,
          orgUnit: { OR: [{ id: unit }, { code: { equals: unit, mode: "insensitive" } }] },
        },
      };
    }

    const [rows, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          email: true,
          status: true,
          joinDate: true,
          assignments: {
            where: { validTo: null },
            select: { orgUnit: { select: { name: true } }, position: { select: { title: true } } },
            take: 1,
          },
        },
        orderBy: [{ status: "asc" }, { employeeNo: "asc" }],
        take: limit,
        skip: offset,
      }),
      db.employee.count({ where }),
    ]);

    const employees = rows.map((r) => ({
      id: r.id,
      employeeNo: r.employeeNo,
      fullName: r.fullName,
      email: r.email,
      unit: r.assignments[0]?.orgUnit?.name ?? null,
      position: r.assignments[0]?.position?.title ?? null,
      status: r.status,
      joinDate: r.joinDate,
    }));

    auditPublicApi(db, auth, {
      method: "GET", path: "/api/public/employees", status: 200, scope: "employees",
      detail: `${employees.length}/${total} karyawan`,
    });
    return publicOk({ employees, total, limit, offset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    auditPublicApi(db, auth, { method: "GET", path: "/api/public/employees", status: 500, scope: "employees", detail: msg });
    return publicError(500, msg);
  }
}
