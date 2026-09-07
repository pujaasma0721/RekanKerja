"use client";
// STUB wave-27 — Task 27-e (Papan Kehadiran Live) akan mengganti isi file ini.
import { Radar, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function AttendanceLiveboardPage() {
  return (
    <div>
      <PageHeader eyebrow="Kehadiran" title="Papan Kehadiran" description="Siapa sedang di kantor sekarang — real-time." />
      <EmptyState icon={HardHat} title="Papan kehadiran sedang dibangun" description="Task 27-e mengimplementasikan live board di sini." />
      <span aria-hidden className="hidden"><Radar /></span>
    </div>
  );
}
