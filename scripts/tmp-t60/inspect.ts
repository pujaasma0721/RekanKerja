import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

async function main() {
  const db = getTenantClient("tenant_pt_mitra_industri_internasional");
  try {
    const company = await db.company.findFirst();
    console.log("COMPANY:", JSON.stringify(company, null, 1));
    const offices = await db.companyOffice.findMany({ select: { code: true, name: true, city: true, npwp: true } });
    console.log("OFFICES:", JSON.stringify(offices));
    const locs = await db.workLocation.findMany({ select: { code: true, name: true, city: true, officeId: true, latitude: true, longitude: true, radiusMeters: true } });
    console.log("LOCATIONS:", JSON.stringify(locs));
    const runs = await db.payrollRun.findMany({ select: { runNo: true, status: true, employeeCount: true, totalBruto: true, totalNet: true, sequence: true } });
    console.log("RUNS:", JSON.stringify(runs));
    const emps = await db.employee.findMany({ select: { employeeNo: true, photoUrl: true, email: true }, orderBy: { employeeNo: "asc" }, take: 3 });
    console.log("EMP SAMPLE:", JSON.stringify(emps));
    const maxNo = await db.employee.findFirst({ select: { employeeNo: true }, orderBy: { employeeNo: "desc" } });
    console.log("MAX EMP NO:", maxNo);
    const assets = await db.asset.count();
    const assetAssign = await db.assetAssignment.count();
    const offboardings = await db.offboarding.count();
    const announcements = await db.announcement.count();
    const letters = await db.letterTemplate.count();
    const docTypes = await db.employeeDocument.count();
    const appUsers = await db.appUser.count();
    const leaveBal = await db.leaveBalance.count();
    const clockLogs = await db.attendanceClockLog.count();
    console.log({ assets, assetAssign, offboardings, announcements, letters, docTypes, appUsers, leaveBal, clockLogs });
    const orgs = await db.orgUnit.findMany({ select: { code: true, name: true, level: true, headcountBudget: true }, orderBy: { code: "asc" } });
    console.log("ORGS:", orgs.map(o => `${o.code}|${o.name}|L${o.level}|hc${o.headcountBudget}`).join("\n"));
    const pos = await db.position.findMany({ select: { code: true, title: true, headcount: true, filled: true, positionLevelId: true }, orderBy: { code: "asc" } });
    console.log("POSITIONS:", pos.map(p => `${p.code}|${p.title}|hc${p.headcount}|f${p.filled}`).join("\n"));
    const jobs = await db.job.findMany({ select: { code: true, title: true, category: true } });
    console.log("JOBS:", jobs.map(j => `${j.code}|${j.title}|${j.category}`).join(", "));
    const lvl = await db.positionLevel.findMany({ select: { code: true, name: true, sortOrder: true } });
    console.log("LEVELS:", lvl.map(l => `${l.code}|${l.name}`).join(", "));
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
