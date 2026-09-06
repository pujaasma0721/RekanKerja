// GET /api/public/payroll-periods — periode payroll + status run terakhir.
// Scope: payroll. Jumlah gaji NILAIKAN (tidak diekspos) — hanya status proses.
import { NextRequest, NextResponse } from "next/server";
import { requirePublicApi, publicOk, publicError, auditPublicApi } from "@/onevity/public/api/guard";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await requirePublicApi(req, "payroll");
  if (!g.ok) return g.response;
  const auth = g.auth; // { db, tenant, key }
  const db = auth.db;

  try {
    const periods = await db.payrollPeriod.findMany({
      orderBy: [{ sptYear: "desc" }, { sptMonth: "desc" }],
      select: {
        id: true, code: true, name: true, payType: true,
        startDate: true, endDate: true, sptMonth: true, sptYear: true, status: true,
        runs: {
          select: {
            id: true, runNo: true, status: true, calculateTax: true,
            processType: { select: { code: true, name: true } },
            _count: { select: { lines: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      take: 100,
    });

    const data = periods.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      payType: p.payType,
      startDate: p.startDate,
      endDate: p.endDate,
      sptMonth: p.sptMonth,
      sptYear: p.sptYear,
      status: p.status,
      runs: p.runs.map((r) => ({
        id: r.id,
        runNo: r.runNo,
        status: r.status, // Draft|Calculated|Confirmed|Paid|Cancelled
        processType: r.processType ? { code: r.processType.code, name: r.processType.name } : null,
        employees: r._count.lines,
        calculateTax: r.calculateTax,
      })),
    }));

    auditPublicApi(db, auth, {
      method: "GET", path: "/api/public/payroll-periods", status: 200, scope: "payroll",
      detail: `${data.length} periode`,
    });
    return publicOk({ periods: data, total: data.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    auditPublicApi(db, auth, { method: "GET", path: "/api/public/payroll-periods", status: 500, scope: "payroll", detail: msg });
    return publicError(500, msg);
  }
}
