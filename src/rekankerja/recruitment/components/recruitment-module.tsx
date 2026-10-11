"use client";
// RekanKerja — Modul Recruitment: router view (DEVELOPMENT-PLAN-RECRUITMENT.md).
// F0: overview (ringkasan) + masters (10 master CRUD + katalog tahap seleksi).
// F1: pr (permintaan karyawan + form) + pr-approval (kotak persetujuan PR).
// F2: openings (lowongan JO + slot + kanal biaya) + applicants (talent pool)
//     + public-staging (verifikasi lamaran publik).
// F3: selection (kandidat & proses seleksi — board kanban per PR, scorecard
//     terstruktur, surat undangan, kalender seleksi).
// View F4–F5 menyusul per fase (lihat peta fase di halaman Ringkasan).
import { RecruitmentOverview } from "@/rekankerja/recruitment/components/recruitment-overview";
import { RecruitmentMastersPage } from "@/rekankerja/recruitment/components/recruitment-masters";
import { PrListPage } from "@/rekankerja/recruitment/components/pr-list";
import { PrApprovalPage } from "@/rekankerja/recruitment/components/pr-approval";
import { OpeningsPage } from "@/rekankerja/recruitment/components/openings";
import { ApplicantsPage } from "@/rekankerja/recruitment/components/applicants";
import { PublicStagingPage } from "@/rekankerja/recruitment/components/public-staging";
import { SelectionPage } from "@/rekankerja/recruitment/components/selection";
import { OffersPage } from "@/rekankerja/recruitment/components/offers";
import { PlanBudgetPage } from "@/rekankerja/recruitment/components/plan-budget";
import { DemographicsPage } from "@/rekankerja/recruitment/components/demographics";
import { RecruitmentSettingsPage } from "@/rekankerja/recruitment/components/recruitment-settings";
import { ReportsPage } from "@/rekankerja/recruitment/components/reports";
import { CompliancePage } from "@/rekankerja/recruitment/components/compliance";

export function RecruitmentModule({ view }: { view: string }) {
  switch (view) {
    case "masters": return <RecruitmentMastersPage />;
    case "pr": return <PrListPage />;
    case "pr-approval": return <PrApprovalPage />;
    case "openings": return <OpeningsPage />;
    case "applicants": return <ApplicantsPage />;
    case "public-staging": return <PublicStagingPage />;
    case "selection": return <SelectionPage />;
    case "offers": return <OffersPage />;
    case "plan": return <PlanBudgetPage />;
    case "demographics": return <DemographicsPage />;
    case "settings": return <RecruitmentSettingsPage />;
    case "reports": return <ReportsPage />;
    case "compliance": return <CompliancePage />;
    default: return <RecruitmentOverview />;
  }
}
