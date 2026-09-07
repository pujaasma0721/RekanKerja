"use client";
// STUB wave-27 — Task 27-f (halaman Pengumuman ESS) akan mengganti isi file ini.
import { Megaphone } from "lucide-react";
import { EmptyState } from "@/onevity/shared/components/ui-kit";

export function EssAnnouncements() {
  return (
    <div className="space-y-4">
      <EmptyState icon={Megaphone} title="Pengumuman sedang dibangun" description="Task 27-f mengimplementasikan daftar pengumuman + konfirmasi baca di sini." />
    </div>
  );
}
