// Seed data demo E2E P7-PERF (Evaluasi Masa Percobaan) — idempoten:
//   • 3 karyawan baru Probation + assignment (atasan Bambang Prakoso MII00003 —
//     AppUser aktif utk L1 live-resolve) + onboarding checklist:
//     — Eka Putri (MII00047, join H-60 → due H+30 — jalur Confirm)
//     — Rizky Maulana (MII00048, join H-80 → due H+10 — jalur Extend, dueSoon)
//     — Laila Sari (MII00049, join H-95 → due H-5 — LEWAT jatuh tempo, jalur
//       Terminate dgn L3 Direktur)
//   • ProbationEvaluation dibuat lewat createProbationFromOnboarding (D9 —
//     sekaligus menguji fungsi service + idempotensi: panggil 2×).
// Jalankan: bun run scripts/seed-p7-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb, type FieldCrypto } from "@/rekankerja/shared/lib/field-crypto";
import { createProbationFromOnboarding } from "@/rekankerja/performance/services/perf-probation-service";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

const DAY = 24 * 3600 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const tc: FieldCrypto = tenantCryptoForDb(db);

  const company = await db.company.findFirst({ select: { id: true, name: true } });
  if (!company) throw new Error("Company MII tidak ditemukan — jalankan restore-demo dulu");

  // master referensi: posisi staf + atasan Bambang (AppUser aktif — L1 live)
  const [positions, grades, bambang] = await Promise.all([
    db.position.findMany({ select: { id: true, code: true, title: true, orgUnitId: true } }),
    db.grade.findMany({ select: { id: true, code: true } }),
    db.employee.findFirst({ where: { employeeNo: "MII00003" }, select: { id: true, fullName: true } }),
  ]);
  if (!bambang) throw new Error("Bambang Prakoso MII00003 tidak ditemukan (atasan demo)");
  const posStaff = positions.find((p) => p.code === "P-RCT") ?? positions.find((p) => p.code === "P-OPR") ?? positions[0];
  const gradeG1 = grades.find((g) => g.code === "G1") ?? grades[0];

  const hires: {
    no: string; name: string; gender: string; join: Date; salary: number;
  }[] = [
    { no: "MII00047", name: "Eka Putri", gender: "F", join: daysAgo(60), salary: 5_400_000 },   // due H+30
    { no: "MII00048", name: "Rizky Maulana", gender: "M", join: daysAgo(80), salary: 5_100_000 }, // due H+10 (dueSoon)
    { no: "MII00049", name: "Laila Sari", gender: "F", join: daysAgo(95), salary: 4_900_000 },  // due H-5 (overdue!)
  ];

  for (const h of hires) {
    const exists = await db.employee.findFirst({ where: { employeeNo: h.no }, select: { id: true, fullName: true } });
    if (exists) { console.log(`[Emp] ${h.no} ${h.fullName ?? exists.fullName} sudah ada — skip`); continue; }
    const e = await db.employee.create({
      data: {
        employeeNo: h.no, fullName: h.name, gender: h.gender,
        birthPlace: "Jakarta", birthDate: new Date(1998, 5, 17),
        maritalStatus: "Belum Menikah", religion: "Islam", bloodType: "O",
        email: `${h.name.toLowerCase().replace(" ", ".")}@mii.co.id`,
        phone: "08128000099", address: "Jl. Melati No. 8", city: "Jakarta",
        companyId: company.id, joinDate: h.join, status: "Active",
        contractStart: h.join,
        orgUnitId: posStaff?.orgUnitId ?? null, positionId: posStaff?.id ?? null,
        gradeId: gradeG1?.id ?? null,
      },
    });
    await db.employeeAssignment.create({
      data: {
        employeeId: e.id, orgUnitId: posStaff?.orgUnitId ?? null, positionId: posStaff?.id ?? null,
        gradeId: gradeG1?.id ?? null, managerId: bambang.id,
        employmentStatus: "Probation", workShift: "Regular",
        baseSalary: tc.encryptMoney(h.salary), validFrom: h.join, validTo: null,
        changeReason: "Initial", notes: "Penempatan awal (seed demo P7 percobaan)",
      },
    });
    if (posStaff) await db.position.update({ where: { id: posStaff.id }, data: { filled: { increment: 1 } } });
    // onboarding checklist ringkas (provenance D9)
    const onb = await db.onboarding.create({
      data: {
        employeeId: e.id, startDate: h.join, status: "Open",
        note: "Onboarding karyawan baru (seed demo P7)",
        tasks: {
          create: [
            { seq: 1, title: "Akun user & email perusahaan", owner: "IT", status: "Done", completedAt: daysAgo(58) },
            { seq: 2, title: "Perangkat kerja & akses sistem", owner: "IT", status: "Done", completedAt: daysAgo(57) },
            { seq: 3, title: "Kontrak kerja & dokumen kepegawaian", owner: "HR", status: "Pending" },
            { seq: 4, title: "Registrasi BPJS & asuransi", owner: "HR", status: "Pending" },
          ],
        },
      },
    });
    console.log(`[Emp] ${h.no} ${h.name} dibuat (join ${h.join.toISOString().slice(0, 10)}, atasan Bambang) + onboarding ${onb.id.slice(0, 8)}`);
  }

  // ---------- D9: ProbationEvaluation via service (uji + idempotensi 2×) ----------
  for (const h of hires) {
    const emp = await db.employee.findFirst({ where: { employeeNo: h.no }, select: { id: true, fullName: true } });
    if (!emp) continue;
    const onb = await db.onboarding.findFirst({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" } });
    if (!onb) { console.log(`[D9] ${h.no} tanpa onboarding — skip`); continue; }
    const r1 = await createProbationFromOnboarding(db, { employeeId: emp.id, onboardingId: onb.id, joinDate: h.join, actor: "seed-p7-demo" });
    const r2 = await createProbationFromOnboarding(db, { employeeId: emp.id, onboardingId: onb.id, joinDate: h.join, actor: "seed-p7-demo" }); // idempotensi
    const dup = r1.id === r2.id && r1.docNo === r2.docNo;
    const count = await db.probationEvaluation.count({ where: { employeeId: emp.id } });
    console.log(`[D9] ${h.no} → ${r1.docNo} (due ${new Date(h.join.getTime() + 90 * DAY).toISOString().slice(0, 10)}) idempoten=${dup ? "OK (2× panggil → 1 baris)" : "GAGAL"} count=${count}`);
  }

  console.log(`\nSELESAI — E2E P7 siap: 3 evaluasi percobaan (Eka H+30 / Rizky H+10 dueSoon / Laila H-5 overdue) — atasan Bambang MII00003, login owner hrd@mii.co.id`);
}

main().catch((e) => { console.error(e); process.exit(1); });
