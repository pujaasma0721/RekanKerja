"use client";
// RekanKerja — Modul Recruitment: router view (F0 — DEVELOPMENT-PLAN-RECRUITMENT.md).
// F0: overview (ringkasan) + masters (10 master CRUD + katalog tahap seleksi).
// View F1–F5 menyusul per fase (lihat peta fase di halaman Ringkasan).
import { RecruitmentOverview } from "@/rekankerja/recruitment/components/recruitment-overview";
import { RecruitmentMastersPage } from "@/rekankerja/recruitment/components/recruitment-masters";

export function RecruitmentModule({ view }: { view: string }) {
  switch (view) {
    case "masters": return <RecruitmentMastersPage />;
    default: return <RecruitmentOverview />;
  }
}
