import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// ============================================================================
// RECRUITMENT F1 — opsi dropdown form PR (SELECT sempit — tanpa PII luas,
// pola M-11 audit 42: hanya id/nama/kode yang benar-benar dipakai form).
//   GET /api/rekankerja/recruitment/pr-options
//     → { employees, positions, jobs, orgUnits, offices }
// Guard: view-any recruitment:pr ATAU recruitment:pr-approval (inbox butuh
// nama requester/officer untuk display — data sama dengan baris list).
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:pr", "recruitment:pr-approval"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const [employees, positions, jobs, orgUnits, offices] = await Promise.all([
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true, position: { select: { title: true } } },
        orderBy: [{ employeeNo: "asc" }],
        take: 500,
      }),
      db.position.findMany({
        where: { active: true },
        select: { id: true, code: true, title: true, orgUnit: { select: { name: true } } },
        orderBy: [{ code: "asc" }],
      }),
      db.job.findMany({ where: { active: true }, select: { id: true, code: true, title: true }, orderBy: [{ code: "asc" }] }),
      db.orgUnit.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: [{ code: "asc" }] }),
      db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: [{ code: "asc" }] }),
    ]);

    return NextResponse.json({
      employees: employees.map((e) => ({
        id: e.id, employeeNo: e.employeeNo, fullName: e.fullName,
        positionTitle: e.position?.title ?? null,
      })),
      positions: positions.map((p) => ({
        id: p.id, code: p.code, title: p.title,
        orgUnitName: p.orgUnit?.name ?? null,
      })),
      jobs: jobs.map((j) => ({ id: j.id, code: j.code, title: j.title })),
      orgUnits: orgUnits.map((o) => ({ id: o.id, code: o.code, name: o.name })),
      offices: offices.map((o) => ({ id: o.id, code: o.code, name: o.name, city: o.city })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
