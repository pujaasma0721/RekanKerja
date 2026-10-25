// Audit lanjutan: jalur scope-FULL + endpoint lain (detail, options, export)
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";

const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();
const su = await c.query(`SELECT email, "isSuperadmin" FROM public."User" WHERE "isSuperadmin" = true LIMIT 5`);
console.log("superadmin terdaftar:", (su.rows as any[]).map(r => r.email).join(", ") || "(tidak ada)");
await c.end();

const B = "http://127.0.0.1:3000";
const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });

// employee-detail (halaman detail karyawan) — cek NIK/NPWP
const list = await (await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii.cookie } })).json() as any;
const empId = list.employees?.[0]?.id;
for (const ep of [`/api/rekankerja/employee-detail?id=${empId}`, `/api/rekankerja/employee-options`]) {
  const res = await fetch(`${B}${ep}`, { headers: { cookie: mii.cookie } });
  const txt = await res.text();
  const j = JSON.parse(txt) as any;
  const e = j.employee ?? j.employees?.[0] ?? j.options?.[0] ?? j;
  console.log(`\n[${ep.split("?")[0]}] HTTP ${res.status}`);
  console.log(`  nationalId: ${e?.nationalId ?? "(tidak ada field)"}`);
  console.log(`  taxId     : ${e?.taxId ?? "(tidak ada field)"}`);
  // scan bocor: cari pola 16-digit plaintext dalam SELURUH respons
  const leak = txt.match(/"nationalId"\s*:\s*"\d{16}"/) || txt.match(/"taxId"\s*:\s*"\d{15,20}"/);
  console.log(`  plaintext NIK/NPWP bocor di respons: ${leak ? "❌ YA → " + leak[0].slice(0, 40) : "✅ tidak"}`);
}
// export XLSX — hanya status (jangan download besar)
const res2 = await fetch(`${B}/api/rekankerja/employees/export?limit=5`, { headers: { cookie: mii.cookie } });
console.log(`\n[export XLSX] HTTP ${res2.status} · content-type: ${res2.headers.get("content-type")?.slice(0, 40)}`);
