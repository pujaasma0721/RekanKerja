"use client";
// RekanKerja Medical — Rumah Sakit & Asuransi: master provider
// (padanan Hospital.jsp + InsuranceCompany.jsp → 1 view 2 tab).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";

interface FormState {
  id?: string; code: string; name: string; kind: string;
  city: string; address: string; phone: string;
}

const emptyForm: FormState = { code: "", name: "", kind: "HOSPITAL", city: "", address: "", phone: "" };

// peta label EN paralel untuk tab — render: t(tb.label, TAB_LABEL_EN[tb.key])
const TAB_LABEL_EN: Record<string, string> = {
  HOSPITAL: "Hospitals & Clinics",
  INSURANCE: "Insurance",
};

/** Task adv-search — field Advance Search master provider (client-side;
 *  TAMBAHAN di atas tab jenis — kind & active dipakai getter/opsi eksplisit). */
const PROVIDER_ADV_FIELDS: AdvFieldDef<ProviderUI>[] = [
  txt("code", "Kode", "Code"),
  txt("name", "Nama", "Name"),
  txt("city", "Kota", "City"),
  txt("address", "Alamat", "Address"),
  txt("phone", "Telepon", "Phone"),
  sel("kind", "Jenis", "Type", [
    ["HOSPITAL", "Rumah Sakit / Klinik / Apotek", "Hospital / Clinic / Pharmacy"],
    ["INSURANCE", "Perusahaan Asuransi", "Insurance Company"],
  ]),
  sel("active", "Aktif", "Active", [
    ["true", "Aktif", "Active"],
    ["false", "Non-aktif", "Inactive"],
  ], (r) => (r.active ? "true" : "false")),
];

export function MedicalProvidersPage() {
  const { t } = useI18n();
  const api = useApi<{ providers: ProviderUI[] }>("/api/rekankerja/medical/providers");
  const [tab, setTab] = useState<"HOSPITAL" | "INSURANCE">("HOSPITAL");
  // Task adv-search — kondisi advance search (filter tambahan di atas tab).
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const all = api.data?.providers ?? [];
  const rows = useMemo(
    () => filterRowsByAdv(all.filter((p) => p.kind === tab), adv, PROVIDER_ADV_FIELDS),
    [all, tab, adv],
  );

  const openNew = () => {
    setForm({ ...emptyForm, kind: tab });
    setDialog(true);
  };
  const openEdit = (p: ProviderUI) => {
    setForm({ id: p.id, code: p.code, name: p.name, kind: p.kind, city: p.city ?? "", address: p.address ?? "", phone: p.phone ?? "" });
    setDialog(true);
  };

  const save = async () => {
    if (!form.name.trim() || (!form.id && !form.code.trim())) { toast.error(t("Kode & nama wajib", "Code & name are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/medical/providers", "POST", {
        id: form.id, code: form.code, name: form.name, kind: form.kind,
        city: form.city || undefined, address: form.address || undefined, phone: form.phone || undefined,
      });
      toast.success(form.id ? t("Provider diperbarui", "Provider updated") : t("Provider ditambahkan", "Provider added"));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Master")}
        title={t("Rumah Sakit & Asuransi")}
        description={t("Direktori rumah sakit / klinik / apotek rekanan dan perusahaan asuransi — dipakai saat pengajuan klaim (padanan Hospital + Insurance Company)", "Directory of partner hospitals / clinics / pharmacies and insurance companies — used when submitting claims (equivalent to Hospital + Insurance Company)")}
        actions={(
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> {t("Provider Baru", "New Provider")}
          </Button>
        )}
      />

      <div className="mb-3 flex gap-2">
        {([
          { key: "HOSPITAL", label: "Rumah Sakit & Klinik", icon: Hospital, count: all.filter((p) => p.kind === "HOSPITAL").length },
          { key: "INSURANCE", label: "Asuransi", icon: ShieldCheck, count: all.filter((p) => p.kind === "INSURANCE").length },
        ] as const).map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-all",
              tab === tb.key
                ? "ov-soft ov-border-accent"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
            )}
          >
            <tb.icon className="h-3.5 w-3.5" /> {t(tb.label, TAB_LABEL_EN[tb.key])} ({tb.count})
          </button>
        ))}
        {/* Task adv-search — tombol di kanan toolbar tab (view hanya punya tab filter) */}
        <AdvSearchButton fields={PROVIDER_ADV_FIELDS} value={adv} onChange={setAdv} className="ml-auto" />
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : rows.length === 0 ? (
            <div className="p-6"><EmptyState title={t("Belum ada provider", "No providers yet")} description={t("Tambahkan rumah sakit rekanan atau perusahaan asuransi.", "Add a partner hospital or an insurance company.")} icon={tab === "HOSPITAL" ? Hospital : ShieldCheck} /></div>
          ) : (
            <div className="max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Nama")}</TableHead>
                    <TableHead>{t("Kota", "City")}</TableHead>
                    <TableHead>{t("Alamat")}</TableHead>
                    <TableHead>{t("Telepon")}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.code}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" />{p.city ?? "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-slate-500">{p.address ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-slate-400" />{p.phone ?? "—"}</span>
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {form.kind === "HOSPITAL" ? <Hospital className="h-5 w-5 ov-text-accent" /> : <ShieldCheck className="h-5 w-5 ov-text-accent" />}
              {form.id ? t("Ubah Provider", "Edit Provider") : t("Provider Baru", "New Provider")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Jenis *", "Type *")}</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOSPITAL">{t("Rumah Sakit / Klinik / Apotek", "Hospital / Clinic / Pharmacy")}</SelectItem>
                  <SelectItem value="INSURANCE">{t("Perusahaan Asuransi", "Insurance Company")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Kode *", "Code *")}</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(form.id)} placeholder={t("mis. RS-SIL", "e.g. RS-SIL")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Nama *", "Name *")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("mis. RS Siloam Surabaya", "e.g. Siloam Hospital Surabaya")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Kota", "City")}</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Telepon")}</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Alamat")}</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
