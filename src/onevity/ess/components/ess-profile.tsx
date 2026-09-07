"use client";
// OneVity ESS — Profil Saya (REFACTOR: banner hero amber + foto besar +
// chip fakta + kartu atasan langsung + tab read-only) + Ganti Kata Sandi.
import { useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, BriefcaseBusiness, UserRound, IdCard, Building2, UserCheck, CalendarRange, MapPin, Mail, Phone, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateLong, initials, tenure } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill } from "@/onevity/shared/components/ui-kit";
import { ChangePasswordDialog } from "@/onevity/shared/components/shell/change-password-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { EssMe } from "./ess-types";

interface EssProfileProps { me: EssMe }

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-stone-200/70 py-2.5 last:border-b-0 dark:border-stone-800/70">
      <span className="w-40 shrink-0 text-[12px] font-semibold text-stone-400">{label}</span>
      <span className={cn("min-w-0 break-words text-right text-[13px]", value ? "font-bold text-stone-800 dark:text-stone-100" : "font-medium text-stone-300 dark:text-stone-600")}>
        {value || t("—")}
      </span>
    </div>
  );
}

export function EssProfile({ me }: EssProfileProps) {
  const { t } = useI18n();
  const [pwOpen, setPwOpen] = useState(false);
  const e = me.employee;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Profil Saya", "My Profile")}
        description={t("Data kepegawaian Anda — hanya dapat diubah oleh admin HR.", "Your employment data — editable by HR admin only.")}
        actions={
          <Button onClick={() => setPwOpen(true)} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
            <KeyRound className="h-4 w-4" /> {t("Ganti Kata Sandi", "Change Password")}
          </Button>
        }
      />

      {/* ===== banner identitas ===== */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-3xl border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="relative h-28 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 dark:from-amber-600 dark:via-amber-700 dark:to-orange-800">
          <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-orange-300/25 blur-2xl" aria-hidden />
        </div>
        <div className="relative -mt-12 px-5 pb-6 sm:px-6">
          <div className="flex flex-wrap items-end gap-4">
            <Avatar className="h-24 w-24 rounded-2xl border-4 border-white shadow-lg dark:border-stone-900">
              {e.photoUrl && <AvatarImage src={e.photoUrl} alt={e.fullName} />}
              <AvatarFallback className="rounded-2xl bg-amber-100 text-2xl font-extrabold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                {initials(e.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50">{e.fullName}</h2>
                {e.employmentStatus && <StatusPill status={e.employmentStatus} />}
              </div>
              <p className="mt-1 text-[13px] font-bold text-stone-600 dark:text-stone-300">
                <span className="font-mono text-amber-700 dark:text-amber-500">{e.employeeNo}</span>
                {e.positionTitle ? ` · ${e.positionTitle}` : ""}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-stone-400">
                <Building2 className="h-3 w-3 shrink-0" aria-hidden />
                {[e.orgUnitName, me.companyName].filter(Boolean).join(" · ") || t("tanpa unit organisasi", "no org unit")}
              </p>
              {/* chip fakta */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {e.joinDate && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10.5px] font-bold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                    <CalendarRange className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                    {t("bergabung {d}", "joined {d}", { d: fmtDate(e.joinDate) })} · {tenure(e.joinDate)}
                  </span>
                )}
                {e.gradeCode && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10.5px] font-bold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                    <Award className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                    {t("Grade {g}", "Grade {g}", { g: e.gradeCode })}{e.levelCode ? ` · ${e.levelCode}` : ""}
                  </span>
                )}
                {e.employmentStatus && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10.5px] font-bold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                    <BriefcaseBusiness className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                    {e.employmentStatus}
                  </span>
                )}
              </div>
            </div>
            {e.joinDate && (
              <div className="hidden rounded-2xl border border-stone-200/80 bg-white px-4 py-3 text-center dark:border-stone-800 dark:bg-stone-900/60 sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Masa Kerja", "Tenure")}</p>
                <p className="mt-0.5 text-lg font-extrabold text-amber-700 dark:text-amber-400">{tenure(e.joinDate)}</p>
                <p className="text-[10px] text-stone-400">{fmtDateLong(e.joinDate)}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* ===== atasan langsung ===== */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400">
              <UserCheck className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden /> {t("Atasan Langsung", "Direct Manager")}
            </p>
            <p className="mt-2 text-[15px] font-extrabold text-stone-900 dark:text-stone-50">{e.managerName ?? t("—")}</p>
            <p className="mt-0.5 text-[11px] text-stone-400">{t("Persetujuan pengajuan Anda mengalir ke atasan ini.", "Your request approvals flow to this manager.")}</p>
          </CardContent>
        </Card>
        {/* ===== kontak ===== */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400">
              <Mail className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden /> {t("Kontak", "Contact")}
            </p>
            <p className="mt-2 truncate text-[13px] font-bold text-stone-800 dark:text-stone-100">
              {e.email ?? t("—")}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-stone-800 dark:text-stone-100">
              <Phone className="h-3 w-3 text-stone-400" aria-hidden /> {e.phone ?? t("—")}
            </p>
          </CardContent>
        </Card>
        {/* ===== perusahaan ===== */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-400">
              <MapPin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden /> {t("Penempatan", "Placement")}
            </p>
            <p className="mt-2 text-[15px] font-extrabold text-stone-900 dark:text-stone-50">{me.companyName ?? t("—")}</p>
            <p className="mt-0.5 text-[11px] text-stone-400">{e.orgUnitName ?? t("—")}</p>
          </CardContent>
        </Card>
      </div>

      {/* ===== tab data lengkap ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-4 sm:p-6">
          <Tabs defaultValue="work">
            <TabsList className="mb-2 h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1 dark:bg-stone-900/70 sm:w-auto">
              <TabsTrigger value="work" className="gap-1.5 rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-amber-800 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-amber-400">
                <BriefcaseBusiness className="h-3.5 w-3.5" /> {t("Pekerjaan", "Employment")}
              </TabsTrigger>
              <TabsTrigger value="personal" className="gap-1.5 rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-amber-800 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-amber-400">
                <UserRound className="h-3.5 w-3.5" /> {t("Pribadi & Kontak", "Personal & Contact")}
              </TabsTrigger>
              <TabsTrigger value="identity" className="gap-1.5 rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:bg-white data-[state=active]:text-amber-800 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-amber-400">
                <IdCard className="h-3.5 w-3.5" /> {t("Identitas & Asuransi", "Identity & Insurance")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="work" className="mt-2">
              <div className="grid gap-x-8 lg:grid-cols-2">
                <div>
                  <InfoRow label={t("Posisi", "Position")} value={e.positionTitle} />
                  <InfoRow label={t("Unit Organisasi", "Org Unit")} value={e.orgUnitName} />
                  <InfoRow label={t("Grade")} value={e.gradeCode} />
                  <InfoRow label={t("Level Jabatan", "Job Level")} value={e.levelCode} />
                </div>
                <div>
                  <InfoRow label={t("Atasan Langsung", "Direct Manager")} value={e.managerName} />
                  <InfoRow label={t("Tanggal Bergabung", "Join Date")} value={e.joinDate ? fmtDate(e.joinDate) : null} />
                  <InfoRow label={t("Status Kepegawaian", "Employment Status")} value={e.employmentStatus} />
                  <InfoRow label={t("Perusahaan", "Company")} value={me.companyName} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="personal" className="mt-2">
              <div className="grid gap-x-8 lg:grid-cols-2">
                <div>
                  <InfoRow label={t("Nama Lengkap", "Full Name")} value={e.fullName} />
                  <InfoRow label={t("Nomor Karyawan", "Employee No.")} value={e.employeeNo} />
                </div>
                <div>
                  <InfoRow label={t("Email")} value={e.email} />
                  <InfoRow label={t("Telepon", "Phone")} value={e.phone} />
                </div>
              </div>
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("Perubahan data pribadi diajukan melalui admin HR (Personnel Action).", "Personal data changes are submitted through HR admin (Personnel Action).")}
              </p>
            </TabsContent>

            <TabsContent value="identity" className="mt-2">
              <div className="grid gap-x-8 lg:grid-cols-2">
                <div>
                  <InfoRow label={t("NPWP (Nomor Pajak)", "Tax ID (NPWP)")} value={e.taxId} />
                  <InfoRow label={t("BPJS Kesehatan", "BPJS Health")} value={e.bpjsHealth} />
                </div>
                <div>
                  <InfoRow label={t("BPJS Ketenagakerjaan", "BPJS Employment")} value={e.bpjsEmpskill} />
                </div>
              </div>
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-stone-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("Nomor identitas dipakai untuk pemotongan pajak & klaim asuransi.", "Identity numbers are used for tax withholding & insurance claims.")}
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
    </div>
  );
}
