"use client";
// P3.5-BM (D-BM27) — Jalur Karier Saya: peta jalur posisi→posisi + syarat
// keahlian + gap vs EmployeeSkill karyawan. STUB Phase 0b — DIGANTI LENGKAP
// oleh slice E. (development actions = teks terstruktur succession — BUKAN
// modul training, D-BM28 exclude permanen)
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Route } from "lucide-react";

export function EssMyCareerPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Jalur Karier Saya", "My Career Path")}
        description={t("Peta pengembangan karier Anda", "Your career development map")}
      />
      <EmptyState
        icon={Route}
        title={t("Menyiapkan peta karier", "Preparing career map")}
        description={t("Fitur sedang dipasang.", "Feature is being installed.")}
      />
    </div>
  );
}
