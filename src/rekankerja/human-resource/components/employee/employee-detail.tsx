"use client";
// RekanKerja — KARYAWAN › Profil Karyawan: header premium + 6 tab
// (personal, pekerjaan, keluarga, pendidikan, pengalaman, disiplin)
import { useState } from "react";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useApi, fmtDate, fmtDateLong, fmtIDR, tenure, genderLabel } from "@/rekankerja/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Mail, Phone, UserRound, Pencil, Plus, IdCard, Landmark, Heart, ShieldAlert,
  CalendarDays, Sparkles, Droplets, MapPin, Building2, Wallet, Banknote, BriefcaseBusiness,
  GraduationCap, Users, Clock3, Scale, BookOpen, History, ChevronRight, TriangleAlert, UserMinus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUS_LABEL_EN, RELATION_LABEL, RELATION_LABEL_EN, WARNING_LEVEL_META, WARNING_LEVEL_LABEL_EN,
  type EmployeeDetailResp, type FamilyRow, type EducationRow, type ExperienceRow,
} from "./types";
import { EmployeeAvatar } from "./employee-avatar";
import {
  EditPersonalDialog, EditWorkDialog, FamilyDialog, EducationDialog,
  ExperienceDialog, DisciplinaryDialog, DeleteRecordButton,
} from "./detail-dialogs";

// item grid data personal
function DetailItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
        <Icon className="h-3.5 w-3.5 ov-text-accent" aria-hidden />
        {label}
      </div>
      <p className={cn("mt-1.5 break-words text-sm font-semibold text-slate-800 dark:text-slate-100", !value && "font-normal text-slate-400")}>
        {value || "—"}
      </p>
    </div>
  );
}

function SectionCard({
  title, description, action, children, icon: Icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800/70">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-slate-50">
            {Icon && <Icon className="h-4.5 w-4.5 ov-text-accent" aria-hidden />}
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function EmployeeDetail({ id }: { id: string }) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, error, refresh } = useApi<EmployeeDetailResp>(`/api/rekankerja/employee-detail?id=${encodeURIComponent(id)}`, [id]);

  // referensi kantor & lokasi kerja (Task 25) — resolve nama dari snapshot ID
  // bila response belum memuat object relasinya (flatten object dipakai bila ada)
  const officeApi = useApi<{ offices: { id: string; code: string; name: string; city: string | null }[] }>(
    data?.employee?.companyOfficeId && !data.employee.companyOffice ? "/api/rekankerja/company-offices" : null, [id],
  );
  const locationApi = useApi<{ locations: { id: string; code: string; name: string; city: string | null }[] }>(
    data?.employee?.workLocationId && !data.employee.workLocation ? "/api/rekankerja/work-locations" : null, [id],
  );

  const [editPersonal, setEditPersonal] = useState(false);
  const [editWork, setEditWork] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [eduOpen, setEduOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  // Task 82-c: baris yang sedang di-ubah — mode edit dialog (null = mode tambah).
  const [familyEdit, setFamilyEdit] = useState<FamilyRow | null>(null);
  const [eduEdit, setEduEdit] = useState<EducationRow | null>(null);
  const [expEdit, setExpEdit] = useState<ExperienceRow | null>(null);

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow={t("Karyawan")} title={t("Profil Karyawan", "Employee Profile")} description={t("Memuat data profil…", "Loading profile data…")} />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (error || !data?.employee) {
    return (
      <div>
        <PageHeader eyebrow={t("Karyawan")} title={t("Profil Karyawan", "Employee Profile")} />
        <EmptyState title={t("Karyawan tidak ditemukan", "Employee not found")} description={error ?? t("Data profil tidak tersedia.", "Profile data is unavailable.")} icon={<UserRound className="h-6 w-6" />} />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" className="h-11 gap-2" onClick={() => navigate("employee", "directory")}>
            <ArrowLeft className="h-4 w-4" /> {t("Kembali ke Direktori", "Back to Directory")}
          </Button>
        </div>
      </div>
    );
  }

  const e = data.employee;
  const ttl = e.birthPlace || e.birthDate ? `${e.birthPlace ?? "?"}, ${fmtDateLong(e.birthDate)}` : "";
  const period = (s: string | null, en: string | null) => `${fmtDate(s)} — ${en ? fmtDate(en) : t("sekarang", "present")}`;
  // Kantor/Lokasi Kerja — prioritas object flatten, fallback resolve via snapshot ID
  const office = e.companyOffice ?? (e.companyOfficeId ? officeApi.data?.offices.find((o) => o.id === e.companyOfficeId) ?? null : null);
  const workLoc = e.workLocation ?? (e.workLocationId ? locationApi.data?.locations.find((l) => l.id === e.workLocationId) ?? null : null);

  return (
    <div>
      {/* back + page header */}
      <div className="mb-4">
        <Button variant="ghost" className="h-11 gap-2 px-3 text-slate-500 hover:ov-text-accent dark:text-slate-400" onClick={() => navigate("employee", "directory")}>
          <ArrowLeft className="h-4 w-4" /> {t("Kembali ke Direktori", "Back to Directory")}
        </Button>
      </div>

      {/* ============ header card ============ */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {/* banner — gradient diagonal tenang (teal tua → emerald), proporsional & tidak berat */}
        <div className="relative h-24 ov-hero sm:h-28">
          <div className="absolute inset-0 opacity-[0.10]" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1.5px, transparent 1.5px), radial-gradient(circle at 70% 30%, white 1px, transparent 1px)", backgroundSize: "48px 48px, 26px 26px" }} aria-hidden />
          <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
        </div>

        {/* zona identitas — tint emerald lembut: transisi banner → konten menyatu, bukan dua potongan */}
        <div className="relative ov-soft px-5 pb-5 sm:px-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            {/* avatar — foto karyawan (fallback inisial gradient) */}
            <div className="-mt-14 flex items-end gap-4 sm:-mt-16">
              <EmployeeAvatar
                name={e.fullName}
                photoUrl={e.photoUrl}
                size="xl"
                status={e.status}
                showStatus
                className="shadow-lg"
                ringClassName="ring-4 ring-white dark:ring-slate-900"
              />
            </div>

            {/* identity */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 sm:text-[28px]">{e.fullName}</h2>
                <StatusPill status={e.status} />
                <Badge className={cn(
                  "border px-2.5 py-0.5 text-[11px] font-semibold",
                  e.employmentStatus === "Permanent"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : e.employmentStatus === "Probation"
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                      : e.employmentStatus === "Contract"
                        ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400"
                        : "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400",
                )}>
                  {t(EMPLOYMENT_STATUS_LABEL[e.employmentStatus] ?? e.employmentStatus, EMPLOYMENT_STATUS_LABEL_EN[e.employmentStatus])}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500 dark:text-slate-400">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{e.employeeNo}</span>
                <span className="flex items-center gap-1.5"><BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden />{e.position?.title ?? "—"}</span>
                <span className="hidden text-slate-300 dark:text-slate-600 sm:inline" aria-hidden>·</span>
                <span className="flex items-center gap-1.5 truncate"><Building2 className="h-3.5 w-3.5" aria-hidden />{e.orgUnitPath.length ? e.orgUnitPath.join(" › ") : (e.orgUnit?.name ?? "—")}</span>
                {e.grade && (
                  <span className="flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" aria-hidden />{e.grade.code} · {e.grade.name}</span>
                )}
              </div>

              {/* contact chips */}
              <div className="mt-3 flex flex-wrap gap-2">
                {e.email && (
                  <a href={`mailto:${e.email}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:ov-border-accent hover:ov-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    <Mail className="h-3.5 w-3.5" aria-hidden /> {e.email}
                  </a>
                )}
                {e.phone && (
                  <a href={`tel:${e.phone}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:ov-border-accent hover:ov-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    <Phone className="h-3.5 w-3.5" aria-hidden /> {e.phone}
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* quick stats — aksen emerald seragam (visual tenang, tanpa kebisingan warna) */}
          <div className="mt-5 grid grid-cols-3 gap-3 border-t ov-border-accent pt-4 dark:border-slate-800/70">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ov-tile"><Clock3 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Masa Kerja", "Tenure")}</p>
                <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{tenure(e.joinDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ov-tile"><Banknote className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Gaji Pokok")}</p>
                <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{fmtIDR(e.baseSalary)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ov-tile"><UserRound className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Atasan", "Manager")}</p>
                <button
                  className="max-w-full truncate text-left text-sm font-extrabold text-slate-800 hover:ov-text-accent hover:underline dark:text-slate-100"
                  onClick={() => e.manager && navigate("employee", "detail", { id: e.manager.id })}
                >
                  {e.manager?.fullName ?? "—"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============ tabs ============ */}
      <Tabs defaultValue="personal">
        <div className="mb-5 overflow-x-auto pb-1">
          <TabsList className="h-auto w-max gap-1 bg-slate-100/80 p-1 dark:bg-slate-900/60">
            {[
              { v: "personal", label: t("Personal"), icon: UserRound },
              { v: "pekerjaan", label: t("Pekerjaan", "Work"), icon: BriefcaseBusiness },
              { v: "keluarga", label: t("Keluarga ({n})", "Family ({n})", { n: e.family.length }), icon: Heart },
              { v: "pendidikan", label: t("Pendidikan ({n})", "Education ({n})", { n: e.education.length }), icon: GraduationCap },
              { v: "pengalaman", label: t("Pengalaman ({n})", "Experience ({n})", { n: e.experiences.length }), icon: History },
              { v: "disiplin", label: t("Disiplin ({n})", "Discipline ({n})", { n: e.disciplinary.length }), icon: Scale },
            ].map((tb) => (
              <TabsTrigger
                key={tb.v}
                value={tb.v}
                className="h-11 gap-2 rounded-xl px-4 text-[13px] font-semibold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-900"
              >
                <tb.icon className="h-4 w-4" aria-hidden /> {tb.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ===== TAB: PERSONAL ===== */}
        <TabsContent value="personal" className="mt-0">
          <SectionCard
            title={t("Data Personal", "Personal Data")}
            description={t("Identitas kependudukan, kontak, dan data perbankan.", "Civil identity, contact, and banking details.")}
            icon={UserRound}
            action={
              perms.can("hr", "directory", "update") && (
                <Button variant="outline" size="sm" className="h-11 gap-2" onClick={() => setEditPersonal(true)}>
                  <Pencil className="h-4 w-4" /> {t("Edit")}
                </Button>
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem icon={IdCard} label={t("NIK (KTP)", "NIK (ID Card)")} value={e.nationalId ?? ""} />
              <DetailItem icon={Landmark} label={t("NPWP")} value={e.taxId ?? ""} />
              <DetailItem icon={Heart} label={t("BPJS Kesehatan", "BPJS Health")} value={e.bpjsHealth ?? ""} />
              <DetailItem icon={ShieldAlert} label={t("BPJS Ketenagakerjaan", "BPJS Employment")} value={e.bpjsEmpSkill ?? ""} />
              <DetailItem icon={CalendarDays} label={t("Tempat, Tgl Lahir", "Place & Date of Birth")} value={ttl} />
              <DetailItem icon={UserRound} label={t("Jenis Kelamin", "Gender")} value={genderLabel(e.gender)} />
              <DetailItem icon={Sparkles} label={t("Agama", "Religion")} value={e.religion ?? ""} />
              <DetailItem icon={Heart} label={t("Status Pernikahan", "Marital Status")} value={e.maritalStatus ?? ""} />
              <DetailItem icon={Droplets} label={t("Golongan Darah", "Blood Type")} value={e.bloodType ? t("Gol. {b}", "Group {b}", { b: e.bloodType }) : ""} />
              <DetailItem icon={MapPin} label={t("Alamat")} value={e.address ?? ""} />
              <DetailItem icon={Building2} label={t("Kota", "City")} value={e.city ?? ""} />
              <DetailItem icon={Wallet} label={t("Bank")} value={e.bankName ? `${e.bankName}${e.bankAccount ? ` · ${e.bankAccount}` : ""}` : ""} />
            </div>
          </SectionCard>
        </TabsContent>

        {/* ===== TAB: PEKERJAAN ===== */}
        <TabsContent value="pekerjaan" className="mt-0">
          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard
              title={t("Info Pekerjaan", "Job Information")}
              description={t("Penempatan, status, dan upah saat ini.", "Current placement, status, and salary.")}
              icon={BriefcaseBusiness}
              action={
                perms.can("hr", "directory", "update") && (
                  <Button variant="outline" size="sm" className="h-11 gap-2" onClick={() => setEditWork(true)}>
                    <Pencil className="h-4 w-4" /> {t("Edit")}
                  </Button>
                )
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem icon={CalendarDays} label={t("Tanggal Masuk", "Join Date")} value={fmtDateLong(e.joinDate)} />
                <DetailItem icon={Clock3} label={t("Status Kerja", "Employment Status")} value={t(EMPLOYMENT_STATUS_LABEL[e.employmentStatus] ?? e.employmentStatus, EMPLOYMENT_STATUS_LABEL_EN[e.employmentStatus])} />
                <DetailItem icon={Clock3} label={t("Shift Kerja", "Work Shift")} value={e.workShift} />
                <DetailItem icon={UserRound} label={t("Atasan Langsung", "Direct Manager")} value={e.manager?.fullName ?? "—"} />
                <DetailItem icon={Building2} label={t("Unit Organisasi")} value={e.orgUnit?.name ?? "—"} />
                <DetailItem icon={BriefcaseBusiness} label={t("Posisi")} value={e.position?.title ?? "—"} />
                <DetailItem icon={GraduationCap} label={t("Grade")} value={e.grade ? `${e.grade.code} · ${e.grade.name}` : "—"} />
                {office && (
                  <DetailItem icon={Building2} label={t("Kantor", "Office")} value={`${office.code} · ${office.name}${office.city ? ` — ${office.city}` : ""}`} />
                )}
                {workLoc && (
                  <DetailItem icon={MapPin} label={t("Lokasi Kerja", "Work Location")} value={`${workLoc.code} · ${workLoc.name}${workLoc.city ? ` — ${workLoc.city}` : ""}`} />
                )}
                <DetailItem icon={Banknote} label={t("Gaji Pokok")} value={fmtIDR(e.baseSalary)} />
                {e.grade && (
                  <DetailItem icon={Wallet} label={t("Range Grade", "Grade Range")} value={`${fmtIDR(e.grade.minSalary)} – ${fmtIDR(e.grade.maxSalary)}`} />
                )}
                {e.endDate && <DetailItem icon={TriangleAlert} label={t("Tanggal Keluar", "End Date")} value={fmtDateLong(e.endDate)} />}
              </div>
            </SectionCard>

            <SectionCard title={t("Bawahan Langsung ({n})", "Direct Reports ({n})", { n: e.directReports.length })} description={t("Karyawan yang melapor langsung ke sini.", "Employees reporting directly here.")} icon={Users}>
              {e.directReports.length === 0 ? (
                <EmptyState title={t("Tidak ada bawahan langsung", "No direct reports")} description={t("Karyawan ini tidak memiliki direct report.", "This employee has no direct reports.")} icon={<UserMinus className="h-6 w-6" />} />
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {e.directReports.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => navigate("employee", "detail", { id: r.id })}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-left transition hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40"
                        aria-label={t("Buka profil {name}", "Open {name}'s profile", { name: r.fullName })}
                      >
                        <EmployeeAvatar name={r.fullName} photoUrl={r.photoUrl} size="xs" status={r.status} showStatus />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-bold text-slate-800 group-hover:ov-text-accent dark:text-slate-100">{r.fullName}</span>
                          <span className="block truncate text-[11px] text-slate-400">
                            <span className="font-mono">{r.employeeNo}</span> · {r.position?.title ?? "—"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:ov-text-accent" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        {/* ===== TAB: KELUARGA ===== */}
        <TabsContent value="keluarga" className="mt-0">
          <SectionCard
            title={t("Data Keluarga ({n})", "Family Data ({n})", { n: e.family.length })}
            description={t("Anggota keluarga untuk BPJS dan tunjangan.", "Family members for BPJS and allowances.")}
            icon={Heart}
            action={
              perms.can("hr", "directory", "create") && (
                <Button size="sm" className="h-11 gap-2 px-4 font-bold" onClick={() => setFamilyOpen(true)}>
                  <Plus className="h-4 w-4" /> {t("Tambah")}
                </Button>
              )
            }
          >
            {e.family.length === 0 ? (
              <EmptyState title={t("Belum ada data keluarga", "No family data yet")} description={t("Tambahkan pasangan, anak, atau tanggungan lain.", "Add a spouse, child, or other dependent.")} icon={<Heart className="h-6 w-6" />} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{t("Hubungan", "Relation")}</TableHead>
                        <TableHead>{t("Nama")}</TableHead>
                        <TableHead>{t("J. Kelamin", "Gender")}</TableHead>
                        <TableHead>{t("Tgl Lahir", "Birth Date")}</TableHead>
                        <TableHead>{t("Pekerjaan", "Occupation")}</TableHead>
                        <TableHead>{t("Dependen", "Dependent")}</TableHead>
                        <TableHead className="w-24" aria-label={t("Aksi")} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {e.family.map((f) => (
                        <TableRow key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell className="py-3 text-[13px] font-semibold">{t(RELATION_LABEL[f.relation] ?? f.relation, RELATION_LABEL_EN[f.relation])}</TableCell>
                          <TableCell className="py-3 text-[13px] font-bold text-slate-800 dark:text-slate-100">{f.name}</TableCell>
                          <TableCell className="py-3 text-[13px]">{genderLabel(f.gender)}</TableCell>
                          <TableCell className="py-3 text-[13px]">{fmtDate(f.birthDate)}</TableCell>
                          <TableCell className="py-3 text-[13px]">{f.occupation ?? "—"}</TableCell>
                          <TableCell className="py-3">
                            {f.isDependent ? (
                              <Badge className="text-[10px] font-bold">{t("Dependen", "Dependent")}</Badge>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center justify-end gap-1">
                              {/* Task 82-c: aksi Ubah — dialog sama, ter-prefill baris (PATCH). */}
                              {perms.can("hr", "directory", "update") && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-11 w-11 text-slate-400 hover:ov-text-accent dark:hover:bg-slate-800"
                                  aria-label={t("Ubah data {name}", "Edit {name}", { name: f.name })}
                                  onClick={() => { setFamilyEdit(f); setFamilyOpen(true); }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              {perms.can("hr", "directory", "delete") && (
                                <DeleteRecordButton
                                  url={`/api/rekankerja/family?id=${f.id}`}
                                  title={t("Hapus {name}?", "Delete {name}?", { name: f.name })}
                                  description={t("Anggota keluarga akan dihapus permanen dari profil.", "This family member will be permanently removed from the profile.")}
                                  onDone={refresh}
                                />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ===== TAB: PENDIDIKAN ===== */}
        <TabsContent value="pendidikan" className="mt-0">
          <SectionCard
            title={t("Riwayat Pendidikan ({n})", "Education History ({n})", { n: e.education.length })}
            description={t("Jenjang pendidikan formal.", "Formal education levels.")}
            icon={GraduationCap}
            action={
              perms.can("hr", "directory", "create") && (
                <Button size="sm" className="h-11 gap-2 px-4 font-bold" onClick={() => setEduOpen(true)}>
                  <Plus className="h-4 w-4" /> {t("Tambah")}
                </Button>
              )
            }
          >
            {e.education.length === 0 ? (
              <EmptyState title={t("Belum ada riwayat pendidikan", "No education records yet")} description={t("Tambahkan pendidikan terakhir (SMA/D3/S1/S2/S3).", "Add the latest education (high school/diploma/bachelor/master/doctorate).")} icon={<GraduationCap className="h-6 w-6" />} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {e.education.map((d) => (
                  <div key={d.id} className="group relative rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 transition hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ov-tile text-[11px] font-extrabold">
                        {d.level}
                      </div>
                      <div className="flex items-start gap-1">
                        {/* Task 82-c: aksi Ubah — dialog sama, ter-prefill baris (PATCH). */}
                        {perms.can("hr", "directory", "update") && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-slate-400 hover:ov-text-accent dark:hover:bg-slate-800"
                            aria-label={t("Ubah pendidikan {lvl}", "Edit {lvl} education", { lvl: d.level })}
                            onClick={() => { setEduEdit(d); setEduOpen(true); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {perms.can("hr", "directory", "delete") && (
                          <DeleteRecordButton
                            url={`/api/rekankerja/education?id=${d.id}`}
                            title={t("Hapus pendidikan {lvl}?", "Delete {lvl} education?", { lvl: d.level })}
                            description={t("Riwayat pendidikan ini akan dihapus permanen.", "This education record will be permanently deleted.")}
                            onDone={refresh}
                            className="h-8 w-8"
                          />
                        )}
                      </div>
                    </div>
                    <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">{d.institution}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{d.major ?? "—"}</p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{d.startYear ?? "?"} – {d.endYear ?? "…"}</span>
                      {d.gpa != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("IPK {g}", "GPA {g}", { g: d.gpa.toFixed(2) })}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ===== TAB: PENGALAMAN ===== */}
        <TabsContent value="pengalaman" className="mt-0">
          <SectionCard
            title={t("Pengalaman Kerja ({n})", "Work Experience ({n})", { n: e.experiences.length })}
            description={t("Riwayat pekerjaan sebelum bergabung.", "Work history before joining.")}
            icon={History}
            action={
              perms.can("hr", "directory", "create") && (
                <Button size="sm" className="h-11 gap-2 px-4 font-bold" onClick={() => setExpOpen(true)}>
                  <Plus className="h-4 w-4" /> {t("Tambah")}
                </Button>
              )
            }
          >
            {e.experiences.length === 0 ? (
              <EmptyState title={t("Belum ada pengalaman", "No experience yet")} description={t("Tambahkan riwayat pekerjaan sebelumnya.", "Add previous work history.")} icon={<BriefcaseBusiness className="h-6 w-6" />} />
            ) : (
              <div className="space-y-3">
                {e.experiences.map((x) => (
                  <div key={x.id} className="relative rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 transition hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
                          <BriefcaseBusiness className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            {x.position} <span className="font-normal text-slate-400">·</span> {x.company}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{period(x.startDate, x.endDate)}</p>
                          {x.notes && <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{x.notes}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        {/* Task 82-c: aksi Ubah — dialog sama, ter-prefill baris (PATCH). */}
                        {perms.can("hr", "directory", "update") && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-11 w-11 text-slate-400 hover:ov-text-accent dark:hover:bg-slate-800"
                            aria-label={t("Ubah pengalaman di {c}", "Edit experience at {c}", { c: x.company })}
                            onClick={() => { setExpEdit(x); setExpOpen(true); }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {perms.can("hr", "directory", "delete") && (
                          <DeleteRecordButton
                            url={`/api/rekankerja/experiences?id=${x.id}`}
                            title={t("Hapus pengalaman di {c}?", "Delete experience at {c}?", { c: x.company })}
                            description={t("Pengalaman kerja ini akan dihapus permanen.", "This work experience will be permanently deleted.")}
                            onDone={refresh}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ===== TAB: DISIPLIN ===== */}
        <TabsContent value="disiplin" className="mt-0">
          <SectionCard
            title={t("Catatan Disiplin ({n})", "Disciplinary Records ({n})", { n: e.disciplinary.length })}
            description={t("Riwayat peringatan, pelanggaran, dan sanksi.", "History of warnings, violations, and sanctions.")}
            icon={Scale}
            action={
              perms.can("hr", "directory", "create") && (
                <Button size="sm" className="h-11 gap-2 px-4 font-bold" onClick={() => setDiscOpen(true)}>
                  <Plus className="h-4 w-4" /> {t("Catat Pelanggaran", "Record Violation")}
                </Button>
              )
            }
          >
            {e.disciplinary.length === 0 ? (
              <EmptyState title={t("Rekam disiplin bersih", "Clean disciplinary record")} description={t("Tidak ada catatan pelanggaran untuk karyawan ini.", "No violation records for this employee.")} icon={<Badge variant="outline" className="h-6 w-6 rounded-full border-2 ov-border-accent text-[9px] font-bold ov-text-accent">100%</Badge>} />
            ) : (
              <div className="relative space-y-4 pl-6">
                <div className="absolute bottom-2 left-[9px] top-2 w-0.5 rounded bg-slate-200 dark:bg-slate-700" aria-hidden />
                {e.disciplinary.map((d) => {
                  const meta = WARNING_LEVEL_META[d.warningLevel] ?? WARNING_LEVEL_META.Verbal!;
                  return (
                    <div key={d.id} className="relative">
                      <span className={cn("absolute -left-6 top-1.5 h-4 w-4 rounded-full border-[3px] border-white dark:border-slate-900", meta.bar)} aria-hidden />
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold", meta.cls)}>
                                {t(meta.label, WARNING_LEVEL_LABEL_EN[d.warningLevel])}
                              </span>
                              <span className="text-[11px] text-slate-400">{t("Diterbitkan {d}", "Issued {d}", { d: fmtDate(d.issuedAt) })}</span>
                              {d.expiresAt && <span className="text-[11px] text-slate-400">{t("· Berlaku s/d {d}", "· Valid until {d}", { d: fmtDate(d.expiresAt) })}</span>}
                            </div>
                            <p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">{d.violation}</p>
                            {d.sanction && (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-bold">{t("Sanksi:", "Sanction:")}</span> {d.sanction}
                              </p>
                            )}
                            {d.notes && <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{d.notes}</p>}
                          </div>
                          {perms.can("hr", "directory", "delete") && (
                            <DeleteRecordButton
                              url={`/api/rekankerja/disciplinary?id=${d.id}`}
                              title={t("Hapus catatan disiplin?", "Delete disciplinary record?")}
                              description={t("Catatan pelanggaran ini akan dihapus permanen.", "This violation record will be permanently deleted.")}
                              onDone={refresh}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ============ dialogs ============ */}
      <EditPersonalDialog open={editPersonal} onOpenChange={setEditPersonal} employee={e} onDone={refresh} />
      <EditWorkDialog open={editWork} onOpenChange={setEditWork} employee={e} onDone={refresh} />
      <FamilyDialog open={familyOpen} onOpenChange={(v) => { setFamilyOpen(v); if (!v) setFamilyEdit(null); }} employeeId={e.id} employeeName={e.fullName} onDone={refresh} edit={familyEdit} />
      <EducationDialog open={eduOpen} onOpenChange={(v) => { setEduOpen(v); if (!v) setEduEdit(null); }} employeeId={e.id} employeeName={e.fullName} onDone={refresh} edit={eduEdit} />
      <ExperienceDialog open={expOpen} onOpenChange={(v) => { setExpOpen(v); if (!v) setExpEdit(null); }} employeeId={e.id} employeeName={e.fullName} onDone={refresh} edit={expEdit} />
      <DisciplinaryDialog open={discOpen} onOpenChange={setDiscOpen} employeeId={e.id} employeeName={e.fullName} onDone={refresh} />
    </div>
  );
}
