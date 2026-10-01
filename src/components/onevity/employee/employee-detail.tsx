"use client";
// OneVity — KARYAWAN › Profil Karyawan: header premium + 6 tab
// (personal, pekerjaan, keluarga, pendidikan, pengalaman, disiplin)
import { useState } from "react";
import { useNav } from "@/lib/onevity/store";
import { useApi, fmtDate, fmtDateLong, fmtIDR, initials, tenure, genderLabel, avatarColor } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
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
import {
  EMPLOYMENT_STATUS_LABEL, RELATION_LABEL, WARNING_LEVEL_META,
  type EmployeeDetailResp,
} from "./types";
import {
  EditPersonalDialog, EditWorkDialog, FamilyDialog, EducationDialog,
  ExperienceDialog, DisciplinaryDialog, DeleteRecordButton,
} from "./detail-dialogs";

// item grid data personal
function DetailItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
        <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
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
            {Icon && <Icon className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
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
  const { data, loading, error, refresh } = useApi<EmployeeDetailResp>(`/api/onevity/employee-detail?id=${encodeURIComponent(id)}`, [id]);

  const [editPersonal, setEditPersonal] = useState(false);
  const [editWork, setEditWork] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [eduOpen, setEduOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="KARYAWAN" title="Profil Karyawan" description="Memuat data profil…" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  if (error || !data?.employee) {
    return (
      <div>
        <PageHeader eyebrow="KARYAWAN" title="Profil Karyawan" />
        <EmptyState title="Karyawan tidak ditemukan" description={error ?? "Data profil tidak tersedia."} icon={<UserRound className="h-6 w-6" />} />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" className="h-11 gap-2" onClick={() => navigate("employee", "directory")}>
            <ArrowLeft className="h-4 w-4" /> Kembali ke Direktori
          </Button>
        </div>
      </div>
    );
  }

  const e = data.employee;
  const ttl = e.birthPlace || e.birthDate ? `${e.birthPlace ?? "?"}, ${fmtDateLong(e.birthDate)}` : "";
  const period = (s: string | null, en: string | null) => `${fmtDate(s)} — ${en ? fmtDate(en) : "sekarang"}`;

  return (
    <div>
      {/* back + page header */}
      <div className="mb-4">
        <Button variant="ghost" className="h-11 gap-2 px-3 text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-400" onClick={() => navigate("employee", "directory")}>
          <ArrowLeft className="h-4 w-4" /> Kembali ke Direktori
        </Button>
      </div>

      {/* ============ header card ============ */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {/* banner */}
        <div className="relative h-28 bg-gradient-to-r from-emerald-700 via-teal-600 to-emerald-500 sm:h-32">
          <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1.5px, transparent 1.5px), radial-gradient(circle at 70% 30%, white 1px, transparent 1px)", backgroundSize: "48px 48px, 26px 26px" }} aria-hidden />
        </div>

        <div className="relative px-5 pb-5 sm:px-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            {/* avatar */}
            <div className="-mt-14 flex items-end gap-4 sm:-mt-16">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-3xl font-extrabold text-white shadow-lg ring-4 ring-white dark:ring-slate-900 sm:h-28 sm:w-28">
                {initials(e.fullName)}
              </div>
            </div>

            {/* identity */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 sm:text-[28px]">{e.fullName}</h2>
                <StatusPill status={e.status} />
                <Badge className={cn("border px-2.5 py-0.5 text-[11px] font-semibold", "border-transparent", e.employmentStatus === "Permanent" ? "bg-emerald-600" : e.employmentStatus === "Probation" ? "bg-amber-500" : e.employmentStatus === "Contract" ? "bg-teal-600" : "bg-orange-500")}>
                  {EMPLOYMENT_STATUS_LABEL[e.employmentStatus] ?? e.employmentStatus}
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
                  <a href={`mailto:${e.email}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-emerald-600/50 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400">
                    <Mail className="h-3.5 w-3.5" aria-hidden /> {e.email}
                  </a>
                )}
                {e.phone && (
                  <a href={`tel:${e.phone}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-emerald-600/50 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400">
                    <Phone className="h-3.5 w-3.5" aria-hidden /> {e.phone}
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* quick stats */}
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800/70">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"><Clock3 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Masa Kerja</p>
                <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{tenure(e.joinDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"><Banknote className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gaji Pokok</p>
                <p className="truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{fmtIDR(e.baseSalary)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400"><UserRound className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Atasan</p>
                <button
                  className="max-w-full truncate text-left text-sm font-extrabold text-slate-800 hover:text-emerald-700 hover:underline dark:text-slate-100 dark:hover:text-emerald-400"
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
              { v: "personal", label: "Personal", icon: UserRound },
              { v: "pekerjaan", label: "Pekerjaan", icon: BriefcaseBusiness },
              { v: "keluarga", label: `Keluarga (${e.family.length})`, icon: Heart },
              { v: "pendidikan", label: `Pendidikan (${e.education.length})`, icon: GraduationCap },
              { v: "pengalaman", label: `Pengalaman (${e.experiences.length})`, icon: History },
              { v: "disiplin", label: `Disiplin (${e.disciplinary.length})`, icon: Scale },
            ].map((t) => (
              <TabsTrigger
                key={t.v}
                value={t.v}
                className="h-11 gap-2 rounded-xl px-4 text-[13px] font-semibold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-emerald-400"
              >
                <t.icon className="h-4 w-4" aria-hidden /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ===== TAB: PERSONAL ===== */}
        <TabsContent value="personal" className="mt-0">
          <SectionCard
            title="Data Personal"
            description="Identitas kependudukan, kontak, dan data perbankan."
            icon={UserRound}
            action={
              <Button variant="outline" size="sm" className="h-11 gap-2" onClick={() => setEditPersonal(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem icon={IdCard} label="NIK (KTP)" value={e.nationalId ?? ""} />
              <DetailItem icon={Landmark} label="NPWP" value={e.taxId ?? ""} />
              <DetailItem icon={Heart} label="BPJS Kesehatan" value={e.bpjsHealth ?? ""} />
              <DetailItem icon={ShieldAlert} label="BPJS Ketenagakerjaan" value={e.bpjsEmpSkill ?? ""} />
              <DetailItem icon={CalendarDays} label="Tempat, Tgl Lahir" value={ttl} />
              <DetailItem icon={UserRound} label="Jenis Kelamin" value={genderLabel(e.gender)} />
              <DetailItem icon={Sparkles} label="Agama" value={e.religion ?? ""} />
              <DetailItem icon={Heart} label="Status Pernikahan" value={e.maritalStatus ?? ""} />
              <DetailItem icon={Droplets} label="Golongan Darah" value={e.bloodType ? `Gol. ${e.bloodType}` : ""} />
              <DetailItem icon={MapPin} label="Alamat" value={e.address ?? ""} />
              <DetailItem icon={Building2} label="Kota" value={e.city ?? ""} />
              <DetailItem icon={Wallet} label="Bank" value={e.bankName ? `${e.bankName}${e.bankAccount ? ` · ${e.bankAccount}` : ""}` : ""} />
            </div>
          </SectionCard>
        </TabsContent>

        {/* ===== TAB: PEKERJAAN ===== */}
        <TabsContent value="pekerjaan" className="mt-0">
          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard
              title="Info Pekerjaan"
              description="Penempatan, status, dan upah saat ini."
              icon={BriefcaseBusiness}
              action={
                <Button variant="outline" size="sm" className="h-11 gap-2" onClick={() => setEditWork(true)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem icon={CalendarDays} label="Tanggal Masuk" value={fmtDateLong(e.joinDate)} />
                <DetailItem icon={Clock3} label="Status Kerja" value={EMPLOYMENT_STATUS_LABEL[e.employmentStatus] ?? e.employmentStatus} />
                <DetailItem icon={Clock3} label="Shift Kerja" value={e.workShift} />
                <DetailItem icon={UserRound} label="Atasan Langsung" value={e.manager?.fullName ?? "—"} />
                <DetailItem icon={Building2} label="Unit Organisasi" value={e.orgUnit?.name ?? "—"} />
                <DetailItem icon={BriefcaseBusiness} label="Posisi" value={e.position?.title ?? "—"} />
                <DetailItem icon={GraduationCap} label="Grade" value={e.grade ? `${e.grade.code} · ${e.grade.name}` : "—"} />
                <DetailItem icon={Banknote} label="Gaji Pokok" value={fmtIDR(e.baseSalary)} />
                {e.grade && (
                  <DetailItem icon={Wallet} label="Range Grade" value={`${fmtIDR(e.grade.minSalary)} – ${fmtIDR(e.grade.maxSalary)}`} />
                )}
                {e.endDate && <DetailItem icon={TriangleAlert} label="Tanggal Keluar" value={fmtDateLong(e.endDate)} />}
              </div>
            </SectionCard>

            <SectionCard title={`Bawahan Langsung (${e.directReports.length})`} description="Karyawan yang melapor langsung ke sini." icon={Users}>
              {e.directReports.length === 0 ? (
                <EmptyState title="Tidak ada bawahan langsung" description="Karyawan ini tidak memiliki direct report." icon={<UserMinus className="h-6 w-6" />} />
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {e.directReports.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => navigate("employee", "detail", { id: r.id })}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-emerald-600/40 dark:hover:bg-emerald-500/10"
                        aria-label={`Buka profil ${r.fullName}`}
                      >
                        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarColor(r.fullName))}>
                          {initials(r.fullName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-bold text-slate-800 group-hover:text-emerald-700 dark:text-slate-100 dark:group-hover:text-emerald-400">{r.fullName}</span>
                          <span className="block truncate text-[11px] text-slate-400">
                            <span className="font-mono">{r.employeeNo}</span> · {r.position?.title ?? "—"}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-emerald-500" />
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
            title={`Data Keluarga (${e.family.length})`}
            description="Anggota keluarga untuk BPJS dan tunjangan."
            icon={Heart}
            action={
              <Button size="sm" className="h-11 gap-2 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={() => setFamilyOpen(true)}>
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            }
          >
            {e.family.length === 0 ? (
              <EmptyState title="Belum ada data keluarga" description="Tambahkan pasangan, anak, atau tanggungan lain." icon={<Heart className="h-6 w-6" />} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Hubungan</TableHead>
                        <TableHead>Nama</TableHead>
                        <TableHead>J. Kelamin</TableHead>
                        <TableHead>Tgl Lahir</TableHead>
                        <TableHead>Pekerjaan</TableHead>
                        <TableHead>Dependen</TableHead>
                        <TableHead className="w-12" aria-label="Aksi" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {e.family.map((f) => (
                        <TableRow key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell className="py-3 text-[13px] font-semibold">{RELATION_LABEL[f.relation] ?? f.relation}</TableCell>
                          <TableCell className="py-3 text-[13px] font-bold text-slate-800 dark:text-slate-100">{f.name}</TableCell>
                          <TableCell className="py-3 text-[13px]">{genderLabel(f.gender)}</TableCell>
                          <TableCell className="py-3 text-[13px]">{fmtDate(f.birthDate)}</TableCell>
                          <TableCell className="py-3 text-[13px]">{f.occupation ?? "—"}</TableCell>
                          <TableCell className="py-3">
                            {f.isDependent ? (
                              <Badge className="bg-emerald-100 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400">Dependen</Badge>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            <DeleteRecordButton
                              url={`/api/onevity/family?id=${f.id}`}
                              title={`Hapus ${f.name}?`}
                              description="Anggota keluarga akan dihapus permanen dari profil."
                              onDone={refresh}
                            />
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
            title={`Riwayat Pendidikan (${e.education.length})`}
            description="Jenjang pendidikan formal."
            icon={GraduationCap}
            action={
              <Button size="sm" className="h-11 gap-2 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={() => setEduOpen(true)}>
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            }
          >
            {e.education.length === 0 ? (
              <EmptyState title="Belum ada riwayat pendidikan" description="Tambahkan pendidikan terakhir (SMA/D3/S1/S2/S3)." icon={<GraduationCap className="h-6 w-6" />} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {e.education.map((d) => (
                  <div key={d.id} className="group relative rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 transition hover:border-emerald-300/70 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-emerald-600/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-[11px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        {d.level}
                      </div>
                      <DeleteRecordButton
                        url={`/api/onevity/education?id=${d.id}`}
                        title={`Hapus pendidikan ${d.level}?`}
                        description="Riwayat pendidikan ini akan dihapus permanen."
                        onDone={refresh}
                        className="h-8 w-8"
                      />
                    </div>
                    <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">{d.institution}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{d.major ?? "—"}</p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{d.startYear ?? "?"} – {d.endYear ?? "…"}</span>
                      {d.gpa != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">IPK {d.gpa.toFixed(2)}</span>}
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
            title={`Pengalaman Kerja (${e.experiences.length})`}
            description="Riwayat pekerjaan sebelum bergabung."
            icon={History}
            action={
              <Button size="sm" className="h-11 gap-2 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={() => setExpOpen(true)}>
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            }
          >
            {e.experiences.length === 0 ? (
              <EmptyState title="Belum ada pengalaman" description="Tambahkan riwayat pekerjaan sebelumnya." icon={<BriefcaseBusiness className="h-6 w-6" />} />
            ) : (
              <div className="space-y-3">
                {e.experiences.map((x) => (
                  <div key={x.id} className="relative rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 transition hover:border-emerald-300/70 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-emerald-600/40">
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
                      <DeleteRecordButton
                        url={`/api/onevity/experiences?id=${x.id}`}
                        title={`Hapus pengalaman di ${x.company}?`}
                        description="Pengalaman kerja ini akan dihapus permanen."
                        onDone={refresh}
                      />
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
            title={`Catatan Disiplin (${e.disciplinary.length})`}
            description="Riwayat peringatan, pelanggaran, dan sanksi."
            icon={Scale}
            action={
              <Button size="sm" className="h-11 gap-2 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={() => setDiscOpen(true)}>
                <Plus className="h-4 w-4" /> Catat Pelanggaran
              </Button>
            }
          >
            {e.disciplinary.length === 0 ? (
              <EmptyState title="Rekam disiplin bersih" description="Tidak ada catatan pelanggaran untuk karyawan ini." icon={<Badge variant="outline" className="h-6 w-6 rounded-full border-2 border-emerald-200 text-[9px] font-bold text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400">100%</Badge>} />
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
                                {meta.label}
                              </span>
                              <span className="text-[11px] text-slate-400">Diterbitkan {fmtDate(d.issuedAt)}</span>
                              {d.expiresAt && <span className="text-[11px] text-slate-400">· Berlaku s/d {fmtDate(d.expiresAt)}</span>}
                            </div>
                            <p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">{d.violation}</p>
                            {d.sanction && (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-bold">Sanksi:</span> {d.sanction}
                              </p>
                            )}
                            {d.notes && <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{d.notes}</p>}
                          </div>
                          <DeleteRecordButton
                            url={`/api/onevity/disciplinary?id=${d.id}`}
                            title="Hapus catatan disiplin?"
                            description="Catatan pelanggaran ini akan dihapus permanen."
                            onDone={refresh}
                          />
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
      <FamilyDialog open={familyOpen} onOpenChange={setFamilyOpen} employeeId={e.id} employeeName={e.fullName} onDone={refresh} />
      <EducationDialog open={eduOpen} onOpenChange={setEduOpen} employeeId={e.id} employeeName={e.fullName} onDone={refresh} />
      <ExperienceDialog open={expOpen} onOpenChange={setExpOpen} employeeId={e.id} employeeName={e.fullName} onDone={refresh} />
      <DisciplinaryDialog open={discOpen} onOpenChange={setDiscOpen} employeeId={e.id} employeeName={e.fullName} onDone={refresh} />
    </div>
  );
}
