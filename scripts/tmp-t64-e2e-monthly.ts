// Task 64 E2E — verifikasi laporan bulanan payroll (XLSX) end-to-end:
// login owner MII (local dev) → pilih run Confirmed/Paid → GET monthly?export=xlsx
// → baca workbook dgn exceljs → assert 5 sheet + isi + konsistensi total.
import * as ExcelJS from "exceljs";

const BASE = "http://localhost:3000";
let cookie = "";
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

// 1) login
const login = await api("POST", "/api/auth/login", { email: "hrd@mii.co.id", password: "onevity123" });
const ljson = await login.json().catch(() => ({}));
ok("login owner MII", login.status === 200, `status=${login.status}`);
if (login.status !== 200) {
  console.error(JSON.stringify(ljson));
  process.exit(1);
}
// multi-workspace? pilih MII bila perlu
if (!ljson?.tenant && Array.isArray(ljson?.workspaces) && ljson.workspaces.length > 1) {
  const mii = ljson.workspaces.find((w: { slug?: string }) => (w.slug ?? "").includes("mitra"));
  const sel = await api("POST", "/api/auth/select-tenant", { tenantId: mii?.id });
  ok("pilih workspace MII", sel.status === 200, `status=${sel.status}`);
}

// 2) daftar run → pilih Confirmed/Paid pertama
const runsRes = await api("GET", "/api/rekankerja/payroll-runs");
const runs = (await runsRes.json()).runs as { id: string; runNo: string; status: string; employeeCount: number }[];
ok("GET payroll-runs", runsRes.status === 200 && runs.length > 0, `${runs.length} run`);
const run = runs.find((r) => r.status === "Confirmed" || r.status === "Paid");
if (!run) {
  console.error("Tidak ada run Confirmed/Paid di tenant ini — buat/konfirmasi run dulu.");
  process.exit(1);
}
console.log(`→ run uji: ${run.runNo} (${run.status}, ${run.employeeCount} karyawan)`);

// 3) Money Vault: bila terkonfigurasi → buka utk nilai riil; bila legacy → nilai langsung riil
const vst = await api("GET", "/api/rekankerja/money-vault");
const vjson = await vst.json().catch(() => ({}));
let vaultUnlocked = false;
if (vjson?.configured) {
  const unlock = await api("POST", "/api/rekankerja/money-vault", { action: "unlock", password: "asmaree.007" });
  const unlockJson = await unlock.json().catch(() => ({}));
  vaultUnlocked = unlock.status === 200;
  ok("buka Money Vault", unlock.status === 200, `status=${unlock.status} ${JSON.stringify(unlockJson).slice(0, 80)}`);
} else {
  console.log("  vault: legacy (tak terkonfigurasi) — nilai uang langsung riil");
}
const prevRes = await api("GET", `/api/rekankerja/payroll-reports/monthly?runId=${run.id}`);
const prev = await prevRes.json();
ok("preview JSON", prevRes.status === 200, `status=${prevRes.status}`);
console.log(`  meta: ${JSON.stringify(prev.meta)}`);
console.log(`  totals: ${JSON.stringify(prev.totals)}`);
console.log(`  components: ${prev.components?.length ?? 0} komponen`);

// 4) guard: run salah → 404 (dgn sesi); tanpa sesi → 401
const nf = await api("GET", "/api/rekankerja/payroll-reports/monthly?runId=nope&export=xlsx");
ok("guard 404 run tak dikenal", nf.status === 404, `status=${nf.status}`);
const anon = await fetch(`${BASE}/api/rekankerja/payroll-reports/monthly?runId=${run.id}&export=xlsx`);
ok("guard 401 tanpa sesi", anon.status === 401, `status=${anon.status}`);

// 5) unduh XLSX
const dl = await api("GET", `/api/rekankerja/payroll-reports/monthly?runId=${run.id}&export=xlsx`);
ok("GET monthly export=xlsx", dl.status === 200, `status=${dl.status} type=${dl.headers.get("content-type")}`);
ok("header Content-Disposition", (dl.headers.get("content-disposition") ?? "").includes("rekankerja-payroll-bulanan"));
const buf = Buffer.from(await dl.arrayBuffer());
ok("file XLSX tak kosong", buf.length > 2000, `${buf.length} byte`);
await Bun.write("/tmp/t64-monthly.xlsx", buf);

// 6) baca workbook & verifikasi
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
const names = wb.worksheets.map((w) => w.name);
ok("5 sheet lengkap", names.join(",") === "Ringkasan,Rekap Gaji,Detail Komponen,Rekap Komponen,Pembayaran", names.join(","));

const ring = wb.getWorksheet("Ringkasan")!;
const ringRows = ring.rowCount;
console.log(`  Ringkasan: ${ringRows} baris (dgn title+header)`);
const flat: (string | number)[][] = [];
ring.eachRow((r) => flat.push((r.values as (string | number)[]).slice(1).map((v) => (v == null ? "" : typeof v === "object" ? String(v) : v))));
ok("Ringkasan memuat identitas perusahaan", flat.some((r) => String(r[0]) === "Perusahaan" && String(r[1]).length > 1), String(flat.find((r) => r[0] === "Perusahaan")?.[1]));
ok("Ringkasan memuat run+periode", flat.some((r) => r[0] === "Run Payroll" && r[1] === run.runNo));
ok("Ringkasan memuat total THP", flat.some((r) => r[0] === "Total Take Home Pay" && String(r[1]).startsWith("Rp ")));

const gaji = wb.getWorksheet("Rekap Gaji")!;
const gheader = ((gaji.getRow(1).values as string[]).slice(1) as string[]);
const gdata: (string | number)[][] = [];
gaji.eachRow((r, i) => { if (i > 1) gdata.push((r.values as (string | number)[]).slice(1).map((v) => (v == null ? "" : v))); });
const gtotal = gdata[gdata.length - 1];
ok("Rekap Gaji: baris karyawan + TOTAL", gdata.length === run.employeeCount + 1, `${gdata.length} baris data (harus ${run.employeeCount + 1})`);
ok("Rekap Gaji: baris terakhir = TOTAL", String(gtotal[0]) === "TOTAL", String(gtotal[1]));
ok("Rekap Gaji: kolom komponen dinamis hadir", gheader.length > 10, `${gheader.length} kolom: ${gheader.slice(5, 12).join(" | ")}…`);
ok("Rekap Gaji: kolom THP numerik", gdata.every((r) => typeof r[gheader.length - 1] === "number"));

const detail = wb.getWorksheet("Detail Komponen")!;
const drows = detail.rowCount - 1;
const dvals: (string | number)[][] = [];
detail.eachRow((r, i) => { if (i > 1) dvals.push((r.values as (string | number)[]).slice(1).map((v) => (v == null ? "" : v))); });
ok("Detail Komponen: >0 baris item", drows > 0, `${drows} baris`);
ok("Detail Komponen: kolom kategori terisi", dvals.every((r) => ["Penghasilan", "Potongan", "Informasi"].includes(String(r[5]))));

const komp = wb.getWorksheet("Rekap Komponen")!;
const kvals: (string | number)[][] = [];
komp.eachRow((r, i) => { if (i > 1) kvals.push((r.values as (string | number)[]).slice(1).map((v) => (v == null ? "" : v))); });
ok("Rekap Komponen: jumlah baris = jumlah komponen preview", kvals.length === prev.components.length, `${kvals.length} vs ${prev.components.length}`);

const byr = wb.getWorksheet("Pembayaran")!;
const pvals: (string | number)[][] = [];
byr.eachRow((r, i) => { if (i > 1) pvals.push((r.values as (string | number)[]).slice(1).map((v) => (v == null ? "" : v))); });
ok("Pembayaran: baris karyawan + TOTAL", pvals.length === run.employeeCount + 1, `${pvals.length} baris`);
ok("Pembayaran: kolom NPWP/Bank/Rekening hadir", (() => { const h = ((byr.getRow(1).values as string[]).slice(1) as string[]); return h.includes("NPWP") && h.includes("Bank") && h.includes("No. Rekening"); })());
const sampelP = pvals[0];
console.log(`  sampel Pembayaran: ${JSON.stringify(sampelP.slice(0, 6))}`);
ok("Pembayaran: PPh21 numerik", pvals.every((r) => typeof r[6] === "number"));

// konsistensi silang: total THP Rekap Gaji = Pembayaran = Ringkasan (parse Rp)
const netGaji = gtotal[gheader.length - 1];
const netByr = pvals[pvals.length - 1][7];
const rpVal = Number(String(flat.find((r) => r[0] === "Total Take Home Pay")?.[1] ?? "").replace(/[^\d]/g, ""));
ok("konsistensi THP: Rekap Gaji = Pembayaran", netGaji === netByr, `${netGaji} vs ${netByr}`);
ok("konsistensi THP: Ringkasan (Rp) = sheet angka", rpVal === netGaji, `${rpVal} vs ${netGaji}`);
ok("nilai uang riil tampil (vault terbuka)", Number(netGaji) > 0 && prev.totals.totalBruto > 0, `THP=${netGaji} bruto=${prev.totals.totalBruto}`);
ok("tidak ada ciphertext enc: bocor", !buf.toString("latin1").includes("enc:v1:") && !buf.toString("latin1").includes("enc:v2:"));

// 7) kunci kembali vault bila tadi dibuka (pulihkan state pra-tes) — best effort
if (vaultUnlocked) await api("POST", "/api/rekankerja/money-vault", { action: "lock" }).catch(() => {});

console.log(failures.length === 0 ? "\nSEMUA TES LULUS ✔" : `\nGAGAL: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
