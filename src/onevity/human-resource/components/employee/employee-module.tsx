"use client";
// OneVity — Modul Karyawan: direktori, profil detail multi-tab
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateLong, tenure, genderLabel } from "@/onevity/shared/lib/api";
const todayISO = () => new Date().toISOString().slice(0, 10); // Task 69 — default tgl efektif
import { useNav } from "@/onevity/shared/lib/store";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { OnboardingWizard, DisciplinaryPage } from "@/onevity/human-resource/components/employee/employee-wizard";
import { OffboardingModule } from "@/onevity/human-resource/components/offboarding/offboarding-module";
import { OnboardingChecklistModule } from "@/onevity/human-resource/components/onboarding/onboarding-checklist-module";
import { EmployeeDirectory as DirectoryView } from "@/onevity/human-resource/components/employee/employee-directory";
import { EmployeeDocumentsView } from "@/onevity/human-resource/components/employee/employee-documents";
// wave 27 stub — diisi Task 27-b (Aset) & Task 27-f (Pengumuman)
import { AssetsModule } from "@/onevity/human-resource/components/assets/assets-module";
import { AnnouncementsView } from "@/onevity/human-resource/components/announcements/announcements-view";
import { EmployeeAvatar } from "@/onevity/human-resource/components/employee/employee-avatar";
import { EmployeeLetterIssueDialog, type ServiceTemplateRow } from "@/onevity/human-resource/components/employee/employee-letter-issue-dialog";
import { pkwtDurationLabel } from "@/onevity/human-resource/services/pkwt";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Users, Search, ChevronLeft, ChevronRight, ArrowLeft, Mail, Phone, MapPin, Pencil,
  User, Briefcase, Heart, GraduationCap, History, Scale, Plus, Trash2, Calendar, IdCard,
  Landmark, Banknote, Clock3, ArrowRight, Building2, FileText, LogOut, OctagonX, FileWarning,
  ClipboardEdit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

export function EmployeeModule({ view }: { view: string }) {
  if (view === "wizard") return <OnboardingWizard />;
  if (view === "disciplinary") return <DisciplinaryPage />;
  if (view === "documents") return <EmployeeDocumentsView />;
  // wave 27 stub — diisi Task 27-b (Aset) & Task 27-f (Pengumuman)
  if (view === "assets") return <AssetsModule />;
  if (view === "announcements") return <AnnouncementsView />;
  if (view === "offboarding") return <OffboardingModule />;
  // Task 65 — checklist onboarding per bagian (proses penyambutan karyawan baru)
  if (view === "onboarding-checklist") return <OnboardingChecklistModule />;
  if (view === "detail") return <EmployeeDetail />;
  return <DirectoryView />;
}

// ================= DETAIL =================
// Riwayat penempatan kerja (EmployeeAssignment)
interface AssignmentHistory {
  id: string;
  rowId: string; // Task 69 — id versi utk koreksi baris (PUT employee-detail)
  validFrom: string;
  validTo: string | null;
  changeReason: string;
  changeReasonLabel: string;
  sourceDocNo: string | null;
  notes: string | null;
  employmentStatus: string;
  workShift: string;
  baseSalary: number;
  orgUnit: { name: string; code: string } | null;
  position: { title: string; code: string } | null;
  grade: { code: string; name: string } | null;
  managerName: string | null;
  // Task 69 — id mentah per versi utk prefill dialog koreksi/ubah penempatan
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  managerId: string | null;
}

interface DetailEmp {
  id: string; employeeNo: string; fullName: string; gender: string;
  photoUrl: string | null;
  birthPlace: string | null; birthDate: string | null;
  nationalId: string | null; taxId: string | null; bpjsHealth: string | null; bpjsEmpSkill: string | null;
  maritalStatus: string | null; religion: string | null; bloodType: string | null;
  email: string | null; phone: string | null; address: string | null; city: string | null;
  bankName: string | null; bankAccount: string | null;
  employmentStatus: string; joinDate: string; endDate: string | null;
  // 26-b — PKWT PP 35/2021
  contractStart: string | null; contractEnd: string | null; renewalCount: number;
  pkwt: {
    isPkwt: boolean; daysRemaining: number | null; totalMonths: number | null;
    over5y: boolean; due: "overdue" | "critical" | "soon" | "watch" | "later" | null;
    renewals: number; start: string | null; end: string | null;
  };
  baseSalary: number; workShift: string; status: string;
  company: { name: string } | null;
  orgUnit: { name: string; code: string } | null;
  position: { title: string; code: string; level: string | null } | null;
  grade: { code: string; name: string; minSalary: number; maxSalary: number } | null;
  manager: { id: string; fullName: string; employeeNo: string; photoUrl: string | null; position: { title: string } | null } | null;
  directReports: { id: string; fullName: string; employeeNo: string; photoUrl: string | null; status: string; position: { title: string } | null }[];
  family: { id: string; relation: string; name: string; gender: string; birthDate: string | null; occupation: string | null; isDependent: boolean }[];
  education: { id: string; level: string; institution: string; major: string | null; startYear: number | null; endYear: number | null; gpa: number | null }[];
  experiences: { id: string; company: string; position: string; startDate: string | null; endDate: string | null; notes: string | null }[];
  disciplinary: { id: string; warningLevel: string; violation: string; sanction: string | null; issuedAt: string; expiresAt: string | null; notes: string | null }[];
  assignments: AssignmentHistory[];
}

// label EN paralel untuk tab detail (kunci tab = nilai internal, bukan data server)
const TAB_LABEL_EN: Record<string, string> = {
  personal: "Personal",
  work: "Work",
  family: "Family",
  education: "Education",
  experience: "Experience",
  discipline: "Discipline",
  letters: "Letters",
};

/** Baris riwayat surat karyawan (GET /api/onevity/letters?employeeId= — 26-a). */
interface LetterRow {
  id: string;
  refNo: string;
  category: string;
  templateKey: string;
  subject: string | null;
  issuedAt: string;
  employeeName: string;
  employeeNo: string;
  templateName: string;
  purpose: string | null;
};

function EmployeeDetail() {
  const { params, navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, refresh } = useApi<{ employee: DetailEmp }>(params.id ? `/api/onevity/employee-detail?id=${params.id}` : null);
  // 5-OFFBOARDING — proses offboarding berjalan utk karyawan ini (banner info di profil)
  const obBanner = useApi<{ offboardings: { id: string; status: string; lastDay: string | null; taskStats: { total: number; done: number } }[] }>(
    params.id ? `/api/onevity/offboarding?employeeId=${params.id}` : null,
  );
  const openOffboarding = obBanner.data?.offboardings.find((o) => o.status === "Open") ?? null;
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("personal");
  // Task 69 — perbaikan data pekerjaan tanpa Personnel Action (human error):
  // "Ubah Penempatan" (versi baru riwayat) + koreksi baris riwayat per langkah.
  const canUpdate = perms.can("hr", "directory", "update");
  const [placementOpen, setPlacementOpen] = useState(false);
  const [corrRow, setCorrRow] = useState<AssignmentHistory | null>(null);
  const opts = useApi<PlacementOpts>(params.id ? "/api/onevity/employee-options" : null);
  // 26-a — riwayat surat karyawan (LetterDocument by employee) + katalog template layanan
  const letters = useApi<{ letters: LetterRow[]; templates: ServiceTemplateRow[] }>(
    params.id ? `/api/onevity/letters?employeeId=${params.id}` : null,
  );
  const [issueOpen, setIssueOpen] = useState(false);

  if (loading && !data) {
    return <div><PageHeader eyebrow={t("Karyawan")} title={t("Profil Karyawan", "Employee Profile")} /><LoadingRows rows={6} /></div>;
  }
  if (!data?.employee) {
    return <EmptyState title={t("Karyawan tidak ditemukan", "Employee not found")} description={t("Kembali ke direktori dan pilih karyawan lain.", "Go back to the directory and pick another employee.")} />;
  }
  const e = data.employee;

  return (
    <div>
      <button onClick={() => navigate("employee", "directory")} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold ov-text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" /> {t("Kembali ke Direktori", "Back to Directory")}
      </button>

      {/* header card — hero penuh satu warna aksen (selaras card welcome dashboard) */}
      <Card className="relative mb-4 overflow-hidden rounded-3xl border-0 ov-hero ov-glow text-white">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <EmployeeAvatar
                name={e.fullName}
                photoUrl={e.photoUrl}
                size="xl"
                status={e.status}
                showStatus
                className="shadow-lg"
                ringClassName="ring-4 ring-white/30"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-extrabold text-white sm:text-2xl">{e.fullName}</h1>
                  <StatusPill status={e.status} />
                </div>
                <p className="mt-1 text-xs text-white/80">
                  <span className="font-mono font-bold">{e.employeeNo}</span> · {e.position?.title ?? "—"} · {e.orgUnit?.name ?? "—"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className="border border-white/25 bg-white/15 text-[10px] text-white backdrop-blur">{e.employmentStatus}</Badge>
                  {e.grade && <Badge className="border-white/25 bg-white/15 text-white backdrop-blur">{t("Grade {code}", "Grade {code}", { code: e.grade.code })}</Badge>}
                  <Badge className="border border-white/25 bg-white/15 text-[10px] text-white backdrop-blur">{t("Masa kerja {t}", "Tenure {t}", { t: tenure(e.joinDate) })}</Badge>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {perms.can("hr", "directory", "update") && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2 border-white/25 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white backdrop-blur">
                  <Pencil className="h-3.5 w-3.5" /> {t("Edit Data", "Edit Data")}
                </Button>
              )}
              {/* Task 69 — perbaikan penempatan tanpa Personnel Action */}
              {perms.can("hr", "directory", "update") && (
                <Button variant="outline" size="sm" onClick={() => setPlacementOpen(true)} className="gap-2 border-white/25 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white backdrop-blur">
                  <ClipboardEdit className="h-3.5 w-3.5" /> {t("Ubah Penempatan", "Change Placement")}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ContactChip icon={Mail} text={e.email ?? "—"} tone="solid" />
            <ContactChip icon={Phone} text={e.phone ?? "—"} tone="solid" />
            <ContactChip icon={MapPin} text={e.city ?? "—"} tone="solid" />
            <ContactChip icon={Banknote} text={fmtIDR(e.baseSalary)} tone="solid" />
          </div>
        </CardContent>
      </Card>

      {/* 26-b P0 — GUARD PKWT PP 35/2021 Pasal 8: durasi total > 5 tahun →
          wajib tawarkan konversi ke PKS (banner merah, mencolok). */}
      {e.pkwt.over5y && (
        <Card className="mb-4 rounded-2xl border-rose-300 bg-rose-50/80 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <OctagonX className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-rose-800 dark:text-rose-300">
                {t(
                  "Durasi PKWT melebihi 5 tahun — wajib konversi ke PKS (PP 35/2021 Pasal 8)",
                  "PKWT duration exceeds 5 years — conversion to a permanent contract required (PP 35/2021 Art. 8)",
                )}
              </p>
              <p className="text-[11px] text-rose-700/80 dark:text-rose-400/80">
                {t(
                  "Total {dur} sejak {start} ({renew} perpanjangan) — PKWT + seluruh perpanjangannya dibatasi maksimal 5 tahun; lewat itu perusahaan WAJIB menawarkan PKS. Terbitkan PA Perubahan Status → Permanent, atau lakukan PHK dengan penggantian hak.",
                  "Total {dur} since {start} ({renew} renewals) — a PKWT plus all its renewals is capped at 5 years; beyond that the employer MUST offer a permanent contract. Issue a Change Status personnel action → Permanent, or terminate with statutory compensation.",
                  { dur: pkwtDurationLabel(e.pkwt.totalMonths ?? 0), start: fmtDate(e.pkwt.start ?? e.joinDate), renew: String(e.pkwt.renewals) },
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 26-b P0 — warning akhir kontrak dekat (amber) */}
      {e.pkwt.isPkwt && (e.pkwt.due === "overdue" || e.pkwt.due === "critical" || e.pkwt.due === "soon") && !e.pkwt.over5y && (
        <Card className="mb-4 rounded-2xl border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
              <FileWarning className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                {e.pkwt.daysRemaining != null && e.pkwt.daysRemaining < 0
                  ? t("Kontrak PKWT sudah BERAKHIR {n} hari lalu — tindak lanjut segera", "PKWT contract ENDED {n} days ago — follow up immediately", { n: String(Math.abs(e.pkwt.daysRemaining)) })
                  : t("Kontrak PKWT berakhir dalam {n} hari", "PKWT contract ends in {n} days", { n: String(e.pkwt.daysRemaining ?? 0) })}
              </p>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                {t("Tanggal berakhir kontrak: {date} — siapkan perpanjangan (PA Perpanjangan Kontrak) atau penyelesaian.", "Contract end date: {date} — prepare a renewal (Contract Renewal personnel action) or settlement.", { date: fmtDate(e.pkwt.end) })}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5-OFFBOARDING — banner proses offboarding berjalan */}
      {openOffboarding && (
        <Card className="mb-4 rounded-2xl border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                <LogOut className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                  {t("Proses offboarding berjalan — {done}/{total} tugas clearance selesai", "Offboarding in progress — {done}/{total} clearance tasks done", { done: openOffboarding.taskStats.done, total: openOffboarding.taskStats.total })}
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                  {t("Hari terakhir kerja {date}", "Last working day {date}", { date: fmtDate(openOffboarding.lastDay) })}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate("employee", "offboarding", { id: openOffboarding.id })} className="gap-1.5 border-amber-300 bg-white font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-transparent dark:text-amber-400">
              {t("Buka Proses", "Open Process")} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* tabs — satu baris scrollable (tanpa wrap berantakan) */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-stone-100/90 p-1 [scrollbar-width:none] dark:bg-stone-800/70 [&::-webkit-scrollbar]:hidden">
          {([
            ["personal", "Personal", User],
            ["work", "Pekerjaan", Briefcase],
            ["family", "Keluarga", Heart],
            ["education", "Pendidikan", GraduationCap],
            ["experience", "Pengalaman", History],
            ["discipline", "Disiplin", Scale],
            ["letters", "Surat", FileText],
          ] as const).map(([id, label, Icon]) => (
            <TabsTrigger key={id} value={id} className="shrink-0 gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-stone-500 transition-all data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-stone-900/[0.06] dark:text-stone-400 dark:data-[state=active]:bg-stone-900 dark:data-[state=active]:ring-stone-100/10 [&[data-state=active]_[data-count]]:ov-tile">
              <Icon className="h-4 w-4" aria-hidden /> {t(label, TAB_LABEL_EN[id])}
              {id === "work" && e.assignments.length > 1 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.assignments.length}</span>}
              {id === "family" && e.family.length > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.family.length}</span>}
              {id === "education" && e.education.length > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.education.length}</span>}
              {id === "discipline" && e.disciplinary.length > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.disciplinary.length}</span>}
              {id === "letters" && (letters.data?.letters.length ?? 0) > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{letters.data!.letters.length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="personal">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-6">
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoItem icon={IdCard} label={t("NIK (KTP)", "NIK (ID Card)")} value={e.nationalId ?? "—"} mono />
                <InfoItem icon={IdCard} label={t("NPWP")} value={e.taxId ?? "—"} mono />
                <InfoItem icon={Heart} label={t("Status Pernikahan", "Marital Status")} value={e.maritalStatus ?? "—"} />
                <InfoItem icon={User} label={t("Jenis Kelamin", "Gender")} value={genderLabel(e.gender)} />
                <InfoItem icon={Calendar} label={t("Tempat, Tgl Lahir", "Place & Date of Birth")} value={[e.birthPlace, fmtDate(e.birthDate)].filter(Boolean).join(", ") || "—"} />
                <InfoItem icon={User} label={t("Agama", "Religion")} value={e.religion ?? "—"} />
                <InfoItem icon={Plus} label={t("Gol. Darah", "Blood Type")} value={e.bloodType ?? "—"} />
                <InfoItem icon={Landmark} label={t("BPJS Kesehatan", "BPJS Health")} value={e.bpjsHealth ?? "—"} mono />
                <InfoItem icon={Landmark} label={t("BPJS Ketenagakerjaan", "BPJS Employment")} value={e.bpjsEmpSkill ?? "—"} mono />
                <InfoItem icon={Landmark} label={t("Bank")} value={e.bankName ?? "—"} />
                <InfoItem icon={Landmark} label={t("No. Rekening", "Account No.")} value={e.bankAccount ?? "—"} mono />
                <InfoItem icon={MapPin} label={t("Alamat")} value={[e.address, e.city].filter(Boolean).join(", ") || "—"} span />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardContent className="p-6">
                  <p className="mb-4 text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{t("Penempatan Saat Ini", "Current Placement")}</p>
                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <InfoItem icon={Briefcase} label={t("Posisi")} value={e.position?.title ?? "—"} />
                    <InfoItem icon={Users} label={t("Unit Organisasi")} value={e.orgUnit?.name ?? "—"} />
                    <InfoItem icon={GraduationCap} label={t("Grade")} value={e.grade ? `${e.grade.code} — ${e.grade.name}` : "—"} />
                    <InfoItem icon={Clock3} label={t("Status Kepegawaian", "Employment Status")} value={e.employmentStatus} />
                    <InfoItem icon={Calendar} label={t("Tanggal Masuk", "Join Date")} value={fmtDateLong(e.joinDate)} />
                    {e.endDate && <InfoItem icon={Calendar} label={t("Tanggal Keluar", "End Date")} value={fmtDateLong(e.endDate)} />}
                    <InfoItem icon={Clock3} label={t("Jadwal Kerja", "Work Schedule")} value={e.workShift} />
                    <InfoItem icon={Banknote} label={t("Gaji Pokok")} value={fmtIDR(e.baseSalary)} />
                    {/* 26-b — kontrak PKWT (PP 35/2021) */}
                    {e.pkwt.isPkwt && (
                      <>
                        <InfoItem icon={Calendar} label={t("Mulai Kontrak PKWT", "PKWT Contract Start")} value={e.contractStart ? fmtDateLong(e.contractStart) : "—"} />
                        <InfoItem
                          icon={Calendar}
                          label={t("Berakhir Kontrak PKWT", "PKWT Contract End")}
                          value={e.contractEnd ? fmtDateLong(e.contractEnd) : "—"}
                          hint={e.pkwt.daysRemaining != null
                            ? (e.pkwt.daysRemaining < 0
                              ? t("Lewat {n} hari", "Overdue {n} days", { n: String(Math.abs(e.pkwt.daysRemaining)) })
                              : t("Sisa {n} hari", "{n} days left", { n: String(e.pkwt.daysRemaining) }))
                            : undefined}
                          hintTone={e.pkwt.daysRemaining != null && e.pkwt.daysRemaining <= 7
                            ? "text-rose-600 dark:text-rose-400"
                            : e.pkwt.daysRemaining != null && e.pkwt.daysRemaining <= 30
                              ? "text-amber-600 dark:text-amber-400"
                              : undefined}
                        />
                        <InfoItem icon={FileText} label={t("Jumlah Perpanjangan", "Renewal Count")} value={String(e.renewalCount ?? 0)} />
                        {e.pkwt.totalMonths != null && (
                          <InfoItem
                            icon={Scale}
                            label={t("Total Durasi PKWT", "Total PKWT Duration")}
                            value={pkwtDurationLabel(e.pkwt.totalMonths)}
                            hint={e.pkwt.over5y
                              ? t("> 5 tahun — wajib konversi PKS", "> 5 years — permanent conversion due")
                              : t("batas 5 tahun (Pasal 8)", "5-year cap (Art. 8)")}
                            hintTone={e.pkwt.over5y ? "text-rose-600 dark:text-rose-400" : undefined}
                          />
                        )}
                      </>
                    )}
                    {e.grade && (
                      <div className="sm:col-span-2">
                        <InfoItem icon={GraduationCap} label={t("Rentang Grade", "Grade Range")} value={`${fmtIDR(e.grade.minSalary)} — ${fmtIDR(e.grade.maxSalary)}`} />
                        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                          <div className="absolute inset-y-0 rounded-full ov-chart" style={{
                            left: `${Math.max((e.baseSalary - e.grade.minSalary) / (e.grade.maxSalary - e.grade.minSalary || 1) * 100, 2)}%`,
                            width: "14%",
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <AssignmentTimeline assignments={e.assignments} canUpdate={canUpdate} onCorrect={setCorrRow} />
            </div>
            <div className="space-y-4">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold">{t("Atasan Langsung", "Direct Manager")}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {e.manager ? (
                    <button onClick={() => navigate("employee", "detail", { id: e.manager!.id })} className="flex w-full items-center gap-3 rounded-xl border border-stone-100 p-3 text-left transition hover:ov-border-accent dark:border-stone-800">
                      <EmployeeAvatar name={e.manager.fullName} photoUrl={e.manager.photoUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{e.manager.fullName}</p>
                        <p className="truncate text-[11px] text-stone-400">{e.manager.position?.title ?? "—"}</p>
                      </div>
                    </button>
                  ) : <p className="text-xs text-stone-400">{t("Tidak ada atasan (top level)", "No manager (top level)")}</p>}
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold">{t("Bawahan Langsung ({n})", "Direct Reports ({n})", { n: e.directReports.length })}</CardTitle>
                </CardHeader>
                <CardContent className="max-h-64 space-y-2 overflow-y-auto pt-0">
                  {e.directReports.length > 0 ? e.directReports.map((r) => (
                    <button key={r.id} onClick={() => navigate("employee", "detail", { id: r.id })} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <EmployeeAvatar name={r.fullName} photoUrl={r.photoUrl} size="xs" status={r.status} showStatus />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold">{r.fullName}</p>
                        <p className="truncate text-[10px] text-stone-400">{r.position?.title ?? "—"}</p>
                      </div>
                    </button>
                  )) : <p className="text-xs text-stone-400">{t("Tidak memiliki bawahan", "No direct reports")}</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="family">
          <ListSection
            title={t("Data Keluarga", "Family Data")}
            addLabel={t("Tambah Anggota", "Add Member")}
            items={e.family.map((f) => ({
              id: f.id,
              title: f.name,
              subtitle: `${f.relation} · ${f.gender === "F" ? t("Perempuan", "Female") : t("Laki-laki", "Male")}${f.birthDate ? ` · ${fmtDate(f.birthDate)}` : ""}`,
              right: [f.occupation ?? "", f.isDependent ? t("Dependen", "Dependent") : t("Non-dependen", "Non-dependent")].filter(Boolean).join(" · ") || "—",
              onDelete: async () => {
                // Task 50: hapus keluarga TIDAK mengubah PTKP efektif — saran
                // baru berlaku 1 Jan tahun depan (ptkpPending, tanpa tulis DB).
                const r = (await apiSend(`/api/onevity/family?id=${f.id}`, "DELETE")) as { ptkpPending?: { current: string; next: string; nextYear: number } | null };
                if (r?.ptkpPending && r.ptkpPending.next !== r.ptkpPending.current) {
                  toast.success(t(
                    "Anggota keluarga dihapus — PTKP akan menjadi {s} pada 1 Jan {y} (perubahan berlaku tahun depan)",
                    "Family member deleted — PTKP will become {s} on Jan 1, {y} (change takes effect next year)",
                    { s: r.ptkpPending.next, y: r.ptkpPending.nextYear },
                  ));
                } else {
                  toast.success(t("Anggota keluarga dihapus", "Family member deleted"));
                }
                refresh();
              },
            }))}
            renderAdd={(close) => <AddFamilyDialog employeeId={e.id} onSaved={() => { close(); refresh(); }} />}
          />
        </TabsContent>

        <TabsContent value="education">
          <ListSection
            title={t("Riwayat Pendidikan", "Education History")}
            addLabel={t("Tambah Pendidikan", "Add Education")}
            items={e.education.map((ed) => ({
              id: ed.id,
              title: `${ed.level} — ${ed.institution}`,
              subtitle: [ed.major, ed.startYear && ed.endYear ? `${ed.startYear}–${ed.endYear}` : null].filter(Boolean).join(" · ") || "—",
              right: ed.gpa ? t("IPK {g}", "GPA {g}", { g: ed.gpa }) : "",
              onDelete: async () => { await apiSend(`/api/onevity/education?id=${ed.id}`, "DELETE"); toast.success(t("Pendidikan dihapus", "Education deleted")); refresh(); },
            }))}
            renderAdd={(close) => <AddEducationDialog employeeId={e.id} onSaved={() => { close(); refresh(); }} />}
          />
        </TabsContent>

        <TabsContent value="experience">
          <ListSection
            title={t("Pengalaman Kerja", "Work Experience")}
            addLabel={t("Tambah Pengalaman", "Add Experience")}
            items={e.experiences.map((x) => ({
              id: x.id,
              title: `${x.position} — ${x.company}`,
              subtitle: x.startDate && x.endDate ? `${fmtDate(x.startDate)} – ${fmtDate(x.endDate)}` : "—",
              right: x.notes ?? "",
              onDelete: async () => { await apiSend(`/api/onevity/experiences?id=${x.id}`, "DELETE"); toast.success(t("Pengalaman dihapus", "Experience deleted")); refresh(); },
            }))}
            renderAdd={(close) => <AddExperienceDialog employeeId={e.id} onSaved={() => { close(); refresh(); }} />}
          />
        </TabsContent>

        <TabsContent value="discipline">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><Scale className="h-4 w-4 ov-text-accent" /> {t("Catatan Disiplin")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {e.disciplinary.length > 0 ? (
                <ol className="relative ml-2 space-y-4 border-l border-stone-200 pl-6 dark:border-stone-800">
                  {e.disciplinary.map((d) => (
                    <li key={d.id} className="relative">
                      <span className={cn("absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white dark:ring-stone-950",
                        d.warningLevel === "Final" ? "bg-rose-100 dark:bg-rose-500/20" : d.warningLevel === "Written" ? "bg-orange-100 dark:bg-orange-500/20" : "bg-amber-100 dark:bg-amber-500/20")}>
                        <Scale className="h-2.5 w-2.5 text-stone-600 dark:text-stone-300" />
                      </span>
                      <div className="rounded-xl border border-stone-100 p-3 dark:border-stone-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn("text-[10px] font-bold",
                            d.warningLevel === "Final" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400" :
                            d.warningLevel === "Written" ? "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400" :
                            "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400")}>
                            {d.warningLevel}
                          </Badge>
                          <span className="text-xs font-bold">{d.violation}</span>
                          <span className="ml-auto text-[10px] text-stone-400">{fmtDate(d.issuedAt)}</span>
                        </div>
                        {d.sanction && <p className="mt-1 text-[11px] text-stone-500">{t("Sanksi: {s}", "Sanction: {s}", { s: d.sanction })}</p>}
                        {d.expiresAt && <p className="text-[10px] text-stone-400">{t("Berlaku s.d. {d}", "Valid until {d}", { d: fmtDate(d.expiresAt) })}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="rounded-xl border border-dashed ov-border-accent ov-soft p-6 text-center">
                  <p className="text-sm font-bold ov-text-accent">{t("Rekam jejak bersih ✨", "Clean record ✨")}</p>
                  <p className="mt-0.5 text-xs text-stone-400">{t("Tidak ada catatan pelanggaran untuk karyawan ini.", "No violation records for this employee.")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 26-a: riwayat surat karyawan (LetterDocument by employee) ===== */}
        <TabsContent value="letters">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <FileText className="h-4 w-4 ov-text-accent" /> {t("Riwayat Surat", "Letter History")}
              </CardTitle>
              {perms.can("hr", "directory", "create") && (
                <Button size="sm" onClick={() => setIssueOpen(true)} className="gap-2 font-bold">
                  <FileText className="h-3.5 w-3.5" /> {t("Terbitkan Surat", "Issue Letter")}
                </Button>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              {letters.loading && !letters.data ? (
                <div className="py-6"><LoadingRows rows={3} /></div>
              ) : (letters.data?.letters.length ?? 0) === 0 ? (
                <EmptyState
                  title={t("Belum ada surat diterbitkan", "No letters issued yet")}
                  description={t(
                    "Surat keterangan kerja, gaji, pengalaman, referensi, dan PKWT untuk karyawan ini tampil di sini.",
                    "Employment, salary, experience, reference letters and PKWT for this employee appear here.",
                  )}
                  icon={FileText}
                />
              ) : (
                <ul className="divide-y divide-stone-100 dark:divide-stone-800/70">
                  {letters.data!.letters.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-stone-800 dark:text-stone-100">
                          {l.templateName}
                          <span className="font-mono text-[11px] font-semibold text-stone-400">{l.refNo}</span>
                          {l.category === "EmployeeService" && (
                            <Badge variant="outline" className="rounded-full px-2 text-[10px] font-bold text-stone-400">
                              {t("Layanan", "Service")}
                            </Badge>
                          )}
                        </p>
                        <p className="text-[11px] text-stone-400">
                          {fmtDate(l.issuedAt)}
                          {l.purpose ? ` · ${t("keperluan", "for")} ${l.purpose}` : ""}
                        </p>
                      </div>
                      <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
                        <a href={`/api/onevity/letters/${l.id}/pdf?download=1`} download>
                          {t("Unduh PDF", "Download PDF")}
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditEmployeeDialog open={editOpen} setOpen={(v) => { setEditOpen(v); if (!v) refresh(); }} employee={e} />
      {/* Task 69 — ubah penempatan aktif (tanpa PA; tercatat sbg riwayat ManualEdit) */}
      {canUpdate && placementOpen && (
        <PlacementChangeDialog
          open={placementOpen}
          setOpen={setPlacementOpen}
          employee={e}
          opts={opts.data ?? null}
          onSaved={() => refresh()}
        />
      )}
      {/* Task 69 — koreksi satu baris riwayat (salah ketik; tanpa movement); key=rowId → form prefill ulang per baris */}
      {corrRow && (
        <CorrectJobRowDialog
          key={corrRow.rowId}
          row={corrRow}
          onClose={() => setCorrRow(null)}
          opts={opts.data ?? null}
          onSaved={() => refresh()}
        />
      )}

      {/* 26-a — dialog terbitkan surat layanan (pilih jenis + keperluan + pratinjau live) */}
      <EmployeeLetterIssueDialog
        employee={{
          id: e.id, fullName: e.fullName, employeeNo: e.employeeNo,
          nationalId: e.nationalId, birthPlace: e.birthPlace, birthDate: e.birthDate,
          address: e.address, city: e.city, joinDate: e.joinDate,
          employmentStatus: e.employmentStatus, baseSalary: e.baseSalary,
          position: e.position, orgUnit: e.orgUnit, grade: e.grade, company: e.company,
        }}
        templates={letters.data?.templates ?? []}
        open={issueOpen}
        setOpen={setIssueOpen}
        onIssued={() => letters.refresh()}
      />
    </div>
  );
}

// ================= TIMELINE RIWAYAT PEKERJAAN =================
const REASON_TONE: Record<string, string> = {
  Initial: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
  Promotion: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Demotion: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Transfer: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Mutation: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  SalaryAdjustment: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  ChangeStatus: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
  ContractRenewal: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  ExtendProbation: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  ManualEdit: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
};

// Task 69 — timeline riwayat pekerjaan: tiap langkah menandai field apa yang
// berubah vs periode sebelumnya (chip), dan (bila boleh) bisa dikoreksi bila
// datanya salah ketik/human error — tanpa perlu Personnel Action.
function AssignmentTimeline({ assignments, canUpdate, onCorrect }: { assignments: AssignmentHistory[]; canUpdate: boolean; onCorrect?: (a: AssignmentHistory) => void }) {
  const { t } = useI18n();
  if (assignments.length === 0) return null;
  const period = (a: AssignmentHistory) =>
    a.validTo ? `${fmtDate(a.validFrom)} — ${fmtDate(a.validTo)}` : `${fmtDate(a.validFrom)} — ${t("sekarang", "present")}`;

  // deteksi field yang berubah dibanding periode sebelumnya (lebih tua)
  const diffChips = (idx: number): string[] => {
    const cur = assignments[idx]!;
    const prev = assignments[idx + 1];
    if (!prev) return [];
    const chips: string[] = [];
    if (cur.position?.title !== prev.position?.title) chips.push(t("Posisi", "Position"));
    if (cur.orgUnit?.name !== prev.orgUnit?.name) chips.push(t("Unit", "Unit"));
    if (cur.grade?.code !== prev.grade?.code) chips.push(t("Grade"));
    if (cur.employmentStatus !== prev.employmentStatus) chips.push(t("Status"));
    if (cur.workShift !== prev.workShift) chips.push(t("Shift", "Shift"));
    if (cur.baseSalary !== prev.baseSalary) chips.push(t("Upah", "Salary"));
    if (cur.managerName !== prev.managerName) chips.push(t("Atasan", "Manager"));
    return chips;
  };

  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <History className="h-4 w-4 ov-text-accent" /> {t("Riwayat Pekerjaan", "Work History")}
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{t("{n} periode", "{n} periods", { n: assignments.length })}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="relative ml-2 space-y-0 border-l border-stone-200 pl-5 dark:border-stone-800">
          {assignments.map((a, i) => {
            const active = a.validTo === null;
            const chips = diffChips(i);
            return (
              <li key={a.id} className="relative pb-5 last:pb-0">
                {/* titik timeline */}
                <span className={cn(
                  "absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full",
                  active
                    ? "ov-fill ov-glow"
                    : "border-2 border-stone-300 bg-white ring-4 ring-white dark:border-stone-600 dark:bg-stone-900 dark:ring-stone-900",
                )} />
                <div className={cn(
                  "rounded-xl border p-3.5 transition",
                  active
                    ? "ov-border-accent ov-soft"
                    : "border-stone-200/80 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-transparent dark:hover:border-stone-700",
                )}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold", REASON_TONE[a.changeReason] ?? REASON_TONE.Initial)}>
                      {a.changeReasonLabel ?? a.changeReason}
                    </span>
                    <span className={cn("text-[11px] font-bold", active ? "ov-text-accent" : "text-stone-500 dark:text-stone-400")}>{period(a)}</span>
                    {active && <span className="rounded-full ov-fill px-2 py-0.5 text-[9px] font-extrabold tracking-wide">{t("SAAT INI", "CURRENT")}</span>}
                    {a.sourceDocNo && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-stone-400" title={t("Dokumen sumber", "Source document")}>
                        <FileText className="h-3 w-3" /> {a.sourceDocNo}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-bold text-stone-800 dark:text-stone-200">
                    {a.position?.title ?? "—"}
                    <span className="font-normal text-stone-400"> · {a.orgUnit?.name ?? "—"}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className="inline-flex items-center gap-1"><GraduationCap className="h-3 w-3" /> {a.grade ? t("Grade {code}", "Grade {code}", { code: a.grade.code }) : "—"}</span>
                    <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {a.employmentStatus}</span>
                    <span className="inline-flex items-center gap-1"><Banknote className="h-3 w-3" /> {fmtIDR(a.baseSalary)}</span>
                    {a.managerName && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {t("Atasan: {n}", "Manager: {n}", { n: a.managerName })}</span>}
                    {a.workShift !== "Regular" && <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {a.workShift}</span>}
                  </div>
                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-stone-400">{t("Berubah:", "Changed:")}</span>
                      {chips.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                          <ArrowRight className="h-2.5 w-2.5" /> {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.notes && <p className="mt-2 text-[11px] italic text-stone-400">{a.notes}</p>}
                  {canUpdate && onCorrect && (
                    <div className="mt-2.5 flex justify-end border-t border-dashed border-stone-200 pt-2 dark:border-stone-800">
                      <button
                        type="button"
                        onClick={() => onCorrect(a)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-stone-400 transition hover:bg-stone-100 hover:ov-text-accent dark:hover:bg-stone-800"
                        title={t("Perbaiki data langkah ini bila salah ketik", "Fix a typo in this step's data")}
                      >
                        <Pencil className="h-3 w-3" /> {t("Koreksi", "Correct")}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function ContactChip({ icon: Icon, text, tone = "outline" }: { icon: React.ElementType; text: string; tone?: "outline" | "solid" }) {
  if (tone === "solid") {
    // di atas hero penuh — kaca putih translusen
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
        <Icon className="h-3.5 w-3.5 shrink-0 text-white" />
        <span className="truncate">{text}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
      <Icon className="h-3.5 w-3.5 shrink-0 ov-text-accent" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function InfoItem({ icon: Icon, label, value, mono, span, hint, hintTone }: { icon: React.ElementType; label: string; value: string; mono?: boolean; span?: boolean; hint?: string; hintTone?: string }) {
  return (
    <div className={cn("flex items-start gap-3", span && "sm:col-span-2 lg:col-span-3")}>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ov-tile">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
        <p className={cn("break-words text-[13px] font-semibold text-stone-800 dark:text-stone-200", mono && "font-mono")}>{value}</p>
        {hint && (
          <p className={cn("mt-0.5 text-[10px] font-bold", hintTone ?? "text-stone-400")}>{hint}</p>
        )}
      </div>
    </div>
  );
}

function ListSection({ title, addLabel, items, renderAdd }: {
  title: string; addLabel: string;
  items: { id: string; title: string; subtitle: string; right: string; onDelete: () => Promise<void> }[];
  renderAdd: (close: () => void) => React.ReactNode;
}) {
  const perms = useMenuPerms();
  const { t } = useI18n();
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-bold">{title}</CardTitle>
        {perms.can("hr", "directory", "create") && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1.5 text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> {addLabel}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        {items.length > 0 ? items.map((it) => (
          <div key={it.id} className="group flex items-center gap-3 rounded-xl border border-stone-100 p-3.5 transition hover:ov-border-accent dark:border-stone-800">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-stone-800 dark:text-stone-200">{it.title}</p>
              <p className="truncate text-[11px] text-stone-400">{it.subtitle}</p>
              {it.right && <p className="truncate text-[11px] font-semibold ov-text-accent">{it.right}</p>}
            </div>
            {perms.can("hr", "directory", "delete") && (
              <button
                onClick={async () => { setBusyId(it.id); try { await it.onDelete(); } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); } }}
                disabled={busyId === it.id}
                className="rounded-lg p-2 text-stone-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-rose-500/10"
                aria-label={t("Hapus")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )) : (
          <EmptyState title={t("Belum ada data", "No data yet")} description={t("Tambahkan data baru dengan tombol di atas.", "Add new data using the button above.")} />
        )}
      </CardContent>
      {addOpen && renderAdd(() => setAddOpen(false))}
    </Card>
  );
}

function AddFamilyDialog({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [relation, setRelation] = useState("Spouse");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("F");
  const [occupation, setOccupation] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const submit = async () => {
    if (!name.trim()) { toast.error(t("Nama wajib diisi", "Name is required")); return; }
    setBusy(true);
    try {
      // Task 50: respons membawa ptkpPending (profil bersumber "auto") —
      // saran dari data keluarga BARU, TANPA menulis PTKP efektif: perubahan
      // berlaku pada refresh 1 Januari tahun berikutnya.
      const r = (await apiSend("/api/onevity/family", "POST", { employeeId, relation, name, gender, occupation: occupation || null })) as { ptkpPending?: { current: string; next: string; nextYear: number } | null };
      if (r?.ptkpPending && r.ptkpPending.next !== r.ptkpPending.current) {
        toast.success(t(
          "Anggota keluarga ditambahkan — PTKP akan menjadi {s} pada 1 Jan {y} (perubahan berlaku tahun depan)",
          "Family member added — PTKP will become {s} on Jan 1, {y} (change takes effect next year)",
          { s: r.ptkpPending.next, y: r.ptkpPending.nextYear },
        ));
      } else {
        toast.success(t("Anggota keluarga ditambahkan", "Family member added"));
      }
      setOpen(false); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onSaved(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="text-base">{t("Tambah Anggota Keluarga", "Add Family Member")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{t("Hubungan", "Relation")}</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{["Spouse", "Child", "Parent", "Sibling"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Jenis Kelamin", "Gender")}</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="M">{t("Laki-laki", "Male")}</SelectItem><SelectItem value="F">{t("Perempuan", "Female")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Nama")} *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Pekerjaan", "Occupation")}</Label>
            <Input value={occupation} onChange={(e) => setOccupation(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onSaved(); }}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEducationDialog({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [level, setLevel] = useState("S1");
  const [institution, setInstitution] = useState("");
  const [major, setMajor] = useState("");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [gpa, setGpa] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const submit = async () => {
    if (!institution.trim()) { toast.error(t("Institusi wajib diisi", "Institution is required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/education", "POST", { employeeId, level, institution, major: major || null, startYear: startYear || null, endYear: endYear || null, gpa: gpa || null });
      toast.success(t("Pendidikan ditambahkan", "Education added"));
      setOpen(false); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onSaved(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="text-base">{t("Tambah Pendidikan", "Add Education")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{t("Jenjang", "Level")}</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{["SMA", "D3", "S1", "S2", "S3"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Institusi")} *</Label>
            <Input value={institution} onChange={(e) => setInstitution(e.target.value)} className="mt-1.5" placeholder={t("cth: Universitas Indonesia", "e.g. Universitas Indonesia")} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Jurusan", "Major")}</Label>
            <Input value={major} onChange={(e) => setMajor(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Tahun Mulai", "Start Year")}</Label>
            <Input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} className="mt-1.5" placeholder="2016" />
          </div>
          <div>
            <Label className="text-xs">{t("Tahun Selesai", "End Year")}</Label>
            <Input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} className="mt-1.5" placeholder="2020" />
          </div>
          <div>
            <Label className="text-xs">{t("IPK", "GPA")}</Label>
            <Input type="number" step="0.01" value={gpa} onChange={(e) => setGpa(e.target.value)} className="mt-1.5" placeholder="3.45" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onSaved(); }}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExperienceDialog({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const submit = async () => {
    if (!company.trim() || !position.trim()) { toast.error(t("Perusahaan & posisi wajib diisi", "Company & position are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/experiences", "POST", { employeeId, company, position, notes: notes || null });
      toast.success(t("Pengalaman ditambahkan", "Experience added"));
      setOpen(false); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onSaved(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="text-base">{t("Tambah Pengalaman Kerja", "Add Work Experience")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("Perusahaan", "Company")} *</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1.5" placeholder={t("cth: PT Astra International", "e.g. PT Astra International")} />
          </div>
          <div>
            <Label className="text-xs">{t("Posisi")} *</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} className="mt-1.5" placeholder={t("cth: Staff Akuntansi", "e.g. Accounting Staff")} />
          </div>
          <div>
            <Label className="text-xs">{t("Catatan")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onSaved(); }}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// label EN paralel untuk grid form Edit Data (kunci = field form)
const EDIT_FIELD_LABEL_EN: Record<string, string> = {
  "Nama Lengkap": "Full Name",
  NIK: "NIK",
  NPWP: "NPWP",
  Email: "Email",
  Telepon: "Phone",
  "Status Pernikahan": "Marital Status",
  Agama: "Religion",
  "Gol. Darah": "Blood Type",
  Kota: "City",
  Alamat: "Address",
};

function EditEmployeeDialog({ open, setOpen, employee }: { open: boolean; setOpen: (v: boolean) => void; employee: DetailEmp }) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>({
    fullName: employee.fullName, email: employee.email ?? "", phone: employee.phone ?? "",
    address: employee.address ?? "", city: employee.city ?? "",
    maritalStatus: employee.maritalStatus ?? "", religion: employee.religion ?? "",
    bloodType: employee.bloodType ?? "", nationalId: employee.nationalId ?? "", taxId: employee.taxId ?? "",
    // 26-b — PKWT (PP 35/2021): hanya relevan utk Contract/Probation/Outsourcing
    contractStart: employee.contractStart ? employee.contractStart.slice(0, 10) : "",
    contractEnd: employee.contractEnd ? employee.contractEnd.slice(0, 10) : "",
    renewalCount: String(employee.renewalCount ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isPkwt = ["Contract", "Probation", "Outsourcing"].includes(employee.employmentStatus);

  const submit = async () => {
    if (isPkwt && form.contractStart && form.contractEnd && form.contractEnd <= form.contractStart) {
      toast.error(t("Tanggal berakhir kontrak harus setelah tanggal mulai", "Contract end date must be after the start date"));
      return;
    }
    setBusy(true);
    try {
      await apiSend(`/api/onevity/employee-detail?id=${employee.id}`, "PATCH", {
        ...form,
        ...(isPkwt ? {
          contractStart: form.contractStart || null,
          contractEnd: form.contractEnd || null,
          renewalCount: Number(form.renewalCount) || 0,
        } : {}),
      });
      toast.success(t("Data karyawan diperbarui", "Employee data updated"));
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">{t("Edit Data — {name}", "Edit Data — {name}", { name: employee.fullName })}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["fullName", "Nama Lengkap"], ["nationalId", "NIK"], ["taxId", "NPWP"],
            ["email", "Email"], ["phone", "Telepon"], ["maritalStatus", "Status Pernikahan"],
            ["religion", "Agama"], ["bloodType", "Gol. Darah"], ["city", "Kota"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <Label className="text-xs">{t(label, EDIT_FIELD_LABEL_EN[label])}</Label>
              <Input value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} className="mt-1.5" />
            </div>
          ))}
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Alamat")}</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} className="mt-1.5" />
          </div>

          {/* 26-b — PKWT: tanggal kontrak & jumlah perpanjangan */}
          {isPkwt && (
            <>
              <div className="sm:col-span-2 mt-1 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                <FileWarning className="h-3.5 w-3.5" /> {t("Kontrak PKWT — PP 35/2021 (status {s})", "PKWT Contract — PP 35/2021 (status {s})", { s: employee.employmentStatus })}
              </div>
              <div>
                <Label className="text-xs">{t("Mulai Kontrak", "Contract Start")}</Label>
                <Input type="date" value={form.contractStart} onChange={(e) => set("contractStart", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs">{t("Berakhir Kontrak", "Contract End")}</Label>
                <Input type="date" value={form.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs">{t("Jumlah Perpanjangan", "Renewal Count")}</Label>
                <Input type="number" min={0} value={form.renewalCount} onChange={(e) => set("renewalCount", e.target.value.replace(/\D/g, ""))} className="mt-1.5 font-mono" />
              </div>
              <div className="self-end text-[10.5px] leading-relaxed text-stone-400">
                {t("Konversi ke Permanent dilakukan lewat PA Perubahan Status — jejak PKWT otomatis dikosongkan.", "Conversion to Permanent is done via a Change Status personnel action — the PKWT record is cleared automatically.")}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan Perubahan", "Save Changes")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Task 69 — dialog "Ubah Penempatan" — perbaikan penempatan aktif TANPA Personnel
// Action (kesalahan input saat onboarding/wizard dsb). Terkirim sebagai versi
// riwayat BARU dengan alasan "Perubahan Manual" (ManualEdit), jejak lengkap
// (kronologis, bisa diaudit) dan tidak mengubah versi lama.
type PlacementOpts = { orgUnits: { id: string; name: string }[]; positions: { id: string; title: string; orgUnitId: string | null }[]; grades: { id: string; code: string; name: string }[]; managers: { id: string; fullName: string; employeeNo: string }[] };

function PlacementChangeDialog({ open, setOpen, employee, opts, onSaved }: {
  open: boolean; setOpen: (v: boolean) => void; employee: DetailEmp; opts: PlacementOpts | null; onSaved: () => void;
}) {
  const { t } = useI18n();
  // prefill berjalan via useState initializer (bukan effect — react-hooks rule)
  const formInit = () => {
    const a = employee.assignments.find((x) => x.validTo === null);
    return {
      effectiveDate: todayISO(),
      orgUnitId: a?.orgUnitId ?? "none",
      positionId: a?.positionId ?? "none",
      gradeId: a?.gradeId ?? "none",
      managerId: a?.managerId ?? "none",
      baseSalary: a?.baseSalary != null ? String(a.baseSalary) : "",
      notes: "",
    };
  };
  const [form, setForm] = useState(formInit);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const cur = employee.assignments.find((a) => a.validTo === null) ?? null;

  const submit = async () => {
    if (!cur) return;
    if (!form.effectiveDate) return void toast.error(t("Tanggal efektif wajib diisi"));
    const body: Record<string, unknown> = { employeeId: employee.id, effectiveDate: form.effectiveDate, notes: form.notes || "Koreksi penempatan tanpa PA" };
    if (form.orgUnitId !== "none") body.orgUnitId = form.orgUnitId;
    if (form.positionId !== "none") body.positionId = form.positionId;
    if (form.gradeId !== "none") body.gradeId = form.gradeId;
    if (form.managerId !== "none") body.managerId = form.managerId;
    if (form.baseSalary && Number(form.baseSalary) !== cur.baseSalary) body.baseSalary = Number(form.baseSalary);
    setBusy(true);
    try {
      await apiSend("/api/onevity/employee-detail", "PUT", body);
      toast.success(t("Penempatan diperbarui — tercatat sebagai Perubahan Manual di riwayat", "Placement updated — recorded as a Manual Change in work history"));
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardEdit className="h-4 w-4 ov-text-accent" /> {t("Ubah Penempatan (Tanpa PA)", "Change Placement (No PA)")}
          </DialogTitle>
        </DialogHeader>
        {!cur ? (
          <p className="text-sm text-stone-500">{t("Tidak ada penempatan aktif.", "No active placement.")}</p>
        ) : (
          <>
            <p className="rounded-lg ov-soft px-3 py-2 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              {t(
                "Perbaikan penempatan tanpa Personnel Action — hanya isi field yang salah. Perubahan tercatat sebagai versi riwayat baru (Perubahan Manual), bisa diaudit.",
                "Placement fix without a personnel action — fill only the wrong fields. Recorded as a new history version (Manual Change), fully auditable.",
              )}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{t("Tanggal Efektif", "Effective Date")}</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs">{t("Unit Kerja", "Org Unit")}</Label>
                <Select value={form.orgUnitId} onValueChange={(v) => set("orgUnitId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.orgUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Posisi", "Position")}</Label>
                <Select value={form.positionId} onValueChange={(v) => set("positionId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Grade", "Grade")}</Label>
                <Select value={form.gradeId} onValueChange={(v) => set("gradeId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Atasan Langsung", "Direct Manager")}</Label>
                <Select value={form.managerId} onValueChange={(v) => set("managerId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} ({m.employeeNo})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Upah Pokok (Rp)", "Base Salary (IDR)")}</Label>
                <Input inputMode="numeric" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value.replace(/[^\d]/g, ""))} placeholder={t("— tidak diubah", "— unchanged")} className="mt-1.5 font-mono" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("Catatan", "Notes")}</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("Koreksi penempatan tanpa PA", "Placement fix without PA")} className="mt-1.5" />
              </div>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy || !cur} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Task 69 — koreksi SATU baris riwayat (nilai salah ketik di masa lalu; tanpa
// movement): guard server menolak mengubah baris aktif — gunakan "Ubah
// Penempatan". Field dikosongkan = tidak diubah.
function CorrectJobRowDialog({ row, onClose, opts, onSaved }: {
  row: AssignmentHistory | null; onClose: () => void; opts: PlacementOpts | null; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const formInit = (r: AssignmentHistory | null) => ({
    effectiveDate: r ? r.validFrom.slice(0, 10) : "",
    orgUnitId: "none",
    positionId: "none",
    gradeId: "none",
    managerId: "none",
    baseSalary: "",
    notes: "",
  });
  // prefill dari row terpilih via initializer — dialog di-mount kondisional oleh
  // parent dgn key=rowId, jadi state baru terbentuk tiap ganti baris (tanpa effect)
  const [form, setForm] = useState(() => formInit(row));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!row) return;
    const body: Record<string, unknown> = { rowId: row.rowId, notes: form.notes || null };
    if (form.effectiveDate && form.effectiveDate !== row.validFrom.slice(0, 10)) body.effectiveDate = form.effectiveDate;
    if (form.orgUnitId !== "none") body.orgUnitId = form.orgUnitId;
    if (form.positionId !== "none") body.positionId = form.positionId;
    if (form.gradeId !== "none") body.gradeId = form.gradeId;
    if (form.managerId !== "none") body.managerId = form.managerId;
    if (form.baseSalary) body.baseSalary = Number(form.baseSalary);
    setBusy(true);
    try {
      await apiSend("/api/onevity/employee-detail", "PUT", body);
      toast.success(t("Baris riwayat dikoreksi", "History row corrected"));
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 ov-text-accent" /> {t("Koreksi Riwayat", "Correct History")}{row ? ` · ${row.validFrom.slice(0, 10)}` : ""}
          </DialogTitle>
        </DialogHeader>
        {row && (
          <>
            <p className="rounded-lg ov-soft px-3 py-2 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              {t(
                "Perbaiki nilai salah ketik pada langkah riwayat ini. Field dikosongkan / “tidak diubah” = tetap. Baris aktif tidak bisa dikoreksi di sini — gunakan “Ubah Penempatan”.",
                "Fix a typo in this history step. Empty / “unchanged” fields stay as-is. The active row can't be corrected here — use “Change Placement”.",
              )}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{t("Mulai Berlaku", "Valid From")}</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs">{t("Unit Kerja", "Org Unit")}</Label>
                <Select value={form.orgUnitId} onValueChange={(v) => set("orgUnitId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.orgUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Posisi", "Position")}</Label>
                <Select value={form.positionId} onValueChange={(v) => set("positionId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Grade", "Grade")}</Label>
                <Select value={form.gradeId} onValueChange={(v) => set("gradeId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Atasan Langsung", "Direct Manager")}</Label>
                <Select value={form.managerId} onValueChange={(v) => set("managerId", v)}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("— tidak diubah", "— unchanged")}</SelectItem>
                    {opts?.managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} ({m.employeeNo})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Upah Pokok (Rp)", "Base Salary (IDR)")}</Label>
                <Input inputMode="numeric" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value.replace(/[^\d]/g, ""))} placeholder={t("Kosong = tetap", "Empty = keep")} className="mt-1.5 font-mono" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("Alasan Koreksi", "Correction Reason")}</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} className="mt-1.5" />
              </div>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan Koreksi")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { EmployeeDetail };
