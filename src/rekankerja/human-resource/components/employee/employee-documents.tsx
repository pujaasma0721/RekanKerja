"use client";
// RekanKerja HR — Dokumen Karyawan (T16-ATTACH). ==============================
// Standalone view (siap di-wire koordinator ke menu modul HR — export default).
// Fitur: daftar dokumen (KTP/Paspor/SIM/KK/NPWP/Ijazah/Sertifikat/Kontrak/
// Lainnya) + filter kedaluwarsa 30/60/90 hari + dialog tambah/edit (pilih
// karyawan, jenis, nomor, tanggal terbit/kedaluwarsa, upload lampiran) +
// lihat lampiran (tab baru) + hapus.
import { useMemo, useState } from "react";
import { useApi, apiSend, apiUpload } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { AttachmentUploadArea, AttachmentChips, attachmentUrl, fmtSize } from "@/rekankerja/shared/components/attachment-upload";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FileBadge, Plus, Search, Trash2, Pencil, Eye, CalendarClock } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, dt, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";

const DOC_TYPES = ["KTP", "Paspor", "SIM", "KK", "NPWP", "Ijazah", "Sertifikat", "Kontrak", "Lainnya"] as const;

const DOC_TYPE_LABEL: Record<string, string> = {
  KTP: "KTP", Paspor: "Paspor", SIM: "SIM", KK: "Kartu Keluarga", NPWP: "NPWP",
  Ijazah: "Ijazah", Sertifikat: "Sertifikat", Kontrak: "Kontrak", Lainnya: "Lainnya",
};
const DOC_TYPE_LABEL_EN: Record<string, string> = {
  KTP: "ID Card", Paspor: "Passport", SIM: "Driving License", KK: "Family Card", NPWP: "Tax ID",
  Ijazah: "Diploma", Sertifikat: "Certificate", Kontrak: "Contract", Lainnya: "Other",
};

/** Task adv-e — opsi Advance Search jenis dokumen (label dwibahasa reuse peta file). */
const ADV_DOC_TYPES: [string, string, string][] = DOC_TYPES.map((ty) => [ty, DOC_TYPE_LABEL[ty] ?? ty, DOC_TYPE_LABEL_EN[ty] ?? ty]);

/** Task adv-e — field Advance Search dokumen karyawan (client-side, tambahan di atas query lama). */
const ADV_FIELDS: AdvFieldDef<DocumentRowUI>[] = [
  txt("employeeName", "Karyawan", "Employee"),
  txt("employeeNo", "No. Karyawan", "Employee No."),
  sel("docType", "Jenis", "Type", ADV_DOC_TYPES),
  txt("docNumber", "Nomor", "Number"),
  dt("issuedAt", "Terbit", "Issued"),
  dt("expiresAt", "Kedaluwarsa", "Expiry"),
  txt("notes", "Catatan", "Notes"),
];

const EXPIRY_FILTERS = [
  { key: "", label: "Semua", en: "All" },
  { key: "30", label: "≤ 30 hari", en: "≤ 30 days" },
  { key: "60", label: "≤ 60 hari", en: "≤ 60 days" },
  { key: "90", label: "≤ 90 hari", en: "≤ 90 days" },
];

interface EmployeeOptionUI {
  id: string; employeeNo: string; fullName: string;
}

interface DocumentRowUI {
  id: string; employeeId: string; employeeNo: string; employeeName: string;
  docType: string; docNumber: string | null;
  issuedAt: string | null; expiresAt: string | null; notes: string | null;
  attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
}

interface DialogForm {
  id?: string;
  employeeId: string;
  docType: string;
  docNumber: string;
  issuedAt: string;
  expiresAt: string;
  notes: string;
}

const emptyForm: DialogForm = {
  employeeId: "", docType: "KTP", docNumber: "", issuedAt: "", expiresAt: "", notes: "",
};

function docTypeLabel(
  t: (id: string, en?: string, vars?: Record<string, string | number>) => string,
  docType: string,
): string {
  return t(DOC_TYPE_LABEL[docType] ?? docType, DOC_TYPE_LABEL_EN[docType] ?? docType);
}

/** Status kedaluwarsa: sudah lewat / ≤30 hari / ≤60 / aman. */
function expiryInfo(
  expiresAt: string | null,
  t: (id: string, en?: string, vars?: Record<string, string | number>) => string,
) {
  if (!expiresAt) return { kind: "none" as const, label: "—" };
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return { kind: "none" as const, label: "—" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { kind: "expired" as const, label: t("Kedaluwarsa {n} hari lalu", "Expired {n} days ago", { n: Math.abs(days) }) };
  if (days === 0) return { kind: "soon" as const, label: t("Berakhir hari ini", "Expires today") };
  if (days <= 30) return { kind: "soon" as const, label: t("{n} hari lagi", "in {n} days", { n: days }) };
  if (days <= 90) return { kind: "warn" as const, label: t("{n} hari lagi", "in {n} days", { n: days }) };
  return { kind: "ok" as const, label: t("{n} hari lagi", "in {n} days", { n: days }) };
}

export function EmployeeDocumentsView() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [expiryFilter, setExpiryFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [query, setQuery] = useState("");
  // Task adv-e — Advance Search (filter tambahan, tidak menggantikan query lama)
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<DialogForm>(emptyForm);
  const [file, setFile] = useState<File[]>([]);

  const api = useApi<{ documents: DocumentRowUI[]; stats: { total: number; expired: number; expiring30: number } }>(
    `/api/rekankerja/employee-documents${expiryFilter ? `?expiring=${expiryFilter}` : ""}${employeeFilter ? `${expiryFilter ? "&" : "?"}employeeId=${employeeFilter}` : ""}`,
  );
  const employeesApi = useApi<{ managers: EmployeeOptionUI[] }>("/api/rekankerja/employee-options");

  const employees = employeesApi.data?.managers ?? [];
  const documents = useMemo(
    () => filterRowsByAdv(
      (api.data?.documents ?? []).filter((d) =>
        !query ||
        d.employeeName.toLowerCase().includes(query.toLowerCase()) ||
        d.employeeNo.toLowerCase().includes(query.toLowerCase()) ||
        (d.docNumber ?? "").toLowerCase().includes(query.toLowerCase()),
      ),
      adv,
      ADV_FIELDS,
    ),
    [api.data, query, adv],
  );
  const stats = api.data?.stats;

  const openCreate = () => {
    setForm({ ...emptyForm, employeeId: employees[0]?.id ?? "" });
    setFile([]);
    setDialog(true);
  };

  const openEdit = (d: DocumentRowUI) => {
    setForm({
      id: d.id,
      employeeId: d.employeeId,
      docType: d.docType,
      docNumber: d.docNumber ?? "",
      issuedAt: d.issuedAt ? String(d.issuedAt).slice(0, 10) : "",
      expiresAt: d.expiresAt ? String(d.expiresAt).slice(0, 10) : "",
      notes: d.notes ?? "",
    });
    setFile([]);
    setDialog(true);
  };

  const submit = async () => {
    if (!form.employeeId) { toast.error(t("Karyawan wajib dipilih", "Employee is required")); return; }
    setBusy(true);
    try {
      if (form.id) {
        // PATCH — ubah metadata (JSON; lampiran tidak diganti saat edit).
        await apiSend("/api/rekankerja/employee-documents", "PATCH", {
          id: form.id,
          docType: form.docType,
          docNumber: form.docNumber || null,
          issuedAt: form.issuedAt || null,
          expiresAt: form.expiresAt || null,
          notes: form.notes || null,
        });
        toast.success(t("Dokumen diperbarui", "Document updated"));
      } else {
        // POST — multipart (bila ada file lampiran).
        const fd = new FormData();
        fd.append("employeeId", form.employeeId);
        fd.append("docType", form.docType);
        fd.append("docNumber", form.docNumber);
        fd.append("issuedAt", form.issuedAt);
        fd.append("expiresAt", form.expiresAt);
        fd.append("notes", form.notes);
        if (file[0]) fd.append("file", file[0]);
        await apiUpload("/api/rekankerja/employee-documents", fd);
        toast.success(t("Dokumen ditambahkan", "Document added"));
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan dokumen", "Failed to save document"));
    } finally { setBusy(false); }
  };

  const remove = async (d: DocumentRowUI) => {
    if (!window.confirm(t("Hapus dokumen {ty} milik {name}? Lampiran ikut terhapus.", "Delete {ty} of {name}? The attachment is deleted too.", { ty: docTypeLabel(t, d.docType), name: d.employeeName }))) return;
    try {
      await apiSend(`/api/rekankerja/employee-documents?id=${d.id}`, "DELETE");
      toast.success(t("Dokumen dihapus", "Document deleted"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus dokumen", "Failed to delete document"));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL HUMAN RESOURCE", "HUMAN RESOURCE MODULE")}
        title={t("Dokumen Karyawan", "Employee Documents")}
        description={t(
          "Arsip dokumen kepegawaian (KTP, Paspor, SIM, KK, NPWP, Ijazah, Sertifikat, Kontrak) dengan lampiran file dan pemantauan kedaluwarsa — dokumen SIM/Paspor yang hampir berakhir terlihat pada filter 30/60/90 hari.",
          "Employee document archive (ID card, passport, driving license, family card, tax ID, diploma, certificate, contract) with file attachments and expiry monitoring — documents about to expire appear in the 30/60/90-day filter.",
        )}
        actions={
          perms.can("hr", "directory", "create") && (
            <Button onClick={openCreate} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Tambah Dokumen", "Add Document")}
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {EXPIRY_FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            onClick={() => setExpiryFilter(f.key)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-all",
              expiryFilter === f.key
                ? "ov-soft ov-border-accent"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {t(f.label, f.en)}
          </button>
        ))}
        {stats && (
          <span className="ml-1 text-[11px] font-bold text-slate-400">
            {t("{n} dokumen · {e} kedaluwarsa · {s} ≤30 hari", "{n} documents · {e} expired · {s} ≤30 days", { n: stats.total, e: stats.expired, s: stats.expiring30 })}
          </span>
        )}
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari nama / nomor…", "Search name / number…")} className="pl-8" />
        </div>
        <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} />
        <Select value={employeeFilter || "all"} onValueChange={(v) => setEmployeeFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder={t("Semua karyawan", "All employees")} /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all" className="text-sm">{t("Semua karyawan", "All employees")}</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id} className="text-sm">{e.employeeNo} — {e.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : documents.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileBadge}
                title={t("Belum ada dokumen", "No documents yet")}
                description={t("Tambahkan dokumen kepegawaian pertama — pilih karyawan, jenis dokumen, dan unggah file (opsional).", "Add the first employee document — pick an employee, document type, and upload a file (optional).")}
              />
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Karyawan", "Employee")}</TableHead>
                    <TableHead>{t("Jenis", "Type")}</TableHead>
                    <TableHead>{t("Nomor", "Number")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Terbit", "Issued")}</TableHead>
                    <TableHead>{t("Kedaluwarsa", "Expiry")}</TableHead>
                    <TableHead>{t("Lampiran", "Attachment")}</TableHead>
                    <TableHead className="text-right">{t("Aksi", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((d) => {
                    const exp = expiryInfo(d.expiresAt, t);
                    return (
                      <TableRow key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <TableCell>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{d.employeeName}</p>
                          <p className="text-xs text-slate-500">{d.employeeNo}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-bold">{docTypeLabel(t, d.docType)}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{d.docNumber || <span className="text-slate-400">—</span>}</TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {d.issuedAt ? new Date(d.issuedAt).toLocaleDateString(t("id-ID", "en-US")) : <span className="text-slate-400">—</span>}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
                              exp.kind === "expired" && "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
                              exp.kind === "soon" && "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
                              exp.kind === "warn" && "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
                              exp.kind === "ok" && "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                            )}
                          >
                            {exp.kind !== "none" && <CalendarClock className="h-3 w-3" />}
                            {exp.label}
                          </span>
                          {d.expiresAt && <p className="mt-0.5 text-[10px] text-slate-400">{new Date(d.expiresAt).toLocaleDateString(t("id-ID", "en-US"))}</p>}
                        </TableCell>
                        <TableCell>
                          {d.attachment ? (
                            <a
                              href={attachmentUrl(d.attachment.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:underline dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              title={`${d.attachment.fileName} · ${fmtSize(d.attachment.sizeBytes)}`}
                            >
                              <Eye className="h-3 w-3 shrink-0 text-slate-400" />
                              <span className="truncate">{d.attachment.fileName}</span>
                              <span className="shrink-0 text-[9px] font-bold text-slate-400">{fmtSize(d.attachment.sizeBytes)}</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-slate-400">{t("tanpa file", "no file")}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {perms.can("hr", "directory", "update") && (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(d)} title={t("Ubah", "Edit")}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {perms.can("hr", "directory", "delete") && (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600" onClick={() => remove(d)} title={t("Hapus", "Delete")}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==== dialog tambah / edit ==== */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileBadge className="h-5 w-5 ov-text-accent" />
              {form.id ? t("Ubah Dokumen", "Edit Document") : t("Tambah Dokumen", "Add Document")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Karyawan *", "Employee *")}</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })} disabled={!!form.id}>
                <SelectTrigger><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.id && (
                <p className="text-[11px] text-slate-500">{t("Karyawan tidak dapat diganti saat mengubah.", "Employee cannot be changed while editing.")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("Jenis Dokumen *", "Document Type *")}</Label>
              <Select value={form.docType} onValueChange={(v) => setForm({ ...form, docType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((ty) => (
                    <SelectItem key={ty} value={ty}>{docTypeLabel(t, ty)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Nomor Dokumen", "Document Number")}</Label>
              <Input value={form.docNumber} onChange={(e) => setForm({ ...form, docNumber: e.target.value })} placeholder={t("mis. 3274012345670001", "e.g. 3274012345670001")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tanggal Terbit", "Issued Date")}</Label>
              <Input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tanggal Kedaluwarsa", "Expiry Date")}</Label>
              <Input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Catatan", "Notes")}</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder={t("opsional", "optional")} />
            </div>
          </div>

          {form.id ? (
            <div className="space-y-1.5">
              <Label>{t("Lampiran", "Attachment")}</Label>
              <AttachmentChips
                attachments={documents.filter((d) => d.id === form.id && d.attachment).map((d) => ({ ...(d.attachment as { id: string; fileName: string; mimeType: string; sizeBytes: number }) }))}
              />
              <p className="text-[11px] text-slate-500">{t("Lampiran hanya dapat diganti dengan menambah dokumen baru.", "The attachment can only be replaced by adding a new document.")}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{t("Lampiran (opsional)", "Attachment (optional)")}</Label>
              <AttachmentUploadArea files={file} onChange={(f) => setFile(f.slice(0, 1))} compact />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : form.id ? t("Simpan Perubahan", "Save Changes") : t("Tambah Dokumen", "Add Document")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EmployeeDocumentsView;
