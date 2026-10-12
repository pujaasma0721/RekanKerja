"use client";
// P8-PERF — halaman Laporan modul Performance (§14.2; §11.2): katalog 14 laporan
// dokumen dwibahasa siap-cetak (pf11–pf44) — mirror pola medical-reports.tsx
// (tab "Dokumen Laporan"; PageHeader di atas konten). Ringkasan KPI modul
// berada di halaman Ringkasan (performance-overview).
import { PageHeader } from "@/rekankerja/shared/components/ui-kit";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PerformanceReportDocumentsTab } from "./report-documents/report-documents-tab";

export function PerformanceReportsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Penilaian Kinerja")}
        title={t("Laporan Kinerja", "Performance Reports")}
        description={t(
          "Katalog 14 laporan dokumen dwibahasa siap-cetak (pf11–pf44) dalam 4 grup — siklus & partisipasi, penilaian & hasil, kualitas & kepatuhan, konsekuensi & analitik — plus ekspor riwayat penilaian per karyawan (PP 35/2021 §7.2) dari halaman Karyawan.",
          "Catalog of 14 bilingual print-ready report documents (pf11–pf44) in 4 groups — cycles & participation, assessment & results, quality & compliance, consequences & analytics — plus the per-employee performance history export (PP 35/2021 §7.2) from the Employee page.",
        )}
      />
      <PerformanceReportDocumentsTab />
    </div>
  );
}
