"use client";
// OneVity — Settings: Approval STRUKTUR BERJENJANG (Task 25)
// Setup alur persetujuan multi-level per dokumen (Leave/Travel/Medical/Loan):
// - 6 kriteria pencocokan pemohon: kantor, lokasi kerja, unit organisasi, posisi,
//   grade, level jabatan (kosong = semua; struktur paling spesifik menang)
// - editor jenjang berurutan (Atasan Langsung / Atasan Berjenjang / Pemegang
//   Posisi / Karyawan / Admin-HR) + syarat nominal (besaran) untuk
//   Travel/Medical/Loan — jenjang tambahan aktif hanya bila nominal masuk rentang
// - panel simulasi: lihat jalur yang akan terbentuk untuk seorang pemohon.
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Loader2, Layers, GitBranch, ArrowUp, ArrowDown, X,
  Wand2, Building2, MapPin, Network, BriefcaseBusiness, GraduationCap, TrendingUp, CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ================= types =================

const DOC_TYPES = [
  { value: "Leave", label: "Cuti (Leave)" },
  { value: "Travel", label: "Perjalanan Dinas (Travel)" },
  { value: "Medical", label: "Klaim Medis (Medical)" },
  { value: "Loan", label: "Pinjaman Karyawan (Loan)" },
] as const;
const AMOUNT_DOC_TYPES = ["Travel", "Medical", "Loan"];

const APPROVER_TYPES = [
  { value: "ATASAN_LANGSUNG", label: "Atasan Langsung" },
  { value: "ATASAN_BERJENJANG", label: "Atasan Berjenjang (naik N tingkat)" },
  { value: "POSISI", label: "Pemegang Posisi" },
  { value: "KARYAWAN", label: "Karyawan Tertentu" },
  { value: "HR_ADMIN", label: "Admin/HR Workspace" },
] as const;
const APPROVER_TYPE_LABEL: Record<string, string> = Object.fromEntries(APPROVER_TYPES.map((t) => [t.value, t.label]));

const docTypeLabel = (v: string) => DOC_TYPES.find((d) => d.value === v)?.label ?? v;
const isAmountDoc = (v: string) => AMOUNT_DOC_TYPES.includes(v);

interface StructureLevel {
  id: string;
  levelNo: number;
  approverType: string;
  approverPositionId: string | null;
  approverPosition: string | null;
  approverEmployeeId: string | null;
  approverEmployee: string | null;
  superiorLevel: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  note: string | null;
}

interface Structure {
  id: string;
  code: string;
  name: string;
  docType: string;
  active: boolean;
  companyOfficeId: string | null;
  companyOffice: { code: string; name: string } | null;
  workLocationId: string | null;
  workLocation: { code: string; name: string } | null;
  orgUnitId: string | null;
  orgUnit: { code: string; name: string } | null;
  positionId: string | null;
  position: { code: string; title: string } | null;
  gradeId: string | null;
  grade: { code: string; name: string } | null;
  positionLevelId: string | null;
  positionLevel: { code: string; name: string } | null;
  levels: StructureLevel[];
}

interface StructuresResp { structures: Structure[] }

interface OfficesResp { offices: { id: string; code: string; name: string; city: string | null; active: boolean }[] }
interface LocationsResp { locations: { id: string; code: string; name: string; city: string | null; active: boolean; officeId: string | null }[] }
interface LevelsResp { levels: { id: string; code: string; name: string; sortOrder: number; active: boolean }[] }
interface OptionsResp {
  orgUnits: { id: string; name: string; code: string }[];
  positions: { id: string; title: string; code: string; orgUnitId: string | null }[];
  grades: { id: string; code: string; name: string }[];
  managers: { id: string; fullName: string; employeeNo: string; position: { title: string | null } | null }[];
}

interface PreviewStep {
  levelNo: number;
  approverType: string;
  approverLabel: string;
  approverEmployeeId: string | null;
  minAmount: number | null;
  maxAmount: number | null;
}
interface PreviewResp {
  preview: {
    structureId: string | null;
    structureCode: string | null;
    structureName: string | null;
    fallback: boolean;
    steps: PreviewStep[];
  };
}

// ================= level draft (form state) =================

interface LevelDraft {
  approverType: string;
  approverPositionId: string;
  approverEmployeeId: string;
  superiorLevel: string;
  minAmount: string;
  maxAmount: string;
  note: string;
}

const emptyLevel = (): LevelDraft => ({
  approverType: "ATASAN_LANGSUNG",
  approverPositionId: "",
  approverEmployeeId: "",
  superiorLevel: "2",
  minAmount: "",
  maxAmount: "",
  note: "",
});

// =================================================================
export function ApprovalStructureView() {
  const [docFilter, setDocFilter] = useState("all");
  const { data, loading, error, refresh } = useApi<StructuresResp>(`/api/onevity/approval-structures${docFilter !== "all" ? `?docType=${docFilter}` : ""}`);
  const { data: optsOffices } = useApi<OfficesResp>("/api/onevity/company-offices");
  const { data: optsLocations } = useApi<LocationsResp>("/api/onevity/work-locations");
  const { data: optsLevels } = useApi<LevelsResp>("/api/onevity/position-levels");
  const { data: opts } = useApi<OptionsResp>("/api/onevity/employee-options");

  const [editing, setEditing] = useState<Structure | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Structure | null>(null);
  const [simulating, setSimulating] = useState(false);

  const structures = data?.structures ?? [];
  const activeCount = structures.filter((s) => s.active).length;
  const levelCount = structures.reduce((s, x) => s + x.levels.length, 0);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/onevity/approval-structures?id=${deleting.id}`, "DELETE");
      toast.success(`Struktur ${deleting.code} dihapus`);
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error("Gagal menghapus struktur", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-5">
      {/* ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Struktur Aktif", value: activeCount, icon: Layers },
          { label: "Total Jenjang", value: levelCount, icon: GitBranch },
          { label: "Jenis Dokumen", value: 4, icon: FileIcon },
          { label: "Kriteria Dimensi", value: 6, icon: SlidersIcon },
        ].map((c) => (
          <Card key={c.label} className="rounded-2xl border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
                <c.icon className="h-5 w-5 text-stone-600 dark:text-stone-300" />
              </div>
              <div>
                <div className="text-lg font-bold text-stone-900 dark:text-stone-50">{c.value}</div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* filter + aksi */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={docFilter} onValueChange={setDocFilter}>
            <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-stone-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Jenis Dokumen</SelectItem>
              {DOC_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setSimulating(true)} className="h-10 gap-2 rounded-xl">
            <Wand2 className="h-4 w-4" /> Simulasi Jalur
          </Button>
          <Button onClick={() => setCreating(true)} className="h-10 gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800">
            <Plus className="h-4 w-4" /> Struktur Baru
          </Button>
        </div>
      </div>

      {/* daftar struktur */}
      {loading ? <LoadingRows /> : error ? (
        <EmptyState title="Gagal memuat" description={error} icon={CircleAlert} />
      ) : structures.length === 0 ? (
        <EmptyState
          title="Belum ada struktur approval"
          description="Buat struktur berjenjang — dokumen tanpa struktur cocok memakai fallback atasan langsung."
          icon={Layers}
        />
      ) : (
        <div className="space-y-3">
          {structures.map((s) => (
            <StructureCard key={s.id} s={s} onEdit={() => setEditing(s)} onDelete={() => setDeleting(s)} />
          ))}
        </div>
      )}

      {/* dialog create/edit */}
      {(creating || editing) && (
        <StructureFormDialog
          structure={editing}
          offices={optsOffices?.offices ?? []}
          locations={optsLocations?.locations ?? []}
          levels={optsLevels?.levels ?? []}
          orgUnits={opts?.orgUnits ?? []}
          positions={opts?.positions ?? []}
          grades={opts?.grades ?? []}
          employees={opts?.managers ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => { setCreating(false); setEditing(null); refresh(); }}
        />
      )}

      {/* dialog simulasi */}
      {simulating && (
        <SimulateDialog
          employees={opts?.managers ?? []}
          onClose={() => setSimulating(false)}
        />
      )}

      {/* confirm delete */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus struktur {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Struktur &ldquo;{deleting?.name}&rdquo; beserta {deleting?.levels.length ?? 0} jenjang akan dihapus. Pengajuan baru tidak lagi memakai struktur ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-rose-600 hover:bg-rose-700">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const FileIcon = BriefcaseBusiness;
const SlidersIcon = TrendingUp;

// ================= kartu struktur =================

function StructureCard({ s, onEdit, onDelete }: { s: Structure; onEdit: () => void; onDelete: () => void }) {
  const criteria: { label: string; icon: React.ElementType }[] = [];
  if (s.companyOffice) criteria.push({ label: `Kantor: ${s.companyOffice.name}`, icon: Building2 });
  if (s.workLocation) criteria.push({ label: `Lokasi: ${s.workLocation.name}`, icon: MapPin });
  if (s.orgUnit) criteria.push({ label: `Unit: ${s.orgUnit.name}`, icon: Network });
  if (s.position) criteria.push({ label: `Posisi: ${s.position.title}`, icon: BriefcaseBusiness });
  if (s.grade) criteria.push({ label: `Grade: ${s.grade.code} — ${s.grade.name}`, icon: GraduationCap });
  if (s.positionLevel) criteria.push({ label: `Level: ${s.positionLevel.code} — ${s.positionLevel.name}`, icon: TrendingUp });

  return (
    <Card className={cn("rounded-2xl border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900", !s.active && "opacity-60")}>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-stone-100 px-2 py-0.5 font-mono text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{s.code}</span>
              <span className="font-semibold text-stone-900 dark:text-stone-50">{s.name}</span>
              <Badge className="rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-50 dark:bg-teal-950 dark:text-teal-300">{docTypeLabel(s.docType)}</Badge>
              {!s.active && <Badge variant="secondary" className="rounded-lg">Nonaktif</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {criteria.length === 0 ? (
                <Badge variant="outline" className="gap-1 rounded-lg border-stone-300 text-[11px] text-stone-600 dark:border-stone-600 dark:text-stone-300">
                  <SlidersIcon className="h-3 w-3" /> Berlaku untuk semua karyawan
                </Badge>
              ) : criteria.map((c, i) => (
                <Badge key={i} variant="outline" className="gap-1 rounded-lg border-amber-200 bg-amber-50 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <c.icon className="h-3 w-3" /> {c.label}
                </Badge>
              ))}
              {isAmountDoc(s.docType) && s.levels.some((l) => l.minAmount != null || l.maxAmount != null) && (
                <Badge variant="outline" className="rounded-lg border-emerald-200 bg-emerald-50 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Ada jenjang bersyarat nominal
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit} className="h-8 w-8 rounded-lg" aria-label="Ubah">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} className="h-8 w-8 rounded-lg text-rose-600 hover:text-rose-700" aria-label="Hapus">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* jenjang */}
        <div className="mt-4 flex flex-wrap items-stretch gap-2">
          {s.levels.map((l, i) => (
            <div key={l.id} className="flex min-w-0 items-center">
              <div className={cn(
                "flex max-w-64 flex-col gap-0.5 rounded-xl border px-3 py-2",
                l.minAmount != null || l.maxAmount != null
                  ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/40"
                  : "border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/60",
              )}>
                <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Jenjang {l.levelNo}</span>
                <span className="truncate text-xs font-semibold text-stone-800 dark:text-stone-100">
                  {approverTargetLabel(l)}
                </span>
                {(l.minAmount != null || l.maxAmount != null) && (
                  <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    {tierLabel(l.minAmount, l.maxAmount)}
                  </span>
                )}
                {l.note && <span className="truncate text-[10px] text-stone-400">{l.note}</span>}
              </div>
              {i < s.levels.length - 1 && <ArrowDown className="mx-1 h-3.5 w-3.5 rotate-[-90deg] text-stone-300" />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function approverTargetLabel(l: Pick<StructureLevel, "approverType" | "approverPosition" | "approverEmployee" | "superiorLevel">): string {
  switch (l.approverType) {
    case "ATASAN_LANGSUNG": return "Atasan Langsung";
    case "ATASAN_BERJENJANG": return `Atasan naik ${l.superiorLevel ?? 2} tingkat`;
    case "POSISI": return l.approverPosition ?? "Pemegang Posisi";
    case "KARYAWAN": return l.approverEmployee ?? "Karyawan";
    case "HR_ADMIN": return "Admin/HR Workspace";
    default: return l.approverType;
  }
}

function tierLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${fmtIDRShort(min)} – ${fmtIDRShort(max)}`;
  if (min != null) return `≥ ${fmtIDRShort(min)}`;
  if (max != null) return `≤ ${fmtIDRShort(max)}`;
  return "";
}

// ================= form dialog =================

interface StructureFormDialogProps {
  structure: Structure | null;
  offices: { id: string; code: string; name: string; city: string | null; active: boolean }[];
  locations: { id: string; code: string; name: string; city: string | null; active: boolean; officeId: string | null }[];
  levels: { id: string; code: string; name: string; sortOrder: number; active: boolean }[];
  orgUnits: { id: string; name: string; code: string }[];
  positions: { id: string; title: string; code: string; orgUnitId: string | null }[];
  grades: { id: string; code: string; name: string }[];
  employees: { id: string; fullName: string; employeeNo: string; position: { title: string | null } | null }[];
  onClose: () => void;
  onDone: () => void;
}

function StructureFormDialog(p: StructureFormDialogProps) {
  const s = p.structure;
  const [form, setForm] = useState({
    code: s?.code ?? "",
    name: s?.name ?? "",
    docType: s?.docType ?? "Leave",
    active: s?.active ?? true,
    companyOfficeId: s?.companyOfficeId ?? "",
    workLocationId: s?.workLocationId ?? "",
    orgUnitId: s?.orgUnitId ?? "",
    positionId: s?.positionId ?? "",
    gradeId: s?.gradeId ?? "",
    positionLevelId: s?.positionLevelId ?? "",
  });
  const [levelDrafts, setLevelDrafts] = useState<LevelDraft[]>(() =>
    s && s.levels.length > 0
      ? s.levels.map((l) => ({
          approverType: l.approverType,
          approverPositionId: l.approverPositionId ?? "",
          approverEmployeeId: l.approverEmployeeId ?? "",
          superiorLevel: String(l.superiorLevel ?? 2),
          minAmount: l.minAmount != null ? String(l.minAmount) : "",
          maxAmount: l.maxAmount != null ? String(l.maxAmount) : "",
          note: l.note ?? "",
        }))
      : [emptyLevel()],
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLevel = (i: number, patch: Partial<LevelDraft>) =>
    setLevelDrafts((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const moveLevel = (i: number, dir: -1 | 1) =>
    setLevelDrafts((ls) => {
      const j = i + dir;
      if (j < 0 || j >= ls.length) return ls;
      const copy = [...ls];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const amountDoc = isAmountDoc(form.docType);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Kode & nama struktur wajib diisi");
      return;
    }
    for (let i = 0; i < levelDrafts.length; i++) {
      const l = levelDrafts[i];
      if (l.approverType === "POSISI" && !l.approverPositionId) {
        toast.error(`Jenjang ${i + 1}: pilih posisi approver`);
        return;
      }
      if (l.approverType === "KARYAWAN" && !l.approverEmployeeId) {
        toast.error(`Jenjang ${i + 1}: pilih karyawan approver`);
        return;
      }
      if (l.approverType === "ATASAN_BERJENJANG" && Number(l.superiorLevel) < 1) {
        toast.error(`Jenjang ${i + 1}: tingkat atasan minimal 1`);
        return;
      }
    }
    const body = {
      code: form.code.trim(),
      name: form.name.trim(),
      docType: form.docType,
      active: form.active,
      companyOfficeId: form.companyOfficeId || null,
      workLocationId: form.workLocationId || null,
      orgUnitId: form.orgUnitId || null,
      positionId: form.positionId || null,
      gradeId: form.gradeId || null,
      positionLevelId: form.positionLevelId || null,
      levels: levelDrafts.map((l, i) => ({
        levelNo: i + 1,
        approverType: l.approverType,
        approverPositionId: l.approverType === "POSISI" ? l.approverPositionId || null : null,
        approverEmployeeId: l.approverType === "KARYAWAN" ? l.approverEmployeeId || null : null,
        superiorLevel: l.approverType === "ATASAN_BERJENJANG" ? Number(l.superiorLevel || 2) : null,
        minAmount: amountDoc && l.minAmount ? Number(l.minAmount) : null,
        maxAmount: amountDoc && l.maxAmount ? Number(l.maxAmount) : null,
        note: l.note || null,
      })),
    };
    setSaving(true);
    try {
      if (s) {
        await apiSend(`/api/onevity/approval-structures?id=${s.id}`, "PATCH", body);
        toast.success(`Struktur ${body.code} diperbarui`);
      } else {
        await apiSend("/api/onevity/approval-structures", "POST", body);
        toast.success(`Struktur ${body.code} dibuat — ${levelDrafts.length} jenjang`);
      }
      p.onDone();
    } catch (e) {
      toast.error("Gagal menyimpan struktur", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const criteriaSelect = (
    label: string,
    icon: React.ElementType,
    field: "companyOfficeId" | "workLocationId" | "orgUnitId" | "positionId" | "gradeId" | "positionLevelId",
    items: { id: string; label: string }[],
  ) => {
    const Icon = icon;
    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
          <Icon className="h-3.5 w-3.5" /> {label}
        </Label>
        <Select value={form[field] || "all"} onValueChange={(v) => set(field, v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue placeholder="Semua" /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all"><span className="text-stone-500">Semua (tanpa batasan)</span></SelectItem>
            {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{s ? `Ubah Struktur ${s.code}` : "Struktur Approval Berjenjang Baru"}</DialogTitle>
          <DialogDescription>
            Struktur dicocokkan ke pemohon berdasarkan parameter penempatannya — isi kriteria agar hanya berlaku bagi kelompok tertentu. Bila beberapa struktur cocok, yang paling spesifik (kriteria terbanyak) dipakai.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* informasi umum */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Kode Struktur</Label>
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="AS-LEAVE-STD" disabled={!!s} className="h-9 rounded-lg font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Struktur</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Persetujuan Cuti Standar" className="h-9 rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Jenis Dokumen</Label>
              <Select
                value={form.docType}
                onValueChange={(v) => {
                  set("docType", v);
                  if (!isAmountDoc(v)) setLevelDrafts((ls) => ls.map((l) => ({ ...l, minAmount: "", maxAmount: "" })));
                }}
                disabled={!!s}
              >
                <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-2.5 dark:border-stone-700">
              <div>
                <Label className="text-xs">Struktur Aktif</Label>
                <p className="text-[11px] text-stone-500">Nonaktif = pengajuan baru memakai struktur lain / fallback</p>
              </div>
              <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </div>
          </div>

          {/* kriteria */}
          <div className="rounded-2xl border border-stone-200 p-4 dark:border-stone-700">
            <div className="mb-3 flex items-center gap-2">
              <SlidersIcon className="h-4 w-4 text-stone-500" />
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">Berlaku Untuk (Kriteria Pemohon)</span>
              <Badge variant="outline" className="rounded-lg text-[10px] text-stone-500">kosongkan = semua</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {criteriaSelect("Company Office", Building2, "companyOfficeId", p.offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })))}
              {criteriaSelect("Lokasi Kerja", MapPin, "workLocationId", p.locations.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })))}
              {criteriaSelect("Unit Organisasi", Network, "orgUnitId", p.orgUnits.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })))}
              {criteriaSelect("Posisi", BriefcaseBusiness, "positionId", p.positions.map((o) => ({ id: o.id, label: `${o.code} — ${o.title}` })))}
              {criteriaSelect("Employee Grade", GraduationCap, "gradeId", p.grades.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })))}
              {criteriaSelect("Level Jabatan", TrendingUp, "positionLevelId", p.levels.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })))}
            </div>
          </div>

          {/* jenjang */}
          <div className="rounded-2xl border border-stone-200 p-4 dark:border-stone-700">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-stone-500" />
                <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">Jenjang Persetujuan (berurutan)</span>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setLevelDrafts((ls) => [...ls, emptyLevel()])} className="h-8 gap-1.5 rounded-lg">
                <Plus className="h-3.5 w-3.5" /> Jenjang
              </Button>
            </div>
            {amountDoc && (
              <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Jenis dokumen bernilai uang — jenjang dapat dibatasi nominal <b>besaran benefit / jumlah pinjaman</b>. Isi &ldquo;min&rdquo; (mis. 10.000.000) agar jenjang tambahan aktif hanya bila nominal ≥ nilai tsb.
              </p>
            )}
            <div className="space-y-2.5">
              {levelDrafts.map((l, i) => (
                <div key={i} className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-[11px] font-bold text-white dark:bg-stone-200 dark:text-stone-900">{i + 1}</span>
                    <div className="w-56">
                      <Select value={l.approverType} onValueChange={(v) => setLevel(i, { approverType: v })}>
                        <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {APPROVER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="ml-auto flex gap-0.5">
                      <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => moveLevel(i, -1)} className="h-7 w-7 rounded-lg" aria-label="Naik"><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" disabled={i === levelDrafts.length - 1} onClick={() => moveLevel(i, 1)} className="h-7 w-7 rounded-lg" aria-label="Turun"><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" disabled={levelDrafts.length === 1} onClick={() => setLevelDrafts((ls) => ls.filter((_, idx) => idx !== i))} className="h-7 w-7 rounded-lg text-rose-600" aria-label="Hapus jenjang"><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {l.approverType === "POSISI" && (
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-[11px] text-stone-500">Posisi Approver</Label>
                        <Select value={l.approverPositionId || "none"} onValueChange={(v) => setLevel(i, { approverPositionId: v === "none" ? "" : v })}>
                          <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue placeholder="Pilih posisi" /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="none">— pilih —</SelectItem>
                            {p.positions.map((o) => <SelectItem key={o.id} value={o.id}>{o.code} — {o.title}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {l.approverType === "KARYAWAN" && (
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-[11px] text-stone-500">Karyawan Approver</Label>
                        <Select value={l.approverEmployeeId || "none"} onValueChange={(v) => setLevel(i, { approverEmployeeId: v === "none" ? "" : v })}>
                          <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="none">— pilih —</SelectItem>
                            {p.employees.map((o) => <SelectItem key={o.id} value={o.id}>{o.employeeNo} — {o.fullName}{o.position?.title ? ` (${o.position.title})` : ""}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {l.approverType === "ATASAN_BERJENJANG" && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-stone-500">Naik berapa tingkat dari pemohon</Label>
                        <Input type="number" min={1} value={l.superiorLevel} onChange={(e) => setLevel(i, { superiorLevel: e.target.value })} className="h-9 rounded-lg" />
                      </div>
                    )}
                    {amountDoc && (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-stone-500">Nominal Minimum (opsional)</Label>
                          <Input type="number" min={0} placeholder="mis. 10000000" value={l.minAmount} onChange={(e) => setLevel(i, { minAmount: e.target.value })} className="h-9 rounded-lg" />
                          {l.minAmount && <p className="text-[10px] text-stone-400">{fmtIDR(Number(l.minAmount))}</p>}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-stone-500">Nominal Maksimum (opsional)</Label>
                          <Input type="number" min={0} placeholder="kosong = tanpa batas" value={l.maxAmount} onChange={(e) => setLevel(i, { maxAmount: e.target.value })} className="h-9 rounded-lg" />
                          {l.maxAmount && <p className="text-[10px] text-stone-400">{fmtIDR(Number(l.maxAmount))}</p>}
                        </div>
                      </>
                    )}
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-[11px] text-stone-500">Catatan (opsional)</Label>
                      <Textarea rows={1} value={l.note} onChange={(e) => setLevel(i, { note: e.target.value })} placeholder="mis. ≥ Rp 10 jt: HR Manager" className="min-h-0 rounded-lg py-1.5 text-xs" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={p.onClose} className="rounded-xl">Batal</Button>
          <Button onClick={submit} disabled={saving} className="gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {s ? "Simpan Perubahan" : "Buat Struktur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= simulasi =================

function SimulateDialog({ employees, onClose }: { employees: { id: string; fullName: string; employeeNo: string; position: { title: string | null } | null }[]; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [docType, setDocType] = useState("Loan");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<PreviewResp["preview"] | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!employeeId) {
      toast.error("Pilih karyawan pemohon dulu");
      return;
    }
    setLoading(true);
    setPreview(null);
    try {
      const qs = new URLSearchParams({ action: "preview", employeeId, docType });
      if (amount) qs.set("amount", amount);
      const res = await apiSend(`/api/onevity/approval-structures?${qs.toString()}`, "GET");
      setPreview((res as PreviewResp).preview);
    } catch (e) {
      toast.error("Simulasi gagal", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const amountDoc = isAmountDoc(docType);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-emerald-700" /> Simulasi Jalur Persetujuan</DialogTitle>
          <DialogDescription>
            Lihat struktur mana yang cocok untuk seorang pemohon dan jenjang siapa saja yang akan menunggu keputusan — tanpa mengajukan dokumen.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Karyawan Pemohon</Label>
            <Select value={employeeId || "none"} onValueChange={(v) => setEmployeeId(v === "none" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">— pilih —</SelectItem>
                {employees.map((o) => <SelectItem key={o.id} value={o.id}>{o.employeeNo} — {o.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Jenis Dokumen</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-9 rounded-lg bg-white dark:bg-stone-900"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nominal {amountDoc ? "(besaran / jumlah)" : "(tidak dipakai)"}</Label>
            <Input type="number" min={0} placeholder="mis. 25000000" value={amount} disabled={!amountDoc} onChange={(e) => setAmount(e.target.value)} className="h-9 rounded-lg" />
            {amount && amountDoc && <p className="text-[10px] text-stone-400">{fmtIDR(Number(amount))}</p>}
          </div>
        </div>

        <Button onClick={run} disabled={loading} className="w-full gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Simulasikan
        </Button>

        {preview && (
          <div className="space-y-2 rounded-2xl border border-stone-200 p-4 dark:border-stone-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Struktur Cocok</span>
              {preview.fallback ? (
                <Badge className="rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Fallback — atasan langsung / Admin-HR</Badge>
              ) : (
                <Badge className="rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">{preview.structureCode} — {preview.structureName}</Badge>
              )}
            </div>
            <div className="space-y-1.5">
              {preview.steps.map((st, i) => (
                <div key={i} className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2",
                  st.minAmount != null || st.maxAmount != null
                    ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/40"
                    : "border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/60",
                )}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-[11px] font-bold text-white dark:bg-stone-200 dark:text-stone-900">{st.levelNo}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-stone-800 dark:text-stone-100">{st.approverLabel}</div>
                    <div className="text-[10px] text-stone-400">{APPROVER_TYPE_LABEL[st.approverType] ?? st.approverType}</div>
                  </div>
                  {(st.minAmount != null || st.maxAmount != null) && (
                    <Badge variant="outline" className="shrink-0 rounded-lg border-emerald-200 text-[10px] text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">
                      {tierLabel(st.minAmount, st.maxAmount)}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-stone-500">
              {preview.steps.length} jenjang akan menunggu keputusan secara berurutan — pengajuan berpindah ke jenjang berikutnya setiap persetujuan.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
