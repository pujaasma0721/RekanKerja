"use client";
// RekanKerja — PERUSAHAAN & ORGANISASI › Kantor & Lokasi Kerja: master company office + work location (CRUD)
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Building2, MapPin, Users, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

// ============ types (kontrak API Task 25) ============
interface OfficeRow {
  id: string; code: string; name: string;
  address: string | null; city: string | null; phone: string | null; npwp: string | null;
  active: boolean; employeeCount: number; locationCount: number;
}
interface OfficesRes { offices: OfficeRow[] }

interface LocationRow {
  id: string; code: string; name: string;
  address: string | null; city: string | null; active: boolean;
  officeId: string | null; office: { code: string; name: string } | null;
  /** 27-a: koordinat geofencing presensi (null = lokasi tak berpartisipasi). */
  latitude: number | null; longitude: number | null; radiusMeters: number | null;
  employeeCount: number;
}
interface LocationsRes { locations: LocationRow[] }

// ============ shared bits ============
function ActivePill({ active }: { active: boolean }) {
  const { t } = useI18n();
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      active
        ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85"
        : "border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-brand" : "bg-slate-400")} />
      {active ? t("Aktif") : t("Nonaktif")}
    </span>
  );
}

function MiniStat({ label, value, hint, icon: Icon }: {
  label: string; value: string; hint?: string; icon: React.ElementType;
}) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ov-tile shadow-md">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{value}</p>
          {hint && <p className="text-[10px] font-semibold text-slate-400">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Main view ============
export function OfficeLocationView() {
  const { t } = useI18n();
  const officesApi = useApi<OfficesRes>("/api/rekankerja/company-offices");
  const locationsApi = useApi<LocationsRes>("/api/rekankerja/work-locations");
  const refreshAll = () => { officesApi.refresh(); locationsApi.refresh(); };

  const offices = officesApi.data?.offices ?? [];
  const locations = locationsApi.data?.locations ?? [];
  const activeOffices = offices.filter((o) => o.active).length;
  const activeLocations = locations.filter((l) => l.active).length;
  // karyawan tercatat pada kantor + karyawan di lokasi tanpa induk kantor (hindari double count)
  const placedEmployees =
    offices.reduce((a, o) => a + o.employeeCount, 0) +
    locations.filter((l) => !l.officeId).reduce((a, l) => a + l.employeeCount, 0);

  if (officesApi.loading && !officesApi.data && locationsApi.loading && !locationsApi.data) {
    return (
      <div>
        <PageHeader
          eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")}
          title={t("Kantor & Lokasi Kerja")}
          description={t("Master kantor perusahaan (company office) dan lokasi kerja — dimensi penempatan karyawan & pencocokan approval berjenjang.", "Company office and work location master — dimensions for employee placement and tiered approval matching.")}
        />
        <LoadingRows rows={6} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")}
        title={t("Kantor & Lokasi Kerja")}
        description={t("Master kantor perusahaan (company office) dan lokasi kerja — dimensi penempatan karyawan & pencocokan approval berjenjang.", "Company office and work location master — dimensions for employee placement and tiered approval matching.")}
        actions={
          <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{t("Muat Ulang")}</span>
          </Button>
        }
      />

      {/* stat ringkas */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniStat label={t("Kantor Perusahaan", "Company Offices")} value={String(offices.length)} hint={t("{n} aktif", "{n} active", { n: activeOffices })} icon={Building2} />
        <MiniStat label={t("Lokasi Kerja", "Work Locations")} value={String(locations.length)} hint={t("{n} aktif", "{n} active", { n: activeLocations })} icon={MapPin} />
        <MiniStat label={t("Karyawan Terpenempatan", "Placed Employees")} value={String(placedEmployees)} hint={t("karyawan aktif ber-kantor / ber-lokasi", "active employees with an office / location")} icon={Users} />
      </div>

      <Tabs defaultValue="offices">
        <TabsList className="mb-4 h-auto rounded-2xl ov-tile p-1.5">
          <TabsTrigger value="offices" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
            <Building2 className="h-3.5 w-3.5" /> {t("Kantor Perusahaan", "Company Offices")}
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
            <MapPin className="h-3.5 w-3.5" /> {t("Lokasi Kerja", "Work Locations")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="offices">
          <OfficesTab offices={offices} loading={officesApi.loading && !officesApi.data} error={officesApi.error} refresh={refreshAll} />
        </TabsContent>
        <TabsContent value="locations">
          <LocationsTab locations={locations} offices={offices} loading={locationsApi.loading && !locationsApi.data} error={locationsApi.error} refresh={refreshAll} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============ TAB: KANTOR PERUSAHAAN ============
function OfficesTab({ offices, loading, error, refresh }: {
  offices: OfficeRow[]; loading: boolean; error: string | null; refresh: () => void;
}) {
  const { t } = useI18n();

  // Task 72 — sorting kolom tabel kantor (asc/desc via header)
  const sort = useTableSort(offices, {
    office: (o) => o.name,
    code: (o) => o.code,
    city: (o) => o.city || null,
    npwp: (o) => o.npwp || null,
    address: (o) => o.address || null,
    employees: (o) => o.employeeCount,
    locations: (o) => o.locationCount,
    status: (o) => (o.active ? 0 : 1),
  }, { defaultKey: "office", defaultDir: "asc" });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleActive = async (o: OfficeRow) => {
    try {
      await apiSend("/api/rekankerja/company-offices", "PATCH", { id: o.id, active: !o.active });
      toast.success(o.active ? t("Kantor {c} dinonaktifkan", "Office {c} deactivated", { c: o.code }) : t("Kantor {c} diaktifkan", "Office {c} activated", { c: o.code }));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengubah status kantor", "Failed to change office status"));
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/rekankerja/company-offices?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(t("Kantor {c} dihapus", "Office {c} deleted", { c: editing.code }));
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus kantor", "Failed to delete office"));
    } finally {
      setDeleting(false);
    }
  };

  const totalEmployees = offices.reduce((a, o) => a + o.employeeCount, 0);

  return (
    <>
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div>
              <p className="text-[13px] font-bold">{t("Master Kantor Perusahaan", "Company Office Master")}</p>
              <p className="text-[11px] text-slate-400">{t("{a} kantor · {b} karyawan terpenempat", "{a} offices · {b} placed employees", { a: offices.length, b: totalEmployees })}</p>
            </div>
            <Button size="sm" className="gap-1.5 font-bold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> {t("Tambah Kantor", "Add Office")}
            </Button>
          </div>

          {loading ? (
            <div className="p-5"><LoadingRows rows={5} /></div>
          ) : error && offices.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Gagal memuat kantor", "Failed to load offices")} description={error} icon={<Building2 className="h-6 w-6" />} /></div>
          ) : offices.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada kantor", "No offices yet")} description={t("Buat kantor perusahaan pertama dengan tombol Tambah Kantor.", "Create the first company office with the Add Office button.")} icon={<Building2 className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    {sort.head("office", t("Kantor", "Office"), "text-[11px] font-bold")}
                    {sort.head("city", t("Kota", "City"), "text-[11px] font-bold")}
                    {sort.head("npwp", "NPWP", "text-[11px] font-bold")}
                    {sort.head("address", t("Alamat"), "text-[11px] font-bold")}
                    {sort.head("employees", t("Karyawan"), "text-[11px] font-bold")}
                    {sort.head("locations", t("Lokasi", "Location"), "text-[11px] font-bold")}
                    {sort.head("status", t("Status"), "text-[11px] font-bold")}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((o) => (
                    <TableRow key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ov-tile shadow-sm">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-mono text-[12px] font-extrabold text-slate-800 dark:text-slate-200">{o.code}</p>
                            <p className="max-w-[220px] truncate text-[11px] text-slate-400">{o.name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">{o.city || "—"}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-600 dark:text-slate-300" title={o.npwp ?? undefined}>{o.npwp || "—"}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={o.address ?? undefined}>{o.address || "—"}</p>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <Users className="h-3.5 w-3.5 ov-text-accent" /> {o.employeeCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <MapPin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> {o.locationCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleActive(o)} title={o.active ? t("Nonaktifkan kantor", "Deactivate office") : t("Aktifkan kantor", "Activate office")}>
                          <ActivePill active={o.active} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(o); setFormOpen(true); }} aria-label={t("Ubah kantor {c}", "Edit office {c}", { c: o.code })}>
                            <Pencil className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => { setEditing(o); setDeleteOpen(true); }} aria-label={t("Hapus kantor {c}", "Delete office {c}", { c: o.code })}>
                            <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <OfficeFormDialog open={formOpen} onOpenChange={setFormOpen} office={editing} onDone={refresh} />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setEditing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus kantor {c}?", "Delete office {c}?", { c: editing?.code ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Kantor yang masih dipakai lokasi kerja atau struktur approval berjenjang tidak dapat dihapus.", "This action is permanent. Offices still used by work locations or tiered approval structures cannot be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============ TAB: LOKASI KERJA ============
function LocationsTab({ locations, offices, loading, error, refresh }: {
  locations: LocationRow[]; offices: OfficeRow[]; loading: boolean; error: string | null; refresh: () => void;
}) {
  const { t } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Task 72 — sorting kolom tabel lokasi kerja
  const sortLoc = useTableSort(locations, {
    location: (l) => l.name,
    parent: (l) => l.office?.name ?? null,
    city: (l) => l.city || null,
    employees: (l) => l.employeeCount,
  }, { defaultKey: "location", defaultDir: "asc" });

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/rekankerja/work-locations?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(t("Lokasi {c} dihapus", "Location {c} deleted", { c: editing.code }));
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus lokasi", "Failed to delete location"));
    } finally {
      setDeleting(false);
    }
  };

  const totalEmployees = locations.reduce((a, l) => a + l.employeeCount, 0);

  return (
    <>
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div>
              <p className="text-[13px] font-bold">{t("Master Lokasi Kerja", "Work Location Master")}</p>
              <p className="text-[11px] text-slate-400">{t("{a} lokasi · {b} karyawan terpenempat", "{a} locations · {b} placed employees", { a: locations.length, b: totalEmployees })}</p>
            </div>
            <Button size="sm" className="gap-1.5 font-bold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> {t("Tambah Lokasi", "Add Location")}
            </Button>
          </div>

          {loading ? (
            <div className="p-5"><LoadingRows rows={5} /></div>
          ) : error && locations.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Gagal memuat lokasi", "Failed to load locations")} description={error} icon={<MapPin className="h-6 w-6" />} /></div>
          ) : locations.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada lokasi kerja", "No work locations yet")} description={t("Buat lokasi kerja pertama dengan tombol Tambah Lokasi.", "Create the first work location with the Add Location button.")} icon={<MapPin className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    {sortLoc.head("location", t("Lokasi", "Location"), "text-[11px] font-bold")}
                    {sortLoc.head("parent", t("Kantor Induk", "Parent Office"), "text-[11px] font-bold")}
                    {sortLoc.head("city", t("Kota", "City"), "text-[11px] font-bold")}
                    {sortLoc.head("employees", t("Karyawan"), "text-[11px] font-bold")}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortLoc.sorted.map((l) => (
                    <TableRow key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ov-tile shadow-sm">
                            <MapPin className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-mono text-[12px] font-extrabold text-slate-800 dark:text-slate-200">{l.code}</p>
                              {!l.active && <Badge variant="outline" className="text-[9px] font-bold text-slate-400">{t("NONAKTIF", "INACTIVE")}</Badge>}
                            </div>
                            <p className="max-w-[220px] truncate text-[11px] text-slate-400">{l.name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {l.office ? (
                          <div className="min-w-0">
                            <Badge variant="outline" className="font-mono text-[10px] font-semibold">{l.office.code}</Badge>
                            <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-slate-400">{l.office.name}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">{t("— Tanpa kantor —", "— No office —")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">{l.city || "—"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <Users className="h-3.5 w-3.5 ov-text-accent" /> {l.employeeCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(l); setFormOpen(true); }} aria-label={t("Ubah lokasi {c}", "Edit location {c}", { c: l.code })}>
                            <Pencil className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => { setEditing(l); setDeleteOpen(true); }} aria-label={t("Hapus lokasi {c}", "Delete location {c}", { c: l.code })}>
                            <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LocationFormDialog open={formOpen} onOpenChange={setFormOpen} location={editing} offices={offices} onDone={refresh} />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setEditing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus lokasi {c}?", "Delete location {c}?", { c: editing?.code ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Lokasi yang masih dipakai penempatan karyawan atau struktur approval berjenjang tidak dapat dihapus.", "This action is permanent. Locations still used by employee placement or tiered approval structures cannot be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============ Dialog form kantor ============
function OfficeFormDialog({ open, onOpenChange, office, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; office: OfficeRow | null; onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ code: "", name: "", city: "", address: "", phone: "", npwp: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: office?.code ?? "",
      name: office?.name ?? "",
      city: office?.city ?? "",
      address: office?.address ?? "",
      phone: office?.phone ?? "",
      npwp: office?.npwp ?? "",
    });
  }, [open, office]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("Kode dan nama kantor wajib diisi", "Office code and name are required")); return; }
    setSaving(true);
    try {
      if (office) {
        await apiSend("/api/rekankerja/company-offices", "PATCH", {
          id: office.id,
          name: form.name.trim(),
          city: form.city.trim(),
          address: form.address.trim(),
          phone: form.phone.trim(),
          npwp: form.npwp.trim(),
        });
        toast.success(t("Kantor {c} berhasil diperbarui", "Office {c} updated successfully", { c: office.code }));
      } else {
        const payload = {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          npwp: form.npwp.trim() || null,
        };
        await apiSend("/api/rekankerja/company-offices", "POST", payload);
        toast.success(t("Kantor {c} berhasil dibuat", "Office {c} created successfully", { c: payload.code }));
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan kantor", "Failed to save office"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{office ? t("Ubah Kantor {c}", "Edit Office {c}", { c: office.code }) : t("Kantor Baru", "New Office")}</DialogTitle>
          <DialogDescription>
            {office ? t("Perbarui profil kantor perusahaan beserta kontaknya.", "Update the company office profile and its contact details.") : t("Tambahkan kantor perusahaan (company office) baru — dimensi penempatan & approval berjenjang.", "Add a new company office — a dimension for placement and tiered approvals.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="o-code">{t("Kode Kantor", "Office Code")}</Label>
              <Input id="o-code" value={form.code} disabled={!!office} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="OFF-JKT" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="o-name">{t("Nama Kantor", "Office Name")}</Label>
              <Input id="o-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("Kantor Pusat Jakarta", "Jakarta Head Office")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="o-city">{t("Kota", "City")}</Label>
              <Input id="o-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder={t("Jakarta Timur", "East Jakarta")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="o-phone">{t("Telepon")}</Label>
              <Input id="o-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="021-4600808" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="o-npwp">{t("NPWP Kantor", "Office NPWP")}</Label>
            <Input id="o-npwp" value={form.npwp} onChange={(e) => setForm((f) => ({ ...f, npwp: e.target.value }))} placeholder="01.234.567.8-090.000" className="font-mono text-xs" />
            <p className="text-[10px] text-slate-400">{t("Tiap kantor bisa berbeda NPWP untuk pelaporan pajak (mis. Jakarta vs Surabaya).", "Each office may have a different NPWP for tax reporting (e.g. Jakarta vs Surabaya).")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="o-address">{t("Alamat")}</Label>
            <Input id="o-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Jl. Industri Raya Kav. 25" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : office ? t("Simpan") : t("Buat Kantor", "Create Office")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Dialog form lokasi ============
function LocationFormDialog({ open, onOpenChange, location, offices, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; location: LocationRow | null; offices: OfficeRow[]; onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ code: "", name: "", officeId: "", city: "", address: "", active: true, latitude: "", longitude: "", radiusMeters: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: location?.code ?? "",
      name: location?.name ?? "",
      officeId: location?.officeId ?? "",
      city: location?.city ?? "",
      address: location?.address ?? "",
      active: location?.active ?? true,
      latitude: location?.latitude != null ? String(location.latitude) : "",
      longitude: location?.longitude != null ? String(location.longitude) : "",
      radiusMeters: location?.radiusMeters != null ? String(location.radiusMeters) : "",
    });
  }, [open, location]);

  // 27-a: koordinat opsional — string kosong → null; nilai divalidasi rentangnya.
  const coordOrNull = (v: string, min: number, max: number): number | null | "invalid" => {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max) return "invalid";
    return n;
  };

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("Kode dan nama lokasi wajib diisi", "Location code and name are required")); return; }
    const latitude = coordOrNull(form.latitude, -90, 90);
    const longitude = coordOrNull(form.longitude, -180, 180);
    const radiusRaw = form.radiusMeters.trim();
    const radiusMeters = radiusRaw === "" ? null : Math.max(1, Math.min(100_000, Math.round(Number(radiusRaw))));
    if (latitude === "invalid") { toast.error(t("Latitude harus angka antara -90 dan 90", "Latitude must be a number between -90 and 90")); return; }
    if (longitude === "invalid") { toast.error(t("Longitude harus angka antara -180 dan 180", "Longitude must be a number between -180 and 180")); return; }
    if (radiusRaw !== "" && !Number.isFinite(Number(radiusRaw))) { toast.error(t("Radius harus angka meter", "Radius must be a number in meters")); return; }
    setSaving(true);
    try {
      if (location) {
        await apiSend("/api/rekankerja/work-locations", "PATCH", {
          id: location.id,
          name: form.name.trim(),
          officeId: form.officeId || null,
          city: form.city.trim(),
          address: form.address.trim(),
          active: form.active,
          latitude,
          longitude,
          radiusMeters,
        });
        toast.success(t("Lokasi {c} berhasil diperbarui", "Location {c} updated successfully", { c: location.code }));
      } else {
        const payload = {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          officeId: form.officeId || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          latitude,
          longitude,
          radiusMeters,
        };
        await apiSend("/api/rekankerja/work-locations", "POST", payload);
        toast.success(t("Lokasi {c} berhasil dibuat", "Location {c} created successfully", { c: payload.code }));
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan lokasi", "Failed to save location"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{location ? t("Ubah Lokasi {c}", "Edit Location {c}", { c: location.code }) : t("Lokasi Kerja Baru", "New Work Location")}</DialogTitle>
          <DialogDescription>
            {location ? t("Perbarui profil lokasi kerja dan kantor induknya.", "Update the work location profile and its parent office.") : t("Tambahkan lokasi kerja (work location) baru — dimensi penempatan & approval berjenjang.", "Add a new work location — a dimension for placement and tiered approvals.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-code">{t("Kode Lokasi", "Location Code")}</Label>
              <Input id="l-code" value={form.code} disabled={!!location} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="LOC-PRD-C" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-name">{t("Nama Lokasi", "Location Name")}</Label>
              <Input id="l-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Production Line C" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="l-office">{t("Kantor Induk", "Parent Office")}</Label>
            <Select value={form.officeId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, officeId: v === "none" ? "" : v }))}>
              <SelectTrigger id="l-office" className="mt-1"><SelectValue placeholder={t("Pilih kantor induk (opsional)", "Select parent office (optional)")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tanpa kantor —", "— No office —")}</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.code} — {o.name}{!o.active ? t(" (nonaktif)", " (inactive)") : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">{t("Lokasi tanpa kantor induk tetap valid sebagai penempatan mandiri.", "A location without a parent office is still valid as a standalone placement.")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-city">{t("Kota", "City")}</Label>
              <Input id="l-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder={t("Jakarta Timur", "East Jakarta")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-address">{t("Alamat")}</Label>
              <Input id="l-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder={t("Kawasan Industri Pulogadung", "Pulogadung Industrial Estate")} />
            </div>
          </div>
          {/* 27-a: koordinat geofencing presensi */}
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <p className="flex items-center gap-1.5 text-xs font-bold">
              <MapPin className="h-3.5 w-3.5 ov-text-accent" aria-hidden />
              {t("Koordinat Geofencing Presensi (opsional)", "Attendance Geofencing Coordinates (optional)")}
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
              {t("Digunakan validasi radius clock ESS (mode Warn/Strict di Pengaturan Absensi). Kosongkan bila lokasi tanpa geofence.", "Used for ESS clock radius validation (Warn/Strict mode in Attendance Settings). Leave empty for locations without geofence.")}
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="l-latitude" className="text-[11px]">{t("Latitude", "Latitude")}</Label>
                <Input id="l-latitude" type="number" step="any" min={-90} max={90} value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} placeholder="-6.2563" className="font-mono text-xs" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="l-longitude" className="text-[11px]">{t("Longitude", "Longitude")}</Label>
                <Input id="l-longitude" type="number" step="any" min={-180} max={180} value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} placeholder="106.8654" className="font-mono text-xs" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="l-radius" className="text-[11px]">{t("Radius (m)", "Radius (m)")}</Label>
                <Input id="l-radius" type="number" min={1} value={form.radiusMeters} onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))} placeholder="200" className="font-mono text-xs" />
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">{t("radius meter, kosong = 200", "radius in meters, empty = 200")}</p>
          </div>
          {location && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
              <div>
                <Label className="text-xs font-bold">{t("Status Aktif", "Active Status")}</Label>
                <p className="text-[11px] text-slate-400">{t("Lokasi nonaktif tidak disarankan untuk penempatan baru", "Inactive locations are not recommended for new placements")}</p>
              </div>
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : location ? t("Simpan") : t("Buat Lokasi", "Create Location")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
