// Restore: buat EmployeeAssignment dari dump data pekerjaan lama (/tmp/job-dump.json)
// - setiap karyawan: 1 assignment "Initial" (validFrom = joinDate, validTo = null)
// - 4 karyawan senior diberi riwayat demo: 1 assignment lampau (promosi/mutasi) + assignment sekarang
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Dump = {
  id: string; employeeNo: string; fullName: string; joinDate: string; status: string;
  orgUnitId: string | null; positionId: string | null; gradeId: string | null; managerId: string | null;
  employmentStatus: string; workShift: string; baseSalary: number;
};

const JOB_FIELDS = ["orgUnitId", "positionId", "gradeId", "managerId", "employmentStatus", "workShift", "baseSalary"] as const;

async function main() {
  const dump: Dump[] = JSON.parse(await Bun.file("/tmp/job-dump.json").text());
  const grades = await db.grade.findMany({ orderBy: { sortOrder: "asc" } });
  const gradeIdx = (id: string | null) => grades.findIndex((g) => g.id === id);

  let created = 0;
  // 1) assignment awal untuk semua karyawan
  for (const d of dump) {
    const join = new Date(d.joinDate);
    await db.employeeAssignment.create({
      data: {
        employeeId: d.id,
        orgUnitId: d.orgUnitId, positionId: d.positionId, gradeId: d.gradeId, managerId: d.managerId,
        employmentStatus: d.employmentStatus, workShift: d.workShift, baseSalary: d.baseSalary,
        validFrom: join, validTo: null,
        changeReason: "Initial", notes: "Penempatan awal saat onboarding",
      },
    });
    created++;
  }
  console.log("initial assignments:", created);

  // 2) riwayat demo untuk 4 karyawan senior (join < 2016, grade >= G5):
  //    pecah masa kerja jadi 2 periode — posisi/grade lebih rendah di masa lampau
  const seniors = dump
    .filter((d) => new Date(d.joinDate).getFullYear() < 2016)
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
    .slice(0, 4);

  const reasons = ["Promotion", "Promotion", "Transfer", "Mutation"];
  let demo = 0;
  for (let i = 0; i < seniors.length; i++) {
    const s = seniors[i];
    const reason = reasons[i % reasons.length];
    const join = new Date(s.joinDate);
    const cutoff = new Date(2022, 6, 1); // 1 Jul 2022 — titik perubahan

    // cari posisi lampau: grade satu tingkat lebih rendah, posisi lain di unit yang sama
    const curGradeIdx = gradeIdx(s.gradeId);
    const prevGrade = curGradeIdx > 0 ? grades[curGradeIdx - 1] : null;
    const prevGradeId = reason === "Promotion" ? (prevGrade?.id ?? s.gradeId) : s.gradeId;
    const unitPositions = s.orgUnitId
      ? await db.position.findMany({ where: { orgUnitId: s.orgUnitId, id: { not: s.positionId ?? "" } }, take: 5 })
      : [];
    const sameUnitOther = unitPositions[i % Math.max(1, unitPositions.length)] ?? null;

    // perkecil assignment awal: validTo = cutoff, downgrade posisi/grade/gaji
    const initial = await db.employeeAssignment.findFirst({ where: { employeeId: s.id, validTo: null } });
    if (!initial) continue;
    await db.employeeAssignment.update({
      where: { id: initial.id },
      data: {
        validTo: cutoff,
        gradeId: prevGradeId,
        positionId: reason === "Transfer" || reason === "Mutation" ? (sameUnitOther?.id ?? s.positionId) : s.positionId,
        baseSalary: Math.round(s.baseSalary * 0.72),
      },
    });
    // assignment sekarang: mulai cutoff dengan data final
    await db.employeeAssignment.create({
      data: {
        employeeId: s.id,
        orgUnitId: s.orgUnitId, positionId: s.positionId, gradeId: s.gradeId, managerId: s.managerId,
        employmentStatus: s.employmentStatus, workShift: s.workShift, baseSalary: s.baseSalary,
        validFrom: cutoff, validTo: null,
        changeReason: reason,
        sourceDocNo: `PA-2022-${String(101 + i).padStart(4, "0")}`,
        notes: reason === "Promotion" ? "Kenaikan jenjang karier" : reason === "Transfer" ? "Perpindahan penempatan" : "Mutasi penyesuaian organisasi",
      },
    });
    demo++;
    console.log(`  demo history: ${s.fullName} (${s.employeeNo}) — ${reason} @ 2022-07`);
  }
  console.log("demo histories:", demo);

  // 3) sanity: setiap karyawan aktif punya tepat 1 assignment aktif
  const bad = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, fullName: true, _count: { select: { assignments: { where: { validTo: null } } } } },
  });
  const broken = bad.filter((e) => e._count.assignments !== 1);
  console.log(broken.length === 0 ? "SANITY OK: semua karyawan aktif punya 1 assignment aktif" : `SANITY FAIL: ${broken.map((b) => b.fullName).join(", ")}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
