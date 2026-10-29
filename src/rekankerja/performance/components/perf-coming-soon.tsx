"use client";
// P0-PERF — placeholder fase untuk view yang dibangun di P1–P8
// (informative, bukan stub kosong: user tahu apa yang akan datang).
import { PageHeader } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { Button } from "@/components/ui/button";
import { Construction, ArrowLeft } from "lucide-react";

const VIEW_INFO: Record<string, { title: [string, string]; desc: [string, string] }> = {
  cycles: {
    title: ["Siklus Penilaian", "Appraisal Cycles"],
    desc: [
      "CRUD siklus + gerbang fase + enroll peserta + TAB Command Center (status formulir seluruh perusahaan + Remind/nudge multi-kanal — §18.8).",
      "Cycle CRUD + phase gates + participant enrollment + Command Center tab (company-wide form status + multi-channel Remind/nudge — §18.8).",
    ],
  },
  goals: {
    title: ["Target & KPI", "Goals & KPI"],
    desc: [
      "KPI Builder (§18.1) + salin dari periode sebelumnya (§18.2) + penetapan/approval per peserta + impor Excel target (§18.5).",
      "KPI Builder (§18.1) + copy from previous cycle (§18.2) + per-participant assignment/approval + Excel target import (§18.5).",
    ],
  },
  checkins: {
    title: ["Check-in", "Check-ins"],
    desc: [
      "Jadwal & catatan 1-on-1 semua tim + progress midActual + revisi target mid-year.",
      "1-on-1 schedule & notes for all teams + midActual progress + mid-year target revision.",
    ],
  },
  appraisals: {
    title: ["Penilaian", "Appraisals"],
    desc: [
      "Form self/atasan/360 + tarikan data otomatis (§18.6) + AI Assist ulasan (§18.11) + panel estimasi dampak real-time (§18.12) + impor realisasi Excel (§18.5).",
      "Self/manager/360 forms + auto data pull (§18.6) + AI assist reviews (§18.11) + real-time impact estimate panel (§18.12) + Excel actuals import (§18.5).",
    ],
  },
  calibration: {
    title: ["Kalibrasi", "Calibration"],
    desc: [
      "Sesi & keputusan ter-audit + distribusi + BELL CURVE deteksi atasan pelis/royal (§18.10).",
      "Sessions & audited decisions + distribution + BELL CURVE stingy/lenient rater detection (§18.10).",
    ],
  },
  results: {
    title: ["Hasil & 9-Box", "Results & 9-Box"],
    desc: [
      "Publikasi hasil, acknowledgement karyawan, jendela banding, lensa 9-box talenta.",
      "Result publication, employee acknowledgement, appeal window, 9-box talent lens.",
    ],
  },
  pip: {
    title: ["PIP", "PIP"],
    desc: [
      "Register & checkpoint program perbaikan kinerja 30/60/90 hari (Alur 9).",
      "Register & checkpoints of the 30/60/90-day performance improvement plan (Flow 9).",
    ],
  },
  probation: {
    title: ["Evaluasi Masa Percobaan", "Probation Evaluation"],
    desc: [
      "Jatuh tempo masa percobaan (≤3 bulan), keputusan Confirm/Extend/Terminate + PA + surat (Alur 4).",
      "Probation due dates (≤3 months), Confirm/Extend/Terminate decisions + PA + letters (Flow 4).",
    ],
  },
  reports: {
    title: ["Laporan", "Reports"],
    desc: [
      "Dashboard KPI modul + katalog dokumen laporan dwibahasa (XLSX/PDF).",
      "Module KPI dashboard + bilingual report document catalog (XLSX/PDF).",
    ],
  },
};

export function PerfComingSoon({ view, phase }: { view: string; phase: string }) {
  const { t } = useI18n();
  const nav = useNav();
  const info = VIEW_INFO[view] ?? { title: ["", ""], desc: ["", ""] };
  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Penilaian Kinerja")}
        title={t(info.title[0], info.title[1])}
        description={t(info.desc[0], info.desc[1])}
        actions={(
          <Button variant="outline" onClick={() => nav.navigate("performance", "overview")}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> {t("Ke Ringkasan", "To Overview")}
          </Button>
        )}
      />
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <Construction className="h-10 w-10 text-amber-500" aria-hidden />
          <p className="font-semibold">
            {t("Menu ini dibangun pada fase {p} sesuai rencana eksekusi.", "This menu is built in phase {p} per the execution plan.", { p: phase })}
          </p>
          <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
            {t(
              "Modul Performance dieksekusi bertahap P0 → P9 (§20). Fondasi (master, pustaka KPI/kompetensi, skala, template, merit matrix, pengaturan) sudah aktif sekarang.",
              "The Performance module is executed in stages P0 → P9 (§20). The foundation (masters, KPI/competency library, scales, templates, merit matrix, settings) is already live.",
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
