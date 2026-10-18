"use client";
// P3.2-BM (D-BM24) — Katalog Keahlian: master SkillCatalog organisasi (CRUD)
// + penilaian keahlian karyawan (EmployeeSkill). STUB Phase 0b — DIGANTI
// LENGKAP oleh slice B.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Wrench } from "lucide-react";

export function SkillsCatalogView() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Posisi & Jabatan", "Positions & Jobs")}
        title={t("Katalog Keahlian", "Skill Catalog")}
        description={t("Master keahlian lintas organisasi", "Organization-wide skill master")}
      />
      <EmptyState
        icon={Wrench}
        title={t("Menyiapkan katalog keahlian", "Preparing skill catalog")}
        description={t("Fitur sedang dipasang.", "Feature is being installed.")}
      />
    </div>
  );
}
