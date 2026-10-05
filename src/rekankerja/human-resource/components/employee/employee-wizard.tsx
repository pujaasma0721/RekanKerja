"use client";
// RekanKerja — Onboarding Wizard (redesign v2: layout dokumen + rail ringkasan live, stepper kompak, draft autosave)
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, fmtIDR, initials } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  UserPlus, User, Briefcase, Wallet, ClipboardCheck, CheckCircle2, ChevronLeft, ChevronRight,
  Check, Pencil, Scale, AlertTriangle, Ban, FileWarning, Users2, IdCard, Lightbulb, Sparkles,
  Loader2, ArrowRight, Building2, Trash2, Mail, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { RELIGIONS_EN, MARITAL_STATUSES_EN, WORK_SHIFTS_EN, EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUS_LABEL_EN } from "./types";
import { motion } from "framer-motion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LetterPreviewDialog } from "./letter-preview-dialog";

export interface WizardOptions {
  orgUnits: { id: string; name: string; level: number; code: string }[];
  positions: { id: string; title: string; code: string; orgUnitId: string | null; positionLevel?: { code: string; name: string } | null }[];
  grades: { id: string; code: string; name: string; minSalary: number; maxSalary: number }[];
  managers: { id: string; fullName: string; employeeNo: string; position: { title: string } | null; orgUnitId: string | null }[];
  lookups: Record<string, { code: string; label: string }[]>;
}

// opsi referensi kantor & lokasi kerja (dimensi approval berjenjang — Task 25)
interface CompanyOfficeOption { id: string; code: string; name: string; city: string | null }
interface WorkLocationOption { id: string; code: string; name: string; city: string | null; officeId: string | null }

const STEPS = [
  { id: 1, label: "Data Personal", icon: User },
  { id: 2, label: "Info Pekerjaan", icon: Briefcase },
  { id: 3, label: "Upah & Bank", icon: Wallet },
  { id: 4, label: "Review", icon: ClipboardCheck },
];

// label EN paralel untuk langkah wizard (kunci = id langkah)
const STEPS_EN: Record<number, string> = {
  1: "Personal Details",
  2: "Job Details",
  3: "Salary & Bank",
  4: "Review",
};

const DRAFT_KEY = "rekankerja:onboarding-draft";

const EMPTY_FORM: Record<string, string> = {
  fullName: "", gender: "M", birthPlace: "", birthDate: "", nationalId: "", taxId: "",
  maritalStatus: "", religion: "", bloodType: "", email: "", phone: "", address: "", city: "",
  orgUnitId: "", positionId: "", gradeId: "", employmentStatus: "Probation", joinDate: "", managerId: "", workShift: "Regular",
  companyOfficeId: "", workLocationId: "",
  baseSalary: "", bankName: "", bankAccount: "",
  // 26-b P0 — PKWT PP 35/2021 (hanya relevan utk Contract/Probation/Outsourcing)
  contractStart: "", contractEnd: "", renewalCount: "",
};

const TIPS: Record<number, { icon: React.ElementType; text: string }> = {
  1: { icon: IdCard, text: "Data identitas dipakai untuk kontrak kerja & pelaporan pajak. NIK harus 16 digit sesuai KTP — sisanya boleh dilewati dulu dan dilengkapi nanti." },
  2: { icon: Building2, text: "Karyawan baru otomatis berstatus Probation kecuali diubah. Atasan langsung menentukan jalur approval cuti & pengajuan PA-nya nanti." },
  3: { icon: Wallet, text: "Gaji pokok di luar tunjangan. Komponen tunjangan (transport, makan, lembur) bisa diatur setelah karyawan aktif di modul Payroll." },
  4: { icon: ClipboardCheck, text: "Periksa kembali sebelum menyimpan — nomor karyawan akan dibuat otomatis dan tidak bisa diubah setelah tersimpan." },
};

// teks EN paralel untuk tips per langkah
const TIPS_EN: Record<number, string> = {
  1: "Identity data is used for the employment contract & tax reporting. The NIK must be 16 digits per the ID card — everything else can be skipped now and completed later.",
  2: "New employees default to Probation status unless changed. The direct manager determines the approval route for their leave requests & personnel actions later.",
  3: "Base salary excludes allowances. Allowance components (transport, meals, overtime) can be configured once the employee is active in the Payroll module.",
  4: "Double-check before saving — the employee number is generated automatically and cannot be changed afterwards.",
};

const TRACKED_FIELDS = [
  "fullName", "birthDate", "nationalId", "taxId", "email", "phone", "address", "city",
  "orgUnitId", "positionId", "gradeId", "joinDate", "managerId", "companyOfficeId", "workLocationId",
  "baseSalary", "bankName", "bankAccount",
  "contractStart", "contractEnd",
];

export function OnboardingWizard() {
  const { navigate } = useNav();
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const opts = useApi<WizardOptions>("/api/rekankerja/employee-options");
  // referensi kantor & lokasi kerja (Task 25) — penempatan dimensi approval berjenjang
  const officesApi = useApi<{ offices: CompanyOfficeOption[] }>("/api/rekankerja/company-offices");
  const locationsApi = useApi<{ locations: WorkLocationOption[] }>("/api/rekankerja/work-locations");
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; employeeNo: string; fullName: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftAt, setDraftAt] = useState<Date | null>(null);
  const restored = useRef(false);

  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };

  // restore draft on mount (once)
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { form: Record<string, string>; at: string };
        if (d.form && TRACKED_FIELDS.some((k) => d.form[k]?.trim())) {
          setForm((f) => ({ ...f, ...d.form }));
          setDraftAt(new Date(d.at));
        }
      }
    } catch { /* draft korup — abaikan */ }
  }, []);

  // autosave draft (debounce ringan) — hanya jika ada data terisi
  useEffect(() => {
    if (!restored.current) return;
    const hasData = TRACKED_FIELDS.some((k) => form[k]?.trim());
    const t = setTimeout(() => {
      try {
        if (hasData) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, at: new Date().toISOString() }));
          setDraftAt(new Date());
        } else {
          localStorage.removeItem(DRAFT_KEY);
          setDraftAt(null);
        }
      } catch { /* storage penuh — abaikan */ }
    }, 600);
    return () => clearTimeout(t);
  }, [form]);

  const lk = (cat: string) => opts.data?.lookups?.[cat] ?? [];

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {};
    if (s === 1) {
      if (!form.fullName.trim()) errs.fullName = t("Nama lengkap wajib diisi", "Full name is required");
      if (form.nationalId && !/^\d{16}$/.test(form.nationalId)) errs.nationalId = t("NIK harus 16 digit angka", "NIK must be 16 digits");
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = t("Format email tidak valid", "Invalid email format");
    }
    if (s === 2) {
      if (!form.orgUnitId) errs.orgUnitId = t("Pilih unit organisasi", "Select an organizational unit");
      if (!form.positionId) errs.positionId = t("Pilih posisi", "Select a position");
      if (!form.joinDate) errs.joinDate = t("Tanggal masuk wajib diisi", "Join date is required");
      // 26-b — PKWT: akhir kontrak harus setelah mulai (bila keduanya diisi)
      if (form.contractStart && form.contractEnd && form.contractEnd <= form.contractStart) {
        errs.contractEnd = t("Harus setelah tanggal mulai", "Must be after the start date");
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep(step)) { setStep((s) => Math.min(s + 1, 4)); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else toast.error(t("Lengkapi field yang ditandai merah", "Complete the fields marked in red"));
  };
  const back = () => { setStep((s) => Math.max(s - 1, 1)); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ employee: { id: string; employeeNo: string; fullName: string } }>("/api/rekankerja/employees", "POST", {
        ...form,
        baseSalary: Number(form.baseSalary) || 0,
        birthDate: form.birthDate || null,
        joinDate: form.joinDate || undefined,
        managerId: form.managerId || null,
        gradeId: form.gradeId || null,
        companyOfficeId: form.companyOfficeId || null,
        workLocationId: form.workLocationId || null,
        // 26-b — PKWT: kosong bila Permanent (server juga mengosongkan)
        contractStart: form.contractStart || null,
        contractEnd: form.contractEnd || null,
        renewalCount: Number(form.renewalCount) || 0,
      });
      setCreated(res.employee);
      setStep(5);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      setDraftAt(null);
      toast.success(t("Karyawan {no} berhasil di-onboard", "Employee {no} successfully onboarded", { no: res.employee.employeeNo }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setCreated(null);
    setErrors({});
    setStep(1);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
    setDraftAt(null);
  };

  const selectedGrade = opts.data?.grades.find((g) => g.id === form.gradeId);
  const selectedPosition = opts.data?.positions.find((p) => p.id === form.positionId);
  const selectedUnit = opts.data?.orgUnits.find((u) => u.id === form.orgUnitId);
  const selectedManager = opts.data?.managers.find((m) => m.id === form.managerId);
  const selectedOffice = officesApi.data?.offices.find((o) => o.id === form.companyOfficeId);
  const selectedLocation = locationsApi.data?.locations.find((l) => l.id === form.workLocationId);
  const filteredPositions = useMemo(
    () => opts.data?.positions.filter((p) => !form.orgUnitId || p.orgUnitId === form.orgUnitId) ?? [],
    [opts.data, form.orgUnitId],
  );

  const filled = TRACKED_FIELDS.filter((k) => form[k]?.trim()).length;
  const pct = Math.round((filled / TRACKED_FIELDS.length) * 100);

  const stepMeta = STEPS.find((s) => s.id === step);

  return (
    <div>
      <PageHeader
        eyebrow={t("Karyawan")}
        title={t("Onboarding Karyawan")}
        description={t(
          "Lengkapi data karyawan baru dalam 4 langkah — ringkasan di sisi kanan terisi otomatis saat Anda mengetik",
          "Complete new employee data in 4 steps — the summary on the right fills in as you type",
        )}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate("employee", "directory")} className="h-8 gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowRight className="h-3.5 w-3.5" /> {t("Ke direktori", "To directory")}
          </Button>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ============ KOLOM UTAMA ============ */}
        <Card className={cn("rounded-2xl border-slate-200/90 shadow-sm dark:border-slate-800", step === 5 && "overflow-hidden")}>
          {/* stepper kompak */}
          <div className="rounded-t-2xl border-b border-slate-200/80 bg-slate-50/60 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900/40 sm:px-6">
            <ol className="hidden items-center sm:flex">
              {STEPS.map((s, i) => {
                const done = step > s.id;
                const active = step === s.id;
                return (
                  <li key={s.id} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
                    <button
                      type="button"
                      onClick={() => { if (done) { setStep(s.id); setErrors({}); } }}
                      className="group flex flex-col items-center gap-1"
                      aria-current={active ? "step" : undefined}
                    >
                      <span className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all",
                        done ? "ov-fill ov-glow group-hover:ov-fill-deep" :
                        active ? "bg-white ov-text-accent ring-2 ring-ring ring-offset-2 ring-offset-slate-50 dark:bg-slate-900 dark:ring-offset-slate-900" :
                        "bg-slate-200/80 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
                      )}>
                        {done ? <Check className="h-3.5 w-3.5" /> : s.id}
                      </span>
                      <span className={cn(
                        "max-w-[88px] truncate text-[11px] font-semibold leading-tight",
                        active ? "text-slate-900 dark:text-slate-100" : done ? "text-slate-500 dark:text-slate-400 group-hover:text-slate-700" : "text-slate-400 dark:text-slate-500",
                      )}>{t(s.label, STEPS_EN[s.id])}</span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className={cn("mx-2 mb-4 h-0.5 flex-1 rounded-full sm:mx-3", step > s.id ? "ov-bar" : "bg-slate-200 dark:bg-slate-800")} />
                    )}
                  </li>
                );
              })}
            </ol>
            {/* mobile: mini progress */}
            <div className="sm:hidden">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{t("Langkah {n} dari 4", "Step {n} of 4", { n: Math.min(step, 4) })} · <span className="font-semibold ov-text-accent">{stepMeta && t(stepMeta.label, STEPS_EN[stepMeta.id])}</span></p>
                <p className="text-[10px] font-semibold text-slate-400">{t("{p}% terisi", "{p}% complete", { p: pct })}</p>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full ov-chart transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {/* konten langkah */}
          <div className="px-4 py-5 sm:px-6 sm:py-6">
            {step <= 4 && !opts.data && (
              <div className="space-y-3">
                <div className="h-5 w-40 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                <div className="grid gap-4 sm:grid-cols-2">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
                </div>
              </div>
            )}

            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
              {opts.data && step === 1 && (
                <div className="space-y-6">
                  <SectionLabel icon={IdCard} title={t("Identitas", "Identity")} />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label={t("Nama Lengkap")} required error={errors.fullName}>
                      <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Andi Pratama" className={cn("h-9", errors.fullName && "border-rose-400 focus-visible:ring-rose-400")} />
                    </Field>
                    <Field label={t("Jenis Kelamin", "Gender")}>
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
                        {([["M", t("Laki-laki", "Male")], ["F", t("Perempuan", "Female")]] as const).map(([v, l]) => (
                          <button key={v} type="button" onClick={() => set("gender", v)}
                            className={cn("flex h-7 items-center justify-center rounded-md text-xs font-semibold transition-all",
                              form.gender === v ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label={t("Tempat Lahir", "Place of Birth")}>
                      <Input value={form.birthPlace} onChange={(e) => set("birthPlace", e.target.value)} placeholder="Bandung" className="h-9" />
                    </Field>
                    <Field label={t("Tanggal Lahir", "Date of Birth")}>
                      <Input type="date" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} className="h-9" />
                    </Field>
                    <Field label={t("NIK (KTP)", "NIK (ID Card)")} error={errors.nationalId} hint={t("16 digit", "16 digits")}>
                      <Input value={form.nationalId} onChange={(e) => set("nationalId", e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="327xxxxxxxxxxxxx" inputMode="numeric" className={cn("h-9 font-mono", errors.nationalId && "border-rose-400 focus-visible:ring-rose-400")} />
                    </Field>
                    <Field label={t("NPWP")} error={errors.taxId} hint={t("opsional", "optional")}>
                      <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} className="h-9 font-mono" />
                    </Field>
                    <Field label={t("Status Pernikahan", "Marital Status")}>
                      <Select value={form.maritalStatus || "none"} onValueChange={(v) => set("maritalStatus", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih", "Select")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {lk("MaritalStatus").map((m) => <SelectItem key={m.code} value={m.label}>{t(m.label, MARITAL_STATUSES_EN[m.label] ?? m.label)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Agama", "Religion")}>
                      <Select value={form.religion || "none"} onValueChange={(v) => set("religion", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih", "Select")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {lk("Religion").map((r) => <SelectItem key={r.code} value={r.label}>{t(r.label, RELIGIONS_EN[r.label] ?? r.label)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Golongan Darah", "Blood Type")}>
                      <Select value={form.bloodType || "none"} onValueChange={(v) => set("bloodType", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih", "Select")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {lk("BloodType").map((b) => <SelectItem key={b.code} value={b.label}>{b.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <SectionLabel icon={Mail} title={t("Kontak & Alamat", "Contact & Address")} className="pt-1" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label={t("Email")} error={errors.email}>
                      <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="nama@mii.co.id" className={cn("h-9", errors.email && "border-rose-400 focus-visible:ring-rose-400")} />
                    </Field>
                    <Field label={t("Telepon")}>
                      <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0812 3456 7890" inputMode="tel" className="h-9" />
                    </Field>
                    <Field label={t("Alamat")} className="sm:col-span-2">
                      <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Jl. Rungkut Industri No. 10, Surabaya" className="h-9" />
                    </Field>
                    <Field label={t("Kota", "City")}>
                      <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Surabaya" className="h-9" />
                    </Field>
                  </div>
                </div>
              )}

              {opts.data && step === 2 && (
                <div className="space-y-6">
                  <SectionLabel icon={Building2} title={t("Penempatan", "Placement")} />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label={t("Unit Organisasi")} required error={errors.orgUnitId}>
                      <Select value={form.orgUnitId || "none"} onValueChange={(v) => { set("orgUnitId", v === "none" ? "" : v); set("positionId", ""); }}>
                        <SelectTrigger className={cn("h-9", errors.orgUnitId && "border-rose-400")}><SelectValue placeholder={t("Pilih unit", "Select unit")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {(opts.data?.orgUnits ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Posisi")} required error={errors.positionId} hint={form.orgUnitId ? t("{n} posisi tersedia", "{n} positions available", { n: filteredPositions.length }) : t("pilih unit dulu", "select a unit first")}>
                      <Select value={form.positionId || "none"} onValueChange={(v) => set("positionId", v === "none" ? "" : v)}>
                        <SelectTrigger className={cn("h-9", errors.positionId && "border-rose-400")}><SelectValue placeholder={form.orgUnitId ? t("Posisi di unit ini", "Positions in this unit") : t("Pilih posisi", "Select position")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {filteredPositions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {selectedPosition?.positionLevel && (
                        <p className="text-[11px] font-bold ov-text-accent">{t("Level Jabatan: {code} — {name}", "Job Level: {code} — {name}", { code: selectedPosition.positionLevel.code, name: selectedPosition.positionLevel.name })}</p>
                      )}
                    </Field>
                    <Field label={t("Grade")} hint={selectedGrade ? t("rentang {min} – {max}", "range {min} – {max}", { min: fmtIDR(selectedGrade.minSalary), max: fmtIDR(selectedGrade.maxSalary) }) : t("menentukan rentang gaji", "determines the salary range")}>
                      <Select value={form.gradeId || "none"} onValueChange={(v) => set("gradeId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih grade", "Select grade")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {(opts.data?.grades ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Atasan Langsung", "Direct Manager")} hint={t("jalur approval", "approval route")}>
                      <Select value={form.managerId || "none"} onValueChange={(v) => set("managerId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih atasan", "Select manager")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Tanpa atasan —", "— No manager —")}</SelectItem>
                          {(opts.data?.managers ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.position?.title ?? "—"}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Kantor (Company Office)", "Office (Company Office)")} hint={t("opsional — dimensi approval", "optional — approval dimension")}>
                      <Select value={form.companyOfficeId || "none"} onValueChange={(v) => set("companyOfficeId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih kantor", "Select office")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Tanpa kantor —", "— No office —")}</SelectItem>
                          {(officesApi.data?.offices ?? []).map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.code} — {o.name}{o.city ? ` (${o.city})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Lokasi Kerja (Work Location)", "Work Location")} hint={selectedOffice ? t("opsional · {n} lokasi", "optional · {n} locations", { n: locationsApi.data?.locations.length ?? 0 }) : t("opsional", "optional")}>
                      <Select value={form.workLocationId || "none"} onValueChange={(v) => set("workLocationId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih lokasi kerja", "Select work location")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Tanpa lokasi —", "— No location —")}</SelectItem>
                          {(locationsApi.data?.locations ?? []).map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}{l.city ? ` (${l.city})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <SectionLabel icon={Briefcase} title={t("Kepegawaian", "Employment")} className="pt-1" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
                    <Field label={t("Status Kepegawaian", "Employment Status")}>
                      <Select
                        value={form.employmentStatus}
                        onValueChange={(v) => {
                          set("employmentStatus", v);
                          // 26-b — Permanent = PKS tanpa batas: kosongkan jejak PKWT
                          if (v === "Permanent") setForm((f) => ({ ...f, contractStart: "", contractEnd: "", renewalCount: "" }));
                        }}
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {lk("EmploymentStatus").map((s) => <SelectItem key={s.code} value={s.label}>{t(EMPLOYMENT_STATUS_LABEL[s.label] ?? s.label, EMPLOYMENT_STATUS_LABEL_EN[s.label])}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Tanggal Masuk", "Join Date")} required error={errors.joinDate}>
                      <Input type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} className={cn("h-9", errors.joinDate && "border-rose-400")} />
                    </Field>
                    <Field label={t("Jadwal Kerja", "Work Schedule")}>
                      <Select value={form.workShift} onValueChange={(v) => set("workShift", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {lk("WorkShift").map((s) => <SelectItem key={s.code} value={s.label}>{t(s.label, WORK_SHIFTS_EN[s.label] ?? s.label)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  {/* 26-b P0 — PKWT PP 35/2021: tanggal kontrak (khusus Contract/Probation/Outsourcing) */}
                  {["Contract", "Probation", "Outsourcing"].includes(form.employmentStatus) && (
                    <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3.5 dark:border-amber-500/25 dark:bg-amber-500/10">
                      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <FileWarning className="h-3.5 w-3.5" /> {t("Kontrak PKWT — PP 35/2021", "PKWT Contract — PP 35/2021")}
                      </p>
                      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
                        <Field label={t("Mulai Kontrak", "Contract Start")} hint={t("default: tgl masuk", "default: join date")}>
                          <Input
                            type="date"
                            value={form.contractStart}
                            onChange={(e) => set("contractStart", e.target.value)}
                            placeholder={form.joinDate}
                            className="h-9"
                            aria-label={t("Tanggal mulai kontrak", "Contract start date")}
                          />
                        </Field>
                        <Field label={t("Berakhir Kontrak", "Contract End")} error={errors.contractEnd} hint={t("wajib utk PKWT", "required for PKWT")}>
                          <Input
                            type="date"
                            value={form.contractEnd}
                            onChange={(e) => set("contractEnd", e.target.value)}
                            className={cn("h-9", errors.contractEnd && "border-rose-400 focus-visible:ring-rose-400")}
                            aria-label={t("Tanggal berakhir kontrak", "Contract end date")}
                          />
                        </Field>
                        <Field label={t("Perpanjangan Ke-", "Renewal No.")} hint={t("0 = kontrak pertama", "0 = first contract")}>
                          <Input
                            type="number"
                            min={0}
                            value={form.renewalCount}
                            onChange={(e) => set("renewalCount", e.target.value.replace(/\D/g, ""))}
                            className="h-9 font-mono"
                            placeholder="0"
                            aria-label={t("Jumlah perpanjangan kontrak", "Contract renewal count")}
                          />
                        </Field>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-400/90">
                        {t(
                          "Total PKWT + perpanjangan maksimal 5 tahun (Pasal 8) — sistem memperingatkan bila terlampaui dan menyarankan konversi ke PKS.",
                          "Total PKWT plus renewals is capped at 5 years (Article 8) — the system warns when exceeded and suggests converting to a permanent contract.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {opts.data && step === 3 && (
                <div className="space-y-6">
                  <SectionLabel icon={Wallet} title={t("Gaji Pokok")} />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label={t("Gaji Pokok")} hint={t("di luar tunjangan", "excludes allowances")}>
                      <Input type="number" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} placeholder="5500000" inputMode="numeric" className="h-9 font-mono" />
                      {form.baseSalary && <p className="mt-1 text-[11px] font-bold ov-text-accent">{t("{v} / bulan", "{v} / month", { v: fmtIDR(Number(form.baseSalary)) })}</p>}
                    </Field>
                  </div>
                  {selectedGrade && Number(form.baseSalary) > 0 && (
                    <SalaryMeter grade={selectedGrade} salary={Number(form.baseSalary)} />
                  )}

                  <SectionLabel icon={Wallet} title={t("Rekening Bank", "Bank Account")} className="pt-1" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label={t("Bank")}>
                      <Select value={form.bankName || "none"} onValueChange={(v) => set("bankName", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder={t("Pilih bank", "Select bank")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                          {["BCA", "Mandiri", "BNI", "BRI"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("No. Rekening", "Account No.")}>
                      <Input value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} placeholder="1234567890" inputMode="numeric" className="h-9 font-mono" />
                    </Field>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  <ReviewSection icon={User} title={t("Data Personal", "Personal Details")} onEdit={() => setStep(1)} items={[
                    [t("Nama Lengkap"), form.fullName || "—"], [t("Jenis Kelamin", "Gender"), form.gender === "F" ? t("Perempuan", "Female") : t("Laki-laki", "Male")],
                    [t("Tempat/Tgl Lahir", "Place/Date of Birth"), [form.birthPlace, form.birthDate].filter(Boolean).join(", ") || "—"],
                    [t("NIK", "NIK"), form.nationalId || "—"], [t("NPWP"), form.taxId || "—"],
                    [t("Status"), form.maritalStatus ? t(form.maritalStatus, MARITAL_STATUSES_EN[form.maritalStatus] ?? form.maritalStatus) : "—"], [t("Agama", "Religion"), form.religion ? t(form.religion, RELIGIONS_EN[form.religion] ?? form.religion) : "—"], [t("Gol. Darah", "Blood Type"), form.bloodType || "—"],
                    [t("Email"), form.email || "—"], [t("Telepon"), form.phone || "—"],
                    [t("Alamat"), [form.address, form.city].filter(Boolean).join(", ") || "—"],
                  ]} />
                  <ReviewSection icon={Briefcase} title={t("Info Pekerjaan", "Job Details")} onEdit={() => setStep(2)} items={[
                    [t("Unit Organisasi"), selectedUnit?.name ?? "—"], [t("Posisi"), selectedPosition?.title ?? "—"],
                    [t("Grade"), selectedGrade ? `${selectedGrade.code} — ${selectedGrade.name}` : "—"],
                    [t("Kantor", "Office"), selectedOffice ? `${selectedOffice.code} — ${selectedOffice.name}` : "—"],
                    [t("Lokasi Kerja", "Work Location"), selectedLocation ? `${selectedLocation.code} — ${selectedLocation.name}` : "—"],
                    [t("Status Kepegawaian", "Employment Status"), t(EMPLOYMENT_STATUS_LABEL[form.employmentStatus] ?? form.employmentStatus, EMPLOYMENT_STATUS_LABEL_EN[form.employmentStatus])], [t("Tanggal Masuk", "Join Date"), form.joinDate || "—"],
                    ...(form.employmentStatus !== "Permanent" ? ([
                      [t("Kontrak PKWT", "PKWT Contract"), form.contractStart || form.contractEnd
                        ? `${form.contractStart || "?"} → ${form.contractEnd || "?"}${Number(form.renewalCount) > 0 ? ` · ${t("perpanjangan ke-{n}", "renewal no. {n}", { n: String(Number(form.renewalCount)) })}` : ""}`
                        : "—"],
                    ] as [string, string][]) : []),
                    [t("Jadwal Kerja", "Work Schedule"), t(form.workShift, WORK_SHIFTS_EN[form.workShift] ?? form.workShift)], [t("Atasan", "Manager"), selectedManager?.fullName ?? "—"],
                  ]} />
                  <ReviewSection icon={Wallet} title={t("Upah & Bank", "Salary & Bank")} onEdit={() => setStep(3)} items={[
                    [t("Gaji Pokok"), form.baseSalary ? fmtIDR(Number(form.baseSalary)) : "—"],
                    [t("Bank"), form.bankName || "—"], [t("No. Rekening", "Account No."), form.bankAccount || "—"],
                  ]} />
                </div>
              )}
            </motion.div>

            {step === 5 && created && (
              <motion.div key="success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <div className="rounded-xl ov-hero px-6 py-8 text-center sm:px-10">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.08 }} className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 ring-4 ring-white/20 backdrop-blur">
                    <CheckCircle2 className="h-7 w-7" />
                  </motion.div>
                  <h2 className="text-lg font-bold tracking-tight">{t("Onboarding selesai", "Onboarding complete")}</h2>
                  <p className="mt-1 text-sm text-white/85">{t("Karyawan baru telah tersimpan di master data", "The new employee has been saved to master data")}</p>
                  <div className="mx-auto mt-5 flex max-w-md flex-wrap items-center justify-center gap-3 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/20 backdrop-blur">
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-xs font-extrabold", "bg-white/20 text-white")}>{initials(created.fullName)}</span>
                    <span className="text-left">
                      <p className="text-sm font-bold leading-tight">{created.fullName}</p>
                      <p className="font-mono text-[11px] text-white/80">{created.employeeNo}</p>
                    </span>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                  <Button onClick={() => navigate("employee", "detail", { id: created.id })} className="h-9 gap-2 font-bold">
                    <User className="h-4 w-4" /> {t("Lihat Profil Karyawan", "View Employee Profile")}
                  </Button>
                  {perms.can("hr", "wizard", "create") && (
                    <Button variant="outline" onClick={reset} className="h-9 gap-2 font-semibold">
                      <UserPlus className="h-4 w-4" /> {t("Onboarding Karyawan Lagi", "Onboard Another Employee")}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => navigate("employee", "directory")} className="h-9 gap-2 font-semibold text-slate-500">
                    <Users2 className="h-4 w-4" /> {t("Ke Direktori", "To Directory")}
                  </Button>
                </div>
              </motion.div>
            )}
          </div>

          {/* aksi footer — sticky bottom agar selalu terjangkau saat form panjang */}
          {step < 5 && (
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50/95 px-4 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 sm:px-6">
              {step > 1 ? (
                <Button variant="ghost" onClick={back} className="h-9 gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300">
                  <ChevronLeft className="h-4 w-4" /> {t("Sebelumnya")}
                </Button>
              ) : (
                <p className="hidden text-[11px] font-medium text-slate-400 sm:block">{t("Data tersimpan otomatis sebagai draft", "Data is saved automatically as a draft")}</p>
              )}
              <div className="flex items-center gap-3">
                <p className="hidden text-[11px] font-medium text-slate-400 md:block">{t("Langkah {n} dari 4", "Step {n} of 4", { n: step })}</p>
                {step < 4 ? (
                  <Button onClick={next} className="h-9 gap-1.5 px-5 text-sm font-bold">
                    {t("Lanjut")} <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : perms.can("hr", "wizard", "create") ? (
                  <Button onClick={submit} disabled={busy} className="h-9 gap-2 px-5 text-sm font-bold">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Menyimpan…")}</> : <><CheckCircle2 className="h-4 w-4" /> {t("Simpan Karyawan", "Save Employee")}</>}
                  </Button>
                ) : (
                  <p className="flex max-w-xs items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t("Anda tidak memiliki hak menambah karyawan (aksi Baru dinonaktifkan untuk menu Onboarding).", "You don't have permission to add employees (the New action is disabled for the Onboarding menu).")}
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* ============ RAIL RINGKASAN (desktop) ============ */}
        <aside className="hidden space-y-4 lg:block">
          <div className="sticky top-20 space-y-4">
            <Card className="rounded-2xl border-slate-200/90 shadow-sm dark:border-slate-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <ProgressRing pct={pct} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{form.fullName || t("Karyawan Baru", "New Employee")}</p>
                    <p className="text-[11px] text-slate-400">{form.positionId ? selectedPosition?.title : t("Data diri belum lengkap", "Personal details incomplete")}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3.5 dark:border-slate-800">
                  <RailRow label={t("Unit", "Unit")} value={form.orgUnitId ? selectedUnit?.name : ""} />
                  <RailRow label={t("Posisi")} value={form.positionId ? selectedPosition?.title : ""} />
                  <RailRow label={t("Grade")} value={form.gradeId ? selectedGrade?.code : ""} />
                  <RailRow label={t("Status")} value={form.orgUnitId ? form.employmentStatus : ""} />
                  <RailRow label={t("Gaji Pokok")} value={form.baseSalary ? fmtIDR(Number(form.baseSalary)) : ""} />
                  <RailRow label={t("Atasan", "Manager")} value={form.managerId ? selectedManager?.fullName : ""} />
                </dl>
              </CardContent>
            </Card>

            {draftAt && step < 5 && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 px-3.5 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="h-3.5 w-3.5 ov-text-accent" />
                  {t("Draft tersimpan", "Draft saved")} · {draftAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button onClick={reset} className="flex items-center gap-1 font-semibold text-slate-400 transition-colors hover:text-rose-600" title={t("Buang draft", "Discard draft")}>
                  <Trash2 className="h-3 w-3" /> {t("Buang", "Discard")}
                </button>
              </div>
            )}

            {TIPS[step] && (
              <div className="rounded-xl border ov-border-accent ov-soft p-3.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold ov-text-accent">
                  <Lightbulb className="h-3.5 w-3.5" /> {t("Tips langkah {n}", "Tips for step {n}", { n: step })}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{t(TIPS[step].text, TIPS_EN[step])}</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------- sub-komponen ----------

function SectionLabel({ icon: Icon, title, className }: { icon: React.ElementType; title: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Icon className="h-3.5 w-3.5 ov-text-accent" />
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
    </div>
  );
}

function Field({ label, children, required, error, hint, className }: { label: string; children: React.ReactNode; required?: boolean; error?: string; hint?: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className={cn("text-xs font-semibold", error ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-400")}>
          {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
        </Label>
        {hint && !error && <span className="text-[10px] font-medium text-slate-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

function RailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11px] font-medium text-slate-400">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-semibold">
        {value ? (
          <motion.span key={value} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="inline-block text-slate-800 dark:text-slate-200">{value}</motion.span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </dd>
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 20, c = 2 * Math.PI * r;
  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-slate-200 dark:stroke-slate-800" />
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className="ov-text-accent stroke-current transition-all duration-500"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
      </svg>
      <span className="absolute text-[10px] font-extrabold text-slate-700 dark:text-slate-300">{pct}%</span>
    </div>
  );
}

function SalaryMeter({ grade, salary }: { grade: { code: string; name: string; minSalary: number; maxSalary: number }; salary: number }) {
  const { t } = useI18n();
  const pct = Math.max(0, Math.min(100, ((salary - grade.minSalary) / Math.max(1, grade.maxSalary - grade.minSalary)) * 100));
  const below = salary < grade.minSalary;
  const above = salary > grade.maxSalary;
  return (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{t("Rentang Grade {code} — {name}", "Grade {code} Range — {name}", { code: grade.code, name: grade.name })}</p>
        {(below || above) && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> {above ? t("di atas maksimum", "above maximum") : t("di bawah minimum", "below minimum")}</p>
        )}
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-gradient-to-r from-slate-200 to-slate-200 dark:from-slate-700 dark:to-slate-700">
        <div className="absolute inset-y-0 left-0 rounded-full ov-chart" style={{ width: `${pct}%` }} />
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ov-fill shadow-sm dark:border-slate-900" style={{ left: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-slate-400">
        <span>{t("min {v}", "min {v}", { v: fmtIDR(grade.minSalary) })}</span>
        <span>{t("max {v}", "max {v}", { v: fmtIDR(grade.maxSalary) })}</span>
      </div>
    </div>
  );
}

function ReviewSection({ icon: Icon, title, items, onEdit }: { icon: React.ElementType; title: string; items: [string, string][]; onEdit: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"><Icon className="h-3.5 w-3.5 ov-text-accent" /> {title}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {items.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Button variant="outline" size="sm" onClick={onEdit} className="h-7 shrink-0 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
        <Pencil className="h-3 w-3" /> {t("Ubah")}
      </Button>
    </div>
  );
}

// ================= DISCIPLINARY PAGE =================
interface DiscRecord {
  id: string; warningLevel: string; violation: string; sanction: string | null;
  issuedAt: string; expiresAt: string | null; notes: string | null;
  employee: { id: string; fullName: string; employeeNo: string; position: { title: string } | null; orgUnit: { name: string } | null };
}

export function DisciplinaryPage() {
  const { t, locale } = useI18n();
  const { data, loading, refresh } = useApi<{ disciplinary: DiscRecord[] }>("/api/rekankerja/disciplinary");
  const [addOpen, setAddOpen] = useState(false);
  const { navigate } = useNav();
  // Task 3-LETTERS: baris terpilih utk surat + konfirmasi hapus catatan
  const [letterRecord, setLetterRecord] = useState<DiscRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DiscRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiSend(`/api/rekankerja/disciplinary?id=${deleteTarget.id}`, "DELETE");
      toast.success(t("Catatan disiplin dihapus", "Disciplinary record deleted"));
      setDeleteTarget(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setDeleting(false); }
  };

  const stats = {
    verbal: data?.disciplinary.filter((d) => d.warningLevel === "Verbal").length ?? 0,
    written: data?.disciplinary.filter((d) => d.warningLevel === "Written").length ?? 0,
    final: data?.disciplinary.filter((d) => d.warningLevel === "Final").length ?? 0,
  };

  const levelTone: Record<string, { badge: string; icon: React.ElementType }> = {
    Verbal: { badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", icon: FileWarning },
    Written: { badge: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25", icon: AlertTriangle },
    Final: { badge: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", icon: Ban },
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Karyawan")}
        title={t("Catatan Disiplin")}
        description={t(
          "Catatan pelanggaran disiplin seluruh karyawan — peringatan verbal, tertulis, dan final",
          "Disciplinary violation records for all employees — verbal, written, and final warnings",
        )}
        actions={
          <Button onClick={() => setAddOpen(true)} className="gap-2 font-bold">
            <Scale className="h-4 w-4" /> {t("Catat Pelanggaran", "Record Violation")}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {([["Verbal", stats.verbal, FileWarning], ["Tertulis", stats.written, AlertTriangle], ["Final", stats.final, Ban]] as const).map(([label, val, Icon]) => (
          <Card key={label} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", levelTone[label === "Verbal" ? "Verbal" : label === "Tertulis" ? "Written" : "Final"].badge.replace("text-", "text-").replace(/border-\S+/, ""))}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t(`Peringatan ${label}`, label === "Tertulis" ? "Written Warning" : label === "Final" ? "Final Warning" : "Verbal Warning")}</p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-slate-50">{val}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : data && data.disciplinary.length > 0 ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-900/50">
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Karyawan")}</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Level")}</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Pelanggaran", "Violation")}</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Sanksi", "Sanction")}</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Diterbitkan", "Issued")}</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Kedaluwarsa", "Expiry")}</th>
                    <th className="w-24 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Aksi", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.disciplinary.map((d) => {
                    const tone = levelTone[d.warningLevel] ?? levelTone.Verbal;
                    return (
                      <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60">
                        <td className="px-4 py-3">
                          <button onClick={() => navigate("employee", "detail", { id: d.employee.id })} className="flex items-center gap-2.5 text-left">
                            <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold", "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400")}>
                              <Users2 className="h-3.5 w-3.5" />
                            </span>
                            <span>
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{d.employee.fullName}</p>
                              <p className="text-[10px] text-slate-400">{d.employee.position?.title ?? "—"}</p>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold", tone.badge)}>
                            <tone.icon className="h-3 w-3" /> {d.warningLevel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">{d.violation}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{d.sanction ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(d.issuedAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{d.expiresAt ? new Date(d.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => setLetterRecord(d)} title={t("Terbitkan & pratinjau surat", "Issue & preview the letter")} className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-bold">
                              <FileText className="h-3 w-3" /> {t("Surat", "Letter")}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(d)} title={t("Hapus catatan disiplin", "Delete disciplinary record")} className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title={t("Tidak ada catatan disiplin", "No disciplinary records")} description={t("Belum ada pelanggaran tercatat. Kerja bagus! 👏", "No violations recorded yet. Great job! 👏")} icon={<Scale className="h-6 w-6" />} />
      )}
      <AddDisciplinaryDialog open={addOpen} setOpen={(v) => { setAddOpen(v); if (!v) refresh(); }} />

      {/* dialog surat — mount-on-open; terbitkan (idempoten) + pratinjau + unduh PDF */}
      {letterRecord && (
        <LetterPreviewDialog
          category="Disciplinary"
          disciplinaryRecordId={letterRecord.id}
          employeeName={letterRecord.employee.fullName}
          onClose={() => setLetterRecord(null)}
        />
      )}

      {/* konfirmasi hapus catatan disiplin */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/15">
                <Trash2 className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </span>
              {t("Hapus Catatan Disiplin?", "Delete Disciplinary Record?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Catatan pelanggaran {name} akan dihapus permanen — surat yang sudah terbit tetap tersimpan di arsip.", "{name}'s violation record will be permanently deleted — issued letters remain in the archive.", { name: deleteTarget?.employee.fullName ?? "—" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="h-11">{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
              className="h-11 gap-2 bg-rose-600 font-bold hover:bg-rose-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// tanggal ISO "YYYY-MM-DD" — default dialog disiplin (hari ini / +6 bulan)
const isoToday = (): string => new Date().toISOString().slice(0, 10);
const isoPlusMonths = (months: number): string => {
  const d = new Date();
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // clamp overflow (mis. 31 Mar + 6 bln → 30 Sep)
  return d.toISOString().slice(0, 10);
};

function AddDisciplinaryDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useI18n();
  const opts = useApi<WizardOptions>("/api/rekankerja/employee-options");
  const [employeeId, setEmployeeId] = useState("");
  const [warningLevel, setWarningLevel] = useState("Verbal");
  const [violation, setViolation] = useState("");
  const [sanction, setSanction] = useState("");
  // Task 3-LETTERS: tanggal kejadian + masa berlaku + catatan (utk template surat)
  const [issuedAt, setIssuedAt] = useState(isoToday());
  const [expiresAt, setExpiresAt] = useState(isoPlusMonths(6));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEmployeeId(""); setViolation(""); setSanction(""); setNotes("");
    setIssuedAt(isoToday()); setExpiresAt(isoPlusMonths(6));
  };

  const submit = async () => {
    if (!employeeId || !violation.trim()) { toast.error(t("Karyawan & pelanggaran wajib diisi", "Employee & violation are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/disciplinary", "POST", {
        employeeId, warningLevel, violation, sanction: sanction || null,
        issuedAt: issuedAt || undefined, // kosong → default server (hari ini)
        expiresAt: expiresAt || null,   // kosong → tanpa masa berlaku
        notes: notes || null,
      });
      toast.success(t("Catatan pelanggaran disimpan", "Violation record saved"));
      setOpen(false); reset();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 ov-text-accent" /> {t("Catat Pelanggaran", "Record Violation")}</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          <div>
            <Label className="text-xs">{t("Karyawan")} *</Label>
            <Select value={employeeId || "none"} onValueChange={(v) => setEmployeeId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Pilih —", "— Select —")}</SelectItem>
                {(opts.data?.managers ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.employeeNo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Level Peringatan", "Warning Level")} *</Label>
            <Select value={warningLevel} onValueChange={setWarningLevel}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Verbal">{t("Verbal")}</SelectItem>
                <SelectItem value="Written">{t("Tertulis", "Written")}</SelectItem>
                <SelectItem value="Final">{t("Final")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Tanggal Kejadian", "Incident Date")} *</Label>
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("Masa Berlaku s.d.", "Valid Until")}</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-1.5" />
              <p className="mt-1 text-[10px] text-slate-400">{t("Surat peringatan umumnya berlaku 6 bulan", "Warning letters are typically valid for 6 months")}</p>
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("Pelanggaran", "Violation")} *</Label>
            <Input value={violation} onChange={(e) => setViolation(e.target.value)} placeholder={t("cth: Keterlambatan berulang", "e.g. Repeated tardiness")} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Sanksi", "Sanction")}</Label>
            <Textarea value={sanction} onChange={(e) => setSanction(e.target.value)} placeholder={t("cth: Surat peringatan I", "e.g. First warning letter")} className="mt-1.5 min-h-16" />
          </div>
          <div>
            <Label className="text-xs">{t("Catatan", "Notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("cth: Pembinaan oleh atasan langsung", "e.g. Coaching by direct supervisor")} className="mt-1.5 min-h-16" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
