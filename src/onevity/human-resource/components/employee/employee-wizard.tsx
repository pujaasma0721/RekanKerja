"use client";
// OneVity — Onboarding Wizard (redesign v2: layout dokumen + rail ringkasan live, stepper kompak, draft autosave)
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, fmtIDR, initials } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
  Loader2, ArrowRight, Building2, Trash2, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

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

const DRAFT_KEY = "onevity:onboarding-draft";

const EMPTY_FORM: Record<string, string> = {
  fullName: "", gender: "M", birthPlace: "", birthDate: "", nationalId: "", taxId: "",
  maritalStatus: "", religion: "", bloodType: "", email: "", phone: "", address: "", city: "",
  orgUnitId: "", positionId: "", gradeId: "", employmentStatus: "Probation", joinDate: "", managerId: "", workShift: "Regular",
  companyOfficeId: "", workLocationId: "",
  baseSalary: "", bankName: "", bankAccount: "",
};

const TIPS: Record<number, { icon: React.ElementType; text: string }> = {
  1: { icon: IdCard, text: "Data identitas dipakai untuk kontrak kerja & pelaporan pajak. NIK harus 16 digit sesuai KTP — sisanya boleh dilewati dulu dan dilengkapi nanti." },
  2: { icon: Building2, text: "Karyawan baru otomatis berstatus Probation kecuali diubah. Atasan langsung menentukan jalur approval cuti & pengajuan PA-nya nanti." },
  3: { icon: Wallet, text: "Gaji pokok di luar tunjangan. Komponen tunjangan (transport, makan, lembur) bisa diatur setelah karyawan aktif di modul Payroll." },
  4: { icon: ClipboardCheck, text: "Periksa kembali sebelum menyimpan — nomor karyawan akan dibuat otomatis dan tidak bisa diubah setelah tersimpan." },
};

const TRACKED_FIELDS = [
  "fullName", "birthDate", "nationalId", "taxId", "email", "phone", "address", "city",
  "orgUnitId", "positionId", "gradeId", "joinDate", "managerId", "companyOfficeId", "workLocationId",
  "baseSalary", "bankName", "bankAccount",
];

export function OnboardingWizard() {
  const { navigate } = useNav();
  const perms = useMenuPerms();
  const opts = useApi<WizardOptions>("/api/onevity/employee-options");
  // referensi kantor & lokasi kerja (Task 25) — penempatan dimensi approval berjenjang
  const officesApi = useApi<{ offices: CompanyOfficeOption[] }>("/api/onevity/company-offices");
  const locationsApi = useApi<{ locations: WorkLocationOption[] }>("/api/onevity/work-locations");
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
      if (!form.fullName.trim()) errs.fullName = "Nama lengkap wajib diisi";
      if (form.nationalId && !/^\d{16}$/.test(form.nationalId)) errs.nationalId = "NIK harus 16 digit angka";
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Format email tidak valid";
    }
    if (s === 2) {
      if (!form.orgUnitId) errs.orgUnitId = "Pilih unit organisasi";
      if (!form.positionId) errs.positionId = "Pilih posisi";
      if (!form.joinDate) errs.joinDate = "Tanggal masuk wajib diisi";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep(step)) { setStep((s) => Math.min(s + 1, 4)); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else toast.error("Lengkapi field yang ditandai merah");
  };
  const back = () => { setStep((s) => Math.max(s - 1, 1)); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ employee: { id: string; employeeNo: string; fullName: string } }>("/api/onevity/employees", "POST", {
        ...form,
        baseSalary: Number(form.baseSalary) || 0,
        birthDate: form.birthDate || null,
        joinDate: form.joinDate || undefined,
        managerId: form.managerId || null,
        gradeId: form.gradeId || null,
        companyOfficeId: form.companyOfficeId || null,
        workLocationId: form.workLocationId || null,
      });
      setCreated(res.employee);
      setStep(5);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
      setDraftAt(null);
      toast.success(`Karyawan ${res.employee.employeeNo} berhasil di-onboard`);
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
        eyebrow="KARYAWAN"
        title="Onboarding Karyawan"
        description="Lengkapi data karyawan baru dalam 4 langkah — ringkasan di sisi kanan terisi otomatis saat Anda mengetik"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate("employee", "directory")} className="h-8 gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200">
            <ArrowRight className="h-3.5 w-3.5" /> Ke direktori
          </Button>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ============ KOLOM UTAMA ============ */}
        <Card className={cn("rounded-2xl border-stone-200/90 shadow-sm dark:border-stone-800", step === 5 && "overflow-hidden")}>
          {/* stepper kompak */}
          <div className="rounded-t-2xl border-b border-stone-200/80 bg-stone-50/60 px-4 py-3.5 dark:border-stone-800 dark:bg-stone-900/40 sm:px-6">
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
                        done ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 group-hover:bg-emerald-500" :
                        active ? "bg-white text-emerald-700 ring-2 ring-emerald-600 ring-offset-2 ring-offset-stone-50 dark:bg-stone-900 dark:ring-offset-stone-900" :
                        "bg-stone-200/80 text-stone-400 dark:bg-stone-800 dark:text-stone-500",
                      )}>
                        {done ? <Check className="h-3.5 w-3.5" /> : s.id}
                      </span>
                      <span className={cn(
                        "max-w-[88px] truncate text-[11px] font-semibold leading-tight",
                        active ? "text-stone-900 dark:text-stone-100" : done ? "text-stone-500 dark:text-stone-400 group-hover:text-stone-700" : "text-stone-400 dark:text-stone-500",
                      )}>{s.label}</span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className={cn("mx-2 mb-4 h-0.5 flex-1 rounded-full sm:mx-3", step > s.id ? "bg-emerald-500" : "bg-stone-200 dark:bg-stone-800")} />
                    )}
                  </li>
                );
              })}
            </ol>
            {/* mobile: mini progress */}
            <div className="sm:hidden">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold text-stone-800 dark:text-stone-200">Langkah {Math.min(step, 4)} dari 4 · <span className="font-semibold text-emerald-700 dark:text-emerald-400">{stepMeta?.label}</span></p>
                <p className="text-[10px] font-semibold text-stone-400">{pct}% terisi</p>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div className="h-full rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {/* konten langkah */}
          <div className="px-4 py-5 sm:px-6 sm:py-6">
            {step <= 4 && !opts.data && (
              <div className="space-y-3">
                <div className="h-5 w-40 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
                <div className="grid gap-4 sm:grid-cols-2">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />)}
                </div>
              </div>
            )}

            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
              {opts.data && step === 1 && (
                <div className="space-y-6">
                  <SectionLabel icon={IdCard} title="Identitas" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label="Nama Lengkap" required error={errors.fullName}>
                      <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Andi Pratama" className={cn("h-9", errors.fullName && "border-rose-400 focus-visible:ring-rose-400")} />
                    </Field>
                    <Field label="Jenis Kelamin">
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-stone-200 bg-stone-50 p-1 dark:border-stone-800 dark:bg-stone-900">
                        {([["M", "Laki-laki"], ["F", "Perempuan"]] as const).map(([v, l]) => (
                          <button key={v} type="button" onClick={() => set("gender", v)}
                            className={cn("flex h-7 items-center justify-center rounded-md text-xs font-semibold transition-all",
                              form.gender === v ? "bg-stone-900 text-white shadow-sm dark:bg-stone-100 dark:text-stone-900" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200")}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Tempat Lahir">
                      <Input value={form.birthPlace} onChange={(e) => set("birthPlace", e.target.value)} placeholder="Bandung" className="h-9" />
                    </Field>
                    <Field label="Tanggal Lahir">
                      <Input type="date" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} className="h-9" />
                    </Field>
                    <Field label="NIK (KTP)" error={errors.nationalId} hint="16 digit">
                      <Input value={form.nationalId} onChange={(e) => set("nationalId", e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="327xxxxxxxxxxxxx" inputMode="numeric" className={cn("h-9 font-mono", errors.nationalId && "border-rose-400 focus-visible:ring-rose-400")} />
                    </Field>
                    <Field label="NPWP" error={errors.taxId} hint="opsional">
                      <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} className="h-9 font-mono" />
                    </Field>
                    <Field label="Status Pernikahan">
                      <Select value={form.maritalStatus || "none"} onValueChange={(v) => set("maritalStatus", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {lk("MaritalStatus").map((m) => <SelectItem key={m.code} value={m.label}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Agama">
                      <Select value={form.religion || "none"} onValueChange={(v) => set("religion", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {lk("Religion").map((r) => <SelectItem key={r.code} value={r.label}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Golongan Darah">
                      <Select value={form.bloodType || "none"} onValueChange={(v) => set("bloodType", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {lk("BloodType").map((b) => <SelectItem key={b.code} value={b.label}>{b.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <SectionLabel icon={Mail} title="Kontak & Alamat" className="pt-1" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label="Email" error={errors.email}>
                      <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="nama@mii.co.id" className={cn("h-9", errors.email && "border-rose-400 focus-visible:ring-rose-400")} />
                    </Field>
                    <Field label="Telepon">
                      <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0812 3456 7890" inputMode="tel" className="h-9" />
                    </Field>
                    <Field label="Alamat" className="sm:col-span-2">
                      <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Jl. Rungkut Industri No. 10, Surabaya" className="h-9" />
                    </Field>
                    <Field label="Kota">
                      <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Surabaya" className="h-9" />
                    </Field>
                  </div>
                </div>
              )}

              {opts.data && step === 2 && (
                <div className="space-y-6">
                  <SectionLabel icon={Building2} title="Penempatan" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label="Unit Organisasi" required error={errors.orgUnitId}>
                      <Select value={form.orgUnitId || "none"} onValueChange={(v) => { set("orgUnitId", v === "none" ? "" : v); set("positionId", ""); }}>
                        <SelectTrigger className={cn("h-9", errors.orgUnitId && "border-rose-400")}><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {(opts.data?.orgUnits ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Posisi" required error={errors.positionId} hint={form.orgUnitId ? `${filteredPositions.length} posisi tersedia` : "pilih unit dulu"}>
                      <Select value={form.positionId || "none"} onValueChange={(v) => set("positionId", v === "none" ? "" : v)}>
                        <SelectTrigger className={cn("h-9", errors.positionId && "border-rose-400")}><SelectValue placeholder={form.orgUnitId ? "Posisi di unit ini" : "Pilih posisi"} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {filteredPositions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {selectedPosition?.positionLevel && (
                        <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">Level Jabatan: {selectedPosition.positionLevel.code} — {selectedPosition.positionLevel.name}</p>
                      )}
                    </Field>
                    <Field label="Grade" hint={selectedGrade ? `rentang ${fmtIDR(selectedGrade.minSalary)} – ${fmtIDR(selectedGrade.maxSalary)}` : "menentukan rentang gaji"}>
                      <Select value={form.gradeId || "none"} onValueChange={(v) => set("gradeId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih grade" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {(opts.data?.grades ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Atasan Langsung" hint="jalur approval">
                      <Select value={form.managerId || "none"} onValueChange={(v) => set("managerId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih atasan" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Tanpa atasan —</SelectItem>
                          {(opts.data?.managers ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.position?.title ?? "—"}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Kantor (Company Office)" hint="opsional — dimensi approval">
                      <Select value={form.companyOfficeId || "none"} onValueChange={(v) => set("companyOfficeId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih kantor" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Tanpa kantor —</SelectItem>
                          {(officesApi.data?.offices ?? []).map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.code} — {o.name}{o.city ? ` (${o.city})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Lokasi Kerja (Work Location)" hint={selectedOffice ? `opsional · ${locationsApi.data?.locations.length ?? 0} lokasi` : "opsional"}>
                      <Select value={form.workLocationId || "none"} onValueChange={(v) => set("workLocationId", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih lokasi kerja" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Tanpa lokasi —</SelectItem>
                          {(locationsApi.data?.locations ?? []).map((l) => (
                            <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}{l.city ? ` (${l.city})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <SectionLabel icon={Briefcase} title="Kepegawaian" className="pt-1" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
                    <Field label="Status Kepegawaian">
                      <Select value={form.employmentStatus} onValueChange={(v) => set("employmentStatus", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {lk("EmploymentStatus").map((s) => <SelectItem key={s.code} value={s.label}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Tanggal Masuk" required error={errors.joinDate}>
                      <Input type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} className={cn("h-9", errors.joinDate && "border-rose-400")} />
                    </Field>
                    <Field label="Jadwal Kerja">
                      <Select value={form.workShift} onValueChange={(v) => set("workShift", v)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {lk("WorkShift").map((s) => <SelectItem key={s.code} value={s.label}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
              )}

              {opts.data && step === 3 && (
                <div className="space-y-6">
                  <SectionLabel icon={Wallet} title="Gaji Pokok" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label="Gaji Pokok" hint="di luar tunjangan">
                      <Input type="number" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} placeholder="5500000" inputMode="numeric" className="h-9 font-mono" />
                      {form.baseSalary && <p className="mt-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{fmtIDR(Number(form.baseSalary))} / bulan</p>}
                    </Field>
                  </div>
                  {selectedGrade && Number(form.baseSalary) > 0 && (
                    <SalaryMeter grade={selectedGrade} salary={Number(form.baseSalary)} />
                  )}

                  <SectionLabel icon={Wallet} title="Rekening Bank" className="pt-1" />
                  <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                    <Field label="Bank">
                      <Select value={form.bankName || "none"} onValueChange={(v) => set("bankName", v === "none" ? "" : v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Pilih bank" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Pilih —</SelectItem>
                          {["BCA", "Mandiri", "BNI", "BRI"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="No. Rekening">
                      <Input value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} placeholder="1234567890" inputMode="numeric" className="h-9 font-mono" />
                    </Field>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  <ReviewSection icon={User} title="Data Personal" onEdit={() => setStep(1)} items={[
                    ["Nama Lengkap", form.fullName || "—"], ["Jenis Kelamin", form.gender === "F" ? "Perempuan" : "Laki-laki"],
                    ["Tempat/Tgl Lahir", [form.birthPlace, form.birthDate].filter(Boolean).join(", ") || "—"],
                    ["NIK", form.nationalId || "—"], ["NPWP", form.taxId || "—"],
                    ["Status", form.maritalStatus || "—"], ["Agama", form.religion || "—"], ["Gol. Darah", form.bloodType || "—"],
                    ["Email", form.email || "—"], ["Telepon", form.phone || "—"],
                    ["Alamat", [form.address, form.city].filter(Boolean).join(", ") || "—"],
                  ]} />
                  <ReviewSection icon={Briefcase} title="Info Pekerjaan" onEdit={() => setStep(2)} items={[
                    ["Unit Organisasi", selectedUnit?.name ?? "—"], ["Posisi", selectedPosition?.title ?? "—"],
                    ["Grade", selectedGrade ? `${selectedGrade.code} — ${selectedGrade.name}` : "—"],
                    ["Kantor", selectedOffice ? `${selectedOffice.code} — ${selectedOffice.name}` : "—"],
                    ["Lokasi Kerja", selectedLocation ? `${selectedLocation.code} — ${selectedLocation.name}` : "—"],
                    ["Status Kepegawaian", form.employmentStatus], ["Tanggal Masuk", form.joinDate || "—"],
                    ["Jadwal Kerja", form.workShift], ["Atasan", selectedManager?.fullName ?? "—"],
                  ]} />
                  <ReviewSection icon={Wallet} title="Upah & Bank" onEdit={() => setStep(3)} items={[
                    ["Gaji Pokok", form.baseSalary ? fmtIDR(Number(form.baseSalary)) : "—"],
                    ["Bank", form.bankName || "—"], ["No. Rekening", form.bankAccount || "—"],
                  ]} />
                </div>
              )}
            </motion.div>

            {step === 5 && created && (
              <motion.div key="success" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <div className="rounded-xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-6 py-8 text-center text-white sm:px-10">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.08 }} className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 ring-4 ring-white/20 backdrop-blur">
                    <CheckCircle2 className="h-7 w-7" />
                  </motion.div>
                  <h2 className="text-lg font-bold tracking-tight">Onboarding selesai</h2>
                  <p className="mt-1 text-sm text-emerald-100/85">Karyawan baru telah tersimpan di master data</p>
                  <div className="mx-auto mt-5 flex max-w-md flex-wrap items-center justify-center gap-3 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/20 backdrop-blur">
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-xs font-extrabold", "bg-white/20 text-white")}>{initials(created.fullName)}</span>
                    <span className="text-left">
                      <p className="text-sm font-bold leading-tight">{created.fullName}</p>
                      <p className="font-mono text-[11px] text-emerald-100/80">{created.employeeNo}</p>
                    </span>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                  <Button onClick={() => navigate("employee", "detail", { id: created.id })} className="h-9 gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
                    <User className="h-4 w-4" /> Lihat Profil Karyawan
                  </Button>
                  {perms.can("hr", "wizard", "create") && (
                    <Button variant="outline" onClick={reset} className="h-9 gap-2 font-semibold">
                      <UserPlus className="h-4 w-4" /> Onboarding Karyawan Lagi
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => navigate("employee", "directory")} className="h-9 gap-2 font-semibold text-stone-500">
                    <Users2 className="h-4 w-4" /> Ke Direktori
                  </Button>
                </div>
              </motion.div>
            )}
          </div>

          {/* aksi footer — sticky bottom agar selalu terjangkau saat form panjang */}
          {step < 5 && (
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-stone-200/80 bg-stone-50/95 px-4 py-3 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95 sm:px-6">
              {step > 1 ? (
                <Button variant="ghost" onClick={back} className="h-9 gap-1.5 text-sm font-semibold text-stone-600 hover:text-stone-900 dark:text-stone-300">
                  <ChevronLeft className="h-4 w-4" /> Sebelumnya
                </Button>
              ) : (
                <p className="hidden text-[11px] font-medium text-stone-400 sm:block">Data tersimpan otomatis sebagai draft</p>
              )}
              <div className="flex items-center gap-3">
                <p className="hidden text-[11px] font-medium text-stone-400 md:block">Langkah {step} dari 4</p>
                {step < 4 ? (
                  <Button onClick={next} className="h-9 gap-1.5 bg-emerald-600 px-5 text-sm font-bold hover:bg-emerald-700">
                    Lanjut <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : perms.can("hr", "wizard", "create") ? (
                  <Button onClick={submit} disabled={busy} className="h-9 gap-2 bg-emerald-600 px-5 text-sm font-bold hover:bg-emerald-700">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…</> : <><CheckCircle2 className="h-4 w-4" /> Simpan Karyawan</>}
                  </Button>
                ) : (
                  <p className="flex max-w-xs items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Anda tidak memiliki hak menambah karyawan (aksi Baru dinonaktifkan untuk menu Onboarding).
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* ============ RAIL RINGKASAN (desktop) ============ */}
        <aside className="hidden space-y-4 lg:block">
          <div className="sticky top-20 space-y-4">
            <Card className="rounded-2xl border-stone-200/90 shadow-sm dark:border-stone-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <ProgressRing pct={pct} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">{form.fullName || "Karyawan Baru"}</p>
                    <p className="text-[11px] text-stone-400">{form.positionId ? selectedPosition?.title : "Data diri belum lengkap"}</p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 border-t border-stone-100 pt-3.5 dark:border-stone-800">
                  <RailRow label="Unit" value={form.orgUnitId ? selectedUnit?.name : ""} />
                  <RailRow label="Posisi" value={form.positionId ? selectedPosition?.title : ""} />
                  <RailRow label="Grade" value={form.gradeId ? selectedGrade?.code : ""} />
                  <RailRow label="Status" value={form.orgUnitId ? form.employmentStatus : ""} />
                  <RailRow label="Gaji Pokok" value={form.baseSalary ? fmtIDR(Number(form.baseSalary)) : ""} />
                  <RailRow label="Atasan" value={form.managerId ? selectedManager?.fullName : ""} />
                </dl>
              </CardContent>
            </Card>

            {draftAt && step < 5 && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-stone-200/90 bg-stone-50/70 px-3.5 py-2.5 text-[11px] text-stone-500 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-400">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                  Draft tersimpan · {draftAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button onClick={reset} className="flex items-center gap-1 font-semibold text-stone-400 transition-colors hover:text-rose-600" title="Buang draft">
                  <Trash2 className="h-3 w-3" /> Buang
                </button>
              </div>
            )}

            {TIPS[step] && (
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3.5 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-400">
                  <Lightbulb className="h-3.5 w-3.5" /> Tips langkah {step}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-emerald-900/75 dark:text-emerald-100/60">{TIPS[step].text}</p>
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
      <Icon className="h-3.5 w-3.5 text-emerald-600" />
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</h3>
      <div className="h-px flex-1 bg-stone-100 dark:bg-stone-800" />
    </div>
  );
}

function Field({ label, children, required, error, hint, className }: { label: string; children: React.ReactNode; required?: boolean; error?: string; hint?: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className={cn("text-xs font-semibold", error ? "text-rose-600 dark:text-rose-400" : "text-stone-600 dark:text-stone-400")}>
          {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
        </Label>
        {hint && !error && <span className="text-[10px] font-medium text-stone-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

function RailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11px] font-medium text-stone-400">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-semibold">
        {value ? (
          <motion.span key={value} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="inline-block text-stone-800 dark:text-stone-200">{value}</motion.span>
        ) : (
          <span className="text-stone-300 dark:text-stone-600">—</span>
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
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-stone-200 dark:stroke-stone-800" />
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-emerald-600 transition-all duration-500"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
      </svg>
      <span className="absolute text-[10px] font-extrabold text-stone-700 dark:text-stone-300">{pct}%</span>
    </div>
  );
}

function SalaryMeter({ grade, salary }: { grade: { code: string; name: string; minSalary: number; maxSalary: number }; salary: number }) {
  const pct = Math.max(0, Math.min(100, ((salary - grade.minSalary) / Math.max(1, grade.maxSalary - grade.minSalary)) * 100));
  const below = salary < grade.minSalary;
  const above = salary > grade.maxSalary;
  return (
    <div className="rounded-xl border border-stone-200/90 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold text-stone-600 dark:text-stone-400">Rentang Grade {grade.code} — {grade.name}</p>
        {(below || above) && (
          <p className="flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> {above ? "di atas maksimum" : "di bawah minimum"}</p>
        )}
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-gradient-to-r from-stone-200 to-stone-200 dark:from-stone-700 dark:to-stone-700">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${pct}%` }} />
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-600 shadow-sm dark:border-stone-900" style={{ left: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-stone-400">
        <span>min {fmtIDR(grade.minSalary)}</span>
        <span>max {fmtIDR(grade.maxSalary)}</span>
      </div>
    </div>
  );
}

function ReviewSection({ icon: Icon, title, items, onEdit }: { icon: React.ElementType; title: string; items: [string, string][]; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-bold text-stone-800 dark:text-stone-200"><Icon className="h-3.5 w-3.5 text-emerald-600" /> {title}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {items.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{k}</dt>
              <dd className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-200">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Button variant="outline" size="sm" onClick={onEdit} className="h-7 shrink-0 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
        <Pencil className="h-3 w-3" /> Ubah
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
  const { data, loading, refresh } = useApi<{ disciplinary: DiscRecord[] }>("/api/onevity/disciplinary");
  const [addOpen, setAddOpen] = useState(false);
  const { navigate } = useNav();

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
        eyebrow="KARYAWAN"
        title="Catatan Disiplin"
        description="Catatan pelanggaran disiplin seluruh karyawan — peringatan verbal, tertulis, dan final"
        actions={
          <Button onClick={() => setAddOpen(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Scale className="h-4 w-4" /> Catat Pelanggaran
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {([["Verbal", stats.verbal, FileWarning], ["Tertulis", stats.written, AlertTriangle], ["Final", stats.final, Ban]] as const).map(([label, val, Icon]) => (
          <Card key={label} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", levelTone[label === "Verbal" ? "Verbal" : label === "Tertulis" ? "Written" : "Final"].badge.replace("text-", "text-").replace(/border-\S+/, ""))}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Peringatan {label}</p>
                <p className="text-lg font-extrabold text-stone-900 dark:text-stone-50">{val}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : data && data.disciplinary.length > 0 ? (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50/80 dark:bg-stone-900/50">
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-stone-400">Karyawan</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-stone-400">Level</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-stone-400">Pelanggaran</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-stone-400">Sanksi</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-stone-400">Diterbitkan</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-stone-400">Kedaluwarsa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.disciplinary.map((d) => {
                    const tone = levelTone[d.warningLevel] ?? levelTone.Verbal;
                    return (
                      <tr key={d.id} className="border-t border-stone-100 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900/60">
                        <td className="px-4 py-3">
                          <button onClick={() => navigate("employee", "detail", { id: d.employee.id })} className="flex items-center gap-2.5 text-left">
                            <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold", "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400")}>
                              <Users2 className="h-3.5 w-3.5" />
                            </span>
                            <span>
                              <p className="text-xs font-bold text-stone-800 dark:text-stone-200">{d.employee.fullName}</p>
                              <p className="text-[10px] text-stone-400">{d.employee.position?.title ?? "—"}</p>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold", tone.badge)}>
                            <tone.icon className="h-3 w-3" /> {d.warningLevel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">{d.violation}</td>
                        <td className="px-4 py-3 text-xs text-stone-500">{d.sanction ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-stone-500">{new Date(d.issuedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</td>
                        <td className="px-4 py-3 text-xs text-stone-500">{d.expiresAt ? new Date(d.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="Tidak ada catatan disiplin" description="Belum ada pelanggaran tercatat. Kerja bagus! 👏" icon={<Scale className="h-6 w-6" />} />
      )}
      <AddDisciplinaryDialog open={addOpen} setOpen={(v) => { setAddOpen(v); if (!v) refresh(); }} />
    </div>
  );
}

function AddDisciplinaryDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const opts = useApi<WizardOptions>("/api/onevity/employee-options");
  const [employeeId, setEmployeeId] = useState("");
  const [warningLevel, setWarningLevel] = useState("Verbal");
  const [violation, setViolation] = useState("");
  const [sanction, setSanction] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!employeeId || !violation.trim()) { toast.error("Karyawan & pelanggaran wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/disciplinary", "POST", { employeeId, warningLevel, violation, sanction: sanction || null });
      toast.success("Catatan pelanggaran disimpan");
      setOpen(false); setEmployeeId(""); setViolation(""); setSanction("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-emerald-600" /> Catat Pelanggaran</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          <div>
            <Label className="text-xs">Karyawan *</Label>
            <Select value={employeeId || "none"} onValueChange={(v) => setEmployeeId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Pilih —</SelectItem>
                {(opts.data?.managers ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.employeeNo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Level Peringatan *</Label>
            <Select value={warningLevel} onValueChange={setWarningLevel}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Verbal">Verbal</SelectItem>
                <SelectItem value="Written">Tertulis</SelectItem>
                <SelectItem value="Final">Final</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Pelanggaran *</Label>
            <Input value={violation} onChange={(e) => setViolation(e.target.value)} placeholder="cth: Keterlambatan berulang" className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Sanksi</Label>
            <Textarea value={sanction} onChange={(e) => setSanction(e.target.value)} placeholder="cth: Surat peringatan I" className="mt-1.5 min-h-16" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
