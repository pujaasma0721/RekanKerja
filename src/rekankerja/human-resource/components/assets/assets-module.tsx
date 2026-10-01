"use client";
// RekanKerja — Modul Aset Karyawan (Task 27-b) ==============================
// =====================================================================
// Inventaris aset perusahaan + penugasan ke karyawan + pengembalian dgn
// kondisi (Baik/Rusak/Hilang) — nilai perolehan & lokasi ikut tercatat.
//   · Tab INVENTARIS: tabel aset (kode, nama+serial, kategori, nilai, lokasi,
//     status, pemegang aktif) + dialog buat/ubah + hapus (tanpa penugasan);
//   · Tab PENUGASAN: riwayat tugaskan/kembalikan + dialog pengembalian dgn
//     kondisi → status aset otomatis (Baik→Tersedia, Rusak→Perbaikan,
//     Hilang→Hilang).
// Aksi digerbang hak menu hr:assets (create/update/delete + op assign/return).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Boxes, Package, PackageCheck, UserRoundCheck, Pencil, Plus, Search, Trash2,
  Banknote, ClipboardList, Loader2, AlertTriangle, CalendarClock, Wrench,
  PackageOpen, Archive, CircleHelp,
} from "lucide-react";
import { useApi, apiSend, fmtIDR, fmtDate, initials, avatarColor } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CATEGORIES = ["Elektronik", "Kendaraan", "Seragam", "Alat Kerja", "Furniture", "Lainnya"] as const;
const STATUSES = ["Available", "Assigned", "Maintenance", "Retired", "Lost"] as const;
const CONDITIONS: { key: string; label: string; en: string }[] = [
  { key: "Good", label: "Baik", en: "Good" },
  { key: "Damaged", label: "Rusak", en: "Damaged" },
  { key: "Lost", label: "Hilang", en: "Lost" },
];

// ================= TIPE DATA =================
interface AssetRow {
  id: string; code: string; name: string; category: string; serialNumber: string | null;
  notes: string | null; purchaseDate: string | null; value: number | null; status: string;
  location: string | null; createdAt: string; updatedAt: string;
  holder: {
    assignmentId: string; assignedAt: string; dueAt: string | null;
    employee: { id: string; employeeNo: string; fullName: string };
  } | null;
}
interface AssetsData {
  assets: AssetRow[];
  stats: { total: number; assigned: number; available: number; totalValue: number };
}
interface AssignmentRow {
  id: string; assetId: string; employeeId: string;
  assignedAt: string; dueAt: string | null; returnedAt: string | null;
  returnCondition: string | null; notes: string | null;
  asset: { id: string; code: string; name: string; category: string; serialNumber: string | null; status: string; value: number | null };
  employee: { id: string; employeeNo: string; fullName: string; photoUrl: string | null };
}
interface EmployeeOption { id: string; employeeNo: string; fullName: string }

// ================= STATUS PILL LOKAL (status aset) =================
const ASSET_STATUS: Record<string, { label: string; en: string; cls: string; dot: string }> = {
  Available: {
    label: "Tersedia", en: "Available",
    cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
    dot: "bg-brand",
  },
  Assigned: {
    label: "Ditugaskan", en: "Assigned",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    dot: "bg-amber-500",
  },
  Maintenance: {
    label: "Perbaikan", en: "Maintenance",
    cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
    dot: "bg-brand",
  },
  Retired: {
    label: "Dipensiunkan", en: "Retired",
    cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    dot: "bg-slate-400",
  },
  Lost: {
    label: "Hilang", en: "Lost",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    dot: "bg-rose-500",
  },
};
function AssetStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const s = ASSET_STATUS[status] ?? {
    label: status, en: status,
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    dot: "bg-slate-400",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(s.label, s.en)}
    </span>
  );
}

/** Chip kategori — ikon ringan per kelompok barang. */
function CategoryBadge({ category }: { category: string }) {
  const Icon =
    category === "Elektronik" ? Package :
    category === "Kendaraan" ? Boxes :
    category === "Seragam" ? UserRoundCheck :
    category === "Alat Kerja" ? Wrench :
    category === "Furniture" ? Archive :
    CircleHelp;
  return (
    <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <Icon className="h-3 w-3" aria-hidden /> {category}
    </Badge>
  );
}

/** Label kondisi pengembalian (kecil, dipakai tab Penugasan + offboarding). */
export function conditionLabel(cond: string | null): { label: string; en: string; cls: string } {
  switch (cond) {
    case "Good": return { label: "Baik", en: "Good", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25" };
    case "Damaged": return { label: "Rusak", en: "Damaged", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25" };
    case "Lost": return { label: "Hilang", en: "Lost", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" };
    default: return { label: "—", en: "—", cls: "bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:border-slate-700" };
  }
}

// ================= MODUL =================
export function AssetsModule() {
  const { t } = useI18n();
  const perms = useMenuPerms();

  return (
    <div>
      <PageHeader
        eyebrow={t("Inventaris", "Inventory")}
        title={t("Aset Karyawan", "Employee Assets")}
        description={t(
          "Inventaris aset perusahaan — laptop, seragam, alat kerja — beserta penugasan, pengembalian, dan nilai perolehannya.",
          "Company asset inventory — laptops, uniforms, work equipment — along with assignment, return, and acquisition value.",
        )}
      />
      <Tabs defaultValue="inventory">
        <TabsList className="mb-4 h-11 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          <TabsTrigger value="inventory" className="gap-1.5 rounded-lg px-4 text-[12px] font-bold data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-50">
            <Package className="h-4 w-4" aria-hidden /> {t("Inventaris", "Inventory")}
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-1.5 rounded-lg px-4 text-[12px] font-bold data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-50">
            <ClipboardList className="h-4 w-4" aria-hidden /> {t("Penugasan", "Assignments")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inventory">
          <InventoryTab perms={perms} />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentsTab perms={perms} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type PermsApi = ReturnType<typeof useMenuPerms>;

// ================= TAB INVENTARIS =================
function InventoryTab({ perms }: { perms: PermsApi }) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [assetDialog, setAssetDialog] = useState<{ open: boolean; editing: AssetRow | null }>({ open: false, editing: null });
  const [assignTarget, setAssignTarget] = useState<AssetRow | null>(null);
  const [deleting, setDeleting] = useState<AssetRow | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (category !== "all") p.set("category", category);
    if (status !== "all") p.set("status", status);
    return `/api/rekankerja/assets?${p.toString()}`;
  }, [q, category, status]);

  const { data, loading, refresh } = useApi<AssetsData>(url);
  const assets = data?.assets ?? [];
  const stats = data?.stats ?? { total: 0, assigned: 0, available: 0, totalValue: 0 };

  const canCreate = perms.can("hr", "assets", "create");
  const canUpdate = perms.can("hr", "assets", "update");
  const canDelete = perms.can("hr", "assets", "delete");
  const canAssign = perms.canOp("hr", "assets", "assign");

  const doDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await apiSend(`/api/rekankerja/assets?id=${encodeURIComponent(deleting.id)}`, "DELETE");
      toast.success(t("Aset {code} dihapus", "Asset {code} deleted", { code: deleting.code }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div>
      {/* ===== kartu ringkasan ===== */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={t("Total Aset", "Total Assets")} value={String(stats.total)} icon={Boxes} />
        <MiniStat label={t("Ditugaskan", "Assigned")} value={String(stats.assigned)} icon={UserRoundCheck} tone="amber" />
        <MiniStat label={t("Tersedia", "Available")} value={String(stats.available)} icon={PackageCheck} tone="emerald" />
        <MiniStat label={t("Nilai Total", "Total Value")} value={fmtIDR(stats.totalValue)} icon={Banknote} mono />
      </div>

      {/* ===== toolbar ===== */}
      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-center gap-2.5 p-3.5">
          <div className="relative min-w-44 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Cari kode / nama / serial / lokasi…", "Search code / name / serial / location…")}
              className="pl-9"
              aria-label={t("Cari aset", "Search assets")}
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t("Filter kategori", "Filter category")}>
              <SelectValue placeholder={t("Semua kategori", "All categories")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua kategori", "All categories")}</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40" aria-label={t("Filter status", "Filter status")}>
              <SelectValue placeholder={t("Semua status", "All statuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(ASSET_STATUS[s].label, ASSET_STATUS[s].en)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canCreate && (
            <Button onClick={() => setAssetDialog({ open: true, editing: null })} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Aset Baru", "New Asset")}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ===== tabel inventaris ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : assets.length > 0 ? (
            <div className="max-h-96 overflow-y-auto overflow-x-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead className="min-w-36 text-[11px] font-bold">{t("Aset", "Asset")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Kategori", "Category")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold md:table-cell">{t("Nilai", "Value")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold lg:table-cell">{t("Lokasi", "Location")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status", "Status")}</TableHead>
                    <TableHead className="min-w-36 text-[11px] font-bold">{t("Pemegang Aktif", "Current Holder")}</TableHead>
                    <TableHead className="w-28 text-right text-[11px] font-bold">{t("Aksi", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{a.name}</p>
                        <p className="font-mono text-[10px] text-slate-400">
                          {a.code}{a.serialNumber ? ` · SN ${a.serialNumber}` : ""}
                        </p>
                      </TableCell>
                      <TableCell><CategoryBadge category={a.category} /></TableCell>
                      <TableCell className="hidden text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300 md:table-cell">{fmtIDR(a.value)}</TableCell>
                      <TableCell className="hidden max-w-40 truncate text-xs text-slate-500 lg:table-cell">{a.location ?? "—"}</TableCell>
                      <TableCell><AssetStatusPill status={a.status} /></TableCell>
                      <TableCell>
                        {a.holder ? (
                          <button
                            onClick={() => navigate("employee", "detail", { id: a.holder!.employee.id })}
                            className="group/holder flex items-center gap-1.5 text-left"
                            title={t("Buka profil karyawan", "Open employee profile")}
                          >
                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold", avatarColor(a.holder.employee.fullName))}>
                              {initials(a.holder.employee.fullName)}
                            </span>
                            <span className="min-w-0">
                              <span className="block max-w-28 truncate text-[11px] font-bold text-slate-700 group-hover/holder:underline dark:text-slate-200">{a.holder.employee.fullName}</span>
                              <span className="block font-mono text-[9px] text-slate-400">{a.holder.employee.employeeNo}</span>
                            </span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">{t("Belum ditugaskan", "Not assigned")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canUpdate && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setAssetDialog({ open: true, editing: a })}
                              aria-label={t("Ubah aset {code}", "Edit asset {code}", { code: a.code })}
                              title={t("Ubah aset", "Edit asset")}
                            >
                              <Pencil className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          )}
                          {canAssign && a.status === "Available" && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 hover:ov-text-accent"
                              onClick={() => setAssignTarget(a)}
                              aria-label={t("Tugaskan aset {code}", "Assign asset {code}", { code: a.code })}
                              title={t("Tugaskan ke karyawan", "Assign to an employee")}
                            >
                              <UserRoundCheck className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          )}
                          {canDelete && !a.holder && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600"
                              onClick={() => setDeleting(a)}
                              aria-label={t("Hapus aset {code}", "Delete asset {code}", { code: a.code })}
                              title={t("Hapus aset", "Delete asset")}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={<PackageOpen className="h-6 w-6" />}
                title={t("Tidak ada aset yang cocok", "No matching assets")}
                description={t("Sesuaikan filter pencarian, atau catat aset baru dengan tombol \"Aset Baru\".", "Adjust the filters, or register a new asset with \"New Asset\".")}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog buat/ubah aset */}
      <AssetDialog
        open={assetDialog.open}
        editing={assetDialog.editing}
        setOpen={(v) => setAssetDialog({ open: v, editing: v ? assetDialog.editing : null })}
        onSaved={refresh}
      />

      {/* dialog tugangkan aset */}
      {assignTarget && (
        <AssignDialog
          asset={assignTarget}
          onClose={() => setAssignTarget(null)}
          onSaved={refresh}
        />
      )}

      {/* konfirmasi hapus */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-rose-500" />
              {t("Hapus aset {code}?", "Delete asset {code}?", { code: deleting?.code ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "\"{name}\" akan dihapus dari inventaris. Aset dengan riwayat penugasan tidak dapat dihapus — gunakan status Dipensiunkan sebagai gantinya.",
                "\"{name}\" will be removed from the inventory. Assets with assignment history cannot be deleted — use the Retired status instead.",
                { name: deleting?.name ?? "" },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyDelete}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async (e) => { e.preventDefault(); await doDelete(); }}
            >
              {busyDelete ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ================= TAB PENUGASAN =================
function AssignmentsTab({ perms }: { perms: PermsApi }) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const [scope, setScope] = useState<"active" | "returned" | "all">("active");
  const [returning, setReturning] = useState<AssignmentRow | null>(null);

  const url = useMemo(() => `/api/rekankerja/asset-assignments?scope=${scope}`, [scope]);
  const { data, loading, refresh } = useApi<{ assignments: AssignmentRow[] }>(url);
  const assignments = data?.assignments ?? [];
  const canReturn = perms.canOp("hr", "assets", "return");

  const counts = useMemo(() => {
    // hitung dari data scope=all? hindari fetch ganda: jumlah aktif global
    // sederhana — pakai data API assets? scope aktif/returned memadai utk chip.
    return { shown: assignments.length };
  }, [assignments]);

  return (
    <div>
      {/* toolbar */}
      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-center justify-between gap-2.5 p-3.5">
          <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-900" role="group" aria-label={t("Filter penugasan", "Filter assignments")}>
            {([
              ["active", t("Aktif", "Active")],
              ["returned", t("Dikembalikan", "Returned")],
              ["all", t("Semua", "All")],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setScope(key)}
                aria-pressed={scope === key}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12px] font-bold transition-colors",
                  scope === key ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-50" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] font-bold text-slate-400" aria-live="polite">
            {t("{n} baris", "{n} rows", { n: counts.shown })}
          </p>
        </CardContent>
      </Card>

      {/* tabel penugasan */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : assignments.length > 0 ? (
            <div className="max-h-96 overflow-y-auto overflow-x-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead className="min-w-36 text-[11px] font-bold">{t("Aset", "Asset")}</TableHead>
                    <TableHead className="min-w-36 text-[11px] font-bold">{t("Karyawan", "Employee")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Ditugaskan", "Assigned")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold sm:table-cell">{t("Jatuh Tempo", "Due")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status", "Status")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold md:table-cell">{t("Kondisi", "Condition")}</TableHead>
                    <TableHead className="w-24 text-right text-[11px] font-bold">{t("Aksi", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((r) => {
                    const active = !r.returnedAt;
                    const overdue = active && r.dueAt != null && new Date(r.dueAt).getTime() < Date.now();
                    const cond = conditionLabel(r.returnCondition);
                    return (
                      <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell>
                          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{r.asset.name}</p>
                          <p className="font-mono text-[10px] text-slate-400">
                            {r.asset.code}{r.asset.serialNumber ? ` · SN ${r.asset.serialNumber}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => navigate("employee", "detail", { id: r.employee.id })}
                            className="group/emp flex items-center gap-1.5 text-left"
                            title={t("Buka profil karyawan", "Open employee profile")}
                          >
                            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold", avatarColor(r.employee.fullName))}>
                              {initials(r.employee.fullName)}
                            </span>
                            <span className="min-w-0">
                              <span className="block max-w-32 truncate text-[12px] font-bold text-slate-700 group-hover/emp:underline dark:text-slate-200">{r.employee.fullName}</span>
                              <span className="block font-mono text-[9px] text-slate-400">{r.employee.employeeNo}</span>
                            </span>
                          </button>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-400">{fmtDate(r.assignedAt)}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {r.dueAt ? (
                            <span className={cn("flex items-center gap-1 text-xs font-semibold", overdue ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-400")}>
                              <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {fmtDate(r.dueAt)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {active ? (
                            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                              overdue
                                ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25"
                                : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25")}>
                              <span className={cn("h-1.5 w-1.5 rounded-full", overdue ? "bg-rose-500" : "bg-amber-400")} />
                              {overdue ? t("Terlambat", "Overdue") : t("Aktif", "Active")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              {t("Dikembalikan", "Returned")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className={cn("inline-flex items-center rounded-full border px-2 py-px text-[10px] font-bold", cond.cls)}>
                            {t(cond.label, cond.en)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {active && canReturn ? (
                            <Button
                              variant="outline" size="sm"
                              onClick={() => setReturning(r)}
                              className="h-7 gap-1 px-2.5 text-[11px] font-bold hover:ov-border-accent"
                              aria-label={t("Terima pengembalian {code}", "Receive return of {code}", { code: r.asset.code })}
                            >
                              <PackageCheck className="h-3.5 w-3.5" /> {t("Kembalikan", "Return")}
                            </Button>
                          ) : (
                            <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={<ClipboardList className="h-6 w-6" />}
                title={scope === "active"
                  ? t("Tidak ada penugasan aktif", "No active assignments")
                  : scope === "returned"
                    ? t("Belum ada pengembalian tercatat", "No returns recorded yet")
                    : t("Belum ada penugasan", "No assignments yet")}
                description={t(
                  "Tugaskan aset dari tab Inventaris (tombol pada baris aset Tersedia).",
                  "Assign an asset from the Inventory tab (button on rows of Available assets).",
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog pengembalian */}
      {returning && <ReturnDialog assignment={returning} onClose={() => setReturning(null)} onSaved={refresh} />}
    </div>
  );
}

// ================= DIALOG BUAT/UBAH ASET =================
function AssetDialog({ open, editing, setOpen, onSaved }: {
  open: boolean;
  editing: AssetRow | null;
  setOpen: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: "", category: "Elektronik", serialNumber: "", value: "", purchaseDate: "", location: "", notes: "", status: "Available",
  });
  const [busy, setBusy] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // isi form saat dialog dibuka (create kosong / edit dari baris)
  const seedKey = open ? editing?.id ?? "new" : null;
  if (seedKey !== hydratedFor) {
    setHydratedFor(seedKey);
    if (editing) {
      setForm({
        name: editing.name,
        category: editing.category,
        serialNumber: editing.serialNumber ?? "",
        value: editing.value != null ? String(editing.value) : "",
        purchaseDate: editing.purchaseDate ? String(editing.purchaseDate).slice(0, 10) : "",
        location: editing.location ?? "",
        notes: editing.notes ?? "",
        status: editing.status,
      });
    } else {
      setForm({ name: "", category: "Elektronik", serialNumber: "", value: "", purchaseDate: "", location: "", notes: "", status: "Available" });
    }
  }

  const submit = async () => {
    if (busy) return;
    if (!form.name.trim()) { toast.error(t("Nama aset wajib diisi", "Asset name is required")); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        serialNumber: form.serialNumber.trim() || null,
        value: form.value.trim() === "" ? null : Number(form.value.replace(/[^\d.-]/g, "")),
        purchaseDate: form.purchaseDate || null,
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        body.id = editing.id;
        body.status = form.status;
        await apiSend("/api/rekankerja/assets", "PATCH", body);
        toast.success(t("Aset {code} diperbarui", "Asset {code} updated", { code: editing.code }));
      } else {
        const res = await apiSend<{ asset: { code: string } }>("/api/rekankerja/assets", "POST", body);
        toast.success(t("Aset {code} tercatat — status Tersedia", "Asset {code} registered — status Available", { code: res.asset.code }));
      }
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 ov-text-accent" aria-hidden />
            {editing
              ? t("Ubah Aset {code}", "Edit Asset {code}", { code: editing.code })
              : t("Aset Baru", "New Asset")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ast-name" className="text-xs">{t("Nama aset *", "Asset name *")}</Label>
              <Input
                id="ast-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("cth: Laptop Lenovo ThinkPad E14", "e.g.: Lenovo ThinkPad E14 laptop")}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ast-cat" className="text-xs">{t("Kategori *", "Category *")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger id="ast-cat" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ast-serial" className="text-xs">{t("Nomor seri", "Serial number")}</Label>
              <Input
                id="ast-serial"
                value={form.serialNumber}
                onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
                placeholder={t("cth: TP-2024-E14-0192", "e.g.: TP-2024-E14-0192")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ast-value" className="text-xs">{t("Nilai perolehan (Rp)", "Acquisition value (Rp)")}</Label>
              <Input
                id="ast-value"
                inputMode="numeric"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value.replace(/[^\d]/g, "") }))}
                placeholder="12500000"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ast-date" className="text-xs">{t("Tanggal perolehan", "Acquisition date")}</Label>
              <Input
                id="ast-date"
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ast-loc" className="text-xs">{t("Lokasi penyimpanan", "Storage location")}</Label>
              <Input
                id="ast-loc"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder={t("cth: Gudang IT OFF-HO", "e.g.: IT warehouse OFF-HO")}
              />
            </div>
          </div>
          {editing && (
            <div className="space-y-1.5">
              <Label htmlFor="ast-status" className="text-xs">{t("Status", "Status")}</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger id="ast-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} disabled={s === "Available" && editing.status === "Assigned"}>
                      {t(ASSET_STATUS[s].label, ASSET_STATUS[s].en)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-relaxed text-slate-400">
                {editing.status === "Assigned"
                  ? t("Aset sedang ditugaskan — status kembali ke Tersedia hanya lewat aksi Kembalikan (tab Penugasan) agar kondisi tercatat.", "The asset is currently assigned — it can only become Available through the Return action (Assignments tab) so the condition is recorded.")
                  : t("Gunakan Dipensiunkan utk aset yang keluar dari peredaran.", "Use Retired for assets taken out of circulation.")}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ast-notes" className="text-xs">{t("Catatan", "Notes")}</Label>
            <Textarea
              id="ast-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder={t("cth: termasuk charger & tas", "e.g.: includes charger & bag")}
            />
          </div>
          {!editing && (
            <p className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
              {t("Kode aset dibuat otomatis (AST-0001, dst.) dan status awal Tersedia.", "The asset code is generated automatically (AST-0001, etc.) with the initial status Available.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)} className="rounded-xl font-bold">{t("Batal")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-2 rounded-xl font-bold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            {busy ? t("Menyimpan…") : editing ? t("Simpan Perubahan", "Save Changes") : t("Catat Aset", "Register Asset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DIALOG TUGANKAN ASET =================
function AssignDialog({ asset, onClose, onSaved }: {
  asset: AssetRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const opts = useApi<{ managers: EmployeeOption[] }>(`/api/rekankerja/employee-options`);
  const [employeeId, setEmployeeId] = useState("");
  const [empQ, setEmpQ] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const employees = (opts.data?.managers ?? [])
    .filter((m) => !empQ || m.fullName.toLowerCase().includes(empQ.toLowerCase()) || m.employeeNo.toLowerCase().includes(empQ.toLowerCase()))
    .slice(0, 30);

  const submit = async () => {
    if (busy) return;
    if (!employeeId) { toast.error(t("Pilih karyawan penerima aset", "Select the employee receiving the asset")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/asset-assignments", "POST", {
        assetId: asset.id,
        employeeId,
        dueAt: dueAt || null,
        notes: notes.trim() || null,
      });
      toast.success(t("Aset {code} ditugaskan — status menjadi Ditugaskan", "Asset {code} assigned — status becomes Assigned", { code: asset.code }));
      onClose();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserRoundCheck className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Tugaskan Aset", "Assign Asset")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* aset terpilih (dari baris tabel) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-200">{asset.name}</p>
                <p className="font-mono text-[10px] text-slate-400">
                  {asset.code}{asset.serialNumber ? ` · SN ${asset.serialNumber}` : ""}
                </p>
              </div>
              <AssetStatusPill status={asset.status} />
            </div>
            {asset.value != null && (
              <p className="mt-1 text-[11px] font-semibold tabular-nums text-slate-500">{fmtIDR(asset.value)}</p>
            )}
          </div>

          <div>
            <Label className="text-xs">{t("Karyawan penerima *", "Receiving employee *")}</Label>
            <Input
              value={empQ}
              onChange={(e) => setEmpQ(e.target.value)}
              className="mt-1.5"
              placeholder={t("Filter daftar karyawan…", "Filter employee list…")}
              aria-label={t("Filter daftar karyawan", "Filter employee list")}
            />
            <Select value={employeeId || "none"} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-2"><SelectValue placeholder={t("Pilih karyawan", "Select an employee")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">{t("— Pilih karyawan —", "— Select an employee —")}</SelectItem>
                {employees.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.employeeNo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="ast-due" className="text-xs">{t("Jatuh tempo pengembalian (opsional)", "Return due date (optional)")}</Label>
            <Input id="ast-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1.5" />
            <p className="mt-1 text-[10px] text-slate-400">
              {t("Cocok untuk seragam kontrak / peminjaman sementara.", "Useful for contract uniforms / temporary loans.")}
            </p>
          </div>

          <div>
            <Label htmlFor="ast-assign-notes" className="text-xs">{t("Catatan penugasan", "Assignment note")}</Label>
            <Textarea
              id="ast-assign-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t("cth: laptop kerja harian — lengkap charger", "e.g.: daily work laptop — charger included")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose} className="rounded-xl font-bold">{t("Batal")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-2 rounded-xl font-bold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
            {busy ? t("Menugaskan…", "Assigning…") : t("Tugaskan", "Assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DIALOG PENGEMBALIAN =================
export function ReturnDialog({ assignment, onClose, onSaved, compact }: {
  assignment: { id: string; asset: { code: string; name: string; serialNumber?: string | null }; employee: { fullName: string; employeeNo: string }; dueAt?: string | null; notes?: string | null };
  onClose: () => void;
  onSaved: () => void;
  /** varian ringkas utk seksi offboarding (tanpa blok konteks panjang). */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [condition, setCondition] = useState("Good");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiSend<{ asset: { code: string; status: string } }>("/api/rekankerja/asset-assignments", "PATCH", {
        id: assignment.id,
        returnCondition: condition,
        notes: notes.trim() || null,
      });
      toast.success(t(
        "Aset {code} dikembalikan — status {status}",
        "Asset {code} returned — status {status}",
        { code: res.asset.code, status: t(ASSET_STATUS[res.asset.status]?.label ?? res.asset.status, ASSET_STATUS[res.asset.status]?.en ?? res.asset.status) },
      ));
      onClose();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const CONDITION_HINT: Record<string, string> = {
    Good: t("Aset kembali siap dipakai — status menjadi Tersedia.", "The asset is ready to use again — status becomes Available."),
    Damaged: t("Aset masuk Perbaikan — buat tindak lanjut service/klaim.", "The asset enters Maintenance — arrange service/claim follow-up."),
    Lost: t("Aset ditandai Hilang — pertimbangkan potongan settlement.", "The asset is marked Lost — consider a settlement deduction."),
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className={compact ? "sm:max-w-lg" : "sm:max-w-xl"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Terima Pengembalian Aset", "Receive Asset Return")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!compact && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{assignment.asset.name}</p>
              <p className="font-mono text-[10px] text-slate-400">
                {assignment.asset.code}{assignment.asset.serialNumber ? ` · SN ${assignment.asset.serialNumber}` : ""}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {t("Dipegang", "Held by")} <b>{assignment.employee.fullName}</b> ({assignment.employee.employeeNo})
                {assignment.dueAt ? ` · ${t("jatuh tempo", "due")} ${fmtDate(assignment.dueAt)}` : ""}
              </p>
            </div>
          )}

          <div className="space-y-1.5" role="radiogroup" aria-label={t("Kondisi pengembalian", "Return condition")}>
            <Label className="text-xs">{t("Kondisi aset *", "Asset condition *")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {CONDITIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={condition === c.key}
                  onClick={() => setCondition(c.key)}
                  className={cn(
                    "rounded-xl border p-2.5 text-center text-[12px] font-bold transition-all",
                    condition === c.key
                      ? c.key === "Good"
                        ? "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/40 dark:bg-brand/15 dark:text-brand/85"
                        : c.key === "Damaged"
                          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-400"
                          : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-400"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
                  )}
                >
                  {c.key === "Good" ? <PackageCheck className="mx-auto h-4 w-4" aria-hidden /> : c.key === "Damaged" ? <Wrench className="mx-auto h-4 w-4" aria-hidden /> : <AlertTriangle className="mx-auto h-4 w-4" aria-hidden />}
                  <span className="mt-0.5 block">{t(c.label, c.en)}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">{CONDITION_HINT[condition]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ret-notes" className="text-xs">{t("Catatan pengembalian (opsional)", "Return note (optional)")}</Label>
            <Textarea
              id="ret-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t("cth: lengkap dengan charger & tas", "e.g.: complete with charger & bag")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose} className="rounded-xl font-bold">{t("Batal")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-2 rounded-xl font-bold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            {busy ? t("Menyimpan…") : t("Catat Pengembalian", "Record Return")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= KARTU STATISTIK =================
function MiniStat({ label, value, icon: Icon, tone, mono }: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: "amber" | "emerald";
  mono?: boolean;
}) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          tone === "amber" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
            : tone === "emerald" ? "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85"
              : "ov-soft ov-text-accent",
        )}>
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className={cn("mt-0.5 truncate font-extrabold text-slate-900 dark:text-slate-50", mono ? "text-[15px] tabular-nums" : "text-xl")}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
