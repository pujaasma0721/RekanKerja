// Uji E2E P3.2 (Skills foundation — DEVELOPMENT-PLAN-BENCHMARK.md §2 D-BM24 +
// §4 P3.2) di atas data demo MII:
//   (0) SETUP: login HR owner hrd@mii.co.id (platform OWNER → semua guard
//       menu lolos); pre-clean artefak run lama ber-marker E2E-P32.
//   (1) KATALOG CRUD: create (kode unik + nama + kategori) → 201; duplikat
//       kode → 400; create kedua; PATCH ubah nama/urutan; PATCH toggle aktif
//       → 200; GET daftar memuat 2 skill + usage 0.
//   (2) PENILAIAN KARYAWAN (assess-employee): upsert level 5 → row level 5;
//       update level 2 → 200 updated:true; level 9 → 400; skillId acak → 400;
//       GET ?employeeId= memuat baris; DELETE ?employeeSkillId → row hilang.
//   (3) SYARAT POSISI: POST posisi + requiredSkills [A=2, B=4] → 201 + json
//       tersimpan; level 9 → 400; duplikat skillId → 400; >15 entri → 400;
//       skill non-aktif → 400; PATCH ubah requirements → 200; GET daftar
//       posisi memuat requiredSkills ter-parse + nama.
//   (4) GAP ANALYSIS: 2 karyawan fixture (E1 skill A=5 B=1 → met 1/2; E2
//       tanpa skill → 0/2) → GET ?gapFor= : requirements 2, employees 2,
//       rincian required/actual/ok benar, summary allMet=0 halfOrMore=1.
//   (5) GUARD HAPUS KATALOG: DELETE skill A → 400 (dipakai penilaian + posisi);
//       hapus penilaian E1 → masih 400 (posisi); PATCH posisi lepas A →
//       DELETE → 200.
//   (6) JEMBATAN PELAMAR→KARYAWAN: pelamar + 2 ApplicantSkill (1 nama cocok
//       "Microsoft Excel", 1 tanpa padanan katalog) → impor langsung dari
//       service → EmployeeSkill level 3 + evidence "Diimpor dari rekrutmen —"
//       + yang tak cocok DILEWATI + ActivityLog "(1 cocok)" + panggil ulang
//       tidak menduplikasi.
// CLEANUP: posisi + karyawan fixture (cascade assignment/skill) + katalog uji
//       + master Skill rekrutmen + pelamar (cascade ApplicantSkill).
//       ActivityLog DIPERTAHANKAN (audit trail — pola B8).
// Jalankan: bun scripts/e2e-p32-skills.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { importApplicantSkillsToEmployee } from "@/rekankerja/human-resource/services/skill-service";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const SKILLS_API = "/api/rekankerja/skills";
const POSITIONS_API = "/api/rekankerja/positions";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor — pola e2e-p1 (retry gangguan socket transient). */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];
        const text = await res.text();
        let json: any = {};
        try { json = JSON.parse(text); } catch { /* keep */ }
        return { status: res.status, json, text };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const NONCE = `E2E-P32-${Date.now().toString(36).toUpperCase()}`;
  const CODE_A = "SKL-E32A";
  const CODE_B = "SKL-E32B";

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login HR owner + pre-clean artefak run lama");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  const company = await db.company.findFirst({ select: { id: true, code: true } });
  ok(!!company, "company tenant ditemukan", company?.code ?? "—");

  // pre-clean run lama (posisi + karyawan + katalog + master skill + pelamar uji)
  const stalePos = await db.position.findMany({ where: { code: "P-E2E32" }, select: { id: true } });
  const staleEmp = await db.employee.findMany({ where: { employeeNo: { startsWith: "E2E32-" } }, select: { id: true } });
  for (const e of staleEmp) await db.employee.delete({ where: { id: e.id } }).catch(() => {});
  for (const p of stalePos) await db.position.delete({ where: { id: p.id } }).catch(() => {});
  await db.skillCatalog.deleteMany({ where: { code: { in: [CODE_A, CODE_B] } } });
  const staleRecSkill = await db.skill.findMany({ where: { code: { startsWith: "SKL-REC-E32" } }, select: { id: true } });
  for (const s of staleRecSkill) await db.applicantSkill.deleteMany({ where: { skillId: s.id } }).catch(() => {});
  await db.skill.deleteMany({ where: { code: { startsWith: "SKL-REC-E32" } } });
  await db.applicant.deleteMany({ where: { applicantNo: { startsWith: "APP-E2E32-" } } });
  const baseline = {
    catalog: await db.skillCatalog.count(),
    employeeSkill: await db.employeeSkill.count(),
    positions: await db.position.count(),
    employees: await db.employee.count(),
    applicants: await db.applicant.count(),
    recSkills: await db.skill.count(),
  };

  // ================= (1) KATALOG CRUD =================
  console.log("\n[(1)] KATALOG — create / duplikat / update / toggle / daftar");
  const c1 = await hr.api("POST", SKILLS_API, {
    action: "create", code: CODE_A, name: "E2E Alpha Keahlian", category: "Teknis", sortOrder: 10,
  });
  ok(c1.status === 201, `create ${CODE_A} → 201`, `HTTP ${c1.status} — ${c1.json?.error ?? ""}`);
  const skillA: { id: string } | null = await db.skillCatalog.findUnique({ where: { code: CODE_A }, select: { id: true } });
  ok(!!skillA, "row katalog A tersimpan di db");

  const dup = await hr.api("POST", SKILLS_API, { action: "create", code: CODE_A, name: "Duplikat", category: null });
  ok(dup.status === 400, "duplikat kode → 400", `HTTP ${dup.status}`);

  const c2 = await hr.api("POST", SKILLS_API, {
    action: "create", code: CODE_B, name: "E2E Beta Keahlian", category: "Soft Skill", sortOrder: 20,
  });
  ok(c2.status === 201, `create ${CODE_B} → 201`, `HTTP ${c2.status}`);
  const skillB: { id: string } | null = await db.skillCatalog.findUnique({ where: { code: CODE_B }, select: { id: true } });
  ok(!!skillB, "row katalog B tersimpan di db");

  const u1 = await hr.api("PATCH", SKILLS_API, { id: skillA!.id, name: "E2E Alpha Keahlian (rev)", sortOrder: 15 });
  ok(u1.status === 200 && u1.json?.skill?.name === "E2E Alpha Keahlian (rev)", "PATCH ubah nama+urutan → 200", u1.json?.skill?.name ?? u1.json?.error);
  const t1 = await hr.api("PATCH", SKILLS_API, { id: skillB!.id, active: false });
  ok(t1.status === 200 && t1.json?.skill?.active === false, "PATCH toggle non-aktif → 200", `active=${t1.json?.skill?.active}`);
  const t2 = await hr.api("PATCH", SKILLS_API, { id: skillB!.id, active: true });
  ok(t2.status === 200 && t2.json?.skill?.active === true, "PATCH toggle kembali aktif → 200");

  const list1 = await hr.api("GET", `${SKILLS_API}?q=${encodeURIComponent("E2E")}`);
  ok(list1.status === 200, "GET daftar katalog → 200", `HTTP ${list1.status}`);
  const rowsA = (list1.json?.skills ?? []).filter((s: any) => s.code === CODE_A || s.code === CODE_B);
  ok(rowsA.length === 2, "pencarian q memuat 2 skill uji", `${rowsA.length} baris`);
  ok(rowsA.every((s: any) => s.employeeCount === 0 && s.positionCount === 0), "usage awal = 0/0");

  const opt1 = await hr.api("GET", `${SKILLS_API}?options=1`);
  ok(opt1.status === 200 && (opt1.json?.skills ?? []).every((s: any) => s.active !== false), "GET ?options=1 → hanya katalog aktif", `${opt1.json?.skills?.length ?? 0} opsi`);

  // ================= (2) PENILAIAN KARYAWAN =================
  console.log("\n[(2)] ASSESS-EMPLOYEE — upsert / update / validasi / hapus");
  const yusuf = await db.employee.findFirst({
    where: { fullName: { contains: "Yusuf" } },
    select: { id: true, employeeNo: true, fullName: true },
  });
  ok(!!yusuf, "karyawan fixture yusuf ditemukan", yusuf?.employeeNo ?? "—");

  const a1 = await hr.api("POST", SKILLS_API, {
    action: "assess-employee", employeeId: yusuf!.id, skillId: skillA!.id, level: 5,
    evidence: `${NONCE} sertifikat uji`, assessedAt: "2026-01-15",
  });
  ok(a1.status === 200 && a1.json?.employeeSkill?.level === 5, "assess level 5 → 200", `HTTP ${a1.status}`);
  const es1 = await db.employeeSkill.findUnique({
    where: { employeeId_skillId: { employeeId: yusuf!.id, skillId: skillA!.id } },
    select: { id: true, level: true, evidence: true, assessedAt: true },
  });
  ok(es1?.level === 5, "row EmployeeSkill level 5 tersimpan");
  ok(es1?.evidence === `${NONCE} sertifikat uji`, "evidence tersimpan", es1?.evidence ?? "—");
  ok(es1 != null && new Date(es1.assessedAt).toISOString().slice(0, 10) === "2026-01-15", "assessedAt mengikuti input", es1 ? new Date(es1.assessedAt).toISOString().slice(0, 10) : "—");

  const a2 = await hr.api("POST", SKILLS_API, {
    action: "assess-employee", employeeId: yusuf!.id, skillId: skillA!.id, level: 2, evidence: "penilaian ulang",
  });
  ok(a2.status === 200 && a2.json?.updated === true, "assess ulang → 200 updated:true (upsert)", `HTTP ${a2.status}`);
  const es2 = await db.employeeSkill.findUnique({
    where: { employeeId_skillId: { employeeId: yusuf!.id, skillId: skillA!.id } },
    select: { level: true },
  });
  ok(es2?.level === 2, "level ter-update ke 2 (tidak menduplikasi baris)", String(es2?.level));
  const cntYusuf = await db.employeeSkill.count({ where: { employeeId: yusuf!.id, skillId: skillA!.id } });
  ok(cntYusuf === 1, "tetap 1 baris untuk pasangan karyawan+skill (unique)", String(cntYusuf));

  const badLevel = await hr.api("POST", SKILLS_API, { action: "assess-employee", employeeId: yusuf!.id, skillId: skillA!.id, level: 9 });
  ok(badLevel.status === 400, "level 9 → 400", `HTTP ${badLevel.status}`);
  const badSkill = await hr.api("POST", SKILLS_API, { action: "assess-employee", employeeId: yusuf!.id, skillId: "tidak-ada-xyz", level: 3 });
  ok(badSkill.status === 400, "skillId acak → 400", `HTTP ${badSkill.status}`);
  const badEmp = await hr.api("POST", SKILLS_API, { action: "assess-employee", employeeId: "tidak-ada-xyz", skillId: skillA!.id, level: 3 });
  ok(badEmp.status === 404, "employeeId acak → 404", `HTTP ${badEmp.status}`);

  const empList = await hr.api("GET", `${SKILLS_API}?employeeId=${yusuf!.id}`);
  ok(empList.status === 200, "GET ?employeeId → 200", `HTTP ${empList.status}`);
  const empSkillRow = (empList.json?.skills ?? []).find((s: any) => s.skillId === skillA!.id);
  ok(!!empSkillRow && empSkillRow.skill?.name === "E2E Alpha Keahlian (rev)" && empSkillRow.level === 2,
    "GET ?employeeId memuat skill + nama katalog + level", JSON.stringify(empSkillRow?.skill ?? null));

  const del1 = await hr.api("DELETE", `${SKILLS_API}?employeeSkillId=${es1!.id}`);
  ok(del1.status === 200, "DELETE ?employeeSkillId → 200", `HTTP ${del1.status}`);
  const esGone = await db.employeeSkill.findUnique({
    where: { employeeId_skillId: { employeeId: yusuf!.id, skillId: skillA!.id } },
    select: { id: true },
  });
  ok(esGone == null, "penilaian yusuf terhapus");
  const logAssess = await db.activityLog.count({ where: { entity: "EmployeeSkill", employeeId: yusuf!.id, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  ok(logAssess >= 3, "ActivityLog penilaian tertulis (created/updated/deleted)", `${logAssess} baris`);

  // ================= (3) SYARAT POSISI + VALIDASI =================
  console.log("\n[(3)] SYARAT POSISI — simpan requiredSkills + guard validasi");
  const p1 = await hr.api("POST", POSITIONS_API, {
    code: "P-E2E32", title: "E2E Posisi 32", headcount: 2,
    requiredSkills: [{ skillId: skillA!.id, level: 2 }, { skillId: skillB!.id, level: 4 }],
  });
  ok(p1.status === 201, "POST posisi + 2 syarat → 201", `HTTP ${p1.status} — ${p1.json?.error ?? ""}`);
  const pos32: { id: string; requiredSkillsJson: string | null } | null = await db.position.findUnique({
    where: { code: "P-E2E32" }, select: { id: true, requiredSkillsJson: true },
  });
  ok(!!pos32, "posisi P-E2E32 tersimpan");
  const reqJson = JSON.parse(pos32?.requiredSkillsJson ?? "[]");
  ok(reqJson.length === 2 && reqJson[0]?.skillId === skillA!.id && reqJson[0]?.level === 2 && reqJson[1]?.level === 4,
    "requiredSkillsJson tersimpan [{skillId, level}]", pos32?.requiredSkillsJson ?? "—");

  const vLevel = await hr.api("POST", POSITIONS_API, { code: "P-E2E32X", title: "X", requiredSkills: [{ skillId: skillA!.id, level: 9 }] });
  ok(vLevel.status === 400, "level 9 → 400", `HTTP ${vLevel.status}`);
  const vDup = await hr.api("POST", POSITIONS_API, { code: "P-E2E32X", title: "X", requiredSkills: [{ skillId: skillA!.id, level: 2 }, { skillId: skillA!.id, level: 3 }] });
  ok(vDup.status === 400, "duplikat skillId → 400", `HTTP ${vDup.status}`);
  const manyIds = (await db.skillCatalog.findMany({ where: { active: true }, select: { id: true }, take: 16 })).map((s) => s.id);
  const vMax = await hr.api("POST", POSITIONS_API, { code: "P-E2E32X", title: "X", requiredSkills: manyIds.map((id) => ({ skillId: id, level: 1 })) });
  ok(vMax.status === 400, `>15 entri (${manyIds.length}) → 400`, `HTTP ${vMax.status}`);
  await db.skillCatalog.update({ where: { id: skillB!.id }, data: { active: false } });
  const vInactive = await hr.api("POST", POSITIONS_API, { code: "P-E2E32X", title: "X", requiredSkills: [{ skillId: skillB!.id, level: 3 }] });
  ok(vInactive.status === 400, "skill non-aktif sebagai syarat → 400", `HTTP ${vInactive.status}`);
  await db.skillCatalog.update({ where: { id: skillB!.id }, data: { active: true } });

  const patchPos = await hr.api("PATCH", POSITIONS_API, {
    id: pos32!.id, title: "E2E Posisi 32 (rev)", headcount: 2,
    requiredSkills: [{ skillId: skillA!.id, level: 2 }, { skillId: skillB!.id, level: 4 }],
  });
  ok(patchPos.status === 200, "PATCH posisi + syarat → 200", `HTTP ${patchPos.status}`);
  const posList = await hr.api("GET", `${POSITIONS_API}?q=E2E`);
  const posRow = (posList.json?.positions ?? []).find((p: any) => p.code === "P-E2E32");
  ok(
    posList.status === 200 && posRow?.requiredSkills?.length === 2
      && posRow.requiredSkills.some((r: any) => r.skillId === skillA!.id && r.level === 2 && r.name === "E2E Alpha Keahlian (rev)"),
    "GET positions memuat requiredSkills ter-parse + nama", JSON.stringify(posRow?.requiredSkills ?? null),
  );

  // ================= (4) GAP ANALYSIS =================
  console.log("\n[(4)] GAP ANALYSIS — fixture 2 pemegang + syarat [A≥2, B≥4]");
  const mkEmployee = async (no: string, name: string) => {
    const e = await db.employee.create({
      data: { employeeNo: no, fullName: name, gender: "M", companyId: company!.id, joinDate: new Date("2026-01-01"), status: "Active" },
      select: { id: true },
    });
    await db.employeeAssignment.create({
      data: { employeeId: e.id, positionId: pos32!.id, validFrom: new Date("2026-01-01"), changeReason: "Initial" },
    });
    return e;
  };
  const e1 = await mkEmployee("E2E32-001", "E2e Fixture Satu");
  const e2 = await mkEmployee("E2E32-002", "E2e Fixture Dua");
  ok(!!e1 && !!e2, "2 karyawan fixture + assignment aktif ke P-E2E32 dibuat");

  // E1: A=5 (memenuhi ≥2) + B=1 (tidak memenuhi ≥4) → met 1/2; E2: tanpa penilaian → 0/2
  const s1 = await hr.api("POST", SKILLS_API, { action: "assess-employee", employeeId: e1.id, skillId: skillA!.id, level: 5, evidence: null });
  const s2 = await hr.api("POST", SKILLS_API, { action: "assess-employee", employeeId: e1.id, skillId: skillB!.id, level: 1, evidence: null });
  ok(s1.status === 200 && s2.status === 200, "penilaian E1 (A=5, B=1) via API → 200", `HTTP ${s1.status}/${s2.status}`);

  const gap = await hr.api("GET", `${SKILLS_API}?gapFor=${pos32!.id}`);
  ok(gap.status === 200, "GET ?gapFor → 200", `HTTP ${gap.status}`);
  const g = gap.json ?? {};
  ok(g.position?.code === "P-E2E32", "payload memuat posisi", g.position?.code);
  ok(g.requirements?.length === 2 && g.requirements.some((r: any) => r.skillId === skillA!.id && r.level === 2),
    "requirements ter-parse [A=2, B=4]");
  const ge1 = (g.employees ?? []).find((x: any) => x.employeeNo === "E2E32-001");
  const ge2 = (g.employees ?? []).find((x: any) => x.employeeNo === "E2E32-002");
  ok(!!ge1 && !!ge2, "kedua pemegang posisi muncul", `${(g.employees ?? []).length} pemegang`);
  const dA1 = ge1?.details?.find((d: any) => d.skillId === skillA!.id);
  const dB1 = ge1?.details?.find((d: any) => d.skillId === skillB!.id);
  ok(dA1?.required === 2 && dA1?.actual === 5 && dA1?.ok === true, "E1 skill A: required 2 actual 5 → ok", JSON.stringify(dA1));
  ok(dB1?.required === 4 && dB1?.actual === 1 && dB1?.ok === false, "E1 skill B: required 4 actual 1 → TIDAK ok", JSON.stringify(dB1));
  ok(ge1?.met === 1 && ge1?.total === 2, "E1 met/total = 1/2", `${ge1?.met}/${ge1?.total}`);
  ok(ge2?.met === 0 && ge2?.total === 2, "E2 met/total = 0/2", `${ge2?.met}/${ge2?.total}`);
  ok(ge2?.details?.every((d: any) => d.actual === null && d.ok === false), "E2 semua actual null (belum dinilai)");
  ok(g.summary?.employees === 2, "summary.employees = 2", JSON.stringify(g.summary));
  ok(g.summary?.allMet === 0, "summary.allMet = 0 (tidak ada yang memenuhi semua)");
  ok(g.summary?.halfOrMore === 1, "summary.halfOrMore = 1 (E1 memenuhi ≥ setengah)", JSON.stringify(g.summary));

  // ================= (5) GUARD HAPUS KATALOG =================
  console.log("\n[(5)] GUARD HAPUS — skill terpakai ditolak → lepas pemakaian → sukses");
  const d1a = await hr.api("DELETE", `${SKILLS_API}?id=${skillA!.id}`);
  ok(d1a.status === 400, "DELETE skill A (dipakai penilaian E1 + posisi) → 400", `HTTP ${d1a.status}`);
  ok(String(d1a.json?.error ?? "").includes("masih dipakai") && String(d1a.json?.error ?? "").includes("still in use"),
    "pesan 400 dwibahasa (ID + EN)", String(d1a.json?.error ?? "").slice(0, 80));
  await db.employeeSkill.deleteMany({ where: { employeeId: e1.id, skillId: skillA!.id } });
  const d1b = await hr.api("DELETE", `${SKILLS_API}?id=${skillA!.id}`);
  ok(d1b.status === 400, "DELETE setelah penilaian dihapus → MASIH 400 (dipakai posisi)", `HTTP ${d1b.status}`);
  const patchLepas = await hr.api("PATCH", POSITIONS_API, { id: pos32!.id, title: "E2E Posisi 32 (rev)", requiredSkills: [{ skillId: skillB!.id, level: 4 }] });
  ok(patchLepas.status === 200, "PATCH posisi melepas skill A dari syarat → 200", `HTTP ${patchLepas.status}`);
  const d1c = await hr.api("DELETE", `${SKILLS_API}?id=${skillA!.id}`);
  ok(d1c.status === 200, "DELETE skill A setelah bebas pemakaian → 200", `HTTP ${d1c.status}`);

  // ================= (6) JEMBATAN PELAMAR → KARYAWAN =================
  console.log("\n[(6)] BRIDGE — ApplicantSkill → EmployeeSkill via label match");
  const recSkillExcel = await db.skill.create({ data: { code: `SKL-REC-E32-${Date.now().toString(36).toUpperCase().slice(-5)}1`, name: "Microsoft Excel" } });
  const recSkillUnmatched = await db.skill.create({ data: { code: `SKL-REC-E32-${Date.now().toString(36).toUpperCase().slice(-5)}2`, name: `Keahlian Tak Ada ${NONCE.slice(-4)}` } });
  const applicant = await db.applicant.create({
    data: { applicantNo: "APP-E2E32-001", firstName: "E2e", lastName: "Pelamar", status: "Active" },
    select: { id: true },
  });
  await db.applicantSkill.createMany({
    data: [
      { applicantId: applicant.id, skillId: recSkillExcel.id, level: "Advanced" },
      { applicantId: applicant.id, skillId: recSkillUnmatched.id, level: "Expert" },
    ],
  });
  const excelCatalog = await db.skillCatalog.findUnique({ where: { code: "SKL-EXCL" }, select: { id: true } });
  ok(!!excelCatalog, "katalog SKL-EXCL 'Microsoft Excel' ter-seed (label match target)");

  const bridge = await importApplicantSkillsToEmployee(db, applicant.id, e1.id);
  ok(bridge.created === 1 && bridge.skippedNoMatch === 1, "impor: 1 cocok + 1 dilewati (tanpa padanan katalog)", JSON.stringify(bridge));
  const imported = await db.employeeSkill.findUnique({
    where: { employeeId_skillId: { employeeId: e1.id, skillId: excelCatalog!.id } },
    select: { level: true, evidence: true },
  });
  ok(imported?.level === 3, "EmployeeSkill dibuat level 3 (default)", String(imported?.level));
  ok(!!imported?.evidence && imported.evidence.startsWith("Diimpor dari rekrutmen — "), "evidence ber-prefix 'Diimpor dari rekrutmen —'", imported?.evidence ?? "—");
  const unmatchedLeft = await db.employeeSkill.count({ where: { employeeId: e1.id, evidence: { contains: "Diimpor dari rekrutmen" }, skillId: { not: excelCatalog!.id } } });
  ok(unmatchedLeft === 0, "keahlian tanpa padanan TIDAK dibuat (tidak ada fabrikasi katalog)");
  const logBridge = await db.activityLog.findFirst({
    where: { entity: "EmployeeSkill", employeeId: e1.id, detail: { contains: "Keahlian pelamar diimpor (1 cocok)" } },
    select: { detail: true },
  });
  ok(!!logBridge, "ActivityLog 'Keahlian pelamar diimpor (1 cocok)' tertulis", logBridge?.detail ?? "—");

  const bridge2 = await importApplicantSkillsToEmployee(db, applicant.id, e1.id);
  ok(bridge2.created === 0, "impor ulang tidak menduplikasi (yang sudah dimiliki di-skip)", JSON.stringify(bridge2));

  // ================= (7) CLEANUP =================
  console.log("\n[(7)] CLEANUP — hapus seluruh fixture (ActivityLog DIPERTAHANKAN — pola B8)");
  const delEmp = await db.employee.deleteMany({ where: { id: { in: [e1.id, e2.id] } } });
  ok(delEmp.count === 2, "karyawan fixture terhapus (cascade assignment + skill)", String(delEmp.count));
  const delPos = await db.position.deleteMany({ where: { id: pos32!.id } });
  ok(delPos.count === 1, "posisi uji terhapus");
  const delCat = await db.skillCatalog.deleteMany({ where: { code: { in: [CODE_A, CODE_B] } } });
  ok(delCat.count === 1, `katalog uji bersih (${CODE_B}; ${CODE_A} sudah dihapus di (5))`, String(delCat.count));
  const delApp = await db.applicant.deleteMany({ where: { applicantNo: "APP-E2E32-001" } });
  ok(delApp.count === 1, "pelamar uji terhapus (cascade ApplicantSkill)");
  const delRec = await db.skill.deleteMany({ where: { id: { in: [recSkillExcel.id, recSkillUnmatched.id] } } });
  ok(delRec.count === 2, "master Skill rekrutmen uji terhapus");

  const after = {
    catalog: await db.skillCatalog.count(),
    employeeSkill: await db.employeeSkill.count(),
    positions: await db.position.count(),
    employees: await db.employee.count(),
    applicants: await db.applicant.count(),
    recSkills: await db.skill.count(),
  };
  ok(
    after.catalog === baseline.catalog && after.employeeSkill === baseline.employeeSkill
      && after.positions === baseline.positions && after.employees === baseline.employees
      && after.applicants === baseline.applicants && after.recSkills === baseline.recSkills,
    "semua hitungan kembali ke pra-uji",
    JSON.stringify({ baseline, after }),
  );

  console.log(`\nE2E P3.2: ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
