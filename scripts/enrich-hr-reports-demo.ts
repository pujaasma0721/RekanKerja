// Enrich demo data MII untuk tab "Reports" (T104 — Laporan Distribusi HR) =====
// Idempoten: tiap langkah mengecek kondisi sebelum menulis. Menambah:
//   1. JoinDate realistis utk 2 karyawan Probation (2026) → R2.3 & R3.1.
//   2. ContractEnd "Safe" (>90 hari) utk 1 kontrak (MII00013) → R2.1 lengkap.
//   3. 2 karyawan baru (Okt 2026, tanpa no. BPJS → diskrepansi R4.2) +
//      assignment + onboarding checklist + contract utk salah satunya.
//   4. 1 karyawan resign Sep 2026 (exit interview + handover) → R3.2 & R3.3.
//   5. Offboarding + exit interview utk 2 exit lama (2024).
//   6. ~15 EmployeeDocument (Sertifikat K3/APAR/Forklift/ISO/SIM/Paspor)
//      dengan status expiry campuran → R4.4.
//   7. Null-kan beberapa no. BPJS karyawan aktif → discrepancy R4.2.
// Jalankan: bun run scripts/enrich-hr-reports-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb, type FieldCrypto } from "@/rekankerja/shared/lib/field-crypto";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

const DAY = 24 * 3600 * 1000;
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const tc: FieldCrypto = tenantCryptoForDb(db);

  const company = await db.company.findFirst({ select: { id: true, name: true } });
  if (!company) throw new Error("Company MII tidak ditemukan — jalankan restore-demo dulu");

  // posisi & master referensi by code
  const [positions, grades, units, hrMgr, prdMgr] = await Promise.all([
    db.position.findMany({ select: { id: true, code: true, title: true, orgUnitId: true } }),
    db.grade.findMany({ select: { id: true, code: true } }),
    db.orgUnit.findMany({ select: { id: true, code: true, name: true } }),
    db.employee.findFirst({ where: { employeeNo: "MII000004" }, select: { id: true } }),
    db.employee.findFirst({ where: { employeeNo: "MII000003" }, select: { id: true } }),
  ]);
  const posBy = (code: string) => positions.find((p) => p.code === code);
  const gradeBy = (code: string) => grades.find((g) => g.code === code);

  const noEmp = (no: string) => db.employee.findFirst({ where: { employeeNo: no }, select: { id: true, employeeNo: true, fullName: true } });

  // ---------- 1. Probation joinDate → realistis 2026 (R2.3, R3.1) ----------
  const probShifts: [string, Date][] = [
    ["MII00035", new Date("2026-09-21")],
    ["MII00014", new Date("2026-10-01")],
  ];
  for (const [no, jd] of probShifts) {
    const e = await noEmp(no);
    if (!e) continue;
    const cur = await db.employee.findUnique({ where: { id: e.id }, select: { joinDate: true } });
    if (cur && cur.joinDate.getFullYear() < 2026) {
      await db.employee.update({ where: { id: e.id }, data: { joinDate: jd } });
      await db.employeeAssignment.updateMany({ where: { employeeId: e.id, changeReason: "Initial" }, data: { validFrom: jd } });
      console.log(`[1] joinDate ${e.employeeNo} ${e.fullName} → ${iso(jd).slice(0, 10)}`);
    }
  }

  // ---------- 2. ContractEnd Safe >90 hari (R2.1 lengkap semua level) ----------
  const t13 = await noEmp("MII00013");
  if (t13) {
    const cur = await db.employee.findUnique({ where: { id: t13.id }, select: { contractEnd: true } });
    if (cur?.contractEnd && cur.contractEnd.getTime() < Date.now()) {
      await db.employee.update({ where: { id: t13.id }, data: { contractEnd: new Date("2027-02-28") } });
      console.log(`[2] contractEnd MII00013 → 2027-02-28 (Safe >90 hari)`);
    }
  }

  // ---------- 3. Dua karyawan baru Okt 2026 (R3.1, R4.2 discrepancy) ----------
  const newHires: {
    no: string; first: string; last: string; gender: string; posCode: string; grade: string;
    join: Date; empStatus: string; contractEnd?: Date; salary: number; managerId?: string | null;
  }[] = [
    {
      no: "MII00045", first: "Andini", last: "Pratiwi", gender: "F", posCode: "P-RCT", grade: "G1",
      join: new Date("2026-10-01"), empStatus: "Probation", salary: 5400000, managerId: hrMgr?.id ?? null,
    },
    {
      no: "MII00046", first: "Fajar", last: "Nugroho", gender: "M", posCode: "P-OPR", grade: "G1",
      join: new Date("2026-10-05"), empStatus: "Contract", contractEnd: new Date("2027-04-05"),
      salary: 4900000, managerId: prdMgr?.id ?? null,
    },
  ];
  // hindari duplikat definisi di atas (guard)
  const seen = new Set<string>();
  for (const h of newHires) {
    if (seen.has(h.no)) continue;
    seen.add(h.no);
    const exists = await noEmp(h.no);
    if (exists) { console.log(`[3] ${h.no} sudah ada — skip`); continue; }
    const pos = posBy(h.posCode);
    const e = await db.employee.create({
      data: {
        employeeNo: h.no, fullName: `${h.first} ${h.last}`, gender: h.gender,
        birthPlace: "Jakarta", birthDate: new Date(1999, 3, 11),
        nationalId: `3175019904${110000 + seen.size * 7}`,
        taxId: `09123456${700 + seen.size}`,
        maritalStatus: "Belum Menikah", religion: h.gender === "F" ? "Islam" : "Kristen",
        bloodType: "O", email: `${h.first.toLowerCase()}.${h.last.toLowerCase()}@mii.co.id`,
        phone: `0812${8000000 + seen.size * 13}`,
        address: `Jl. Cempaka Putih No. ${10 + seen.size}`, city: "Jakarta",
        bankName: "BCA", bankAccount: `0123${4500000 + seen.size}`,
        companyId: company.id, joinDate: h.join, status: "Active",
        contractStart: h.empStatus === "Probation" ? h.join : h.join,
        contractEnd: h.contractEnd ?? null,
        orgUnitId: pos?.orgUnitId ?? null, positionId: pos?.id ?? null,
        gradeId: gradeBy(h.grade)?.id ?? null,
      },
    });
    await db.employeeAssignment.create({
      data: {
        employeeId: e.id, orgUnitId: pos?.orgUnitId ?? null, positionId: pos?.id ?? null,
        gradeId: gradeBy(h.grade)?.id ?? null, managerId: h.managerId ?? null,
        employmentStatus: h.empStatus, workShift: h.posCode === "P-OPR" ? "Shift 1" : "Regular",
        baseSalary: tc.encryptMoney(h.salary), validFrom: h.join, validTo: null,
        changeReason: "Initial", notes: "Penempatan awal saat onboarding",
      },
    });
    if (pos) await db.position.update({ where: { id: pos.id }, data: { filled: { increment: 1 } } });
    // onboarding checklist (2 tugas IT sudah Done, sisanya Pending — progress realistis)
    await db.onboarding.create({
      data: {
        employeeId: e.id, startDate: h.join, status: "Open",
        note: "Checklist onboarding dibuat otomatis (enrich T104)",
        tasks: {
          create: [
            { seq: 1, title: "Penyiapan akun user aplikasi (RekanKerja, email perusahaan)", owner: "IT", status: "Done", completedAt: daysFromNow(-3) },
            { seq: 2, title: "Penyiapan perangkat kerja — laptop & akses sistem", owner: "IT", status: "Done", completedAt: daysFromNow(-2) },
            { seq: 3, title: "Penyiapan meja, kursi & perlengkapan kerja", owner: "GA", status: "Done", completedAt: daysFromNow(-1) },
            { seq: 4, title: "Kartu akses kantor & absensi (finger/face)", owner: "GA", status: "Pending" },
            { seq: 5, title: "Kontrak kerja & dokumen kepegawaian ditandatangani", owner: "HR", status: "Pending" },
            { seq: 6, title: "Orientasi & intro team (induction)", owner: "Supervisor", status: "Pending" },
            { seq: 7, title: "Registrasi BPJS & asuransi", owner: "HR", status: "Pending" },
            { seq: 8, title: "Input data payroll — rekening, NPWP, template upah", owner: "Payroll", status: "Pending" },
          ],
        },
      },
    });
    console.log(`[3] karyawan baru ${h.no} ${h.first} ${h.last} (${h.empStatus}, join ${iso(h.join).slice(0, 10)}) + onboarding`);
  }

  // ---------- 4. Karyawan resign Sep 2026 (R3.2, R3.3) ----------
  const R_NO = "MII00047";
  if (!(await noEmp(R_NO))) {
    const pos = posBy("P-SUP");
    const e = await db.employee.create({
      data: {
        employeeNo: R_NO, fullName: "Yusuf Hendrawan", gender: "M",
        birthPlace: "Surabaya", birthDate: new Date(1990, 8, 24),
        nationalId: "3578022409900003", taxId: "098765432100000",
        maritalStatus: "Menikah", religion: "Islam", bloodType: "B",
        email: "yusuf.hendrawan@mii.co.id", phone: "08156612345",
        address: "Jl. Rungkut Industri No. 8", city: "Surabaya",
        bankName: "Mandiri", bankAccount: "140001122334",
        companyId: company.id, joinDate: new Date("2025-05-04"),
        endDate: new Date("2026-09-30"), status: "Resigned",
        orgUnitId: pos?.orgUnitId ?? null, positionId: pos?.id ?? null,
        gradeId: gradeBy("G3")?.id ?? null,
      },
    });
    await db.employeeAssignment.create({
      data: {
        employeeId: e.id, orgUnitId: pos?.orgUnitId ?? null, positionId: pos?.id ?? null,
        gradeId: gradeBy("G3")?.id ?? null, managerId: prdMgr?.id ?? null,
        employmentStatus: "Permanent", workShift: "Regular",
        baseSalary: tc.encryptMoney(11500000), validFrom: new Date("2025-05-04"),
        validTo: new Date("2026-09-29T23:59:59"), changeReason: "Initial",
        notes: "Penempatan awal saat onboarding",
      },
    });
    if (pos) await db.position.update({ where: { id: pos.id }, data: { filled: { increment: 1 } } });
    // offboarding — handover selesai, exit interview terisi
    const ob = await db.offboarding.create({
      data: {
        employeeId: e.id, lastDay: new Date("2026-09-30"),
        reason: "Mendapat tawaran karier di perusahaan lain",
        status: "Completed", completedAt: new Date("2026-10-01"),
        exitInterviewJson: JSON.stringify({
          reason: "Karier — tawaran posisi lebih tinggi",
          nextPlan: "Supervisor produksi di perusahaan manufaktur lain (Surabaya)",
          feedback: "Proses kerja & koordinasi tim sudah baik; jam lembur shift bisa lebih terstruktur",
          satisfaction: 4,
          notes: "Bersedia menjadi referensi; tidak ada masalah penyelesaian akhir",
        }),
        tasks: {
          create: [
            { seq: 1, title: "Serah terima pekerjaan & dokumen (handover)", owner: "Supervisor", status: "Done", completedAt: new Date("2026-09-29") },
            { seq: 2, title: "Pengembalian aset IT — laptop & perangkat", owner: "IT", status: "Done", completedAt: new Date("2026-09-29") },
            { seq: 3, title: "Penonaktifan akses sistem, email & akun aplikasi", owner: "IT", status: "Done", completedAt: new Date("2026-09-30") },
            { seq: 4, title: "Clearance keuangan — kasbon, pinjaman karyawan, piutang", owner: "Finance", status: "Done", completedAt: new Date("2026-09-30") },
            { seq: 5, title: "Pengembalian kartu akses, seragam & aset kantor", owner: "GA", status: "Done", completedAt: new Date("2026-09-30") },
            { seq: 6, title: "Administrasi BPJS & asuransi (penghentian iuran)", owner: "HR", status: "Done", completedAt: new Date("2026-10-01") },
            { seq: 7, title: "Terbitkan surat keterangan PHK & daftar upah utk klaim JKP (BPJS Ketenagakerjaan — PP 6/2025)", owner: "HR", status: "Na" },
            { seq: 8, title: "Exit interview", owner: "HR", status: "Done", completedAt: new Date("2026-09-28") },
            { seq: 9, title: "Slip final settlement & surat keterangan kerja", owner: "Payroll", status: "Done", completedAt: new Date("2026-10-01") },
            { seq: 10, title: "Arsip dokumen kepegawaian & tanda tangan berita acara", owner: "HR", status: "Done", completedAt: new Date("2026-10-01") },
          ],
        },
      },
    });
    console.log(`[4] karyawan resign ${R_NO} Yusuf Hendrawan (30 Sep 2026) + offboarding ${ob.id.slice(0, 8)}`);
  }

  // ---------- 5. Offboarding utk 2 exit lama 2024 (R3.2) ----------
  const legacyExits: { no: string; lastDay: Date; reason: string; interview: object; donePct: number }[] = [
    {
      no: "MII00043", lastDay: new Date("2024-06-30"), reason: "Faktor keluarga — pindah ke luar kota",
      interview: {
        reason: "Faktor keluarga — mengikuti pasangan pindah tugas ke Balikpapan",
        nextPlan: "Mencari pekerjaan baru di Balikpapan",
        feedback: "Lingkungan kerja nyaman, fasilitas shift operasional perlu evaluasi",
        satisfaction: 4, notes: "Administrasi kepegawaian cepat & jelas",
      },
      donePct: 1.0,
    },
    {
      no: "MII00044", lastDay: new Date("2024-11-15"), reason: "Pelanggaran disiplin berulang (SP-3)",
      interview: {
        reason: "Pelanggaran disiplin berulang (SP-1 s.d. SP-3)",
        nextPlan: "Belum ada rencana",
        feedback: "—",
        satisfaction: 2, notes: "Exit interview singkat, tanpa hambatan",
      },
      donePct: 0.9,
    },
  ];
  for (const x of legacyExits) {
    const e = await noEmp(x.no);
    if (!e) continue;
    const has = await db.offboarding.findFirst({ where: { employeeId: e.id }, select: { id: true } });
    if (has) continue;
    const allDone = x.donePct >= 1;
    await db.offboarding.create({
      data: {
        employeeId: e.id, lastDay: x.lastDay, reason: x.reason,
        status: "Completed", completedAt: x.lastDay,
        exitInterviewJson: JSON.stringify(x.interview),
        tasks: {
          create: [
            { seq: 1, title: "Serah terima pekerjaan & dokumen (handover)", owner: "Supervisor", status: "Done", completedAt: x.lastDay },
            { seq: 2, title: "Pengembalian aset IT — laptop & perangkat", owner: "IT", status: "Done", completedAt: x.lastDay },
            { seq: 3, title: "Penonaktifan akses sistem, email & akun aplikasi", owner: "IT", status: "Done", completedAt: x.lastDay },
            { seq: 4, title: "Clearance keuangan — kasbon, pinjaman karyawan, piutang", owner: "Finance", status: "Done", completedAt: x.lastDay },
            { seq: 5, title: "Pengembalian kartu akses, seragam & aset kantor", owner: "GA", status: "Done", completedAt: x.lastDay },
            { seq: 6, title: "Administrasi BPJS & asuransi (penghentian iuran)", owner: "HR", status: "Done", completedAt: x.lastDay },
            { seq: 7, title: "Terbitkan surat keterangan PHK & daftar upah utk klaim JKP (BPJS Ketenagakerjaan — PP 6/2025)", owner: "HR", status: x.no === "MII00044" ? "Done" : "Na", completedAt: x.lastDay },
            { seq: 8, title: "Exit interview", owner: "HR", status: "Done", completedAt: x.lastDay },
            { seq: 9, title: "Slip final settlement & surat keterangan kerja", owner: "Payroll", status: "Done", completedAt: x.lastDay },
            { seq: 10, title: "Arsip dokumen kepegawaian & tanda tangan berita acara", owner: "HR", status: "Done", completedAt: x.lastDay },
          ].map((t) => (allDone ? t : t.seq === 10 ? { ...t, status: "Pending", completedAt: null } : t)),
        },
      },
    });
    console.log(`[5] offboarding + exit interview utk ${x.no}`);
  }

  // ---------- 6. EmployeeDocument — sertifikat & lisensi (R4.4) ----------
  const docCount = await db.employeeDocument.count();
  if (docCount === 0) {
    // pilih karyawan per grup posisi (produksi=K3, QA=ISO, HR=HR cert, dst.)
    const staff = await db.employee.findMany({
      where: { status: "Active" },
      select: { id: true, employeeNo: true, fullName: true, positionId: true },
      orderBy: { employeeNo: "asc" },
    });
    const posIdBy = (code: string) => positions.find((p) => p.code === code)?.id;
    const byPos = (codes: string[]) => staff.filter((s) => codes.some((c) => s.positionId === posIdBy(c)));

    interface DocDef { no: string; docType: string; docNumber: string; issuedAt: Date; expiresAt: Date | null; notes: string }
    const defs: DocDef[] = [];

    const k3Pool = [...byPos(["P-OPR"]), ...byPos(["P-MAINT"])].slice(0, 6);
    const k3Spec: (Date | null)[] = [new Date("2023-11-10"), new Date("2024-06-20"), new Date("2025-01-15"), new Date("2024-09-05"), new Date("2023-05-30"), new Date("2025-08-12")];
    k3Pool.forEach((e, i) => {
      const issued = k3Spec[i % k3Spec.length]!;
      defs.push({
        no: e.employeeNo, docType: "Sertifikat",
        docNumber: `K3U-2023-${String(1100 + i * 37)}`,
        issuedAt: issued, expiresAt: new Date(issued.getFullYear() + 3, issued.getMonth(), issued.getDate()),
        notes: "Sertifikat K3 Umum (Kemnaker) — Safety & Health Officer",
      });
    });
    // APAR + Forklift + First Aid untuk 3 operator pertama
    const opr = byPos(["P-OPR"]).slice(0, 3);
    if (opr[0]) defs.push({ no: opr[0].employeeNo, docType: "Sertifikat", docNumber: "APR-2024-078", issuedAt: new Date("2024-03-01"), expiresAt: new Date("2026-12-01"), notes: "Sertifikat Pengoperasian APAR (Fire Fighting)" });
    if (opr[1]) defs.push({ no: opr[1].employeeNo, docType: "Sertifikat", docNumber: "FL-2025-041", issuedAt: new Date("2025-04-10"), expiresAt: new Date("2027-04-10"), notes: "Lisensi Operator Forklift (BNSP)" });
    if (opr[2]) defs.push({ no: opr[2].employeeNo, docType: "Sertifikat", docNumber: "FA-2026-015", issuedAt: new Date("2026-01-20"), expiresAt: new Date("2028-01-20"), notes: "Sertifikat First Aid / P3K di Tempat Kerja" });

    const qa = byPos(["P-QAM", "P-QAS"]).slice(0, 2);
    if (qa[0]) defs.push({ no: qa[0].employeeNo, docType: "Sertifikat", docNumber: "ISO-IA-2024-22", issuedAt: new Date("2024-08-01"), expiresAt: new Date("2027-08-01"), notes: "ISO 9001:2015 Internal Auditor (LSP)" });
    if (qa[1]) defs.push({ no: qa[1].employeeNo, docType: "Sertifikat", docNumber: "ISO-IA-2023-09", issuedAt: new Date("2023-10-05"), expiresAt: new Date("2026-10-20"), notes: "ISO 14001 Internal Auditor (LSP)" });

    const hrStaff = byPos(["P-HRM", "P-HRS"]).slice(0, 2);
    if (hrStaff[0]) defs.push({ no: hrStaff[0].employeeNo, docType: "Sertifikat", docNumber: "CHRP-2022-118", issuedAt: new Date("2022-11-15"), expiresAt: new Date("2025-11-15"), notes: "Certified HR Professional (CHRP) — kedaluwarsa, perlu renew" });
    if (hrStaff[1]) defs.push({ no: hrStaff[1].employeeNo, docType: "Sertifikat", docNumber: "P2K3-2025-03", issuedAt: new Date("2025-02-01"), expiresAt: new Date("2027-02-01"), notes: "Sertifikat Anggota P2K3 (Perusahaan)" });

    const itStaff = byPos(["P-ITM", "P-DEV"]).slice(0, 2);
    if (itStaff[0]) defs.push({ no: itStaff[0].employeeNo, docType: "Sertifikat", docNumber: "ITS-2024-77", issuedAt: new Date("2024-05-20"), expiresAt: new Date("2027-05-20"), notes: "Sertifikat Keahlian Sistem Informasi (BNSP)" });
    if (itStaff[1]) defs.push({ no: itStaff[1].employeeNo, docType: "Sertifikat", docNumber: "ITS-2021-31", issuedAt: new Date("2021-09-01"), expiresAt: new Date("2024-09-01"), notes: "Sertifikat Keahlian Teknis (BNSP) — kedaluwarsa" });

    // SIM A & Paspor utk beberapa karyawan (lisensi kerja + perjalanan dinas)
    const drivers = [...byPos(["P-GAS"]), ...byPos(["P-SUP"])].slice(0, 3);
    if (drivers[0]) defs.push({ no: drivers[0].employeeNo, docType: "SIM", docNumber: "SIM-A 0112334455", issuedAt: new Date("2022-10-12"), expiresAt: new Date("2026-10-17"), notes: "SIM A — perpanjang sebelum 17 Okt 2026" });
    if (drivers[1]) defs.push({ no: drivers[1].employeeNo, docType: "SIM", docNumber: "SIM-B1 0199887766", issuedAt: new Date("2024-02-01"), expiresAt: new Date("2028-02-01"), notes: "SIM B1 Umum" });
    const mkt = byPos(["P-MKT"]).slice(0, 2);
    if (mkt[0]) defs.push({ no: mkt[0].employeeNo, docType: "Paspor", docNumber: "XR 981234", issuedAt: new Date("2021-06-15"), expiresAt: new Date("2026-11-30"), notes: "Paspor — berlaku s.d. 30 Nov 2026" });
    if (mkt[1]) defs.push({ no: mkt[1].employeeNo, docType: "Paspor", docNumber: "XR 774412", issuedAt: new Date("2024-01-10"), expiresAt: new Date("2029-01-10"), notes: "Paspor — aktif" });

    const byNo = new Map(staff.map((s) => [s.employeeNo, s.id]));
    let n = 0;
    for (const d of defs) {
      const empId = byNo.get(d.no);
      if (!empId) continue;
      await db.employeeDocument.create({
        data: {
          employeeId: empId, docType: d.docType, docNumber: d.docNumber,
          issuedAt: d.issuedAt, expiresAt: d.expiresAt, notes: d.notes,
        },
      });
      n++;
    }
    console.log(`[6] ${n} EmployeeDocument (sertifikat/lisensi/SIM/paspor) dibuat`);
  }

  // ---------- 7. Null beberapa no. BPJS aktif (discrepancy R4.2) ----------
  const bpjsNull: { no: string; field: "bpjsHealth" | "bpjsEmpSkill" }[] = [
    { no: "MII00015", field: "bpjsEmpSkill" },
    { no: "MII00028", field: "bpjsHealth" },
    { no: "MII00035", field: "bpjsEmpSkill" },
  ];
  for (const b of bpjsNull) {
    const e = await noEmp(b.no);
    if (!e) continue;
    const cur = await db.employee.findUnique({ where: { id: e.id }, select: { [b.field]: true } });
    if (cur?.[b.field]) {
      await db.employee.update({ where: { id: e.id }, data: { [b.field]: null } });
      console.log(`[7] ${b.no} ${b.field} → null (rekon BPJS)`);
    }
  }

  // ---------- ringkasan ----------
  const [emp, active, docs, offb, onb] = await Promise.all([
    db.employee.count(), db.employee.count({ where: { status: "Active" } }),
    db.employeeDocument.count(), db.offboarding.count(), db.onboarding.count(),
  ]);
  console.log(`== Selesai. Total ${emp} karyawan (${active} aktif), ${docs} dokumen, ${offb} offboarding, ${onb} onboarding ==`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
