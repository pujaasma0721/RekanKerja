"use client";
// P3.5-BM (D-BM27) — Jalur Karier (admin): register CareerPath (posisi →
// posisi berikutnya + syarat keahlian + catatan). STUB Phase 0b — DIGANTI
// LENGKAP oleh slice E.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Route } from "lucide-react";

export function CareerPathsView() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Posisi & Jabatan", "Positions & Jobs")}
        title={t("Jalur Karier", "Career Paths")}
        description={t("Peta jalur posisi ke posisi berikutnya", "Map of position-to-next-position paths")}
      />
      <EmptyState
        icon={Route}
        title={t("Menyiapkan register jalur karier", "Preparing career path registry")}
        description={t("Fitur sedang dipasang.", "Feature is being installed.")}
      />
    </div>
  );
}
