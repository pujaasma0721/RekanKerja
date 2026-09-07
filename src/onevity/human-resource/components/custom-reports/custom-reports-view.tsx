"use client";
// STUB wave-28 — Task 28-b (Report Builder) akan mengganti isi file ini.
// Skema siap: model CustomReport (migrate-wave27).
import { SlidersHorizontal, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function CustomReportsView() {
  return (
    <div>
      <PageHeader
        eyebrow="Laporan"
        title="Laporan Kustom"
        description="Bangun laporan ad-hoc: pilih entity, field, filter — simpan & ekspor."
      />
      <EmptyState
        icon={HardHat}
        title="Report Builder sedang dibangun"
        description="Task 28-b mengimplementasikan builder + runner + ekspor di sini."
      />
      <span aria-hidden className="hidden"><SlidersHorizontal /></span>
    </div>
  );
}
