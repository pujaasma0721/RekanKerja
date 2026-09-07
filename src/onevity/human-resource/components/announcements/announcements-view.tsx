"use client";
// STUB wave-27 — Task 27-f (Pengumuman) akan mengganti isi file ini.
// Skema siap: model Announcement + AnnouncementRead (migrate-wave27).
import { Megaphone, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function AnnouncementsView() {
  return (
    <div>
      <PageHeader
        eyebrow="Komunikasi"
        title="Pengumuman"
        description="Broadcast pengumuman perusahaan ke seluruh karyawan ESS + pelacakan dibaca."
      />
      <EmptyState
        icon={HardHat}
        title="Pengumuman sedang dibangun"
        description="Task 27-f mengimplementasikan CRUD pengumuman + read-tracking di sini."
      />
      <span aria-hidden className="hidden"><Megaphone /></span>
    </div>
  );
}
