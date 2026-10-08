// RekanKerja Payroll — ADAPTER DATA → JRXML SPT 1721-A1 (engine iReport) ====
// ============================================================================
// Menerjemahkan baris rekap tahunan buildAnnualSpt() ke format data template
// JRXML DJP (vendor/jasper/templates/SPT1721A1.jrxml — template asli era
// e-Bupot PER-14/PJ/2013 jo. revisi DTP, TIDAK diubah layout-nya; hanya diisi
// data, sesuai instruksi pemakaian engine iReport/JasperReports).
//
// FORMAT DATA (dibaca JasperRunner.java di vendor/jasper):
//   - satu baris teks UTF-8 = satu record DETAIL template;
//   - kolom dipisah karakter \u0001 (SOH) — tak mungkin muncul di data asli;
//   - URUTAN KOLOM = FIELD_ORDER di bawah — WAJIB identik dengan FIELD_ORDER
//     di vendor/jasper/JasperRunner.java (single source of truth dua arah);
//   - field uang = angka polos (Double.parseDouble), TANPA pemisah.
//
// STRUKTUR TEMPLATE (lihat scripts/jrxml-map.txt hasil parsing):
//   group iEmployeeId+"^"+iPeriodFrom, isStartNewPage → 1 halaman folio
//   (612×936pt) per karyawan; seluruh form digambar di groupFooter.
//   Baris bruto 1/3/4/5/6/7 + pengurang 10/11 = VARIABEL penjumlahan detail
//   per group: variabel menjumlah $F{iNominalAmount} WHERE $F{iSPTReference}
//   = kode baris ("1".."8") → tiap karyawan dipecah menjadi beberapa record
//   detail (satu per komponen penghasilan), membawa field identitas yang sama.
//
// SEMANTIK PENGISIAN (manual e-Bupot 21/26 v1.4 + template):
//   ref 1 = Gaji/Pensiun · ref 2 = Tunjangan lain/lembur · ref 3 = Honorarium
//   · ref 4 = Premi asuransi pemberi kerja · ref 5 = Natura · ref 6 = THR/
//   tantiem/bonus · ref 7 = Iuran pensiun/THT/JHT/JP pegawai · ref 8 = Zakat.
//   iD2 (baris 2 Tunjangan PPh) = field langsung. iD10 = biaya jabatan,
//   iD11 = 0 (baris 9 template = $F{iD10}+$F{iD11}; iuran pensiun masuk via
//   ref 7 agar baris 10 & 12 terhitung). Baris 14 (neto masa sebelumnya) = 0
//   untuk pegawai satu pemotong (baris 1-13 sudah setahun penuh — Manual
//   e-Bupot hal. 25 "Angka 14"). Baris 21 = $F{iD21}-$F{iD20} → iD21 diisi
//   PPh setahun, iD20 dipotong Jan-(n-1). Baris 22a (iInsGov="N") =
//   $F{iTaxBefore} = potongan AKTUAL masa terakhir → baris 23 kurang/lebih
//   bayar = iD21-iD20-iTaxBefore = pph21Annual - totalTaxWithheld = delta
//   (konsisten kolom delta rekap SPT modul ini).
// ============================================================================
import type { SptEmployeeRow } from "@/rekankerja/payroll/services/payroll-spt";
import { npwp15 } from "@/rekankerja/payroll/services/payroll-spt";

/** Kolom data.txt — MIRROR vendor/jasper/JasperRunner.java FIELD_ORDER. */
export const JR_A1_FIELD_ORDER: readonly string[] = [
  "iEmployeeId", "iSequenceNo", "iCompanyCompulsionNo", "iEmployeeName",
  "iCompanyAddress", "iCompanyName", "iEmployeeCompulsionNo", "iSptYear",
  "iEmployeeAddress", "iPosition", "iPtkpStatus", "iGender",
  "iCitizenship", "iD2", "iD10", "iD11", "iD15", "iD16", "iD17",
  "iD19", "iD20", "iD21", "iD22", "iLeaderName", "iCityOfSign",
  "iWageType", "iNominalAmount", "iTaxMethod", "iDeductionType",
  "iPaidNetTax", "iPaidGrossTax", "iParameterValue", "iD26", "iD26a",
  "iLeaderNPWP", "iIncomePeriod", "iBasicIncome", "iPeriodFrom",
  "iPeriodTo", "iAdjNet", "iAdjGross", "iD18", "iSPTReference", "iID",
  "iDate", "iPic", "iTaxBefore", "iNITKU", "iCompanyNITKU", "iInsGov",
] as const;

const SEP = "\u0001";

/** Konteks pemotong + penanda tangan (Bagian C form). */
export interface JrA1Context {
  companyName: string;
  companyNpwp: string | null; // tampil apa adanya (format titik) di header
  companyAddress: string;
  companyCity: string;
  signerName: string;
}

/** Bersihkan nilai dari karakter yang merusak format data.txt (TANPA trim). */
function san(v: string | null | undefined): string {
  return (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
}

const digitsOf = (s: string | null | undefined): string =>
  (s ?? "").replace(/\D+/g, "");

/** NPWP 15 digit mentah → format resmi xx.xxx.xxx.x-xxx.xxx (null → ""). */
export function fmtNpwp15(v: string | null | undefined): string {
  const d = digitsOf(v);
  if (d.length !== 15) return "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`;
}

/** NPWP penanda tangan — template memotong substring(0..15): WAJIB tepat 15
 *  karakter (12 digit inti dinormalisasi +000; invalid → 15 nol). */
function leaderNpwp15(v: string | null | undefined): string {
  return npwp15(v).padStart(15, "0");
}

/** Status PTKP tersimpan ("TK0","K2","KI1","HB0") → kode kotak template:
 *  K/TK/HB + jumlah tanggungan (KI = kawin penghasilan digabung → K). */
function ptkpCode(taxStatus: string | null | undefined): string {
  const m = /^(KI|TK|K|HB)(\d)/.exec((taxStatus ?? "").trim().toUpperCase());
  if (!m) return "TK0";
  const dep = Math.min(9, Math.max(0, parseInt(m[2], 10) || 0));
  const prefix = m[1] === "KI" ? "K" : m[1];
  return `${prefix}${dep}`;
}

/** Gender "M"/"F" → kode template: "2" = LAKI-LAKI, "1" = PEREMPUAN. */
function genderCode(g: string | null | undefined): string {
  return ["F", "P", "PEREMPUAN", "W"].includes((g ?? "M").toUpperCase()) ? "1" : "2";
}

/** Kode komponen → iSPTReference (baris bruto template). */
interface RefBucket { ref: string; amount: number }

/**
 * Susun isi data.txt untuk JasperRunner.
 * @param employees baris rekap tahunan (dari buildAnnualSpt, sudah lewat gerbang MoneyView)
 * @param year tahun pajak
 * @param ctx identitas pemotong + penanda tangan
 * @returns string siap ditulis ke file data.txt
 */
export function buildJrA1DataLines(
  employees: SptEmployeeRow[],
  year: number,
  ctx: JrA1Context,
): string {
  const yy = String(year).slice(-2);
  const lines: string[] = [];

  for (const e of employees) {
    const monthLast = e.monthLast ?? 12;
    const monthFirst = Math.min(e.monthFirst ?? monthLast, monthLast);
    // Nomor bukti potong — konvensi e-SPT DJP "1.1-mm.yy-urut7" (masa = bulan
    // terakhir; urut = nomor karyawan 7 digit).
    const urut7 = (e.employeeNo.replace(/\D/g, "") || "1").padStart(7, "0");
    const formNo = `1.1-${String(monthLast).padStart(2, "0")}.${yy}-${urut7}`;
    // Tanggal pemotongan = hari terakhir bulan masa terakhir.
    const lastDay = new Date(Date.UTC(year, monthLast, 0));
    const iDate = `${String(lastDay.getUTCDate()).padStart(2, "0")}/${String(monthLast).padStart(2, "0")}/${year}`;

    // NPWP karyawan: 12 digit inti dinormalisasi +000 → 15 digit resmi; valid +
    // hasNpwp → format titik; selain itu 15 spasi → template mencetak "-".
    const emp15 = npwp15(e.npwp);
    const employeeNpwp = e.hasNpwp && emp15 ? fmtNpwp15(emp15) : "               ";

    // Komponen detail per baris bruto (ref 1..8; hanya nilai ≠ 0).
    const buckets: RefBucket[] = [
      { ref: "1", amount: Math.round(e.gajiPokok ?? 0) },
      { ref: "2", amount: Math.round(e.tunjanganLain ?? 0) },
      { ref: "4", amount: Math.round(e.premiAsuransi ?? 0) },
      { ref: "6", amount: Math.round(e.tantiemThr ?? 0) },
      { ref: "7", amount: Math.round(e.iuranPensiun ?? 0) },
    ].filter((b) => b.amount !== 0);
    if (buckets.length === 0) buckets.push({ ref: "1", amount: 0 }); // minimal 1 baris agar group ter-render
    // TERMINATOR — baris terakhir ref "" bernilai 0: variabel turunan (iD7,
    // iD9, iD13, iD14…) dievaluasi per-record DALAM URUTAN DEKLARASI template
    // (iD13 dideklarasikan sebelum variabel sum iD10/iD11) — tanpa baris ini
    // evaluasi terakhir iD13 terjadi sebelum kontribusi ref 7/8 terakhir
    // masuk sum (baris 12 kehilangan iuran pensiun). Baris kosong memaksa
    // evaluasi ulang SEMUA variabel saat seluruh sum sudah final.
    buckets.push({ ref: "", amount: 0 });

    for (const b of buckets) {
      const values: Record<string, string> = {
        iEmployeeId: e.employeeId,
        iSequenceNo: formNo,
        iCompanyCompulsionNo: fmtNpwp15(npwp15(ctx.companyNpwp)) || "00.000.000.0-000.000",
        iEmployeeName: e.employeeName,
        iCompanyAddress: ctx.companyAddress,
        iCompanyName: ctx.companyName,
        iEmployeeCompulsionNo: employeeNpwp, // 15 spasi → template cetak "-"
        iSptYear: String(year),
        iEmployeeAddress: e.address ?? "",
        iPosition: e.positionName ?? "",
        iPtkpStatus: ptkpCode(e.taxStatus),
        iGender: genderCode(e.gender),
        iCitizenship: "IDN", // WNI → kotak "Karyawan Asing" kosong
        iD2: String(Math.round(e.tunjanganPph ?? 0)),
        iD10: String(Math.round(e.biayaJabatan)), // baris 9 biaya jabatan
        iD11: "0",
        iD15: "0", // baris 14 neto masa sebelumnya (pegawai 1 pemotong)
        iD16: String(Math.round(e.neto)), // baris 15 neto setahun
        iD17: String(Math.round(e.ptkpAnnual)), // baris 16 PTKP
        iD19: String(Math.round(e.pph21Annual)), // baris 18 PPh setahun
        iD20: String(Math.round(e.priorTax ?? 0)), // baris 19 dipotong sebelumnya
        iD21: String(Math.round(e.pph21Annual)), // baris 21 = iD21-iD20 = terutang masa terakhir
        iD22: "0",
        iLeaderName: ctx.signerName,
        iCityOfSign: ctx.companyCity,
        iWageType: "",
        iNominalAmount: String(b.amount), // ← nilai baris ini (per ref)
        iTaxMethod: "",
        iDeductionType: "",
        iPaidNetTax: "0",
        iPaidGrossTax: "0",
        iParameterValue: "0",
        iD26: "",
        iD26a: "0",
        iLeaderNPWP: leaderNpwp15(ctx.companyNpwp),
        iIncomePeriod: "",
        iBasicIncome: "",
        iPeriodFrom: String(monthFirst).padStart(2, "0"),
        iPeriodTo: String(monthLast).padStart(2, "0"),
        iAdjNet: "0",
        iAdjGross: "0",
        iD18: String(Math.round(e.pkp)), // baris 17 PKP (field, bukan variabel)
        iSPTReference: b.ref,
        iID: e.nik ?? "", // NIK
        iDate, // dd/MM/yyyy — ttd bagian C
        iPic: "", // base64 tanda tangan (opsional — disembunyikan template)
        iTaxBefore: String(Math.round(e.lastMonthTax ?? 0)), // baris 22a
        iNITKU: "",
        iCompanyNITKU: "",
        iInsGov: "N", // tanpa DTP → baris 20/22b/23b nol
      };
      lines.push(JR_A1_FIELD_ORDER.map((f) => san(values[f])).join(SEP));
    }
  }

  return lines.join("\n") + "\n";
}
