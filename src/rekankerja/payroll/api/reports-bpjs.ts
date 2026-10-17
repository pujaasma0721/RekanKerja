import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb, type FieldCrypto } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import type { MoneyView } from "@/rekankerja/shared/lib/money-view";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";

// GET /api/rekankerja/payroll-reports/bpjs?runId= — rekap iuran BPJS per karyawan
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
//     RekanKerja mengekspor subset identitas+upah utk sheet PESERTA.
//   • P2.1-BM (D-BM16) — file LKS resmi: kolom KODE KANTOR (TK) & KELAS
//     PERAWATAN (JKN) kini diisi dari PayrollRegulation aktif
//     (bpjsOfficeCode / bpjsInpatientClass — null → kolom kosong, tidak
//     error). ?format=jkn MENAMBAH baris KELUARGA per peserta:
//     EmployeeFamily isDependent=true, NIK (D-BM4) didekripsi di batas
//     serializer; HUBUNGAN KELUARGA e-Dabu resmi (Suami/Istri by gender,
//     Anak, Orang Tua). Keluarga TANPA NIK DILEWATI + tercatat di daftar
//     gap (sheet XLSX "Gap NIK Keluarga" + meta JSON familyRows/
//     familySkipped/gaps). Alias ?format=lks-tk / lks-jkn = tk / jkn
//     (anchor label menu baru).
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
  // Task 52-c — JKP (PP 6/2025).
  jkpCompany: number;
  jkpEmployee: number;
  totalCompany: number;
  totalEmployee: number;
}

interface BpjsBuckets {
  jhtC: number; jhtE: number; jpC: number; jpE: number;
  jkk: number; jkm: number; jknC: number; jknE: number;
  jkpC: number; jkpE: number;
}

const r0 = (n: number) => Math.round(n);

// ===== 27-c — format upload resmi BPJS (CSV) ======================================

/** Baris peserta utk format upload BPJS (identitas + penempatan + upah). */
interface BpjsMemberRow {
  employeeId: string;
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

/**
 * HUBUNGAN KELUARGA e-Dabu resmi (P2.1-BM): nilai resmi = Pegawai / Suami /
 * Istri / Anak; Spouse mengikuti gender anggota keluarga. Parent dipetakan
 * "Orang Tua" (varian template e-Dabu yang menerimanya); Child & fallback
 * (Sibling dsb.) → "Anak" agar file tetap memakai kosakata resmi.
 */
function familyRelationLabel(relation: string, gender: string): string {
  if (relation === "Spouse") return gender === "F" ? "Istri" : "Suami";
  if (relation === "Parent") return "Orang Tua";
  return "Anak";
}

/** Baris KELUARGA (dependen) utk file LKS JKN "Data Peserta" — NIK terisi. */
export interface BpjsFamilyRow {
  employeeNo: string;
  nik: string;
  fullName: string;
  gender: string;
  birthDate: Date | null;
  hubkel: string;
}

/** Keluarga dependen TANPA NIK — DILEWATI dari file LKS + dilaporkan. */
export interface BpjsFamilyGap {
  employeeNo: string;
  employeeName: string;
  familyName: string;
  relation: string;
  reason: string;
}

/** Kolom keluarga dependen (isDependent=true) — baris KELUARGA file LKS JKN. */
const familySelect = {
  where: { isDependent: true },
  orderBy: { birthDate: "asc" as const },
  select: { name: true, gender: true, birthDate: true, relation: true, nationalId: true },
} as const;

type MemberFamily = {
  name: string; gender: string; birthDate: Date | null; relation: string; nationalId: string | null;
};

/** Peserta JKN + data keluarganya (utk pengumpulan baris KELUARGA + gap). */
interface JknParticipant {
  employeeNo: string;
  employeeName: string;
  family?: MemberFamily[];
}

/**
 * P2.1-BM — kumpulkan baris KELUARGA peserta JKN "Data Peserta".
 * D-BM4: NIK keluarga TERENKRIPSI enc:v1 → dekripsi di batas serializer.
 * Keluarga TANPA NIK tidak bisa masuk file LKS resmi → DILEWATI dan
 * tercatat di daftar gap {employeeNo, employeeName, familyName, relation,
 * reason:"NIK belum diisi"} (dilaporkan di sheet XLSX + meta JSON).
 */
function collectJknFamilies(
  tc: FieldCrypto,
  participants: JknParticipant[],
): { familyRows: BpjsFamilyRow[]; gaps: BpjsFamilyGap[] } {
  const familyRows: BpjsFamilyRow[] = [];
  const gaps: BpjsFamilyGap[] = [];
  for (const p of participants) {
    for (const f of p.family ?? []) {
      const nik = tc.decryptText(f.nationalId);
      if (!nik) {
        gaps.push({ employeeNo: p.employeeNo, employeeName: p.employeeName, familyName: f.name, relation: f.relation, reason: "NIK belum diisi" });
        continue;
      }
      familyRows.push({
        employeeNo: p.employeeNo,
        nik,
        fullName: f.name,
        gender: f.gender,
        birthDate: f.birthDate,
        hubkel: familyRelationLabel(f.relation, f.gender),
      });
    }
  }
  return { familyRows, gaps };
}

/** Kolom identitas+penempatan+upah pegawai utk query run / master. */
const memberSelect = {
  id: true,
  nationalId: true, fullName: true, gender: true, birthPlace: true, birthDate: true,
  address: true, city: true, bpjsEmpSkill: true, bpjsHealth: true, joinDate: true,
  position: { select: { title: true } },
  assignments: { where: { validTo: null }, orderBy: { validFrom: "desc" as const }, take: 1, select: { employmentStatus: true, baseSalary: true } },
} as const;

type MemberEmployee = {
  id: string;
  nationalId: string | null; fullName: string; gender: string; birthPlace: string | null;
  birthDate: Date | null; address: string | null; city: string | null;
  bpjsEmpSkill: string | null; bpjsHealth: string | null; joinDate: Date;
  position: { title: string } | null;
  // 28-c: baseSalary tersimpan sbg string terenkripsi (enc:v1:n:…).
  assignments: { employmentStatus: string; baseSalary: string | null }[];
};

const toMemberRow = (tc: FieldCrypto, mv: MoneyView, employeeNo: string, emp: MemberEmployee, positionFallback: string | null): BpjsMemberRow => ({
  employeeId: emp.id,
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
  // Task 55 — no. kartu BPJS tersimpan terenkripsi (Task 52-d) — dekripsi
  // di batas serializer; tanpa ini file upload BPJS berisi enc:v2:… mentah
  // (diterima sistem BPJS sebagai nomor kartu tidak sah). Legacy plaintext
  // diloloskan apa adanya oleh decryptText.
  bpjsTk: tc.decryptText(emp.bpjsEmpSkill),
  bpjsKes: tc.decryptText(emp.bpjsHealth),
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
 * KANTOR;STATUS KARYAWAN;JABATAN;TANGGAL MASUK;GAJI). KODE KANTOR diisi
 * dari PayrollRegulation aktif bpjsOfficeCode (P2.1-BM — null → kosong,
 * tidak error).
 */
function buildBpjsTkCsv(rows: BpjsMemberRow[], officeCode: string | null): string {
  const header = ["NO KTP", "NAMA", "TEMPAT LAHIR", "TANGGAL LAHIR", "NO BPJS KETENAGAKERJAAN", "KODE KANTOR", "STATUS KARYAWAN", "JABATAN", "TANGGAL MASUK", "GAJI"];
  const lines = [header.map(csvEscBpjs).join(";")];
  for (const r of rows) {
    lines.push([
      r.nik ?? "", r.fullName.toUpperCase(), r.birthPlace ?? "", ddmmyyyy(r.birthDate),
      r.bpjsTk ?? "", officeCode ?? "", tkStatusOf(r.employmentStatus), r.positionName ?? "",
      ddmmyyyy(r.joinDate), r.baseSalary,
    ].map(csvEscBpjs).join(";"));
  }
  return lines.join("\n") + "\n";
}

/**
 * CSV "Data Peserta" BPJS Kesehatan (pola sheet PESERTA e-Dabu v7.x) —
 * baris PEGAWAI lalu baris KELUARGA dependen ber-NIK per peserta (P2.1-BM).
 * KELAS PERAWATAN dari PayrollRegulation aktif bpjsInpatientClass (null →
 * kosong); NO kartu/alamat/status/jabatan/upah baris keluarga dibiarkan
 * kosong (identitas keluarga: NIK + NAMA + TANGGAL LAHIR + JENIS KELAMIN).
 */
function buildBpjsJknCsv(rows: BpjsMemberRow[], families: BpjsFamilyRow[], inpatientClass: string | null): string {
  const byEmployee = new Map<string, BpjsFamilyRow[]>();
  for (const f of families) {
    const arr = byEmployee.get(f.employeeNo) ?? [];
    arr.push(f);
    byEmployee.set(f.employeeNo, arr);
  }
  const header = ["NO", "NIK", "NO KARTU BPJS KESEHATAN", "NAMA PESERTA", "TANGGAL LAHIR", "JENIS KELAMIN (L/P)", "HUBUNGAN KELUARGA", "ALAMAT", "STATUS PEGAWAI", "JABATAN", "UPAH", "KELAS PERAWATAN"];
  const lines = [header.map(csvEscBpjs).join(";")];
  let no = 0;
  for (const r of rows) {
    lines.push([
      ++no, r.nik ?? "", r.bpjsKes ?? "", r.fullName.toUpperCase(), ddmmyyyy(r.birthDate),
      genderLP(r.gender), "Pegawai", [r.address, r.city].filter(Boolean).join(", "),
      jknStatusOf(r.employmentStatus), r.positionName ?? "", r.baseSalary, inpatientClass ?? "",
    ].map(csvEscBpjs).join(";"));
    // P2.1-BM — baris keluarga dependen mengikuti baris pesertanya.
    for (const f of byEmployee.get(r.employeeNo) ?? []) {
      lines.push([
        ++no, f.nik, "", f.fullName.toUpperCase(), ddmmyyyy(f.birthDate),
        genderLP(f.gender), f.hubkel, "", "", "", "", inpatientClass ?? "",
      ].map(csvEscBpjs).join(";"));
    }
  }
  return lines.join("\n") + "\n";
}

/** P2.1-BM — ActivityLog ekspor format LKS resmi + label format & statistik keluarga. */
async function logBpjsFormatExport(
  db: TenantDb,
  isTk: boolean,
  scope: string,
  count: number,
  familyCount: number,
  skipped: number,
  appUserId: string | null,
) {
  try {
    const label = isTk
      ? "LKS BPJS Ketenagakerjaan (unggah)"
      : "LKS BPJS Kesehatan (peserta+keluarga)";
    const familyNote = isTk
      ? ""
      : ` — ${familyCount} baris keluarga${skipped > 0 ? `, ${skipped} keluarga dilewati (NIK belum diisi)` : ""}`;
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "PayrollRun",
        ...(appUserId ? { appUserId } : {}),
        detail: `Ekspor file ${label} [format=${isTk ? "tk" : "jkn"}] ${scope} — ${count} peserta${familyNote}`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}

/** Klasifikasi program BPJS dari code+name (order matters: JPK/JKK/JKM/JKP sebelum JP). */
function basisOf(code: string, name: string): "JHT" | "JP" | "JKK" | "JKM" | "JKN" | "JKP" | null {
  const s = `${code} ${name}`.toUpperCase().replace(/\s+/g, "");
  if (s.includes("JHT")) return "JHT";
  if (s.includes("JPK") || s.includes("JKN") || s.includes("KESEHATAN")) return "JKN";
  if (s.includes("JKK")) return "JKK";
  if (s.includes("JKM")) return "JKM";
  // Task 52-c — JKP harus dicek SEBELUM JP ("JKP" memuat "KP", bukan "JP",
  // tapi urutan eksplisit menghindari salah klasifikasi varian penamaan).
  if (s.includes("JKP")) return "JKP";
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
    // P2.1-BM: alias lks-tk/lks-jkn (label menu baru) = tk/jkn.
    const uploadFormat = sp.get("format");
    if (uploadFormat === "tk" || uploadFormat === "jkn" || uploadFormat === "lks-tk" || uploadFormat === "lks-jkn") {
      const isTk = uploadFormat === "tk" || uploadFormat === "lks-tk";
      const now = new Date();
      const masterScope = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      let members: BpjsMemberRow[] = [];
      let participants: JknParticipant[] = [];
      let scope = masterScope;
      if (runId) {
        const run = await db.payrollRun.findUnique({
          where: { id: runId },
          include: {
            period: true,
            lines: {
              orderBy: { employeeNo: "asc" },
              // P2.1-BM: family dependen ikut ter-select utk baris KELUARGA (jkn).
              include: { employee: { select: { employeeNo: true, ...memberSelect, family: familySelect } } },
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
        const memberLines = run.lines.filter((l) => (isTk ? l.employee?.bpjsEmpSkill : l.employee?.bpjsHealth));
        members = memberLines.map((l) => toMemberRow(tc, mv, l.employeeNo, l.employee as MemberEmployee, l.positionName));
        participants = memberLines.map((l) => ({
          employeeNo: l.employeeNo,
          employeeName: l.employeeName,
          family: (l.employee as (MemberEmployee & { family?: MemberFamily[] }) | null)?.family ?? [],
        }));
      } else {
        const emps = await db.employee.findMany({
          where: isTk
            ? { status: "Active", bpjsEmpSkill: { not: null } }
            : { status: "Active", bpjsHealth: { not: null } },
          orderBy: { employeeNo: "asc" },
          select: { employeeNo: true, ...memberSelect, family: familySelect },
        });
        members = emps.map((e) => toMemberRow(tc, mv, e.employeeNo, e as MemberEmployee, null));
        participants = emps.map((e) => ({
          employeeNo: e.employeeNo,
          employeeName: e.fullName,
          family: (e as MemberEmployee & { family?: MemberFamily[] }).family ?? [],
        }));
      }

      // P2.1-BM — KODE KANTOR / KELAS PERAWATAN dari PayrollRegulation aktif
      // (null = belum dikonfigurasi → kolom kosong, TIDAK error).
      const regulation = await db.payrollRegulation.findFirst({
        where: { active: true },
        orderBy: { validFrom: "desc" },
        select: { bpjsOfficeCode: true, bpjsInpatientClass: true },
      });

      // P2.1-BM — baris KELUARGA (jkn saja; tk = peserta pegawai semata).
      const { familyRows, gaps } = isTk ? { familyRows: [], gaps: [] } : collectJknFamilies(tc, participants);

      const csv = isTk
        ? buildBpjsTkCsv(members, regulation?.bpjsOfficeCode ?? null)
        : buildBpjsJknCsv(members, familyRows, regulation?.bpjsInpatientClass ?? null);
      await logBpjsFormatExport(db, isTk, scope, members.length, familyRows.length, gaps.length, m.actor.appUserId);
      const company = await db.company.findFirst({ select: { code: true } });
      const tenant = (company?.code ?? "REKANKERJA").replace(/[^A-Za-z0-9]+/g, "");
      const filename = isTk
        ? `LKS_LaporanKepegawaian_BPJSTK_${tenant}_${scope}.csv`
        : `LKS_DataPeserta_BPJSKes_${tenant}_${scope}.csv`;
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
          // P2.1-BM: family dependen utk meta familyRows/gaps + sheet XLSX.
          include: { items: true, employee: { select: { nationalId: true, bpjsHealth: true, family: familySelect } } },
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
      const b: BpjsBuckets = { jhtC: 0, jhtE: 0, jpC: 0, jpE: 0, jkk: 0, jkm: 0, jknC: 0, jknE: 0, jkpC: 0, jkpE: 0 };
      for (const item of l.items) {
        if (item.wageType !== "Jamsostek") continue;
        const basis = basisOf(item.code, item.name);
        if (!basis) continue;
        // arah iuran: Earning = ditanggung perusahaan; Deduction = dipotong
        // dari pegawai (JKK/JKM/JKN/JKP-perusahaan tidak dipotong dari slip).
        const isCompany = item.type === "Earning";
        const key: keyof BpjsBuckets =
          basis === "JHT" ? (isCompany ? "jhtC" : "jhtE")
          : basis === "JP" ? (isCompany ? "jpC" : "jpE")
          : basis === "JKK" ? "jkk"
          : basis === "JKM" ? "jkm"
          : basis === "JKP" ? (isCompany ? "jkpC" : "jkpE")
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
        jkpCompany: r0(b.jkpC), jkpEmployee: r0(b.jkpE),
        totalCompany: r0(b.jhtC + b.jpC + b.jkk + b.jkm + b.jknC + b.jkpC),
        totalEmployee: r0(b.jhtE + b.jpE + b.jknE + b.jkpE),
      };
    });

    // P2.1-BM — keluarga peserta JKN run: baris LKS + daftar gap NIK.
    const { familyRows, gaps } = collectJknFamilies(
      tc,
      run.lines
        .filter((l) => l.employee?.bpjsHealth)
        .map((l) => ({ employeeNo: l.employeeNo, employeeName: l.employeeName, family: l.employee?.family ?? [] })),
    );

    const sum = (f: (r: BpjsRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totals = {
      employees: rows.length,
      jhtCompany: sum((r) => r.jhtCompany), jhtEmployee: sum((r) => r.jhtEmployee),
      jpCompany: sum((r) => r.jpCompany), jpEmployee: sum((r) => r.jpEmployee),
      jkk: sum((r) => r.jkk), jkm: sum((r) => r.jkm),
      jknCompany: sum((r) => r.jknCompany), jknEmployee: sum((r) => r.jknEmployee),
      jkpCompany: sum((r) => r.jkpCompany), jkpEmployee: sum((r) => r.jkpEmployee),
      totalCompany: sum((r) => r.totalCompany), totalEmployee: sum((r) => r.totalEmployee),
    };

    const meta = {
      runId: run.id,
      runNo: run.runNo,
      status: run.status,
      period: run.period.name,
      processType: run.processType.name,
      generatedAt: new Date().toISOString(),
      // F-01 BPA-AUDIT-53 — catatan informatif struktur iuran JKP PP 6/2025.
      jkpNote:
        "JKP (PP 6/2025 Ps.11): iuran 0,36% dari upah s.d. plafon = 0,22% ditanggung APBN + 0,14% rekomposisi iuran JKK yang telah dibayar perusahaan — tanpa potongan pekerja dan tanpa beban iuran baru perusahaan. Klaim manfaat saat PHK.",
      // P2.1-BM (D-BM16) — pratinjau baris KELUARGA file LKS JKN + gap NIK.
      familyRows: familyRows.length,
      familySkipped: gaps.length,
      gaps,
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
        { header: "JKP Rekomposisi JKK (0,14%)", width: 24 },
        { header: "JKP Pegawai (0% — PP 6/2025)", width: 22 },
        { header: "Total Perusahaan", width: 18 },
        { header: "Total Pegawai", width: 16 },
      ];
      const body = rows.map((r) => [
        r.nik ?? "", r.employeeNo, r.fullName, r.orgUnitName ?? "",
        r.jhtCompany, r.jhtEmployee, r.jpCompany, r.jpEmployee, r.jkk, r.jkm,
        r.jknCompany, r.jknEmployee, r.jkpCompany, r.jkpEmployee, r.totalCompany, r.totalEmployee,
      ]);
      body.push([
        "", "", `TOTAL (${rows.length} karyawan)`, "",
        totals.jhtCompany, totals.jhtEmployee, totals.jpCompany, totals.jpEmployee, totals.jkk, totals.jkm,
        totals.jknCompany, totals.jknEmployee, totals.jkpCompany, totals.jkpEmployee, totals.totalCompany, totals.totalEmployee,
      ]);
      // P2.1-BM — sheet "Gap NIK Keluarga" HANYA bila ada keluarga peserta
      // yang dilewati dari file LKS JKN karena NIK belum diisi.
      const sheets: ExportSheet[] = [{
        name: "Rekap BPJS",
        title: `Rekap Iuran BPJS — ${run.runNo} · ${run.period.name} · ${run.processType.name}`,
        columns,
        rows: body,
      }];
      if (gaps.length > 0) {
        sheets.push({
          name: "Gap NIK Keluarga",
          title: `Keluarga peserta BPJS Kesehatan tanpa NIK — dilewati dari file LKS (${gaps.length})`,
          columns: [
            { header: "No. Karyawan", width: 14 },
            { header: "Nama Karyawan", width: 28 },
            { header: "Nama Keluarga", width: 28 },
            { header: "Hubungan", width: 12 },
            { header: "Alasan", width: 22 },
          ],
          rows: gaps.map((g) => [g.employeeNo, g.employeeName, g.familyName, g.relation, g.reason]),
        });
      }
      const buf = await toXlsxMulti(sheets);
      await logExport(db, run.runNo, m.actor.appUserId, gaps.length);
      return xlsxResponse(buf, exportFilename("rekankerja-bpjs", "xlsx", run.runNo));
    }

    return NextResponse.json({ meta, rows, totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

async function logExport(db: TenantDb, runNo: string, appUserId: string | null, gapCount = 0) {
  try {
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "PayrollRun",
        ...(appUserId ? { appUserId } : {}),
        detail: `Ekspor XLSX rekap BPJS run ${runNo}${gapCount > 0 ? ` (termasuk sheet Gap NIK Keluarga — ${gapCount} baris)` : ""}`,
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}
