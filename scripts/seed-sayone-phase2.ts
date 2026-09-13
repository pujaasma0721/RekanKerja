/**
 * Fase 2 seeder SAYONE via API UI — melengkapi fase 1:
 *  • 20 sub-unit organisasi (bug parentId sudah diperbaiki di server)
 *  • sisa karyawan hingga total 500 (gaji DI DALAM rentang grade aktual)
 *  • keluarga + pendidikan + pengalaman untuk SEMUA karyawan
 *
 * Usage: node scripts/seed-sayone-phase2.ts [baseUrl] [targetTotalKaryawan]
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const TARGET_EMP = Number(process.argv[3] ?? 500);

const EMAIL = "puja.asmara@sayone.com";
const PASSWORD = "Asmaree.007";

const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  const list: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [nv] = c.split(";");
    const eq = nv.indexOf("=");
    if (eq > 0) jar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1).trim());
  }
}
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

let okCount = 0;
let failCount = 0;
const failures: string[] = [];

async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { json = { _raw: text.slice(0, 160) }; }
  if (res.status >= 400) {
    failCount++;
    const msg = `${method} ${path} → HTTP ${res.status}: ${String((json as { error?: string })?.error ?? text.slice(0, 120)).slice(0, 140)}`;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
    return null;
  }
  okCount++;
  return json ?? {};
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260914);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const pickInt = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));

const NAMA_DEPAN_L = ["Ahmad", "Budi", "Candra", "Dedi", "Eko", "Fajar", "Gunawan", "Hendra", "Irfan", "Joko", "Kurnia", "Lukman", "Mulyadi", "Nanda", "Oscar", "Putra", "Rizky", "Setiawan", "Taufik", "Wahyu", "Yusuf", "Bagus", "Dimas", "Ferry", "Galih"];
const NAMA_DEPAN_P = ["Ani", "Bunga", "Citra", "Dewi", "Endah", "Fitri", "Gita", "Hana", "Indah", "Juwita", "Kartika", "Lestari", "Maya", "Novi", "Olivia", "Putri", "Ratna", "Sari", "Tania", "Utami", "Vina", "Wulan", "Yanti", "Zahra", "Rina"];
const NAMA_BELAKANG = ["Santoso", "Wijaya", "Kusuma", "Pratama", "Saputra", "Hidayat", "Nugroho", "Wibowo", "Halim", "Siregar", "Nasution", "Simanjuntak", "Sihombing", "Tanuwijaya", "Lie", "Wong", "Sanjaya", "Maulana", "Firmansyah", "Ramadhan", "Susanto", "Gunawan", "Pangestu", "Utomo", "Anggara"];
const RELATION = ["Spouse", "Child", "Parent", "Sibling"];
const PENDIDIKAN = ["SMA", "D3", "S1", "S1", "S1", "S2", "S3"];
const KOTA = ["Jakarta Selatan", "Jakarta Pusat", "Jakarta Barat", "Tangerang Selatan", "Bekasi", "Depok", "Bandung", "Surabaya"];
const EMP_STATUS = ["Permanent", "Permanent", "Permanent", "Permanent", "Contract", "Probation", "Outsourcing"];
const AGAMA = ["Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Konghucu"];
const STATUS_KAWIN = ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"];
const GOLDAR = ["A", "B", "AB", "O"];
const BANK = ["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "Permata", "Danamon"];
const UNIV = ["Universitas Indonesia", "ITB", "UGM", "Universitas Airlangga", "Universitas Brawijaya", "Politeknik Negeri Jakarta", "Universitas Trisakti", "Universitas Mercu Buana", "IPB University", "Universitas Padjadjaran"];
const SMA = ["SMA Negeri 1", "SMA Negeri 3", "SMA Negeri 8", "SMA Katolik St. Ursula", "SMK Negeri 1", "SMA Negeri 24"];
const MAJOR = ["Teknik Informatika", "Akuntansi", "Manajemen", "Teknik Sipil", "Psikologi", "Hukum", "Statistika", "Ilmu Komunikasi", "Teknik Industri"];
const EXPCO = ["PT Astra International", "PT Telkom Indonesia", "PT Unilever Indonesia", "PT Bank Central Asia", "PT Indofood Sukses Makmur", "PT Garuda Indonesia", "PT Pertamina", "PT Wijaya Karya", "PT Sinar Mas", "PT Dian Swastatika"];

function nik16(): string {
  let s = `31${pickInt(71, 86)}${String(pickInt(1, 28)).padStart(2, "0")}${pickInt(60, 99)}`;
  for (let i = 0; i < 10; i++) s += String(pickInt(0, 9));
  return s.slice(0, 16);
}
function npwp15(): string {
  let s = String(pickInt(10, 99));
  for (let i = 0; i < 13; i++) s += String(pickInt(0, 9));
  return s.slice(0, 15);
}
function tgl(yMin: number, yMax: number): string {
  return `${pickInt(yMin, yMax)}-${String(pickInt(1, 12)).padStart(2, "0")}-${String(pickInt(1, 28)).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  console.log(`Fase 2 — Base: ${BASE} | target karyawan: ${TARGET_EMP}`);
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login || !jar.size) { console.error("LOGIN GAGAL"); process.exit(1); }
  console.log("✓ login owner OK");

  // ===== 1) Sub-unit organisasi (20) — pakai parentId yang kini sudah berfungsi
  const orgRes = (await api("GET", "/api/onevity/org-units")) as { units?: { id: string; code: string; name: string }[] } | null;
  const units = orgRes?.units ?? [];
  const existingCodes = new Set(units.map((u) => u.code));
  const parents = units.filter((u) => !u.code.startsWith("ORG-S"));
  let createdSub = 0;
  for (let i = 1; i <= 20; i++) {
    const code = `ORG-S${String(i).padStart(2, "0")}`;
    if (existingCodes.has(code)) continue;
    const parent = parents[(i - 1) % parents.length];
    const r = await api("POST", "/api/onevity/org-units", {
      code, name: `Divisi ${pick(["Perencanaan", "Pelaksanaan", "Pengendalian", "Administrasi", "Pengembangan", "Dukungan", "Kemitraan", "Inovasi"])} ${i}`,
      parentId: parent?.id,
      headcountBudget: pickInt(5, 30),
    });
    if (r) createdSub++;
  }
  console.log(`✓ sub-unit organisasi baru: ${createdSub} (total org sekarang: ${units.length + createdSub})`);

  // ===== 2) Rentang gaji aktual dari grade
  const gradeRes = (await api("GET", "/api/onevity/grades")) as { grades?: { id: string; code: string; minSalary: number; maxSalary: number }[] } | null;
  const grades = gradeRes?.grades ?? [];
  if (!grades.length) { console.error("Tidak ada grade — hentikan."); process.exit(1); }

  // ===== 3) Lengkapi karyawan hingga 500
  const listRes = (await api("GET", "/api/onevity/employees?limit=1")) as { total?: number } | null;
  const currentTotal = listRes?.total ?? 0;
  const remaining = Math.max(0, TARGET_EMP - currentTotal);
  console.log(`Karyawan saat ini: ${currentTotal} — akan menambah: ${remaining}`);

  const orgAll = ((await api("GET", "/api/onevity/org-units")) as { units?: { id: string }[] } | null)?.units ?? [];
  const locRes = (await api("GET", "/api/onevity/work-locations")) as { locations?: { id: string }[] } | null;
  const locIds = (locRes?.locations ?? []).map((l) => l.id);
  const offRes = (await api("GET", "/api/onevity/company-offices")) as { offices?: { id: string }[] } | null;
  const offIds = (offRes?.offices ?? []).map((o) => o.id);
  const posRes = (await api("GET", "/api/onevity/positions")) as { positions?: { id: string }[] } | null;
  const posIds = (posRes?.positions ?? []).map((p) => p.id);

  const usedEmail = new Set<string>();
  for (let i = 1; i <= remaining; i++) {
    const idx = currentTotal + i;
    const gender = rnd() < 0.55 ? "M" : "P";
    const fullName = `${gender === "M" ? pick(NAMA_DEPAN_L) : pick(NAMA_DEPAN_P)} ${pick(NAMA_BELAKANG)} ${String.fromCharCode(65 + (idx % 26))}.`;
    const g = grades[idx % grades.length];
    const salary = Math.round((g.minSalary + rnd() * Math.max(0, g.maxSalary - g.minSalary)) / 1000) * 1000;
    const employmentStatus = pick(EMP_STATUS);
    const jd = tgl(2019, 2026);
    let email = `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}${idx}@sayone.com`;
    while (usedEmail.has(email)) email = `emp${idx}.${email}`;
    usedEmail.add(email);
    await api("POST", "/api/onevity/employees", {
      fullName, gender,
      birthPlace: pick(KOTA), birthDate: tgl(1975, 2003),
      nationalId: nik16(), taxId: npwp15(),
      maritalStatus: pick(STATUS_KAWIN), religion: pick(AGAMA), bloodType: pick(GOLDAR),
      email, phone: `08${pickInt(11, 99)}${String(pickInt(1000000, 9999999))}`,
      address: `Jl. ${pick(["Melati", "Mawar", "Anggrek", "Kenanga", "Cempaka"])} No. ${pickInt(1, 150)}`,
      city: pick(KOTA), bankName: pick(BANK),
      bankAccount: String(pickInt(1000000000, 9999999999)) + String(pickInt(0, 9)),
      joinDate: jd, employmentStatus,
      workShift: pick(["Regular", "Regular", "Regular", "Shift 1", "Shift 2", "Shift 3"]),
      orgUnitId: orgAll[idx % orgAll.length]?.id,
      positionId: posIds[idx % posIds.length],
      gradeId: g.id,
      companyOfficeId: offIds[idx % offIds.length],
      workLocationId: locIds[idx % locIds.length],
      baseSalary: salary,
      ...(employmentStatus !== "Permanent" ? { contractStart: jd, contractEnd: `${Number(jd.slice(0, 4)) + 2}${jd.slice(4)}`, renewalCount: pickInt(0, 2) } : {}),
    });
    if (i % 50 === 0) console.log(`  … karyawan baru ${i}/${remaining}`);
  }
  console.log(`✓ karyawan baru: ${remaining} (target total ${TARGET_EMP})`);

  // ===== 4) Keluarga + pendidikan + pengalaman untuk SEMUA karyawan
  const allEmps: { id: string }[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = (await api("GET", `/api/onevity/employees?limit=200&offset=${offset}`)) as { employees?: { id: string }[] } | null;
    const rows = page?.employees ?? [];
    allEmps.push(...rows);
    if (rows.length < 200) break;
  }
  console.log(`Menyiapkan detail keluarga/pendidikan/pengalaman untuk ${allEmps.length} karyawan…`);

  const detail = (empId: string) => {
    const jobs: Promise<unknown>[] = [];
    // keluarga: 1–3 anggota
    const famCount = pickInt(1, 3);
    for (let f = 0; f < famCount; f++) {
      const relation = pick(RELATION);
      const g = rnd() < 0.5 ? "M" : "P";
      jobs.push(api("POST", "/api/onevity/family", {
        employeeId: empId, relation,
        name: `${g === "M" ? pick(NAMA_DEPAN_L) : pick(NAMA_DEPAN_P)} ${pick(NAMA_BELAKANG)}`,
        gender: g, birthDate: tgl(1950, 2015),
        occupation: pick(["Ibu Rumah Tangga", "Karyawan Swasta", "Pensiunan", "Wiraswasta", "Pelajar", "Mahasiswa", "PNS"]),
        isDependent: relation === "Spouse" || relation === "Child",
      }));
    }
    // pendidikan: 1–2 riwayat
    const eduCount = pickInt(1, 2);
    for (let e = 0; e < eduCount; e++) {
      const level = e === 0 ? pick(PENDIDIKAN) : pick(["S1", "S2"]);
      const isHigher = level.startsWith("S") && level !== "SMA";
      jobs.push(api("POST", "/api/onevity/education", {
        employeeId: empId, level,
        institution: isHigher ? pick(UNIV) : `${pick(SMA)} ${pick(KOTA)}`,
        major: isHigher ? pick(MAJOR) : pick(["IPA", "IPS", "TKJ", "Akuntansi"]),
        startYear: pickInt(2000, 2018), endYear: pickInt(2019, 2025),
        gpa: isHigher ? Number((2.8 + rnd() * 1.2).toFixed(2)) : null,
      }));
    }
    // pengalaman: 0–2
    const expCount = pickInt(0, 2);
    for (let x = 0; x < expCount; x++) {
      const sy = pickInt(2010, 2021);
      jobs.push(api("POST", "/api/onevity/experiences", {
        employeeId: empId, company: pick(EXPCO),
        position: pick(["Staff", "Supervisor", "Officer", "Analis", "Koordinator"]),
        startDate: `${sy}-01-15`, endDate: `${sy + pickInt(1, 3)}-12-20`,
        notes: `Bekerja ${pickInt(1, 4)} tahun`,
      }));
    }
    return jobs;
  };

  const CONC = 5;
  let done = 0;
  for (let i = 0; i < allEmps.length; i += CONC) {
    const batch = allEmps.slice(i, i + CONC);
    const jobs = batch.flatMap((e) => detail(e.id));
    await Promise.all(jobs);
    done += batch.length;
    if (done % 100 < CONC) console.log(`  … detail karyawan ${done}/${allEmps.length} (ok ${okCount}, gagal ${failCount})`);
  }

  console.log("\n================ RINGKASAN FASE 2 ================");
  console.log(`OK: ${okCount} | GAGAL: ${failCount}`);
  if (failures.length) {
    console.log("Detail kegagalan (maks 15):");
    for (const f of failures.slice(0, 15)) console.log(`  - ${f}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
