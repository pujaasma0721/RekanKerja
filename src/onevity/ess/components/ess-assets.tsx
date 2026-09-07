"use client";
// STUB wave-27 — Task 27-b (halaman Aset Saya ESS) akan mengganti isi file ini.
import { Package } from "lucide-react";
import { EmptyState } from "@/onevity/shared/components/ui-kit";

export function EssAssets() {
  return (
    <div className="space-y-4">
      <EmptyState icon={Package} title="Aset saya sedang dibangun" description="Task 27-b mengimplementasikan daftar aset dipinjam di sini." />
    </div>
  );
}
