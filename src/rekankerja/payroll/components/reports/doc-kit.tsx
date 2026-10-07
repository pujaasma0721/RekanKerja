"use client";
// RekanKerja Payroll — KERANGKA DOKUMEN CETAK (print/PDF-ready) =============
// Primitif bersama seluruh dokumen laporan payroll:
//   PrintDoc      — kertas + @page orientation (A4 portrait/landscape) + CSS
//                   cetak (hanya #rk-print-area yang tercetak).
//   DocHeader     — kop: placeholder logo, nama perusahaan, NPWP, cabang +
//                   judul tegas + blok metadata (Periode Penggajian, Tanggal
//                   Transfer/Cut-off, Tanggal Dicetak, Nama Payroll Officer).
//   TotalBand     — baris grand total (Total Gross/Deductions/Net/PPh21...).
//   SignOff       — blok persetujuan 3 pihak (Payroll → Finance Manager →
//                   Direktur) + opsi sign-off bank (R1.3).
//   Confidentiality — "SANGAT RAHASIA - DOKUMEN KEUANGAN (STRICTLY
//                   CONFIDENTIAL)".
// Dokumen selalu di-render di atas "kertas" putih (terangkah tema aplikasi)
// agar cetak/PDF konsisten — warna aksen pakai print-color-adjust: exact.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmtIDR, initials } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import type { DocCompany, DocMeta } from "./params";

// ---------- format helpers ----------

export const money = (v: number | null | undefined): string => (v == null ? "—" : fmtIDR(v));
export const num = (v: number | null | undefined): string => (v == null ? "—" : new Intl.NumberFormat("id-ID").format(v));
export const pct1 = (v: number | null | undefined): string =>
  v == null ? "—" : `${v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const minutesLabel = (m: number): string => {
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} jam` : h === 0 ? `${r} menit` : `${h} jam ${r} menit`;
};
const fmtDateLongId = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(d);
};
const fmtDateId = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

// ---------- kertas + area cetak ----------

export function PrintDoc({ orientation, children }: { orientation: "portrait" | "landscape"; children: ReactNode }) {
  return (
    <div id="rk-print-area" className="rk-print-doc">
      <style>{`
        @media print {
          @page { size: A4 ${orientation}; margin: 10mm; }
          body * { visibility: hidden !important; }
          #rk-print-area, #rk-print-area * { visibility: visible !important; }
          #rk-print-area {
            position: absolute !important; left: 0; top: 0; width: 100% !important;
            max-width: 100% !important; margin: 0 !important; padding: 0 !important;
            box-shadow: none !important; border: none !important; border-radius: 0 !important;
          }
          .rk-noprint { display: none !important; }
          .rk-doc-scroll { overflow: visible !important; }
          #rk-print-area, #rk-print-area * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="mx-auto w-full max-w-[210mm] bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 print:shadow-none print:ring-0">
        <div className="px-8 py-7 text-[12px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

// ---------- kop dokumen ----------

export function DocHeader({
  company, title, subtitle, reportNo, meta,
}: {
  company: DocCompany | null;
  title: string;
  subtitle?: string;
  reportNo?: string;
  meta: { label: string; value: ReactNode }[];
}) {
  return (
    <header className="border-b-2 border-slate-800 pb-4">
      <div className="flex items-start justify-between gap-6">
        {/* kiri: logo placeholder + identitas perusahaan */}
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-dashed border-slate-400 bg-slate-50 text-base font-bold tracking-wide text-slate-500"
          >
            {initials(company?.name ?? "LOGO")}
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold uppercase leading-tight tracking-wide">
              {company?.name ?? "— Nama Perusahaan —"}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              NPWP Perusahaan: <span className="font-semibold text-slate-800">{company?.taxId ?? "—"}</span>
            </div>
            <div className="text-[11px] text-slate-600">
              {[company?.address, company?.city].filter(Boolean).join(", ") || "— Alamat / Cabang —"}
              {company?.city ? ` · Cabang: ${company.city}` : ""}
            </div>
          </div>
        </div>
        {/* kanan: judul laporan */}
        <div className="shrink-0 text-right">
          {reportNo && <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{reportNo}</div>}
          <h1 className="mt-0.5 max-w-[90mm] text-lg font-extrabold uppercase leading-snug tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && <div className="mt-0.5 max-w-[90mm] text-[11px] font-medium text-slate-600">{subtitle}</div>}
        </div>
      </div>
      {/* blok metadata */}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md bg-slate-50 px-4 py-3 ring-1 ring-slate-200 md:grid-cols-4">
        {meta.map((m) => (
          <div key={m.label} className="min-w-0">
            <dt className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">{m.label}</dt>
            <dd className="truncate text-[12px] font-bold text-slate-900" title={typeof m.value === "string" ? m.value : undefined}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/** Baris metadata standar (dipakai hampir semua dokumen). */
export function useStandardMeta(meta: DocMeta, extra?: { label: string; value: ReactNode }[]) {
  const { t } = useI18n();
  const m = meta;
  const periodLabel = m.run
    ? `${m.run.periodName} (${String(m.run.sptMonth).padStart(2, "0")}/${m.run.sptYear})`
    : m.period
      ? `${m.period.name}${m.period.sptMonth ? ` (${String(m.period.sptMonth).padStart(2, "0")}/${m.period.sptYear})` : ""}`
      : "—";
  const rows: { label: string; value: ReactNode }[] = [
    { label: t("Periode Penggajian (Bulan/Tahun)", "Payroll Period (Month/Year)"), value: periodLabel },
    { label: t("Tanggal Transfer / Cut-off", "Transfer / Cut-off Date"), value: m.run?.paidAt ? fmtDateLongId(m.run.paidAt) : "—" },
    { label: t("Tanggal Dicetak", "Printed On"), value: fmtDateId(m.officer.printedAt) },
    { label: t("Nama Payroll Officer", "Payroll Officer"), value: m.officer.name },
  ];
  return extra ? [...rows, ...extra] : rows;
}

// ---------- bagian & tabel ----------

export function DocSection({ title, note, children, className }: { title?: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-5", className)}>
      {title && (
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">{title}</h2>
      )}
      {children}
      {note && <p className="mt-1.5 text-[10px] italic leading-snug text-slate-500">{note}</p>}
    </section>
  );
}

export function DocTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <table className={cn("w-full border-collapse text-[11px]", className)}>
      <thead>
        <tr className="bg-slate-800 text-white">
          {head.map((h, i) => (
            <th
              key={i}
              className={cn(
                "border border-slate-700 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide",
                // konvensi: kolom pertama (teks) kiri; sisanya ditentukan konten
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="[&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_tr:nth-child(even)]:bg-slate-50/70">
        {children}
      </tbody>
    </table>
  );
}

/** Baris grand total di kaki tabel. */
export function TotalRow({ cells, colSpan }: { cells: ReactNode[]; colSpan: number }) {
  return (
    <tr className="bg-slate-200/90 font-bold [&_td]:border [&_td]:border-slate-400">
      {cells.map((c, i) => (
        <td
          key={i}
          colSpan={i === 0 ? colSpan : undefined}
          className={cn("px-2 py-1.5 text-[11px]", i === 0 ? "uppercase tracking-wide" : "text-right tabular-nums")}
        >
          {c}
        </td>
      ))}
    </tr>
  );
}

// ---------- kaki dokumen ----------

export function TotalBand({ items }: { items: { label: string; value: string; tone?: "dark" | "green" | "red" }[] }) {
  return (
    <div className="mt-4 grid gap-px overflow-hidden rounded-md bg-slate-300 ring-1 ring-slate-300 md:grid-cols-2 lg:grid-cols-4">
      {items.map((it, i) => (
        <div
          key={i}
          className={cn(
            "px-4 py-2.5",
            it.tone === "green" ? "bg-emerald-600 text-white" : it.tone === "red" ? "bg-rose-700 text-white" : "bg-slate-800 text-white",
          )}
        >
          <div className="text-[9.5px] font-semibold uppercase tracking-wider opacity-80">{it.label}</div>
          <div className="mt-0.5 text-[15px] font-extrabold tabular-nums">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SignOff({
  place, preparedBy, extraBank, notes,
}: {
  place: string;
  preparedBy: string;
  extraBank?: boolean;
  notes?: string;
}) {
  const { t } = useI18n();
  const cell = "flex flex-col items-center text-center";
  return (
    <section className="mt-6 break-inside-avoid">
      <div className="mb-2 text-[11px] font-semibold text-slate-600">{place}</div>
      <div className={cn("grid gap-4", extraBank ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-1 sm:grid-cols-3")}>
        <div className={cell}>
          <div className="text-[10.5px] font-semibold text-slate-600">{t("Disiapkan oleh,", "Prepared by,")}</div>
          <div className="h-14" aria-hidden />
          <div className="w-11/12 border-t border-slate-500 pt-1 text-[11px] font-bold">{preparedBy}</div>
          <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t("Payroll Officer", "Payroll Officer")}</div>
        </div>
        <div className={cell}>
          <div className="text-[10.5px] font-semibold text-slate-600">{t("Diperiksa oleh,", "Reviewed by,")}</div>
          <div className="h-14" aria-hidden />
          <div className="w-11/12 border-t border-slate-500 pt-1 text-[11px] font-bold text-slate-400">( ………… )</div>
          <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t("Finance Manager", "Finance Manager")}</div>
        </div>
        <div className={cell}>
          <div className="text-[10.5px] font-semibold text-slate-600">{t("Disetujui oleh,", "Approved by,")}</div>
          <div className="h-14" aria-hidden />
          <div className="w-11/12 border-t border-slate-500 pt-1 text-[11px] font-bold text-slate-400">( ………… )</div>
          <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t("Direktur", "Director")}</div>
        </div>
        {extraBank && (
          <>
            <div className={cell}>
              <div className="text-[10.5px] font-semibold text-slate-600">{t("Tanda tangan bank,", "Authorised bank signatory,")}</div>
              <div className="h-14" aria-hidden />
              <div className="w-11/12 border-t border-slate-500 pt-1 text-[11px] font-bold text-slate-400">( ………… )</div>
              <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t("Bank Mitra", "Partner Bank")}</div>
            </div>
            <div className={cell}>
              <div className="text-[10.5px] font-semibold text-slate-600">{t("Tanda tangan perusahaan,", "Authorised company signatory,")}</div>
              <div className="h-14" aria-hidden />
              <div className="w-11/12 border-t border-slate-500 pt-1 text-[11px] font-bold text-slate-400">( ………… )</div>
              <div className="text-[9.5px] uppercase tracking-wide text-slate-500">{t("Perusahaan", "Company")}</div>
            </div>
          </>
        )}
      </div>
      {notes && <p className="mt-3 text-[10px] italic leading-snug text-slate-500">{notes}</p>}
    </section>
  );
}

export function Confidentiality() {
  const { t } = useI18n();
  return (
    <footer className="mt-6 break-inside-avoid">
      <div className="rounded border-y-2 border-rose-700 bg-rose-50 py-2 text-center">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-rose-800">
          {t("SANGAT RAHASIA - DOKUMEN KEUANGAN (STRICTLY CONFIDENTIAL)", "STRICTLY CONFIDENTIAL - FINANCIAL DOCUMENT")}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-400">
        <span>RekanKerja HRIS — Payroll & Compensation</span>
        <span>{t("Dokumen ini sah tanpa tanda tangan basah bila distempel & ditandatangani secara elektronik.", "This document is valid without a wet signature when stamped & electronically signed.")}</span>
      </div>
    </footer>
  );
}

/** Placeholder baris kosong yang informatif (mis. laporan tanpa populasi). */
export function EmptyDocRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-[11px] italic text-slate-400">
        {message}
      </td>
    </tr>
  );
}

// ---------- util meta ----------

export const docPlace = (city: string | null | undefined, printedAt: string) =>
  `${city ?? "Jakarta"}, ${fmtDateLongId(printedAt)}`;
