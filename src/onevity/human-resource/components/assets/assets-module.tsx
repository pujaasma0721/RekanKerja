"use client";
// STUB wave-27 — Task 27-b (modul Aset) akan mengganti isi file ini.
// Skema siap: model Asset + AssetAssignment (migrate-wave27 sudah dijalankan).
import { Package, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function AssetsModule() {
  return (
    <div>
      <PageHeader
        eyebrow="Inventaris"
        title="Aset Karyawan"
        description="Penugasan & pengembalian aset perusahaan (laptop, seragam, alat kerja)."
      />
      <EmptyState
        icon={HardHat}
        title="Modul Aset sedang dibangun"
        description="Task 27-b mengimplementasikan inventaris, penugasan, dan pengembalian aset di sini."
      />
      <p className="sr-only">Aset</p>
      <span aria-hidden className="hidden"><Package /></span>
    </div>
  );
}
