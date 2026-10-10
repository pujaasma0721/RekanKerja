import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { buildAnnualSpt } from "@/rekankerja/payroll/services/payroll-spt";
import { buildJrA1DataLines } from "@/rekankerja/payroll/services/spt1721a1-jrxml";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ============================================================================
// RekanKerja Payroll — R2.2 BUKTI POTONG 1721-A1 (ENGINE iReport) ===========
// ============================================================================
// GET /api/rekankerja/payroll-reports/spt1721a1?year=2026&employeeId=<id>
//
// Render Bukti Potong PPh 21 Formulir 1721-A1 via engine iReport/JasperReports
// dengan template JRXML resmi DJP (vendor/jasper/templates/SPT1721A1.jrxml —
// template bawaan klien, layout TIDAK diubah, hanya diisi data). Output:
// PDF folio 612×936pt, 1 halaman per karyawan (group isStartNewPage).
//
//   year        — tahun pajak (wajib)
//   employeeId  — opsional; kosong = SEMUA karyawan (bundle tahunan, 1
//                 halaman per karyawan — cocok utk lampiran SPT tahunan)
//
// Pipeline: buildAnnualSpt (rekap tahunan, uang lewat gerbang MoneyView) →
// adapter spt1721a1-jrxml (data.txt \u0001-separated) → spawn `java`
// JasperRunner.java (compile-cache .jasper di vendor/jasper/cache) → PDF.
//
// Keamanan: guard LIHAT payroll:reports / payroll:runs (sama dgn route
// documents); nilai uang tunduk gerbang MoneyView aktor; NPWP/NIK/alamat
// didekripsi tenantCrypto di batas serializer buildAnnualSpt.
// ============================================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VENDOR_JASPER = path.join(process.cwd(), "vendor", "jasper");

// Resolve binary Java: JAVA_BIN env overrides → kandidat umum (termasuk JRE
// self-hosted ~/opt/jdk-*-jre di .15) → "java" dari PATH PM2 sebagai fallback.
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
function resolveJavaBin(): string {
  const envBin = process.env.JAVA_BIN;
  if (envBin) return envBin;
  const home = os.homedir();
  const optDir = path.join(home, "opt");
  const candidates = [
    "/usr/bin/java",
    "/usr/local/bin/java",
    ...existsSync(optDir)
      ? readdirSync(optDir)
          .filter((d) => /jdk-/.test(d))
          .sort()
          .reverse()
          .map((d) => path.join(optDir, d, "bin", "java"))
      : [],
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "java";
}

function javaError(status: number, stderr: string): NextResponse {
  const tail = stderr.split("\n").filter(Boolean).slice(-6).join(" · ");
  return NextResponse.json(
    { error: `Engine iReport gagal merender 1721-A1 (${status}): ${tail || "tanpa detail"}` },
    { status: 502 },
  );
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["payroll:reports", "payroll:runs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    const year = parseInt(sp.get("year") ?? "", 10);
    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Parameter year (tahun pajak) wajib" }, { status: 400 });
    }
    const employeeId = sp.get("employeeId") ?? ""; // kosong = semua karyawan

    // ---- rekap tahunan + konteks pemotong ----
    const mv = await moneyViewForReq(req, db);
    const spt = await buildAnnualSpt(db, year, mv);
    if (spt.employees.length === 0) {
      return NextResponse.json(
        { error: `Tidak ada data payroll final (Confirmed/Paid) pada tahun pajak ${year}` },
        { status: 404 },
      );
    }
    const employees = employeeId
      ? spt.employees.filter((e) => e.employeeId === employeeId)
      : spt.employees;
    if (employeeId && employees.length === 0) {
      return NextResponse.json(
        { error: "Karyawan tidak memiliki data payroll final pada tahun tersebut" },
        { status: 404 },
      );
    }
    const company = await db.company.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, taxId: true, address: true, city: true },
    });
    const data = buildJrA1DataLines(employees, year, {
      companyName: company?.name ?? "—",
      companyNpwp: company?.taxId ?? null,
      companyAddress: company?.address ?? "",
      companyCity: company?.city ?? "",
      signerName: m.actor.name, // officer — penanda tangan pemotong
    });

    // ---- jalankan engine iReport (JasperRunner.java, single-file launch) ----
    // AUD-2b fix: cache/ di-gitignore & diregenerasi otomatis — PASTIKAN ada
    // sebelum spawn java (JRSaver gagal FileOutputStream bila dir hilang,
    // mis. checkout segar; dulu menyebabkan 502 persisten).
    await mkdir(path.join(VENDOR_JASPER, "cache"), { recursive: true });
    const dir = await mkdtemp(path.join(tmpdir(), "rk-1721a1-"));
    const dataPath = path.join(dir, "data.txt");
    const outPath = path.join(dir, "1721-A1.pdf");
    await writeFile(dataPath, data, "utf8");

    try {
      const pdf = await new Promise<Buffer>((resolve, reject) => {
        const child = spawn(
          resolveJavaBin(),
          [
            "-Djava.awt.headless=true",
            "-Duser.language=id", "-Duser.country=ID", // DecimalFormat: pemisah ribuan "."
            "-cp", "lib/*",
            "JasperRunner.java",
            "templates/SPT1721A1.jrxml",
            "cache/SPT1721A1.jasper",
            dataPath,
            VENDOR_JASPER, // pRealPath — berisi images/pajak.png
            outPath,
          ],
          { cwd: VENDOR_JASPER, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stdout.on("data", () => { /* "OK pages=…" diabaikan */ });
        child.stderr.on("data", (d) => { stderr += String(d); });
        child.on("error", (e) =>
          reject(
            e && (e as NodeJS.ErrnoException).code === "ENOENT"
              ? new Error("RUNTIME_JAVA_MISSING")
              : e,
          ));
        child.on("close", (code) => {
          if (code === 0) {
            readFile(outPath).then(resolve, reject);
          } else {
            reject(new Error(`JAVA_EXIT_${code}:${stderr}`));
          }
        });
        // pengaman: matikan proses jika menggantung > 90 detik
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 90_000).unref();
      });

      const firstNo = employees[0]?.employeeNo ?? "all";
      const lastNo = employees[employees.length - 1]?.employeeNo;
      const namePart =
        employees.length === 1 ? firstNo : lastNo ? `${firstNo}-${lastNo}` : `${employees.length}kry`;
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="1721-A1-${year}-${namePart}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RUNTIME_JAVA_MISSING")) {
        return NextResponse.json(
          {
            error:
              "Java runtime tidak tersedia di server — engine iReport (JasperReports) membutuhkan JRE 11+. Hubungi administrator.",
          },
          { status: 503 },
        );
      }
      return javaError(502, msg);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gagal merender bukti potong" },
      { status: 500 },
    );
  }
}
