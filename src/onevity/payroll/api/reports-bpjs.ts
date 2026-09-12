import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { tenantCryptoForDb, type FieldCrypto } from "@/onevity/shared/lib/field-crypto";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import type { MoneyView } from "@/onevity/shared/lib/money-view";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { toXlsx, xlsxResponse, exportFilename } from "@/onevity/shared/lib/export";

// GET /api/onevity/payroll-reports/bpjs?runId= — rekap iuran BPJS per karyawan
// untuk satu payroll run (T12-REPORTS).
//
//   • Sumber data: PayrollRunItem wageType "Jamsostek" (snapshot run —
//     komponen engine: JHT_C "BPJS JHT Perusahaan 3,7%", JHT_E "Potongan
//     BPJS JHT 2%", JP_C/JPK_C/JKK_C/JKM_C dst; lihat provisioning.ts).
//   • Klasifikasi program dari code+name (JPK=JKN Jaminan Kesehatan; urutan
//     cek JPK/JKK/JKM sebelum JP agar "JPK" tidak salah jatuh ke "JP").
//   • Arah iuran: item.type Earning = ditanggung perusahaan (p), Deduction =
//     dipotong dari pegawai (k).
//   • ?export=xlsx → stream XLSX (pola payroll-run-export.ts); tanpa param =
//     preview JSON (utk preview UI/tombol BpjsExportButton).
//   • 27-c: ?format=tk  → CSV "Laporan Kepegawaian" BPJS Ketenagakerjaan
//     (semicolon, tanggal DDMMYYYY, angka tanpa pemisah) — populasi: pegawai
//     dgn No. BPJS TK terisi (bpjsEmpSkill); bila runId diberikan → peserta
//     run tsb, tanpa runId → seluruh pegawai Aktif. Kolom de-facto 10 kolom
//     vendor payroll (NO KTP;NAMA;TEMPAT LAHIR;TGL LAHIR;NO BPJS TK;KODE
//     KANTOR;STATUS KARYAWAN;JABATAN;TGL MASUK;GAJI) — BPJS Ketenagakerjaan
//     tidak mempublikasikan spesifikasi kolom CSV resmi di luar portal
//     badan usaha; verifikasi terhadap template portal sebelum upload.
//   • 27-c: ?format=jkn → CSV "Data Peserta" BPJS Kesehatan (pola sheet
//     PESERTA e-Dabu) — populasi: pegawai dgn No. BPJS Kesehatan (bpjsHealth).
//     Riset 27-c: e-Dabu v7.6.0 (Okt 2023) mengubah formulir upload BU dari
//     37 → 23 kolom (sheet PESERTA), PENONAKTIFAN 5 kolom, batas unggah min 1
//     baris maks 100 baris/1 MB (sumber: ptgasi.co.id, materi eDabu v7.6.0).
//     OneVity mengekspor subset identitas+upah utk sheet PESERTA — anggota
//     keluarga (sheet ANGKEL) belum bisa (EmployeeFamily tanpa NIK).
//
// Guard: requireMenuAction payroll:runs view (pola payroll-runs.ts).

export interface BpjsRow {
  employeeId: string;
  employeeNo: string;
  nik: string | null;
  fullName: string;
  orgUnitName: string | null;
  jhtCompany: number;
  jhtEmployee: number;
  jpCompany: number;
  jpEmployee: number;
  jkk: number;
  jkm: number;
  jknCompany: number;
  jknEmployee: number;
  totalCompany: number;
  totalEmployee: number;
}

interface BpjsBuckets {
  jhtC: number; jhtE: number; jpC: number; jpE: number;
  jkk: number; jkm: number; jknC: number; jknE: number;
}

const r0 = (n: number) => Math.round(n);

// ===== 27-c — format upload resmi BPJS (CSV) ======================================

/** Baris peserta utk format upload BPJS (identitas + penempatan + upah). */
interface BpjsMemberRow {
  employeeNo: string;
  nik: string | null;
  fullName: string;
  gender: string;
  birthPlace: string | null;
  birthDate: Date | null;
  address: string | null;
  city: string | null;
  bpjsTk: string | null;
  bpjsKes: string | null;
  joinDate: Date;
  employmentStatus: string; // Permanent|Contract|Probation|Outsourcing
  positionName: string | null;
  baseSalary: number;
}

/** Status karyawan BPJS TK: PKWTT / PKWTT Terbatas (PKWT). */
function tkStatusOf(employmentStatus: string): string {
  if (employmentStatus === "Permanent" || employmentStatus === "Probation") return "PKWTT";
  return "PKWTT Terbatas"; // Contract|Outsourcing → PKWT
}

/** Status pegawai e-Dabu BPJS Kesehatan. */
function jknStatusOf(employmentStatus: string): string {
  switch (employmentStatus) {
    case "Permanent": return "Pegawai Tetap";
    case "Contract": return "Pegawai Tidak Tetap";
    case "Probation": return "Pegawai Tetap";
    default: return employmentStatus;
  }
}

/** Tanggal → DDMMYYYY (konvensi upload BPJS, tanpa pemisah). */
const ddmmyyyy = (d: Date | null): string =>
  d ? `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}` : "";

const genderLP = (g: string): string => (g === "F" ? "P" : "L");

const csvEscBpjs = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Kolom identitas+penempatan+upah pegawai utk query run / master. */
const memberSelect = {
  nationalId: true, fullName: true, gender: true, birthPlace: true, birthDate: true,
  address: true, city: true, bpjsEmpSkill: true, bpjsHealth: true, joinDate: true,
  position: { select: { title: true } },
  assignments: { where: { validTo: null }, orderBy: { validFrom: "desc" as const }, take: 1, select: { employmentStatus: true, baseSalary: true } },
} as const;

type MemberEmployee = {
  nationalId: string | null; fullName: string; gender: string; birthPlace: string | null;
  birthDate: Date | null; address: string | null; city: string | null;
  bpjsEmpSkill: string | null; bpjsHealth: string | null; joinDate: Date;
  position: { title: string } | null;
  // 28-c: baseSalary tersimpan sbg string terenkripsi (enc:v1:n:…).
  assignments: { employmentStatus: string; baseSalary: string | null }[];
};

const toMemberRow = (tc: FieldCrypto, mv: MoneyView, employeeNo: string, emp: MemberEmployee, positionFallback: string | null): BpjsMemberRow => ({
  employeeNo,
  // 28-c: NIK & gaji pokok tersimpan terenkripsi — dekripsi (format upload
  // BPJS memuat KTP & GAJI riil).
  nik: tc.decryptText(emp.nationalId),
  fullName: emp.fullName,
  gender: emp.gender,
  birthPlace: emp.birthPlace,
  birthDate: emp.birthDate,
  address: emp.address,
  city: emp.city,
  bpjsTk: emp.bpjsEmpSkill,
  bpjsKes: emp.bpjsHealth,
  joinDate: emp.joinDate,
  employmentStatus: emp.assignments[0]?.employmentStatus ?? "Permanent",
  positionName: positionFallback ?? emp.position?.title ?? null,
  // 45-b: gaji pokok lewat gerbang MoneyView — vault tertutup/tanpa grant
  // → kolom GAJI file upload BPJS ter-mask (0); NIK tetap per aturan PII M-9.
  baseSalary: Math.round(mv.dec0(emp.assignments[0]?.baseSalary)),
});

/**
 * CSV "Laporan Kepegawaian" BPJS Ketenagakerjaan — 10 kolom klasik
 * (NO KTP;NAMA;TEMPAT LAHIR;TANGGAL LAHIR;NO BPJS KETENAGAKERJAAN;KODE
 * KANTOR;STATUS KARYAWAN;JABATAN;TANGGAL MASUK;GAJI). KODE KANTOR kosong
 * (belum ada field kode kantor cabang BPJS — lihat worklog 27-c).
 */
function buildBpjsTkCsv(rows: BpjsMemberRow[]): string {
  const header = ["NO KTP", "NAMA", "TEMPAT LAHIR", "TANGGAL LAHIR", "NO BPJS KETENAGAKERJAAN", "KODE KANTOR", "STATUS KARYAWAN", "JABATAN", "TANGGAL MASUK", "GAJI"];
  const lines = [header.map(csvEscBpjs).join(";")];
  for (const r of rows) {
    lines.push([
      r.nik ?? "", r.fullName.toUpperCase(), r.birthPlace ?? "", ddmmyyyy(r.birthDate),
      r.bpjsTk ?? "", "", tkStatusOf(r.employmentStatus), r.positionName ?? "",
      ddmmyyyy(r.joinDate), r.baseSalary,
    ].map(csvEscBpjs).join(";"));
  }
  return lines.join("\n") + "\n";
}

/**
 * CSV "Data Peserta" BPJS Kesehatan (pola sheet PESERTA e-Dabu v7.x) —
 * hanya baris PEGAWAI (anggota keluarga belum bisa diekspor: EmployeeFamily
 * tanpa NIK — lihat worklog 27-c). KELAS PERAWATAN kosong (belum ada field).
 */
function buildBpjsJknCsv(rows: BpjsMemberRow[]): string {
  const header = ["NO", "NIK", "NO KARTU BPJS KESEHATAN", "NAMA PESERTA", "TANGGAL LAHIR", "JENIS KELAMIN (L/P)", "HUBUNGAN KELUARGA", "ALAMAT", "STATUS PEGAWAI", "JABATAN", "UPAH", "KELAS PERAWATAN"];
  const lines = [header.map(csvEscBpjs).join(";")];
  rows.forEach((r, i) => {
    lines.push([
      i + 1, r.nik ?? "", r.bpjsKes ?? "", r.fullName.toUpperCase(), ddmmyyyy(r.birthDate),
      genderLP(r.gender), "Pegawai", [r.address, r.city].filter(Boolean).join(", "),
      jknStatusOf(r.employmentStatus), r.positionName ?? "", r.baseSalary, "",
    ].map(csvEscBpjs).join(";"));
  });
  return lines.join("\n") + "\n";
}

async function logBpjsFormatExport(db: TenantDb, format: "tk" | "jkn", scope: string, count: number, appUserId: string | null) {
  try {
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "PayrollRun",
        ...(appUserId ? { appUserId } : {}),
        detail: `Ekspor format upload BPJS ${format === "tk" ? "Ketenagakerjaan (Laporan Kepegawaian)" : "Kesehatan (Data Peserta)"} ${scope} (${count} peserta)`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}

/** Klasifikasi program BPJS dari code+name (order matters: JPK/JKK/JKM sebelum JP). */
function basisOf(code: string, name: string): "JHT" | "JP" | "JKK" | "JKM" | "JKN" | null {
  const s = `${code} ${name}`.toUpperCase().replace(/\s+/g, "");
  if (s.includes("JHT")) return "JHT";
  if (s.includes("JPK") || s.includes("JKN") || s.includes("KESEHATAN")) return "JKN";
  if (s.includes("JKK")) return "JKK";
  if (s.includes("JKM")) return "JKM";
  if (s.includes("JP")) return "JP";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:runs", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const runId = sp.get("runId");
    // 28-c: konteks dekripsi per-tenant (NIK, gaji pokok, item iuran run).
    const tc = tenantCryptoForDb(db);
    // 45-b: gerbang MoneyView — vault uang tertutup/tanpa grant → GAJI &
    // rekap iuran ter-mask (0). Admin membuka vault utk file upload riil.
    const mv = await moneyViewForReq(req, db);

    // ===== 27-c — format upload resmi BPJS (CSV) =====
    // runId OPSIONAL di sini: dgn runId → populasi pegawai run tsb yang
    // memiliki No. BPJS; tanpa runId → seluruh pegawai Aktif ber-No. BPJS.
    const uploadFormat = sp.get("format");
    if (uploadFormat === "tk" || uploadFormat === "jkn") {
      const isTk = uploadFormat === "tk";
      const now = new Date();
      const masterScope = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      let members: BpjsMemberRow[] = [];
      let scope = masterScope;
      if (runId) {
        const run = await db.payrollRun.findUnique({
          where: { id: runId },
          include: {
            period: true,
            lines: {
              orderBy: { employeeNo: "asc" },
              include: { employee: { select: { employeeNo: true, ...memberSelect } } },
            },
          },
        });
        if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
        if (run.status === "Draft" || run.status === "Cancelled") {
          return NextResponse.json(
            { error: `Run ${run.runNo} berstatus ${run.status} — hitung (calculate) payroll terlebih dahulu` },
            { status: 400 },
          );
        }
        scope = run.runNo;
        members = run.lines
          .filter((l) => (isTk ? l.employee?.bpjsEmpSkill : l.employee?.bpjsHealth))
          .map((l) => toMemberRow(tc, mv, l.employeeNo, l.employee as MemberEmployee, l.positionName));
      } else {
        const emps = await db.employee.findMany({
          where: isTk
            ? { status: "Active", bpjsEmpSkill: { not: null } }
            : { status: "Active", bpjsHealth: { not: null } },
          orderBy: { employeeNo: "asc" },
          select: { employeeNo: true, ...memberSelect },
        });
        members = emps.map((e) => toMemberRow(tc, mv, e.employeeNo, e as MemberEmployee, null));
      }

      const csv = isTk ? buildBpjsTkCsv(members) : buildBpjsJknCsv(members);
      await logBpjsFormatExport(db, isTk ? "tk" : "jkn", scope, members.length, m.actor.appUserId);
      const company = await db.company.findFirst({ select: { code: true } });
      const tenant = (company?.code ?? "ONEVITY").replace(/[^A-Za-z0-9]+/g, "");
      const filename = isTk
        ? `LaporanKepegawaian_BPJSTK_${tenant}_${scope}.csv`
        : `DataPeserta_BPJSKes_${tenant}_${scope}.csv`;
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (!runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });

    const run = await db.payrollRun.findUnique({
      where: { id: runId },
      include: {
        period: true,
        processType: true,
        lines: {
          orderBy: { employeeNo: "asc" },
          include: { items: true, employee: { select: { nationalId: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status === "Draft" || run.status === "Cancelled") {
      return NextResponse.json(
        { error: `Run ${run.runNo} berstatus ${run.status} — hitung (calculate) payroll terlebih dahulu` },
        { status: 400 },
      );
    }

    const rows: BpjsRow[] = run.lines.map((l) => {
      const b: BpjsBuckets = { jhtC: 0, jhtE: 0, jpC: 0, jpE: 0, jkk: 0, jkm: 0, jknC: 0, jknE: 0 };
      for (const item of l.items) {
        if (item.wageType !== "Jamsostek") continue;
        const basis = basisOf(item.code, item.name);
        if (!basis) continue;
        // arah iuran: Earning = ditanggung perusahaan; Deduction = dipotong
        // dari pegawai (JKK/JKM/JKN-perusahaan tidak dipotong dari slip).
        const isCompany = item.type === "Earning";
        const key: keyof BpjsBuckets =
          basis === "JHT" ? (isCompany ? "jhtC" : "jhtE")
          : basis === "JP" ? (isCompany ? "jpC" : "jpE")
          : basis === "JKK" ? "jkk"
          : basis === "JKM" ? "jkm"
          : isCompany ? "jknC" : "jknE";
        b[key] += mv.dec0(item.amount); // 28-c: iuran terenkripsi · 45-b: gated vault
      }
      return {
        employeeId: l.employeeId,
        employeeNo: l.employeeNo,
        nik: tc.decryptText(l.employee?.nationalId), // 28-c: NIK terenkripsi
        fullName: l.employeeName,
        orgUnitName: l.orgUnitName,
        jhtCompany: r0(b.jhtC), jhtEmployee: r0(b.jhtE),
        jpCompany: r0(b.jpC), jpEmployee: r0(b.jpE),
        jkk: r0(b.jkk), jkm: r0(b.jkm),
        jknCompany: r0(b.jknC), jknEmployee: r0(b.jknE),
        totalCompany: r0(b.jhtC + b.jpC + b.jkk + b.jkm + b.jknC),
        totalEmployee: r0(b.jhtE + b.jpE + b.jknE),
      };
    });

    const sum = (f: (r: BpjsRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totals = {
      employees: rows.length,
      jhtCompany: sum((r) => r.jhtCompany), jhtEmployee: sum((r) => r.jhtEmployee),
      jpCompany: sum((r) => r.jpCompany), jpEmployee: sum((r) => r.jpEmployee),
      jkk: sum((r) => r.jkk), jkm: sum((r) => r.jkm),
      jknCompany: sum((r) => r.jknCompany), jknEmployee: sum((r) => r.jknEmployee),
      totalCompany: sum((r) => r.totalCompany), totalEmployee: sum((r) => r.totalEmployee),
    };

    const meta = {
      runId: run.id,
      runNo: run.runNo,
      status: run.status,
      period: run.period.name,
      processType: run.processType.name,
      generatedAt: new Date().toISOString(),
    };

    if (req.nextUrl.searchParams.get("export") === "xlsx") {
      const columns = [
        { header: "NIK", width: 18 },
        { header: "No. Karyawan", width: 14 },
        { header: "Nama", width: 28 },
        { header: "Unit Kerja", width: 24 },
        { header: "JHT Perusahaan (3,7%)", width: 20 },
        { header: "JHT Pegawai (2%)", width: 18 },
        { header: "JP Perusahaan (2%)", width: 18 },
        { header: "JP Pegawai (1%)", width: 18 },
        { header: "JKK", width: 12 },
        { header: "JKM", width: 12 },
        { header: "JKN Perusahaan (4%)", width: 20 },
        { header: "JKN Pegawai (1%)", width: 18 },
        { header: "Total Perusahaan", width: 18 },
        { header: "Total Pegawai", width: 16 },
      ];
      const body = rows.map((r) => [
        r.nik ?? "", r.employeeNo, r.fullName, r.orgUnitName ?? "",
        r.jhtCompany, r.jhtEmployee, r.jpCompany, r.jpEmployee, r.jkk, r.jkm,
        r.jknCompany, r.jknEmployee, r.totalCompany, r.totalEmployee,
      ]);
      body.push([
        "", "", `TOTAL (${rows.length} karyawan)`, "",
        totals.jhtCompany, totals.jhtEmployee, totals.jpCompany, totals.jpEmployee, totals.jkk, totals.jkm,
        totals.jknCompany, totals.jknEmployee, totals.totalCompany, totals.totalEmployee,
      ]);
      const buf = await toXlsx("Rekap BPJS", columns, body, {
        title: `Rekap Iuran BPJS — ${run.runNo} · ${run.period.name} · ${run.processType.name}`,
      });
      await logExport(db, run.runNo, m.actor.appUserId);
      return xlsxResponse(buf, exportFilename("onevity-bpjs", "xlsx", run.runNo));
    }

    return NextResponse.json({ meta, rows, totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

async function logExport(db: TenantDb, runNo: string, appUserId: string | null) {
  try {
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "PayrollRun",
        ...(appUserId ? { appUserId } : {}),
        detail: `Ekspor XLSX rekap BPJS run ${runNo}`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}
