"use client";
// RekanKerja — Modul Recruitment: router view (DEVELOPMENT-PLAN-RECRUITMENT.md).
// F0: overview (ringkasan) + masters (10 master CRUD + katalog tahap seleksi).
// F1: pr (permintaan karyawan + form) + pr-approval (kotak persetujuan PR).
// View F2–F5 menyusul per fase (lihat peta fase di halaman Ringkasan).
import { RecruitmentOverview } from "@/rekankerja/recruitment/components/recruitment-overview";
import { RecruitmentMastersPage } from "@/rekankerja/recruitment/components/recruitment-masters";
import { PrListPage } from "@/rekankerja/recruitment/components/pr-list";
import { PrApprovalPage } from "@/rekankerja/recruitment/components/pr-approval";

export function RecruitmentModule({ view }: { view: string }) {
  switch (view) {
    case "masters": return <RecruitmentMastersPage />;
    case "pr": return <PrListPage />;
    case "pr-approval": return <PrApprovalPage />;
    default: return <RecruitmentOverview />;
  }
}
