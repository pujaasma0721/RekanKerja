"use client";
// RekanKerja ESS — Profil Saya (REFACTOR: banner hero amber + foto besar +
// chip fakta + kartu atasan langsung + tab read-only) + Ganti Kata Sandi.
// P1.1-BM (D-BM1): seksi "Ajukan Perubahan Data" — edit profil = PENGAJUAN
// (whitelist field pribadi + kontak darurat) → approval HR → patch otomatis;
// daftar "Pengajuan Saya" + batalkan selama menunggu.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, BriefcaseBusiness, UserRound, IdCard, Building2, UserCheck, CalendarRange, Mail, Phone, Award, Send, Loader2, History, Plus, Trash2, Pencil, PhoneCall, FileWarning, XCircle, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateLong, initials, tenure, useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { ChangePasswordDialog } from "@/rekankerja/shared/components/shell/change-password-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PushOptIn } from "@/rekankerja/shared/components/push/push-opt-in";
import type { EssMe } from "./ess-types";

interface EssProfileProps { me: EssMe }

// Status kepegawaian — nilai domain (provisioning EmploymentStatus:
// Permanent/Contract/Probation/Outsourcing) dilokalkan ke istilah Indonesia;
// nilai di luar peta tampil mentah (fallback mulus).
const EMPLOYMENT_STATUS_ID: Record<string, string> = {
  Permanent: "Tetap",
  Contract: "Kontrak",
  Probation: "Percobaan",
  Outsourcing: "Outsourcing",
};
const employmentStatusLabel = (t: (id: string, en: string) => string, value: string) =>
  t(EMPLOYMENT_STATUS_ID[value] ?? value, value);

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-slate-200/70 py-2.5 last:border-b-0 dark:border-slate-800/70">
      <span className="w-40 shrink-0 text-[12px] font-semibold text-slate-400">{label}</span>
      <span className={cn("min-w-0 break-words text-right text-[13px]", value ? "font-bold text-slate-800 dark:text-slate-100" : "font-medium text-slate-300 dark:text-slate-600")}>
        {value || t("—")}
      </span>
    </div>
  );
}

// P2.2-BM (D-BM17) — kartu opt-in web push (tab personal). Hidden fallback
// di browser tanpa dukungan SW/PushManager (cek pasca-mount — hindari
// hydration mismatch; tidak pernah error di browser lama).
function PushOptInCard() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => {
    // (cek pasca-mount asinkron — hindari hydration mismatch + cascading render)
    const id = window.setTimeout(() => {
      setShow(
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window,
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <Card className="mt-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
          {t("Notifikasi Push", "Push Notifications")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        <PushOptIn apiBase="/api/rekankerja/ess/push-subscriptions" />
      </CardContent>
    </Card>
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
        description={t(
          "Data kepegawaian Anda — perubahan data pribadi bisa diajukan sendiri lewat form di bawah (disetujui HR lalu otomatis diterapkan).",
          "Your employment data — personal data changes can be self-submitted via the form below (approved by HR, then applied automatically).",
        )}
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
        className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="relative h-28 bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 dark:from-amber-600 dark:via-amber-700 dark:to-amber-900">
          <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-amber-300/25 blur-2xl" aria-hidden />
        </div>
        <div className="relative -mt-12 px-5 pb-6 sm:px-6">
          <div className="flex flex-wrap items-end gap-4">
            <Avatar className="h-24 w-24 rounded-2xl border-4 border-white shadow-lg dark:border-slate-900">
              {e.photoUrl && <AvatarImage src={e.photoUrl} alt={e.fullName} />}
              <AvatarFallback className="rounded-2xl bg-amber-100 text-2xl font-extrabold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                {initials(e.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{e.fullName}</h2>
                {e.employmentStatus && <StatusPill status={e.employmentStatus} />}
              </div>
              <p className="mt-1 text-[13px] font-bold text-slate-600 dark:text-slate-300">
                <span className="font-mono text-amber-700 dark:text-amber-400">{e.employeeNo}</span>
                {e.positionTitle ? ` · ${e.positionTitle}` : ""}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-400">
                <Building2 className="h-3 w-3 shrink-0" aria-hidden />
                {[e.orgUnitName, me.companyName].filter(Boolean).join(" · ") || t("tanpa unit organisasi", "no org unit")}
              </p>
              {/* chip fakta */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {e.joinDate && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <CalendarRange className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                    {t("bergabung {d}", "joined {d}", { d: fmtDate(e.joinDate) })} · {tenure(e.joinDate)}
                  </span>
                )}
                {e.gradeCode && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <Award className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                    {t("Grade {g}", "Grade {g}", { g: e.gradeCode })}{e.levelCode ? ` · ${e.levelCode}` : ""}
                  </span>
                )}
                {e.employmentStatus && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <BriefcaseBusiness className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                    {employmentStatusLabel(t, e.employmentStatus)}
                  </span>
                )}
              </div>
            </div>
            {e.joinDate && (
              <div className="hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-center dark:border-slate-800 dark:bg-slate-900/60 sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Masa Kerja", "Tenure")}</p>
                <p className="mt-0.5 text-lg font-extrabold text-amber-700 dark:text-amber-400">{tenure(e.joinDate)}</p>
                <p className="text-[10px] text-slate-400">{fmtDateLong(e.joinDate)}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* ===== atasan langsung ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <UserRound className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("Atasan Langsung", "Direct Manager")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-0">
            <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50">{e.managerName ?? t("—")}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{t("Persetujuan pengajuan Anda mengalir ke atasan ini.", "Your request approvals flow to this manager.")}</p>
          </CardContent>
        </Card>
        {/* ===== kontak ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Mail className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("Kontak", "Contact")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-0">
            <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">
              {e.email ?? t("—")}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-800 dark:text-slate-100">
              <Phone className="h-3 w-3 text-slate-400" aria-hidden /> {e.phone ?? t("—")}
            </p>
          </CardContent>
        </Card>
        {/* ===== penempatan ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("Penempatan", "Placement")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-0">
            <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50">{me.companyName ?? t("—")}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{e.orgUnitName ?? t("—")}</p>
          </CardContent>
        </Card>
      </div>

      {/* ===== tab data lengkap ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-4 sm:p-6">
          <Tabs defaultValue="work">
            <TabsList className="mb-2 h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl ov-tile p-1/70 sm:w-auto">
              <TabsTrigger value="work" className="gap-1.5 rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:ov-fill">
                <BriefcaseBusiness className="h-3.5 w-3.5" /> {t("Pekerjaan", "Employment")}
              </TabsTrigger>
              <TabsTrigger value="personal" className="gap-1.5 rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:ov-fill">
                <UserRound className="h-3.5 w-3.5" /> {t("Pribadi & Kontak", "Personal & Contact")}
              </TabsTrigger>
              <TabsTrigger value="identity" className="gap-1.5 rounded-lg px-3.5 py-2 text-[13px] data-[state=active]:ov-fill">
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
                  <InfoRow label={t("Status Kepegawaian", "Employment Status")} value={e.employmentStatus ? employmentStatusLabel(t, e.employmentStatus) : null} />
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
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
                <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("Perubahan data pribadi (alamat, telepon, email, status pernikahan, kontak darurat) bisa diajukan sendiri di form “Ajukan Perubahan Data” di bawah — data master kepegawaian tetap melalui HR (Personnel Action).", "Personal data changes (address, phone, email, marital status, emergency contacts) can be self-submitted in the “Request a Data Change” form below — employment master data still goes through HR (Personnel Action).")}
              </p>
              {/* P2.2-BM (D-BM17) — opt-in web push perangkat */}
              <PushOptInCard />
            </TabsContent>

            <TabsContent value="identity" className="mt-2">
              <div className="grid gap-x-8 lg:grid-cols-2">
                <div>
                  <InfoRow label={t("NPWP (Nomor Pajak)", "Tax ID (NPWP)")} value={e.taxId} />
                  <InfoRow label={t("BPJS Kesehatan", "BPJS Health")} value={e.bpjsHealth} />
                </div>
                <div>
                  <InfoRow label={t("BPJS Ketenagakerjaan", "BPJS Employment")} value={e.bpjsEmpSkill} />
                </div>
              </div>
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("Nomor identitas dipakai untuk pemotongan pajak & klaim asuransi.", "Identity numbers are used for tax withholding & insurance claims.")}
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ===== P1.1-BM (D-BM1) — ajukan perubahan data diri + riwayat pengajuan ===== */}
      <EssProfileChangeSection />

      <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
    </div>
  );
}

// ================= P1.1-BM (D-BM1): AJUKAN PERUBAHAN DATA =================
// Form prefill nilai saat ini (whitelist: alamat/kota/email/telepon/status
// pernikahan) + mini-list kontak darurat (tambah/ubah/hapus) + alasan →
// POST /ess/profile-changes → approval HR → patch otomatis. Riwayat
// "Pengajuan Saya" + batalkan selama masih menunggu.

interface PcContactView { id: string; name: string; relationship: string; phone: string; address: string | null; isPrimary: boolean; notes: string | null }

interface PcRequestRow {
  id: string;
  docNo: string;
  status: string;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  approval: { currentApprover: string | null; currentLevel: number; totalLevels: number } | null;
  entries: { kind: string; label?: string; field?: string }[];
}

interface PcProfileData {
  current: { address: string | null; city: string | null; email: string | null; phone: string | null; maritalStatus: string | null };
  contacts: PcContactView[];
  requests: PcRequestRow[];
}

const MARITAL_OPTIONS = ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"] as const;
const MARITAL_OPTIONS_EN: Record<string, string> = { "Belum Menikah": "Single", "Menikah": "Married", "Cerai": "Divorced", "Janda/Duda": "Widowed" };
const EC_RELATION_EN: Record<string, string> = { "Pasangan": "Spouse", "Anak": "Child", "Orang Tua": "Parent", "Saudara": "Sibling", "Lainnya": "Other" };

/** Baris kontak darurat yang diedit lokal (contactId null = baru; removed = tandai hapus). */
interface EcDraft { contactId: string | null; name: string; relationship: string; phone: string; isPrimary: boolean; removed: boolean }

function EssProfileChangeSection() {
  const { t } = useI18n();
  const api = useApi<PcProfileData>("/api/rekankerja/ess/profile-changes");
  const [form, setForm] = useState({ email: "", phone: "", address: "", city: "", maritalStatus: "", reason: "" });
  const [ecDrafts, setEcDrafts] = useState<EcDraft[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  // prefill saat data pertama kali termuat (form = nilai saat ini)
  const data = api.data;
  if (data && loadedFor !== (data.current.email ?? "") + (data.current.phone ?? "")) {
    setLoadedFor((data.current.email ?? "") + (data.current.phone ?? ""));
    setForm({
      email: data.current.email ?? "",
      phone: data.current.phone ?? "",
      address: data.current.address ?? "",
      city: data.current.city ?? "",
      maritalStatus: data.current.maritalStatus ?? "",
      reason: "",
    });
    setEcDrafts(data.contacts.map((c) => ({ contactId: c.id, name: c.name, relationship: c.relationship, phone: c.phone, isPrimary: c.isPrimary, removed: false })));
  }

  const hasPending = (data?.requests ?? []).some((r) => r.status === "Submitted");

  const submit = async () => {
    if (!data) return;
    const entries: Record<string, unknown>[] = [];
    // field skalar — hanya yang berubah dari nilai saat ini (before ditangkap server)
    const fieldMap: [string, string, string | null][] = [
      ["email", form.email.trim(), data.current.email],
      ["phone", form.phone.trim(), data.current.phone],
      ["address", form.address.trim(), data.current.address],
      ["city", form.city.trim(), data.current.city],
      ["maritalStatus", form.maritalStatus.trim(), data.current.maritalStatus],
    ];
    for (const [field, after, current] of fieldMap) {
      if (after !== (current ?? "")) entries.push({ kind: "field", field, after: after || null });
    }
    // kontak darurat — add/update/remove dari draft lokal
    for (const d of ecDrafts) {
      if (d.contactId && d.removed) {
        entries.push({ kind: "contact", op: "remove", contactId: d.contactId });
        continue;
      }
      if (d.removed) continue; // baris baru yang dihapus sebelum disimpan → skip
      if (!d.name.trim() || !d.phone.trim()) {
        toast.error(t("Lengkapi nama & telepon pada baris kontak darurat", "Complete the name & phone on the emergency contact row"));
        return;
      }
      const orig = data.contacts.find((c) => c.id === d.contactId);
      const changed = !orig || orig.name !== d.name.trim() || orig.relationship !== d.relationship || orig.phone !== d.phone.trim() || orig.isPrimary !== d.isPrimary;
      if (!changed) continue;
      entries.push({
        kind: "contact",
        op: d.contactId ? "update" : "add",
        contactId: d.contactId,
        name: d.name.trim(),
        relationship: d.relationship,
        phone: d.phone.trim(),
        isPrimary: d.isPrimary,
      });
    }
    if (entries.length === 0) {
      toast.error(t("Belum ada perubahan — ubah field atau kontak darurat terlebih dahulu", "No changes yet — modify a field or an emergency contact first"));
      return;
    }
    setBusy(true);
    try {
      const res = (await apiSend<{ docNo: string }>("/api/rekankerja/ess/profile-changes", "POST", {
        entries,
        reason: form.reason.trim() || null,
      })) as { docNo: string };
      toast.success(t("Pengajuan {doc} terkirim — menunggu keputusan HR", "Request {doc} submitted — awaiting HR decision", { doc: res.docNo }));
      api.refresh();
      // reset form mengikuti nilai terkirim (draft tetap utk yang ditolak nanti)
      setForm((f) => ({ ...f, reason: "" }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/ess/profile-changes", "PATCH", { id });
      toast.success(t("Pengajuan dibatalkan", "Request cancelled"));
      setCancelId(null);
      api.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  if (api.loading && !api.data) {
    return (
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-4 sm:p-6"><LoadingRows rows={4} /></CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* ===== form pengajuan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Pencil className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Ajukan Perubahan Data", "Request a Data Change")}
          </CardTitle>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
            {t(
              "Isi nilai baru untuk data yang ingin diubah — nilai saat ini tampil sebagai isian. Perubahan berlaku SETELAH disetujui HR; data master kepegawaian (jabatan, unit, gaji) tetap melalui HR.",
              "Fill in the new values for the data you want to change — current values are prefilled. Changes apply AFTER HR approval; employment master data (position, unit, salary) still goes through HR.",
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {hasPending && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
              <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("Anda masih punya pengajuan yang menunggu keputusan — ajukan perubahan baru setelah pengajuan itu diputuskan.", "You still have a request awaiting decision — submit a new change after that one is decided.")}
            </p>
          )}

          <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="pc-email" className="text-xs">{t("Email Pribadi", "Personal Email")}</Label>
              <Input id="pc-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="mt-1.5" placeholder={t("mis. nama@email.com", "e.g. name@email.com")} />
            </div>
            <div>
              <Label htmlFor="pc-phone" className="text-xs">{t("Telepon", "Phone")}</Label>
              <Input id="pc-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="mt-1.5" inputMode="tel" placeholder="0812 3456 7890" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="pc-address" className="text-xs">{t("Alamat", "Address")}</Label>
              <Input id="pc-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="mt-1.5" placeholder={t("mis. Jl. Contoh No. 1", "e.g. 1 Example St")} />
            </div>
            <div>
              <Label htmlFor="pc-city" className="text-xs">{t("Kota", "City")}</Label>
              <Input id="pc-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className="mt-1.5" placeholder="Surabaya" />
            </div>
            <div>
              <Label htmlFor="pc-marital" className="text-xs">{t("Status Pernikahan", "Marital Status")}</Label>
              <Select
                value={MARITAL_OPTIONS.includes(form.maritalStatus as (typeof MARITAL_OPTIONS)[number]) ? form.maritalStatus : "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, maritalStatus: v === "none" ? "" : v }))}
              >
                <SelectTrigger id="pc-marital" className="mt-1.5"><SelectValue placeholder={t("— Pilih —", "— Select —")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                  {MARITAL_OPTIONS.map((m) => <SelectItem key={m} value={m}>{t(m, MARITAL_OPTIONS_EN[m])}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-slate-400">{t("Memengaruhi PTKP pada snapshot tahunan berikutnya.", "Affects PTKP at the next annual snapshot.")}</p>
            </div>
          </div>

          {/* mini-list kontak darurat */}
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <PhoneCall className="h-3.5 w-3.5 text-rose-500" aria-hidden /> {t("Kontak Darurat", "Emergency Contacts")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEcDrafts((d) => [...d, { contactId: null, name: "", relationship: "Pasangan", phone: "", isPrimary: d.length === 0, removed: false }])}
                className="h-7 gap-1 rounded-lg px-2.5 text-[11px] font-bold"
              >
                <Plus className="h-3 w-3" /> {t("Tambah", "Add")}
              </Button>
            </div>
            {ecDrafts.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-slate-400">{t("Belum ada kontak darurat — tambahkan orang yang bisa dihubungi saat darurat.", "No emergency contacts yet — add someone who can be contacted in an emergency.")}</p>
            ) : (
              <div className="space-y-2">
                {ecDrafts.map((d, i) => (
                  <div
                    key={d.contactId ?? `new-${i}`}
                    className={cn("grid gap-2 rounded-xl border bg-white p-2.5 sm:grid-cols-[1fr_130px_1fr_auto_auto] dark:bg-slate-900", d.removed ? "border-rose-200 opacity-60 dark:border-rose-500/30" : "border-slate-200 dark:border-slate-800")}
                  >
                    <Input
                      value={d.name}
                      onChange={(e) => setEcDrafts((rows) => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                      placeholder={t("Nama", "Name")}
                      className="h-8"
                      aria-label={t("Nama kontak darurat", "Emergency contact name")}
                      disabled={d.removed}
                    />
                    <Select
                      value={d.relationship}
                      onValueChange={(v) => setEcDrafts((rows) => rows.map((r, j) => j === i ? { ...r, relationship: v } : r))}
                      disabled={d.removed}
                    >
                      <SelectTrigger className="h-8" aria-label={t("Hubungan kontak darurat", "Emergency contact relationship")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Pasangan", "Anak", "Orang Tua", "Saudara", "Lainnya"].map((r) => (
                          <SelectItem key={r} value={r}>{t(r, EC_RELATION_EN[r] ?? r)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={d.phone}
                      onChange={(e) => setEcDrafts((rows) => rows.map((r, j) => j === i ? { ...r, phone: e.target.value } : r))}
                      placeholder={t("Telepon", "Phone")}
                      inputMode="tel"
                      className="h-8"
                      aria-label={t("Telepon kontak darurat", "Emergency contact phone")}
                      disabled={d.removed}
                    />
                    <button
                      type="button"
                      onClick={() => setEcDrafts((rows) => rows.map((r, j) => j === i ? { ...r, isPrimary: !r.isPrimary } : r))}
                      className={cn("h-8 rounded-lg border px-2 text-[10px] font-bold transition", d.isPrimary
                        ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                        : "border-slate-200 text-slate-400 dark:border-slate-700")}
                      aria-pressed={d.isPrimary}
                      aria-label={t("Kontak utama", "Primary contact")}
                    >
                      {t("Utama", "Primary")}
                    </button>
                    <button
                      type="button"
                      onClick={() => d.contactId
                        ? setEcDrafts((rows) => rows.map((r, j) => j === i ? { ...r, removed: !r.removed } : r))
                        : setEcDrafts((rows) => rows.filter((_, j) => j !== i))}
                      className="h-8 rounded-lg p-0 px-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                      aria-label={d.removed ? t("Batalkan hapus kontak", "Undo remove contact") : t("Hapus kontak darurat", "Remove emergency contact")}
                    >
                      {d.removed ? <XCircle className="h-4 w-4" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="pc-reason" className="text-xs">{t("Alasan perubahan (opsional)", "Reason for the change (optional)")}</Label>
            <Textarea
              id="pc-reason"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              rows={2}
              maxLength={500}
              className="mt-1.5"
              placeholder={t("mis. pindah rumah…", "e.g. moved house…")}
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void submit()} disabled={busy || hasPending} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? t("Mengirim…", "Submitting…") : t("Ajukan Perubahan", "Submit Change Request")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== pengajuan saya ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Pengajuan Saya", "My Requests")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(data?.requests ?? []).length === 0 ? (
            <EmptyState
              title={t("Belum ada pengajuan", "No requests yet")}
              description={t("Pengajuan ubah data Anda dan status persetujuannya tampil di sini.", "Your data change requests and their approval status appear here.")}
              icon={History}
            />
          ) : (
            <ul className="space-y-2.5">
              {(data!.requests).map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-100 p-3.5 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] font-bold text-slate-600 dark:text-slate-300">{r.docNo}</span>
                    <StatusPill status={r.status} />
                    <span className="ml-auto text-[11px] text-slate-400">{fmtDate(r.createdAt)}</span>
                  </div>
                  {r.reason && (
                    <p className="mt-1 text-[11px] italic text-slate-400">“{r.reason}”</p>
                  )}
                  {r.status === "Submitted" && r.approval?.currentApprover && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t("Menunggu keputusan: {who}", "Awaiting decision: {who}", { who: r.approval.currentApprover })}
                    </p>
                  )}
                  {r.decisionNote && (
                    <p className={cn("mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed",
                      r.status === "Rejected" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" : "bg-slate-100/70 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400")}>
                      {r.status === "Rejected" ? t("Alasan penolakan", "Rejection reason") : t("Catatan HR", "HR note")}: {r.decisionNote}
                    </p>
                  )}
                  {r.status === "Submitted" && (
                    cancelId === r.id ? (
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => setCancelId(null)} disabled={busy}>{t("Jangan", "No")}</Button>
                        <Button size="sm" className="h-7 gap-1 rounded-lg bg-rose-600 px-3 text-[11px] font-bold text-white hover:bg-rose-700" onClick={() => void cancel(r.id)} disabled={busy}>
                          {busy && <Loader2 className="h-3 w-3 animate-spin" />} {t("Ya, Batalkan", "Yes, Cancel")}
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-2 flex justify-end">
                        <Button variant="outline" size="sm" className="h-7 gap-1 rounded-lg px-3 text-[11px] font-bold" onClick={() => setCancelId(r.id)}>
                          <XCircle className="h-3 w-3" /> {t("Batalkan Pengajuan", "Cancel Request")}
                        </Button>
                      </div>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
