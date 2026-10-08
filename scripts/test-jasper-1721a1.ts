// TEST RENDER — Bukti Potong 1721-A1 via engine iReport/JasperReports =======
// ============================================================================
// Skrip diagnostik (TIDAK bagian runtime aplikasi): ambil rekap SPT tahunan
// tenant MII langsung dari DB → adapter JRXML → spawn JasperRunner.java →
// PDF hasil render disimpan ke /tmp/spt1721a1-test.pdf utk inspeksi visual.
//
//   bun run scripts/test-jasper-1721a1.ts [year] [employeeNo]
// ============================================================================
import "./lib/env";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getTenantClient } from "../src/rekankerja/shared/lib/tenant-db";
import { buildAnnualSpt } from "../src/rekankerja/payroll/services/payroll-spt";
import { buildJrA1DataLines } from "../src/rekankerja/payroll/services/spt1721a1-jrxml";

async function main() {
  const year = parseInt(process.argv[2] ?? "2026", 10);
  const employeeNoWanted = process.argv[3] ?? null;

  const db = getTenantClient("tenant_pt_mitra_industri_internasional");
  const spt = await buildAnnualSpt(db, year); // tanpa MoneyView — skrip diagnostik
  if (spt.employees.length === 0) {
    console.log(`Tidak ada data SPT tahun ${year} — jalankan payroll dulu.`);
    process.exit(1);
  }
  const employees = employeeNoWanted
    ? spt.employees.filter((e) => e.employeeNo === employeeNoWanted)
    : spt.employees;
  console.log(`rekap SPT ${year}: ${spt.employees.length} karyawan; render ${employees.length} bukti potong`);

  const company = await db.company.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: { name: true, taxId: true, address: true, city: true },
  });
  const ctx = {
    companyName: company?.name ?? "PT Mitra Industri Internasional",
    companyNpwp: company?.taxId ?? null,
    companyAddress: company?.address ?? "",
    companyCity: company?.city ?? "",
    signerName: "Puja Hermawan", // payroll officer demo MII
  };

  const data = buildJrA1DataLines(employees, year, ctx);
  const nLines = data.trim().split("\n").length;
  console.log(`data.txt: ${nLines} baris detail`);

  const dir = mkdtempSync(join(tmpdir(), "spt1721a1-"));
  const dataPath = join(dir, "data.txt");
  const outPdf = employeeNoWanted
    ? `/tmp/spt1721a1-${employeeNoWanted}.pdf`
    : `/tmp/spt1721a1-test.pdf`;
  writeFileSync(dataPath, data, "utf8");

  const vendor = resolve(__dirname, "../vendor/jasper");
  try {
    const t0 = Date.now();
    const out = execFileSync(
      "java",
      [
        "-Djava.awt.headless=true",
        "-Duser.language=id", "-Duser.country=ID",
        "-cp", "lib/*",
        "JasperRunner.java",
        "templates/SPT1721A1.jrxml",
        "cache/SPT1721A1.jasper",
        dataPath,
        vendor, // pRealPath (berisi images/pajak.png)
        outPdf,
      ],
      { cwd: vendor, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(`java: ${out.trim()} (${Date.now() - t0} ms)`);
    const pdf = readFileSync(outPdf);
    console.log(`PDF: ${outPdf} (${(pdf.length / 1024).toFixed(1)} KB)`);
    // contoh baris data pertama utk debug
    console.log("--- data.txt baris pertama ---");
    console.log(data.split("\n")[0]);
  } catch (e) {
    console.error("JAVA FAILED:", (e as { stderr?: string }).stderr ?? e);
    process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
