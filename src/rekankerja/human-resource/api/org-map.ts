import { NextRequest, NextResponse } from "next/server";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";



// GET /api/rekankerja/org-map
// Comprehensive org map: merges people (active), org units, positions,
// vacancies, salary cost, disciplinary & active actions into one payload.
const gradeRank = (code: string | null | undefined) => {
  if (!code) return 0;
  const n = Number(code.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — payload memuat struktur
    // organisasi + monthlyCost ber-gate vault; cukup sensitif utk diguard).
    const m = await requireMenuViewAny(req, ["hr:chart"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const [company, units, positions, employees, disciplinary, activeActions] = await Promise.all([
      db.company.findFirst({ select: { id: true, code: true, name: true, shortName: true } }),
      db.orgUnit.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true, parentId: true, level: true, headcountBudget: true },
        orderBy: { level: "asc" },
      }),
      db.position.findMany({
        where: { active: true },
        select: {
          id: true, code: true, title: true, headcount: true,
          grade: { select: { code: true } },
          orgUnit: { select: { id: true, name: true } },
          reportsToId: true,
          reportsTo: { select: { id: true, title: true } },
        },
      }),
      db.employee.findMany({
        select: {
          id: true, employeeNo: true, fullName: true, gender: true, status: true, joinDate: true,
          // data pekerjaan saat ini dari assignment aktif
          assignments: {
            where: { validTo: null },
            orderBy: { validFrom: "desc" },
            take: 1,
            select: {
              employmentStatus: true, baseSalary: true, managerId: true,
              positionId: true, position: { select: { id: true, code: true, title: true } },
              grade: { select: { code: true } },
              orgUnitId: true, orgUnit: { select: { id: true, name: true } },
            },
          },
        },
      }),
      db.disciplinaryRecord.findMany({ select: { employeeId: true } }),
      db.personnelAction.findMany({
        where: { status: { in: ["Prepared", "Submitted"] } },
        select: { employeeId: true },
      }),
    ]);

    if (!company) return NextResponse.json({ error: "Company belum di-set" }, { status: 400 });

    const discCount = new Map<string, number>();
    for (const d of disciplinary) discCount.set(d.employeeId, (discCount.get(d.employeeId) ?? 0) + 1);
    const actCount = new Map<string, number>();
    for (const a of activeActions) actCount.set(a.employeeId, (actCount.get(a.employeeId) ?? 0) + 1);

    // ---- people (active only — current org, data dari assignment aktif) ----
    // 45-b: gerbang vault uang — baseSalary display digate (masked → null);
    // sort unit-head + monthlyCost tetap dihitung dari nilai RAW (compute).
    const mv = await moneyViewForReq(req, db);
    // T105: bila brankas uang terkunci, jangan kirim angka biaya sama sekali —
    // null + flag moneyMasked agar UI merender "—" (bukan "Rp 0" yang menyesatkan).
    const moneyMasked = !mv.canSee;
    const tc = tenantCryptoForDb(db);
    const active = employees.map((e) => {
      const cur = e.assignments[0] ?? null;
      const salaryRaw = cur ? (tc.decryptMoney(cur.baseSalary) ?? 0) : 0;
      return {
        id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, gender: e.gender, status: e.status, joinDate: e.joinDate,
        employmentStatus: cur?.employmentStatus ?? "—",
        // 28-c: baseSalary terenkripsi — dekripsi di batas serializer (gate 45-b).
        baseSalary: cur ? (mv.canSee ? salaryRaw : null) : 0,
        salaryRaw,
        positionId: cur?.positionId ?? null,
        position: cur?.position ?? null,
        grade: cur?.grade ?? null,
        orgUnitId: cur?.orgUnitId ?? null,
        orgUnit: cur?.orgUnit ?? null,
        managerId: cur?.managerId ?? null,
      };
    }).filter((e) => e.status === "Active");
    const people = active.map((e) => ({
      id: e.id,
      employeeNo: e.employeeNo,
      fullName: e.fullName,
      gender: e.gender,
      status: e.status,
      employmentStatus: e.employmentStatus,
      joinDate: e.joinDate,
      baseSalary: e.baseSalary,
      positionId: e.positionId ?? e.position?.id ?? null,
      positionCode: e.position?.code ?? null,
      positionTitle: e.position?.title ?? null,
      gradeCode: e.grade?.code ?? null,
      unitId: e.orgUnitId ?? e.orgUnit?.id ?? null,
      unitName: e.orgUnit?.name ?? null,
      managerId: e.managerId,
      disciplinaryCount: discCount.get(e.id) ?? 0,
      activeActionsCount: actCount.get(e.id) ?? 0,
    }));

    // ---- unit head: highest grade (tie-break: salary) among direct members ----
    const unitHead = new Map<string, string>();
    for (const u of units) {
      const members = active.filter((e) => (e.orgUnitId ?? e.orgUnit?.id) === u.id);
      if (members.length === 0) continue;
      const sorted = [...members].sort(
        (a, b) =>
          gradeRank(b.grade?.code) - gradeRank(a.grade?.code) ||
          b.salaryRaw - a.salaryRaw ||
          a.employeeNo.localeCompare(b.employeeNo)
      );
      unitHead.set(u.id, sorted[0]!.id);
    }

    // ---- vacancies: open slots = headcount - active holders ----
    const activeByPos = new Map<string, number>();
    for (const p of people) {
      if (p.positionId) activeByPos.set(p.positionId, (activeByPos.get(p.positionId) ?? 0) + 1);
    }
    const vacancies = positions
      .map((p) => {
        const filled = activeByPos.get(p.id) ?? 0;
        const slots = Math.max(0, p.headcount - filled);
        return slots > 0
          ? {
              id: `vac-${p.id}`,
              positionId: p.id,
              code: p.code,
              title: p.title,
              gradeCode: p.grade?.code ?? null,
              unitId: p.orgUnit?.id ?? null,
              unitName: p.orgUnit?.name ?? null,
              slots,
              reportsToId: p.reportsToId,
              reportsToTitle: p.reportsTo?.title ?? null,
            }
          : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    // ---- stats ----
    const reportCounts = new Map<string, number>();
    for (const p of people) {
      if (p.managerId) reportCounts.set(p.managerId, (reportCounts.get(p.managerId) ?? 0) + 1);
    }
    const managers = [...reportCounts.values()].filter((n) => n > 0);
    const monthlyCostRaw = active.reduce((acc, e) => acc + e.salaryRaw, 0);
    const totalSlots = positions.reduce((acc, p) => acc + p.headcount, 0);
    const totalFilled = positions.reduce((acc, p) => acc + Math.min(p.headcount, activeByPos.get(p.id) ?? 0), 0);

    const positionsOut = positions.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      gradeCode: p.grade?.code ?? null,
      unitId: p.orgUnit?.id ?? null,
      unitName: p.orgUnit?.name ?? null,
      headcount: p.headcount,
      filled: Math.min(p.headcount, activeByPos.get(p.id) ?? 0),
      reportsToTitle: p.reportsTo?.title ?? null,
    }));

    return NextResponse.json({
      company,
      moneyMasked,
      stats: {
        activeEmployees: people.length,
        totalEmployees: employees.length,
        probation: people.filter((p) => p.employmentStatus === "Probation").length,
        contract: people.filter((p) => p.employmentStatus === "Contract").length,
        units: units.length,
        positions: positions.length,
        totalSlots,
        filledPositions: totalFilled,
        vacancies: totalSlots - totalFilled,
        monthlyCost: moneyMasked ? null : monthlyCostRaw,
        avgSpan: managers.length ? Number((managers.reduce((a, b) => a + b, 0) / managers.length).toFixed(1)) : 0,
      },
      people,
      positions: positionsOut,
      units: units.map((u) => ({
        id: u.id, code: u.code, name: u.name, parentId: u.parentId,
        level: u.level, headcountBudget: u.headcountBudget,
        headId: unitHead.get(u.id) ?? null,
      })),
      vacancies,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
