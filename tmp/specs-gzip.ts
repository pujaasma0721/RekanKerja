// Rasio kompresi gzip aktual utk payload API terbesar (produksi Next.js mengaktifkan gzip).
import { loginAs } from "../scripts/qa/helpers";
import { gzipSync } from "node:zlib";
const B = "http://127.0.0.1:3000";
const bench = await loginAs({ email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" });
const eps = [
  "/api/rekankerja/payroll-run?id=run2",
  "/api/rekankerja/employee-options",
  "/api/rekankerja/employees?page=1&pageSize=100",
  "/api/rekankerja/dashboard",
];
for (const ep of eps) {
  const res = await fetch(`${B}${ep}`, { headers: { cookie: bench.cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  const gz = gzipSync(buf, { level: 6 });
  console.log(`${ep.slice(0, 60).padEnd(62)} ${(buf.length/1024).toFixed(1)}KB → gzip ${(gz.length/1024).toFixed(1)}KB (${(100-gz.length/buf.length*100).toFixed(0)}% hemat)`);
}
