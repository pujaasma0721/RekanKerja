"use client";
// RekanKerja Payroll — R2.2 Bukti Potong 1721-A1 (PDF hasil engine iReport) =
// ============================================================================
// Viewer dokumen PDF yang dirender engine iReport/JasperReports dari template
// JRXML DJP resmi (vendor/jasper/templates/SPT1721A1.jrxml — template klien,
// layout tidak diubah). Menggantikan rekonstruksi HTML buatan sendiri yang
// sebelumnya ditolak karena tidak sesuai format DJP.
//
// Sumber PDF: GET /api/rekankerja/payroll-reports/spt1721a1?year&employeeId
// (blob objectURL dikelola payroll-reports-view — dibuang saat keluar tahap).
// ============================================================================
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { FileDown, ExternalLink, BadgeCheck, FileText } from "lucide-react";

export interface SptA1PdfPayload {
  report: "r22";
  pdfUrl: string;
  fileName: string;
  year: number;
  employees: { employeeNo: string; name: string }[];
}

export function SptA1PdfDoc({ data }: { data: SptA1PdfPayload }) {
  const { t } = useI18n();
  const single = data.employees.length === 1 ? data.employees[0] : null;

  return (
    <div className="mx-auto max-w-[880px]">
      {/* ============================ KOP DOKUMEN ============================ */}
      <div className="rounded-t-xl border border-slate-200 bg-white px-5 pb-4 pt-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-extrabold leading-tight">
                  {t("Bukti Potong PPh Pasal 21 — Formulir 1721-A1", "PPh Article 21 Withholding Slip — Form 1721-A1")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("Direktorat Jenderal Pajak · PER-14/PJ/2013 jo. semantik e-Bupot 21/26", "Directorate General of Taxes · PER-14/PJ/2013 with e-Bupot 21/26 semantics")}
                </p>
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            <BadgeCheck className="h-3.5 w-3.5" />
            {t("Engine iReport (JasperReports)", "iReport Engine (JasperReports)")}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="rounded-md bg-muted px-2 py-1 font-semibold">
            {t("Tahun Pajak", "Tax Year")}: {data.year}
          </span>
          {single ? (
            <span className="rounded-md bg-muted px-2 py-1 font-semibold">
              {single.employeeNo} — {single.name}
            </span>
          ) : (
            <span className="rounded-md bg-muted px-2 py-1 font-semibold">
              {t("Bundle tahunan", "Annual bundle")} · {data.employees.length} {t("karyawan (1 halaman/karyawan)", "employees (1 page each)")}
            </span>
          )}
          <span className="text-muted-foreground">
            {t(
              "Template JRXML DJP asli · kertas folio 330×215 mm · lembar 1 penerima penghasilan",
              "Original DJP JRXML template · folio paper 330×215 mm · sheet 1 for income recipient",
            )}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" className="bg-brand text-white hover:bg-brand-dark">
            <a href={data.pdfUrl} download={data.fileName}>
              <FileDown className="mr-1.5 h-4 w-4" />
              {t("Unduh PDF", "Download PDF")}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={data.pdfUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              {t("Buka di Tab Baru (cetak dari sana)", "Open in New Tab (print from there)")}
            </a>
          </Button>
        </div>
      </div>

      {/* ============================ EMBED PDF ============================ */}
      <div className="overflow-hidden rounded-b-xl border border-t-0 border-slate-200 bg-slate-100 shadow-sm dark:bg-slate-800">
        <iframe
          src={`${data.pdfUrl}#view=FitH`}
          title={t("Pratinjau PDF Bukti Potong 1721-A1", "PDF preview of Withholding Slip 1721-A1")}
          className="h-[78vh] min-h-[560px] w-full bg-white"
        />
      </div>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        {t(
          "Dokumen dirender langsung oleh engine iReport/JasperReports dari template JRXML resmi DJP — bukan rekonstruksi HTML. Baris 1–13 mengikuti semantik Manual e-Bupot 21/26 v1.4 (jumlah setahun penuh); baris 19 = dipotong masa sebelumnya; baris 21 = terutang masa terakhir; baris 23 = kurang/lebih bayar (tanda kurung = lebih bayar). Iuran JKK/JKM/JPK/JKP perusahaan (bukan objek PPh 21 — PMK 16/PMK.03/2021) tidak termasuk bruto.",
          "The document is rendered directly by the iReport/JasperReports engine from the official DJP JRXML template — not an HTML reconstruction. Rows 1–13 follow the e-Bupot 21/26 v1.4 manual semantics (full-year totals); row 19 = withheld in prior months; row 21 = last-month payable; row 23 = under/over-paid (parentheses = over-paid). Employer-paid JKK/JKM/JPK/JKP contributions (non-taxable per PMK 16/PMK.03/2021) are excluded from gross.",
        )}
      </p>
    </div>
  );
}
