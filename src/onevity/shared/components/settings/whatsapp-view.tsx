"use client";
// STUB wave-28 — Task 28-a (Notifikasi WhatsApp) akan mengganti isi file ini.
import { MessageCircle, HardHat } from "lucide-react";
import { PageHeader, EmptyState } from "@/onevity/shared/components/ui-kit";

export function WhatsAppConfigView() {
  return (
    <div>
      <PageHeader eyebrow="Pengaturan" title="Notifikasi WhatsApp" description="Kanal WA: provider (Fonnte/Wablas/Custom), template pesan, riwayat kirim." />
      <EmptyState icon={HardHat} title="Konfigurasi WhatsApp sedang dibangun" description="Task 28-a mengimplementasikan konfigurasi + template + log di sini." />
      <span aria-hidden className="hidden"><MessageCircle /></span>
    </div>
  );
}
