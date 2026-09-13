/**
 * Seeder SAYONE via API UI — TIDAK menyentuh DB tenant langsung.
 * Semua data dibuat lewat endpoint UI yang sama dengan form admin,
 * memakai sesi cookie owner puja.asmara@sayone.com.
 *
 * Usage: node scripts/seed-sayone-via-ui.ts [baseUrl] [jumlahKaryawan]
 *   default: https://onevity.sayone.my.id 500
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const N_EMP = Number(process.argv[3] ?? 500);

const EMAIL = "puja.asmara@sayone.com";
const PASSWORD = "Asmaree.007";

// ---- cookie jar minimal (session cookie platform) ----
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
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
      "User-Agent": "Mozilla/5.0 (sayone-seed-ui/1.0)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  if (res.status >= 400) {
    failCount++;
    const msg = `${method} ${path} → HTTP ${res.status}: ${String((json as { error?: string })?.error ?? text.slice(0, 160))}`;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
    return null;
  }
  okCount++;
  return json ?? {};
}

async function post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T | null> {
  return (await api("POST", path, body)) as T | null;
}

// ================= data generator =================
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260913);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const pickInt = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));

const NAMA_DEPAN_L = ["Ahmad", "Budi", "Candra", "Dedi", "Eko", "Fajar", "Gunawan", "Hendra", "Irfan", "Joko", "Kurnia", "Lukman", "Mulyadi", "Nanda", "Oscar", "Putra", "Rizky", "Setiawan", "Taufik", "Wahyu", "Yusuf", "Bagus", "Dimas", "Ferry", "Galih"];
const NAMA_DEPAN_P = ["Ani", "Bunga", "Citra", "Dewi", "Endah", "Fitri", "Gita", "Hana", "Indah", "Juwita", "Kartika", "Lestari", "Maya", "Novi", "Olivia", "Putri", "Ratna", "Sari", "Tania", "Utami", "Vina", "Wulan", "Yanti", "Zahra", "Rina"];
const NAMA_BELAKANG = ["Santoso", "Wijaya", "Kusuma", "Pratama", "Saputra", "Hidayat", "Nugroho", "Wibowo", "Halim", "Siregar", "Nasution", "Simanjuntak", "Sihombing", "Tanuwijaya", "Lie", "Wong", "Sanjaya", "Maulana", "Firmansyah", "Ramadhan", "Susanto", "Gunawan", "Pangestu", "Utomo", "Anggara"];
const AGAMA = ["Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Konghucu"];
const STATUS_KAWIN = ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"];
const GOLDAR = ["A", "B", "AB", "O"];
const KOTA = ["Jakarta Selatan", "Jakarta Pusat", "Jakarta Barat", "Jakarta Utara", "Jakarta Timur", "Tangerang Selatan", "Tangerang", "Bekasi", "Depok", "Bogor", "Bandung", "Surabaya"];
const BANK = ["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "Permata", "Danamon"];
const EMP_STATUS = ["Permanent", "Permanent", "Permanent", "Permanent", "Contract", "Probation", "Outsourcing"];
const PENDIDIKAN = ["SMA", "D3", "S1", "S1", "S1", "S2", "S3"];

function namaKaryawan(i: number): { fullName: string; gender: "M" | "P" } {
  const gender = rnd() < 0.55 ? "M" : "P";
  const depan = gender === "M" ? pick(NAMA_DEPAN_L) : pick(NAMA_DEPAN_P);
  const belakang = pick(NAMA_BELAKANG);
  return { fullName: `${depan} ${belakang} ${String.fromCharCode(65 + (i % 26))}.`, gender };
}
function nik16(): string {
  let s = "31";
  s += String(pickInt(71, 86));
  s += String(pickInt(1, 28)).padStart(2, "0");
  s += String(pickInt(60, 99));
  for (let i = 0; i < 10; i++) s += String(pickInt(0, 9));
  return s.slice(0, 16);
}
function npwp15(): string {
  let s = String(pickInt(10, 99));
  for (let i = 0; i < 13; i++) s += String(pickInt(0, 9));
  return s.slice(0, 15);
}
function tglLahir(): string {
  const y = pickInt(1975, 2003);
  const m = pickInt(1, 12);
  const d = pickInt(1, 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function joinDate(): string {
  const y = pickInt(2019, 2026);
  const m = pickInt(1, 12);
  const d = pickInt(1, 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function rupiahGrade(g: number): number {
  const dasar = 4_500_000 + g * 1_250_000;
  return Math.round((dasar + rnd() * 1_200_000) / 1000) * 1000;
}

// ================= main =================
async function main(): Promise<void> {
  console.log(`Base: ${BASE}  |  karyawan: ${N_EMP}`);

  // 1) LOGIN sebagai owner SAYONE (alur UI sama: /api/auth/login → session cookie)
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (!login || !jar.size) {
    console.error("LOGIN GAGAL — seeder dihentikan.");
    process.exit(1);
  }
  console.log("✓ login owner OK");

  // 2) Lengkapi profil perusahaan (PATCH /companies — sama dgn form Profil Perusahaan)
  await api("PATCH", "/api/onevity/companies", {
    name: "PT Sayone Integrasi Solusi",
    shortName: "Sayone",
    taxId: npwp15(),
    address: `Jl. Jenderal Sudirman Kav. ${pickInt(10, 90)}, SCBD`,
    city: "Jakarta Selatan",
    phone: `021${String(pickInt(50000000, 59999999))}`,
    email: "corporate@sayone.com",
    website: "https://sayone.com",
  });
  console.log("✓ profil perusahaan dilengkapi");

  // 3) Kantor (20) — POST /company-offices
  const officeIds: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const r = await post<{ office: { id: string } }>("/api/onevity/company-offices", {
      code: `OF-${String(i).padStart(2, "0")}`,
      name: i === 1 ? "Kantor Pusat — Jakarta" : `Cabang ${i}`,
      address: `Jl. ${pick(["Gatot Subroto", "Thamrin", "Sudirman", "Asia Afrika", "Pahlawan", "Diponegoro", "Asia Raya"])} No. ${pickInt(1, 120)}`,
      city: KOTA[(i - 1) % KOTA.length],
      phone: `021${String(pickInt(70000000, 79999999))}`,
      npwp: npwp15(),
    });
    if (r?.office?.id) officeIds.push(r.office.id);
  }
  console.log(`✓ kantor: ${officeIds.length}/20`);

  // 4) Work location (30) — POST /work-locations
  const locIds: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const r = await post<{ location: { id: string } }>("/api/onevity/work-locations", {
      code: `WL-${String(i).padStart(2, "0")}`,
      name: i <= 10 ? `Kantor Pusat Lantai ${i}` : `Site Operasional ${i - 10}`,
      officeId: officeIds.length ? officeIds[(i - 1) % officeIds.length] : undefined,
      address: `Kawasan Bisnis Blok ${String.fromCharCode(64 + ((i % 26) + 1))} No. ${pickInt(1, 50)}`,
      city: KOTA[(i * 3) % KOTA.length],
      latitude: -6.2 + rnd() * 0.2,
      longitude: 106.75 + rnd() * 0.15,
      radiusMeters: pick([150, 200, 250, 300, 500]),
    });
    if (r?.location?.id) locIds.push(r.location.id);
  }
  console.log(`✓ lokasi kerja: ${locIds.length}/30`);

  // 5) Org units (30, hierarki 2 level) — POST /org-units
  const orgIds: string[] = [];
  const topOrgs = ["Direksi", "Keuangan & Akuntansi", "Sumber Daya Manusia", "Teknologi Informasi", "Operasional", "Pemasaran", "Penjualan", "Pengadaan", "Legal & Kepatuhan", "Layanan Pelanggan"];
  for (let i = 0; i < topOrgs.length; i++) {
    const r = await post<{ unit: { id: string } }>("/api/onevity/org-units", {
      code: `ORG-${String(i + 1).padStart(2, "0")}`,
      name: topOrgs[i],
      headcountBudget: pickInt(15, 80),
    });
    if (r?.unit?.id) orgIds.push(r.unit.id);
  }
  const subNames = ["Divisi Perencanaan", "Divisi Pelaksanaan", "Divisi Pengendalian", "Tim Administrasi", "Tim Pengembangan", "Tim Dukungan"];
  for (let i = 0; i < 30 - topOrgs.length; i++) {
    const r = await post<{ unit: { id: string } }>("/api/onevity/org-units", {
      code: `ORG-S${String(i + 1).padStart(2, "0")}`,
      name: subNames[i % subNames.length],
      parentId: orgIds.length ? orgIds[(i + 1) % orgIds.length] : undefined,
      headcountBudget: pickInt(5, 30),
    });
    if (r?.unit?.id) orgIds.push(r.unit.id);
  }
  console.log(`✓ unit organisasi: ${orgIds.length}/30`);

  // 6) Jobs (12) + Grades (8) — untuk posisi & rentang gaji
  const jobIds: string[] = [];
  const jobs: [string, string, string][] = [
    ["JOB-IT", "Information Technology", "Staff"], ["JOB-FIN", "Finance & Accounting", "Staff"],
    ["JOB-HR", "Human Resources", "Staff"], ["JOB-OPS", "Operations", "Non-Staff"],
    ["JOB-SLS", "Sales & Marketing", "Staff"], ["JOB-LEG", "Legal", "Staff"],
    ["JOB-GA", "General Affairs", "Non-Staff"], ["JOB-CS", "Customer Service", "Non-Staff"],
    ["JOB-PRC", "Procurement", "Staff"], ["JOB-QA", "Quality Assurance", "Staff"],
    ["JOB-PM", "Project Management", "Staff"], ["JOB-EXE", "Executive", "Executive"],
  ];
  for (const [code, title, category] of jobs) {
    const r = await post<{ job: { id: string } }>("/api/onevity/jobs", { code, title, category, description: `Kelompok kerja ${title}` });
    if (r?.job?.id) jobIds.push(r.job.id);
  }
  const gradeIds: { id: string; g: number }[] = [];
  for (let g = 1; g <= 8; g++) {
    const r = await post<{ grade: { id: string } }>("/api/onevity/grades", {
      code: `G${g}`,
      name: `Grade ${g}`,
      minSalary: rupiahGrade(g - 1),
      maxSalary: rupiahGrade(g - 1) + 2_500_000,
      sortOrder: g,
    });
    if (r?.grade?.id) gradeIds.push({ id: r.grade.id, g });
  }
  console.log(`✓ jobs: ${jobIds.length}/12, grades: ${gradeIds.length}/8`);

  // 7) Posisi (50) — POST /positions
  const posIds: string[] = [];
  const titles = ["Manager", "Supervisor", "Senior Officer", "Officer", "Junior Officer", "Spesialis", "Koordinator", "Analis", "Admin", "Staff", "Asisten", "Teknisi", "Praktisi", "Pelaksana", "Kepala Seksi", "Kepala Divisi", "Direktur Utama", "Direktur", "General Manager", "Sekretaris"];
  for (let i = 1; i <= 50; i++) {
    const g = gradeIds[(i - 1) % gradeIds.length];
    const r = await post<{ position: { id: string } }>("/api/onevity/positions", {
      code: `POS-${String(i).padStart(2, "0")}`,
      title: `${titles[(i - 1) % titles.length]} ${pick(["Operasional", "Keuangan", "SDM", "IT", "Pemasaran", "Penjualan", "Logistik", "Kepatuhan", "Layanan", "Pengadaan"])}`,
      jobId: jobIds.length ? jobIds[(i - 1) % jobIds.length] : undefined,
      orgUnitId: orgIds.length ? orgIds[(i - 1) % orgIds.length] : undefined,
      gradeId: g?.id,
      headcount: pickInt(1, 20),
    });
    if (r?.position?.id) posIds.push(r.position.id);
  }
  console.log(`✓ posisi: ${posIds.length}/50`);

  // 8) Karyawan (500) — POST /employees (alur wizard Onboarding)
  const empIds: string[] = [];
  const usedEmail = new Set<string>();
  for (let i = 1; i <= N_EMP; i++) {
    const { fullName, gender } = namaKaryawan(i);
    const g = gradeIds[(i - 1) % gradeIds.length];
    let email = `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}${i}@sayone.com`;
    while (usedEmail.has(email)) email = `emp${i}.${email}`;
    usedEmail.add(email);
    const employmentStatus = pick(EMP_STATUS);
    const jd = joinDate();
    const r = await post<{ employee: { id: string } }>("/api/onevity/employees", {
      fullName,
      gender,
      birthPlace: pick(KOTA),
      birthDate: tglLahir(),
      nationalId: nik16(),
      taxId: npwp15(),
      maritalStatus: pick(STATUS_KAWIN),
      religion: pick(AGAMA),
      bloodType: pick(GOLDAR),
      email,
      phone: `08${pickInt(11, 99)}${String(pickInt(1000000, 9999999))}`,
      address: `Jl. ${pick(["Melati", "Mawar", "Anggrek", "Kenanga", "Cempaka", "Flamboyan", "Merdeka", "Pahlawan"])} No. ${pickInt(1, 150)} RT ${pickInt(1, 15)}/RW ${pickInt(1, 9)}`,
      city: pick(KOTA),
      bankName: pick(BANK),
      bankAccount: String(pickInt(1000000000, 9999999999)) + String(pickInt(0, 9)),
      companyId: undefined,
      joinDate: jd,
      status: "Active",
      employmentStatus,
      workShift: pick(["Regular", "Regular", "Regular", "Shift 1", "Shift 2", "Shift 3"]),
      orgUnitId: orgIds.length ? orgIds[i % orgIds.length] : undefined,
      positionId: posIds.length ? posIds[i % posIds.length] : undefined,
      gradeId: g?.id,
      companyOfficeId: officeIds.length ? officeIds[i % officeIds.length] : undefined,
      workLocationId: locIds.length ? locIds[i % locIds.length] : undefined,
      baseSalary: rupiahGrade(g ? g.g - 1 : 0),
      ...(employmentStatus !== "Permanent" ? { contractStart: jd, contractEnd: `${Number(jd.slice(0, 4)) + 2}${jd.slice(4)}`, renewalCount: pickInt(0, 2) } : {}),
    });
    if (r?.employee?.id) empIds.push(r.employee.id);
    if (i % 50 === 0) console.log(`  … karyawan ${i}/${N_EMP} (ok total ${okCount})`);
  }
  console.log(`✓ karyawan: ${empIds.length}/${N_EMP}`);

  // 9) Ringkasan
  console.log("\n================ RINGKASAN ================");
  console.log(`OK: ${okCount} permintaan | GAGAL: ${failCount}`);
  if (failures.length) {
    console.log("Detail kegagalan (maks 20):");
    for (const f of failures.slice(0, 20)) console.log(`  - ${f}`);
  }
  console.log(`Endpoint unik yang gagal: ${new Set(failures.map((f) => f.split(" ")[1])).size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
