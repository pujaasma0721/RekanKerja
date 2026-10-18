"use client";
// P3.3-BM (D-BM25) — Tim Saya: workspace atasan (read-only agregat + tombol
// approve reuse action inbox). STUB Phase 0b — DIGANTI LENGKAP oleh slice C.
// (akses = atasan langsung via assignment aktif; non-atasan 403 di API)
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Users } from "lucide-react";

export function EssMyTeamPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Tim Saya", "My Team")}
        description={t("Ringkasan tim Anda", "Your team summary")}
      />
      <EmptyState
        icon={Users}
        title={t("Menyiapkan workspace tim", "Preparing team workspace")}
        description={t("Fitur sedang dipasang.", "Feature is being installed.")}
      />
    </div>
  );
}
