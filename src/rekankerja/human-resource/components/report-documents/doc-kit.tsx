"use client";
// T104 — komponen dasar dokumen laporan (print & PDF ready) ===================
// Blok bersama utk 16 laporan distribusi HR: kertas A4 (ReportSheet), kop
// dokumen (DocHeader: logo placeholder + perusahaan + judul + metadata), footer
// standar (DocFooter: sign-off 3 kolom + kerahasiaan), DocTable, badge urgensi.
//
// DESAIN CETAK: seluruh warna EKSPLISIT terang (bg-white/text-slate-900, tanpa
// varian dark:) — dokumen adalah "kertas" di segala mode. Print: elemen root
// diberi id="rk-print-area"; tab mem-clone node ini ke body saat window.print()
// (lihat report-documents-tab.tsx + @media print di globals.css).
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { fmtDate } from "@/rekankerja/shared/lib/api";
import { cn } from "@/lib/utils";
import type { DocMeta } from "./types";

/** Kertas dokumen — wadah satu laporan.
 * `landscape` → @page A4 landscape saat cetak (tabel lebar: sensus, matriks,
 * rekoniliasi, struktur upah, audit sertifikasi). */
export function ReportSheet({ children, docId, landscape = false }: { children: ReactNode; docId: string; landscape?: boolean }) {
  return (
    <div id="rk-print-area" data-doc={docId} data-landscape={landscape ? "1" : undefined} className="report-sheet mx-auto w-full max-w-[1000px] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      <div className="px-6 py-7 sm:px-10 sm:py-9">{children}</div>
    </div>
  );
}

/** Chip rahasia di pojok kop. */
function ConfidentialChip() {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[8.5px] font-extrabold uppercase tracking-[0.14em] text-rose-600">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
      {t("Rahasia · Confidential", "Confidential")}
    </div>
  );
}

/** Logo placeholder — kotak monogram bila companyLogoUrl kosong. */
function CompanyLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={name} className="h-14 w-14 rounded-lg border border-slate-200 bg-white object-contain p-1" />;
  }
  const initials = name.split(/\s+/).filter((w) => w.length > 1 && !["PT", "CV", "UD", "PERSERO"].includes(w.toUpperCase())).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-slate-300 bg-slate-50 text-base font-black tracking-tight text-slate-400">
      {initials || "CO"}
    </div>
  );
}

/** Metadata strip kop: Periode Laporan | Tanggal Dicetak | Nama Pengunduh. */
export function DocMetaStrip({ meta, docNo }: { meta: DocMeta; docNo: string }) {
  const { t } = useI18n();
  const cells: { label: string; value: ReactNode }[] = [
    { label: t("Periode Laporan", "Report Period"), value: meta.periodLabel },
    { label: t("Tanggal Dicetak", "Printed On"), value: fmtDate(meta.generatedAt) },
    { label: t("Nama Pengunduh / HR Officer", "Downloaded By / HR Officer"), value: meta.printedBy },
    { label: t("No. Dokumen", "Document No."), value: docNo },
  ];
  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="bg-slate-50 px-3 py-2">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">{c.label}</p>
            <p className="mt-0.5 truncate text-[11px] font-bold text-slate-800">{c.value}</p>
          </div>
        ))}
      </div>
      {/* T110: chip parameter terpasang — cakupan data terdokumentasi di kop */}
      {meta.filters?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {meta.filters.map((f) => (
            <span key={`${f.label}-${f.value}`} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[8.5px] font-bold text-slate-600">
              <span className="uppercase tracking-[0.08em] text-slate-400">{t(f.label, f.label)}</span>
              <span className="text-slate-800">{f.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Kop dokumen: logo + identitas perusahaan + judul laporan + metadata. */
export function DocHeader({ meta, reportNo, title, subtitle, audience, docNo }: {
  meta: DocMeta; reportNo: string; title: string; subtitle?: string; audience?: string; docNo: string;
}) {
  const { t } = useI18n();
  return (
    <header className="border-b-[3px] border-slate-800 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <CompanyLogo name={meta.companyName} logoUrl={meta.companyLogoUrl} />
          <div className="min-w-0">
            <h2 className="text-base font-black uppercase leading-tight tracking-wide text-slate-900">{meta.companyName}</h2>
            <p className="mt-0.5 text-[9.5px] leading-snug text-slate-500">
              {meta.companyAddress ?? "—"}{meta.companyAddress && meta.companyCity ? `, ${meta.companyCity}` : meta.companyCity ?? ""}
            </p>
            {meta.companyTaxId && <p className="text-[9.5px] text-slate-500">NPWP: {meta.companyTaxId}</p>}
            <p className="mt-0.5 text-[9.5px] font-bold text-slate-600">{t("Lokasi Cabang", "Branch")}: {meta.branchLabel}</p>
          </div>
        </div>
        <ConfidentialChip />
      </div>

      <div className="mt-5 text-center">
        <p className="inline-block rounded bg-slate-800 px-2 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.16em] text-white">{reportNo}</p>
        <h1 className="mt-1.5 text-[15px] font-black uppercase leading-snug tracking-tight text-slate-900 sm:text-[17px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{subtitle}</p>}
        {audience && (
          <p className="mt-1.5 text-[9.5px] text-slate-500">
            <span className="font-bold uppercase tracking-wide text-slate-600">{t("Penerima Dokumen", "Distribution")}</span>{" "}
            — {audience}
          </p>
        )}
      </div>

      <DocMetaStrip meta={meta} docNo={docNo} />
    </header>
  );
}

/** Judul seksi dalam badan dokumen. */
export function DocSection({ no, title, note }: { no?: string; title: string; note?: string }) {
  return (
    <div className="mb-2 mt-5 first:mt-0">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-800">
        {no && <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-px text-[9px]">{no}</span>}
        {title}
      </p>
      {note && <p className="mt-0.5 text-[9.5px] italic text-slate-400">{note}</p>}
    </div>
  );
}

/** Tabel dokumen — header abu, baris rapat, kolom via children TableHead. */
export function DocTable({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-slate-200", className)}>
      <Table className="doc-table">
        <TableHeader>
          <TableRow className="bg-slate-100 hover:bg-slate-100">
            {head}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

/** <th> dokumen — align: text | center | number. */
export function TH({ children, align = "text" }: { children: ReactNode; align?: "text" | "center" | "number" }) {
  return (
    <TableHead className={cn(
      "whitespace-nowrap border-b border-slate-300 px-2.5 py-2 text-[9px] font-extrabold uppercase tracking-[0.06em] text-slate-600",
      align === "center" && "text-center", align === "number" && "text-right", align === "text" && "text-left",
    )}>
      {children}
    </TableHead>
  );
}

/** <td> dokumen — align: text | center | number. */
export function TD({ children, align = "text", className, colSpan }: { children?: ReactNode; align?: "text" | "center" | "number"; className?: string; colSpan?: number }) {
  return (
    <TableCell colSpan={colSpan} className={cn(
      "border-b border-slate-100 px-2.5 py-1.5 align-top text-[10.5px] text-slate-700",
      align === "center" && "whitespace-nowrap text-center", align === "number" && "whitespace-nowrap text-right tabular-nums",
      className,
    )}>
      {children}
    </TableCell>
  );
}

/** Baris total dokumen. */
export function TotalRow({ label, cells, spanLabel = 1 }: { label: string; cells: ReactNode[]; spanLabel?: number }) {
  return (
    <TableRow className="bg-slate-100/90 hover:bg-slate-100/90">
      <TD colSpan={spanLabel} className="text-[10.5px] font-black uppercase text-slate-900">{label}</TD>
      {cells.map((c, i) => (
        <TD key={i} className="text-[10.5px] font-black text-slate-900" align={i === cells.length - 1 ? "number" : "center"}>{c}</TD>
      ))}
    </TableRow>
  );
}

/** Kotak ringkasan metrik (summary block) — dipakai sebelum sign-off. */
export function SummaryBox({ items, className }: { items: { label: string; value: ReactNode; accent?: boolean }[]; className?: string }) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200", className)}>
      {items.map((it) => (
        <div key={it.label} className={cn("flex items-baseline justify-between gap-3 px-3.5 py-2", it.accent ? "bg-slate-800" : "bg-slate-50")}>
          <span className={cn("text-[9.5px] font-bold uppercase tracking-wide", it.accent ? "text-slate-300" : "text-slate-500")}>{it.label}</span>
          <span className={cn("text-[12px] font-black tabular-nums", it.accent ? "text-white" : "text-slate-900")}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Grid persetujuan 3 kolom: Disiapkan · Diperiksa · Disetujui. */
export function SignOffGrid({ note }: { note?: string }) {
  const { t } = useI18n();
  const cols: { role: string; en: string }[] = [
    { role: "Disiapkan oleh,", en: "Prepared by (HR Officer)" },
    { role: "Diperiksa oleh,", en: "Reviewed by (HR Manager)" },
    { role: "Disetujui oleh,", en: "Approved by (Director)" },
  ];
  return (
    <div className="mt-6">
      {note && <p className="mb-3 text-[9.5px] italic text-slate-500">{note}</p>}
      <div className="grid grid-cols-3 gap-4 sm:gap-8">
        {cols.map((c) => (
          <div key={c.role} className="text-center">
            <p className="text-[9.5px] font-bold text-slate-600">{t(c.role, c.en)}</p>
            <div className="mx-auto mt-8 mb-1 w-full border-b border-dashed border-slate-400" />
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-slate-400">
              {t("Nama & Tanda Tangan", "Name & Signature")}
            </p>
            <p className="text-[8.5px] text-slate-400">{t("Tanggal: ______________", "Date: ______________")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Footer standar: sign-off + pemberitahuan kerahasiaan. */
export function DocFooter({ meta, signNote }: { meta: DocMeta; signNote?: string }) {
  const { t } = useI18n();
  return (
    <footer className="mt-8 border-t-2 border-slate-800 pt-3">
      <SignOffGrid note={signNote} />
      <div className="mt-5 rounded-md bg-slate-900 px-4 py-2.5 text-center">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-200">
          {t("Dokumen Rahasia Perusahaan (Confidential)", "Company Confidential Document")}
        </p>
        <p className="mt-0.5 text-[8.5px] text-slate-400">
          {t(
            "Hanya untuk distribusi terbatas sesuai daftar penerima. Dilarang menggandakan/menyebarkan tanpa izin tertulis HR.",
            "Restricted distribution to listed recipients only. Do not copy or disseminate without written HR approval.",
          )}
          {" · "}
          {t("Dicetak dari RekanKerja HRIS oleh", "Printed from RekanKerja HRIS by")} {meta.printedBy}
        </p>
      </div>
    </footer>
  );
}

/** Badge status generik — varian warna tetap (print-color-adjust: exact). */
export function DocBadge({ tone, children }: { tone: "green" | "amber" | "red" | "rose" | "slate" | "sky" | "violet"; children: ReactNode }) {
  const tones: Record<string, string> = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return (
    <Badge variant="outline" className={cn("px-1.5 text-[8.5px] font-extrabold", tones[tone])}>
      {children}
    </Badge>
  );
}

/** Data kosong placeholder. */
export function Dash() {
  return <span className="text-slate-300">—</span>;
}

/** Format angka lokal (koma desimal id-ID). */
export function useDocFmt() {
  const { locale } = useI18n();
  return {
    num: (n: number | null | undefined) => (n == null ? "—" : (n ?? 0).toLocaleString(locale)),
    pct: (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString(locale)}%`),
    dt: (s: string | null | undefined) => (s ? fmtDate(s) : "—"),
  };
}
