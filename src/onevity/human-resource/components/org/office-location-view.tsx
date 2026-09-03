"use client";
// OneVity — PERUSAHAAN & ORGANISASI › Kantor & Lokasi Kerja: master company office + work location (CRUD)
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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

// ============ types (kontrak API Task 25) ============
interface OfficeRow {
  id: string; code: string; name: string;
  address: string | null; city: string | null; phone: string | null;
  active: boolean; employeeCount: number; locationCount: number;
}
interface OfficesRes { offices: OfficeRow[] }

interface LocationRow {
  id: string; code: string; name: string;
  address: string | null; city: string | null; active: boolean;
  officeId: string | null; office: { code: string; name: string } | null;
  employeeCount: number;
}
interface LocationsRes { locations: LocationRow[] }

// ============ shared bits ============
function ActivePill({ active }: { active: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      active
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
        : "border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-500/25 dark:bg-stone-500/10 dark:text-stone-400",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-stone-400")} />
      {active ? "Aktif" : "Nonaktif"}
    </span>
  );
}

function MiniStat({ label, value, hint, icon: Icon, gradient }: {
  label: string; value: string; hint?: string; icon: React.ElementType; gradient: string;
}) {
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", gradient)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
          <p className="text-2xl font-extrabold text-stone-900 dark:text-stone-50">{value}</p>
          {hint && <p className="text-[10px] font-semibold text-stone-400">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Main view ============
export function OfficeLocationView() {
  const officesApi = useApi<OfficesRes>("/api/onevity/company-offices");
  const locationsApi = useApi<LocationsRes>("/api/onevity/work-locations");
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
          eyebrow="PERUSAHAAN & ORGANISASI"
          title="Kantor & Lokasi Kerja"
          description="Master kantor perusahaan (company office) dan lokasi kerja — dimensi penempatan karyawan & pencocokan approval berjenjang."
        />
        <LoadingRows rows={6} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="PERUSAHAAN & ORGANISASI"
        title="Kantor & Lokasi Kerja"
        description="Master kantor perusahaan (company office) dan lokasi kerja — dimensi penempatan karyawan & pencocokan approval berjenjang."
        actions={
          <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Muat Ulang</span>
          </Button>
        }
      />

      {/* stat ringkas */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniStat label="Kantor Perusahaan" value={String(offices.length)} hint={`${activeOffices} aktif`} icon={Building2} gradient="from-emerald-500 to-teal-600" />
        <MiniStat label="Lokasi Kerja" value={String(locations.length)} hint={`${activeLocations} aktif`} icon={MapPin} gradient="from-amber-400 to-orange-500" />
        <MiniStat label="Karyawan Terpenempatan" value={String(placedEmployees)} hint="karyawan aktif ber-kantor / ber-lokasi" icon={Users} gradient="from-teal-500 to-emerald-600" />
      </div>

      <Tabs defaultValue="offices">
        <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="offices" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <Building2 className="h-3.5 w-3.5" /> Kantor Perusahaan
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <MapPin className="h-3.5 w-3.5" /> Lokasi Kerja
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleActive = async (o: OfficeRow) => {
    try {
      await apiSend("/api/onevity/company-offices", "PATCH", { id: o.id, active: !o.active });
      toast.success(o.active ? `Kantor ${o.code} dinonaktifkan` : `Kantor ${o.code} diaktifkan`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengubah status kantor");
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/onevity/company-offices?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(`Kantor ${editing.code} dihapus`);
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus kantor");
    } finally {
      setDeleting(false);
    }
  };

  const totalEmployees = offices.reduce((a, o) => a + o.employeeCount, 0);

  return (
    <>
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div>
              <p className="text-[13px] font-bold">Master Kantor Perusahaan</p>
              <p className="text-[11px] text-stone-400">{offices.length} kantor · {totalEmployees} karyawan terpenempat</p>
            </div>
            <Button size="sm" className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Tambah Kantor
            </Button>
          </div>

          {loading ? (
            <div className="p-5"><LoadingRows rows={5} /></div>
          ) : error && offices.length === 0 ? (
            <div className="p-5"><EmptyState title="Gagal memuat kantor" description={error} icon={<Building2 className="h-6 w-6" />} /></div>
          ) : offices.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada kantor" description="Buat kantor perusahaan pertama dengan tombol Tambah Kantor." icon={<Building2 className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Kantor</TableHead>
                    <TableHead className="text-[11px] font-bold">Kota</TableHead>
                    <TableHead className="text-[11px] font-bold">Alamat</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Lokasi</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offices.map((o) => (
                    <TableRow key={o.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-mono text-[12px] font-extrabold text-stone-800 dark:text-stone-200">{o.code}</p>
                            <p className="max-w-[220px] truncate text-[11px] text-stone-400">{o.name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-stone-600 dark:text-stone-300">{o.city || "—"}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <p className="truncate text-xs text-stone-500 dark:text-stone-400" title={o.address ?? undefined}>{o.address || "—"}</p>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                          <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {o.employeeCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                          <MapPin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> {o.locationCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleActive(o)} title={o.active ? "Nonaktifkan kantor" : "Aktifkan kantor"}>
                          <ActivePill active={o.active} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(o); setFormOpen(true); }} aria-label={`Ubah kantor ${o.code}`}>
                            <Pencil className="h-3.5 w-3.5 text-stone-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => { setEditing(o); setDeleteOpen(true); }} aria-label={`Hapus kantor ${o.code}`}>
                            <Trash2 className="h-3.5 w-3.5 text-stone-400" />
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
            <AlertDialogTitle>Hapus kantor {editing?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Kantor yang masih dipakai lokasi kerja atau struktur approval berjenjang tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? "Menghapus…" : "Ya, Hapus"}
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/onevity/work-locations?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(`Lokasi ${editing.code} dihapus`);
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus lokasi");
    } finally {
      setDeleting(false);
    }
  };

  const totalEmployees = locations.reduce((a, l) => a + l.employeeCount, 0);

  return (
    <>
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div>
              <p className="text-[13px] font-bold">Master Lokasi Kerja</p>
              <p className="text-[11px] text-stone-400">{locations.length} lokasi · {totalEmployees} karyawan terpenempat</p>
            </div>
            <Button size="sm" className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Tambah Lokasi
            </Button>
          </div>

          {loading ? (
            <div className="p-5"><LoadingRows rows={5} /></div>
          ) : error && locations.length === 0 ? (
            <div className="p-5"><EmptyState title="Gagal memuat lokasi" description={error} icon={<MapPin className="h-6 w-6" />} /></div>
          ) : locations.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada lokasi kerja" description="Buat lokasi kerja pertama dengan tombol Tambah Lokasi." icon={<MapPin className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Lokasi</TableHead>
                    <TableHead className="text-[11px] font-bold">Kantor Induk</TableHead>
                    <TableHead className="text-[11px] font-bold">Kota</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((l) => (
                    <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
                            <MapPin className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-mono text-[12px] font-extrabold text-stone-800 dark:text-stone-200">{l.code}</p>
                              {!l.active && <Badge variant="outline" className="text-[9px] font-bold text-stone-400">NONAKTIF</Badge>}
                            </div>
                            <p className="max-w-[220px] truncate text-[11px] text-stone-400">{l.name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {l.office ? (
                          <div className="min-w-0">
                            <Badge variant="outline" className="font-mono text-[10px] font-semibold">{l.office.code}</Badge>
                            <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-stone-400">{l.office.name}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">— Tanpa kantor —</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-stone-600 dark:text-stone-300">{l.city || "—"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                          <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {l.employeeCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(l); setFormOpen(true); }} aria-label={`Ubah lokasi ${l.code}`}>
                            <Pencil className="h-3.5 w-3.5 text-stone-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => { setEditing(l); setDeleteOpen(true); }} aria-label={`Hapus lokasi ${l.code}`}>
                            <Trash2 className="h-3.5 w-3.5 text-stone-400" />
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
            <AlertDialogTitle>Hapus lokasi {editing?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Lokasi yang masih dipakai penempatan karyawan atau struktur approval berjenjang tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? "Menghapus…" : "Ya, Hapus"}
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
  const [form, setForm] = useState({ code: "", name: "", city: "", address: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: office?.code ?? "",
      name: office?.name ?? "",
      city: office?.city ?? "",
      address: office?.address ?? "",
      phone: office?.phone ?? "",
    });
  }, [open, office]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode dan nama kantor wajib diisi"); return; }
    setSaving(true);
    try {
      if (office) {
        await apiSend("/api/onevity/company-offices", "PATCH", {
          id: office.id,
          name: form.name.trim(),
          city: form.city.trim(),
          address: form.address.trim(),
          phone: form.phone.trim(),
        });
        toast.success(`Kantor ${office.code} berhasil diperbarui`);
      } else {
        const payload = {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
        };
        await apiSend("/api/onevity/company-offices", "POST", payload);
        toast.success(`Kantor ${payload.code} berhasil dibuat`);
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan kantor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{office ? `Ubah Kantor ${office.code}` : "Kantor Baru"}</DialogTitle>
          <DialogDescription>
            {office ? "Perbarui profil kantor perusahaan beserta kontaknya." : "Tambahkan kantor perusahaan (company office) baru — dimensi penempatan & approval berjenjang."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="o-code">Kode Kantor</Label>
              <Input id="o-code" value={form.code} disabled={!!office} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="OFF-JKT" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="o-name">Nama Kantor</Label>
              <Input id="o-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Kantor Pusat Jakarta" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="o-city">Kota</Label>
              <Input id="o-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Jakarta Timur" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="o-phone">Telepon</Label>
              <Input id="o-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="021-4600808" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="o-address">Alamat</Label>
            <Input id="o-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Jl. Industri Raya Kav. 25" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : office ? "Simpan" : "Buat Kantor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Dialog form lokasi ============
function LocationFormDialog({ open, onOpenChange, location, offices, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; location: LocationRow | null; offices: OfficeRow[]; onDone: () => void;
}) {
  const [form, setForm] = useState({ code: "", name: "", officeId: "", city: "", address: "", active: true });
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
    });
  }, [open, location]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode dan nama lokasi wajib diisi"); return; }
    setSaving(true);
    try {
      if (location) {
        await apiSend("/api/onevity/work-locations", "PATCH", {
          id: location.id,
          name: form.name.trim(),
          officeId: form.officeId || null,
          city: form.city.trim(),
          address: form.address.trim(),
          active: form.active,
        });
        toast.success(`Lokasi ${location.code} berhasil diperbarui`);
      } else {
        const payload = {
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          officeId: form.officeId || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
        };
        await apiSend("/api/onevity/work-locations", "POST", payload);
        toast.success(`Lokasi ${payload.code} berhasil dibuat`);
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan lokasi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{location ? `Ubah Lokasi ${location.code}` : "Lokasi Kerja Baru"}</DialogTitle>
          <DialogDescription>
            {location ? "Perbarui profil lokasi kerja dan kantor induknya." : "Tambahkan lokasi kerja (work location) baru — dimensi penempatan & approval berjenjang."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-code">Kode Lokasi</Label>
              <Input id="l-code" value={form.code} disabled={!!location} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="LOC-PRD-C" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-name">Nama Lokasi</Label>
              <Input id="l-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Production Line C" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="l-office">Kantor Induk</Label>
            <Select value={form.officeId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, officeId: v === "none" ? "" : v }))}>
              <SelectTrigger id="l-office" className="mt-1"><SelectValue placeholder="Pilih kantor induk (opsional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tanpa kantor —</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.code} — {o.name}{!o.active ? " (nonaktif)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-stone-400">Lokasi tanpa kantor induk tetap valid sebagai penempatan mandiri.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-city">Kota</Label>
              <Input id="l-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="Jakarta Timur" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-address">Alamat</Label>
              <Input id="l-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Kawasan Industri Pulogadung" />
            </div>
          </div>
          {location && (
            <div className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2.5 dark:border-stone-800">
              <div>
                <Label className="text-xs font-bold">Status Aktif</Label>
                <p className="text-[11px] text-stone-400">Lokasi nonaktif tidak disarankan untuk penempatan baru</p>
              </div>
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : location ? "Simpan" : "Buat Lokasi"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
