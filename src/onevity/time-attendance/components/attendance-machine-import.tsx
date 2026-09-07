"use client";
// STUB wave-27 — Task 27-a (Import Mesin Absen) akan mengganti isi file ini.
import { FileUp, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function AttendanceMachineImportPage() {
  return (
    <div>
      <PageHeader eyebrow="Kehadiran" title="Import Mesin Absen" description="Import log presensi mentah mesin sidik jari/face (CSV/Excel) dengan dedupe." />
      <EmptyState icon={HardHat} title="Import mesin sedang dibangun" description="Task 27-a mengimplementasikan parser + dedupe + batch audit di sini." />
      <span aria-hidden className="hidden"><FileUp /></span>
    </div>
  );
}
