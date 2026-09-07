"use client";
// STUB wave-27 — Task 27-g (Tukar Shift) akan mengganti isi file ini.
import { ArrowLeftRight, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function AttendanceShiftSwapPage() {
  return (
    <div>
      <PageHeader eyebrow="Kehadiran" title="Tukar Shift" description="Persetujuan permintaan tukar shift antar karyawan (diajukan dari ESS)." />
      <EmptyState icon={HardHat} title="Tukar shift sedang dibangun" description="Task 27-g mengimplementasikan approval + override jadwal di sini." />
      <span aria-hidden className="hidden"><ArrowLeftRight /></span>
    </div>
  );
}
