"use client";
// OneVity Medical — Rumah Sakit & Asuransi: master provider
// (padanan Hospital.jsp + InsuranceCompany.jsp → 1 view 2 tab).
import { useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ProviderUI } from "./medical-types";
import { Hospital, ShieldCheck, Plus, Pencil, MapPin, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormState {
  id?: string; code: string; name: string; kind: string;
  city: string; address: string; phone: string;
}

const emptyForm: FormState = { code: "", name: "", kind: "HOSPITAL", city: "", address: "", phone: "" };

export function MedicalProvidersPage() {
  const api = useApi<{ providers: ProviderUI[] }>("/api/onevity/medical/providers");
  const [tab, setTab] = useState<"HOSPITAL" | "INSURANCE">("HOSPITAL");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const all = api.data?.providers ?? [];
  const rows = all.filter((p) => p.kind === tab);

  const openNew = () => {
    setForm({ ...emptyForm, kind: tab });
    setDialog(true);
  };
  const openEdit = (p: ProviderUI) => {
    setForm({ id: p.id, code: p.code, name: p.name, kind: p.kind, city: p.city ?? "", address: p.address ?? "", phone: p.phone ?? "" });
    setDialog(true);
  };

  const save = async () => {
    if (!form.name.trim() || (!form.id && !form.code.trim())) { toast.error("Kode & nama wajib"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/medical/providers", "POST", {
        id: form.id, code: form.code, name: form.name, kind: form.kind,
        city: form.city || undefined, address: form.address || undefined, phone: form.phone || undefined,
      });
      toast.success(form.id ? "Provider diperbarui" : "Provider ditambahkan");
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MEDICAL · MASTER"
        title="Rumah Sakit & Asuransi"
        description="Direktori rumah sakit / klinik / apotek rekanan dan perusahaan asuransi — dipakai saat pengajuan klaim (padanan Hospital + Insurance Company oranHR)"
        actions={(
          <Button onClick={openNew} className="bg-rose-600 hover:bg-rose-700">
            <Plus className="h-4 w-4" /> Provider Baru
          </Button>
        )}
      />

      <div className="mb-3 flex gap-2">
        {([
          { key: "HOSPITAL", label: "Rumah Sakit & Klinik", icon: Hospital, count: all.filter((p) => p.kind === "HOSPITAL").length },
          { key: "INSURANCE", label: "Asuransi", icon: ShieldCheck, count: all.filter((p) => p.kind === "INSURANCE").length },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-all",
              tab === t.key
                ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label} ({t.count})
          </button>
        ))}
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : rows.length === 0 ? (
            <div className="p-6"><EmptyState title="Belum ada provider" description="Tambahkan rumah sakit rekanan atau perusahaan asuransi." icon={tab === "HOSPITAL" ? Hospital : ShieldCheck} /></div>
          ) : (
            <div className="max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Kota</TableHead>
                    <TableHead>Alamat</TableHead>
                    <TableHead>Telepon</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-xs text-stone-500">{p.code}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-stone-400" />{p.city ?? "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-stone-500">{p.address ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-stone-400" />{p.phone ?? "—"}</span>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {form.kind === "HOSPITAL" ? <Hospital className="h-5 w-5 text-rose-600" /> : <ShieldCheck className="h-5 w-5 text-rose-600" />}
              {form.id ? "Ubah Provider" : "Provider Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Jenis *</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOSPITAL">Rumah Sakit / Klinik / Apotek</SelectItem>
                  <SelectItem value="INSURANCE">Perusahaan Asuransi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Kode *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(form.id)} placeholder="mis. RS-SIL" />
              </div>
              <div className="space-y-1.5">
                <Label>Nama *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. RS Siloam Surabaya" />
              </div>
              <div className="space-y-1.5">
                <Label>Kota</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Telepon</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Alamat</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={save} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
