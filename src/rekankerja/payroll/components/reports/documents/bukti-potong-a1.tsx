"use client";
// ============================================================================
// RekanKerja Payroll — R2.2 BUKTI POTONG PPh PASAL 21 BAGI PEGAWAI TETAP ====
// Formulir DJP 1721-A1 — PER-14/PJ/2013 (struktur resmi, siap cetak A4) =====
// ============================================================================
// SUMBER STRUKTUR (diverifikasi langsung dari dokumen resmi DJP):
//   • Paket formulir SPT Masa PPh 21/26 PER-14/PJ/2013 dari pajak.go.id
//     (halaman "Formulir 1721-A1") — label baris, kode field (H.01–H.04,
//     A.01–A.12, C.01–C.03), kotak NOMOR "1.1-[masa].[yy]-[urut]" dan MASA
//     PEROLEHAN PENGHASILAN "m - mm" dipetakan 1:1 dari vektor PDF resmi.
//   • Manual e-Bupot 21/26 v1.4 DJP (hal. 24–26 & 44–45) — semantik pengisian.
//
// STRUKTUR FORMULIR RESMI:
//   Kop     : KEMENTERIAN KEUANGAN RI / DIREKTORAT JENDERAL PAJAK + kotak
//             judul + NOMOR (H.01) + MASA PEROLEHAN PENGHASILAN (H.02) +
//             NPWP PEMOTONG (H.03) + NAMA PEMOTONG (H.04).
//   Bag. A  : IDENTITAS PENERIMA PENGHASILAN YANG DIPOTONG (A.01–A.12) —
//             dua kolom: (1) NPWP, (2) NIK/No. Paspor, (3) Nama, (4) Alamat,
//             (5) Jenis Kelamin, (6) Status/Jumlah Tanggungan Keluarga utk
//             PTKP (K/TK/HB), (7) Nama Jabatan, (8) Karyawan Asing,
//             (9) Kode Negara Domisili.
//   Bag. B  : RINCIAN PENGHASILAN DAN PENGHITUNGAN PPh PASAL 21 — tabel
//             URAIAN × JUMLAH (Rp) + KODE OBJEK PAJAK 21-100-01/02;
//             PENGHASILAN BRUTO (1–8), PENGURANGAN (9–11), PENGHITUNGAN
//             PPh PASAL 21 (12–20).
//   Bag. C  : IDENTITAS PEMOTONG (C.01–C.03) + kotak TANGGAL & TANDA TANGAN.
//
// SEMANTIK NILAI (Manual e-Bupot 21/26 v1.4 DJP):
//   Baris 1–10: total SETAHUN / seluruh masa perolehan dari pemotong ini.
//   Baris 13  : penghasilan neto masa sebelumnya — HANYA pegawai pindahan
//               yang menggabungkan bukti potong pemberi kerja sebelumnya
//               (manual hal. 25 "Angka 14") → 0 untuk pegawai satu pemotong.
//   Baris 14  : 12 + 13 (Setahun; "Disetahunkan" hanya bila meninggalkan
//               Indonesia selamanya / meninggal dunia).
//   Baris 18  : PPh 21 yang dipotong pemotong INI pada masa-masa pajak
//               sebelumnya (bupot bulanan KOP 21-100-01/02, manual hal. 26).
//   Baris 19  : PPh 21 terutang masa pajak terakhir = 17 − 18 (true-up
//               Desember/berhenti — Pasal 14(5) PER-31/PJ/2012 jo. PMK
//               168/2023).
//   Baris 20  : PPh 21/26 yang telah dipotong dan dilunasi (realisasi SSP).
//
// TEMPLATE BINDING (padanan handlebars — utk engine PDF jsreport/dompdf/
// Puppeteer; backend menyuntik data via props — peta lengkap di kaki dokumen):
//   {{nomor_bukti}} ← data.formNo   {{masa_perolehan}} ← m - mm
//   {{npwp}} ← employee.npwp        {{nik}} ← employee.nik
//   {{employee_name}} ← employee.employeeName
//   {{ptkp_status}} ← employee.taxStatus   {{dependents}} ← jumlah PT
//   {{gross_income}} ← baris 8    {{pph21_terutang}} ← baris 19
// ============================================================================
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocMeta } from "../params";
import { PrintDoc, Confidentiality } from "../doc-kit";

export interface SptEmp {
  employeeNo: string; employeeName: string; orgUnitName: string | null; positionName: string | null;
  npwp: string | null; nik?: string | null; gender?: string | null; address?: string | null;
  taxStatus: string; ptkpAnnual: number; hasNpwp: boolean;
  gajiPokok: number; tunjanganPph: number; tunjanganLain: number; premiAsuransi: number;
  tantiemThr: number; biayaJabatan: number; iuranPensiun: number;
  neto: number; pkp: number; pph21Annual: number; taxWithheld: number; delta: number;
  monthFirst: number; monthLast: number; lastMonthBruto: number; lastMonthTax: number;
  priorNeto: number; priorTax: number;
}

export interface BuktiPotongPayload extends DocMeta {
  year: number;
  formNo: string;
  employee: SptEmp;
}

// ---------- helpers ----------

/** Format angka resmi formulir DJP: pemisah ribuan titik, TANPA "Rp". */
const numF = (v: number | null | undefined): string =>
  v == null ? "—" : new Intl.NumberFormat("id-ID").format(Math.round(v));

/** 15 digit → format NPWP resmi "xx.xxx.xxx.x-xxx.xxx". */
const fmtNpwp = (raw: string | null | undefined): string => {
  const d = (raw ?? "").replace(/\D+/g, "").slice(0, 15);
  if (d.length !== 15) return raw ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`;
};

/** Angka dalam kotak digit (gaya formulir DJP); separator (./-) tetap teks. */
function NumberCells({ value }: { value: string }) {
  return (
    <span className="inline-flex items-end gap-[1px]">
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span
            key={i}
            className="inline-flex h-[14px] w-[9px] items-center justify-center border border-slate-500 bg-white font-mono text-[9px] font-bold tabular-nums leading-none"
          >
            {ch}
          </span>
        ) : (
          <span key={i} className="px-[1.5px] text-[9.5px] font-bold leading-none">{ch}</span>
        ),
      )}
    </span>
  );
}

/** Kotak centang formulir. */
function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-[11px] w-[11px] shrink-0 items-center justify-center border border-slate-700 align-[-1px]",
        on && "bg-slate-800",
      )}
    >
      {on && <span className="text-[7px] font-black leading-none text-white">✓</span>}
    </span>
  );
}

/** Kode field formulir (A.01/H.01/C.03) — cetak kecil di sisi kanan field. */
const Code = ({ children }: { children: string }) => (
  <span className="w-[30px] shrink-0 text-right font-mono text-[8px] font-semibold leading-none text-slate-400">
    {children}
  </span>
);

/** Baris isian Bagian A: nomor + label + nilai di atas garis + kode field. */
function FieldLine({
  no, label, code, value,
}: { no: string; label: string; code: string; value?: ReactNode }) {
  return (
    <div className="flex items-end gap-1.5 py-[1.5px]">
      <span className="w-[15px] shrink-0 text-[9.5px] font-bold leading-[13.5px] tabular-nums">{no}</span>
      <span className="shrink-0 whitespace-nowrap text-[9.5px] font-semibold uppercase leading-[13.5px]">{label}</span>
      <span className="min-w-0 flex-1 truncate border-b border-slate-600 px-1 text-[10px] font-bold leading-[13.5px]">
        {value === undefined || value === null || value === "" ? <span className="text-slate-300">–</span> : value}
      </span>
      <Code>{code}</Code>
    </div>
  );
}

// ---------- dokumen ----------

/** Baris tabel Bagian B (label + jumlah Rp). */
function BRow({ no, label, value, strong }: { no: string; label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td className="w-[18px] border border-slate-600 px-[2px] py-[1.5px] text-center align-top text-[9px] font-bold tabular-nums">
        {no}
      </td>
      <td className={cn("border border-slate-600 px-1.5 py-[1.5px] align-top text-[9px] leading-[1.2]", strong && "font-bold")}>
        {label}
      </td>
      <td
        className={cn(
          "w-[50mm] border border-slate-600 px-1.5 py-[1.5px] text-right align-top text-[9.5px] tabular-nums",
          strong ? "font-extrabold" : "font-semibold",
        )}
      >
        {value}
      </td>
    </tr>
  );
}

/** Header kelompok Bagian B (PENGHASILAN BRUTO / PENGURANGAN / PENGHITUNGAN). */
function BGroup({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="border border-slate-600 px-1.5 py-[1.5px] text-[9px] font-extrabold">
        {label}
      </td>
      <td className="w-[50mm] border border-slate-600 bg-slate-50" />
    </tr>
  );
}

export function BuktiPotongA1Doc({ data }: { data: BuktiPotongPayload }) {
  const { t } = useI18n();
  const e = data.employee;
  const company = data.company;

  // --- identitas: status PTKP K/TK/HB + jumlah tanggungan ---
  const st = /^(TK|K|KI|HB)(\d)/.exec(e.taxStatus ?? "");
  const stLetter = st ? (st[1] === "KI" ? "K" : st[1]) : "TK"; // KI (penghasilan digabung) → K
  const dependents = st ? Math.min(3, parseInt(st[2], 10)) : 0;
  const isFemale = ["F", "P", "PEREMPUAN"].includes((e.gender ?? "M").toUpperCase());

  // --- Bagian B: baris 1–20 (semantik manual e-Bupot DJP) ---
  const r1 = e.gajiPokok, r2 = e.tunjanganPph, r3 = e.tunjanganLain;
  const r4 = 0, r5 = e.premiAsuransi, r6 = 0, r7 = e.tantiemThr; // honorarium & natura belum dipisah
  const r8 = r1 + r2 + r3 + r4 + r5 + r6 + r7;
  const r9 = e.biayaJabatan, r10 = e.iuranPensiun;
  const r11 = r9 + r10;
  const r12 = r8 - r11;
  const r13 = 0; // pegawai pindahan saja — Manual e-Bupot hal. 25 "Angka 14"
  const r14 = r12 + r13;
  const r15 = e.ptkpAnnual;
  const r16 = e.pkp;
  const r17 = e.pph21Annual;
  const r18 = e.priorTax;
  const r19 = Math.max(0, r17 - r18);
  const r20 = e.taxWithheld;

  // --- nomor & masa ---
  const masaFirst = e.monthFirst ?? e.monthLast ?? 12;
  const masaLast = e.monthLast ?? 12;
  const masaText = `${masaFirst} - ${String(masaLast).padStart(2, "0")}`;
  const printed = new Date(data.officer.printedAt);
  const dmy = `${String(printed.getDate()).padStart(2, "0")} - ${String(printed.getMonth() + 1).padStart(2, "0")} - ${printed.getFullYear()}`;

  return (
    <PrintDoc orientation="portrait">
      <div className="text-slate-900">
        {/* ============================ KOP FORMULIR ============================ */}
        <div className="flex items-stretch gap-2">
          {/* kiri: emblem + kementerian */}
          <div className="flex w-[46mm] shrink-0 items-start gap-2">
            <div className="flex h-[11mm] w-[9mm] shrink-0 items-center justify-center border border-slate-300 bg-slate-50 font-mono text-[6.5px] font-bold text-slate-400">
              DJP
            </div>
            <div className="min-w-0">
              <div className="text-[6px] italic text-slate-300">area staples</div>
              <div className="mt-[1px] text-[9.5px] font-bold uppercase leading-[1.15]">KEMENTERIAN KEUANGAN RI</div>
              <div className="text-[9.5px] font-bold uppercase leading-[1.15]">DIREKTORAT JENDERAL PAJAK</div>
            </div>
          </div>
          {/* tengah: kotak judul */}
          <div className="flex min-w-0 flex-1 items-center justify-center border-2 border-slate-800 px-2 py-[3px]">
            <div className="text-center text-[9.5px] font-extrabold uppercase leading-[1.3]">
              BUKTI PEMOTONGAN PAJAK PENGHASILAN
              <br />
              PASAL 21 BAGI PEGAWAI TETAP ATAU
              <br />
              PENERIMA PENSIUN ATAU TUNJANGAN HARI
              <br />
              TUA/JAMINAN HARI TUA BERKALA
            </div>
          </div>
          {/* kanan: kode formulir + lembar */}
          <div className="w-[42mm] shrink-0">
            <div className="text-right text-[12px] font-extrabold tracking-wide">FORMULIR 1721 - A1</div>
            <div className="mt-[2px] space-y-0 text-right text-[7px] leading-[1.15] text-slate-600">
              <div>Lembar ke-1 : untuk Penerima Penghasilan</div>
              <div>Lembar ke-2 : untuk Pemotong</div>
            </div>
          </div>
        </div>

        {/* ================= KOTAK MASA PEROLEHAN + NOMOR + PEMOTONG ================= */}
        <div className="mt-1.5 flex items-stretch gap-2">
          {/* kiri: NPWP & nama pemotong */}
          <div className="min-w-0 flex-1 border-2 border-slate-800 px-2.5 py-1">
            <div className="flex items-end gap-1.5">
              <span className="shrink-0 text-[9.5px] font-semibold uppercase">NPWP PEMOTONG :</span>
              <span className="min-w-0 flex-1">
                <NumberCells value={fmtNpwp(company?.taxId)} />
              </span>
              <Code>H.03</Code>
            </div>
            <div className="mt-[2px] flex items-end gap-1.5">
              <span className="shrink-0 text-[9.5px] font-semibold uppercase">NAMA PEMOTONG :</span>
              <span className="min-w-0 flex-1 truncate border-b border-slate-600 px-1 text-[10px] font-bold">
                {company?.name ?? "—"}
              </span>
              <Code>H.04</Code>
            </div>
          </div>
          {/* kanan: masa perolehan + nomor */}
          <div className="w-[62mm] shrink-0 border-2 border-slate-800">
            <div className="flex items-end gap-1 border-b border-slate-800 px-2 py-[2px]">
              <span className="text-[8px] font-semibold uppercase leading-[14px]">MASA PEROLEHAN PENGHASILAN</span>
            </div>
            <div className="flex items-end justify-between gap-1 px-2 py-[2px]">
              <NumberCells value={masaText} />
              <Code>H.02</Code>
            </div>
            <div className="flex items-end gap-1 border-t border-slate-800 px-2 py-[2px]">
              <span className="text-[9.5px] font-semibold uppercase leading-[14px]">NOMOR :</span>
              <NumberCells value={data.formNo} />
              <Code>H.01</Code>
            </div>
          </div>
        </div>

        {/* ================ A. IDENTITAS PENERIMA PENGHASILAN ==================== */}
        <section className="mt-1.5 border-2 border-slate-800">
          <div className="border-b border-slate-800 px-2.5 py-[2px] text-[9.5px] font-extrabold uppercase">
            A. IDENTITAS PENERIMA PENGHASILAN YANG DIPOTONG
          </div>
          <div className="grid grid-cols-2">
            {/* kolom kiri: 1–5 */}
            <div className="border-r border-slate-800 px-2.5 py-1">
              <FieldLine no="1." label="NPWP :" code="A.01" value={<NumberCells value={fmtNpwp(e.npwp)} />} />
              <FieldLine no="2." label="NIK /NO. PASPOR:" code="A.02" value={<span className="font-mono">{e.nik || ""}</span>} />
              <FieldLine no="3." label="NAMA :" code="A.03" value={e.employeeName.toUpperCase()} />
              <FieldLine no="4." label="ALAMAT:" code="A.04" value={e.address || ""} />
              <div className="flex items-end gap-1.5 py-[1.5px]">
                <span className="w-[15px] shrink-0 text-[9.5px] font-bold leading-[13.5px]">5.</span>
                <span className="shrink-0 whitespace-nowrap text-[9.5px] font-semibold uppercase leading-[13.5px]">JENIS KELAMIN :</span>
                <span className="flex items-center gap-3 text-[9.5px] font-semibold leading-[13.5px]">
                  <span className="flex items-center gap-1"><Box on={!isFemale} /> LAKI-LAKI</span>
                  <span className="flex items-center gap-1"><Box on={isFemale} /> PEREMPUAN</span>
                </span>
                <span className="flex-1 border-b border-slate-600" />
                <Code>A.05 / A.06</Code>
              </div>
            </div>
            {/* kolom kanan: 6–9 */}
            <div className="px-2.5 py-1">
              <div className="py-[1.5px]">
                <div className="flex items-end gap-1.5">
                  <span className="w-[15px] shrink-0 text-[9.5px] font-bold leading-[13.5px]">6.</span>
                  <span className="text-[9.5px] font-semibold uppercase leading-[13.5px]">
                    STATUS / JUMLAH TANGGUNGAN KELUARGA UNTUK PTKP
                  </span>
                </div>
                <div className="mt-[1px] flex items-end gap-4 pl-[19px] text-[9.5px] font-semibold">
                  <span className="flex items-end gap-1">K / <NumberCells value={stLetter === "K" ? String(dependents) : " "} /></span>
                  <span className="flex items-end gap-1">TK / <NumberCells value={stLetter === "TK" ? String(dependents) : " "} /></span>
                  <span className="flex items-end gap-1">HB / <NumberCells value={stLetter === "HB" ? String(dependents) : " "} /></span>
                </div>
                <div className="mt-[1px] flex items-end gap-1.5">
                  <span className="flex-1 border-b border-slate-600" />
                  <Code>A.07 / A.08 / A.09</Code>
                </div>
              </div>
              <FieldLine no="7." label="NAMA JABATAN :" code="A.10" value={(e.positionName ?? e.orgUnitName ?? "").toUpperCase()} />
              <div className="flex items-end gap-1.5 py-[1.5px]">
                <span className="w-[15px] shrink-0 text-[9.5px] font-bold leading-[13.5px]">8.</span>
                <span className="shrink-0 whitespace-nowrap text-[9.5px] font-semibold uppercase leading-[13.5px]">KARYAWAN ASING :</span>
                <span className="flex items-center gap-1 text-[9.5px] font-semibold leading-[13.5px]">
                  <Box on={false} /> YA
                </span>
                <span className="flex-1 border-b border-slate-600" />
                <Code>A.11</Code>
              </div>
              <FieldLine no="9." label="KODE NEGARA DOMISILI :" code="A.12" value="" />
            </div>
          </div>
        </section>

        {/* ========= B. RINCIAN PENGHASILAN DAN PENGHITUNGAN PPh PASAL 21 ========= */}
        <section className="mt-1.5 border-2 border-slate-800">
          <div className="border-b border-slate-800 px-2.5 py-[2px] text-[9.5px] font-extrabold">
            B. RINCIAN PENGHASILAN DAN PENGHITUNGAN PPh PASAL 21
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th colSpan={2} className="border border-slate-600 px-1.5 py-[1.5px] text-[9px] font-bold uppercase">
                  URAIAN
                </th>
                <th className="w-[50mm] border border-slate-600 px-1.5 py-[1.5px] text-[9px] font-bold uppercase">
                  JUMLAH (Rp)
                </th>
              </tr>
              <tr>
                <td colSpan={2} className="border border-slate-600 px-1.5 py-[1.5px] text-[9px]">
                  <span className="font-bold uppercase">KODE OBJEK PAJAK :</span>{" "}
                  <span className="ml-1 inline-flex items-center gap-1 text-[9px] font-semibold">
                    <Box on /> 21-100-01
                  </span>
                  <span className="ml-3 inline-flex items-center gap-1 text-[9px] font-semibold">
                    <Box on={false} /> 21-100-02
                  </span>
                  <span className="ml-2 text-[7.5px] italic text-slate-400">
                    (21-100-01 pegawai tetap · 21-100-02 penerima pensiun berkala)
                  </span>
                </td>
                <td className="w-[50mm] border border-slate-600 bg-slate-50" />
              </tr>
            </thead>
            <tbody>
              <BGroup label="PENGHASILAN BRUTO:" />
              <BRow no="1." label="GAJI/PENSIUN ATAU THT/JHT" value={numF(r1)} />
              <BRow no="2." label="TUNJANGAN PPh" value={numF(r2)} />
              <BRow no="3." label="TUNJANGAN LAINNYA, UANG LEMBUR DAN SEBAGAINYA" value={numF(r3)} />
              <BRow no="4." label="HONORARIUM DAN IMBALAN LAIN SEJENISNYA" value={numF(r4)} />
              <BRow no="5." label="PREMI ASURANSI YANG DIBAYAR PEMBERI KERJA" value={numF(r5)} />
              <BRow no="6." label="PENERIMAAN DALAM BENTUK NATURA DAN KENIKMATAN LAINNYA YANG DIKENAKAN PEMOTONGAN PPh PASAL 21" value={numF(r6)} />
              <BRow no="7." label="TANTIEM, BONUS, GRATIFIKASI, JASA PRODUKSI DAN THR" value={numF(r7)} />
              <BRow no="8." label="JUMLAH PENGHASILAN BRUTO (1 S.D.7)" value={numF(r8)} strong />
              <BGroup label="PENGURANGAN:" />
              <BRow no="9." label="BIAYA JABATAN/BIAYA PENSIUN" value={numF(r9)} />
              <BRow no="10." label="IURAN PENSIUN ATAU IURAN THT/JHT" value={numF(r10)} />
              <BRow no="11." label="JUMLAH PENGURANGAN (9 S.D.10)" value={numF(r11)} strong />
              <BGroup label="PENGHITUNGAN PPh PASAL 21:" />
              <BRow no="12." label="JUMLAH PENGHASILAN NETO (8 - 11)" value={numF(r12)} strong />
              <BRow no="13." label="PENGHASILAN NETO MASA SEBELUMNYA" value={numF(r13)} />
              <BRow no="14." label="JUMLAH PENGHASILAN NETO UNTUK PENGHITUNGAN PPh PASAL 21 (SETAHUN/DISETAHUNKAN)" value={numF(r14)} strong />
              <BRow no="15." label="PENGHASILAN TIDAK KENA PAJAK (PTKP)" value={numF(r15)} />
              <BRow no="16." label="PENGHASILAN KENA PAJAK SETAHUN/DISETAHUNKAN (14 - 15)" value={numF(r16)} strong />
              <BRow no="17." label="PPh PASAL 21 ATAS PENGHASILAN KENA PAJAK SETAHUN/DISETAHUNKAN" value={numF(r17)} strong />
              <BRow no="18." label="PPh PASAL 21 YANG TELAH DIPOTONG MASA SEBELUMNYA" value={numF(r18)} />
              <BRow no="19." label="PPh PASAL 21 TERUTANG" value={numF(r19)} strong />
              <BRow no="20." label="PPh PASAL 21 DAN PPh PASAL 26 YANG TELAH DIPOTONG DAN DILUNASI" value={numF(r20)} strong />
            </tbody>
          </table>
        </section>

        {/* ======================= C. IDENTITAS PEMOTONG ======================== */}
        <section className="mt-1.5 border-2 border-slate-800">
          <div className="border-b border-slate-800 px-2.5 py-[2px] text-[9.5px] font-extrabold uppercase">
            C. IDENTITAS PEMOTONG
          </div>
          <div className="grid grid-cols-[1fr_62mm]">
            <div className="px-2.5 py-1">
              <div className="flex items-end gap-1.5 py-[1.5px]">
                <span className="w-[15px] shrink-0 text-[9.5px] font-bold leading-[13.5px]">1.</span>
                <span className="shrink-0 text-[9.5px] font-semibold uppercase leading-[13.5px]">NPWP :</span>
                <span className="min-w-0 flex-1">
                  <NumberCells value={fmtNpwp(company?.taxId)} />
                </span>
                <Code>C.01</Code>
              </div>
              <div className="flex items-end gap-1.5 py-[1.5px]">
                <span className="w-[15px] shrink-0 text-[9.5px] font-bold leading-[13.5px]">2.</span>
                <span className="shrink-0 text-[9.5px] font-semibold uppercase leading-[13.5px]">NAMA :</span>
                <span className="min-w-0 flex-1 truncate border-b border-slate-600 px-1 text-[10px] font-bold">
                  {company?.name ?? "—"}
                </span>
                <Code>C.02</Code>
              </div>
              <div className="py-[1.5px] text-[7.5px] italic leading-snug text-slate-400">
                {[company?.address, company?.city].filter(Boolean).join(", ") || "— Alamat pemotong —"}
              </div>
            </div>
            <div className="border-l-2 border-slate-800 px-2.5 py-1">
              <div className="flex items-end justify-between gap-1">
                <span className="text-[9.5px] font-semibold uppercase">3. TANGGAL &amp; TANDA TANGAN</span>
                <Code>C.03</Code>
              </div>
              <div className="mt-[2px]">
                <NumberCells value={dmy} />
              </div>
              <div className="mt-1 h-[38px]" aria-label="Ruang tanda tangan pemotong" />
              <div className="border-t border-slate-500 pt-[2px] text-center text-[9px] font-bold">
                {data.officer.name}
              </div>
              <div className="text-center text-[7px] uppercase tracking-wide text-slate-500">
                {t("Pemotong PPh Pasal 21 / Payroll Officer", "PPh Article 21 Withholder / Payroll Officer")}
              </div>
            </div>
          </div>
        </section>

        {/* ================== PETA BINDING TEMPLATE (produksi) ================== */}
        <section className="rk-noprint mt-3 break-inside-avoid">
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
              {t("Peta binding template produksi (Handlebars — jsreport/dompdf/Puppeteer)", "Production template binding map (Handlebars — jsreport/dompdf/Puppeteer)")}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-5 gap-y-[2px] font-mono text-[8.5px] leading-snug text-slate-600 sm:grid-cols-3">
              <span>{"{{nomor_bukti}}"} ← {t("nomor 1.1-masa.yy-urut", "number 1.1-period.yy-seq")}</span>
              <span>{"{{masa_perolehan}}"} ← m - mm</span>
              <span>{"{{npwp_pemotong}}"} ← H.03</span>
              <span>{"{{nama_pemotong}}"} ← H.04</span>
              <span>{"{{npwp}}"} ← A.01</span>
              <span>{"{{nik}}"} ← A.02</span>
              <span>{"{{employee_name}}"} ← A.03</span>
              <span>{"{{address}}"} ← A.04</span>
              <span>{"{{jenis_kelamin}}"} ← A.05/A.06</span>
              <span>{"{{ptkp_status}}"} ← A.07–A.09</span>
              <span>{"{{nama_jabatan}}"} ← A.10</span>
              <span>{"{{karyawan_asing}}"} ← A.11</span>
              <span>{"{{gaji_pensiun}}"} ← 1</span>
              <span>{"{{tunjangan_pph}}"} ← 2</span>
              <span>{"{{tunjangan_lainnya}}"} ← 3</span>
              <span>{"{{premi_asuransi}}"} ← 5</span>
              <span>{"{{tantiem_thr}}"} ← 7</span>
              <span>{"{{gross_income}}"} ← 8</span>
              <span>{"{{biaya_jabatan}}"} ← 9</span>
              <span>{"{{iuran_pensiun}}"} ← 10</span>
              <span>{"{{neto}}"} ← 12</span>
              <span>{"{{neto_setahun}}"} ← 14</span>
              <span>{"{{ptkp}}"} ← 15</span>
              <span>{"{{pkp}}"} ← 16</span>
              <span>{"{{pph21_setahun}}"} ← 17</span>
              <span>{"{{pph21_dipotong_sebelumnya}}"} ← 18</span>
              <span>{"{{pph21_terutang}}"} ← 19</span>
              <span>{"{{pph21_dilunasi}}"} ← 20</span>
            </div>
          </div>
        </section>

        {/* ============================ CATATAN KAKI ============================ */}
        <p className="mt-1.5 text-[8px] italic leading-[1.3] text-slate-500">
          {t(
            "Formulir mengikuti struktur resmi PER-14/PJ/2013 (paket SPT Masa PPh 21/26 DJP) dengan semantik pengisian Manual e-Bupot 21/26 v1.4. Baris 1–10 = total setahun/seluruh masa perolehan; baris 13 hanya untuk pegawai pindahan yang menggabungkan bukti potong pemberi kerja sebelumnya; baris 19 = true-up masa pajak terakhir (17 − 18); baris 20 = realisasi dipotong & dilunasi. Iuran JKK/JKM/JPK/JKP perusahaan (bukan objek PPh 21 — PMK 16/PMK.03/2021) tidak termasuk bruto. Tahun pajak mengikuti bagian masa pada nomor bukti (1.1-mm.yy).",
            "The form follows the official PER-14/PJ/2013 structure (DJP SPT Masa PPh 21/26 package) with e-Bupot 21/26 v1.4 manual semantics. Rows 1–10 = annual totals for the whole income period; row 13 applies only to transferees merging a previous employer's withholding slip; row 19 = last-period true-up (17 − 18); row 20 = actual withheld & settled. Employer-paid JKK/JKM/JPK/JKP contributions (non-taxable per PMK 16/PMK.03/2021) are excluded from gross. The tax year follows the period digits in the slip number (1.1-mm.yy).",
          )}
        </p>
        <Confidentiality />
      </div>
    </PrintDoc>
  );
}
