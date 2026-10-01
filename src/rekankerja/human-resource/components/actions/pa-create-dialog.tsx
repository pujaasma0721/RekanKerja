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
import { Checkbox } from "@/components/ui/checkbox";
import { PA_TYPES } from "@/rekankerja/shared/components/ui-kit";
import { PA_TYPE_LABEL_EN } from "./pa-types";
import { useApi, apiSend, initials, avatarColor, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Workflow, Calculator } from "lucide-react";
import { SettlementPreviewDialog } from "@/rekankerja/human-resource/components/actions/settlement-preview-dialog";
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

type FieldKind = "select-position" | "select-unit" | "select-grade" | "number" | "date" | "select-empstatus" | "select-multiplier" | "check";
interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  money?: boolean;
  /** nilai string yang disimpan saat checkbox aktif (dipakai kind "check") */
  checkValue?: string;
  hint?: string;
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
    { key: "pesangonMultiplier", label: "Faktor UPMK Pesangon", kind: "select-multiplier" },
    { key: "uangPisahPct", label: "Uang Pisah (15% pesangon)", kind: "check", checkValue: "15" },
    { key: "includeBonusProRata", label: "Bonus Pro-rata (penggantian hak)", kind: "check", checkValue: "true" },
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

// En paralel untuk label field TYPE_FIELDS di atas (map ID dipertahankan — Task I-3)
const FIELD_LABEL_EN: Record<string, string> = {
  "Posisi Baru": "New Position",
  "Grade Baru": "New Grade",
  "Gaji Pokok Baru": "New Base Salary",
  "Unit Organisasi Baru": "New Organizational Unit",
  "Posisi Baru (opsional)": "New Position (optional)",
  "Gaji Pokok Baru (opsional)": "New Base Salary (optional)",
  "Unit Organisasi Tujuan": "Target Organizational Unit",
  "Hari Kerja Terakhir": "Last Working Day",
  "Tanggal Berakhir": "End Date",
  "Tanggal Pensiun": "Retirement Date",
  "Posisi Direncanakan": "Planned Position",
  "Gaji Direncanakan": "Planned Salary",
  "Durasi Kontrak (bulan)": "Contract Duration (months)",
  "Tanggal Berakhir Baru": "New End Date",
  "Perpanjangan (bulan)": "Extension (months)",
  "Status Kepegawaian Baru": "New Employment Status",
  "Faktor UPMK Pesangon": "UPMK Severance Factor",
  "Uang Pisah (15% pesangon)": "Separation Pay (15% of severance)",
  "Bonus Pro-rata (penggantian hak)": "Pro-rata Bonus (replacement entitlement)",
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
  const { t } = useI18n();
  const perms = useMenuPerms();
  const employees = useApi<{ employees: EmpOpt[]; total: number }>(open ? "/api/rekankerja/employees?limit=200&status=Active" : null);
  const masters = useApi<MasterOpt>(open ? "/api/rekankerja/employee-options" : null);

  const [empOpen, setEmpOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
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
      const res = await apiSend<{ action: { id: string; docNo: string } }>("/api/rekankerja/personnel-actions", "POST", {
        employeeId,
        type,
        effectiveDate,
        reason: reason.trim() || null,
        detail,
      });
      toast.success(t("Dokumen {doc} dibuat sebagai Draft", "Document {doc} created as Draft", { doc: res.action.docNo }), { description: t("Lanjutkan dengan Submit untuk Approval.", "Continue with Submit for Approval.") });
      onOpenChange(false);
      reset();
      navigate("actions", "all", { id: res.action.id });
    } catch (e) {
      toast.error(t("Gagal membuat dokumen", "Failed to create document"), { description: (e as Error).message });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl ov-fill ov-glow">
              <Workflow className="h-5 w-5" />
            </span>
            {t("Dokumen Personnel Action Baru", "New Personnel Action Document")}
          </DialogTitle>
          <DialogDescription>
            {t("Dokumen dibuat dengan status", "The document is created with status")} <Badge variant="outline" className="mx-1 border-slate-200 bg-slate-50 text-[10px] dark:border-slate-700 dark:bg-slate-800">Draft</Badge> {t("dan approval 3 layer (Dept Head → HR Manager → HR Director).", "and 3-layer approval (Dept Head → HR Manager → HR Director).")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* employee combobox */}
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("Karyawan")} <span className="text-rose-500">*</span></Label>
            <Popover open={empOpen} onOpenChange={setEmpOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={empOpen} className="h-11 w-full justify-between font-normal">
                  {selected ? (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", avatarColor(selected.fullName))}>{initials(selected.fullName)}</span>
                      <span className="truncate">{selected.fullName}</span>
                      <span className="shrink-0 text-xs text-slate-400">{selected.employeeNo}</span>
                    </span>
                  ) : (
                    <span className="text-slate-400">{t("Cari dan pilih karyawan…", "Search and select an employee…")}</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command shouldFilter>
                  <CommandInput placeholder={t("Ketik nama atau nomor karyawan…", "Type an employee name or number…")} />
                  <CommandList className="max-h-64">
                    <CommandEmpty>{t("Tidak ditemukan.", "No results found.")}</CommandEmpty>
                    <CommandGroup>
                      {employees.loading && <p className="px-3 py-4 text-xs text-slate-400">{t("Memuat daftar karyawan…", "Loading employee list…")}</p>}
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
                            <span className="block truncate text-[11px] text-slate-400">{e.employeeNo} · {e.position?.title ?? "—"}</span>
                          </span>
                          <Check className={cn("h-4 w-4", employeeId === e.id ? "opacity-100 ov-text-accent" : "opacity-0")} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selected && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                <span>{t("Posisi:", "Position:")} <b className="text-slate-700 dark:text-slate-300">{selected.position?.title ?? "—"}</b></span>
                <span>Grade: <b className="text-slate-700 dark:text-slate-300">{selected.grade?.code ?? "—"}</b></span>
                <span>{t("Gaji pokok:", "Base salary:")} <b className="text-slate-700 dark:text-slate-300">{fmtIDR(selected.baseSalary)}</b></span>
                <span>Status: <b className="text-slate-700 dark:text-slate-300">{selected.employmentStatus}</b></span>
              </div>
            )}
          </div>

          {/* type */}
          <div className="space-y-2">
            <Label>{t("Jenis Aksi", "Action Type")} <span className="text-rose-500">*</span></Label>
            <Select value={type} onValueChange={(v) => { setType(v); setDetail({}); }}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih jenis aksi", "Select action type")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {Object.entries(PA_TYPES).map(([value, tp]) => (
                  <SelectItem key={value} value={value} className="py-2.5">{t(tp.label, PA_TYPE_LABEL_EN[value])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* effective date */}
          <div className="space-y-2">
            <Label>{t("Tanggal Efektif", "Effective Date")} <span className="text-rose-500">*</span></Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="h-11" />
          </div>

          {/* dynamic fields */}
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>
                {t(f.label, FIELD_LABEL_EN[f.label])} {f.required && <span className="text-rose-500">*</span>}
              </Label>
              {f.kind === "select-position" && (
                <Select value={detail[ID_KEY_BY_KIND[f.kind]] ?? detail[f.key] ?? ""} onValueChange={(v) => {
                  const p = positions.find((x) => x.id === v);
                  if (p) setMasterField(f, p.id, p.code);
                }}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih posisi", "Select a position")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {positions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-mono text-xs text-slate-400">{p.code}</span> · {p.title}
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
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih unit", "Select a unit")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        <span className="font-mono text-xs text-slate-400">{u.code}</span> · {u.name}
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
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih grade", "Select a grade")} /></SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        <span className="font-mono text-xs text-slate-400">{g.code}</span> · {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.kind === "select-empstatus" && (
                <Select value={detail[f.key] ?? ""} onValueChange={(v) => setField(f.key, v)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih status", "Select a status")} /></SelectTrigger>
                  <SelectContent>
                    {EMP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {f.kind === "select-multiplier" && (
                <Select value={detail[f.key] ?? "1"} onValueChange={(v) => setField(f.key, v)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">×0,5 — {t("pengurangan hak", "waiver")}</SelectItem>
                    <SelectItem value="1">×1 — {t("PHK efisiensi", "efficiency termination")}</SelectItem>
                    <SelectItem value="1.5">×1,5 — {t("tanpa alasan (murah)", "no cause (light)")}</SelectItem>
                    <SelectItem value="2">×2 — {t("tanpa alasan", "no cause")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {f.kind === "check" && (
                <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 dark:border-slate-800">
                  <Checkbox
                    checked={detail[f.key] === (f.checkValue ?? "true")}
                    onCheckedChange={(v) => setField(f.key, v ? (f.checkValue ?? "true") : "")}
                    className="h-4 w-4"
                  />
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {t(f.label, FIELD_LABEL_EN[f.label])}
                  </span>
                </label>
              )}
              {f.kind === "number" && (
                <div className="relative">
                  {f.money && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">Rp</span>}
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
            <Label htmlFor="pa-reason">{t("Alasan / Justifikasi", "Reason / Justification")}</Label>
            <Textarea
              id="pa-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("Contoh: Promosi berdasarkan evaluasi kinerja semester 1/2026…", "Example: Promotion based on the 1/2026 semester performance review…")}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-11 px-5">{t("Batal")}</Button>
          {type === "Termination" && employeeId && detail.lastDay && (
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              disabled={busy}
              className="h-11 gap-2 px-5"
            >
              <Calculator className="h-4 w-4" /> {t("Pratinjau Settlement", "Settlement Preview")}
            </Button>
          )}
          {perms.can("hr", "all", "create") && (
            <Button disabled={missing || busy} onClick={() => void submit()} className="h-11 px-6 font-bold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
              {t("Buat Dokumen Draft", "Create Draft Document")}
            </Button>
          )}
        </DialogFooter>
        <SettlementPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          employeeId={employeeId}
          employeeName={selected?.fullName ?? ""}
          effectiveDate={String(detail.lastDay ?? "")}
          initialParams={{
            pesangonMultiplier: Number(detail.pesangonMultiplier ?? 1),
            uangPisahPct: Number(detail.uangPisahPct ?? 0),
          }}
          reason={t("Pratinjau — PA Pemutusan Hubungan Kerja", "Preview — Termination PA")}
        />
      </DialogContent>
    </Dialog>
  );
}
