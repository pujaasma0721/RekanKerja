// BL2-a — verifikasi LIVE endpoint payslip ?lang= (route + service + ActivityLog).
// Login OWNER bench101 (run Confirmed 5000 line) → unduh PDF id & en → cek
// marker via pdftotext. Jalankan: bun run tmp/bl2a-payslip-live.ts
const BASE = "http://127.0.0.1:3000";
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function firstCookie(res: Response): string {
  const all = res.headers.getSetCookie?.() ?? [];
  return all[0]?.split(";")[0] ?? "";
}

async function main(): Promise<void> {
  const rL = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user42@bench101.test", password: "Bench101!" }),
  });
  let cookie = firstCookie(rL);
  const lj = (await rL.json()) as { tenant?: { slug: string } | null; workspaces?: { id: string; slug: string }[] };
  check("login user42@bench101", rL.status === 200 && !!cookie, `status ${rL.status}`);
  if (!lj.tenant || lj.tenant.slug !== "bench101") {
    const target = (lj.workspaces ?? []).find((w) => w.slug === "bench101");
    if (!target) { console.error("workspace bench101 tidak tersedia"); process.exit(1); }
    const sel = await fetch(`${BASE}/api/auth/select-tenant`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ tenantId: target.id }),
    });
    cookie = firstCookie(sel) || cookie;
    check("select-tenant bench101", sel.status === 200);
  }

  const rRuns = await fetch(`${BASE}/api/rekankerja/payroll-runs`, { headers: { cookie } });
  const runs = (await rRuns.json()) as { runs?: { id: string; runNo: string; status: string }[] };
  const run = (runs.runs ?? []).find((r) => r.status === "Confirmed" || r.status === "Paid");
  check("ada run Confirmed/Paid", !!run, `${(runs.runs ?? []).length} run total`);
  if (!run) process.exit(1);

  const rLines = await fetch(`${BASE}/api/rekankerja/payroll-run?id=${run.id}&page=1&pageSize=1`, { headers: { cookie } });
  const detail = (await rLines.json()) as { run?: { lines?: { id: string }[] } };
  const line = detail.run?.lines?.[0];
  check("ada line di run", !!line);
  if (!line) process.exit(1);

  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");

  for (const [lang, marker, anti] of [
    ["en", "PAYSLIP", "SLIP GAJI"],
    ["en", "Employee Name", "Nama Karyawan"],
    ["id", "SLIP GAJI", "PAYSLIP"],
    ["id", "KOMPONEN", "COMPONENT"],
  ] as const) {
    const rPdf = await fetch(`${BASE}/api/rekankerja/payslip/${line.id}?download=1&lang=${lang}`, { headers: { cookie } });
    check(`GET payslip ?lang=${lang} → 200 PDF`, rPdf.status === 200 && (rPdf.headers.get("content-type") ?? "").includes("pdf"), `status ${rPdf.status}`);
    const buf = Buffer.from(await rPdf.arrayBuffer());
    const f = `/tmp/bl2a-slip-${lang}.pdf`;
    fs.writeFileSync(f, buf);
    const txt = execFileSync("/usr/bin/pdftotext", [f, "-"]).toString();
    check(`  [${lang}] mengandung "${marker}"`, txt.includes(marker));
    check(`  [${lang}] TIDAK mengandung "${anti}"`, !txt.includes(anti));
    const disp = rPdf.headers.get("content-disposition") ?? "";
    check(`  [${lang}] filename benar`, disp.includes(lang === "en" ? "Payslip-" : "Slip-Gaji-"), disp.slice(0, 90));
  }

  console.log(`\n${failures === 0 ? "SEMUA PASS" : "ADA FAIL"} (${failures} fail)`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();
