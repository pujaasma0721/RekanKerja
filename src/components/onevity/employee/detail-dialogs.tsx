"use client";
// OneVity — dialog CRUD untuk detail karyawan:
// edit data personal, edit info pekerjaan, tambah keluarga/pendidikan/pengalaman,
// catat pelanggaran, dan tombol hapus dengan konfirmasi
import { useEffect, useState } from "react";
import { apiSend, useApi } from "@/lib/onevity/api";
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
import {
  RELIGIONS, MARITAL_STATUSES, BLOOD_TYPES, BANKS, WORK_SHIFTS, EDUCATION_LEVELS, RELATIONS, WARNING_LEVELS,
  type EmployeeDetail, type EmployeeOptions,
} from "./types";

const isoDate = (d: string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</Label>
      {children}
    </div>
  );
}

function DialogFooterBar({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label: string }) {
  return (
    <DialogFooter className="mt-1 gap-2">
      <Button variant="outline" className="h-11 px-5" onClick={onCancel} disabled={busy}>Batal</Button>
      <Button type="submit" className="h-11 gap-2 bg-emerald-600 px-6 font-bold hover:bg-emerald-700" disabled={busy}>
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
    if (!form.fullName.trim()) { toast.error("Nama lengkap wajib diisi"); return; }
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
      toast.success("Data personal tersimpan", { description: `Profil ${form.fullName.trim()} berhasil diperbarui.` });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Gagal menyimpan data personal", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Data Personal</DialogTitle>
          <DialogDescription>Perbarui identitas dan data kependudukan {employee.fullName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label="Nama Lengkap *" htmlFor="ep-name" className="sm:col-span-2">
            <Input id="ep-name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} placeholder="Nama sesuai KTP" required />
          </Field>
          <Field label="Jenis Kelamin *">
            <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
              <SelectTrigger className="h-11" aria-label="Jenis kelamin"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M" className="py-2.5">Laki-laki</SelectItem>
                <SelectItem value="F" className="py-2.5">Perempuan</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tempat Lahir" htmlFor="ep-bp">
            <Input id="ep-bp" value={form.birthPlace} onChange={(e) => setForm((f) => ({ ...f, birthPlace: e.target.value }))} placeholder="Bogor" />
          </Field>
          <Field label="Tanggal Lahir" htmlFor="ep-bd">
            <Input id="ep-bd" type="date" value={form.birthDate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
          </Field>
          <Field label="Agama">
            <Select value={form.religion} onValueChange={(v) => setForm((f) => ({ ...f, religion: v }))}>
              <SelectTrigger className="h-11" aria-label="Agama"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">— Tidak diisi —</SelectItem>
                {RELIGIONS.map((r) => <SelectItem key={r} value={r} className="py-2.5">{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status Pernikahan">
            <Select value={form.maritalStatus} onValueChange={(v) => setForm((f) => ({ ...f, maritalStatus: v }))}>
              <SelectTrigger className="h-11" aria-label="Status pernikahan"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">— Tidak diisi —</SelectItem>
                {MARITAL_STATUSES.map((m) => <SelectItem key={m} value={m} className="py-2.5">{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Golongan Darah">
            <Select value={form.bloodType} onValueChange={(v) => setForm((f) => ({ ...f, bloodType: v }))}>
              <SelectTrigger className="h-11" aria-label="Golongan darah"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">— Tidak diisi —</SelectItem>
                {BLOOD_TYPES.map((b) => <SelectItem key={b} value={b} className="py-2.5">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Email" htmlFor="ep-email">
            <Input id="ep-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="nama@mii.co.id" />
          </Field>
          <Field label="Telepon" htmlFor="ep-phone">
            <Input id="ep-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="0812…" />
          </Field>
          <Field label="NIK (KTP)" htmlFor="ep-nik">
            <Input id="ep-nik" value={form.nationalId} onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))} placeholder="16 digit" className="font-mono" />
          </Field>
          <Field label="NPWP" htmlFor="ep-npwp">
            <Input id="ep-npwp" value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} placeholder="15 digit" className="font-mono" />
          </Field>
          <Field label="No. BPJS Kesehatan" htmlFor="ep-bpjsk">
            <Input id="ep-bpjsk" value={form.bpjsHealth} onChange={(e) => setForm((f) => ({ ...f, bpjsHealth: e.target.value }))} className="font-mono" />
          </Field>
          <Field label="No. BPJS Ketenagakerjaan (JHT)" htmlFor="ep-bpjsh">
            <Input id="ep-bpjsh" value={form.bpjsEmpSkill} onChange={(e) => setForm((f) => ({ ...f, bpjsEmpSkill: e.target.value }))} className="font-mono" />
          </Field>
          <Field label="Alamat" htmlFor="ep-addr" className="sm:col-span-2">
            <Textarea id="ep-addr" rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Jl. …" />
          </Field>
          <Field label="Kota" htmlFor="ep-city">
            <Input id="ep-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Bandung" />
          </Field>
          <Field label="Bank">
            <Select value={form.bankName} onValueChange={(v) => setForm((f) => ({ ...f, bankName: v }))}>
              <SelectTrigger className="h-11" aria-label="Bank"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">— Tidak diisi —</SelectItem>
                {BANKS.map((b) => <SelectItem key={b} value={b} className="py-2.5">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="No. Rekening" htmlFor="ep-rek" className="sm:col-span-2">
            <Input id="ep-rek" value={form.bankAccount} onChange={(e) => setForm((f) => ({ ...f, bankAccount: e.target.value }))} className="font-mono" />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label="Simpan Perubahan" />
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
    if (!form.joinDate) { toast.error("Tanggal masuk wajib diisi"); return; }
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
      toast.success("Info pekerjaan tersimpan", { description: `Data kepegawaian ${employee.fullName} berhasil diperbarui.` });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Gagal menyimpan info pekerjaan", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Info Pekerjaan</DialogTitle>
          <DialogDescription>Penempatan, status kerja, dan upah {employee.fullName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label="Unit Organisasi">
            <Select value={form.orgUnitId} onValueChange={(v) => setForm((f) => ({ ...f, orgUnitId: v }))}>
              <SelectTrigger className="h-11" aria-label="Unit organisasi"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" className="py-2.5">— Tanpa unit —</SelectItem>
                {(opts.data?.orgUnits ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id} className="py-2.5">{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Posisi">
            <Select value={form.positionId} onValueChange={(v) => setForm((f) => ({ ...f, positionId: v }))}>
              <SelectTrigger className="h-11" aria-label="Posisi"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" className="py-2.5">— Tanpa posisi —</SelectItem>
                {(opts.data?.positions ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="py-2.5">{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Grade">
            <Select value={form.gradeId} onValueChange={(v) => setForm((f) => ({ ...f, gradeId: v }))}>
              <SelectTrigger className="h-11" aria-label="Grade"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="py-2.5">— Tanpa grade —</SelectItem>
                {(opts.data?.grades ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id} className="py-2.5">{g.code} · {g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Atasan Langsung">
            <Select value={form.managerId} onValueChange={(v) => setForm((f) => ({ ...f, managerId: v }))}>
              <SelectTrigger className="h-11" aria-label="Atasan langsung"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none" className="py-2.5">— Tanpa atasan —</SelectItem>
                {(opts.data?.managers ?? []).filter((m) => m.id !== employee.id).map((m) => (
                  <SelectItem key={m.id} value={m.id} className="py-2.5">{m.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status Kerja">
            <Select value={form.employmentStatus} onValueChange={(v) => setForm((f) => ({ ...f, employmentStatus: v }))}>
              <SelectTrigger className="h-11" aria-label="Status kerja"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Permanent", "Probation", "Contract", "Outsourcing"].map((s) => (
                  <SelectItem key={s} value={s} className="py-2.5">{s === "Permanent" ? "Tetap" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Shift Kerja">
            <Select value={form.workShift} onValueChange={(v) => setForm((f) => ({ ...f, workShift: v }))}>
              <SelectTrigger className="h-11" aria-label="Shift kerja"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORK_SHIFTS.map((s) => <SelectItem key={s} value={s} className="py-2.5">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tanggal Masuk *" htmlFor="ew-join">
            <Input id="ew-join" type="date" value={form.joinDate} onChange={(e) => setForm((f) => ({ ...f, joinDate: e.target.value }))} required />
          </Field>
          <Field label="Tanggal Keluar" htmlFor="ew-end">
            <Input id="ew-end" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <Field label="Gaji Pokok (Rp)" htmlFor="ew-salary">
            <Input id="ew-salary" type="number" min={0} step={100000} value={form.baseSalary} onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))} className="font-mono" />
          </Field>
          <Field label="Status Kepegawaian">
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger className="h-11" aria-label="Status kepegawaian"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Active", "Resigned", "Terminated", "Blacklisted"].map((s) => (
                  <SelectItem key={s} value={s} className="py-2.5">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label="Simpan Perubahan" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 3. TAMBAH KELUARGA ============
export function FamilyDialog({
  open, onOpenChange, employeeId, employeeName, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ relation: "Spouse", name: "", gender: "M", birthDate: "", occupation: "", isDependent: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ relation: "Spouse", name: "", gender: "M", birthDate: "", occupation: "", isDependent: true });
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Nama anggota keluarga wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/family", "POST", {
        employeeId,
        relation: form.relation,
        name: form.name.trim(),
        gender: form.gender,
        birthDate: form.birthDate || null,
        occupation: form.occupation.trim() || null,
        isDependent: form.isDependent,
      });
      toast.success("Anggota keluarga ditambahkan", { description: `${form.name.trim()} ditambahkan ke profil ${employeeName}.` });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Gagal menambah keluarga", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah Anggota Keluarga</DialogTitle>
          <DialogDescription>Data keluarga {employeeName} — untuk keperluan BPJS & tunjangan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label="Hubungan Keluarga *">
            <Select value={form.relation} onValueChange={(v) => setForm((f) => ({ ...f, relation: v }))}>
              <SelectTrigger className="h-11" aria-label="Hubungan keluarga"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r} value={r} className="py-2.5">
                    {r === "Spouse" ? "Pasangan" : r === "Child" ? "Anak" : r === "Parent" ? "Orang Tua" : "Saudara"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Jenis Kelamin">
            <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
              <SelectTrigger className="h-11" aria-label="Jenis kelamin"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M" className="py-2.5">Laki-laki</SelectItem>
                <SelectItem value="F" className="py-2.5">Perempuan</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nama Lengkap *" htmlFor="f-name" className="sm:col-span-2">
            <Input id="f-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nama sesuai dokumen" required />
          </Field>
          <Field label="Tanggal Lahir" htmlFor="f-birth">
            <Input id="f-birth" type="date" value={form.birthDate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
          </Field>
          <Field label="Pekerjaan" htmlFor="f-occ">
            <Input id="f-occ" value={form.occupation} onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))} placeholder="Ibu Rumah Tangga" />
          </Field>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 dark:border-slate-800 sm:col-span-2">
            <div>
              <Label htmlFor="f-dep" className="text-sm font-semibold">Tanggungan (Dependen)</Label>
              <p className="text-xs text-slate-500 dark:text-slate-400">Masuk perhitungan tunjangan keluarga & BPJS.</p>
            </div>
            <Switch id="f-dep" checked={form.isDependent} onCheckedChange={(v) => setForm((f) => ({ ...f, isDependent: v }))} />
          </div>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label="Tambah Keluarga" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 4. TAMBAH PENDIDIKAN ============
export function EducationDialog({
  open, onOpenChange, employeeId, employeeName, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ level: "S1", institution: "", major: "", startYear: "", endYear: "", gpa: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ level: "S1", institution: "", major: "", startYear: "", endYear: "", gpa: "" });
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.institution.trim()) { toast.error("Nama institusi wajib diisi"); return; }
    if (form.startYear && form.endYear && Number(form.endYear) < Number(form.startYear)) {
      toast.error("Tahun lulus tidak boleh sebelum tahun masuk");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/onevity/education", "POST", {
        employeeId,
        level: form.level,
        institution: form.institution.trim(),
        major: form.major.trim() || null,
        startYear: form.startYear ? Number(form.startYear) : null,
        endYear: form.endYear ? Number(form.endYear) : null,
        gpa: form.gpa === "" ? null : Number(form.gpa),
      });
      toast.success("Riwayat pendidikan ditambahkan", { description: `${form.level} — ${form.institution.trim()} (${employeeName}).` });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Gagal menambah pendidikan", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah Riwayat Pendidikan</DialogTitle>
          <DialogDescription>Jenjang pendidikan formal {employeeName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label="Jenjang *">
            <Select value={form.level} onValueChange={(v) => setForm((f) => ({ ...f, level: v }))}>
              <SelectTrigger className="h-11" aria-label="Jenjang pendidikan"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EDUCATION_LEVELS.map((l) => <SelectItem key={l} value={l} className="py-2.5">{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Jurusan" htmlFor="ed-major">
            <Input id="ed-major" value={form.major} onChange={(e) => setForm((f) => ({ ...f, major: e.target.value }))} placeholder="Manajemen" />
          </Field>
          <Field label="Institusi *" htmlFor="ed-inst" className="sm:col-span-2">
            <Input id="ed-inst" value={form.institution} onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))} placeholder="Universitas Indonesia" required />
          </Field>
          <Field label="Tahun Masuk" htmlFor="ed-start">
            <Input id="ed-start" type="number" min={1960} max={2100} value={form.startYear} onChange={(e) => setForm((f) => ({ ...f, startYear: e.target.value }))} placeholder="2012" />
          </Field>
          <Field label="Tahun Lulus" htmlFor="ed-end">
            <Input id="ed-end" type="number" min={1960} max={2100} value={form.endYear} onChange={(e) => setForm((f) => ({ ...f, endYear: e.target.value }))} placeholder="2016" />
          </Field>
          <Field label="IPK / GPA (0–4)" htmlFor="ed-gpa">
            <Input id="ed-gpa" type="number" min={0} max={4} step={0.01} value={form.gpa} onChange={(e) => setForm((f) => ({ ...f, gpa: e.target.value }))} placeholder="3.45" />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label="Tambah Pendidikan" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ 5. TAMBAH PENGALAMAN ============
export function ExperienceDialog({
  open, onOpenChange, employeeId, employeeName, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ company: "", position: "", startDate: "", endDate: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ company: "", position: "", startDate: "", endDate: "", notes: "" });
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim() || !form.position.trim()) { toast.error("Perusahaan dan posisi wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/experiences", "POST", {
        employeeId,
        company: form.company.trim(),
        position: form.position.trim(),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        notes: form.notes.trim() || null,
      });
      toast.success("Pengalaman kerja ditambahkan", { description: `${form.position.trim()} @ ${form.company.trim()} (${employeeName}).` });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Gagal menambah pengalaman", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah Pengalaman Kerja</DialogTitle>
          <DialogDescription>Riwayat pekerjaan {employeeName} sebelum bergabung.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <Field label="Perusahaan *" htmlFor="x-company">
            <Input id="x-company" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder="PT Maju Bersama" required />
          </Field>
          <Field label="Posisi *" htmlFor="x-position">
            <Input id="x-position" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} placeholder="Staff Akuntansi" required />
          </Field>
          <Field label="Tanggal Mulai" htmlFor="x-start">
            <Input id="x-start" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="Tanggal Selesai" htmlFor="x-end">
            <Input id="x-end" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
          <Field label="Catatan" htmlFor="x-notes" className="sm:col-span-2">
            <Textarea id="x-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Riwayat pencapaian / alasan keluar…" />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label="Tambah Pengalaman" />
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

  useEffect(() => {
    if (open) setForm({ employeeId: "none", warningLevel: "Verbal", violation: "", sanction: "", issuedAt: today(), expiresAt: "", notes: "" });
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = employeeId ?? (form.employeeId === "none" ? null : form.employeeId);
    if (!targetId) { toast.error("Pilih karyawan yang melakukan pelanggaran"); return; }
    if (!form.violation.trim()) { toast.error("Jenis pelanggaran wajib diisi"); return; }
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
      toast.success("Pelanggaran dicatat", { description: `Tingkat ${form.warningLevel} — ${form.violation.trim()}.` });
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error("Gagal mencatat pelanggaran", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Catat Pelanggaran Disiplin</DialogTitle>
          <DialogDescription>
            {employeeId && employeeName ? `Catatan disiplin untuk ${employeeName}.` : "Pilih karyawan lalu isi rincian pelanggaran."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          {!employeeId && (
            <Field label="Karyawan *" className="sm:col-span-2">
              <Select value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger className="h-11" aria-label="Pilih karyawan"><SelectValue placeholder="Pilih karyawan…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none" className="py-2.5">— Pilih karyawan —</SelectItem>
                  {(opts.data?.managers ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id} className="py-2.5">
                      {m.fullName} <span className="text-slate-400">· {m.employeeNo}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Tingkat Peringatan *" className="sm:col-span-2">
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
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  )}
                  aria-pressed={form.warningLevel === lvl}
                >
                  {lvl === "Verbal" ? "Verbal" : lvl === "Written" ? "Tertulis" : "Akhir"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Jenis Pelanggaran *" htmlFor="d-violation" className="sm:col-span-2">
            <Input id="d-violation" value={form.violation} onChange={(e) => setForm((f) => ({ ...f, violation: e.target.value }))} placeholder="Terlambat kerja berulang tanpa keterangan" required />
          </Field>
          <Field label="Sanksi" htmlFor="d-sanction" className="sm:col-span-2">
            <Input id="d-sanction" value={form.sanction} onChange={(e) => setForm((f) => ({ ...f, sanction: e.target.value }))} placeholder="Skorsing 3 hari / pemotongan tunjangan" />
          </Field>
          <Field label="Tanggal Diterbitkan" htmlFor="d-issued">
            <Input id="d-issued" type="date" value={form.issuedAt} onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value }))} />
          </Field>
          <Field label="Berlaku Hingga" htmlFor="d-exp">
            <Input id="d-exp" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </Field>
          <Field label="Catatan" htmlFor="d-notes" className="sm:col-span-2">
            <Textarea id="d-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Kronologi / bukti pendukung…" />
          </Field>
          <DialogFooterBar busy={busy} onCancel={() => onOpenChange(false)} label="Catat Pelanggaran" />
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
  const remove = async () => {
    setBusy(true);
    try {
      await apiSend(url, "DELETE");
      toast.success(title, { description: "Data berhasil dihapus." });
      onDone();
    } catch (err) {
      toast.error("Gagal menghapus", { description: (err as Error).message });
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
          className={cn("h-11 w-11 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10", className)}
          aria-label="Hapus data"
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
          <AlertDialogCancel className="h-11">Batal</AlertDialogCancel>
          <AlertDialogAction className="h-11 bg-rose-600 font-bold hover:bg-rose-700" onClick={remove}>
            Ya, Hapus
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
