"use client";
// Placeholder modul yang belum dibangun (Travel / Medical)
import { ModuleId, MODULE_LABEL } from "@/onevity/shared/lib/store";
import { PageHeader } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plane, HeartPulse, Sparkles, ChevronLeft } from "lucide-react";
import { useNav } from "@/onevity/shared/lib/store";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ElementType> = {
  travel: Plane,
  medical: HeartPulse,
};

const PLANNED: Record<string, string[]> = {
  travel: ["Permintaan Perjalanan Dinas", "Klaim & Settlement Travel", "Budget Travel per Period", "Approval Berjenjang", "Integrasi Jurnal Akuntansi"],
  medical: ["Info Benefit Medis Karyawan", "Klaim Medis & Bukti Dokumen", "Approval Klaim (limit & overlimit)", "Jenis Benefit & Reset Period", "Pembayaran via Payroll"],
};

export function ModulePlaceholder({ module }: { module: ModuleId }) {
  const { setModule } = useNav();
  const Icon = ICONS[module] ?? Sparkles;
  const label = MODULE_LABEL[module];
  const planned = PLANNED[module] ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={`MODUL ${label.toUpperCase()}`}
        title={`Modul ${label}`}
        description="Modul ini sudah dirancang dalam roadmap OneVity dan akan dibangun setelah modul inti selesai."
        actions={
          <Button variant="outline" className="gap-2" onClick={() => setModule("leave")}>
            <ChevronLeft className="h-4 w-4" /> Lihat Modul Leave
          </Button>
        }
      />

      <Card className="overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <div className="relative flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-stone-50 to-white px-6 py-14 text-center dark:from-stone-900/60 dark:to-background">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/30">
            <Icon className="h-8 w-8" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight text-stone-900 dark:text-stone-50">Modul {label} — Segera Hadir</p>
            <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
              Struktur menu dan proses bisnis modul {label} telah dipetakan dari studi aplikasi HRIS referensi.
              Gunakan dropdown <span className="font-semibold text-emerald-700 dark:text-emerald-400">Modul Aktif</span> di sidebar
              untuk berpindah antar modul.
            </p>
          </div>
        </div>
        <CardContent className="border-t border-stone-200/70 p-5 dark:border-stone-800">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-stone-400">Rencana Cakupan Modul</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {planned.map((p, i) => (
              <div key={i} className={cn("flex items-center gap-2.5 rounded-xl border border-stone-200/80 bg-stone-50/60 px-3.5 py-2.5 dark:border-stone-800 dark:bg-stone-900/40")}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{i + 1}</span>
                <span className="text-[13px] font-medium text-stone-700 dark:text-stone-300">{p}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
