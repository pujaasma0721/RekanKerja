"use client";
// OneVity — dialog CRUD untuk detail karyawan:
// edit data personal, edit info pekerjaan, tambah keluarga/pendidikan/pengalaman,
// catat pelanggaran, dan tombol hapus dengan konfirmasi
import { useEffect, useState } from "react";
import { apiSend, useApi } from "@/onevity/shared/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import {
  RELIGIONS, RELIGIONS_EN, MARITAL_STATUSES, MARITAL_STATUSES_EN, BLOOD_TYPES, BANKS, WORK_SHIFTS, WORK_SHIFTS_EN, EDUCATION_LEVELS, RELATIONS, WARNING_LEVELS,
  type EmployeeDetail, type EmployeeOptions,
  type FamilyRow, type EducationRow, type ExperienceRow,
} from "./types";

const isoDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-stone-600 dark:text-stone-300">{label}</Label>
      {children}
    </div>
  );
}

function DialogFooterBar({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label: string }) {
  const { t } = useI18n();
  return (
    <DialogFooter className="mt-1 gap-2">
      <Button variant="outline" className="h-11 px-5" onClick={onCancel} disabled={busy}>{t("Batal")}</Button>
      <Button type="submit" className="h-11 gap-2 px-6 font-bold" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </Button>
    </DialogFooter>
  );
}

// ============ 1. EDIT DATA PERSONAL ============
export function EditPersonalDialog({
  open, onOpenChange, employee, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employee: EmployeeDetail;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    fullName: "", gender: "M", birthPlace: "", birthDate: "", nationalId: "", taxId: "",
    bpjsHealth: "", bpjsEmpSkill: "", maritalStatus: "none", religion: "none", bloodType: "none",
    email: "", phone: "", address: "", city: "", bankName: "none", bankAccount: "",
  });
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm({
      fullName: employee.fullName,
      gender: employee.gender,
      birthPlace: employee.birthPlace ?? "",
      birthDate: isoDate(employee.birthDate),
      nationalId: employee.nationalId ?? "",
      taxId: employee.taxId ?? "",
      bpjsHealth: employee.bpjsHealth ?? "",
      bpjsEmpSkill: employee.bpjsEmpSkill ?? "",
      maritalStatus: employee.maritalStatus ?? "none",
      religion: employee.religion ?? "none",
      bloodType: employee.bloodType ?? "none",
      email: employee.email ?? "",
      phone: employee.phone ?? "",
      address: employee.address ?? "",
      city: employee.city ?? "",
      bankName: employee.bankName ?? "none",
      bankAccount: employee.bankAccount ?? "",
    });
  }, [open, employee]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) { toast.error(t("Nama lengkap wajib diisi", "Full name is required")); return; }
    setBusy(true);
    try {
      await apiSend(`/api/onevity/employee-detail?id=${employee.id}`, "PATCH", {
        fullName: form.fullName.trim(),
        gender: form.gender,
        birthPlace: form.birthPlace.trim() || null,
        birthDate: form.birthDate || null,
        nationalId: form.nationalId.trim() || null,
        taxId: form.taxId.trim() || null,
        bpjsHealth: form.bpjsHealth.trim() || null,
        bpjsEmpSkill: form.bpjsEmpSkill.trim() || null,
        maritalStatus: form.maritalStatus === "none" ? null : form.maritalStatus,
        religion: form.religion === "none" ? null : form.religion,
        bloodType: form.bloodType === "none" ? null : form.bloodType,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        bankName: form.bankName === "none" ? null : form.bankName,
        bankAccount: form.bankAccount.trim() || null,
      });
      toast.success(t("Data personal tersimpan", "Personal data saved"), { description: t("Profil {name} berhasil diperbarui.", "{name}'s profile was successfully updated.", { name: form.fullName.trim() }) });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(t("Gagal menyimpan data personal", "Failed to save personal data"), { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Edit Data Personal", "Edit Personal Data")}</DialogTitle>
          <DialogDescription>{t("Perbarui identitas dan data kependudukan {name}.", "Update the identity and civil data of {name}.", { name: employee.fullName })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label={t("Nama Lengkap") + " *"} htmlFor="ep-name" className="sm:col-span-2">
            <Input id="ep-name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} placeholder={t("Nama sesuai KTP", "Name as per ID card")} required />
          </Field>
          <Field label={t("Jenis Kelamin", "Gender") + " *"}>
            <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Jenis kelamin", "Gender")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M" className="py-2.5">{t("Laki-laki", "Male")}</SelectItem>
                <SelectItem value="F" className="py-2.5">{t("Perempuan", "Female")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Tempat Lahir", "Place of Birth")} htmlFor="ep-bp">
            <Input id="ep-bp" value={form.birthPlace} onChange={(e) => setForm((f) => ({ ...f, birthPlace: e.target.value }))} placeholder="Bogor" />
          </Field>
          <Field label={t("Tanggal Lahir", "Date of Birth")} htmlFor="ep-bd">
            <Input id="ep-bd" type="date" value={form.birthDate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
          </Field>
          <Field label={t("Agama", "Religion")}>
            <Select value={form.religion} onValueChange={(v) => setForm((f) => ({ ...f, religion: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Agama", "Religion")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">{t("— Tidak diisi —", "— Not set —")}</SelectItem>
                {RELIGIONS.map((r) => <SelectItem key={r} value={r} className="py-2.5">{t(r, RELIGIONS_EN[r])}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Status Pernikahan", "Marital Status")}>
            <Select value={form.maritalStatus} onValueChange={(v) => setForm((f) => ({ ...f, maritalStatus: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Status pernikahan", "Marital status")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">{t("— Tidak diisi —", "— Not set —")}</SelectItem>
                {MARITAL_STATUSES.map((m) => <SelectItem key={m} value={m} className="py-2.5">{t(m, MARITAL_STATUSES_EN[m])}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Golongan Darah", "Blood Type")}>
            <Select value={form.bloodType} onValueChange={(v) => setForm((f) => ({ ...f, bloodType: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Golongan darah", "Blood type")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">{t("— Tidak diisi —", "— Not set —")}</SelectItem>
                {BLOOD_TYPES.map((b) => <SelectItem key={b} value={b} className="py-2.5">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Email")} htmlFor="ep-email">
            <Input id="ep-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="nama@mii.co.id" />
          </Field>
          <Field label={t("Telepon")} htmlFor="ep-phone">
            <Input id="ep-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="0812…" />
          </Field>
          <Field label={t("NIK (KTP)", "NIK (ID Card)")} htmlFor="ep-nik">
            <Input id="ep-nik" value={form.nationalId} onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))} placeholder={t("16 digit", "16 digits")} className="font-mono" />
          </Field>
          <Field label={t("NPWP")} htmlFor="ep-npwp">
            <Input id="ep-npwp" value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} placeholder={t("15 digit", "15 digits")} className="font-mono" />
          </Field>
          <Field label={t("No. BPJS Kesehatan", "BPJS Health No.")} htmlFor="ep-bpjsk">
            <Input id="ep-bpjsk" value={form.bpjsHealth} onChange={(e) => setForm((f) => ({ ...f, bpjsHealth: e.target.value }))} className="font-mono" />
          </Field>
          <Field label={t("No. BPJS Ketenagakerjaan (JHT)", "BPJS Employment No. (JHT)")} htmlFor="ep-bpjsh">
            <Input id="ep-bpjsh" value={form.bpjsEmpSkill} onChange={(e) => setForm((f) => ({ ...f, bpjsEmpSkill: e.target.value }))} className="font-mono" />
          </Field>
          <Field label={t("Alamat")} htmlFor="ep-addr" className="sm:col-span-2">
            <Textarea id="ep-addr" rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Jl. …" />
          </Field>
          <Field label={t("Kota", "City")} htmlFor="ep-city">
            <Input id="ep-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Bandung" />
          </Field>
          <Field label={t("Bank")}>
            <Select value={form.bankName} onValueChange={(v) => setForm((f) => ({ ...f, bankName: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Bank")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">{t("— Tidak diisi —", "— Not set —")}</SelectItem>
                {BANKS.map((b) => <SelectItem key={b} value={b} className="py-2.5">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("No. Rekening", "Account No.")} htmlFor="ep-rek" className="sm:col-span-2">
            <Input id="ep-rek" value={form.bankAccount} onChange={(e) => setForm((f) => ({ ...f, bankAccount: e.target.value }))} className="font-mono" />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label={t("Simpan Perubahan", "Save Changes")} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 2. EDIT INFO PEKERJAAN ============
export function EditWorkDialog({
  open, onOpenChange, employee, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employee: EmployeeDetail;
  onDone: () => void;
}) {
  const opts = useApi<EmployeeOptions>(open ? "/api/onevity/employee-options" : null, [open]);
  const { t } = useI18n();
  const [form, setForm] = useState({
    orgUnitId: "none", positionId: "none", gradeId: "none", employmentStatus: "Probation",
    workShift: "Regular", joinDate: "", endDate: "", managerId: "none", baseSalary: "", status: "Active",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      orgUnitId: employee.orgUnitId ?? "none",
      positionId: employee.positionId ?? "none",
      gradeId: employee.gradeId ?? "none",
      employmentStatus: employee.employmentStatus,
      workShift: employee.workShift,
      joinDate: isoDate(employee.joinDate),
      endDate: isoDate(employee.endDate),
      managerId: employee.managerId ?? "none",
      baseSalary: String(employee.baseSalary ?? 0),
      status: employee.status,
    });
  }, [open, employee]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.joinDate) { toast.error(t("Tanggal masuk wajib diisi", "Join date is required")); return; }
    setBusy(true);
    try {
      await apiSend(`/api/onevity/employee-detail?id=${employee.id}`, "PATCH", {
        orgUnitId: form.orgUnitId === "none" ? null : form.orgUnitId,
        positionId: form.positionId === "none" ? null : form.positionId,
        gradeId: form.gradeId === "none" ? null : form.gradeId,
        employmentStatus: form.employmentStatus,
        workShift: form.workShift,
        joinDate: form.joinDate,
        endDate: form.endDate || null,
        managerId: form.managerId === "none" ? null : form.managerId,
        baseSalary: form.baseSalary === "" ? 0 : Number(form.baseSalary),
        status: form.status,
      });
      toast.success(t("Info pekerjaan tersimpan", "Job information saved"), { description: t("Data kepegawaian {name} berhasil diperbarui.", "Employment data of {name} was successfully updated.", { name: employee.fullName }) });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(t("Gagal menyimpan info pekerjaan", "Failed to save job information"), { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Edit Info Pekerjaan", "Edit Job Information")}</DialogTitle>
          <DialogDescription>{t("Penempatan, status kerja, dan upah {name}.", "Placement, employment status, and salary of {name}.", { name: employee.fullName })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label={t("Unit Organisasi")}>
            <Select value={form.orgUnitId} onValueChange={(v) => setForm((f) => ({ ...f, orgUnitId: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Unit organisasi")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" className="py-2.5">{t("— Tanpa unit —", "— No unit —")}</SelectItem>
                {(opts.data?.orgUnits ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id} className="py-2.5">{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Posisi")}>
            <Select value={form.positionId} onValueChange={(v) => setForm((f) => ({ ...f, positionId: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Posisi")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" className="py-2.5">{t("— Tanpa posisi —", "— No position —")}</SelectItem>
                {(opts.data?.positions ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="py-2.5">{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Grade")}>
            <Select value={form.gradeId} onValueChange={(v) => setForm((f) => ({ ...f, gradeId: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Grade")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">{t("— Tanpa grade —", "— No grade —")}</SelectItem>
                {(opts.data?.grades ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id} className="py-2.5">{g.code} · {g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Atasan Langsung", "Direct Manager")}>
            <Select value={form.managerId} onValueChange={(v) => setForm((f) => ({ ...f, managerId: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Atasan langsung", "Direct manager")}><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" className="py-2.5">{t("— Tanpa atasan —", "— No manager —")}</SelectItem>
                {(opts.data?.managers ?? []).filter((m) => m.id !== employee.id).map((m) => (
                  <SelectItem key={m.id} value={m.id} className="py-2.5">{m.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Status Kerja", "Employment Status")}>
            <Select value={form.employmentStatus} onValueChange={(v) => setForm((f) => ({ ...f, employmentStatus: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Status kerja", "Employment status")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Permanent", "Probation", "Contract", "Outsourcing"].map((s) => (
                  <SelectItem key={s} value={s} className="py-2.5">{s === "Permanent" ? t("Tetap", "Permanent") : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Shift Kerja", "Work Shift")}>
            <Select value={form.workShift} onValueChange={(v) => setForm((f) => ({ ...f, workShift: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Shift kerja", "Work shift")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORK_SHIFTS.map((s) => <SelectItem key={s} value={s} className="py-2.5">{t(s, WORK_SHIFTS_EN[s])}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Tanggal Masuk", "Join Date") + " *"} htmlFor="ew-join">
            <Input id="ew-join" type="date" value={form.joinDate} onChange={(e) => setForm((f) => ({ ...f, joinDate: e.target.value }))} required />
          </Field>
          <Field label={t("Tanggal Keluar", "End Date")} htmlFor="ew-end">
            <Input id="ew-end" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <Field label={t("Gaji Pokok (Rp)", "Base Salary (Rp)")} htmlFor="ew-salary">
            <Input id="ew-salary" type="number" min={0} step={100000} value={form.baseSalary} onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))} className="font-mono" />
          </Field>
          <Field label={t("Status Kepegawaian", "Employment Status")}>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Status kepegawaian", "Employment status")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Active", "Resigned", "Terminated", "Blacklisted"].map((s) => (
                  <SelectItem key={s} value={s} className="py-2.5">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label={t("Simpan Perubahan", "Save Changes")} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 3. TAMBAH / UBAH KELUARGA ============
// Task 82-c: prop `edit` — mode ubah (dialog sama, ter-prefill data baris,
// submit PATCH; tanpa edit = mode tambah + POST seperti sebelumnya).
export function FamilyDialog({
  open, onOpenChange, employeeId, employeeName, onDone, edit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onDone: () => void;
  edit?: FamilyRow | null;
}) {
  const [form, setForm] = useState({ relation: "Spouse", name: "", gender: "M", birthDate: "", occupation: "", isDependent: true });
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm(edit
      ? {
          relation: edit.relation, name: edit.name, gender: edit.gender,
          birthDate: isoDate(edit.birthDate), occupation: edit.occupation ?? "",
          isDependent: edit.isDependent,
        }
      : { relation: "Spouse", name: "", gender: "M", birthDate: "", occupation: "", isDependent: true });
  }, [open, edit]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error(t("Nama anggota keluarga wajib diisi", "Family member name is required")); return; }
    setBusy(true);
    try {
      const payload = {
        relation: form.relation,
        name: form.name.trim(),
        gender: form.gender,
        birthDate: form.birthDate || null,
        occupation: form.occupation.trim() || null,
        isDependent: form.isDependent,
      };
      // Task 50: respons PATCH/POST membawa ptkpPending — saran PTKP 1 Jan
      // tahun depan (tanpa tulis) bila relasi/tanggungan berubah.
      const r = edit
        ? await apiSend<{ ptkpPending?: { current: string; next: string; nextYear: number } | null }>("/api/onevity/family", "PATCH", { id: edit.id, ...payload })
        : await apiSend<{ ptkpPending?: { current: string; next: string; nextYear: number } | null }>("/api/onevity/family", "POST", { employeeId, ...payload });
      if (r?.ptkpPending && r.ptkpPending.next !== r.ptkpPending.current) {
        toast.info(t(
          "PTKP akan menjadi {s} pada 1 Jan {y} (berlaku tahun depan)",
          "PTKP will become {s} on Jan 1, {y} (effective next year)",
          { s: r.ptkpPending.next, y: r.ptkpPending.nextYear },
        ));
      }
      toast.success(
        edit
          ? t("Data keluarga diperbarui", "Family data updated")
          : t("Anggota keluarga ditambahkan", "Family member added"),
        { description: t("{name} pada profil {emp}.", "{name} on {emp}'s profile.", { name: form.name.trim(), emp: employeeName }) },
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        edit
          ? t("Gagal menyimpan perubahan keluarga", "Failed to save family changes")
          : t("Gagal menambah keluarga", "Failed to add family member"),
        { description: (err as Error).message },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? t("Ubah Anggota Keluarga", "Edit Family Member") : t("Tambah Anggota Keluarga", "Add Family Member")}</DialogTitle>
          <DialogDescription>{t("Data keluarga {name} — untuk keperluan BPJS & tunjangan.", "Family data of {name} — for BPJS & allowance purposes.", { name: employeeName })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label={t("Hubungan Keluarga", "Family Relation") + " *"}>
            <Select value={form.relation} onValueChange={(v) => setForm((f) => ({ ...f, relation: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Hubungan keluarga", "Family relation")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r} value={r} className="py-2.5">
                    {t(r === "Spouse" ? "Pasangan" : r === "Child" ? "Anak" : r === "Parent" ? "Orang Tua" : "Saudara", r === "Spouse" ? "Spouse" : r === "Child" ? "Child" : r === "Parent" ? "Parent" : "Sibling")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Jenis Kelamin", "Gender")}>
            <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Jenis kelamin", "Gender")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M" className="py-2.5">{t("Laki-laki", "Male")}</SelectItem>
                <SelectItem value="F" className="py-2.5">{t("Perempuan", "Female")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Nama Lengkap") + " *"} htmlFor="f-name" className="sm:col-span-2">
            <Input id="f-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("Nama sesuai dokumen", "Name as per document")} required />
          </Field>
          <Field label={t("Tanggal Lahir", "Date of Birth")} htmlFor="f-birth">
            <Input id="f-birth" type="date" value={form.birthDate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
          </Field>
          <Field label={t("Pekerjaan", "Occupation")} htmlFor="f-occ">
            <Input id="f-occ" value={form.occupation} onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))} placeholder={t("Ibu Rumah Tangga", "Homemaker")} />
          </Field>
          <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3.5 dark:border-stone-800 sm:col-span-2">
            <div>
              <Label htmlFor="f-dep" className="text-sm font-semibold">{t("Tanggungan (Dependen)", "Dependent")}</Label>
              <p className="text-xs text-stone-500 dark:text-stone-400">{t("Masuk perhitungan tunjangan keluarga & BPJS.", "Included in family allowance & BPJS calculations.")}</p>
            </div>
            <Switch id="f-dep" checked={form.isDependent} onCheckedChange={(v) => setForm((f) => ({ ...f, isDependent: v }))} />
          </div>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label={edit ? t("Simpan Perubahan", "Save Changes") : t("Tambah Keluarga", "Add Family")} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 4. TAMBAH / UBAH PENDIDIKAN ============
// Task 82-c: prop `edit` — mode ubah (prefill + PATCH; lihat FamilyDialog).
export function EducationDialog({
  open, onOpenChange, employeeId, employeeName, onDone, edit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onDone: () => void;
  edit?: EducationRow | null;
}) {
  const [form, setForm] = useState({ level: "S1", institution: "", major: "", startYear: "", endYear: "", gpa: "" });
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm(edit
      ? {
          level: edit.level, institution: edit.institution, major: edit.major ?? "",
          startYear: edit.startYear != null ? String(edit.startYear) : "",
          endYear: edit.endYear != null ? String(edit.endYear) : "",
          gpa: edit.gpa != null ? String(edit.gpa) : "",
        }
      : { level: "S1", institution: "", major: "", startYear: "", endYear: "", gpa: "" });
  }, [open, edit]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.institution.trim()) { toast.error(t("Nama institusi wajib diisi", "Institution name is required")); return; }
    if (form.startYear && form.endYear && Number(form.endYear) < Number(form.startYear)) {
      toast.error(t("Tahun lulus tidak boleh sebelum tahun masuk", "Graduation year cannot be before the start year"));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        level: form.level,
        institution: form.institution.trim(),
        major: form.major.trim() || null,
        startYear: form.startYear ? Number(form.startYear) : null,
        endYear: form.endYear ? Number(form.endYear) : null,
        gpa: form.gpa === "" ? null : Number(form.gpa),
      };
      if (edit) await apiSend("/api/onevity/education", "PATCH", { id: edit.id, ...payload });
      else await apiSend("/api/onevity/education", "POST", { employeeId, ...payload });
      toast.success(
        edit
          ? t("Riwayat pendidikan diperbarui", "Education record updated")
          : t("Riwayat pendidikan ditambahkan", "Education record added"),
        { description: t("{lvl} — {inst} ({name}).", "{lvl} — {inst} ({name}).", { lvl: form.level, inst: form.institution.trim(), name: employeeName }) },
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        edit
          ? t("Gagal menyimpan perubahan pendidikan", "Failed to save education changes")
          : t("Gagal menambah pendidikan", "Failed to add education"),
        { description: (err as Error).message },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? t("Ubah Riwayat Pendidikan", "Edit Education Record") : t("Tambah Riwayat Pendidikan", "Add Education Record")}</DialogTitle>
          <DialogDescription>{t("Jenjang pendidikan formal {name}.", "Formal education of {name}.", { name: employeeName })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label={t("Jenjang", "Level") + " *"}>
            <Select value={form.level} onValueChange={(v) => setForm((f) => ({ ...f, level: v }))}>
              <SelectTrigger className="h-11" aria-label={t("Jenjang pendidikan", "Education level")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {EDUCATION_LEVELS.map((l) => <SelectItem key={l} value={l} className="py-2.5">{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Jurusan", "Major")} htmlFor="ed-major">
            <Input id="ed-major" value={form.major} onChange={(e) => setForm((f) => ({ ...f, major: e.target.value }))} placeholder="Manajemen" />
          </Field>
          <Field label={t("Institusi") + " *"} htmlFor="ed-inst" className="sm:col-span-2">
            <Input id="ed-inst" value={form.institution} onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))} placeholder={t("Universitas Indonesia", "University of Indonesia")} required />
          </Field>
          <Field label={t("Tahun Masuk", "Start Year")} htmlFor="ed-start">
            <Input id="ed-start" type="number" min={1960} max={2100} value={form.startYear} onChange={(e) => setForm((f) => ({ ...f, startYear: e.target.value }))} placeholder="2012" />
          </Field>
          <Field label={t("Tahun Lulus", "Graduation Year")} htmlFor="ed-end">
            <Input id="ed-end" type="number" min={1960} max={2100} value={form.endYear} onChange={(e) => setForm((f) => ({ ...f, endYear: e.target.value }))} placeholder="2016" />
          </Field>
          <Field label={t("IPK / GPA (0–4)", "GPA (0–4)")} htmlFor="ed-gpa">
            <Input id="ed-gpa" type="number" min={0} max={4} step={0.01} value={form.gpa} onChange={(e) => setForm((f) => ({ ...f, gpa: e.target.value }))} placeholder="3.45" />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label={edit ? t("Simpan Perubahan", "Save Changes") : t("Tambah Pendidikan", "Add Education")} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 5. TAMBAH / UBAH PENGALAMAN ============
// Task 82-c: prop `edit` — mode ubah (prefill + PATCH; lihat FamilyDialog).
export function ExperienceDialog({
  open, onOpenChange, employeeId, employeeName, onDone, edit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onDone: () => void;
  edit?: ExperienceRow | null;
}) {
  const [form, setForm] = useState({ company: "", position: "", startDate: "", endDate: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm(edit
      ? {
          company: edit.company, position: edit.position,
          startDate: isoDate(edit.startDate), endDate: isoDate(edit.endDate),
          notes: edit.notes ?? "",
        }
      : { company: "", position: "", startDate: "", endDate: "", notes: "" });
  }, [open, edit]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim() || !form.position.trim()) { toast.error(t("Perusahaan dan posisi wajib diisi", "Company and position are required")); return; }
    setBusy(true);
    try {
      const payload = {
        company: form.company.trim(),
        position: form.position.trim(),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        notes: form.notes.trim() || null,
      };
      if (edit) await apiSend("/api/onevity/experiences", "PATCH", { id: edit.id, ...payload });
      else await apiSend("/api/onevity/experiences", "POST", { employeeId, ...payload });
      toast.success(
        edit
          ? t("Pengalaman kerja diperbarui", "Work experience updated")
          : t("Pengalaman kerja ditambahkan", "Work experience added"),
        { description: t("{pos} @ {co} ({name}).", "{pos} @ {co} ({name}).", { pos: form.position.trim(), co: form.company.trim(), name: employeeName }) },
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(
        edit
          ? t("Gagal menyimpan perubahan pengalaman", "Failed to save experience changes")
          : t("Gagal menambah pengalaman", "Failed to add experience"),
        { description: (err as Error).message },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? t("Ubah Pengalaman Kerja", "Edit Work Experience") : t("Tambah Pengalaman Kerja", "Add Work Experience")}</DialogTitle>
          <DialogDescription>{t("Riwayat pekerjaan {name} sebelum bergabung.", "Work history of {name} before joining.", { name: employeeName })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label={t("Perusahaan", "Company") + " *"} htmlFor="x-company">
            <Input id="x-company" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder={t("PT Maju Bersama", "PT Maju Bersama")} required />
          </Field>
          <Field label={t("Posisi") + " *"} htmlFor="x-position">
            <Input id="x-position" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} placeholder={t("Staff Akuntansi", "Accounting Staff")} required />
          </Field>
          <Field label={t("Tanggal Mulai", "Start Date")} htmlFor="x-start">
            <Input id="x-start" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label={t("Tanggal Selesai", "End Date")} htmlFor="x-end">
            <Input id="x-end" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <Field label={t("Catatan")} htmlFor="x-notes" className="sm:col-span-2">
            <Textarea id="x-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("Riwayat pencapaian / alasan keluar…", "Achievements / reason for leaving…")} />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label={edit ? t("Simpan Perubahan", "Save Changes") : t("Tambah Pengalaman", "Add Experience")} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 6. CATAT PELANGGARAN (disiplin) ============
export function DisciplinaryDialog({
  open, onOpenChange, employeeId, employeeName, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId?: string | null; // null → pilih karyawan di dialog
  employeeName?: string | null;
  onDone: () => void;
}) {
  const opts = useApi<EmployeeOptions>(open && !employeeId ? "/api/onevity/employee-options" : null, [open, employeeId]);
  const [form, setForm] = useState({ employeeId: "none", warningLevel: "Verbal", violation: "", sanction: "", issuedAt: today(), expiresAt: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (open) setForm({ employeeId: "none", warningLevel: "Verbal", violation: "", sanction: "", issuedAt: today(), expiresAt: "", notes: "" });
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = employeeId ?? (form.employeeId === "none" ? null : form.employeeId);
    if (!targetId) { toast.error(t("Pilih karyawan yang melakukan pelanggaran", "Select the employee who committed the violation")); return; }
    if (!form.violation.trim()) { toast.error(t("Jenis pelanggaran wajib diisi", "Violation type is required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/disciplinary", "POST", {
        employeeId: targetId,
        warningLevel: form.warningLevel,
        violation: form.violation.trim(),
        sanction: form.sanction.trim() || null,
        issuedAt: form.issuedAt || today(),
        expiresAt: form.expiresAt || null,
        notes: form.notes.trim() || null,
      });
      toast.success(t("Pelanggaran dicatat", "Violation recorded"), { description: t("Tingkat {lvl} — {v}.", "Level {lvl} — {v}.", { lvl: form.warningLevel, v: form.violation.trim() }) });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(t("Gagal mencatat pelanggaran", "Failed to record the violation"), { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Catat Pelanggaran Disiplin", "Record Disciplinary Violation")}</DialogTitle>
          <DialogDescription>
            {employeeId && employeeName ? t("Catatan disiplin untuk {name}.", "Disciplinary record for {name}.", { name: employeeName }) : t("Pilih karyawan lalu isi rincian pelanggaran.", "Select an employee then fill in the violation details.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          {!employeeId && (
            <Field label={t("Karyawan") + " *"} className="sm:col-span-2">
              <Select value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger className="h-11" aria-label={t("Pilih karyawan", "Select employee")}><SelectValue placeholder={t("Pilih karyawan…", "Select an employee…")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none" className="py-2.5">{t("— Pilih karyawan —", "— Select employee —")}</SelectItem>
                  {(opts.data?.managers ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id} className="py-2.5">
                      {m.fullName} <span className="text-stone-400">· {m.employeeNo}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t("Tingkat Peringatan", "Warning Level") + " *"} className="sm:col-span-2">
            <div className="grid grid-cols-3 gap-2">
              {WARNING_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, warningLevel: lvl }))}
                  className={cn(
                    "h-11 rounded-xl border text-[13px] font-bold transition",
                    form.warningLevel === lvl
                      ? lvl === "Verbal"
                        ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-400"
                        : lvl === "Written"
                          ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500/60 dark:bg-orange-500/10 dark:text-orange-400"
                          : "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-400"
                      : "border-stone-200 bg-white text-stone-500 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
                  )}
                  aria-pressed={form.warningLevel === lvl}
                >
                  {t(lvl === "Verbal" ? "Verbal" : lvl === "Written" ? "Tertulis" : "Akhir", lvl === "Verbal" ? "Verbal" : lvl === "Written" ? "Written" : "Final")}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("Jenis Pelanggaran", "Violation Type") + " *"} htmlFor="d-violation" className="sm:col-span-2">
            <Input id="d-violation" value={form.violation} onChange={(e) => setForm((f) => ({ ...f, violation: e.target.value }))} placeholder={t("Terlambat kerja berulang tanpa keterangan", "Repeatedly late for work without notice")} required />
          </Field>
          <Field label={t("Sanksi", "Sanction")} htmlFor="d-sanction" className="sm:col-span-2">
            <Input id="d-sanction" value={form.sanction} onChange={(e) => setForm((f) => ({ ...f, sanction: e.target.value }))} placeholder={t("Skorsing 3 hari / pemotongan tunjangan", "3-day suspension / allowance deduction")} />
          </Field>
          <Field label={t("Tanggal Diterbitkan", "Date Issued")} htmlFor="d-issued">
            <Input id="d-issued" type="date" value={form.issuedAt} onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value }))} />
          </Field>
          <Field label={t("Berlaku Hingga", "Valid Until")} htmlFor="d-exp">
            <Input id="d-exp" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </Field>
          <Field label={t("Catatan")} htmlFor="d-notes" className="sm:col-span-2">
            <Textarea id="d-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("Kronologi / bukti pendukung…", "Chronology / supporting evidence…")} />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label={t("Catat Pelanggaran", "Record Violation")} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ tombol hapus + konfirmasi ============
export function DeleteRecordButton({
  url, title, description, onDone, className,
}: {
  url: string;
  title: string;
  description: string;
  onDone: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const remove = async () => {
    setBusy(true);
    try {
      await apiSend(url, "DELETE");
      toast.success(title, { description: t("Data berhasil dihapus.", "Data successfully deleted.") });
      onDone();
    } catch (err) {
      toast.error(t("Gagal menghapus", "Failed to delete"), { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-11 w-11 text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10", className)}
          aria-label={t("Hapus data", "Delete data")}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">{t("Batal")}</AlertDialogCancel>
          <AlertDialogAction className="h-11 bg-rose-600 font-bold hover:bg-rose-700" onClick={remove}>
            {t("Ya, Hapus", "Yes, Delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
