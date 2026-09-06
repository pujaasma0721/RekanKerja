"use client";
// OneVity ESS — Profil Saya: kartu profil + tab read-only
// (Pekerjaan / Pribadi & Kontak / Identitas & Asuransi) + Ganti Kata Sandi.
import { useState } from "react";
import { KeyRound, BriefcaseBusiness, UserRound, IdCard, Building2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, initials, tenure } from "@/onevity/shared/lib/api";
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
      <span className="shrink-0 text-[12px] font-semibold text-stone-400">{label}</span>
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

      {/* kartu identitas */}
      <Card className="overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-5 border-b border-stone-100 bg-gradient-to-br from-amber-50/80 to-stone-50/40 p-6 dark:border-stone-800 dark:from-amber-500/10 dark:to-stone-900/20">
            <Avatar className="h-20 w-20 ring-4 ring-amber-500/20">
              {e.photoUrl && <AvatarImage src={e.photoUrl} alt={e.fullName} />}
              <AvatarFallback className="bg-amber-100 text-xl font-extrabold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                {initials(e.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50">{e.fullName}</h2>
                {e.employmentStatus && <StatusPill status={e.employmentStatus} />}
              </div>
              <p className="mt-1 text-[13px] font-semibold text-stone-500 dark:text-stone-400">
                <span className="font-mono">{e.employeeNo}</span>
                {e.positionTitle ? ` · ${e.positionTitle}` : ""}
              </p>
              <p className="mt-0.5 text-[12px] text-stone-400">
                {[e.orgUnitName, me.companyName].filter(Boolean).join(" · ") || t("tanpa unit organisasi", "no org unit")}
              </p>
            </div>
            {e.joinDate && (
              <div className="rounded-2xl border border-stone-200/80 bg-white px-4 py-3 text-center dark:border-stone-800 dark:bg-stone-900/60">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Masa Kerja", "Tenure")}</p>
                <p className="mt-0.5 text-lg font-extrabold text-amber-700 dark:text-amber-400">{tenure(e.joinDate)}</p>
                <p className="text-[10px] text-stone-400">{t("bergabung {d}", "joined {d}", { d: fmtDate(e.joinDate) })}</p>
              </div>
            )}
          </div>

          {/* tab read-only */}
          <div className="p-4 sm:p-6">
            <Tabs defaultValue="work">
              <TabsList className="mb-2">
                <TabsTrigger value="work" className="gap-1.5">
                  <BriefcaseBusiness className="h-3.5 w-3.5" /> {t("Pekerjaan", "Employment")}
                </TabsTrigger>
                <TabsTrigger value="personal" className="gap-1.5">
                  <UserRound className="h-3.5 w-3.5" /> {t("Pribadi & Kontak", "Personal & Contact")}
                </TabsTrigger>
                <TabsTrigger value="identity" className="gap-1.5">
                  <IdCard className="h-3.5 w-3.5" /> {t("Identitas & Asuransi", "Identity & Insurance")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="work" className="mt-2">
                <Card className="rounded-xl border-stone-200/70 dark:border-stone-800">
                  <CardContent className="px-5 py-2">
                    <InfoRow label={t("Posisi", "Position")} value={e.positionTitle} />
                    <InfoRow label={t("Unit Organisasi", "Org Unit")} value={e.orgUnitName} />
                    <InfoRow label={t("Grade")} value={e.gradeCode} />
                    <InfoRow label={t("Level Jabatan", "Job Level")} value={e.levelCode} />
                    <InfoRow label={t("Atasan Langsung", "Direct Manager")} value={e.managerName} />
                    <InfoRow label={t("Tanggal Bergabung", "Join Date")} value={e.joinDate ? fmtDate(e.joinDate) : null} />
                    <InfoRow label={t("Status Kepegawaian", "Employment Status")} value={e.employmentStatus} />
                    <InfoRow label={t("Perusahaan", "Company")} value={me.companyName} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="personal" className="mt-2">
                <Card className="rounded-xl border-stone-200/70 dark:border-stone-800">
                  <CardContent className="px-5 py-2">
                    <InfoRow label={t("Nama Lengkap", "Full Name")} value={e.fullName} />
                    <InfoRow label={t("Nomor Karyawan", "Employee No.")} value={e.employeeNo} />
                    <InfoRow label={t("Email")} value={e.email} />
                    <InfoRow label={t("Telepon", "Phone")} value={e.phone} />
                    <p className="flex items-start gap-2 rounded-xl bg-amber-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("Perubahan data pribadi diajukan melalui admin HR (Personnel Action).", "Personal data changes are submitted through HR admin (Personnel Action).")}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="identity" className="mt-2">
                <Card className="rounded-xl border-stone-200/70 dark:border-stone-800">
                  <CardContent className="px-5 py-2">
                    <InfoRow label={t("NPWP (Nomor Pajak)", "Tax ID (NPWP)")} value={e.taxId} />
                    <InfoRow label={t("BPJS Kesehatan", "BPJS Health")} value={e.bpjsHealth} />
                    <InfoRow label={t("BPJS Ketenagakerjaan", "BPJS Employment")} value={e.bpjsEmpskill} />
                    <p className="flex items-start gap-2 rounded-xl bg-stone-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                      <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("Nomor identitas dipakai untuk pemotongan pajak & klaim asuransi.", "Identity numbers are used for tax withholding & insurance claims.")}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
    </div>
  );
}
