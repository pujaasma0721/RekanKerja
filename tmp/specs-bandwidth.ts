// Ukur bobot respons (bytes) endpoint kunci utk perhitungan bandwidth produksi.
import { loginAs } from "../scripts/qa/helpers";
import fs from "node:fs";

const B = "http://127.0.0.1:3000";
async function size(session: any, ep: string) {
  const t0 = performance.now();
  const res = await fetch(`${B}${ep}`, { headers: { cookie: session.cookie } });
  const buf = await res.arrayBuffer();
  return { status: res.status, bytes: buf.byteLength, ms: Math.round(performance.now() - t0) };
}
function fmt(b: number) { return b > 1048576 ? `${(b/1048576).toFixed(2)}MB` : `${(b/1024).toFixed(1)}KB`; }

const bench = await loginAs({ email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" });
const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });

const eps: [string, any, string][] = [
  ["/api/auth/me", bench, "bench5000"],
  ["/api/rekankerja/dashboard", bench, "bench5000"],
  ["/api/rekankerja/employees?page=1&pageSize=100", bench, "bench5000"],
  ["/api/rekankerja/employees?q=Santoso", bench, "bench5000"],
  ["/api/rekankerja/employees?sortBy=baseSalary&sortDir=asc", bench, "bench5000"],
  ["/api/rekankerja/employee-options", bench, "bench5000"],
  ["/api/rekankerja/payroll-runs", bench, "bench5000"],
  ["/api/rekankerja/payroll-run?id=run2", bench, "bench5000"],
  ["/api/rekankerja/attendance/overview", bench, "bench5000"],
  ["/api/rekankerja/notifications", bench, "bench5000"],
  ["/api/rekankerja/dashboard", mii, "mii"],
  ["/api/rekankerja/employees?page=1", mii, "mii"],
];
// warm-up 1x supaya angka = kondisi warm (cache OS + komponen dihitung)
for (const [ep, s] of eps) { try { await fetch(`${B}${ep}`, { headers: { cookie: s.cookie } }).then(r=>r.arrayBuffer()); } catch {} }

const rows: any[] = [];
for (const [ep, s, who] of eps) {
  const r = await size(s, ep);
  rows.push({ who, ep, b: r.bytes, ms: r.ms, status: r.status });
  console.log(`${who.padEnd(10)} ${r.status}  ${fmt(r.bytes).padStart(9)}  ${String(r.ms).padStart(6)}ms  ${ep.slice(0, 72)}`);
}
for (const path of ["/login", "/"]) {
  const r = await size(bench, path);
  rows.push({ who: "html", ep: path, b: r.bytes, ms: r.ms, status: r.status });
  console.log(`${"html".padEnd(10)} ${r.status}  ${fmt(r.bytes).padStart(9)}  ${String(r.ms).padStart(6)}ms  ${path}`);
}
fs.writeFileSync("tmp/specs-bandwidth.json", JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
