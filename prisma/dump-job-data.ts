// Dump data pekerjaan karyawan lama (sebelum kolom dihapus dari schema Employee)
// Output: /tmp/job-dump.json
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const employees = await db.employee.findMany({
    select: {
      id: true, employeeNo: true, fullName: true, joinDate: true, status: true,
      orgUnitId: true, positionId: true, gradeId: true, managerId: true,
      employmentStatus: true, workShift: true, baseSalary: true,
    },
  });
  await Bun.write("/tmp/job-dump.json", JSON.stringify(employees, null, 1));
  console.log("dumped:", employees.length, "employees");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
