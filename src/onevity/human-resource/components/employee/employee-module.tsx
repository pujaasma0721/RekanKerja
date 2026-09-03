"use client";
// OneVity — Modul Karyawan: direktori, profil detail multi-tab
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateLong, tenure, genderLabel } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { OnboardingWizard, DisciplinaryPage } from "@/onevity/human-resource/components/employee/employee-wizard";
import { EmployeeDirectory as DirectoryView } from "@/onevity/human-resource/components/employee/employee-directory";
import { EmployeeAvatar } from "@/onevity/human-resource/components/employee/employee-avatar";
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
  Landmark, Banknote, Clock3, ArrowRight, Building2, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function EmployeeModule({ view }: { view: string }) {
  if (view === "wizard") return <OnboardingWizard />;
  if (view === "disciplinary") return <DisciplinaryPage />;
  if (view === "detail") return <EmployeeDetail />;
  return <DirectoryView />;
}

// ================= DETAIL =================
// Riwayat penempatan kerja (EmployeeAssignment)
interface AssignmentHistory {
  id: string;
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

function EmployeeDetail() {
  const { params, navigate } = useNav();
  const { data, loading, refresh } = useApi<{ employee: DetailEmp }>(params.id ? `/api/onevity/employee-detail?id=${params.id}` : null);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("personal");

  if (loading && !data) {
    return <div><PageHeader eyebrow="KARYAWAN" title="Profil Karyawan" /><LoadingRows rows={6} /></div>;
  }
  if (!data?.employee) {
    return <EmptyState title="Karyawan tidak ditemukan" description="Kembali ke direktori dan pilih karyawan lain." />;
  }
  const e = data.employee;

  return (
    <div>
      <button onClick={() => navigate("employee", "directory")} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Direktori
      </button>

      {/* header card */}
      <Card className="mb-4 overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <div className="h-20 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800" />
        <CardContent className="relative p-6 pt-0">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <EmployeeAvatar
                name={e.fullName}
                photoUrl={e.photoUrl}
                size="xl"
                status={e.status}
                showStatus
                className="shadow-lg"
                ringClassName="ring-4 ring-white dark:ring-stone-900"
              />
              <div className="pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-extrabold text-stone-900 dark:text-stone-50">{e.fullName}</h1>
                  <StatusPill status={e.status} />
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  <span className="font-mono font-bold">{e.employeeNo}</span> · {e.position?.title ?? "—"} · {e.orgUnit?.name ?? "—"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{e.employmentStatus}</Badge>
                  {e.grade && <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400">Grade {e.grade.code}</Badge>}
                  <Badge variant="secondary" className="text-[10px]">Masa kerja {tenure(e.joinDate)}</Badge>
                </div>
              </div>
            </div>
            <div className="flex gap-2 pb-1">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Edit Data
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ContactChip icon={Mail} text={e.email ?? "—"} />
            <ContactChip icon={Phone} text={e.phone ?? "—"} />
            <ContactChip icon={MapPin} text={e.city ?? "—"} />
            <ContactChip icon={Banknote} text={fmtIDR(e.baseSalary)} />
          </div>
        </CardContent>
      </Card>

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
          ] as const).map(([id, label, Icon]) => (
            <TabsTrigger key={id} value={id} className="shrink-0 gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-stone-500 transition-all data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-stone-900/[0.06] dark:text-stone-400 dark:data-[state=active]:bg-stone-900 dark:data-[state=active]:text-emerald-400 dark:data-[state=active]:ring-stone-100/10 [&[data-state=active]_[data-count]]:bg-emerald-100/90 [&[data-state=active]_[data-count]]:text-emerald-700 dark:[&[data-state=active]_[data-count]]:bg-emerald-500/15 dark:[&[data-state=active]_[data-count]]:text-emerald-400">
              <Icon className="h-4 w-4" aria-hidden /> {label}
              {id === "work" && e.assignments.length > 1 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.assignments.length}</span>}
              {id === "family" && e.family.length > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.family.length}</span>}
              {id === "education" && e.education.length > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.education.length}</span>}
              {id === "discipline" && e.disciplinary.length > 0 && <span data-count className="ml-1 rounded-full bg-stone-200/80 px-1.5 py-px text-[10px] font-bold tabular-nums text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">{e.disciplinary.length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="personal">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-6">
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoItem icon={IdCard} label="NIK (KTP)" value={e.nationalId ?? "—"} mono />
                <InfoItem icon={IdCard} label="NPWP" value={e.taxId ?? "—"} mono />
                <InfoItem icon={Heart} label="Status Pernikahan" value={e.maritalStatus ?? "—"} />
                <InfoItem icon={User} label="Jenis Kelamin" value={genderLabel(e.gender)} />
                <InfoItem icon={Calendar} label="Tempat, Tgl Lahir" value={[e.birthPlace, fmtDate(e.birthDate)].filter(Boolean).join(", ") || "—"} />
                <InfoItem icon={User} label="Agama" value={e.religion ?? "—"} />
                <InfoItem icon={Plus} label="Gol. Darah" value={e.bloodType ?? "—"} />
                <InfoItem icon={Landmark} label="BPJS Kesehatan" value={e.bpjsHealth ?? "—"} mono />
                <InfoItem icon={Landmark} label="BPJS Ketenagakerjaan" value={e.bpjsEmpSkill ?? "—"} mono />
                <InfoItem icon={Landmark} label="Bank" value={e.bankName ?? "—"} />
                <InfoItem icon={Landmark} label="No. Rekening" value={e.bankAccount ?? "—"} mono />
                <InfoItem icon={MapPin} label="Alamat" value={[e.address, e.city].filter(Boolean).join(", ") || "—"} span />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardContent className="p-6">
                  <p className="mb-4 text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Penempatan Saat Ini</p>
                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <InfoItem icon={Briefcase} label="Posisi" value={e.position?.title ?? "—"} />
                    <InfoItem icon={Users} label="Unit Organisasi" value={e.orgUnit?.name ?? "—"} />
                    <InfoItem icon={GraduationCap} label="Grade" value={e.grade ? `${e.grade.code} — ${e.grade.name}` : "—"} />
                    <InfoItem icon={Clock3} label="Status Kepegawaian" value={e.employmentStatus} />
                    <InfoItem icon={Calendar} label="Tanggal Masuk" value={fmtDateLong(e.joinDate)} />
                    {e.endDate && <InfoItem icon={Calendar} label="Tanggal Keluar" value={fmtDateLong(e.endDate)} />}
                    <InfoItem icon={Clock3} label="Jadwal Kerja" value={e.workShift} />
                    <InfoItem icon={Banknote} label="Gaji Pokok" value={fmtIDR(e.baseSalary)} />
                    {e.grade && (
                      <div className="sm:col-span-2">
                        <InfoItem icon={GraduationCap} label="Rentang Grade" value={`${fmtIDR(e.grade.minSalary)} — ${fmtIDR(e.grade.maxSalary)}`} />
                        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                          <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{
                            left: `${Math.max((e.baseSalary - e.grade.minSalary) / (e.grade.maxSalary - e.grade.minSalary || 1) * 100, 2)}%`,
                            width: "14%",
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <AssignmentTimeline assignments={e.assignments} />
            </div>
            <div className="space-y-4">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold">Atasan Langsung</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {e.manager ? (
                    <button onClick={() => navigate("employee", "detail", { id: e.manager!.id })} className="flex w-full items-center gap-3 rounded-xl border border-stone-100 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40 dark:border-stone-800 dark:hover:bg-emerald-500/5">
                      <EmployeeAvatar name={e.manager.fullName} photoUrl={e.manager.photoUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{e.manager.fullName}</p>
                        <p className="truncate text-[11px] text-stone-400">{e.manager.position?.title ?? "—"}</p>
                      </div>
                    </button>
                  ) : <p className="text-xs text-stone-400">Tidak ada atasan (top level)</p>}
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold">Bawahan Langsung ({e.directReports.length})</CardTitle>
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
                  )) : <p className="text-xs text-stone-400">Tidak memiliki bawahan</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="family">
          <ListSection
            title="Data Keluarga"
            addLabel="Tambah Anggota"
            items={e.family.map((f) => ({
              id: f.id,
              title: f.name,
              subtitle: `${f.relation} · ${f.gender === "F" ? "Perempuan" : "Laki-laki"}${f.birthDate ? ` · ${fmtDate(f.birthDate)}` : ""}`,
              right: [f.occupation ?? "", f.isDependent ? "Dependen" : "Non-dependen"].filter(Boolean).join(" · ") || "—",
              onDelete: async () => { await apiSend(`/api/onevity/family?id=${f.id}`, "DELETE"); toast.success("Anggota keluarga dihapus"); refresh(); },
            }))}
            renderAdd={(close) => <AddFamilyDialog employeeId={e.id} onSaved={() => { close(); refresh(); }} />}
          />
        </TabsContent>

        <TabsContent value="education">
          <ListSection
            title="Riwayat Pendidikan"
            addLabel="Tambah Pendidikan"
            items={e.education.map((ed) => ({
              id: ed.id,
              title: `${ed.level} — ${ed.institution}`,
              subtitle: [ed.major, ed.startYear && ed.endYear ? `${ed.startYear}–${ed.endYear}` : null].filter(Boolean).join(" · ") || "—",
              right: ed.gpa ? `IPK ${ed.gpa}` : "",
              onDelete: async () => { await apiSend(`/api/onevity/education?id=${ed.id}`, "DELETE"); toast.success("Pendidikan dihapus"); refresh(); },
            }))}
            renderAdd={(close) => <AddEducationDialog employeeId={e.id} onSaved={() => { close(); refresh(); }} />}
          />
        </TabsContent>

        <TabsContent value="experience">
          <ListSection
            title="Pengalaman Kerja"
            addLabel="Tambah Pengalaman"
            items={e.experiences.map((x) => ({
              id: x.id,
              title: `${x.position} — ${x.company}`,
              subtitle: x.startDate && x.endDate ? `${fmtDate(x.startDate)} – ${fmtDate(x.endDate)}` : "—",
              right: x.notes ?? "",
              onDelete: async () => { await apiSend(`/api/onevity/experiences?id=${x.id}`, "DELETE"); toast.success("Pengalaman dihapus"); refresh(); },
            }))}
            renderAdd={(close) => <AddExperienceDialog employeeId={e.id} onSaved={() => { close(); refresh(); }} />}
          />
        </TabsContent>

        <TabsContent value="discipline">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><Scale className="h-4 w-4 text-emerald-600" /> Catatan Disiplin</CardTitle>
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
                        {d.sanction && <p className="mt-1 text-[11px] text-stone-500">Sanksi: {d.sanction}</p>}
                        {d.expiresAt && <p className="text-[10px] text-stone-400">Berlaku s.d. {fmtDate(d.expiresAt)}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 p-6 text-center dark:border-emerald-500/25 dark:bg-emerald-500/5">
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Rekam jejak bersih ✨</p>
                  <p className="mt-0.5 text-xs text-stone-400">Tidak ada catatan pelanggaran untuk karyawan ini.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditEmployeeDialog open={editOpen} setOpen={(v) => { setEditOpen(v); if (!v) refresh(); }} employee={e} />
    </div>
  );
}

// ================= TIMELINE RIWAYAT PEKERJAAN =================
const REASON_TONE: Record<string, string> = {
  Initial: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
  Promotion: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  Demotion: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Transfer: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  Mutation: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  SalaryAdjustment: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  ChangeStatus: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
  ContractRenewal: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  ExtendProbation: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  ManualEdit: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700",
};

function AssignmentTimeline({ assignments }: { assignments: AssignmentHistory[] }) {
  if (assignments.length === 0) return null;
  const period = (a: AssignmentHistory) =>
    a.validTo ? `${fmtDate(a.validFrom)} — ${fmtDate(a.validTo)}` : `${fmtDate(a.validFrom)} — sekarang`;

  // deteksi field yang berubah dibanding periode sebelumnya (lebih tua)
  const diffChips = (idx: number): string[] => {
    const cur = assignments[idx]!;
    const prev = assignments[idx + 1];
    if (!prev) return [];
    const chips: string[] = [];
    if (cur.position?.title !== prev.position?.title) chips.push("Posisi");
    if (cur.orgUnit?.name !== prev.orgUnit?.name) chips.push("Unit");
    if (cur.grade?.code !== prev.grade?.code) chips.push("Grade");
    if (cur.employmentStatus !== prev.employmentStatus) chips.push("Status");
    if (cur.workShift !== prev.workShift) chips.push("Shift");
    if (cur.baseSalary !== prev.baseSalary) chips.push("Upah");
    if (cur.managerName !== prev.managerName) chips.push("Atasan");
    return chips;
  };

  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <History className="h-4 w-4 text-emerald-600" /> Riwayat Pekerjaan
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{assignments.length} periode</Badge>
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
                  "absolute -left-[27px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ring-4",
                  active
                    ? "border-emerald-600 bg-emerald-500 ring-emerald-500/15"
                    : "border-stone-300 bg-white ring-white dark:border-stone-600 dark:bg-stone-900 dark:ring-stone-900",
                )} />
                <div className={cn(
                  "rounded-xl border p-3.5 transition",
                  active
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/25 dark:bg-emerald-500/5"
                    : "border-stone-200/80 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-transparent dark:hover:border-stone-700",
                )}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold", REASON_TONE[a.changeReason] ?? REASON_TONE.Initial)}>
                      {a.changeReasonLabel ?? a.changeReason}
                    </span>
                    <span className={cn("text-[11px] font-bold", active ? "text-emerald-700 dark:text-emerald-400" : "text-stone-500 dark:text-stone-400")}>{period(a)}</span>
                    {active && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-white">SAAT INI</span>}
                    {a.sourceDocNo && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-stone-400" title="Dokumen sumber">
                        <FileText className="h-3 w-3" /> {a.sourceDocNo}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-bold text-stone-800 dark:text-stone-200">
                    {a.position?.title ?? "—"}
                    <span className="font-normal text-stone-400"> · {a.orgUnit?.name ?? "—"}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className="inline-flex items-center gap-1"><GraduationCap className="h-3 w-3" /> {a.grade ? `Grade ${a.grade.code}` : "—"}</span>
                    <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {a.employmentStatus}</span>
                    <span className="inline-flex items-center gap-1"><Banknote className="h-3 w-3" /> {fmtIDR(a.baseSalary)}</span>
                    {a.managerName && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> Atasan: {a.managerName}</span>}
                    {a.workShift !== "Regular" && <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {a.workShift}</span>}
                  </div>
                  {chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-stone-400">Berubah:</span>
                      {chips.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                          <ArrowRight className="h-2.5 w-2.5" /> {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.notes && <p className="mt-2 text-[11px] italic text-stone-400">{a.notes}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function ContactChip({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
      <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function InfoItem({ icon: Icon, label, value, mono, span }: { icon: React.ElementType; label: string; value: string; mono?: boolean; span?: boolean }) {
  return (
    <div className={cn("flex items-start gap-3", span && "sm:col-span-2 lg:col-span-3")}>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-50 text-emerald-600 dark:bg-stone-900">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
        <p className={cn("break-words text-[13px] font-semibold text-stone-800 dark:text-stone-200", mono && "font-mono")}>{value}</p>
      </div>
    </div>
  );
}

function ListSection({ title, addLabel, items, renderAdd }: {
  title: string; addLabel: string;
  items: { id: string; title: string; subtitle: string; right: string; onDelete: () => Promise<void> }[];
  renderAdd: (close: () => void) => React.ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-bold">{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1.5 text-xs font-bold">
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        {items.length > 0 ? items.map((it) => (
          <div key={it.id} className="group flex items-center gap-3 rounded-xl border border-stone-100 p-3.5 transition hover:border-emerald-200 dark:border-stone-800 dark:hover:border-emerald-500/30">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-stone-800 dark:text-stone-200">{it.title}</p>
              <p className="truncate text-[11px] text-stone-400">{it.subtitle}</p>
              {it.right && <p className="truncate text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{it.right}</p>}
            </div>
            <button
              onClick={async () => { setBusyId(it.id); try { await it.onDelete(); } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); } }}
              disabled={busyId === it.id}
              className="rounded-lg p-2 text-stone-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-rose-500/10"
              aria-label="Hapus"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )) : (
          <EmptyState title="Belum ada data" description="Tambahkan data baru dengan tombol di atas." />
        )}
      </CardContent>
      {addOpen && renderAdd(() => setAddOpen(false))}
    </Card>
  );
}

function AddFamilyDialog({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const [relation, setRelation] = useState("Spouse");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("F");
  const [occupation, setOccupation] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const submit = async () => {
    if (!name.trim()) { toast.error("Nama wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/family", "POST", { employeeId, relation, name, gender, occupation: occupation || null });
      toast.success("Anggota keluarga ditambahkan");
      setOpen(false); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onSaved(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Tambah Anggota Keluarga</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Hubungan</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{["Spouse", "Child", "Parent", "Sibling"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Jenis Kelamin</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="M">Laki-laki</SelectItem><SelectItem value="F">Perempuan</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Nama *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Pekerjaan</Label>
            <Input value={occupation} onChange={(e) => setOccupation(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onSaved(); }}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEducationDialog({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const [level, setLevel] = useState("S1");
  const [institution, setInstitution] = useState("");
  const [major, setMajor] = useState("");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [gpa, setGpa] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const submit = async () => {
    if (!institution.trim()) { toast.error("Institusi wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/education", "POST", { employeeId, level, institution, major: major || null, startYear: startYear || null, endYear: endYear || null, gpa: gpa || null });
      toast.success("Pendidikan ditambahkan");
      setOpen(false); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onSaved(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Tambah Pendidikan</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Jenjang</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>{["SMA", "D3", "S1", "S2", "S3"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Institusi *</Label>
            <Input value={institution} onChange={(e) => setInstitution(e.target.value)} className="mt-1.5" placeholder="cth: Universitas Indonesia" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Jurusan</Label>
            <Input value={major} onChange={(e) => setMajor(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Tahun Mulai</Label>
            <Input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} className="mt-1.5" placeholder="2016" />
          </div>
          <div>
            <Label className="text-xs">Tahun Selesai</Label>
            <Input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} className="mt-1.5" placeholder="2020" />
          </div>
          <div>
            <Label className="text-xs">IPK</Label>
            <Input type="number" step="0.01" value={gpa} onChange={(e) => setGpa(e.target.value)} className="mt-1.5" placeholder="3.45" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onSaved(); }}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExperienceDialog({ employeeId, onSaved }: { employeeId: string; onSaved: () => void }) {
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const submit = async () => {
    if (!company.trim() || !position.trim()) { toast.error("Perusahaan & posisi wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/experiences", "POST", { employeeId, company, position, notes: notes || null });
      toast.success("Pengalaman ditambahkan");
      setOpen(false); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) onSaved(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Tambah Pengalaman Kerja</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Perusahaan *</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1.5" placeholder="cth: PT Astra International" />
          </div>
          <div>
            <Label className="text-xs">Posisi *</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} className="mt-1.5" placeholder="cth: Staff Akuntansi" />
          </div>
          <div>
            <Label className="text-xs">Catatan</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); onSaved(); }}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEmployeeDialog({ open, setOpen, employee }: { open: boolean; setOpen: (v: boolean) => void; employee: DetailEmp }) {
  const [form, setForm] = useState<Record<string, string>>({
    fullName: employee.fullName, email: employee.email ?? "", phone: employee.phone ?? "",
    address: employee.address ?? "", city: employee.city ?? "",
    maritalStatus: employee.maritalStatus ?? "", religion: employee.religion ?? "",
    bloodType: employee.bloodType ?? "", nationalId: employee.nationalId ?? "", taxId: employee.taxId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/onevity/employee-detail?id=${employee.id}`, "PATCH", form);
      toast.success("Data karyawan diperbarui");
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-base">Edit Data — {employee.fullName}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["fullName", "Nama Lengkap"], ["nationalId", "NIK"], ["taxId", "NPWP"],
            ["email", "Email"], ["phone", "Telepon"], ["maritalStatus", "Status Pernikahan"],
            ["religion", "Agama"], ["bloodType", "Gol. Darah"], ["city", "Kota"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <Label className="text-xs">{label}</Label>
              <Input value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} className="mt-1.5" />
            </div>
          ))}
          <div className="sm:col-span-2">
            <Label className="text-xs">Alamat</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan Perubahan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
