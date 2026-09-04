"use client";
// OneVity — ORGANISASI › Perusahaan: premium profile card + editable form + stats
import { useEffect, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingCards } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Pencil, Building2, MapPin, Phone, Mail, Globe, Hash, CalendarDays, Users, Network, BriefcaseBusiness, Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompanyData, CompanyRes } from "./types";

// ============ Edit dialog ============
function CompanyFormDialog({ open, onOpenChange, company, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  company: CompanyData | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    code: "", name: "", shortName: "", taxId: "", address: "", city: "", phone: "", email: "", website: "", currency: "IDR",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !company) return;
    setForm({
      code: company.code ?? "",
      name: company.name ?? "",
      shortName: company.shortName ?? "",
      taxId: company.taxId ?? "",
      address: company.address ?? "",
      city: company.city ?? "",
      phone: company.phone ?? "",
      email: company.email ?? "",
      website: company.website ?? "",
      currency: company.currency ?? "IDR",
    });
  }, [open, company]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode dan nama perusahaan wajib diisi"); return; }
    setSaving(true);
    try {
      await apiSend("/api/onevity/companies", "PATCH", {
        id: company?.id, ...form, shortName: form.shortName || null,
      });
      toast.success("Profil perusahaan diperbarui");
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan perubahan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Profil Perusahaan</DialogTitle>
          <DialogDescription>Perbarui data identitas dan kontak perusahaan.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="c-code">Kode Perusahaan</Label>
            <Input id="c-code" value={form.code} onChange={set("code")} className="font-mono text-xs uppercase" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-short">Nama Singkat</Label>
            <Input id="c-short" value={form.shortName} onChange={set("shortName")} placeholder="MII" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="c-name">Nama Lengkap (PT)</Label>
            <Input id="c-name" value={form.name} onChange={set("name")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-tax">NPWP</Label>
            <Input id="c-tax" value={form.taxId} onChange={set("taxId")} placeholder="01.234.567.8-901.000" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-city">Kota</Label>
            <Input id="c-city" value={form.city} onChange={set("city")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="c-addr">Alamat</Label>
            <Input id="c-addr" value={form.address} onChange={set("address")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-phone">Telepon</Label>
            <Input id="c-phone" value={form.phone} onChange={set("phone")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-web">Website</Label>
            <Input id="c-web" value={form.website} onChange={set("website")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-cur">Mata Uang</Label>
            <Input id="c-cur" value={form.currency} onChange={set("currency")} placeholder="IDR" className="uppercase" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : "Simpan Perubahan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Main view ============
export function CompanyView() {
  const { data, loading, error, refresh } = useApi<CompanyRes>("/api/onevity/companies");
  const [editOpen, setEditOpen] = useState(false);
  const company = data?.company ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="PERUSAHAAN & ORGANISASI"
        title="Perusahaan"
        description="Profil legal dan identitas perusahaan induk yang menjadi induk seluruh unit, posisi, dan karyawan."
        actions={
          <Button size="sm" className="h-10 px-4 font-bold" onClick={() => setEditOpen(true)} disabled={!company}>
            <Pencil className="h-4 w-4" /> Edit Profil
          </Button>
        }
      />

      {loading ? (
        <LoadingCards cards={2} />
      ) : error || !company ? (
        <EmptyState title="Data perusahaan tidak tersedia" description={error ?? "Belum ada perusahaan yang terdaftar pada sistem."} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ==== profile card ==== */}
          <Card className="overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800 lg:col-span-2">
            {/* gradient banner */}
            <div className="relative ov-hero px-6 pb-6 pt-7">
              <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(circle at 85% 20%, white 1.5px, transparent 1.5px), radial-gradient(circle at 60% 80%, white 1px, transparent 1px)", backgroundSize: "42px 42px, 28px 28px" }} />
              <div className="relative flex flex-wrap items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-extrabold text-white shadow-lg ring-1 ring-white/25 backdrop-blur">
                  {(company.shortName ?? company.code).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-extrabold tracking-tight text-white drop-shadow-sm">{company.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge className="border-white/25 bg-white/15 font-mono text-[10px] text-white hover:bg-white/15">{company.code}</Badge>
                    <Badge className="border-white/25 bg-white/15 text-[10px] text-white hover:bg-white/15">{company.currency}</Badge>
                    {company.active && (
                      <Badge className="border-white/25 bg-white/15 text-[10px] text-white hover:bg-white/15">
                        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-300" /> Aktif
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <CardContent className="space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow icon={Hash} label="NPWP" value={company.taxId} />
                <InfoRow icon={Landmark} label="Kota" value={company.city} />
                <InfoRow icon={MapPin} label="Alamat" value={company.address} className="sm:col-span-2" />
                <InfoRow icon={Phone} label="Telepon" value={company.phone} />
                <InfoRow icon={Mail} label="Email" value={company.email} />
                <InfoRow icon={Globe} label="Website" value={company.website} />
                <InfoRow icon={CalendarDays} label="Terdaftar Sejak" value={fmtDate(company.createdAt)} />
              </div>

              <div className="rounded-xl border ov-border-accent ov-soft p-4 text-xs leading-relaxed">
                <p className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                  <Building2 className="h-3.5 w-3.5" /> Entitas Induk
                </p>
                Seluruh unit organisasi, definisi posisi, dan data karyawan pada modul Human Resource Base terhubung ke perusahaan ini.
              </div>
            </CardContent>
          </Card>

          {/* ==== stat cards ==== */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <StatCard
              icon={Users}
              label="Karyawan Aktif"
              value={data?.stats.activeEmployees ?? 0}
              sub="berdasarkan status kepegawaian"
            />
            <StatCard
              icon={Network}
              label="Unit Organisasi"
              value={data?.stats.orgUnits ?? 0}
              sub="dari level CEO hingga sub-unit"
            />
            <StatCard
              icon={BriefcaseBusiness}
              label="Posisi Aktif"
              value={data?.stats.activePositions ?? 0}
              sub="definisi posisi aktif"
            />
          </div>
        </div>
      )}

      <CompanyFormDialog open={editOpen} onOpenChange={setEditOpen} company={company} onDone={refresh} />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, className }: { icon: React.ElementType; label: string; value: string | null; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
        <p className="break-words text-sm font-semibold text-stone-800 dark:text-stone-200">{value || "—"}</p>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: number; sub: string }) {
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm transition hover:shadow-md dark:border-stone-800">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ov-tile shadow-md">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-extrabold tabular-nums leading-none text-stone-900 dark:text-stone-50">{value}</p>
          <CardTitle className="mt-1 text-sm font-semibold">{label}</CardTitle>
          <CardDescription className="mt-0.5 text-[11px]">{sub}</CardDescription>
        </div>
      </CardContent>
    </Card>
  );
}
