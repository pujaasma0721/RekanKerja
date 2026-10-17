// P2.1-BM (D-BM16) — E2E File LKS BPJS resmi (DEVELOPMENT-PLAN-BENCHMARK.md
// §4 fase P2.1) di atas data demo MII (login owner hrd@mii.co.id):
//   (1) KONFIGURASI TENANT (KODE KANTOR + KELAS):
//     a. PATCH tax-parameters bpjsOfficeCode="Y01234" + bpjsInpatientClass="2"
//        → 200 + GET verifikasi kedua field tersimpan.
//     b. Validasi: kelas "4" → 400; kode kantor 11 karakter → 400.
//   (2) FIXTURE: run Paid/Confirmed MII → pilih karyawan Aktif ber-bpjsHealth
//     TANPA keluarga existing → POST /api/rekankerja/family 2 keluarga
//     dependen: Spouse (M, NIK 16 digit) + Child (TANPA NIK).
//   (3) ?format=lks-tk → CSV (;) header 10 kolom; KODE KANTOR == "Y01234" di
//     semua baris karyawan; ?format=tk (legacy) identik perilaku.
//   (4) ?format=lks-jkn → baris Pegawai fixture karyawan (KELAS=="2",
//     UPAH>0 — vault terbuka) + baris Suami (NIK fixture, kolom kosong);
//     baris Child TANPA NIK TIDAK ada; ?format=jkn (legacy) jalan.
//   (5) ?export=xlsx (run fixture) → buffer XLSX valid (dibaca exceljs) +
//     sheet "Gap NIK Keluarga" memuat Child + alasan "NIK belum diisi";
//     JSON preview meta: familyRows≥1, familySkipped≥1, gaps memuat Child.
//   (6) CLEANUP: hapus 2 keluarga uji (API DELETE), restore config
//     (null/null) + verifikasi GET, verifikasi ActivityLog entri export
//     (LKS BPJS) & config (PayrollRegulation) tercatat.
// Jalankan: bun scripts/e2e-p21-lks.ts  (dev server di :3000)
import "./lib/env";
import * as ExcelJS from "exceljs";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const VAULT_PW = "asmaree.007";
const SCHEMA = "tenant_pt_mitra_industri_internasional";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, detail?: string): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); }
}

const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  const list: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
/** fetch + retry ringan (dev server bisa restart saat lintas proses). */
async function fetchRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any; text: string; res: Response }> {
  const res = await fetchRetry(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init?.headers ?? {}) },
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body, text, res };
}
const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) });
const patch = (path: string, data: unknown) => api(path, { method: "PATCH", body: JSON.stringify(data) });
const get = (path: string) => api(path);
const del = (path: string) => api(path, { method: "DELETE" });

async function login(email: string, password: string): Promise<void> {
  jar.clear();
  const r = await post("/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login ${email} ${r.status}: ${r.text.slice(0, 200)}`);
}

function parseCsvSemi(text: string): string[][] {
  // CSV sederhana pemisah ';' dengan quote ganda sederhana (cukup utk file ini).
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ";" && !inQ) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const db = await getTenantClient(SCHEMA);
  const stamp = `${Date.now().toString().slice(-6)}`;
  const SPOUSE_NIK = `327301${String(Date.now()).slice(-10)}`; // 6+10 = 16 digit
  const SPOUSE_NAME = `E2E P21 Suami ${stamp}`;
  const CHILD_NAME = `E2E P21 Anak ${stamp}`;

  // ================= LOGIN =================
  await login(EMAIL, PASSWORD);
  const vault = await post("/api/rekankerja/money-vault", { action: "unlock", password: VAULT_PW });
  ok(vault.status === 200 || vault.status === 409, "login owner + vault terbuka (200/409 sudah-terbuka)", `vault=${vault.status}`);

  // ================= (1) KONFIGURASI TENANT =================
  console.log("\n[(1)] PATCH KODE KANTOR + KELAS (D-BM16)");
  const bad1 = await patch("/api/rekankerja/tax-parameters", { bpjsInpatientClass: "4" });
  ok(bad1.status === 400, "kelas \"4\" ditolak 400", `status=${bad1.status}`);
  const bad2 = await patch("/api/rekankerja/tax-parameters", { bpjsOfficeCode: "ABCDEFGHIJK" });
  ok(bad2.status === 400, "kode kantor 11 karakter ditolak 400", `status=${bad2.status}`);
  const cfg0 = await get("/api/rekankerja/tax-parameters");
  ok(cfg0.status === 200 && !!cfg0.body?.regulation, "GET tax-parameters 200 (regulasi aktif)", cfg0.body?.regulation?.code);
  ok(cfg0.body?.regulation?.bpjsOfficeCode == null && cfg0.body?.regulation?.bpjsInpatientClass == null, "pra-uji: KODE KANTOR & KELAS masih null (baseline)", `office=${cfg0.body?.regulation?.bpjsOfficeCode ?? "null"} kelas=${cfg0.body?.regulation?.bpjsInpatientClass ?? "null"}`);

  const setCfg = await patch("/api/rekankerja/tax-parameters", { bpjsOfficeCode: "  Y01234  ", bpjsInpatientClass: "2" });
  ok(setCfg.status === 200, "PATCH konfigurasi LKS 200", `status=${setCfg.status} ${setCfg.text.slice(0, 90)}`);
  const cfg1 = await get("/api/rekankerja/tax-parameters");
  ok(cfg1.body?.regulation?.bpjsOfficeCode === "Y01234", "GET verifikasi KODE KANTOR tersimpan + trim", `got=${cfg1.body?.regulation?.bpjsOfficeCode}`);
  ok(cfg1.body?.regulation?.bpjsInpatientClass === "2", "GET verifikasi KELAS tersimpan", `got=${cfg1.body?.regulation?.bpjsInpatientClass}`);

  // ================= (2) FIXTURE KELUARGA =================
  console.log("\n[(2)] Fixture karyawan + keluarga dependen");
  const run = await db.payrollRun.findFirst({
    where: { status: { in: ["Confirmed", "Paid"] } },
    orderBy: { createdAt: "desc" },
    include: {
      lines: {
        orderBy: { employeeNo: "asc" },
        where: { employee: { bpjsHealth: { not: null }, status: "Active" } },
        select: { employeeNo: true, employeeName: true, employeeId: true },
      },
    },
  });
  ok(!!run && run.lines.length > 0, "run Confirmed/Paid dengan peserta JKN aktif ditemukan", run ? `${run.runNo} (${run.lines.length} peserta)` : "—");
  if (!run || run.lines.length === 0) throw new Error("tidak ada run fixture — seed demo tidak siap");

  // pilih peserta TANPA keluarga existing agar asersi gap bersih
  let pick: { employeeNo: string; employeeName: string; employeeId: string } | null = null;
  for (const l of run.lines) {
    const famCount = await db.employeeFamily.count({ where: { employeeId: l.employeeId } });
    if (famCount === 0) { pick = l; break; }
  }
  if (!pick) pick = run.lines[0]!;
  ok(!!pick, "karyawan fixture dipilih (aktif + bpjsHealth)", `${pick.employeeNo} — ${pick.employeeName}`);
  // nama CURRENT employee (file LKS master-scope memakai data employee, bukan snapshot run)
  const pickEmp = await db.employee.findUnique({ where: { id: pick.employeeId }, select: { fullName: true } });
  const pickName = (pickEmp?.fullName ?? pick.employeeName).toUpperCase();

  const mkSpouse = await post("/api/rekankerja/family", {
    employeeId: pick.employeeId, relation: "Spouse", name: SPOUSE_NAME, gender: "M",
    birthDate: "1990-05-17", isDependent: true, nationalId: SPOUSE_NIK,
  });
  ok(mkSpouse.status === 201, "POST family Spouse ber-NIK 201", `status=${mkSpouse.status} ${mkSpouse.text.slice(0, 80)}`);
  const mkChild = await post("/api/rekankerja/family", {
    employeeId: pick.employeeId, relation: "Child", name: CHILD_NAME, gender: "F",
    birthDate: "2018-09-02", isDependent: true,
  });
  ok(mkChild.status === 201, "POST family Child TANPA NIK 201", `status=${mkChild.status}`);
  const spouseId = mkSpouse.body?.family?.id ?? "";
  const childId = mkChild.body?.family?.id ?? "";
  ok(!!spouseId && !!childId, "id kedua keluarga uji didapat", `spouse=${spouseId.slice(-6)} child=${childId.slice(-6)}`);
  if (!spouseId || !childId) throw new Error("fixture keluarga gagal dibuat");

  // ================= (3) LKS TK =================
  console.log("\n[(3)] ?format=lks-tk — KODE KANTOR dari konfigurasi");
  const tk = await get("/api/rekankerja/payroll-reports/bpjs?format=lks-tk");
  ok(tk.status === 200 && typeof tk.text === "string" && tk.text.length > 50, "GET format=lks-tk 200 CSV", `${tk.text.split(/\r?\n/).length} baris`);
  const tkRows = parseCsvSemi(tk.text);
  ok(tkRows[0]?.length === 10, "header 10 kolom", `${tkRows[0]?.length} kolom: ${tkRows[0]?.join("|")}`);
  ok(tkRows[0]?.[5] === "KODE KANTOR", "kolom ke-6 = KODE KANTOR", tkRows[0]?.[5]);
  const tkData = tkRows.slice(1);
  ok(tkData.length >= 1, "ada baris karyawan (populasi aktif ber-No. BPJS TK)", `${tkData.length} baris`);
  ok(tkData.every((r) => r[5] === "Y01234"), "KODE KANTOR == Y01234 di SEMUA baris", `match=${tkData.filter((r) => r[5] === "Y01234").length}/${tkData.length}`);
  const tkLegacy = await get("/api/rekankerja/payroll-reports/bpjs?format=tk");
  const tkLegacyRows = parseCsvSemi(tkLegacy.text);
  ok(tkLegacy.status === 200 && tkLegacyRows.slice(1).every((r) => r[5] === "Y01234"), "?format=tk (legacy) perilaku sama", `status=${tkLegacy.status}`);

  // ================= (4) LKS JKN + KELOMPOK KELUARGA =================
  console.log("\n[(4)] ?format=lks-jkn — baris Pegawai + baris keluarga");
  const jkn = await get("/api/rekankerja/payroll-reports/bpjs?format=lks-jkn");
  ok(jkn.status === 200 && typeof jkn.text === "string" && jkn.text.length > 50, "GET format=lks-jkn 200 CSV", `${jkn.text.split(/\r?\n/).length} baris`);
  const jknRows = parseCsvSemi(jkn.text);
  ok(jknRows[0]?.length === 12, "header 12 kolom (pola Data Peserta e-Dabu)", `${jknRows[0]?.length} kolom`);
  const jknData = jknRows.slice(1);
  // kolom: NO|NIK|NO KARTU|NAMA|TGL LAHIR|JK|HUBKEL|ALAMAT|STATUS|JABATAN|UPAH|KELAS
  const empRow = jknData.find((r) => r[3] === pickName && r[6] === "Pegawai");
  ok(!!empRow, `baris Pegawai karyawan fixture (${pick.employeeNo}) ada`, empRow?.[3]);
  ok(empRow?.[11] === "2", "KELAS PERAWATAN baris Pegawai == 2 (dari konfigurasi)", `got=${empRow?.[11]}`);
  ok(empRow != null && Number(empRow[10]) > 0, "UPAH baris Pegawai > 0 (vault terbuka)", `upah=${empRow?.[10]}`);
  const famRow = jknData.find((r) => r[1] === SPOUSE_NIK);
  ok(!!famRow, "baris keluarga Suami (NIK fixture) ada");
  ok(famRow?.[6] === "Suami", "HUBUNGAN KELUARGA == Suami (Spouse gender M)", `got=${famRow?.[6]}`);
  ok(famRow?.[3] === SPOUSE_NAME.toUpperCase(), "NAMA keluarga terisi", `got=${famRow?.[3]}`);
  ok(famRow?.[4] === "17051990", "TANGGAL LAHIR keluarga DDMMYYYY", `got=${famRow?.[4]}`);
  ok(famRow?.[5] === "L", "JENIS KELAMIN keluarga L", `got=${famRow?.[5]}`);
  ok(famRow?.[11] === "2", "KELAS baris keluarga mengikuti konfigurasi", `got=${famRow?.[11]}`);
  ok(famRow != null && famRow[2] === "" && famRow[7] === "" && famRow[8] === "" && famRow[9] === "" && famRow[10] === "", "kolom kosong baris keluarga (NO KARTU/ALAMAT/STATUS/JABATAN/UPAH)", `kartu="${famRow?.[2]}" upah="${famRow?.[10]}"`);
  const childRow = jknData.find((r) => r[3] === CHILD_NAME.toUpperCase());
  ok(childRow === undefined, "baris Child TANPA NIK DILEWATI (tidak ada di file)", childRow ? `ditemukan: ${childRow.join("|")}` : "tidak ditemukan ✓");
  const jknLegacy = await get("/api/rekankerja/payroll-reports/bpjs?format=jkn");
  ok(jknLegacy.status === 200 && parseCsvSemi(jknLegacy.text)[0]?.length === 12, "?format=jkn (legacy) perilaku sama", `status=${jknLegacy.status}`);

  // ================= (5) XLSX REKAP + META GAPS =================
  console.log("\n[(5)] ?export=xlsx + meta JSON preview (laporan gap)");
  const preview = await get(`/api/rekankerja/payroll-reports/bpjs?runId=${run.id}`);
  ok(preview.status === 200 && Array.isArray(preview.body?.rows), "preview JSON run 200", `status=${preview.status}`);
  const meta = preview.body?.meta ?? {};
  ok(meta.familyRows >= 1, "meta.familyRows >= 1 (baris keluarga ikut LKS)", `got=${meta.familyRows}`);
  ok(meta.familySkipped >= 1, "meta.familySkipped >= 1 (keluarga tanpa NIK)", `got=${meta.familySkipped}`);
  const metaGapChild = (meta.gaps ?? []).find((g: any) => g.familyName === CHILD_NAME);
  ok(!!metaGapChild, "meta.gaps memuat keluarga Child", JSON.stringify(metaGapChild ?? null).slice(0, 120));
  ok(metaGapChild?.reason === "NIK belum diisi" && metaGapChild?.employeeNo === pick.employeeNo, "entri gap lengkap (employeeNo + reason)", `${metaGapChild?.employeeNo} — ${metaGapChild?.reason}`);
  const metaGapSpouse = (meta.gaps ?? []).find((g: any) => g.familyName === SPOUSE_NAME);
  ok(metaGapSpouse === undefined, "meta.gaps TIDAK memuat Spouse ber-NIK", "benar ✓");

  const xlsxRes = await fetchRetry(`${BASE}/api/rekankerja/payroll-reports/bpjs?runId=${run.id}&export=xlsx`, {
    headers: { cookie: cookieHeader() },
    redirect: "manual",
  });
  storeCookies(xlsxRes);
  ok(xlsxRes.status === 200, "GET export=xlsx 200", `status=${xlsxRes.status}`);
  ok((xlsxRes.headers.get("content-type") ?? "").includes("spreadsheet"), "Content-Type XLSX", xlsxRes.headers.get("content-type") ?? "");
  const buf = Buffer.from(await xlsxRes.arrayBuffer());
  let gapSheet: ExcelJS.Worksheet | undefined;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const names = wb.worksheets.map((w) => w.name);
    ok(names.includes("Rekap BPJS"), "sheet Rekap BPJS ada", names.join(", "));
    gapSheet = wb.getWorksheet("Gap NIK Keluarga");
    ok(!!gapSheet, "sheet \"Gap NIK Keluarga\" ada (hanya bila ada gap)", names.join(", "));
  } catch (e) {
    ok(false, "buffer XLSX valid dibaca exceljs", String((e as Error)?.message ?? e).slice(0, 90));
  }
  if (gapSheet) {
    const rowsData: string[][] = [];
    gapSheet.eachRow((row) => {
      const vals = Array.isArray(row.values) ? (row.values as unknown[]) : [];
      rowsData.push(vals.slice(1).map((v) => (v == null ? "" : String(v))));
    });
    const gapRow = rowsData.find((r) => r[2] === CHILD_NAME);
    ok(!!gapRow, "sheet gap memuat baris Child", gapRow?.join(" | ") ?? "—");
    ok(gapRow?.[0] === pick.employeeNo && gapRow?.[3] === "Child" && gapRow?.[4] === "NIK belum diisi", "kolom gap lengkap (No. Karyawan/Hubungan/Alasan)", `${gapRow?.[0]} | ${gapRow?.[3]} | ${gapRow?.[4]}`);
  }

  // ================= (6) CLEANUP + ACTIVITYLOG =================
  console.log("\n[(6)] Cleanup + verifikasi ActivityLog");
  const d1 = await del(`/api/rekankerja/family?id=${spouseId}`);
  const d2 = await del(`/api/rekankerja/family?id=${childId}`);
  ok(d1.status === 200 && d2.status === 200, "2 keluarga uji dihapus via API", `spouse=${d1.status} child=${d2.status}`);
  const restore = await patch("/api/rekankerja/tax-parameters", { bpjsOfficeCode: null, bpjsInpatientClass: null });
  ok(restore.status === 200, "restore konfigurasi (null/null) 200", `status=${restore.status}`);
  const cfg2 = await get("/api/rekankerja/tax-parameters");
  ok(cfg2.body?.regulation?.bpjsOfficeCode == null && cfg2.body?.regulation?.bpjsInpatientClass == null, "GET verifikasi konfigurasi kembali null", `office=${cfg2.body?.regulation?.bpjsOfficeCode ?? "null"} kelas=${cfg2.body?.regulation?.bpjsInpatientClass ?? "null"}`);

  const cfgLogs = await db.activityLog.count({
    where: { entity: "PayrollRegulation", createdAt: { gte: startedAt } },
  });
  ok(cfgLogs >= 2, "ActivityLog konfigurasi (PATCH set + restore) tercatat", `${cfgLogs} baris`);
  const lksLogs = await db.activityLog.count({
    where: { entity: "PayrollRun", createdAt: { gte: startedAt }, detail: { contains: "LKS BPJS" } },
  });
  ok(lksLogs >= 4, "ActivityLog ekspor LKS (lks-tk/tk/lks-jkn/jkn + xlsx) tercatat", `${lksLogs} baris`);
  const famLeft = await db.employeeFamily.count({ where: { id: { in: [spouseId, childId] } } });
  ok(famLeft === 0, "database bersih dari keluarga uji", `${famLeft} sisa`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
