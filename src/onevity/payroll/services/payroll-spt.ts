// OneVity Payroll SPT (P4) — rekap PPh21 tahunan (1721-A1) per karyawan.
// Sumber data: snapshot PayrollRunLine + PayrollRunItem dari semua run
// Confirmed/Paid pada tahun pajak (period.sptYear). Perhitungan:
//   bruto kena pajak setahun (Regular + Irregular)
//   − biaya jabatan (5%, cap 6 jt/thn)
//   − iuran JSTK pegawai (JHT/JP, deductible)
//   = neto setahun → − PTKP tahunan → PKP → progresif Pasal 17 setahun
//   vs PPh21 yang telah dipotong bulanan (taxR + taxI) → kurang/lebih bayar.
// 27-c: + buildEsptA1Csv — CSV semicolon 39 kolom VERIFIED terhadap Tabel 3.3
// "Detil Format Isian Sheet A1" Petunjuk Penggunaan Aplikasi e-Bupot 21/26
// v1.4 resmi DJP (static.pajak.go.id/download/bupot21/User_Manual_Ebupot2126.pdf,
// hal. 42–47): Template Impor Excel TAHUNAN = 5 sheet (Rekap · A1 · Ref Objek
// Pajak · Ref Kode Negara · Ref PTKP), sheet A1 39 kolom, file diunggah via menu
// Bukti Potong → Impor Data Bupot (maks 2 MB / 10.000 baris), masa pajak impor
// = masa pajak terakhir penerima. CSV ini kolomnya 1:1 dgn sheet A1 template →
// siap DITEMPEL (paste) ke template resmi tanpa re-format manual.
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { progressiveTax, EngineBracket } from "@/onevity/payroll/services/payroll-engine";
import { getBrackets, getActiveRegulation } from "@/onevity/payroll/services/payroll-service";

export interface SptEmployeeRow {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  orgUnitName: string | null;
  positionName: string | null;
  npwp: string | null;
  hasNpwp: boolean;
  taxStatus: string;
  ptkpAnnual: number;
  runs: number;
  incomeRegular: number;
  incomeIrregular: number;
  incomeNonTaxable: number;
  incomeFinal: number;
  brutoTaxable: number;
  biayaJabatan: number;
  iuranJstk: number;
  neto: number;
  pkp: number;
  pph21Annual: number;
  taxWithheld: number;
  delta: number; // > 0 kurang bayar, < 0 lebih bayar
  // ===== 27-c: data identitas + rincian per kolom template DJP (opsional —
  // hanya dipakai ekspor e-SPT; rekap internal tidak berubah) =====
  nik?: string | null;
  gender?: string | null;
  address?: string | null;
  // rincian kolom bruto template A1 (e-Bupot 21/26 v1.4 tabel 3.3):
  gajiPokok?: number; // Gaji/Pensiun (wageType BasicSalary)
  tunjanganPph?: number; // Tunjangan PPh (gross-up TAX_ALLOW)
  tunjanganLain?: number; // Tunjangan Lainnya/Uang Lembur + iuran JHT/JP perusahaan (objek pajak)
  premiAsuransi?: number; // Premi Asuransi dibayar Pemberi Kerja (JKK+JKM+JKN perusahaan)
  tantiemThr?: number; // Tantiem/Bonus/Gratifikasi/Jasa Produksi/THR (irregular)
  iuranPensiun?: number; // Iuran Pensiun/THT/JHT pegawai (JHT_E 2% + JP_E 1%)
  // masa pajak per pegawai (kolom 15/16 + bruto/neto/pajak masa terakhir vs sebelumnya):
  monthFirst?: number;
  monthLast?: number;
  lastMonthBruto?: number; // Penghasilan Bruto Masa Pajak Terakhir
  lastMonthTax?: number; // PPh21 dipotong pada masa pajak terakhir
  priorNeto?: number; // Penghasilan Neto Masa Pajak Sebelumnya
  priorTax?: number; // PPh21 dipotong masa-masa pajak sebelumnya
}

export interface SptReport {
  year: number;
  employees: SptEmployeeRow[];
  totals: {
    employees: number;
    brutoTaxable: number;
    biayaJabatan: number;
    iuranJstk: number;
    neto: number;
    pph21Annual: number;
    taxWithheld: number;
    delta: number;
  };
  regulation: { biayaJabatanRate: number; biayaJabatanCapAnnual: number };
}

const FINAL_METHODS = new Set(["FixedRateFinal", "SeveranceFinal", "PensionFinal", "Final2Years"]);

interface RunItemLike {
  code: string;
  name: string;
  wageType: string;
  type: string;
  incomeTaxMethod: string;
}

/** Basis program BPJS dari code+name (urutan: JPK/JKN/JKK/JKM sebelum JP). */
function jamsostekBasis(item: RunItemLike): string {
  const s = `${item.code} ${item.name}`.toUpperCase().replace(/\s+/g, "");
  if (s.includes("JHT")) return "JHT";
  if (s.includes("JPK") || s.includes("JKN") || s.includes("KESEHATAN")) return "JKN";
  if (s.includes("JKK")) return "JKK";
  if (s.includes("JKM")) return "JKM";
  if (s.includes("JP")) return "JP";
  return "";
}

/** Iuran pensiun/THT/JHT yang dibayar PEGAWAI (JHT_E 2% + JP_E 1%) — pengurang
 *  penghasilan neto (UU PPh 21(3)(a) huruf b; JKN pegawai BUKAN pengurang). */
function isIuranPensiun(item: RunItemLike): boolean {
  if (item.type !== "Deduction" || item.wageType !== "Jamsostek") return false;
  const basis = jamsostekBasis(item);
  return basis === "JHT" || basis === "JP";
}

/** Klasifikasi item earning → kolom bruto template A1 DJP (e-Bupot 21/26). */
function esptBucketOf(item: RunItemLike): "gaji" | "tunjPph" | "tunjLain" | "premi" | "irregular" | null {
  if (item.type !== "Earning") return null;
  if (item.wageType === "BasicSalary") return "gaji";
  if (item.wageType === "Jamsostek") {
    // JKK/JKM/JKN perusahaan = premi asuransi dibayar pemberi kerja (kolom 25);
    // JHT/JP perusahaan tetap objek pajak → masuk "Tunjangan Lainnya, dsb".
    const basis = jamsostekBasis(item);
    return basis === "JKK" || basis === "JKM" || basis === "JKN" ? "premi" : "tunjLain";
  }
  if (item.incomeTaxMethod === "Irregular") return "irregular"; // THR/bonus/gratifikasi
  const s = `${item.code} ${item.name}`.toUpperCase().replace(/\s+/g, "");
  if (s.includes("TAX_ALLOW") || s.includes("TUNJANGANPPH")) return "tunjPph"; // gross-up
  return "tunjLain"; // tunjangan reguler/lembur/imbalan lain
}

export async function buildAnnualSpt(db: TenantDb, year: number): Promise<SptReport> {
  const runs = await db.payrollRun.findMany({
    where: { status: { in: ["Confirmed", "Paid"] }, period: { sptYear: year } },
    include: {
      period: true, // 27-c: masa pajak (sptMonth) utk kolom Masa Penghasilan Awal/Akhir
      lines: {
        include: {
          items: true,
          employee: { include: { payrollProfile: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const [reg, brackets] = await Promise.all([getActiveRegulation(db), getBrackets(db)]);
  const biayaJabatanCapAnnual = reg.biayaJabatanCapMonthly * 12;

  const byEmp = new Map<string, SptEmployeeRow>();
  // 27-c: statistik per-masa-pajak per pegawai (bruto & PPh21 dipotong) utk
  // kolom "Masa Pajak Terakhir" vs "Masa Sebelumnya" pada template A1 DJP.
  const mstatsByEmp = new Map<string, { bruto: Map<number, number>; tax: Map<number, number>; neto: Map<number, number> }>();
  for (const run of runs) {
    const month = run.period?.sptMonth ?? 12;
    for (const line of run.lines) {
      let row = byEmp.get(line.employeeId);
      if (!row) {
        const profile = line.employee?.payrollProfile;
        row = {
          employeeId: line.employeeId,
          employeeNo: line.employeeNo,
          employeeName: line.employeeName,
          orgUnitName: line.orgUnitName,
          positionName: line.positionName,
          npwp: profile?.npwp ?? line.employee?.taxId ?? null,
          hasNpwp: profile?.hasNpwp ?? true,
          taxStatus: line.ptkpStatus,
          ptkpAnnual: line.ptkpValue,
          runs: 0,
          incomeRegular: 0,
          incomeIrregular: 0,
          incomeNonTaxable: 0,
          incomeFinal: 0,
          brutoTaxable: 0,
          biayaJabatan: 0,
          iuranJstk: 0,
          neto: 0,
          pkp: 0,
          pph21Annual: 0,
          taxWithheld: 0,
          delta: 0,
          // 27-c — identitas (utl kolom NIK/Alamat/Jenis Kelamin template A1):
          nik: line.employee?.nationalId ?? null,
          gender: line.employee?.gender ?? null,
          address: [line.employee?.address, line.employee?.city].filter(Boolean).join(", ") || null,
          gajiPokok: 0,
          tunjanganPph: 0,
          tunjanganLain: 0,
          premiAsuransi: 0,
          tantiemThr: 0,
          iuranPensiun: 0,
          monthFirst: month,
          monthLast: month,
          lastMonthBruto: 0,
          lastMonthTax: 0,
          priorNeto: 0,
          priorTax: 0,
        };
        byEmp.set(line.employeeId, row);
      }
      row.runs += 1;
      row.taxWithheld += line.taxRegular + line.taxIrregular;
      // PTKP: pakai snapshot terbaru (klasifikasi bisa berubah tengah tahun).
      row.ptkpAnnual = line.ptkpValue;
      row.taxStatus = line.ptkpStatus;
      if (month < (row.monthFirst ?? 12)) row.monthFirst = month;
      if (month > (row.monthLast ?? 1)) row.monthLast = month;

      let iuranJhtJpLine = 0; // iuran pensiun/JHT pegawai baris ini (pengurang neto pajak)
      for (const item of line.items) {
        if (item.type === "Earning") {
          if (item.incomeTaxMethod === "Regular") row.incomeRegular += item.amount;
          else if (item.incomeTaxMethod === "Irregular") row.incomeIrregular += item.amount;
          else if (FINAL_METHODS.has(item.incomeTaxMethod)) row.incomeFinal += item.amount;
          else row.incomeNonTaxable += item.amount;
          // 27-c — klasifikasi kolom bruto template A1 (e-Bupot 21/26 tabel 3.3):
          const bucket = esptBucketOf(item);
          if (bucket === "gaji") row.gajiPokok = (row.gajiPokok ?? 0) + item.amount;
          else if (bucket === "tunjPph") row.tunjanganPph = (row.tunjanganPph ?? 0) + item.amount;
          else if (bucket === "tunjLain") row.tunjanganLain = (row.tunjanganLain ?? 0) + item.amount;
          else if (bucket === "premi") row.premiAsuransi = (row.premiAsuransi ?? 0) + item.amount;
          else if (bucket === "irregular") row.tantiemThr = (row.tantiemThr ?? 0) + item.amount;
        } else if (item.type === "Deduction" && item.wageType === "Jamsostek") {
          row.iuranJstk += item.amount;
          if (isIuranPensiun(item)) {
            iuranJhtJpLine += item.amount;
            row.iuranPensiun = (row.iuranPensiun ?? 0) + item.amount;
          }
        }
      }
      // neto pajak masa ini = bruto (non-Jamsostek) − iuran JHT/JP pegawai
      // (zakat belum dilacak sebagai komponen terpisah — cek worklog 27-c).
      const lineNeto = line.bruto - iuranJhtJpLine;
      const mstats = mstatsByEmp.get(line.employeeId) ?? { bruto: new Map<number, number>(), tax: new Map<number, number>(), neto: new Map<number, number>() };
      mstats.bruto.set(month, (mstats.bruto.get(month) ?? 0) + line.bruto);
      mstats.tax.set(month, (mstats.tax.get(month) ?? 0) + line.taxRegular + line.taxIrregular);
      mstats.neto.set(month, (mstats.neto.get(month) ?? 0) + lineNeto);
      mstatsByEmp.set(line.employeeId, mstats);
    }
  }

  const employees = [...byEmp.values()].map((r) => {
    const brutoTaxable = Math.round(r.incomeRegular + r.incomeIrregular);
    const biayaJabatan = Math.round(Math.min(brutoTaxable * reg.biayaJabatanRate, biayaJabatanCapAnnual));
    const iuranJstk = Math.round(r.iuranJstk);
    const neto = brutoTaxable - biayaJabatan - iuranJstk;
    const pkp = Math.max(0, Math.floor((neto - r.ptkpAnnual) / 1000) * 1000);
    const pph21Annual = Math.round(progressiveTax(pkp, brackets as EngineBracket[], r.hasNpwp));
    // 27-c — pecahan masa terakhir vs sebelumnya (template A1 kolom 20/31/34):
    const ms = mstatsByEmp.get(r.employeeId);
    const last = r.monthLast ?? 12;
    const lastMonthBruto = Math.round([...(ms?.bruto.entries() ?? [])].filter(([m]) => m === last).reduce((s, [, v]) => s + v, 0));
    const lastMonthTax = Math.round([...(ms?.tax.entries() ?? [])].filter(([m]) => m === last).reduce((s, [, v]) => s + v, 0));
    const priorNeto = Math.round([...(ms?.neto.entries() ?? [])].filter(([m]) => m < last).reduce((s, [, v]) => s + v, 0));
    const priorTax = Math.round(r.taxWithheld - lastMonthTax);
    return {
      ...r, brutoTaxable, biayaJabatan, iuranJstk, neto, pkp, pph21Annual, delta: pph21Annual - Math.round(r.taxWithheld),
      gajiPokok: Math.round(r.gajiPokok ?? 0), tunjanganPph: Math.round(r.tunjanganPph ?? 0),
      tunjanganLain: Math.round(r.tunjanganLain ?? 0), premiAsuransi: Math.round(r.premiAsuransi ?? 0),
      tantiemThr: Math.round(r.tantiemThr ?? 0), iuranPensiun: Math.round(r.iuranPensiun ?? 0),
      lastMonthBruto, lastMonthTax, priorNeto, priorTax,
    };
  }).sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

  const totals = employees.reduce(
    (t, r) => ({
      employees: t.employees + 1,
      brutoTaxable: t.brutoTaxable + r.brutoTaxable,
      biayaJabatan: t.biayaJabatan + r.biayaJabatan,
      iuranJstk: t.iuranJstk + r.iuranJstk,
      neto: t.neto + r.neto,
      pph21Annual: t.pph21Annual + r.pph21Annual,
      taxWithheld: t.taxWithheld + r.taxWithheld,
      delta: t.delta + r.delta,
    }),
    { employees: 0, brutoTaxable: 0, biayaJabatan: 0, iuranJstk: 0, neto: 0, pph21Annual: 0, taxWithheld: 0, delta: 0 }
  );

  return { year, employees, totals, regulation: { biayaJabatanRate: reg.biayaJabatanRate, biayaJabatanCapAnnual } };
}

// =====================================================================================
// 27-c — e-SPT 1721-A1 (CSV DJP, siap tempel ke template impor resmi)
//
// Layout 39 kolom TERVERIFIKASI terhadap Tabel 3.3 manual resmi DJP e-Bupot
// 21/26 v1.4 (PDF: static.pajak.go.id/download/bupot21/User_Manual_Ebupot2126.pdf).
// Template Tahunan resmi = workbook Excel 5 sheet (Rekap, A1, Ref Daftar Objek
// Pajak, Ref Daftar Kode Negara, Ref Daftar PTKP); file disimpan dgn nama 15
// digit NPWP.xlsx, diunggah via Bukti Potong → Impor Data Bupot (maks 2 MB /
// 10.000 baris; khusus tahunan A1 masa pajak = masa pajak TERAKHIR penerima).
// CSV ini memuat label + data kolom sheet A1 1:1 → paste langsung ke template.
//
// Legacy e-SPT desktop (pre-e-Bupot, tahun pajak ≤2022): file 1721_bp_A1.csv
// 41 kolom (A–AO) dgn semantik sama (Masa Perolehan Awal/Akhir, Jumlah 1..20,
// Status Pindah, jenis kelamin M/F, masa pajak wajib Desember, nomor bukti
// 1.1-12.yy-0000001, kode pajak 21-100-01) — sumber: suluhpajak.wordpress.com
// (KP2KP) + ortax.org. Konvensi angka/tanggal identik dgn di bawah.
//
// Konvensi manual resmi: delimiter ";" · angka General TANPA tanda baca/pemisah
// ribuan · tanggal dd/mm/yyyy · NPWP 15 digit tanpa format/tanda baca · NIK 16
// digit · jenis kelamin L/P · status kawin TK/K/HB · kode PTKP "TK/0" ·
// fasilitas N/SKB/DTP.
// =====================================================================================

/** Label kolom persis template A1 e-Bupot 21/26 v1.4 (tabel 3.3 manual DJP). */
export const ESPT_A1_COLUMNS: string[] = [
  "No",
  "Tanggal Pemotongan (dd/mm/yyyy)",
  "Penerima Penghasilan? (NPWP/NIK)",
  "NPWP",
  "NIK",
  "Nama Penerima Penghasilan Sesuai NIK",
  "Alamat Penerima Penghasilan Sesuai NIK",
  "Jenis Kelamin (L/P)",
  "Status Kawin (TK/K/HB)",
  "Jumlah Tanggungan",
  "Nama Jabatan",
  "Karyawan Asing (Ya/Tidak)?",
  "Kode Negara",
  "Kode Objek Pajak",
  "Masa Penghasilan Awal",
  "Masa Penghasilan Akhir",
  "Penandatangan Menggunakan? (NPWP/NIK)",
  "NPWP Penandatangan",
  "NIK Penandatangan",
  "Penghasilan Bruto Masa Pajak Terakhir",
  "Gaji/Pensiun",
  "Tunjangan PPh",
  "Tunjangan Lainnya, Uang Lembur, dsb",
  "Honorarium dan Imbalan Lainnya",
  "Premi Asuransi dibayar Pemberi Kerja",
  "Penerimaan Natura dan Kenikmatan Lainnya",
  "Tantiem, Bonus, Gratifikasi, Jasa Produksi, THR",
  "Biaya Jabatan",
  "Iuran Pensiunan THT JHT",
  "Zakat/Sumbangan Keagamaan yang dibayar Pemberi Kerja",
  "Penghasilan Neto Masa Pajak Sebelumnya",
  "Perhitungan Jumlah Penghasilan Neto? (Setahun/Disetahunkan)",
  "Kode PTKP",
  "PPh Pasal 21 yang telah dipotong masa pajak sebelumnya",
  "PPh Pasal 21 DTP yang telah dipotong masa pajak sebelumnya",
  "PPh Pasal 21 yang telah dipotong dan dilunasi pada selain masa pajak terakhir",
  "PPh Pasal 21 DTP yang telah dipotong dan dilunasi pada selain masa pajak terakhir",
  "Mendapatkan Fasilitas? (N/SKB/DTP)",
  "Nomor DTP",
];

/** Konteks pemotong (perusahaan) utk kolom Penandatangan template A1. */
export interface EsptA1Context {
  tenantCode: string;
  companyName: string;
  companyNpwp: string | null;
}

const digitsOnly = (s: string | null | undefined): string => (s ?? "").replace(/\D+/g, "");

/** PTKP "K2"/"TK0"/"KI1" → { kawin: "K"|"TK", tanggungan: 0..3, kode: "K/2"|"K/I/1" }. */
function ptkpParts(taxStatus: string): { kawin: "TK" | "K" | "HB"; tanggungan: number; kode: string } {
  const m = /^(TK|K|KI)(\d)/.exec(taxStatus ?? "");
  const prefix = m ? m[1] : "TK";
  const dep = m ? Math.min(3, Math.max(0, parseInt(m[2], 10))) : 0;
  // KI (kawin, penghasilan digabung) → status kawin "K"; kode PTKP "K/I/n"
  // (format Ref Daftar PTKP e-Bupot: TK/n, K/n, K/I/n).
  const kawin: "TK" | "K" | "HB" = prefix === "TK" ? "TK" : "K";
  const kode = prefix === "KI" ? `K/I/${dep}` : `${prefix}/${dep}`;
  return { kawin, tanggungan: dep, kode };
}

const ddmmYYYY = (d: Date): string =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** Nilai CSV aman — quote hanya bila mengandung ; " atau newline (RFC 4180). */
const csvEsc = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Susun CSV semicolon 39 kolom template A1 DJP dari rekap SPT tahunan.
 * Baris 1 = header label resmi (Tabel 3.3 manual e-Bupot 21/26 v1.4);
 * baris berikut = 1 pegawai per baris. Kolom 34 & 36 sama-sama diisi PPh21
 * masa sebelumnya (kolom 36 = "dipotong DAN DILUNASI pada selain masa pajak
 * terakhir" — utk pemotong patuh sama dgn kolom 34); PPh21 masa terakhir
 * BUKAN kolom template (aplikasi e-Bupot menghitungnya dari data masa terakhir).
 */
export function buildEsptA1Csv(report: SptReport, ctx: EsptA1Context): string {
  const year = report.year;
  const companyNpwp15 = digitsOnly(ctx.companyNpwp).slice(0, 15);
  const lines: string[] = [ESPT_A1_COLUMNS.map(csvEsc).join(";")];

  report.employees.forEach((r, i) => {
    const ptkp = ptkpParts(r.taxStatus);
    const npwp15 = digitsOnly(r.npwp).slice(0, 15);
    // Penerima ber-NPWP bila nomor valid & hasNpwp; selain itu identitas NIK.
    const useNpwp = r.hasNpwp && npwp15.length === 15;
    // Tanggal pemotongan = akhir bulan masa pajak terakhir (Desember utk
    // pegawai setahun penuh; bulan berhenti bila masa kerja < setahun — PMK
    // 168/2023 "masa pajak terakhir").
    const last = r.monthLast ?? 12;
    const tanggal = new Date(Date.UTC(year, last, 0)); // hari terakhir bulan `last`
    const gender = (r.gender ?? "M") === "F" ? "P" : "L";
    const row = [
      i + 1, // No
      ddmmYYYY(tanggal), // Tanggal Pemotongan
      useNpwp ? "NPWP" : "NIK", // Penerima Penghasilan?
      useNpwp ? npwp15 : "", // NPWP
      r.nik ?? "", // NIK
      r.employeeName, // Nama
      r.address ?? "", // Alamat
      gender, // Jenis Kelamin L/P
      ptkp.kawin, // Status Kawin
      ptkp.tanggungan, // Jumlah Tanggungan
      r.positionName ?? "", // Nama Jabatan
      "Tidak", // Karyawan Asing (tidak ada data expat — semua WNI)
      "", // Kode Negara (kosong utk WNI)
      "21-100-01", // Kode Objek Pajak (pegawai tetap swasta)
      r.monthFirst ?? last, // Masa Penghasilan Awal
      last, // Masa Penghasilan Akhir
      "NPWP", // Penandatangan Menggunakan? (pemotong = perusahaan)
      companyNpwp15, // NPWP Penandatangan
      "", // NIK Penandatangan
      Math.round(r.lastMonthBruto ?? 0), // Penghasilan Bruto Masa Pajak Terakhir
      Math.round(r.gajiPokok ?? 0), // Gaji/Pensiun
      Math.round(r.tunjanganPph ?? 0), // Tunjangan PPh
      Math.round(r.tunjanganLain ?? 0), // Tunjangan Lainnya, Uang Lembur, dsb
      0, // Honorarium dan Imbalan Lainnya (belum dipisah — lihat worklog)
      Math.round(r.premiAsuransi ?? 0), // Premi Asuransi dibayar Pemberi Kerja
      0, // Penerimaan Natura dan Kenikmatan Lainnya (belum dipisah)
      Math.round(r.tantiemThr ?? 0), // Tantiem/Bonus/Gratifikasi/Jasa Produksi/THR
      Math.round(r.biayaJabatan), // Biaya Jabatan
      Math.round(r.iuranPensiun ?? 0), // Iuran Pensiunan THT JHT
      0, // Zakat/Sumbangan Keagamaan (belum dipisah — lihat worklog)
      Math.round(r.priorNeto ?? 0), // Penghasilan Neto Masa Pajak Sebelumnya
      "Setahun", // Perhitungan Jumlah Penghasilan Neto
      ptkp.kode, // Kode PTKP (TK/0, K/1, K/I/2 — format Ref Daftar PTKP)
      Math.round(r.priorTax ?? 0), // PPh21 dipotong masa pajak sebelumnya
      0, // PPh21 DTP dipotong masa pajak sebelumnya
      Math.round(r.priorTax ?? 0), // PPh21 dipotong & dilunasi pada SELAIN masa pajak terakhir (= masa sebelumnya)
      0, // PPh21 DTP dipotong & dilunasi pada selain masa pajak terakhir
      "N", // Mendapatkan Fasilitas? (N/SKB/DTP)
      "", // Nomor DTP
    ];
    lines.push(row.map(csvEsc).join(";"));
  });

  return lines.join("\n") + "\n";
}
