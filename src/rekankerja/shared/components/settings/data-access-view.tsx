"use client";
// RekanKerja — Settings: SKEMA AKSES DATA (Task 30)
// Hak akses data karyawan berbasis parameter — selaras pola Approval
// Struktur Berjenjang:
// - rule per subjek (ROLE | USER | ACCESS_GROUP) dengan 7 kriteria sasaran:
//   kantor, lokasi kerja, unit organisasi, posisi, grade, level jabatan,
//   status kerja (AND; kosong semua = akses penuh)
// - akses otomatis TANPA setting: super admin (role Admin / workspace
//   OWNER|ADMIN) akses semua, atasan langsung akses bawahan aktif, dan
//   setiap user akses data dirinya
// - panel simulasi: lihat cakupan efektif seorang pengguna (sumber akses,
//   jumlah karyawan yang terlihat, contoh).
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Loader2, ShieldCheck, SlidersHorizontal, Wand2, CircleAlert, Building2, MapPin,
  Network, BriefcaseBusiness, GraduationCap, TrendingUp, UserCog, Users, Crown, UserCheck, UserRound, BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ================= types =================

interface Rule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  subjectType: string; // ROLE | USER | ACCESS_GROUP
  role: string | null;
  appUserId: string | null;
  appUser: { username: string; fullName: string; role: string } | null;
  accessGroupId: string | null;
  accessGroup: { code: string; name: string } | null;
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
  employmentStatus: string | null;
  priority: number;
  active: boolean;
}

interface RulesResp {
  rules: Rule[];
  users: { id: string; username: string; fullName: string; role: string; active: boolean }[];
  groups: { id: string; code: string; name: string }[];
  roles: string[];
  employmentStatuses: string[];
  references: {
    offices: { id: string; code: string; name: string; city: string | null }[];
    locations: { id: string; code: string; name: string; city: string | null }[];
    units: { id: string; code: string; name: string }[];
    positions: { id: string; code: string; title: string }[];
    grades: { id: string; code: string; name: string }[];
    levels: { id: string; code: string; name: string }[];
  };
}

interface PreviewResp {
  preview: {
    user: { id: string; username: string; fullName: string; role: string };
    platformRole: string | null;
    all: boolean;
    sources: string[];
    subordinateCount: number;
    filterCount: number;
    accessibleCount: number;
    sample: { id: string; employeeNo: string; fullName: string }[];
  };
}

const SUBJECT_TYPES = [
  { value: "ROLE", label: "Role" },
  { value: "USER", label: "Pengguna" },
  { value: "ACCESS_GROUP", label: "Access Group" },
] as const;

const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  Permanent: "Tetap", Contract: "Kontrak", Probation: "Percobaan", Outsourcing: "Outsourcing",
};

function subjectLabel(r: Rule): string {
  if (r.subjectType === "ROLE") return `Role: ${r.role}`;
  if (r.subjectType === "USER") return r.appUser ? `${r.appUser.fullName} (${r.appUser.username})` : "—";
  return r.accessGroup ? `${r.accessGroup.name} (${r.accessGroup.code})` : "—";
}

// =================================================================
export function DataAccessView() {
  const { data, loading, error, refresh } = useApi<RulesResp>("/api/rekankerja/data-access-rules");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const rules = (data?.rules ?? []).filter((r) => subjectFilter === "all" || r.subjectType === subjectFilter);
  const activeCount = (data?.rules ?? []).filter((r) => r.active).length;
  const criteriaCount = (data?.rules ?? []).reduce((n, r) => n + (r.companyOfficeId || r.workLocationId || r.orgUnitId || r.positionId || r.gradeId || r.positionLevelId || r.employmentStatus ? 1 : 0), 0);

  const toggleActive = async (r: Rule, active: boolean) => {
    setToggling(r.id);
    try {
      await apiSend(`/api/rekankerja/data-access-rules?id=${r.id}`, "PATCH", { active });
      toast.success(`Rule ${r.code} ${active ? "diaktifkan" : "dinonaktifkan"}`);
      refresh();
    } catch (e) {
      toast.error("Gagal mengubah status rule", { description: (e as Error).message });
    } finally {
      setToggling(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/data-access-rules?id=${deleting.id}`, "DELETE");
      toast.success(`Rule ${deleting.code} dihapus`);
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error("Gagal menghapus rule", { description: (e as Error).message });
    }
  };

  return (
    <div className="space-y-5">
      {/* ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Rule Aktif", value: activeCount, icon: ShieldCheck },
          { label: "Rule Parameter", value: criteriaCount, icon: SlidersHorizontal },
          { label: "Dimensi Kriteria", value: 7, icon: Network },
          { label: "Akses Otomatis", value: 3, icon: Crown },
        ].map((c) => (
          <Card key={c.label} className="rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                <c.icon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              </div>
              <div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-50">{c.value}</div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* catatan akses otomatis — berlaku tanpa perlu di-setting */}
      <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-teal-50/40 p-4 dark:border-emerald-500/25 dark:from-emerald-500/10 dark:to-teal-500/5">
        <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-800 dark:text-emerald-300">
          <Crown className="h-4 w-4" /> Akses otomatis — tanpa perlu diatur di menu ini
        </p>
        <div className="mt-2.5 grid gap-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 sm:grid-cols-3">
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <Crown className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span><b>Super Admin</b> (role Admin / workspace OWNER &amp; ADMIN) mengakses semua data karyawan.</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span><b>Atasan langsung</b> otomatis mengakses data seluruh bawahannya.</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
            <span><b>Setiap pengguna</b> selalu dapat mengakses data dirinya sendiri.</span>
          </span>
        </div>
      </div>

      {/* filter + aksi */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Subjek</SelectItem>
              {SUBJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setSimulating(true)} className="h-10 gap-2 rounded-xl">
            <Wand2 className="h-4 w-4" /> Simulasi Akses
          </Button>
          <Button onClick={() => setCreating(true)} className="h-10 gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800">
            <Plus className="h-4 w-4" /> Rule Baru
          </Button>
        </div>
      </div>

      {/* daftar rule */}
      {loading ? <LoadingRows /> : error ? (
        <EmptyState title="Gagal memuat" description={error} icon={CircleAlert} />
      ) : rules.length === 0 ? (
        <EmptyState
          title="Belum ada rule skema akses"
          description="Buat rule parametrik — tanpa rule, pengguna hanya mengakses data diri, bawahannya (atasan langsung), atau semua data (super admin)."
          icon={ShieldCheck}
        />
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <RuleCard key={r.id} r={r} busy={toggling === r.id} onToggle={(v) => toggleActive(r, v)} onEdit={() => setEditing(r)} onDelete={() => setDeleting(r)} />
          ))}
        </div>
      )}

      {/* dialog create/edit */}
      {(creating || editing) && (
        <RuleFormDialog
          rule={editing}
          resp={data}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => { setCreating(false); setEditing(null); refresh(); }}
        />
      )}

      {/* dialog simulasi */}
      {simulating && data && (
        <SimulateDialog users={data.users} onClose={() => setSimulating(false)} />
      )}

      {/* confirm delete */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus rule {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Rule &ldquo;{deleting?.name}&rdquo; akan dihapus. Subjeknya kembali hanya memiliki akses otomatis (diri sendiri, bawahan langsung, atau semua bila super admin).
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

// ================= kartu rule =================

function RuleCard({ r, busy, onToggle, onEdit, onDelete }: {
  r: Rule; busy: boolean;
  onToggle: (v: boolean) => void; onEdit: () => void; onDelete: () => void;
}) {
  const criteria: { label: string; icon: React.ElementType }[] = [];
  if (r.companyOffice) criteria.push({ label: `Kantor: ${r.companyOffice.name}`, icon: Building2 });
  if (r.workLocation) criteria.push({ label: `Lokasi: ${r.workLocation.name}`, icon: MapPin });
  if (r.orgUnit) criteria.push({ label: `Unit: ${r.orgUnit.name}`, icon: Network });
  if (r.position) criteria.push({ label: `Posisi: ${r.position.title}`, icon: BriefcaseBusiness });
  if (r.grade) criteria.push({ label: `Grade: ${r.grade.code} — ${r.grade.name}`, icon: GraduationCap });
  if (r.positionLevel) criteria.push({ label: `Level: ${r.positionLevel.code} — ${r.positionLevel.name}`, icon: TrendingUp });
  if (r.employmentStatus) criteria.push({ label: `Status: ${EMPLOYMENT_STATUS_LABEL[r.employmentStatus] ?? r.employmentStatus}`, icon: BadgeCheck });

  return (
    <Card className={cn("rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900", !r.active && "opacity-60")}>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.code}</span>
              <span className="font-semibold text-slate-900 dark:text-slate-50">{r.name}</span>
              <Badge className="rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-50 dark:bg-teal-950 dark:text-teal-300">{subjectLabel(r)}</Badge>
              {!r.active && <Badge variant="secondary" className="rounded-lg">Nonaktif</Badge>}
            </div>
            {r.description && <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">{r.description}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {criteria.length === 0 ? (
                <Badge variant="outline" className="gap-1 rounded-lg border-emerald-200 bg-emerald-50 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" /> Akses penuh — semua karyawan (tanpa kriteria)
                </Badge>
              ) : criteria.map((c, i) => (
                <Badge key={i} variant="outline" className="gap-1 rounded-lg border-amber-200 bg-amber-50 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <c.icon className="h-3 w-3" /> {c.label}
                </Badge>
              ))}
              <Badge variant="outline" className="rounded-lg border-slate-300 text-[10px] text-slate-400 dark:border-slate-600">
                prioritas {r.priority}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={r.active} disabled={busy} onCheckedChange={onToggle} aria-label="Aktifkan rule" />
            <Button size="icon" variant="ghost" onClick={onEdit} className="h-8 w-8 rounded-lg" aria-label="Ubah">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} className="h-8 w-8 rounded-lg text-rose-600 hover:text-rose-700" aria-label="Hapus">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ================= dialog form =================

interface Draft {
  code: string;
  name: string;
  description: string;
  subjectType: string;
  role: string;
  appUserId: string;
  accessGroupId: string;
  companyOfficeId: string;
  workLocationId: string;
  orgUnitId: string;
  positionId: string;
  gradeId: string;
  positionLevelId: string;
  employmentStatus: string;
  priority: string;
  active: boolean;
}

function draftFrom(r: Rule | null): Draft {
  return {
    code: r?.code ?? "",
    name: r?.name ?? "",
    description: r?.description ?? "",
    subjectType: r?.subjectType ?? "ROLE",
    role: r?.role ?? "",
    appUserId: r?.appUserId ?? "",
    accessGroupId: r?.accessGroupId ?? "",
    companyOfficeId: r?.companyOfficeId ?? "",
    workLocationId: r?.workLocationId ?? "",
    orgUnitId: r?.orgUnitId ?? "",
    positionId: r?.positionId ?? "",
    gradeId: r?.gradeId ?? "",
    positionLevelId: r?.positionLevelId ?? "",
    employmentStatus: r?.employmentStatus ?? "",
    priority: String(r?.priority ?? 100),
    active: r?.active ?? true,
  };
}

const anyCriteria = (d: Draft) =>
  !!(d.companyOfficeId || d.workLocationId || d.orgUnitId || d.positionId || d.gradeId || d.positionLevelId || d.employmentStatus);

function RuleFormDialog({ rule, resp, onClose, onDone }: { rule: Rule | null; resp: RulesResp | null; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<Draft>(draftFrom(rule));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));

  const save = async () => {
    if (!d.code.trim() || !d.name.trim()) { toast.error("Kode & nama rule wajib diisi"); return; }
    if (d.subjectType === "ROLE" && !d.role) { toast.error("Pilih role subjek"); return; }
    if (d.subjectType === "USER" && !d.appUserId) { toast.error("Pilih pengguna subjek"); return; }
    if (d.subjectType === "ACCESS_GROUP" && !d.accessGroupId) { toast.error("Pilih access group subjek"); return; }
    setSaving(true);
    try {
      const body = {
        ...d,
        priority: d.priority === "" ? 100 : Number(d.priority),
        companyOfficeId: d.companyOfficeId || null,
        workLocationId: d.workLocationId || null,
        orgUnitId: d.orgUnitId || null,
        positionId: d.positionId || null,
        gradeId: d.gradeId || null,
        positionLevelId: d.positionLevelId || null,
        employmentStatus: d.employmentStatus || null,
      };
      await apiSend(rule ? `/api/rekankerja/data-access-rules?id=${rule.id}` : "/api/rekankerja/data-access-rules", rule ? "PATCH" : "POST", body);
      toast.success(rule ? `Rule ${d.code} diperbarui` : `Rule ${d.code} dibuat`);
      onDone();
    } catch (e) {
      toast.error("Gagal menyimpan rule", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const refs = resp?.references;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? `Ubah Rule ${rule.code}` : "Rule Skema Akses Baru"}</DialogTitle>
          <DialogDescription>
            Subjek berhak mengakses karyawan yang penempatannya cocok dengan kriteria (semua terpilih = AND). Kosongkan semua kriteria untuk akses penuh.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-code">Kode</Label>
              <Input id="ra-code" value={d.code} onChange={(e) => set({ code: e.target.value })} placeholder="ACC-PROD-OPS" className="rounded-xl" disabled={!!rule} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ra-name">Nama Rule</Label>
              <Input id="ra-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Operasional Produksi — Kantu Surabaya" className="rounded-xl" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subjek — pemegang hak akses</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={d.subjectType} onValueChange={(v) => set({ subjectType: v, role: "", appUserId: "", accessGroupId: "" })}>
                <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {d.subjectType === "ROLE" && (
                <Select value={d.role} onValueChange={(v) => set({ role: v })}>
                  <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue placeholder="Pilih role" /></SelectTrigger>
                  <SelectContent>
                    {(resp?.roles ?? []).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {d.subjectType === "USER" && (
                <Select value={d.appUserId} onValueChange={(v) => set({ appUserId: v })}>
                  <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue placeholder="Pilih pengguna" /></SelectTrigger>
                  <SelectContent>
                    {(resp?.users ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.username} · {u.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {d.subjectType === "ACCESS_GROUP" && (
                <Select value={d.accessGroupId} onValueChange={(v) => set({ accessGroupId: v })}>
                  <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue placeholder="Pilih access group" /></SelectTrigger>
                  <SelectContent>
                    {(resp?.groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({g.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
              <SlidersHorizontal className="h-4 w-4 text-emerald-600" /> Kriteria sasaran — karyawan yang dapat diakses
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                { key: "companyOfficeId" as const, label: "Kantor", items: (refs?.offices ?? []).map((o) => ({ value: o.id, label: `${o.name}${o.city ? ` — ${o.city}` : ""}` })) },
                { key: "workLocationId" as const, label: "Lokasi Kerja", items: (refs?.locations ?? []).map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` — ${l.city}` : ""}` })) },
                { key: "orgUnitId" as const, label: "Unit Organisasi", items: (refs?.units ?? []).map((u) => ({ value: u.id, label: u.name })) },
                { key: "positionId" as const, label: "Posisi", items: (refs?.positions ?? []).map((p) => ({ value: p.id, label: p.title })) },
                { key: "gradeId" as const, label: "Grade", items: (refs?.grades ?? []).map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` })) },
                { key: "positionLevelId" as const, label: "Level Jabatan", items: (refs?.levels ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })) },
                { key: "employmentStatus" as const, label: "Status Kerja", items: (resp?.employmentStatuses ?? []).map((s) => ({ value: s, label: EMPLOYMENT_STATUS_LABEL[s] ?? s })) },
              ]).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{f.label}</Label>
                  <Select value={d[f.key] || "__all"} onValueChange={(v) => set({ [f.key]: v === "__all" ? "" : v } as Partial<Draft>)}>
                    <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Semua (tanpa filter)</SelectItem>
                      {f.items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {!anyCriteria(d) && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Tanpa kriteria apa pun, rule ini memberi <b>akses penuh</b> ke seluruh data karyawan bagi subjeknya.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-priority">Prioritas (urutan evaluasi)</Label>
              <Input id="ra-priority" type="number" value={d.priority} onChange={(e) => set({ priority: e.target.value })} className="rounded-xl" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={d.active} onCheckedChange={(v) => set({ active: v })} id="ra-active" />
              <Label htmlFor="ra-active">Rule aktif</Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ra-desc">Deskripsi (opsional)</Label>
            <Textarea id="ra-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="rounded-xl" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-10 rounded-xl">Batal</Button>
          <Button onClick={save} disabled={saving} className="h-10 gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Simpan Rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= dialog simulasi =================

function SimulateDialog({ users, onClose }: { users: RulesResp["users"]; onClose: () => void }) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const { data, loading, error } = useApi<PreviewResp>(userId ? `/api/rekankerja/data-access-rules?action=preview&userId=${encodeURIComponent(userId)}` : null, [userId]);
  const p = data?.preview;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-emerald-600" /> Simulasi Akses Efektif</DialogTitle>
          <DialogDescription>
            Coba skema akses untuk seorang pengguna — menggabungkan akses otomatis (super admin, atasan langsung, diri sendiri) dengan rule parametrik.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pengguna</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue placeholder="Pilih pengguna" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.username} · {u.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading && <LoadingRows rows={3} />}
          {error && <EmptyState title="Gagal simulasi" description={error} icon={CircleAlert} />}
          {p && (
            <div className="space-y-3">
              <div className={cn(
                "flex items-center gap-3 rounded-2xl border px-4 py-3",
                p.all
                  ? "border-amber-200 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10"
                  : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/10",
              )}>
                {p.all ? <Crown className="h-5 w-5 text-amber-500" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-50">
                    {p.all ? "Akses penuh — seluruh data karyawan" : `${p.accessibleCount} karyawan dapat diakses`}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {p.all ? "Semua karyawan terlihat di direktori & detail." : "Hanya karyawan dalam cakupan ini yang terlihat di direktori & detail."}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <Network className="h-3.5 w-3.5" /> Sumber akses
                </p>
                <div className="max-h-44 space-y-1.5 overflow-y-auto">
                  {p.sources.length === 0 && (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                      Tidak ada akses — pengguna ini tidak dapat melihat data karyawan lain (hanya dirinya, tanpa bawahan/rule).
                    </p>
                  )}
                  {p.sources.map((s, i) => (
                    <p key={i} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                      <UserCog className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> {s}
                    </p>
                  ))}
                </div>
              </div>

              {p.subordinateCount > 0 && (
                <p className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs font-medium text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300">
                  <Users className="h-3.5 w-3.5" /> {p.subordinateCount} bawahan langsung aktif — otomatis dapat diakses.
                </p>
              )}

              {!p.all && p.sample.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Contoh karyawan dalam cakupan</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.sample.map((e) => (
                      <Badge key={e.id} variant="outline" className="rounded-lg border-slate-200 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        {e.fullName} · {e.employeeNo}
                      </Badge>
                    ))}
                    {p.accessibleCount > p.sample.length && (
                      <Badge variant="outline" className="rounded-lg border-slate-200 text-[11px] text-slate-400 dark:border-slate-700">
                        +{p.accessibleCount - p.sample.length} lainnya
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-10 rounded-xl">Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
