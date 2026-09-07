"use client";
// Profil Saya — banner identitas + tab: Pribadi / Pekerjaan (riwayat
// penempatan) / Keluarga / Pendidikan. Read-only (v1) + ganti sandi.
import { useState } from "react";
import { motion } from "framer-motion";
import {
  UserRound, BriefcaseBusiness, HeartHandshake, GraduationCap, KeyRound, CalendarRange, MapPin, Phone, Mail, Building2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusPill, EmptyState } from "@/onevity/shared/components/ui-kit";
import { ChangePasswordDialog } from "@/onevity/shared/components/shell/change-password-dialog";
import { useApi, fmtDate, fmtIDR, tenure, initials } from "@/onevity/shared/lib/api";
import { InfoRow, PageSkeleton } from "@/onevity/ess/components/ess-ui";
import { useEssSession } from "@/onevity/ess/components/ess-session";
import { cn } from "@/lib/utils";

interface ProfileData {
  employee: {
    id: string; employeeNo: string; fullName: string; photoUrl: string | null; status: string;
    gender: string; birthPlace: string | null; birthDate: string | null;
    nationalId: string | null; taxId: string | null; bpjsHealth: string | null; bpjsEmpSkill: string | null;
    maritalStatus: string | null; religion: string | null; bloodType: string | null;
    email: string | null; phone: string | null; address: string | null; city: string | null;
    bankName: string | null; bankAccount: string | null;
    joinDate: string | null; endDate: string | null;
    employmentStatus: string | null; workShift: string | null; baseSalary: number;
    orgUnit: { name: string; code: string } | null;
    position: { title: string; code: string; level: string | null } | null;
    grade: { code: string; name: string } | null;
    manager: { id: string; fullName: string; employeeNo: string; photoUrl: string | null; position: string | null } | null;
    company: { name: string; code: string } | null;
    family: { id: string; relation: string; name: string; gender: string; birthDate: string | null; occupation: string | null; isDependent: boolean }[];
    education: { id: string; level: string; institution: string | null; major: string | null; startYear: number | null; endYear: number | null; gpa: number | null }[];
    assignments: {
      id: string; validFrom: string; validTo: string | null; changeReason: string; changeReasonLabel: string;
      sourceDocNo: string | null; notes: string | null; employmentStatus: string; workShift: string;
      baseSalary: number; orgUnit: string | null; position: string | null; grade: string | null; managerName: string | null;
    }[];
  };
}

const RELATION_LABEL: Record<string, string> = {
  Spouse: "Pasangan", Child: "Anak", Parent: "Orang Tua", Sibling: "Saudara",
};

export function EssProfile() {
  const { data: ess } = useEssSession();
  const { data, loading, error } = useApi<ProfileData>("/api/ess/profile");
  const [pwOpen, setPwOpen] = useState(false);

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <EmptyState title="Gagal memuat profil" description={error} icon={<UserRound className="h-6 w-6" />} />;

  const e = data?.employee;
  if (!e) return <EmptyState title="Profil tidak ditemukan" icon={<UserRound className="h-6 w-6" />} />;

  return (
    <div className="space-y-6">
      {/* ===== banner identitas ===== */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-stone-200/80 bg-card shadow-sm dark:border-stone-800"
      >
        <div className="relative h-28 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 dark:from-emerald-700 dark:via-emerald-800 dark:to-teal-900">
          <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-teal-400/20 blur-2xl" />
        </div>
        <div className="relative -mt-12 px-6 pb-6">
          <div className="flex flex-wrap items-end gap-4">
            <Avatar className="h-24 w-24 rounded-2xl border-4 border-white shadow-lg dark:border-stone-900">
              {e.photoUrl ? <AvatarImage src={e.photoUrl} alt={e.fullName} /> : null}
              <AvatarFallback className="rounded-2xl bg-emerald-100 text-2xl font-bold text-emerald-700">{initials(e.fullName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">{e.fullName}</h1>
                <StatusPill status={e.status} />
              </div>
              <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">
                {e.position?.title ?? "—"} · {e.orgUnit?.name ?? "—"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="gap-1 rounded-lg border-stone-300 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300">
                  <span className="font-mono">{e.employeeNo}</span>
                </Badge>
                <Badge variant="outline" className="gap-1 rounded-lg border-stone-300 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300">
                  <BriefcaseBusiness className="h-3 w-3" /> {e.employmentStatus ?? "—"}
                </Badge>
                {e.grade && (
                  <Badge variant="outline" className="gap-1 rounded-lg border-stone-300 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300">
                    Grade {e.grade.code}
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1 rounded-lg border-stone-300 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300">
                  <CalendarRange className="h-3 w-3" /> bergabung {fmtDate(e.joinDate)} · {tenure(e.joinDate)}
                </Badge>
              </div>
            </div>
            <Button variant="outline" className="rounded-xl" onClick={() => setPwOpen(true)}>
              <KeyRound className="h-4 w-4" /> Ganti Sandi
            </Button>
          </div>
        </div>
      </motion.div>

      {/* ===== tab konten ===== */}
      <Tabs defaultValue="personal" className="space-y-4">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 dark:bg-stone-900/70 sm:w-auto">
          <TabsTrigger value="personal" className="rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <UserRound className="mr-1.5 h-3.5 w-3.5" /> Pribadi
          </TabsTrigger>
          <TabsTrigger value="job" className="rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <BriefcaseBusiness className="mr-1.5 h-3.5 w-3.5" /> Pekerjaan
          </TabsTrigger>
          <TabsTrigger value="family" className="rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <HeartHandshake className="mr-1.5 h-3.5 w-3.5" /> Keluarga
          </TabsTrigger>
          <TabsTrigger value="education" className="rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <GraduationCap className="mr-1.5 h-3.5 w-3.5" /> Pendidikan
          </TabsTrigger>
        </TabsList>

        {/* ---- Pribadi ---- */}
        <TabsContent value="personal" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="px-5 py-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Identitas</p>
                <dl>
                  <InfoRow label="NIK" value={e.nationalId} />
                  <InfoRow label="NPWP" value={e.taxId} />
                  <InfoRow label="BPJS Kesehatan" value={e.bpjsHealth} />
                  <InfoRow label="BPJS Ketenagakerjaan" value={e.bpjsEmpSkill} />
                  <InfoRow label="Tempat, Tgl Lahir" value={e.birthPlace ? `${e.birthPlace}, ${fmtDate(e.birthDate)}` : fmtDate(e.birthDate)} />
                  <InfoRow label="Jenis Kelamin" value={e.gender === "F" ? "Perempuan" : "Laki-laki"} />
                </dl>
              </CardContent>
            </Card>
            <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="px-5 py-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Kontak & Lainnya</p>
                <dl>
                  <InfoRow label="Email" value={e.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-stone-400" /> {e.email}</span> : "—"} />
                  <InfoRow label="Telepon" value={e.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-stone-400" /> {e.phone}</span> : "—"} />
                  <InfoRow label="Alamat" value={e.address ? <span className="inline-flex items-start gap-1"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-stone-400" /> {e.city ? `${e.address}, ${e.city}` : e.address}</span> : "—"} />
                  <InfoRow label="Status Perkawinan" value={e.maritalStatus} />
                  <InfoRow label="Agama" value={e.religion} />
                  <InfoRow label="Gol. Darah" value={e.bloodType} />
                </dl>
              </CardContent>
            </Card>
          </div>
          <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="px-5 py-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Bank Payroll</p>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                <InfoRow label="Bank" value={e.bankName} />
                <InfoRow label="No. Rekening" value={e.bankAccount ? <span className="font-mono">{e.bankAccount}</span> : "—"} />
              </dl>
            </CardContent>
          </Card>
          <p className="text-[11px] text-stone-400">
            Data profil dikelola oleh HR. Temukan ketidaksesuaian? Hubungi {ess?.employee?.managerName ? `${ess.employee.managerName} (atasan Anda) ` : ""}atau tim HR untuk koreksi.
          </p>
        </TabsContent>

        {/* ---- Pekerjaan ---- */}
        <TabsContent value="job" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { l: "Perusahaan", v: e.company?.name ?? "—", icon: <Building2 className="h-3.5 w-3.5" /> },
              { l: "Posisi", v: e.position?.title ?? "—", icon: <BriefcaseBusiness className="h-3.5 w-3.5" /> },
              { l: "Grade", v: e.grade ? `${e.grade.code} — ${e.grade.name}` : "—", icon: <GraduationCap className="h-3.5 w-3.5" /> },
              { l: "Shift Kerja", v: e.workShift ?? "—", icon: <CalendarRange className="h-3.5 w-3.5" /> },
            ].map((x) => (
              <div key={x.l} className="rounded-xl border border-stone-200/80 bg-card p-4 shadow-sm dark:border-stone-800">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">{x.icon} {x.l}</p>
                <p className="mt-1 text-[13px] font-semibold text-stone-800 dark:text-stone-100">{x.v}</p>
              </div>
            ))}
          </div>

          {e.manager && (
            <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="flex items-center gap-4 p-4">
                <Avatar className="h-11 w-11">
                  {e.manager.photoUrl ? <AvatarImage src={e.manager.photoUrl} alt={e.manager.fullName} /> : null}
                  <AvatarFallback className="bg-stone-100 text-sm font-bold text-stone-600 dark:bg-stone-800">{initials(e.manager.fullName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-xs text-stone-400">Atasan Langsung</p>
                  <p className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">{e.manager.fullName} <span className="font-mono text-[11px] text-stone-400">{e.manager.employeeNo}</span></p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">{e.manager.position ?? "—"}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <p className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">Riwayat Penempatan</p>
            <ol className="relative space-y-0 border-l-2 border-stone-200 pl-6 dark:border-stone-800">
              {e.assignments.map((a, i) => (
                <motion.li
                  key={a.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.4) }}
                  className="relative pb-6 last:pb-0"
                >
                  <span className={cn(
                    "absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2",
                    a.validTo == null ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-500/30" : "border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900",
                  )} />
                  <p className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">
                    {a.position ?? "—"} · {a.orgUnit ?? "—"}
                    {a.validTo == null && <Badge className="ml-2 rounded-md bg-emerald-100 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400">Sekarang</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                    {fmtDate(a.validFrom)}{a.validTo ? ` – ${fmtDate(a.validTo)}` : " – sekarang"} · {a.changeReasonLabel}{a.sourceDocNo ? ` · ${a.sourceDocNo}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {a.employmentStatus} · {a.grade ?? "tanpa grade"}{a.managerName ? ` · atasan: ${a.managerName}` : ""}
                  </p>
                  {a.notes && <p className="mt-1 rounded-lg bg-stone-50 px-3 py-1.5 text-[11px] italic text-stone-500 dark:bg-stone-900/60 dark:text-stone-400">{a.notes}</p>}
                </motion.li>
              ))}
            </ol>
          </div>
        </TabsContent>

        {/* ---- Keluarga ---- */}
        <TabsContent value="family">
          {e.family.length === 0 ? (
            <EmptyState title="Belum ada data keluarga" description="Data keluarga/dependent digunakan untuk validasi BPJS & klaim medis dependent." icon={<HeartHandshake className="h-6 w-6" />} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {e.family.map((f, i) => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  className="rounded-xl border border-stone-200/80 bg-card p-4 shadow-sm dark:border-stone-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="rounded-lg border-teal-200 bg-teal-50 text-[10px] font-semibold text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400">
                      {RELATION_LABEL[f.relation] ?? f.relation}
                    </Badge>
                    {f.isDependent && <Badge variant="outline" className="rounded-lg border-emerald-200 bg-emerald-50 text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">Dependent</Badge>}
                  </div>
                  <p className="mt-2 text-[13px] font-semibold text-stone-800 dark:text-stone-100">{f.name}</p>
                  <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                    {f.gender === "F" ? "Perempuan" : "Laki-laki"}{f.birthDate ? ` · lahir ${fmtDate(f.birthDate)}` : ""}
                  </p>
                  {f.occupation && <p className="mt-0.5 text-xs text-stone-400">{f.occupation}</p>}
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Pendidikan ---- */}
        <TabsContent value="education">
          {e.education.length === 0 ? (
            <EmptyState title="Belum ada data pendidikan" icon={<GraduationCap className="h-6 w-6" />} />
          ) : (
            <div className="space-y-3">
              {e.education.map((ed, i) => (
                <motion.div
                  key={ed.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.3) }}
                  className="flex items-start gap-4 rounded-xl border border-stone-200/80 bg-card p-4 shadow-sm dark:border-stone-800"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                    <GraduationCap className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">
                      {ed.level}{ed.major ? ` — ${ed.major}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {ed.institution ?? "—"}
                      {ed.startYear && ed.endYear ? ` · ${ed.startYear}–${ed.endYear}` : ""}
                      {ed.gpa ? ` · IPK ${ed.gpa}` : ""}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
    </div>
  );
}
