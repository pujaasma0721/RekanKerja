// OneVity seed — realistic Indonesian company "MII - Mitra Industri Internasional"
import { PrismaClient } from "@/generated/tenant";
import { calculateAndSaveRun, confirmRun } from "../src/lib/onevity/payroll-service";
import {
  submitClaim, scheduleClaim, approveClaim, rejectClaim, markClaimPaidCash, nextClaimNo,
} from "../src/lib/onevity/benefit-service";

// Client tenant: 1 schema PostgreSQL per tenant — seed menarget schema SEED_TENANT_SCHEMA
// (default tenant_seed) di atas TENANT_DB_BASE_URL. Jalankan: bun prisma/seed.ts
const db = new PrismaClient({
  datasources: { db: { url: `${process.env.TENANT_DB_BASE_URL}?schema=${process.env.SEED_TENANT_SCHEMA ?? "tenant_seed"}` } },
});

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
        joinDate,
        status: opts.status ?? "Active",
      },
    });
    // penempatan awal → riwayat pekerjaan (EmployeeAssignment)
    await db.employeeAssignment.create({
      data: {
        employeeId: e.id,
        orgUnitId: positions[posCode] ? (await db.position.findUnique({ where: { id: positions[posCode] } }))?.orgUnitId : null,
        positionId: positions[posCode] ?? null,
        gradeId: grades[gradeCode] ?? null,
        employmentStatus: opts.empStatus ?? "Permanent",
        managerId: opts.manager ?? null,
        baseSalary: salaryOf(gradeCode),
        workShift: posCode === "P-OPR" ? pick(["Shift 1", "Shift 2", "Shift 3"]) : "Regular",
        validFrom: joinDate,
        validTo: null,
        changeReason: "Initial",
        notes: "Penempatan awal saat onboarding",
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

  // ============ RIWAYAT PENEMPATAN DEMO (mutasi/promosi utk karyawan senior) ============
  // 4 karyawan senior mendapat riwayat 2 periode — menutup Initial (validTo 2022-06-30)
  // dan membuka periode baru 2022-07-01 (seperti PA yang diproses).
  const historyDefs: { idx: number; reason: string; docNo: string; salaryMult: number; notes: string }[] = [
    { idx: 5, reason: "Promotion", docNo: "PA-2022-0101", salaryMult: 1.18, notes: "Promosi Supervisor → Asisten Manajer" },
    { idx: 9, reason: "Transfer", docNo: "PA-2022-0102", salaryMult: 1.0, notes: "Rotasi antar unit produksi" },
    { idx: 12, reason: "SalaryAdjustment", docNo: "PA-2022-0103", salaryMult: 1.12, notes: "Penyesuaian upah tahunan" },
    { idx: 18, reason: "Mutation", docNo: "PA-2022-0104", salaryMult: 1.05, notes: "Mutasi internal divisi" },
  ];
  for (const h of historyDefs) {
    const empId = empIds[h.idx];
    const current = await db.employeeAssignment.findFirst({ where: { employeeId: empId, validTo: null } });
    if (!current) continue;
    await db.employeeAssignment.update({ where: { id: current.id }, data: { validTo: new Date(2022, 5, 30) } });
    await db.employeeAssignment.create({
      data: {
        employeeId: empId,
        orgUnitId: current.orgUnitId, positionId: current.positionId, gradeId: current.gradeId,
        managerId: current.managerId, employmentStatus: current.employmentStatus, workShift: current.workShift,
        baseSalary: Math.round(current.baseSalary * h.salaryMult / 50000) * 50000,
        validFrom: new Date(2022, 6, 1), validTo: null,
        changeReason: h.reason, sourceDocNo: h.docNo, notes: h.notes,
      },
    });
  }

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

  // ============ WAGE COMPONENTS (klasifikasi oranHR-grade) ============
  // type=wageCategory, wageType=13-way, calcMethod, amount, formula, incomeTaxMethod, flags
  type CompDef = {
    code: string; name: string; type: string; wageType: string; calcMethod: string;
    amount?: number; formula?: string; incomeTaxMethod?: string; prorated?: boolean;
    includeInTHP?: boolean; includeInBasicIncome?: boolean; applyThrRules?: boolean;
    jamsostekBasis?: string; sptReference?: string;
  };
  const compDefs: CompDef[] = [
    { code: "BASIC", name: "Gaji Pokok", type: "Earning", wageType: "BasicSalary", calcMethod: "Formula", formula: "BASE_SALARY", includeInBasicIncome: true, sptReference: "Gaji" },
    { code: "TJAB", name: "Tunjangan Jabatan", type: "Earning", wageType: "Compensation", calcMethod: "Formula", formula: "BASE_SALARY*0.1", sptReference: "Tunjangan" },
    { code: "TKEL", name: "Tunjangan Keluarga", type: "Earning", wageType: "Compensation", calcMethod: "Formula", formula: "BASE_SALARY*0.05", sptReference: "Tunjangan" },
    { code: "TTRANS", name: "Tunjangan Transport", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 750000, sptReference: "Tunjangan" },
    { code: "TMAKAN", name: "Tunjangan Makan", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 550000, sptReference: "Tunjangan" },
    { code: "THR", name: "Tunjangan Hari Raya (THR)", type: "Earning", wageType: "Compensation", calcMethod: "Formula", formula: "BASE_SALARY", incomeTaxMethod: "Irregular", applyThrRules: true, sptReference: "BonusTHR" },
    { code: "BONUS", name: "Bonus Kinerja", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", sptReference: "BonusTHR" },
    { code: "LEMBUR", name: "Lembur (Overtime)", type: "Earning", wageType: "Overtime", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable" },
    { code: "JHT_C", name: "BPJS JHT Perusahaan 3,7%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JHT_BASE*JHT_RATE_CO", includeInTHP: false, jamsostekBasis: "JHT" },
    { code: "JPK_C", name: "BPJS JPK Perusahaan 4%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JPK_BASE*JPK_RATE_CO", includeInTHP: false, jamsostekBasis: "JPK" },
    { code: "JKK_C", name: "BPJS JKK Perusahaan", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JKK_BASE*JKK_RATE", includeInTHP: false, jamsostekBasis: "JKK" },
    { code: "JKM_C", name: "BPJS JKM Perusahaan 0,3%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JKM_BASE*JKM_RATE", includeInTHP: false, jamsostekBasis: "JKM" },
    { code: "JP_C", name: "BPJS JP Perusahaan 2%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JP_BASE*JP_RATE_CO", includeInTHP: false, jamsostekBasis: "JP" },
    { code: "JHT_E", name: "Potongan BPJS JHT 2%", type: "Deduction", wageType: "Jamsostek", calcMethod: "Formula", formula: "JHT_BASE*JHT_RATE_EMP", jamsostekBasis: "JHT" },
    { code: "JP_E", name: "Potongan BPJS JP 1%", type: "Deduction", wageType: "Jamsostek", calcMethod: "Formula", formula: "JP_BASE*JP_RATE_EMP", jamsostekBasis: "JP" },
    { code: "JPK_E", name: "Potongan BPJS JPK 1%", type: "Deduction", wageType: "Jamsostek", calcMethod: "Formula", formula: "JPK_BASE*JPK_RATE_EMP", jamsostekBasis: "JPK" },
    { code: "PPH21", name: "PPh21 (PPh Pasal 21)", type: "Deduction", wageType: "IncomeTax", calcMethod: "Tax", amount: 0, sptReference: "PPh21" },
    { code: "LOAN", name: "Angsuran Pinjaman", type: "Deduction", wageType: "Loan", calcMethod: "Tax", amount: 0, incomeTaxMethod: "NonTaxable" },
    { code: "WORKDAYS", name: "Hari Kerja Period", type: "Informational", wageType: "Information", calcMethod: "Formula", formula: "WORKING_DAYS", includeInTHP: false },
    { code: "RAPEL", name: "Back Pay (Rapel)", type: "Earning", wageType: "BackPay", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", sptReference: "Gaji" },
    { code: "BEN_MED", name: "Benefit Medis (Reimburse)", type: "Earning", wageType: "CompensationNatura", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable", accountDebitCode: "5104" },
    { code: "BEN_GEN", name: "Benefit Karyawan", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", accountDebitCode: "5104" },
  ];
  const compIds: Record<string, string> = {};
  for (const c of compDefs) {
    const created = await db.wageComponent.create({
      data: {
        code: c.code, name: c.name, type: c.type, wageType: c.wageType,
        calcMethod: c.calcMethod, amount: c.amount ?? 0, formula: c.formula ?? null,
        incomeTaxMethod: c.incomeTaxMethod ?? "Regular",
        prorated: c.prorated ?? false,
        taxable: (c.incomeTaxMethod ?? "Regular") !== "NonTaxable",
        includeInTHP: c.includeInTHP ?? true,
        includeInBasicIncome: c.includeInBasicIncome ?? false,
        applyThrRules: c.applyThrRules ?? false,
        jamsostekBasis: c.jamsostekBasis ?? null,
        sptReference: c.sptReference ?? null,
        accountDebitCode: c.accountDebitCode ?? null,
      },
    });
    compIds[c.code] = created.id;
  }

  // ============ ACCOUNTING ============
  const ag1 = await db.accountGroup.create({ data: { code: "AG-PAY", name: "Payroll Expense", accountType: "Expense" } });
  const ag2 = await db.accountGroup.create({ data: { code: "AG-LIA", name: "Payroll Liability", accountType: "Liability" } });
  const ag3 = await db.accountGroup.create({ data: { code: "AG-CASH", name: "Kas & Bank", accountType: "Asset" } });
  await db.account.createMany({
    data: [
      { code: "1101", name: "Kas & Bank", accountGroupId: ag3.id, balance: 0 },
      { code: "5101", name: "Gaji & Upah", accountGroupId: ag1.id, balance: 0 },
      { code: "5102", name: "Tunjangan Karyawan", accountGroupId: ag1.id, balance: 0 },
      { code: "5103", name: "BPJS Perusahaan", accountGroupId: ag1.id, balance: 0 },
      { code: "5104", name: "Beban Benefit Karyawan", accountGroupId: ag1.id, balance: 0 },
      { code: "2101", name: "Hutang Gaji", accountGroupId: ag2.id, balance: 0 },
      { code: "2102", name: "Hutang PPh 21", accountGroupId: ag2.id, balance: 0 },
      { code: "2103", name: "Hutang BPJS", accountGroupId: ag2.id, balance: 0 },
      { code: "2104", name: "Pinjaman Karyawan", accountGroupId: ag2.id, balance: 0 },
      { code: "2105", name: "Potongan Lain-lain", accountGroupId: ag2.id, balance: 0 },
    ],
  });
  await db.postingEvent.createMany({
    data: [
      { code: "PE-001", name: "Post Monthly Payroll", trigger: "PayrollRun" },
      { code: "PE-002", name: "Post THR Payment", trigger: "THRRun" },
      { code: "PE-003", name: "Post BPJS Payment", trigger: "BPJSPay" },
    ],
  });

  // ============ PAYROLL: PERIODE & PROCESS TYPE ============
  const processTypes = await Promise.all(
    (
      [
        ["SALARY", "Gaji Bulanan (Salary)", 1, true],
        ["THR", "THR (Tunjangan Hari Raya)", 2, true],
        ["BONUS", "Bonus Kinerja", 3, true],
        ["TERMINATION", "Pesangon & Final Settlement", 4, true],
        ["YEAR_END_ADJ", "Penyesuaian Akhir Tahun", 5, true],
        ["RAPEL", "Rapel / Back-Pay", 6, true],
        ["BENEFIT", "Benefit", 50, true],
      ] as [string, string, number, boolean][]
    ).map(([code, name, sequence, calculateTax]) =>
      db.processType.create({ data: { code, name, sequence, calculateTax } })
    )
  );

  const MONTH_NAMES = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  const mkPeriod = (y: number, m: number, status: string) =>
    db.payrollPeriod.create({
      data: {
        code: `${y}-${String(m + 1).padStart(2, "0")}`,
        name: `${MONTH_NAMES[m]} ${y}`,
        payType: "Monthly",
        startDate: new Date(y, m, 1),
        endDate: new Date(y, m + 1, 0),
        taStartDate: new Date(y, m, 26), // cut-off kehadiran tgl 26 bln sblm – 25
        taEndDate: new Date(y, m, 25),
        payPeriod: m + 1,
        sptMonth: m + 1,
        sptYear: y,
        status,
      },
    });
  // 8 period terakhir: FEB–JUL Closed, AGU Processed (run Paid), SEP Open (run Draft)
  const periods: Record<string, { id: string; code: string; name: string }> = {};
  const periodPlan: [number, number, string][] = [
    [2026, 1, "Closed"], [2026, 2, "Closed"], [2026, 3, "Closed"], [2026, 4, "Closed"],
    [2026, 5, "Closed"], [2026, 6, "Closed"], [2026, 7, "Processed"], [2026, 8, "Open"],
  ];
  for (const [y, m, status] of periodPlan) {
    const p = await mkPeriod(y, m, status);
    periods[p.code] = { id: p.id, code: p.code, name: p.name };
  }

  // ============ PAYROLL: REGULASI & BRACKET PAJAK ============
  await db.payrollRegulation.create({
    data: {
      code: "REG-2026-HPP",
      name: "Regulasi UU HPP & BPJS 2026",
      validFrom: new Date(2026, 0, 1),
      biayaJabatanRate: 0.05,
      biayaJabatanCapMonthly: 500000,
      jhtEmployeeRate: 0.02, jhtCompanyRate: 0.037,
      jpEmployeeRate: 0.01, jpCompanyRate: 0.02, jpSalaryCap: 10547400,
      jkkRate: 0.0024, jkmRate: 0.003,
      jpkCompanyRate: 0.04, jpkEmployeeRate: 0.01, jpkSalaryCap: 12000000,
      nonNpwpSurcharge: 0.2,
      useTer: false, // default progresif annualized; TER bisa diaktifkan di Parameter
    },
  });
  // Bracket PPh21 progresif (UU HPP) + penalti non-NPWP (+20%)
  const bracketDefs: [number, number | null, number][] = [
    [0, 60_000_000, 0.05],
    [60_000_000, 250_000_000, 0.15],
    [250_000_000, 500_000_000, 0.25],
    [500_000_000, 5_000_000_000, 0.30],
    [5_000_000_000, null, 0.35],
  ];
  await db.taxBracket.createMany({
    data: bracketDefs.map(([lowerLimit, upperLimit, rate]) => ({
      bracketType: "Income", lowerLimit, upperLimit,
      rateNpwp: rate, rateNonNpwp: rate * 1.2,
      validFrom: new Date(2022, 0, 1),
    })),
  });

  // ============ PAYROLL: TER PP 58/2023 (opsional) ============
  const terA: [number, number | null, number][] = [
    [0, 5_400_000, 0], [5_400_000, 5_650_000, 0.0025], [5_650_000, 6_350_000, 0.005],
    [6_350_000, 6_800_000, 0.0075], [6_800_000, 7_500_000, 0.01], [7_500_000, 8_050_000, 0.0125],
    [8_050_000, 8_700_000, 0.015], [8_700_000, 9_350_000, 0.0175], [9_350_000, 9_950_000, 0.02],
    [9_950_000, 10_600_000, 0.0225], [10_600_000, 11_300_000, 0.025], [11_300_000, 12_400_000, 0.03],
    [12_400_000, 13_600_000, 0.035], [13_600_000, 14_850_000, 0.04], [14_850_000, 16_100_000, 0.045],
    [16_100_000, 17_350_000, 0.05], [17_350_000, 18_600_000, 0.055], [18_600_000, 19_850_000, 0.06],
    [19_850_000, 21_100_000, 0.065], [21_100_000, 22_350_000, 0.07], [22_350_000, 23_600_000, 0.075],
    [23_600_000, 24_850_000, 0.08], [24_850_000, 26_100_000, 0.085], [26_100_000, 27_400_000, 0.09],
    [27_400_000, 28_700_000, 0.095], [28_700_000, 32_100_000, 0.10], [32_100_000, 36_500_000, 0.11],
    [36_500_000, 41_200_000, 0.12], [41_200_000, 46_200_000, 0.13], [46_200_000, 51_200_000, 0.14],
    [51_200_000, 56_200_000, 0.15], [56_200_000, 61_200_000, 0.16], [61_200_000, 66_200_000, 0.17],
    [66_200_000, 71_200_000, 0.18], [71_200_000, 76_200_000, 0.19], [76_200_000, null, 0.20],
  ];
  const terB: [number, number | null, number][] = [
    [0, 5_600_000, 0], [5_600_000, 5_850_000, 0.0025], [5_850_000, 6_350_000, 0.005],
    [6_350_000, 6_850_000, 0.0075], [6_850_000, 7_550_000, 0.01], [7_550_000, 8_150_000, 0.0125],
    [8_150_000, 8_900_000, 0.015], [8_900_000, 9_600_000, 0.0175], [9_600_000, 10_150_000, 0.02],
    [10_150_000, 10_850_000, 0.0225], [10_850_000, 11_550_000, 0.025], [11_550_000, 12_700_000, 0.03],
    [12_700_000, 13_900_000, 0.035], [13_900_000, 15_150_000, 0.04], [15_150_000, 16_400_000, 0.045],
    [16_400_000, 17_650_000, 0.05], [17_650_000, 18_900_000, 0.055], [18_900_000, 20_150_000, 0.06],
    [20_150_000, 21_400_000, 0.065], [21_400_000, 22_650_000, 0.07], [22_650_000, 23_900_000, 0.075],
    [23_900_000, 25_150_000, 0.08], [25_150_000, 26_400_000, 0.085], [26_400_000, 27_700_000, 0.09],
    [27_700_000, 29_000_000, 0.095], [29_000_000, 32_500_000, 0.10], [32_500_000, 37_000_000, 0.11],
    [37_000_000, 41_700_000, 0.12], [41_700_000, 46_700_000, 0.13], [46_700_000, 51_700_000, 0.14],
    [51_700_000, 56_700_000, 0.15], [56_700_000, 61_700_000, 0.16], [61_700_000, 66_700_000, 0.17],
    [66_700_000, 71_700_000, 0.18], [71_700_000, 76_700_000, 0.19], [76_700_000, null, 0.20],
  ];
  const terC: [number, number | null, number][] = [
    [0, 6_600_000, 0], [6_600_000, 6_950_000, 0.0025], [6_950_000, 7_700_000, 0.005],
    [7_700_000, 8_200_000, 0.0075], [8_200_000, 8_950_000, 0.01], [8_950_000, 9_450_000, 0.0125],
    [9_450_000, 10_200_000, 0.015], [10_200_000, 10_700_000, 0.0175], [10_700_000, 11_450_000, 0.02],
    [11_450_000, 12_200_000, 0.025], [12_200_000, 13_550_000, 0.03], [13_550_000, 14_900_000, 0.035],
    [14_900_000, 16_250_000, 0.04], [16_250_000, 17_600_000, 0.045], [17_600_000, 18_950_000, 0.05],
    [18_950_000, 20_300_000, 0.055], [20_300_000, 21_650_000, 0.06], [21_650_000, 23_000_000, 0.065],
    [23_000_000, 24_350_000, 0.07], [24_350_000, 25_700_000, 0.075], [25_700_000, 27_050_000, 0.08],
    [27_050_000, 28_400_000, 0.085], [28_400_000, 29_750_000, 0.09], [29_750_000, 31_100_000, 0.095],
    [31_100_000, 35_500_000, 0.10], [35_500_000, 39_900_000, 0.11], [39_900_000, 44_300_000, 0.12],
    [44_300_000, 48_700_000, 0.13], [48_700_000, 53_100_000, 0.14], [53_100_000, 57_500_000, 0.15],
    [57_500_000, 61_900_000, 0.16], [61_900_000, 66_300_000, 0.17], [66_300_000, 70_700_000, 0.18],
    [70_700_000, 75_100_000, 0.19], [75_100_000, null, 0.20],
  ];
  await db.terRate.createMany({
    data: [
      ...terA.map(([lowerLimit, upperLimit, rate]) => ({ category: "A", lowerLimit, upperLimit, rate })),
      ...terB.map(([lowerLimit, upperLimit, rate]) => ({ category: "B", lowerLimit, upperLimit, rate })),
      ...terC.map(([lowerLimit, upperLimit, rate]) => ({ category: "C", lowerLimit, upperLimit, rate })),
    ],
  });

  // ============ PAYROLL: WAGE TEMPLATE ============
  const tplDefault = await db.wageTemplate.create({
    data: {
      code: "DEFAULT", name: "Template Standar Karyawan", description: "Gaji pokok + tunjangan + BPJS penuh",
      items: {
        create: [
          "BASIC", "TJAB", "TKEL", "TTRANS", "TMAKAN",
          "JHT_C", "JPK_C", "JKK_C", "JKM_C", "JP_C",
          "JHT_E", "JP_E", "JPK_E", "WORKDAYS",
        ].map((code, i) => ({ wageComponentId: compIds[code], sortOrder: i })),
      },
    },
  });
  const tplBS = await db.wageTemplate.create({
    data: {
      code: "BS", name: "Basic Salary Only", description: "Gaji pokok + potongan BPJS (tanpa tunjangan)",
      items: {
        create: ["BASIC", "JHT_C", "JPK_C", "JKK_C", "JKM_C", "JP_C", "JHT_E", "JP_E", "JPK_E", "WORKDAYS"]
          .map((code, i) => ({ wageComponentId: compIds[code], sortOrder: i })),
      },
    },
  });
  const tplFreelance = await db.wageTemplate.create({
    data: {
      code: "FREELANCE", name: "Kontrak/Freelance", description: "Gaji pokok + tunjangan transport-makan (tanpa BPJS)",
      items: {
        create: ["BASIC", "TTRANS", "TMAKAN", "WORKDAYS"].map((code, i) => ({ wageComponentId: compIds[code], sortOrder: i })),
      },
    },
  });
  void tplFreelance;

  // ============ PAYROLL: PROFIL PAYROLL PER KARYAWAN ============
  // Tax status dari marital + jumlah anak (family); template: DEFAULT (BS utk 2 karyawan).
  const allEmployees = await db.employee.findMany({
    where: { status: "Active" },
    include: { family: true },
    orderBy: { employeeNo: "asc" },
  });
  const nonNpwpIdx = new Set([4, 11]); // 2 karyawan tanpa NPWP (demo penalti 20%)
  const bsIdx = new Set([1, 14]); // 2 karyawan pakai template BS (demo perbedaan template)
  const freelanceIdx = new Set([40]); // 1 outsourcing pakai template FREELANCE
  let empIdx = 0;
  for (const emp of allEmployees) {
    const children = emp.family.filter((f) => f.relation === "Child").length;
    const hasSpouse = emp.family.some((f) => f.relation === "Spouse");
    const married = emp.maritalStatus === "Menikah" || hasSpouse;
    const dep = Math.min(3, children);
    const spouseWorks = married && rnd() < 0.2; // 20% pasangan bekerja → K/I
    const taxStatus = married
      ? `${spouseWorks ? "KI" : "K"}${dep}`
      : `TK${dep}`;
    await db.employeePayrollProfile.create({
      data: {
        employeeId: emp.id,
        npwp: nonNpwpIdx.has(empIdx) ? null : emp.taxId,
        hasNpwp: !nonNpwpIdx.has(empIdx),
        processMethod: empIdx === 0 ? "NetToGross" : "GrossToNet", // CEO: pajak ditanggung perusahaan
        paymentFrequency: "Monthly",
        wageTemplateId: bsIdx.has(empIdx) ? tplBS.id : freelanceIdx.has(empIdx) ? tplFreelance.id : tplDefault.id,
        taxStatus,
        dependents: dep,
        payrollDependentAllowed: true,
        bankName: emp.bankName,
        bankAccount: emp.bankAccount,
      },
    });
    empIdx++;
  }

  // ============ PAYROLL: PINJAMAN KARYAWAN ============
  const mkLoan = async (employeeId: string, letterNo: string, amount: number, count: number, interestRate: number, purpose: string, startMonthOffset: number) => {
    const startPayment = new Date(2026, 7 + startMonthOffset, 1); // AGU 2026 atau setelahnya
    const interestTotal = amount * (interestRate / 100) * (count / 12);
    const totalDue = amount + interestTotal;
    const per = Math.round(totalDue / count);
    await db.employeeLoan.create({
      data: {
        employeeId, letterNo, loanDate: new Date(2026, 6, 10), amount, installmentCount: count,
        installmentAmount: per, interestRate, startPaymentDate: startPayment,
        purpose, status: "Active", paidAmount: 0, outstanding: totalDue, wageComponentCode: "LOAN",
        installments: {
          create: Array.from({ length: count }, (_, i) => {
            const due = new Date(startPayment);
            due.setMonth(due.getMonth() + i);
            return { sequence: i + 1, dueDate: due, amount: i === count - 1 ? totalDue - per * (count - 1) : per };
          }),
        },
      },
    });
  };
  await mkLoan(empIds[6], "LTR-2026-001", 12_000_000, 12, 0, "Renovasi rumah", 0);
  await mkLoan(empIds[9], "LTR-2026-002", 6_000_000, 6, 6, "Pendidikan anak", 0);
  await mkLoan(empIds[20], "LTR-2026-003", 4_500_000, 6, 0, "Urgensi keluarga", 0);

  // ============ PAYROLL: KOMPONEN SPESIFIK & PERIODIK ============
  // Bonus kinerja utk 3 karyawan pada run SEP 2026 (SALARY) — akan muncul saat run dihitung.
  const salaryType = processTypes.find((t) => t.code === "SALARY")!;
  const sepPeriod = periods["2026-09"];
  const bonusTargets: [string, number][] = [
    [empIds[3], 2_500_000], [empIds[8], 1_500_000], [empIds[13], 3_000_000],
  ];
  for (const [eid, amount] of bonusTargets) {
    await db.employeeComponentAssignment.create({
      data: {
        employeeId: eid, wageComponentId: compIds["BONUS"], kind: "Specific",
        amount, periodId: sepPeriod.id, processTypeId: salaryType.id,
        basedDate: new Date(2026, 8, 15), notes: "Bonus kinerja Q3",
      },
    });
  }
  // Tunjangan transport khusus (periodic) utk karyawan lapangan.
  await db.employeeComponentAssignment.create({
    data: {
      employeeId: empIds[20], wageComponentId: compIds["TTRANS"], kind: "Periodic",
      amount: 1_000_000, notes: "Transport lapangan lebih tinggi",
    },
  });

  // ============ PAYROLL: BENEFIT (P5) ============
  // 4 jenis benefit (limit per siklus reset, auto-approve, pay-in-payroll vs kas)
  // + klaim di berbagai tahap lifecycle. Klaim Scheduled SEP menunggu user
  // membuat run jenis "Benefit" (demo interaktif pay-in-payroll).
  const btMedical = await db.benefitType.create({ data: {
    code: "MEDICAL", name: "Reimburse Medis & Kesehatan", category: "Medical",
    description: "Rawat jalan, obat, lab & medical check-up. Natura kesehatan (non-objek pajak).",
    resetPeriod: "Monthly", maxClaimAmount: 2_000_000, needDocuments: true,
    autoApproveInLimit: true, payInPayroll: true, wageComponentId: compIds["BEN_MED"],
  } });
  const btGlasses = await db.benefitType.create({ data: {
    code: "GLASSES", name: "Ganti Kacamata", category: "Kesehatan",
    description: "Penggantian kacamata + pemeriksaan mata (1x per tahun).",
    resetPeriod: "Yearly", maxClaimAmount: 1_500_000, needDocuments: true,
    autoApproveInLimit: false, payInPayroll: true, wageComponentId: compIds["BEN_GEN"],
  } });
  const btSport = await db.benefitType.create({ data: {
    code: "SPORT", name: "Fasilitas Olahraga & Gym", category: "Rekreasi",
    description: "Reimburse keanggotaan gym/olahraga bulanan.",
    resetPeriod: "Monthly", maxClaimAmount: 500_000, allowOverlimit: true,
    autoApproveInLimit: true, payInPayroll: true, wageComponentId: compIds["BEN_GEN"],
  } });
  const btWedding = await db.benefitType.create({ data: {
    code: "WEDDING", name: "Bantuan Pernikahan Karyawan", category: "Perayaan",
    description: "Bantuan pernikahan pertama karyawan — dibayar langsung dari kas.",
    resetPeriod: "None", maxClaimAmount: 2_500_000, needDocuments: true,
    autoApproveInLimit: false, payInPayroll: false,
  } });
  // Sri: medical 800rb (auto-approve) lalu 2,1jt ditolak (overlimit tanpa izin).
  await submitClaim(db, { employeeId: empIds[1], benefitTypeId: btMedical.id, amount: 800_000,
    claimDate: "2026-09-02", description: "Obat & konsultasi dokter umum",
    documentsNote: "Kwitansi klinik Sehat Selalu #RCP-1042, resep obat" });
  const sriOver = await db.benefitClaim.create({ data: {
    claimNo: await nextClaimNo(db), benefitTypeId: btMedical.id, employeeId: empIds[1],
    claimDate: new Date(2026, 8, 6), amount: 2_100_000,
    description: "Medical check-up lengkap + vaksin", documentsNote: "Invoice MCU MediLab #INV-8871",
    status: "Pending", limitUsed: 800_000, limitRemaining: 1_200_000, inLimit: false,
  } });
  await rejectClaim(db, sriOver.id, "Melebihi sisa limit September (Rp 1.200.000) — kuitansi tidak lengkap; ajukan ulang bulan depan atau via kas");
  // Dewi: kacamata 1,35jt — menunggu approval manual.
  await db.benefitClaim.create({ data: {
    claimNo: await nextClaimNo(db), benefitTypeId: btGlasses.id, employeeId: empIds[7],
    claimDate: new Date(2026, 8, 8), amount: 1_350_000,
    description: "Kacamata baru minus naik + pemeriksaan mata", documentsNote: "Faktur Optik Melati #FM-332, resep dokter mata",
    status: "Pending", limitUsed: 0, limitRemaining: 1_500_000, inLimit: true,
  } });
  // Tri: bantuan pernikahan 2,5jt — Pending (dibayar kas langsung setelah approve).
  await db.benefitClaim.create({ data: {
    claimNo: await nextClaimNo(db), benefitTypeId: btWedding.id, employeeId: empIds[3],
    claimDate: new Date(2026, 8, 10), amount: 2_500_000,
    description: "Pernikahan pertama — 8 November 2026", documentsNote: "Fotokopi undangan & akta nikah (menyusul)",
    status: "Pending", limitUsed: 0, limitRemaining: 2_500_000, inLimit: true,
  } });
  // Wahyu: gym 800rb — overlimit diizinkan → Pending approval manual.
  await submitClaim(db, { employeeId: empIds[20], benefitTypeId: btSport.id, amount: 800_000,
    claimDate: "2026-09-09", description: "Membership gym 3 bulan (promo)" });
  // Dedi: pernikahan 2,5jt (historis — approve → lunas via kas).
  const dediClaim = await db.benefitClaim.create({ data: {
    claimNo: await nextClaimNo(db), benefitTypeId: btWedding.id, employeeId: empIds[8],
    claimDate: new Date(2026, 4, 15), amount: 2_500_000,
    description: "Pernikahan pertama — 23 Mei 2026", documentsNote: "Akta nikah + undangan",
    status: "Pending", limitUsed: 0, limitRemaining: 2_500_000, inLimit: true,
  } });
  await approveClaim(db, dediClaim.id, "Ratna Sari (HR Manager)");
  await markClaimPaidCash(db, dediClaim.id);
  // Rina & Agus: klaim medis auto-approve → dijadwalkan ke SEP (run Benefit
  // dibuat user via Proses & Hasil; konfirmasi run → klaim Dibayar + jurnal).
  const rinaClaim = await submitClaim(db, { employeeId: empIds[5], benefitTypeId: btMedical.id, amount: 1_750_000,
    claimDate: "2026-09-12", description: "Scaling gigi + tambal gigi",
    documentsNote: "Kwitansi Klinik Gigi Ceria #KG-204" });
  await scheduleClaim(db, (rinaClaim.claim as { id: string }).id, sepPeriod.id);
  const agus1 = await submitClaim(db, { employeeId: empIds[6], benefitTypeId: btMedical.id, amount: 1_250_000,
    claimDate: "2026-09-14", description: "Lab darah lengkap + konsultasi",
    documentsNote: "Hasil lab Prodia #PL-5567, kwitansi" });
  const agus2 = await submitClaim(db, { employeeId: empIds[6], benefitTypeId: btMedical.id, amount: 450_000,
    claimDate: "2026-09-16", description: "Obat flu & vitamin",
    documentsNote: "Kwitansi apotek Kimia Farma #AP-1290" });
  await scheduleClaim(db, (agus1.claim as { id: string }).id, sepPeriod.id);
  await scheduleClaim(db, (agus2.claim as { id: string }).id, sepPeriod.id);

  // ============ PAYROLL: RUN HISTORIS (engine sungguhan) ============
  // JUL 2026 & AGU 2026: dihitung engine → confirmed → paid.
  // SEP 2026: Draft (menunggu user klik "Hitung Payroll" — demo interaktif).
  const mkRun = (periodCode: string, seq = 1) =>
    db.payrollRun.create({
      data: {
        runNo: `PR-${periodCode}-SAL-${String(seq).padStart(2, "0")}`,
        periodId: periods[periodCode].id,
        processTypeId: salaryType.id,
        sequence: seq, status: "Draft", calculateTax: true, allEmployee: true,
        notes: "Run gaji bulanan",
      },
    });
  for (const code of ["2026-07", "2026-08"]) {
    const run = await mkRun(code);
    await calculateAndSaveRun(db, run.id);
    await confirmRun(db, run.id);
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "Paid", paidAt: new Date(2026, Number(code.slice(5, 7)) - 1, 28) } });
    console.log(`   → run ${code} diproses & dibayar`);
  }
  await mkRun("2026-09"); // Draft — sengaja dibiarkan utk demo


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
