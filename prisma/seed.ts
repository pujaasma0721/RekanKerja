// OneVity seed — realistic Indonesian company "MII - Mitra Industri Internasional"
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// deterministic pseudo-random
let seed = 42;
const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pad = (n: number, len = 5) => String(n).padStart(len, "0");

const RELIGIONS = ["Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha"];
const MARITAL = ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"];
const BLOOD = ["A", "B", "AB", "O"];

const FIRST_M = ["Budi", "Agus", "Joko", "Rizky", "Andi", "Dedi", "Fajar", "Hendra", "Irfan", "Kurniawan", "Lukman", "Muhammad", "Nanda", "Prasetyo", "Rahmat", "Satria", "Taufik", "Wahyu", "Yusuf", "Zaki", "Bayu", "Dimas", "Eko", "Gilang"];
const FIRST_F = ["Siti", "Dewi", "Ani", "Rina", "Fitri", "Hesti", "Indah", "Kartika", "Lestari", "Maya", "Nurul", "Putri", "Ratna", "Sari", "Tuti", "Wulan", "Yuni", "Zahra", "Ayu", "Citra"];
const LAST = ["Santoso", "Wijaya", "Kusuma", "Pratama", "Saputra", "Hidayat", "Nugroho", "Setiawan", "Ramadhan", "Firmansyah", "Gunawan", "Halim", "Iskandar", "Jatmiko", "Kurnia", "Lubis", "Mahendra", "Nasution", "Oktaviani", "Purnama", "Rahayu", "Susanto", "Tanaka", "Utami", "Wibowo", "Yulianti"];

const CITIES = ["Jakarta", "Bandung", "Surabaya", "Bekasi", "Tangerang", "Depok", "Semarang", "Bogor"];

async function main() {
  console.log("🌱 Seeding OneVity HR Base...");

  // ============ COMPANY ============
  const company = await db.company.create({
    data: {
      code: "MII",
      name: "PT Mitra Industri Internasional",
      shortName: "MII",
      taxId: "01.234.567.8-901.000",
      address: "Jl. Industri Raya Kav. 25, Kawasan Industri Pulogadung",
      city: "Jakarta Timur",
      phone: "021-4600808",
      email: "hrd@mii.co.id",
      website: "www.mii.co.id",
      currency: "IDR",
    },
  });

  // ============ LOOKUPS ============
  const lookups: [string, string[]][] = [
    ["Religion", ["Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Konghucu"]],
    ["MaritalStatus", ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"]],
    ["EmploymentStatus", ["Permanent", "Contract", "Probation", "Outsourcing"]],
    ["BloodType", ["A", "B", "AB", "O"]],
    ["WarningLevel", ["Verbal", "Written", "Final"]],
    ["Violation", ["Keterlambatan", "Absen tanpa izin", "Pelanggaran SOP", "Pelanggaran etika", "Kinerja buruk"]],
    ["EducationLevel", ["SMA", "D3", "S1", "S2", "S3"]],
    ["Relation", ["Spouse", "Child", "Parent", "Sibling"]],
    ["WorkShift", ["Regular", "Shift 1", "Shift 2", "Shift 3"]],
    ["CalcMethod", ["Fixed", "Formula", "Percentage"]],
    ["AccountType", ["Asset", "Liability", "Equity", "Revenue", "Expense"]],
  ];
  for (const [category, labels] of lookups) {
    await db.lookup.createMany({
      data: labels.map((label, i) => ({ category, code: label.toUpperCase().replace(/[^A-Z0-9]/g, ""), label, sortOrder: i })),
    });
  }

  // ============ ORG TREE ============
  const ceo = await db.orgUnit.create({ data: { code: "MII-CEO", name: "CEO Office", companyId: company.id, level: 1, headcountBudget: 1 } });
  const mgmt = await db.orgUnit.create({ data: { code: "MII-MGT", name: "Management", parentId: ceo.id, companyId: company.id, level: 2, headcountBudget: 3 } });

  const divDefs: [string, string, number][] = [
    ["HRD", "Human Resources & General Affairs", 12],
    ["FIN", "Finance & Accounting", 10],
    ["PRD", "Production", 60],
    ["MKT", "Marketing & Sales", 15],
    ["ITD", "Information Technology", 8],
    ["QAD", "Quality Assurance", 9],
  ];
  const divisions: Record<string, string> = {};
  for (const [code, name, budget] of divDefs) {
    const d = await db.orgUnit.create({ data: { code: `MII-${code}`, name, parentId: mgmt.id, companyId: company.id, level: 3, headcountBudget: budget } });
    divisions[code] = d.id;
  }
  // sub-units
  const subDefs: [string, string, string, number][] = [
    ["HRD-RC", "Recruitment", "HRD", 4],
    ["HRD-CB", "Compensation & Benefit", "HRD", 3],
    ["HRD-GA", "General Affairs", "HRD", 5],
    ["FIN-ACC", "Accounting", "FIN", 6],
    ["FIN-TAX", "Tax", "FIN", 4],
    ["PRD-ASSY", "Assembly Line", "PRD", 30],
    ["PRD-QC", "Production QC", "PRD", 12],
    ["PRD-MAINT", "Maintenance", "PRD", 18],
    ["MKT-DIG", "Digital Marketing", "MKT", 8],
    ["MKT-RTL", "Retail Sales", "MKT", 7],
  ];
  const subUnits: Record<string, string> = {};
  for (const [code, name, parent, budget] of subDefs) {
    const s = await db.orgUnit.create({ data: { code: `MII-${code}`, name, parentId: divisions[parent], companyId: company.id, level: 4, headcountBudget: budget } });
    subUnits[code] = s.id;
  }

  // ============ GRADES ============
  const gradeDefs: [string, string, number, number][] = [
    ["G1", "Officer", 4500000, 7000000],
    ["G2", "Senior Officer", 6500000, 10000000],
    ["G3", "Supervisor", 9000000, 14000000],
    ["G4", "Assistant Manager", 13000000, 19000000],
    ["G5", "Manager", 18000000, 28000000],
    ["G6", "Senior Manager", 25000000, 38000000],
    ["G7", "General Manager", 35000000, 52000000],
    ["G8", "Director", 50000000, 80000000],
  ];
  const grades: Record<string, string> = {};
  for (const [code, name, min, max] of gradeDefs) {
    const g = await db.grade.create({ data: { code, name, minSalary: min, maxSalary: max, sortOrder: Number(code.slice(1)) } });
    grades[code] = g.id;
  }

  // ============ JOBS ============
  const jobDefs: [string, string, string][] = [
    ["J-EXEC", "Chief Executive Officer", "Executive"],
    ["J-HRD", "HR Director", "Executive"],
    ["J-HRM", "HR Manager", "Managerial"],
    ["J-HRS", "HR Staff", "Staff"],
    ["J-RCT", "Recruiter", "Staff"],
    ["J-FIN", "Finance Manager", "Managerial"],
    ["J-ACC", "Accountant", "Staff"],
    ["J-PRD", "Production Manager", "Managerial"],
    ["J-OPR", "Production Operator", "Staff"],
    ["J-MKT", "Marketing Manager", "Managerial"],
    ["J-MKS", "Marketing Staff", "Staff"],
    ["J-ITM", "IT Manager", "Managerial"],
    ["J-DEV", "Software Engineer", "Staff"],
    ["J-QAM", "QA Manager", "Managerial"],
    ["J-QAS", "QA Staff", "Staff"],
    ["J-SUP", "Supervisor", "Supervisory"],
  ];
  const jobs: Record<string, string> = {};
  for (const [code, title, category] of jobDefs) {
    const j = await db.job.create({ data: { code, title, category, description: `Responsible for ${title} duties` } });
    jobs[code] = j.id;
  }

  // ============ POSITIONS ============
  const posDefs: [string, string, string, string, string, string, string | null][] = [
    ["P-CEO", "Chief Executive Officer", "J-EXEC", "CEO", "G8", "P-CEO", null],
    ["P-HRD", "HR Director", "J-HRD", "MGT", "G7", "P-CEO", "P-CEO"],
    ["P-HRM", "HR Manager", "J-HRM", "HRD", "G5", "P-HRD", "P-HRD"],
    ["P-HRS", "HR Staff", "J-HRS", "HRD-RC", "G1", "P-HRM", "P-HRM"],
    ["P-RCT", "Recruiter", "J-RCT", "HRD-RC", "G1", "P-HRS", "P-HRM"],
    ["P-CBS", "C&B Staff", "J-HRS", "HRD-CB", "G2", "P-HRS", "P-HRM"],
    ["P-GAS", "GA Staff", "J-HRS", "HRD-GA", "G1", "P-HRS", "P-HRM"],
    ["P-FIN", "Finance Manager", "J-FIN", "FIN", "G5", "P-FIN", "P-HRD"],
    ["P-ACC", "Accountant", "J-ACC", "FIN-ACC", "G2", "P-FIN", "P-FIN"],
    ["P-TAX", "Tax Staff", "J-ACC", "FIN-TAX", "G1", "P-FIN", "P-FIN"],
    ["P-PRD", "Production Manager", "J-PRD", "PRD", "G5", "P-PRD", "P-HRD"],
    ["P-SUP", "Production Supervisor", "J-SUP", "PRD-ASSY", "G3", "P-SUP", "P-PRD"],
    ["P-OPR", "Production Operator", "J-OPR", "PRD-ASSY", "G1", "P-OPR", "P-SUP"],
    ["P-MAINT", "Maintenance Staff", "J-OPR", "PRD-MAINT", "G2", "P-MAINT", "P-SUP"],
    ["P-MKT", "Marketing Manager", "J-MKT", "MKT", "G5", "P-MKT", "P-HRD"],
    ["P-MKS", "Digital Marketing Staff", "J-MKS", "MKT-DIG", "G1", "P-MKS", "P-MKT"],
    ["P-ITM", "IT Manager", "J-ITM", "ITD", "G5", "P-ITM", "P-HRD"],
    ["P-DEV", "Software Engineer", "J-DEV", "ITD", "G2", "P-DEV", "P-ITM"],
    ["P-QAM", "QA Manager", "J-QAM", "QAD", "G5", "P-QAM", "P-HRD"],
    ["P-QAS", "QA Staff", "J-QAS", "QAD", "G1", "P-QAS", "P-QAM"],
  ];
  const positions: Record<string, string> = {};
  for (const [code, title, jobCode, unitCode, gradeCode, _lvl, reportsTo] of posDefs) {
    const orgUnitId = unitCode === "CEO" ? ceo.id : unitCode === "MGT" ? mgmt.id
      : divisions[unitCode] ?? subUnits[unitCode] ?? null;
    const p = await db.position.create({
      data: {
        code, title, jobId: jobs[jobCode], orgUnitId,
        gradeId: grades[gradeCode], level: gradeCode,
        headcount: code.startsWith("P-OPR") ? 30 : code.includes("S") && code !== "P-CEO" ? 3 : 1,
        filled: 0,
        reportsToId: reportsTo ? null : null,
      },
    });
    positions[code] = p.id;
  }
  // second pass: reporting lines
  for (const [code, , , , , , reportsTo] of posDefs) {
    if (reportsTo && positions[code] && positions[reportsTo] && code !== reportsTo) {
      await db.position.update({ where: { id: positions[code] }, data: { reportsToId: positions[reportsTo] } });
    }
  }

  // ============ EMPLOYEES ============
  const empGradeSalary: Record<string, [number, number]> = {
    G1: [4500000, 7000000], G2: [6500000, 10000000], G3: [9000000, 14000000],
    G4: [13000000, 19000000], G5: [18000000, 28000000], G6: [25000000, 38000000],
    G7: [35000000, 52000000], G8: [50000000, 80000000],
  };
  const salaryOf = (grade: string) => {
    const [min, max] = empGradeSalary[grade];
    return Math.round((min + rnd() * (max - min)) / 50000) * 50000;
  };

  // key people first
  const leaderDefs: [string, string, string, string][] = [
    ["Hartono", "Wijaksono", "P-CEO", "G8"],
    ["Sri", "Wahyuni", "P-HRD", "G7"],
    ["Bambang", "Prakoso", "P-FIN", "G5"],
    ["Tri", "Handayani", "P-HRM", "G5"],
    ["Joko", "Susilo", "P-PRD", "G5"],
    ["Rina", "Maulida", "P-MKT", "G5"],
    ["Agus", "Salim", "P-ITM", "G5"],
    ["Dewi", "Anggraini", "P-QAM", "G5"],
  ];
  const empIds: string[] = [];
  let empNo = 1;
  const mkEmployee = async (first: string, last: string, posCode: string, gradeCode: string, opts: { status?: string; empStatus?: string; joinYear?: number; manager?: string } = {}) => {
    const gender = FIRST_F.includes(first) ? "F" : "M";
    const joinDate = new Date(opts.joinYear ?? randInt(2015, 2024), randInt(0, 11), randInt(1, 28));
    const e = await db.employee.create({
      data: {
        employeeNo: `MII${pad(empNo)}`,
        fullName: `${first} ${last}`,
        gender,
        birthPlace: pick(CITIES),
        birthDate: new Date(randInt(1975, 2000), randInt(0, 11), randInt(1, 28)),
        nationalId: `317${randInt(1000000000, 9999999999)}`,
        taxId: `09${randInt(1000000000, 9999999999)}`,
        bpjsHealth: `0001${randInt(10000000, 99999999)}`,
        bpjsEmpSkill: `9200${randInt(1000000000, 9999999999)}`,
        maritalStatus: pick(MARITAL),
        religion: pick(RELIGIONS),
        bloodType: pick(BLOOD),
        email: `${first.toLowerCase()}.${last.toLowerCase()}@mii.co.id`,
        phone: `08${randInt(11, 89)}${randInt(10000000, 99999999)}`,
        address: `Jl. ${pick(["Merdeka", "Sudirman", "Ahmad Yani", "Diponegoro", "Gatot Subroto"])} No. ${randInt(1, 120)}`,
        city: pick(CITIES),
        bankName: pick(["BCA", "Mandiri", "BNI", "BRI"]),
        bankAccount: String(randInt(100000000, 999999999)),
        companyId: company.id,
        orgUnitId: positions[posCode] ? (await db.position.findUnique({ where: { id: positions[posCode] } }))?.orgUnitId : null,
        positionId: positions[posCode] ?? null,
        gradeId: grades[gradeCode] ?? null,
        employmentStatus: opts.empStatus ?? "Permanent",
        joinDate,
        managerId: opts.manager ?? null,
        baseSalary: salaryOf(gradeCode),
        workShift: posCode === "P-OPR" ? pick(["Shift 1", "Shift 2", "Shift 3"]) : "Regular",
        status: opts.status ?? "Active",
      },
    });
    empNo++;
    empIds.push(e.id);
    // update filled count
    if (positions[posCode]) {
      const pos = await db.position.findUnique({ where: { id: positions[posCode] } });
      if (pos) await db.position.update({ where: { id: pos.id }, data: { filled: pos.filled + 1 } });
    }
    return e;
  };

  const ceoEmp = await mkEmployee("Hartono", "Wijaksono", "P-CEO", "G8", { joinYear: 2010 });
  const hrdEmp = await mkEmployee("Sri", "Wahyuni", "P-HRD", "G7", { joinYear: 2012, manager: ceoEmp.id });
  const finEmp = await mkEmployee("Bambang", "Prakoso", "P-FIN", "G5", { joinYear: 2015, manager: ceoEmp.id });
  const hrEmp = await mkEmployee("Tri", "Handayani", "P-HRM", "G5", { joinYear: 2016, manager: hrdEmp.id });
  const prdEmp = await mkEmployee("Joko", "Susilo", "P-PRD", "G5", { joinYear: 2014, manager: hrdEmp.id });
  const mktEmp = await mkEmployee("Rina", "Maulida", "P-MKT", "G5", { joinYear: 2017, manager: hrdEmp.id });
  const itEmp = await mkEmployee("Agus", "Salim", "P-ITM", "G5", { joinYear: 2018, manager: hrdEmp.id });
  const qaEmp = await mkEmployee("Dewi", "Anggraini", "P-QAM", "G5", { joinYear: 2019, manager: hrdEmp.id });

  // bulk staff: 52 more
  const staffPlan: [string, string, string][] = [
    ["P-HRS", "G1"], ["P-RCT", "G1"], ["P-CBS", "G2"], ["P-GAS", "G1"],
    ["P-ACC", "G2"], ["P-ACC", "G2"], ["P-TAX", "G1"],
    ["P-SUP", "G3"], ["P-SUP", "G3"],
    ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"],
    ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"],
    ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"], ["P-OPR", "G1"],
    ["P-MAINT", "G2"], ["P-MAINT", "G2"],
    ["P-MKS", "G1"], ["P-MKS", "G1"],
    ["P-DEV", "G2"], ["P-DEV", "G2"], ["P-DEV", "G2"],
    ["P-QAS", "G1"], ["P-QAS", "G1"], ["P-QAS", "G1"],
  ].map(([p, g]) => [p, g, ""]) as [string, string, string][];

  const managerMap: Record<string, string> = {
    "P-HRS": hrEmp.id, "P-RCT": hrEmp.id, "P-CBS": hrEmp.id, "P-GAS": hrEmp.id,
    "P-ACC": finEmp.id, "P-TAX": finEmp.id,
    "P-SUP": prdEmp.id, "P-OPR": prdEmp.id, "P-MAINT": prdEmp.id,
    "P-MKS": mktEmp.id, "P-DEV": itEmp.id, "P-QAS": qaEmp.id,
  };
  // operators in probation/resign mix
  const extraStatuses: (("Probation" | "Contract") | null)[] = [];
  for (let i = 0; i < 33; i++) {
    const r = rnd();
    if (r < 0.12) extraStatuses.push("Probation");
    else if (r < 0.22) extraStatuses.push("Contract");
    else extraStatuses.push(null);
  }

  const created: { id: string; posCode: string }[] = [];
  for (let i = 0; i < staffPlan.length; i++) {
    const [posCode, gradeCode] = staffPlan[i];
    const female = rnd() < 0.45;
    const first = female ? pick(FIRST_F) : pick(FIRST_M);
    const last = pick(LAST);
    const e = await mkEmployee(first, last, posCode, gradeCode, {
      empStatus: extraStatuses[i] ?? "Permanent",
      manager: managerMap[posCode] ?? null,
      joinYear: randInt(2016, 2025),
    });
    created.push({ id: e.id, posCode });
  }

  // a few exited employees
  const exited1 = await mkEmployee("Slamet", "Riyadi", "P-OPR", "G1", { status: "Resigned", empStatus: "Contract", joinYear: 2021 });
  await db.employee.update({ where: { id: exited1.id }, data: { endDate: new Date(2024, 5, 30) } });
  const exited2 = await mkEmployee("Endang", "Sulistyawati", "P-OPR", "G1", { status: "Terminated", joinYear: 2019 });
  await db.employee.update({ where: { id: exited2.id }, data: { endDate: new Date(2024, 10, 15) } });

  // ============ FAMILY / EDUCATION / EXPERIENCE (sample for first 15) ============
  for (let i = 0; i < Math.min(15, empIds.length); i++) {
    const eid = empIds[i];
    const married = rnd() < 0.6;
    if (married) {
      await db.employeeFamily.create({
        data: { employeeId: eid, relation: "Spouse", name: `${pick(FIRST_F)} ${pick(LAST)}`, gender: "F", birthDate: new Date(randInt(1978, 1998), 5, 10), occupation: pick(["Ibu Rumah Tangga", "Guru", "Wiraswasta", "Karyawan"]) },
      });
      const nChild = randInt(0, 2);
      for (let c = 0; c < nChild; c++) {
        await db.employeeFamily.create({
          data: { employeeId: eid, relation: "Child", name: `${pick(FIRST_M)} ${pick(LAST)}`, gender: "M", birthDate: new Date(randInt(2015, 2023), randInt(0, 11), randInt(1, 28)) },
        });
      }
    }
    const eduLevel = pick(["SMA", "D3", "S1", "S1", "S1", "S2"]);
    await db.employeeEducation.create({
      data: {
        employeeId: eid, level: eduLevel,
        institution: pick(["Universitas Indonesia", "ITB", "Universitas Gadjah Mada", "Universitas Airlangga", "Politeknik Negeri Jakarta", "SMKN 1 Jakarta"]),
        major: pick(["Manajemen", "Akuntansi", "Teknik Industri", "Teknik Mesin", "Informatika", "Psikologi"]),
        startYear: randInt(2008, 2018), endYear: randInt(2011, 2022),
        gpa: Number((2.8 + rnd() * 1.2).toFixed(2)),
      },
    });
    await db.employeeExperience.create({
      data: {
        employeeId: eid,
        company: pick(["PT Astra International", "PT Unilever Indonesia", "PT Sinar Mas", "PT Indofood", "CV Karya Abadi"]),
        position: pick(["Staff", "Officer", "Operator", "Admin"]),
        startDate: new Date(randInt(2010, 2018), 0, 1), endDate: new Date(randInt(2015, 2022), 11, 31),
        notes: "Referensi tersedia",
      },
    });
  }

  // ============ DISCIPLINARY ============
  const viol = await db.lookup.findMany({ where: { category: "Violation" } });
  for (let i = 0; i < 5; i++) {
    await db.disciplinaryRecord.create({
      data: {
        employeeId: empIds[randInt(9, empIds.length - 1)],
        warningLevel: pick(["Verbal", "Written"]),
        violation: pick(viol).label,
        sanction: pick(["Teguran lisan", "Surat peringatan I", "Surat peringatan II"]),
        issuedAt: new Date(2025, randInt(0, 11), randInt(1, 28)),
        expiresAt: new Date(2026, randInt(0, 11), randInt(1, 28)),
      },
    });
  }

  // ============ APP USERS ============
  const admin = await db.appUser.create({ data: { username: "MII000001", fullName: "Tri Handayani", email: "tri.handayani@mii.co.id", role: "HR Manager", employeeId: hrEmp.id, lastLogin: new Date() } });
  const mgrFin = await db.appUser.create({ data: { username: "MII000002", fullName: "Bambang Prakoso", role: "Approver", employeeId: finEmp.id } });
  const mgrPrd = await db.appUser.create({ data: { username: "MII000003", fullName: "Joko Susilo", role: "Approver", employeeId: prdEmp.id } });
  const dirHrd = await db.appUser.create({ data: { username: "MII000004", fullName: "Sri Wahyuni", role: "Approver", employeeId: hrdEmp.id } });
  await db.appUser.create({ data: { username: "MII000005", fullName: "Hartono Wijaksono", role: "Admin", employeeId: ceoEmp.id } });
  await db.appUser.create({ data: { username: "MII000006", fullName: "Agus Salim", role: "Viewer", employeeId: itEmp.id } });

  // ============ ACCESS GROUPS ============
  const hrGroup = await db.accessGroup.create({
    data: {
      code: "AG-HR", name: "HR Administrator",
      description: "Full access HR Base module",
      modulesJson: JSON.stringify([
        { module: "HR Base", view: true, create: true, edit: true, delete: true, approve: true },
        { module: "Payroll", view: true, create: false, edit: false, delete: false, approve: false },
        { module: "Medical", view: true, create: false, edit: false, delete: false, approve: false },
      ]),
    },
  });
  const approverGroup = await db.accessGroup.create({
    data: {
      code: "AG-APR", name: "Approver",
      description: "Approval inbox access",
      modulesJson: JSON.stringify([{ module: "HR Base", view: true, create: true, edit: true, delete: false, approve: true }]),
    },
  });
  const viewerGroup = await db.accessGroup.create({
    data: {
      code: "AG-VIE", name: "Viewer",
      description: "Read-only",
      modulesJson: JSON.stringify([{ module: "HR Base", view: true, create: false, edit: false, delete: false, approve: false }]),
    },
  });
  await db.accessGroupMember.create({ data: { appUserId: admin.id, accessGroupId: hrGroup.id, isApprover: true } });
  await db.accessGroupMember.create({ data: { appUserId: mgrFin.id, accessGroupId: approverGroup.id, isApprover: true } });
  await db.accessGroupMember.create({ data: { appUserId: mgrPrd.id, accessGroupId: approverGroup.id, isApprover: true } });
  await db.accessGroupMember.create({ data: { appUserId: dirHrd.id, accessGroupId: approverGroup.id, isApprover: true } });

  // ============ APPROVAL TEMPLATE ============
  await db.approvalTemplate.create({
    data: {
      code: "AT-PA-STD", name: "Standard Personnel Action (3 Layer)",
      docType: "PersonnelAction",
      layersJson: JSON.stringify([
        { layer: 1, role: "Dept Head" },
        { layer: 2, role: "HR Manager" },
        { layer: 3, role: "HR Director" },
      ]),
      autoApprove: false,
    },
  });
  await db.approvalTemplate.create({
    data: {
      code: "AT-PA-FAST", name: "Fast Track (1 Layer)",
      docType: "PersonnelAction",
      layersJson: JSON.stringify([{ layer: 1, role: "HR Manager" }]),
      autoApprove: true,
    },
  });

  // ============ TEMPORARY APPROVER ============
  await db.temporaryApprover.create({
    data: {
      approverId: dirHrd.id, delegateId: admin.id, docType: "PersonnelAction",
      validFrom: new Date(2026, 8, 1), validTo: new Date(2026, 8, 30),
      reason: "Director on leave — workshop Singapore",
    },
  });

  // ============ WAGE COMPONENTS ============
  const wageDefs: [string, string, string, string, number, boolean, boolean][] = [
    ["WC-001", "Gaji Pokok", "Earning", "Fixed", 5000000, true, true],
    ["WC-002", "Tunjangan Jabatan", "Earning", "Percentage", 1000000, true, true],
    ["WC-003", "Tunjangan Transport", "Earning", "Fixed", 750000, true, true],
    ["WC-004", "Tunjangan Makan", "Earning", "Fixed", 600000, false, true],
    ["WC-005", "Tunjangan Keluarga", "Earning", "Percentage", 500000, true, true],
    ["WC-006", "Tunjangan Hari Raya (THR)", "Earning", "Formula", 0, false, true],
    ["WC-007", "Lembur", "Earning", "Formula", 0, false, true],
    ["WC-008", "Bonus Kinerja", "Earning", "Formula", 0, false, true],
    ["WC-009", "BPJS Kesehatan", "Deduction", "Percentage", 0, true, false],
    ["WC-010", "BPJS Jaminan Hari Tua", "Deduction", "Percentage", 0, true, false],
    ["WC-011", "BPJS Jaminan Pensiun", "Deduction", "Percentage", 0, true, false],
    ["WC-012", "Potongan Keterlambatan", "Deduction", "Formula", 0, false, false],
    ["WC-013", "PPh 21", "Deduction", "Formula", 0, false, true],
    ["WC-014", "Pinjaman Karyawan", "Deduction", "Fixed", 500000, false, false],
    ["WC-015", "Absensi Hari Kerja", "Informational", "Formula", 0, false, false],
  ];
  for (const [code, name, type, calcMethod, amount, prorated, taxable] of wageDefs) {
    await db.wageComponent.create({ data: { code, name, type, calcMethod, amount, prorated, taxable } });
  }

  // ============ ACCOUNTING ============
  const ag1 = await db.accountGroup.create({ data: { code: "AG-PAY", name: "Payroll Expense", accountType: "Expense" } });
  const ag2 = await db.accountGroup.create({ data: { code: "AG-LIA", name: "Payroll Liability", accountType: "Liability" } });
  await db.account.createMany({
    data: [
      { code: "5101", name: "Gaji & Upah", accountGroupId: ag1.id, balance: 0 },
      { code: "5102", name: "Tunjangan Karyawan", accountGroupId: ag1.id, balance: 0 },
      { code: "5103", name: "BPJS Perusahaan", accountGroupId: ag1.id, balance: 0 },
      { code: "2101", name: "Hutang Gaji", accountGroupId: ag2.id, balance: 0 },
      { code: "2102", name: "Hutang PPh 21", accountGroupId: ag2.id, balance: 0 },
      { code: "2103", name: "Hutang BPJS", accountGroupId: ag2.id, balance: 0 },
    ],
  });
  await db.postingEvent.createMany({
    data: [
      { code: "PE-001", name: "Post Monthly Payroll", trigger: "PayrollRun" },
      { code: "PE-002", name: "Post THR Payment", trigger: "THRRun" },
      { code: "PE-003", name: "Post BPJS Payment", trigger: "BPJSPay" },
    ],
  });

  // ============ PERSONNEL ACTIONS ============
  let paNo = 1;
  const mkPA = async (employeeId: string, type: string, status: string, reason: string, detail: Record<string, unknown> = {}, layerPlan: { role: string; userId?: string; st?: string }[] = [{ role: "HR Manager", userId: admin.id }]) => {
    const pa = await db.personnelAction.create({
      data: {
        docNo: `PA-2026-${pad(paNo++, 4)}`,
        employeeId, type, status, reason,
        effectiveDate: new Date(2026, randInt(0, 11), randInt(1, 28)),
        detailJson: JSON.stringify(detail),
        createdBy: admin.username,
        createdAt: new Date(2026, randInt(0, 7), randInt(1, 28)),
        submittedAt: status !== "Prepared" ? new Date(2026, randInt(0, 7), randInt(1, 28)) : null,
        processedAt: status === "Processed" ? new Date(2026, randInt(0, 7), randInt(1, 28)) : null,
      },
    });
    for (let i = 0; i < layerPlan.length; i++) {
      const lp = layerPlan[i];
      let st = "Pending";
      if (status === "Approved" || status === "Processed") st = "Approved";
      else if (status === "Rejected" && i === layerPlan.length - 1) st = "Rejected";
      else if (status === "Rejected") st = "Approved";
      else if (status === "Cancelled") st = "Pending";
      else if (status === "Submitted" && i < pa.currentLayer) st = "Approved";
      await db.approvalLayer.create({
        data: {
          personnelActionId: pa.id, layerNo: i + 1, approverRole: lp.role,
          approverId: lp.userId ?? admin.id, status: st,
          note: st === "Approved" ? "Setuju, lanjutkan." : st === "Rejected" ? "Perlu revisi data." : null,
          decidedAt: st !== "Pending" ? new Date(2026, randInt(0, 7), randInt(1, 28)) : null,
        },
      });
    }
    if (status === "Approved" || status === "Processed") {
      await db.personnelAction.update({ where: { id: pa.id }, data: { currentLayer: layerPlan.length } });
    } else if (status === "Submitted") {
      await db.personnelAction.update({ where: { id: pa.id }, data: { currentLayer: 1 } });
    }
    await db.activityLog.create({
      data: {
        appUserId: admin.id, employeeId, personnelActionId: pa.id,
        action: status === "Prepared" ? "Created" : status === "Submitted" ? "Submitted" : status === "Rejected" ? "Rejected" : status === "Processed" ? "Processed" : "Approved",
        entity: "PersonnelAction", entityId: pa.id,
        detail: `${type} — ${status}`,
      },
    });
    return pa;
  };

  // hire a new employee (Prepared)
  await mkPA(empIds[10], "Hire", "Prepared", "Penambahan operator lini produksi 3", { plannedPosition: "P-OPR", plannedSalary: 5500000 });
  // promotion (Submitted)
  await mkPA(empIds[5], "Promotion", "Submitted", "Promosi menjadi Supervisor Assembly", { fromPosition: "P-OPR", toPosition: "P-SUP", newGrade: "G3", newSalary: 11500000 }, [
    { role: "Dept Head", userId: mgrPrd.id, st: "Approved" }, { role: "HR Manager", userId: admin.id },
  ]);
  // salary adjustment (Approved)
  await mkPA(empIds[7], "SalaryAdjustment", "Approved", "Adjustment tahunan CPI 2026", { oldSalary: 6800000, newSalary: 7500000, percent: 10.3 });
  // transfer (Processed)
  await mkPA(empIds[9], "Transfer", "Processed", "Rotasi ke QA untuk pengembangan karir", { fromUnit: "PRD-ASSY", toUnit: "QAD" }, [
    { role: "Dept Head", userId: mgrPrd.id, st: "Approved" }, { role: "HR Manager", userId: admin.id, st: "Approved" },
  ]);
  // resignation (Rejected)
  await mkPA(exited1.id, "Resignation", "Rejected", "Alasan pribadi — pindah ke kota asal", { lastDay: "2026-06-30" }, [
    { role: "Dept Head", userId: mgrPrd.id, st: "Approved" }, { role: "HR Manager", userId: admin.id, st: "Rejected" },
  ]);
  // extend probation (Submitted)
  await mkPA(empIds[12], "ExtendProbation", "Submitted", "Perpanjangan masa percobaan 1 bulan", { months: 1, reason: "KPI belum tercapai" });
  // contract renewal (Prepared)
  await mkPA(empIds[15], "ContractRenewal", "Prepared", "Perpanjangan kontrak 12 bulan", { months: 12, newEndDate: "2027-01-31" });
  // mutation (Cancelled)
  await mkPA(empIds[18], "Mutation", "Cancelled", "Mutasi internal IT");
  // demotion (Processed)
  await mkPA(empIds[20], "Demotion", "Processed", "Pelanggaran disiplin berulang", { fromPosition: "P-SUP", toPosition: "P-OPR" }, [
    { role: "Dept Head", userId: mgrPrd.id, st: "Approved" }, { role: "HR Manager", userId: admin.id, st: "Approved" },
  ]);

  // ============ ACTIVITY LOG (recent) ============
  await db.activityLog.createMany({
    data: [
      { appUserId: admin.id, action: "Updated", entity: "Employee", entityId: empIds[3], detail: "Perbarui data kontak darurat" },
      { appUserId: dirHrd.id, action: "Approved", entity: "PersonnelAction", entityId: "", detail: "PA-2026-0004 Transfer disetujui" },
      { appUserId: mgrPrd.id, action: "Created", entity: "Employee", entityId: empIds[25], detail: "Onboarding operator baru" },
      { appUserId: admin.id, action: "Created", entity: "OrgUnit", entityId: subUnits["MKT-DIG"], detail: "Unit Digital Marketing dibuat" },
      { appUserId: mgrFin.id, action: "Updated", entity: "WageComponent", entityId: "WC-003", detail: "Tunjangan transport naik ke 750.000" },
    ],
  });

  const counts = {
    employees: await db.employee.count(),
    orgUnits: await db.orgUnit.count(),
    positions: await db.position.count(),
    actions: await db.personnelAction.count(),
    users: await db.appUser.count(),
  };
  console.log("✅ Seed done:", counts);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
