"use client";
// "Dokumen Baru" — create Personnel Action dialog with type-specific dynamic fields
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { PA_TYPES } from "@/onevity/shared/components/ui-kit";
import { useApi, apiSend, initials, avatarColor, fmtIDR } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmpOpt {
  id: string;
  employeeNo: string;
  fullName: string;
  position: { title: string; code: string } | null;
  orgUnit: { name: string; code: string } | null;
  grade: { code: string; name: string } | null;
  baseSalary: number;
  employmentStatus: string;
}

// master posisi/unit/grade — sumber opsi dengan ID + kode (fix K-01: kirim id DAN code)
interface MasterOpt {
  positions: { id: string; code: string; title: string }[];
  orgUnits: { id: string; code: string; name: string }[];
  grades: { id: string; code: string; name: string }[];
}

type FieldKind = "select-position" | "select-unit" | "select-grade" | "number" | "date" | "select-empstatus";
interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  money?: boolean;
}

const TYPE_FIELDS: Record<string, FieldDef[]> = {
  Promotion: [
    { key: "toPosition", label: "Posisi Baru", kind: "select-position", required: true },
    { key: "newGrade", label: "Grade Baru", kind: "select-grade" },
    { key: "newSalary", label: "Gaji Pokok Baru", kind: "number", money: true, required: true },
  ],
  Demotion: [
    { key: "toPosition", label: "Posisi Baru", kind: "select-position", required: true },
    { key: "newGrade", label: "Grade Baru", kind: "select-grade" },
    { key: "newSalary", label: "Gaji Pokok Baru", kind: "number", money: true },
  ],
  Transfer: [
    { key: "toUnit", label: "Unit Organisasi Baru", kind: "select-unit", required: true },
    { key: "toPosition", label: "Posisi Baru (opsional)", kind: "select-position" },
    { key: "newSalary", label: "Gaji Pokok Baru (opsional)", kind: "number", money: true },
  ],
  Mutation: [
    { key: "toUnit", label: "Unit Organisasi Tujuan", kind: "select-unit", required: true },
  ],
  SalaryAdjustment: [
    { key: "newSalary", label: "Gaji Pokok Baru", kind: "number", money: true, required: true },
  ],
  Resignation: [
    { key: "lastDay", label: "Hari Kerja Terakhir", kind: "date", required: true },
  ],
  Termination: [
    { key: "lastDay", label: "Tanggal Berakhir", kind: "date", required: true },
  ],
  Retirement: [
    { key: "lastDay", label: "Tanggal Pensiun", kind: "date", required: true },
  ],
  Hire: [
    { key: "plannedPosition", label: "Posisi Direncanakan", kind: "select-position", required: true },
    { key: "plannedSalary", label: "Gaji Direncanakan", kind: "number", money: true, required: true },
  ],
  ContractRenewal: [
    { key: "months", label: "Durasi Kontrak (bulan)", kind: "number", required: true },
    { key: "newEndDate", label: "Tanggal Berakhir Baru", kind: "date" },
  ],
  ExtendProbation: [
    { key: "months", label: "Perpanjangan (bulan)", kind: "number", required: true },
  ],
  ChangeStatus: [
    { key: "newEmploymentStatus", label: "Status Kepegawaian Baru", kind: "select-empstatus", required: true },
  ],
};

// Kunci ID pendamping tiap field select — dialog menyimpan ID (dipakai handler process)
// DAN kode (dipakai tampilan/detail lama) agar promosi/mutasi benar-benar diterapkan (fix K-01).
const ID_KEY_BY_KIND: Record<string, string> = {
  "select-position": "positionId",
  "select-unit": "orgUnitId",
  "select-grade": "gradeId",
};

const EMP_STATUSES = ["Permanent", "Contract", "Probation", "Outsourcing"];

export function CreatePADialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { navigate } = useNav();
  const employees = useApi<{ employees: EmpOpt[]; total: number }>(open ? "/api/onevity/employees?limit=200&status=Active" : null);
  const masters = useApi<MasterOpt>(open ? "/api/onevity/employee-options" : null);

  const [empOpen, setEmpOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const list = employees.data?.employees ?? [];
  const selected = list.find((e) => e.id === employeeId);

  // opsi dari MASTER (bukan hanya posisi yang sedang dipegang karyawan) —
  // posisi lowong pun bisa dipilih; value = ID, kode disimpan bersamaan untuk display.
  const positions = useMemo(
    () => (masters.data?.positions ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    [masters.data],
  );
  const units = useMemo(
    () => (masters.data?.orgUnits ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    [masters.data],
  );
  const grades = useMemo(
    () => (masters.data?.grades ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    [masters.data],
  );

  const fields = type ? (TYPE_FIELDS[type] ?? []) : [];

  const reset = () => {
    setEmployeeId("");
    setType("");
    setReason("");
    setDetail({});
    setEmpOpen(false);
  };

  const missing = !employeeId || !type || fields.some((f) => f.required && !detail[f.key]);

  const submit = async () => {
    if (missing) return;
    setBusy(true);
    try {
      const res = await apiSend<{ action: { id: string; docNo: string } }>("/api/onevity/personnel-actions", "POST", {
        employeeId,
        type,
        effectiveDate,
        reason: reason.trim() || null,
        detail,
      });
      toast.success(`Dokumen ${res.action.docNo} dibuat sebagai Draft`, { description: "Lanjutkan dengan Submit untuk Approval." });
      onOpenChange(false);
      reset();
      navigate("actions", "all", { id: res.action.id });
    } catch (e) {
      toast.error("Gagal membuat dokumen", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const setField = (key: string, value: string) => setDetail((d) => ({ ...d, [key]: value }));

  // field select master: simpan ID (positionId/orgUnitId/gradeId — dipakai handler process)
  // + kode pada kunci aslinya (toPosition/toUnit/newGrade — dipakai tampilan & data lama).
  const setMasterField = (f: FieldDef, id: string, code: string) => {
    const idKey = ID_KEY_BY_KIND[f.kind];
    setDetail((d) => ({ ...d, [f.key]: code, ...(idKey ? { [idKey]: id } : {}) }));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md shadow-emerald-600/20">
              <Workflow className="h-5 w-5" />
            </span>
            Dokumen Personnel Action Baru
          </DialogTitle>
          <DialogDescription>
            Dokumen dibuat dengan status <Badge variant="outline" className="mx-1 border-stone-200 bg-stone-50 text-[10px] dark:border-stone-700 dark:bg-stone-800">Draft</Badge> dan approval 3 layer (Dept Head → HR Manager → HR Director).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* employee combobox */}
          <div className="space-y-2 sm:col-span-2">
            <Label>Karyawan <span className="text-rose-500">*</span></Label>
            <Popover open={empOpen} onOpenChange={setEmpOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={empOpen} className="h-11 w-full justify-between font-normal">
                  {selected ? (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", avatarColor(selected.fullName))}>{initials(selected.fullName)}</span>
                      <span className="truncate">{selected.fullName}</span>
                      <span className="shrink-0 text-xs text-stone-400">{selected.employeeNo}</span>
                    </span>
                  ) : (
                    <span className="text-stone-400">Cari dan pilih karyawan…</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command shouldFilter>
                  <CommandInput placeholder="Ketik nama atau nomor karyawan…" />
                  <CommandList className="max-h-64">
                    <CommandEmpty>Tidak ditemukan.</CommandEmpty>
                    <CommandGroup>
                      {employees.loading && <p className="px-3 py-4 text-xs text-stone-400">Memuat daftar karyawan…</p>}
                      {list.map((e) => (
                        <CommandItem
                          key={e.id}
                          value={`${e.fullName} ${e.employeeNo}`}
                          onSelect={() => { setEmployeeId(e.id); setEmpOpen(false); }}
                          className="gap-2.5"
                        >
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", avatarColor(e.fullName))}>{initials(e.fullName)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{e.fullName}</span>
                            <span className="block truncate text-[11px] text-stone-400">{e.employeeNo} · {e.position?.title ?? "—"}</span>
                          </span>
                          <Check className={cn("h-4 w-4", employeeId === e.id ? "opacity-100 text-emerald-600" : "opacity-0")} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selected && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-stone-200/80 bg-stone-50/60 px-3 py-2 text-[11px] text-stone-500 dark:border-stone-800 dark:bg-stone-900/40">
                <span>Posisi: <b className="text-stone-700 dark:text-stone-300">{selected.position?.title ?? "—"}</b></span>
                <span>Grade: <b className="text-stone-700 dark:text-stone-300">{selected.grade?.code ?? "—"}</b></span>
                <span>Gaji pokok: <b className="text-stone-700 dark:text-stone-300">{fmtIDR(selected.baseSalary)}</b></span>
                <span>Status: <b className="text-stone-700 dark:text-stone-300">{selected.employmentStatus}</b></span>
              </div>
            )}
          </div>

          {/* type */}
          <div className="space-y-2">
            <Label>Jenis Aksi <span className="text-rose-500">*</span></Label>
            <Select value={type} onValueChange={(v) => { setType(v); setDetail({}); }}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih jenis aksi" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {Object.entries(PA_TYPES).map(([value, t]) => (
                  <SelectItem key={value} value={value} className="py-2.5">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* effective date */}
          <div className="space-y-2">
            <Label>Tanggal Efektif <span className="text-rose-500">*</span></Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="h-11" />
          </div>

          {/* dynamic fields */}
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>
                {f.label} {f.required && <span className="text-rose-500">*</span>}
              </Label>
              {f.kind === "select-position" && (
                <Select value={detail[ID_KEY_BY_KIND[f.kind]] ?? detail[f.key] ?? ""} onValueChange={(v) => {
                  const p = positions.find((x) => x.id === v);
                  if (p) setMasterField(f, p.id, p.code);
                }}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih posisi" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {positions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-mono text-xs text-stone-400">{p.code}</span> · {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.kind === "select-unit" && (
                <Select value={detail[ID_KEY_BY_KIND[f.kind]] ?? detail[f.key] ?? ""} onValueChange={(v) => {
                  const u = units.find((x) => x.id === v);
                  if (u) setMasterField(f, u.id, u.code);
                }}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        <span className="font-mono text-xs text-stone-400">{u.code}</span> · {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.kind === "select-grade" && (
                <Select value={detail[ID_KEY_BY_KIND[f.kind]] ?? detail[f.key] ?? ""} onValueChange={(v) => {
                  const g = grades.find((x) => x.id === v);
                  if (g) setMasterField(f, g.id, g.code);
                }}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih grade" /></SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        <span className="font-mono text-xs text-stone-400">{g.code}</span> · {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.kind === "select-empstatus" && (
                <Select value={detail[f.key] ?? ""} onValueChange={(v) => setField(f.key, v)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih status" /></SelectTrigger>
                  <SelectContent>
                    {EMP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {f.kind === "number" && (
                <div className="relative">
                  {f.money && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-stone-400">Rp</span>}
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={detail[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.money ? "0" : "—"}
                    className={`h-11 ${f.money ? "pl-9" : ""}`}
                  />
                </div>
              )}
              {f.kind === "date" && (
                <Input type="date" value={detail[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} className="h-11" />
              )}
            </div>
          ))}

          {/* reason */}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="pa-reason">Alasan / Justifikasi</Label>
            <Textarea
              id="pa-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Promosi berdasarkan evaluasi kinerja semester 1/2026…"
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-11 px-5">Batal</Button>
          <Button disabled={missing || busy} onClick={() => void submit()} className="h-11 bg-emerald-600 px-6 font-bold hover:bg-emerald-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
            Buat Dokumen Draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
