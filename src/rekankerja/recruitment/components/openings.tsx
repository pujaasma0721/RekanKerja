"use client";
// RekanKerja Recruitment F2 — view "Lowongan": JobOpportunity (JO) master-detail
// + slot (JobOpening per PR) + kanal & biaya (JobOpeningMethod).
// Padanan JobOpportunity.jsp oranHR §2.4 analisa; server-side pagination +
// advance search `&` + filter status + sort (pola pr-list.tsx).
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { encodeAdvParam, type AdvSearch, type AdvFieldDef, txt, dt, sel } from "@/rekankerja/shared/lib/adv-search";
import type { JoRow, OpeningSlotRow, MethodRow, JoStats } from "@/rekankerja/recruitment/services/opening-service";
import type { PrRowUI } from "./recruitment-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  Megaphone, Plus, Search, Send, Ban, Archive, Pencil, Trash2, Eye, ChevronLeft, ChevronRight,
  Wallet, MapPin, MoreHorizontal, Layers3, UsersRound, CalendarRange,
} from "lucide-react";

const PAGE_SIZE = 10;

/** tanggal tampilan pendek dwibahasa (pola pr-list) */
function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- label domain (lokal — F2) ----------

const JO_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Draft", label: "Draft", labelEn: "Draft" },
  { key: "Posted", label: "Terposting", labelEn: "Posted" },
  { key: "Closed", label: "Ditutup", labelEn: "Closed" },
  { key: "Obsolete", label: "Usang", labelEn: "Obsolete" },
];
const JO_LABEL: Record<string, string> = Object.fromEntries(JO_STATUSES.map((s) => [s.key, s.label]));
const JO_LABEL_EN: Record<string, string> = Object.fromEntries(JO_STATUSES.map((s) => [s.key, s.labelEn]));
const JO_TONE: Record<string, string> = { Draft: "slate", Posted: "emerald", Closed: "zinc", Obsolete: "rose" };

const SLOT_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Open", label: "Terbuka", labelEn: "Open" },
  { key: "Fulfilled", label: "Terpenuhi", labelEn: "Fulfilled" },
  { key: "Closed", label: "Ditutup", labelEn: "Closed" },
];
const SLOT_LABEL: Record<string, string> = Object.fromEntries(SLOT_STATUSES.map((s) => [s.key, s.label]));
const SLOT_LABEL_EN: Record<string, string> = Object.fromEntries(SLOT_STATUSES.map((s) => [s.key, s.labelEn]));
const SLOT_TONE: Record<string, string> = { Open: "emerald", Fulfilled: "teal", Closed: "zinc" };

/** Pill status JO/slot — pola PrStatusPill pr-list. */
function JoPill({ status, kind }: { status: string; kind: "jo" | "slot" }) {
  const { t } = useI18n();
  const tone = (kind === "jo" ? JO_TONE : SLOT_TONE)[status] ?? "slate";
  const cls: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
    rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
    zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
  };
  const dot: Record<string, string> = {
    slate: "bg-slate-400", amber: "bg-amber-500", emerald: "bg-emerald-500", rose: "bg-rose-500",
    teal: "bg-teal-500", zinc: "bg-zinc-400",
  };
  const label = kind === "jo" ? (JO_LABEL[status] ?? status) : (SLOT_LABEL[status] ?? status);
  const labelEn = kind === "jo" ? (JO_LABEL_EN[status] ?? status) : (SLOT_LABEL_EN[status] ?? status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", cls[tone], dot[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[tone])} />
      {t(label, labelEn)}
    </span>
  );
}

interface ListResp { rows: JoRow[]; total: number; stats: JoStats }

// Advance search — SERVER-side (whitelist JO_ADV_FIELDS di opening-service).
const ADV_FIELDS: AdvFieldDef<Record<string, unknown>>[] = [
  txt("refNo", "Nomor JO", "JO No."),
  txt("title", "Judul Lowongan", "Opening Title"),
  sel("status", "Status JO", "JO Status", JO_STATUSES.map((s): [string, string, string] => [s.key, s.label, s.labelEn])),
  txt("contactPerson", "Kontak", "Contact"),
  txt("preparedBy", "Disiapkan Oleh", "Prepared By"),
  dt("datePrepared", "Tanggal Disiapkan", "Date Prepared"),
  dt("datePosted", "Tanggal Posting", "Date Posted"),
  dt("lastAcceptDate", "Batas Terakhir Lamaran", "Last Accept Date"),
  txt("prNo", "Nomor PR (slot)", "PR No. (slot)"),
  txt("position", "Posisi (slot)", "Position (slot)"),
  sel("slotStatus", "Status Slot", "Slot Status", SLOT_STATUSES.map((s): [string, string, string] => [s.key, s.label, s.labelEn])),
  txt("location", "Lokasi Kerja (slot)", "Work Location (slot)"),
];

// ---------- master & opsi ringan ----------

interface MasterOpt { id: string; code: string; name?: string | null; title?: string | null; active?: boolean }
interface WorkLocationOpt { id: string; code: string; name: string; city: string | null; active: boolean }

// ---------- form state ----------

interface SlotForm {
  prId: string;
  titleToShow: string;
  workLocationId: string;
  salaryMin: string;
  salaryMax: string;
  jobDescSummary: string;
  jobSpecSummary: string;
}

const emptySlot = (): SlotForm => ({
  prId: "", titleToShow: "", workLocationId: "", salaryMin: "", salaryMax: "", jobDescSummary: "", jobSpecSummary: "",
});

interface HeaderForm {
  title: string;
  contactPerson: string;
  lastAcceptDate: string;
  content: string;
  // F5 — matri internal: khusus internal (tidak pernah tayang publik) +
  // jendela internal-first (sebelum tanggal ini hanya terlihat karyawan ESS).
  internalOnly: boolean;
  internalFirstUntil: string;
}

interface MethodForm {
  id?: string;
  methodId: string;
  adMediaTypeId: string;
  agencyId: string;
  costItemId: string;
  plannedCost: string;
  actualCost: string;
  datePosted: string;
  note: string;
}

const emptyMethod = (): MethodForm => ({
  methodId: "", adMediaTypeId: "", agencyId: "", costItemId: "", plannedCost: "", actualCost: "", datePosted: "", note: "",
});

/** rentang gaji iklan slot → string ringkas */
function salaryRange(s: OpeningSlotRow): string {
  if (s.salaryMin == null && s.salaryMax == null) return "—";
  if (s.salaryMin != null && s.salaryMax != null) return `${fmtIDR(s.salaryMin)} – ${fmtIDR(s.salaryMax)}`;
  return fmtIDR((s.salaryMin ?? s.salaryMax) as number);
}

export function OpeningsPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [offset, setOffset] = useState(0);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // dialog create JO (header + slots dinamis) / edit header
  const [dialog, setDialog] = useState<null | "new" | "edit-header">(null);
  const [editRow, setEditRow] = useState<JoRow | null>(null);
  const [header, setHeader] = useState<HeaderForm>({ title: "", contactPerson: "", lastAcceptDate: "", content: "", internalOnly: false, internalFirstUntil: "" });
  const [slotDrafts, setSlotDrafts] = useState<SlotForm[]>([emptySlot()]);
  const [postNow, setPostNow] = useState(false);
  const [busy, setBusy] = useState(false);

  // dialog detail (master-detail)
  const [viewRow, setViewRow] = useState<JoRow | null>(null);

  // dialog catatan aksi (close / obsolete)
  const [noteTarget, setNoteTarget] = useState<{ row: JoRow; action: "close" | "obsolete" } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  // dialog tambah / edit slot (dari detail)
  const [slotTarget, setSlotTarget] = useState<{ jo: JoRow; slot: OpeningSlotRow | null } | null>(null);
  const [slotForm, setSlotForm] = useState<SlotForm>(emptySlot());
  const [slotBusy, setSlotBusy] = useState(false);

  // dialog kanal & biaya (dari detail)
  const [methodTarget, setMethodTarget] = useState<{ jo: JoRow; method: MethodRow | null } | null>(null);
  const [methodForm, setMethodForm] = useState<MethodForm>(emptyMethod());
  const [methodBusy, setMethodBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      status: statusFilter, q: debouncedQ, limit: String(PAGE_SIZE), offset: String(offset),
      sortBy: "datePrepared", sortDir,
    });
    const e = encodeAdvParam(adv);
    if (e) sp.set("adv", e);
    return `/api/rekankerja/recruitment/openings?${sp.toString()}`;
  }, [statusFilter, debouncedQ, offset, sortDir, adv]);

  const api = useApi<ListResp>(url, [url]);
  // seluruh JO (≤100) — untuk tahu PR mana yang sudah punya slot (pemilih slot)
  const allJosApi = useApi<ListResp>("/api/rekankerja/recruitment/openings?limit=100", []);
  const prApi = useApi<{ rows: PrRowUI[]; total: number }>("/api/rekankerja/recruitment/pr?limit=100", []);
  const locApi = useApi<{ locations: WorkLocationOpt[] }>("/api/rekankerja/work-locations", []);
  const methodsApi = useApi<{ rows: MasterOpt[] }>("/api/rekankerja/recruitment/masters?type=method", []);
  const adMediaApi = useApi<{ rows: MasterOpt[] }>("/api/rekankerja/recruitment/masters?type=ad-media", []);
  const agencyApi = useApi<{ rows: MasterOpt[] }>("/api/rekankerja/recruitment/masters?type=agency", []);
  const costItemApi = useApi<{ rows: MasterOpt[] }>("/api/rekankerja/recruitment/masters?type=cost-item", []);

  const rows = api.data?.rows ?? [];
  const total = api.data?.total ?? 0;
  const stats = api.data?.stats;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canCreate = perms.can("recruitment", "openings", "create");
  const canUpdate = perms.can("recruitment", "openings", "update");
  const canDelete = perms.can("recruitment", "openings", "delete");
  const canPost = perms.canOp("recruitment", "openings", "post");
  const canClose = perms.canOp("recruitment", "openings", "close");
  const canObsolete = perms.canOp("recruitment", "openings", "obsolete");

  // PR yang boleh dijadikan slot: Approved/OnHold & belum punya slot di JO manapun
  const usedPrIds = useMemo(
    () => new Set((allJosApi.data?.rows ?? []).flatMap((j) => j.slots.map((s) => s.prId))),
    [allJosApi.data],
  );
  const availablePrs = useMemo(
    () => (prApi.data?.rows ?? []).filter((p) => (p.status === "Approved" || p.status === "OnHold") && !usedPrIds.has(p.id)),
    [prApi.data, usedPrIds],
  );
  const locations = (locApi.data?.locations ?? []).filter((l) => l.active);

  const refreshAll = () => { api.refresh(); allJosApi.refresh(); };
  const reloadDetail = async (id: string) => {
    try {
      const res = await apiSend<{ row: JoRow }>(`/api/rekankerja/recruitment/openings?id=${id}`, "GET");
      setViewRow(res.row);
    } catch { /* detail segar best-effort */ }
  };

  // ---------- buat / ubah header JO ----------

  const openNew = () => {
    setEditRow(null);
    setHeader({ title: "", contactPerson: "", lastAcceptDate: "", content: "", internalOnly: false, internalFirstUntil: "" });
    setSlotDrafts([emptySlot()]);
    setPostNow(false);
    setDialog("new");
  };

  const openEditHeader = (r: JoRow) => {
    setEditRow(r);
    setHeader({
      title: r.title,
      contactPerson: r.contactPerson ?? "",
      lastAcceptDate: r.lastAcceptDate ? r.lastAcceptDate.slice(0, 10) : "",
      content: r.content ?? "",
      internalOnly: r.internalOnly === true,
      internalFirstUntil: r.internalFirstUntil ? r.internalFirstUntil.slice(0, 10) : "",
    });
    setDialog("edit-header");
  };

  const saveHeader = async () => {
    if (!header.title.trim()) {
      toast.error(t("Judul lowongan wajib diisi", "Opening title is required"));
      return;
    }
    if (dialog === "new") {
      const slots = slotDrafts.filter((s) => s.prId);
      if (slots.length === 0) {
        toast.error(t("Pilih minimal 1 slot (PR Approved/OnHold)", "Pick at least 1 slot (Approved/OnHold PR)"));
        return;
      }
      if (slots.length < slotDrafts.length) {
        toast.error(t("Ada baris slot tanpa PR — hapus baris tersebut atau pilih PR", "A slot row has no PR — remove it or pick a PR"));
        return;
      }
    }
    setBusy(true);
    try {
      if (dialog === "edit-header" && editRow) {
        await apiSend("/api/rekankerja/recruitment/openings", "PATCH", {
          action: "update", id: editRow.id,
          title: header.title, contactPerson: header.contactPerson || null,
          lastAcceptDate: header.lastAcceptDate || null, content: header.content || null,
          internalOnly: header.internalOnly,
          internalFirstUntil: !header.internalOnly && header.internalFirstUntil ? header.internalFirstUntil : null,
        });
        toast.success(t(`Lowongan ${editRow.refNo} diperbarui`, `Opening ${editRow.refNo} updated`));
        setViewRow((v) => (v && v.id === editRow.id ? {
          ...v, ...header,
          contactPerson: header.contactPerson || null,
          lastAcceptDate: header.lastAcceptDate || null,
          content: header.content || null,
          internalOnly: header.internalOnly,
          internalFirstUntil: !header.internalOnly && header.internalFirstUntil ? header.internalFirstUntil : null,
        } : v));
      } else {
        const res = await apiSend<{ row: JoRow }>("/api/rekankerja/recruitment/openings", "POST", {
          title: header.title,
          contactPerson: header.contactPerson || null,
          lastAcceptDate: header.lastAcceptDate || null,
          content: header.content || null,
          internalOnly: header.internalOnly,
          internalFirstUntil: !header.internalOnly && header.internalFirstUntil ? header.internalFirstUntil : null,
          postNow,
          slots: slotDrafts.filter((s) => s.prId).map((s) => ({
            prId: s.prId,
            titleToShow: s.titleToShow || null,
            workLocationId: s.workLocationId || null,
            salaryMin: s.salaryMin === "" ? null : Number(s.salaryMin),
            salaryMax: s.salaryMax === "" ? null : Number(s.salaryMax),
            jobDescSummary: s.jobDescSummary || null,
            jobSpecSummary: s.jobSpecSummary || null,
          })),
        });
        toast.success(
          res.row.status === "Posted"
            ? t(`Lowongan ${res.row.refNo} dipublikasikan (${res.row.slots.length} slot)`, `Opening ${res.row.refNo} published (${res.row.slots.length} slots)`)
            : t(`Draft lowongan ${res.row.refNo} disimpan (${res.row.slots.length} slot)`, `Draft opening ${res.row.refNo} saved (${res.row.slots.length} slots)`),
        );
      }
      setDialog(null);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan lowongan", "Failed to save the opening"));
    } finally { setBusy(false); }
  };

  // ---------- aksi JO ----------

  const doAction = async (row: JoRow, action: string, note?: string) => {
    try {
      const res = await apiSend<{ refNo: string; status: string }>("/api/rekankerja/recruitment/openings", "PATCH", { id: row.id, action, note });
      if (action === "post") {
        toast.success(t(`Lowongan ${res.refNo} DIPUBLIKASIKAN — tampil di portal karir`, `Opening ${res.refNo} PUBLISHED — visible on the career portal`));
      } else if (action === "close") {
        toast.success(t(`Lowongan ${res.refNo} ditutup`, `Opening ${res.refNo} closed`));
      } else if (action === "obsolete") {
        toast.success(t(`Lowongan ${res.refNo} ditandai usang`, `Opening ${res.refNo} marked obsolete`));
      }
      setViewRow(null);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    }
  };

  const submitNote = async () => {
    if (!noteTarget) return;
    setNoteBusy(true);
    try {
      await doAction(noteTarget.row, noteTarget.action, noteText.trim() || undefined);
      setNoteTarget(null);
      setNoteText("");
    } finally { setNoteBusy(false); }
  };

  // ---------- slot ----------

  const openAddSlot = (jo: JoRow) => {
    setSlotTarget({ jo, slot: null });
    setSlotForm(emptySlot());
  };

  const openEditSlot = (jo: JoRow, slot: OpeningSlotRow) => {
    setSlotTarget({ jo, slot });
    setSlotForm({
      prId: slot.prId,
      titleToShow: slot.titleToShow,
      workLocationId: slot.workLocationId ?? "",
      salaryMin: slot.salaryMin != null ? String(slot.salaryMin) : "",
      salaryMax: slot.salaryMax != null ? String(slot.salaryMax) : "",
      jobDescSummary: slot.jobDescSummary ?? "",
      jobSpecSummary: slot.jobSpecSummary ?? "",
    });
  };

  const saveSlot = async () => {
    if (!slotTarget) return;
    if (!slotTarget.slot && !slotForm.prId) {
      toast.error(t("Pilih PR untuk slot baru", "Pick a PR for the new slot"));
      return;
    }
    setSlotBusy(true);
    try {
      const body = {
        titleToShow: slotForm.titleToShow || null,
        workLocationId: slotForm.workLocationId || null,
        salaryMin: slotForm.salaryMin === "" ? null : Number(slotForm.salaryMin),
        salaryMax: slotForm.salaryMax === "" ? null : Number(slotForm.salaryMax),
        jobDescSummary: slotForm.jobDescSummary || null,
        jobSpecSummary: slotForm.jobSpecSummary || null,
      };
      if (slotTarget.slot) {
        await apiSend("/api/rekankerja/recruitment/openings", "PATCH", { action: "update-slot", slotId: slotTarget.slot.id, ...body });
        toast.success(t("Slot diperbarui", "Slot updated"));
      } else {
        await apiSend("/api/rekankerja/recruitment/openings", "PATCH", { action: "add-slot", id: slotTarget.jo.id, prId: slotForm.prId, ...body });
        toast.success(t(`Slot ditambahkan ke ${slotTarget.jo.refNo}`, `Slot added to ${slotTarget.jo.refNo}`));
      }
      setSlotTarget(null);
      await reloadDetail(slotTarget.jo.id);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan slot", "Failed to save the slot"));
    } finally { setSlotBusy(false); }
  };

  const closeSlot = async (jo: JoRow, slot: OpeningSlotRow) => {
    if (!window.confirm(t(`Tutup slot "${slot.titleToShow}" di ${jo.refNo}? Lamaran baru tidak diterima lagi.`, `Close slot "${slot.titleToShow}" in ${jo.refNo}? It stops accepting applications.`))) return;
    try {
      await apiSend("/api/rekankerja/recruitment/openings", "PATCH", { action: "close-slot", slotId: slot.id });
      toast.success(t(`Slot ${slot.prNo} ditutup`, `Slot ${slot.prNo} closed`));
      await reloadDetail(jo.id);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menutup slot", "Failed to close the slot"));
    }
  };

  // ---------- kanal & biaya ----------

  const openMethod = (jo: JoRow, method: MethodRow | null) => {
    setMethodTarget({ jo, method });
    setMethodForm(method
      ? {
          id: method.id, methodId: method.methodId,
          adMediaTypeId: method.adMediaTypeId ?? "", agencyId: method.agencyId ?? "", costItemId: method.costItemId ?? "",
          plannedCost: method.plannedCost != null ? String(method.plannedCost) : "",
          actualCost: method.actualCost != null ? String(method.actualCost) : "",
          datePosted: method.datePosted ? method.datePosted.slice(0, 10) : "",
          note: method.note ?? "",
        }
      : { ...emptyMethod(), datePosted: new Date().toISOString().slice(0, 10) });
  };

  const saveMethod = async () => {
    if (!methodTarget) return;
    if (!methodForm.methodId) {
      toast.error(t("Metode rekrutmen wajib dipilih", "Recruitment method is required"));
      return;
    }
    setMethodBusy(true);
    try {
      await apiSend("/api/rekankerja/recruitment/openings", "PATCH", {
        action: "upsert-method",
        id: methodForm.id,
        jobOpportunityId: methodTarget.jo.id,
        methodId: methodForm.methodId,
        adMediaTypeId: methodForm.adMediaTypeId || null,
        agencyId: methodForm.agencyId || null,
        costItemId: methodForm.costItemId || null,
        plannedCost: methodForm.plannedCost === "" ? null : Number(methodForm.plannedCost),
        actualCost: methodForm.actualCost === "" ? null : Number(methodForm.actualCost),
        datePosted: methodForm.datePosted || null,
        note: methodForm.note || null,
      });
      toast.success(methodForm.id ? t("Kanal diperbarui", "Channel updated") : t("Kanal ditambahkan", "Channel added"));
      setMethodTarget(null);
      await reloadDetail(methodTarget.jo.id);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan kanal", "Failed to save the channel"));
    } finally { setMethodBusy(false); }
  };

  const removeMethod = async (jo: JoRow, method: MethodRow) => {
    if (!window.confirm(t(`Hapus kanal ${method.methodName} dari ${jo.refNo}?`, `Delete channel ${method.methodName} from ${jo.refNo}?`))) return;
    try {
      await apiSend(`/api/rekankerja/recruitment/openings?methodId=${method.id}`, "DELETE");
      toast.success(t("Kanal dihapus", "Channel deleted"));
      await reloadDetail(jo.id);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus kanal", "Failed to delete the channel"));
    }
  };

  // ---------- render helpers ----------

  const statCard = (key: string, label: string, labelEn: string, value: number | undefined, opts?: { accent?: boolean }) => (
    <button
      key={key}
      onClick={() => { setStatusFilter(statusFilter === key ? "all" : key); setOffset(0); }}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        statusFilter === key
          ? "ov-border-accent ov-soft"
          : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
      )}
    >
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value ?? 0}</div>
    </button>
  );

  const prItems = availablePrs.map((p) => (
    <SelectItem key={p.id} value={p.id}>
      {p.prNo} — {p.positionTitle ?? t("tanpa posisi", "no position")} · {t("kebutuhan {n} org", "{n} headcount", { n: String(p.requiredNo) })}
    </SelectItem>
  ));

  const locationItems = locations.map((l) => (
    <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}{l.city ? ` · ${l.city}` : ""}</SelectItem>
  ));

  /** baris form slot (dipakai dialog create — array dinamis) */
  const slotRowEditor = (s: SlotForm, i: number) => (
    <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t("Slot {n}", "Slot {n}", { n: String(i + 1) })}
        </span>
        {slotDrafts.length > 1 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-rose-600 dark:text-rose-400"
            onClick={() => setSlotDrafts(slotDrafts.filter((_, x) => x !== i))}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Hapus baris", "Remove row")}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("Permintaan Karyawan (PR) *", "Personnel Requisition (PR) *")}</Label>
          <Select value={s.prId || undefined}
            onValueChange={(v) => {
              const pr = availablePrs.find((p) => p.id === v);
              setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, prId: v, titleToShow: x.titleToShow || pr?.positionTitle || "" } : x));
            }}>
            <SelectTrigger><SelectValue placeholder={t("Pilih PR Approved/OnHold yang belum punya slot", "Pick an Approved/OnHold PR without a slot")} /></SelectTrigger>
            <SelectContent className="max-h-64">{prItems}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("Judul yang Ditampilkan", "Title to Display")}</Label>
          <Input value={s.titleToShow} onChange={(e) => setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, titleToShow: e.target.value } : x))}
            placeholder={t("default: judul posisi PR", "default: PR position title")} />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {t("Lokasi Kerja", "Work Location")}</Label>
          <Select value={s.workLocationId || undefined} onValueChange={(v) => setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, workLocationId: v } : x))}>
            <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
            <SelectContent className="max-h-64">{locationItems}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("Gaji Iklan Min", "Ad Salary Min")}</Label>
            <Input type="number" min={0} value={s.salaryMin} onChange={(e) => setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, salaryMin: e.target.value } : x))} placeholder="Rp" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Gaji Iklan Maks", "Ad Salary Max")}</Label>
            <Input type="number" min={0} value={s.salaryMax} onChange={(e) => setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, salaryMax: e.target.value } : x))} placeholder="Rp" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("Ringkasan Tugas", "Job Description Summary")}</Label>
          <Textarea rows={2} value={s.jobDescSummary} onChange={(e) => setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, jobDescSummary: e.target.value } : x))} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Ringkasan Kualifikasi", "Job Specification Summary")}</Label>
          <Textarea rows={2} value={s.jobSpecSummary} onChange={(e) => setSlotDrafts(slotDrafts.map((x, xi) => xi === i ? { ...x, jobSpecSummary: e.target.value } : x))} />
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Lowongan")}
        title={t("Lowongan (Job Opportunity)", "Job Openings (Job Opportunity)")}
        description={t(
          "Iklan rekrutmen per PR yang disetujui — kelola slot per PR, kanal publikasi & biayanya. Publikasikan agar tampil di portal karir publik (F2). Padanan JobOpportunity oranHR.",
          "Recruitment ads per approved PR — manage slots per PR, publication channels & their costs. Publish to make them visible on the public career portal (F2). oranHR JobOpportunity equivalent.",
        )}
        actions={canCreate && (
          <Button onClick={openNew} className="ov-fill ov-glow gap-2">
            <Megaphone className="h-4 w-4" aria-hidden /> {t("Lowongan Baru", "New Opening")}
          </Button>
        )}
      />

      {/* ringkasan status */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {statCard("all", "Total JO", "Total JOs", stats?.total)}
        {statCard("Draft", "Draft", "Draft", stats?.draft)}
        {statCard("Posted", "Terposting", "Posted", stats?.posted)}
        {statCard("Closed", "Ditutup", "Closed", stats?.closed)}
        {statCard("Obsolete", "Usang", "Obsolete", stats?.obsolete)}
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80" title={t("Slot (JobOpening) berstatus Open", "Slots (JobOpening) currently Open")}>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Slot Terbuka", "Open Slots")}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            <Layers3 className="h-4 w-4 text-slate-400" aria-hidden /> {stats?.openSlots ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80" title={t("Total lamaran pelamar (talent pool) ke slot", "Total applicant applications to slots")}>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Lamaran", "Applications")}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            <UsersRound className="h-4 w-4 text-slate-400" aria-hidden /> {stats?.applications ?? 0}
          </div>
        </div>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          {/* toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Cari nomor / judul / kontak / PR…", "Search no. / title / contact / PR…")}
                className="pl-9"
                aria-label={t("Pencarian", "Search")}
              />
            </div>
            <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={(v) => { setAdv(v); setOffset(0); }} />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}>
              <CalendarRange className="h-4 w-4" aria-hidden />
              {sortDir === "desc" ? t("Terbaru", "Newest") : t("Terlama", "Oldest")}
            </Button>
          </div>

          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat daftar lowongan", "Failed to load openings")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={t("Belum ada lowongan", "No job openings yet")}
              description={t(
                "Buat lowongan dari PR yang disetujui — PR dengan centang auto-post membuat lowongan otomatis.",
                "Create an opening from an approved PR — PRs with auto-post checked create one automatically.",
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Nomor JO", "JO No.")}</TableHead>
                    <TableHead>{t("Judul", "Title")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Disiapkan", "Prepared")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Diposting", "Posted")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("Slot / Kanal", "Slots / Channels")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setViewRow(r)}>
                      <TableCell className="font-mono text-xs font-semibold">{r.refNo}
                        <div className="mt-0.5 font-sans text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          {fmtDay(r.datePrepared, locale)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[16rem] truncate font-medium" title={r.title}>{r.title}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {r.contactPerson || "—"}
                        </div>
                      </TableCell>
                      <TableCell><JoPill status={r.status} kind="jo" /></TableCell>
                      <TableCell className="hidden md:table-cell text-xs">{fmtDay(r.datePrepared, locale)}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">{fmtDay(r.datePosted, locale)}</TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Badge variant="secondary" className="font-mono">{r.slots.length}</Badge>
                          <span className="text-slate-400">·</span>
                          <Badge variant="outline" className="font-mono">{r.methods.length}</Badge>
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Aksi lowongan", "Opening actions")}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => setViewRow(r)}><Eye className="h-4 w-4" /> {t("Lihat detail", "View detail")}</DropdownMenuItem>
                            {(r.status === "Draft" || r.status === "Posted") && canUpdate && (
                              <DropdownMenuItem onClick={() => openEditHeader(r)}><Pencil className="h-4 w-4" /> {t("Ubah header", "Edit header")}</DropdownMenuItem>
                            )}
                            {r.status === "Draft" && canPost && (
                              <DropdownMenuItem onClick={() => doAction(r, "post")}><Send className="h-4 w-4" /> {t("Publikasikan", "Publish")}</DropdownMenuItem>
                            )}
                            {(r.status === "Draft" || r.status === "Posted") && canClose && (
                              <DropdownMenuItem onClick={() => { setNoteTarget({ row: r, action: "close" }); setNoteText(""); }}>
                                <Ban className="h-4 w-4" /> {t("Tutup lowongan…", "Close opening…")}
                              </DropdownMenuItem>
                            )}
                            {r.status !== "Closed" && r.status !== "Obsolete" && canObsolete && (
                              <DropdownMenuItem onClick={() => { setNoteTarget({ row: r, action: "obsolete" }); setNoteText(""); }}>
                                <Archive className="h-4 w-4" /> {t("Tandai usang…", "Mark obsolete…")}
                              </DropdownMenuItem>
                            )}
                            {(r.status === "Draft" || r.status === "Posted") && canUpdate && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => { setViewRow(r); }}>
                                  <Plus className="h-4 w-4" /> {t("Kelola slot & kanal", "Manage slots & channels")}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* pagination */}
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t("Halaman {p} dari {n} — {t2} lowongan", "Page {p} of {n} — {t2} openings", { p: String(page), n: String(pages), t2: String(total) })}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label={t("Halaman sebelumnya", "Previous page")}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)} aria-label={t("Halaman berikutnya", "Next page")}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog buat JO / ubah header ===== */}
      <Dialog open={dialog != null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog === "edit-header"
                ? t("Ubah Header — {no}", "Edit Header — {no}", { no: editRow?.refNo ?? "" })
                : t("Lowongan Baru", "New Job Opening")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Header Iklan", "Ad Header")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("Judul Lowongan *", "Opening Title *")}</Label>
                  <Input value={header.title} onChange={(e) => setHeader({ ...header, title: e.target.value })}
                    placeholder={t("mis. Akuntan — Lini Produksi 2", "e.g. Accountant — Production Line 2")} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Kontak yang Ditampilkan", "Contact Person")}</Label>
                  <Input value={header.contactPerson} onChange={(e) => setHeader({ ...header, contactPerson: e.target.value })}
                    placeholder={t("mis. HRD — 021-555-0199", "e.g. HRD — 021-555-0199")} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Batas Terakhir Menerima Lamaran", "Last Accept Date")}</Label>
                  <Input type="date" value={header.lastAcceptDate} onChange={(e) => setHeader({ ...header, lastAcceptDate: e.target.value })} />
                </div>
                {/* F5 — matri internal: khusus internal + jendela internal-first */}
                <div className="space-y-1.5">
                  <Label>{t("Khusus Internal", "Internal Only")}</Label>
                  <label className="flex min-h-[36px] items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700">
                    <Switch
                      checked={header.internalOnly}
                      onCheckedChange={(c) => setHeader({ ...header, internalOnly: c === true })}
                      aria-label={t("Khusus Internal", "Internal Only")}
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t("Tidak pernah tayang di portal publik", "Never shown on the public portal")}
                    </span>
                  </label>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Jendela Internal Dulu s.d.", "Internal-First Window Until")}</Label>
                  <Input
                    type="date"
                    value={header.internalFirstUntil}
                    disabled={header.internalOnly}
                    onChange={(e) => setHeader({ ...header, internalFirstUntil: e.target.value })}
                  />
                  <p className="text-[10px] text-slate-400">
                    {t(
                      "Sebelum tanggal ini hanya terlihat karyawan (ESS), belum publik",
                      "Before this date only visible to employees (ESS), not public yet",
                    )}
                  </p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("Konten Iklan", "Ad Content")}</Label>
                  <Textarea rows={3} value={header.content} onChange={(e) => setHeader({ ...header, content: e.target.value })}
                    placeholder={t("Narasi iklan yang tampil di portal karir…", "Ad copy shown on the career portal…")} />
                </div>
              </div>
            </section>

            {dialog === "new" && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Slot (per PR)", "Slots (per PR)")}</h4>
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1"
                    onClick={() => setSlotDrafts([...slotDrafts, emptySlot()])}>
                    <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah slot", "Add slot")}
                  </Button>
                </div>
                <div className="space-y-3">
                  {slotDrafts.map((s, i) => slotRowEditor(s, i))}
                </div>
                {availablePrs.length === 0 && (
                  <p className="mt-2 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    {t("Tidak ada PR Approved/OnHold yang belum punya slot — setujui PR dulu (atau PR sudah dipakai lowongan lain).", "No Approved/OnHold PR without a slot — approve a PR first (or the PR already belongs to another opening).")}
                  </p>
                )}
              </section>
            )}
          </div>

          <DialogFooter className="mt-2 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {dialog === "new" ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={postNow} onCheckedChange={(c) => setPostNow(c === true)} />
                {t("Publikasikan langsung", "Publish immediately")}
              </label>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>{t("Batal", "Cancel")}</Button>
              <Button onClick={saveHeader} disabled={busy} className="ov-fill">
                {busy ? t("Menyimpan…", "Saving…") : dialog === "edit-header" ? t("Simpan Perubahan", "Save Changes") : postNow ? t("Simpan & Publikasikan", "Save & Publish") : t("Simpan Draft", "Save Draft")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog detail (master-detail) ===== */}
      <Dialog open={viewRow != null} onOpenChange={(o) => { if (!o) setViewRow(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          {viewRow && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{viewRow.refNo}</span>
                  <JoPill status={viewRow.status} kind="jo" />
                  {viewRow.internalOnly && (
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400">
                      {t("Khusus Internal", "Internal Only")}
                    </span>
                  )}
                  {viewRow.internalFirstUntil && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                      {t("Internal dulu s.d. {d}", "Internal-first until {d}", { d: fmtDay(viewRow.internalFirstUntil, locale) })}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-normal text-slate-500 dark:text-slate-400">{viewRow.title}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {([
                    [t("Judul", "Title"), viewRow.title],
                    [t("Kontak", "Contact"), viewRow.contactPerson ?? "—"],
                    [t("Disiapkan Oleh", "Prepared By"), viewRow.preparedByName ?? "—"],
                    [t("Tanggal Disiapkan", "Date Prepared"), fmtDay(viewRow.datePrepared, locale)],
                    [t("Tanggal Posting", "Date Posted"), fmtDay(viewRow.datePosted, locale)],
                    [t("Batas Terakhir Lamaran", "Last Accept Date"), fmtDay(viewRow.lastAcceptDate, locale)],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{k}</div>
                      <div className="font-medium">{v}</div>
                    </div>
                  ))}
                </div>

                {viewRow.content && (
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Konten Iklan", "Ad Content")}</div>
                    <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">{viewRow.content}</p>
                  </div>
                )}

                {/* slot */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t("Slot per Permintaan (PR)", "Slots per Requisition (PR)")}
                    </h4>
                    {(viewRow.status === "Draft" || viewRow.status === "Posted") && canUpdate && (
                      <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openAddSlot(viewRow)}>
                        <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah Slot", "Add Slot")}
                      </Button>
                    )}
                  </div>
                  {viewRow.slots.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                      {t("Belum ada slot", "No slots yet")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("PR / Posisi", "PR / Position")}</TableHead>
                            <TableHead>{t("Lokasi", "Location")}</TableHead>
                            <TableHead className="hidden md:table-cell">{t("Gaji Iklan", "Ad Salary")}</TableHead>
                            <TableHead>{t("Status", "Status")}</TableHead>
                            <TableHead className="hidden lg:table-cell">{t("Lamaran", "Applications")}</TableHead>
                            <TableHead className="w-24" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewRow.slots.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell>
                                <div className="font-mono text-xs font-semibold">{s.prNo}</div>
                                <div className="max-w-[14rem] truncate text-[11px] text-slate-500 dark:text-slate-400" title={s.titleToShow}>
                                  {s.titleToShow} · {t("kebutuhan {n} org", "{n} headcount", { n: String(s.requiredNo) })}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {s.workLocationName
                                  ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" aria-hidden />{s.workLocationName}{s.workLocationCity ? ` · ${s.workLocationCity}` : ""}</span>
                                  : <span className="text-slate-400">—</span>}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-xs tabular-nums" title={t("Rentang gaji iklan (publik)", "Advertised salary range (public)")}>
                                {salaryRange(s)}
                              </TableCell>
                              <TableCell><JoPill status={s.status} kind="slot" /></TableCell>
                              <TableCell className="hidden lg:table-cell text-xs">
                                <span className="font-semibold tabular-nums">{s.applicationCount}</span>
                                {s.publicApplicationCount > 0 && (
                                  <span className="ml-1 text-amber-600 dark:text-amber-400" title={t("menunggu verifikasi staging", "awaiting staging verification")}>
                                    (+{s.publicApplicationCount})
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {canUpdate && (viewRow.status === "Draft" || viewRow.status === "Posted") && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Ubah slot", "Edit slot")} onClick={() => openEditSlot(viewRow, s)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {canUpdate && s.status === "Open" && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600 dark:text-rose-400" title={t("Tutup slot", "Close slot")} onClick={() => closeSlot(viewRow, s)}>
                                      <Ban className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>

                {/* kanal & biaya */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t("Kanal Publikasi & Biaya", "Publication Channels & Costs")}
                    </h4>
                    {(viewRow.status === "Draft" || viewRow.status === "Posted") && canUpdate && (
                      <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => openMethod(viewRow, null)}>
                        <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah Kanal", "Add Channel")}
                      </Button>
                    )}
                  </div>
                  {viewRow.methods.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                      {t("Belum ada kanal publikasi", "No publication channels yet")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Metode", "Method")}</TableHead>
                            <TableHead className="hidden md:table-cell">{t("Media / Agency", "Media / Agency")}</TableHead>
                            <TableHead className="hidden lg:table-cell">{t("Pos Biaya", "Cost Item")}</TableHead>
                            <TableHead>{t("Rencana", "Planned")}</TableHead>
                            <TableHead className="hidden xl:table-cell">{t("Realisasi", "Actual")}</TableHead>
                            <TableHead className="hidden sm:table-cell">{t("Tanggal", "Date")}</TableHead>
                            <TableHead className="w-20" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewRow.methods.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell>
                                <div className="font-medium">{m.methodName}</div>
                                {m.note && <div className="max-w-[12rem] truncate text-[11px] text-slate-500 dark:text-slate-400" title={m.note}>{m.note}</div>}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-xs">
                                {[m.adMediaName, m.agencyName].filter(Boolean).join(" · ") || <span className="text-slate-400">—</span>}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-xs">{m.costItemName ?? <span className="text-slate-400">—</span>}</TableCell>
                              <TableCell className="text-xs tabular-nums" title={m.plannedCost == null ? t("disembunyikan vault uang / kosong", "hidden by money vault / empty") : undefined}>
                                {m.plannedCost != null ? fmtIDR(m.plannedCost) : <span className="text-slate-400">—</span>}
                              </TableCell>
                              <TableCell className="hidden xl:table-cell text-xs tabular-nums" title={m.actualCost == null ? t("disembunyikan vault uang / kosong", "hidden by money vault / empty") : undefined}>
                                {m.actualCost != null ? fmtIDR(m.actualCost) : <span className="text-slate-400">—</span>}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-xs">{fmtDay(m.datePosted, locale)}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {(viewRow.status === "Draft" || viewRow.status === "Posted") && canUpdate && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Ubah kanal", "Edit channel")} onClick={() => openMethod(viewRow, m)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {canDelete && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600 dark:text-rose-400" title={t("Hapus kanal", "Delete channel")} onClick={() => removeMethod(viewRow, m)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </section>
              </div>

              <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[11px] text-slate-400">
                  {t("Diposting otomatis saat PR final-Approved dengan centang auto-post.", "Auto-posted when a PR is finally approved with auto-post checked.")}
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {(viewRow.status === "Draft" || viewRow.status === "Posted") && canUpdate && (
                    <Button variant="outline" onClick={() => openEditHeader(viewRow)}>
                      <Pencil className="h-4 w-4" aria-hidden /> {t("Ubah Header", "Edit Header")}
                    </Button>
                  )}
                  {viewRow.status === "Draft" && canPost && (
                    <Button className="ov-fill" onClick={() => doAction(viewRow, "post")}>
                      <Send className="h-4 w-4" aria-hidden /> {t("Publikasikan", "Publish")}
                    </Button>
                  )}
                  {(viewRow.status === "Draft" || viewRow.status === "Posted") && canClose && (
                    <Button variant="destructive" onClick={() => { setNoteTarget({ row: viewRow, action: "close" }); setNoteText(""); }}>
                      <Ban className="h-4 w-4" aria-hidden /> {t("Tutup", "Close")}
                    </Button>
                  )}
                  {viewRow.status !== "Closed" && viewRow.status !== "Obsolete" && canObsolete && (
                    <Button variant="outline" onClick={() => { setNoteTarget({ row: viewRow, action: "obsolete" }); setNoteText(""); }}>
                      <Archive className="h-4 w-4" aria-hidden /> {t("Obsolete", "Obsolete")}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== dialog catatan (close / obsolete) ===== */}
      <Dialog open={noteTarget != null} onOpenChange={(o) => { if (!o) setNoteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {noteTarget?.action === "close" ? t("Tutup Lowongan", "Close Opening") : t("Tandai Usang", "Mark Obsolete")} — {noteTarget?.row.refNo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {noteTarget?.action === "close"
                ? t("Lowongan ditutup — semua slot Open ikut ditutup dan tidak menerima lamaran baru.", "The opening is closed — all Open slots close too and stop accepting applications.")
                : t("Ditandai usang (arsip — iklan lama tak relevan). Slot Open ikut ditutup.", "Marked obsolete (archive — stale ad). Open slots close as well.")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("Alasan penutupan / keusangan…", "Reason for closing / obsoleting…")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={submitNote} disabled={noteBusy}>
              {noteBusy ? t("Memproses…", "Processing…") : noteTarget?.action === "close" ? t("Tutup Lowongan", "Close Opening") : t("Tandai Usang", "Mark Obsolete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog tambah / ubah slot ===== */}
      <Dialog open={slotTarget != null} onOpenChange={(o) => { if (!o) setSlotTarget(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {slotTarget?.slot
                ? t("Ubah Slot — {pr}", "Edit Slot — {pr}", { pr: slotTarget.slot.prNo })
                : t("Tambah Slot ke {no}", "Add Slot to {no}", { no: slotTarget?.jo.refNo ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!slotTarget?.slot ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Permintaan Karyawan (PR) *", "Personnel Requisition (PR) *")}</Label>
                <Select value={slotForm.prId || undefined}
                  onValueChange={(v) => {
                    const pr = availablePrs.find((p) => p.id === v);
                    setSlotForm({ ...slotForm, prId: v, titleToShow: slotForm.titleToShow || pr?.positionTitle || "" });
                  }}>
                  <SelectTrigger><SelectValue placeholder={t("Pilih PR Approved/OnHold tanpa slot", "Pick an Approved/OnHold PR without a slot")} /></SelectTrigger>
                  <SelectContent className="max-h-64">{prItems}</SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Permintaan Karyawan (PR)", "Personnel Requisition (PR)")}</Label>
                <Input value={`${slotTarget.slot.prNo} — ${slotTarget.slot.titleToShow}`} disabled />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("Judul yang Ditampilkan", "Title to Display")}</Label>
              <Input value={slotForm.titleToShow} onChange={(e) => setSlotForm({ ...slotForm, titleToShow: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {t("Lokasi Kerja", "Work Location")}</Label>
              <Select value={slotForm.workLocationId || undefined} onValueChange={(v) => setSlotForm({ ...slotForm, workLocationId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                <SelectContent className="max-h-64">{locationItems}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Gaji Iklan Min", "Ad Salary Min")}</Label>
              <Input type="number" min={0} value={slotForm.salaryMin} onChange={(e) => setSlotForm({ ...slotForm, salaryMin: e.target.value })} placeholder="Rp" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Gaji Iklan Maks", "Ad Salary Max")}</Label>
              <Input type="number" min={0} value={slotForm.salaryMax} onChange={(e) => setSlotForm({ ...slotForm, salaryMax: e.target.value })} placeholder="Rp" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Ringkasan Tugas", "Job Description Summary")}</Label>
              <Textarea rows={2} value={slotForm.jobDescSummary} onChange={(e) => setSlotForm({ ...slotForm, jobDescSummary: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Ringkasan Kualifikasi", "Job Specification Summary")}</Label>
              <Textarea rows={2} value={slotForm.jobSpecSummary} onChange={(e) => setSlotForm({ ...slotForm, jobSpecSummary: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlotTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={saveSlot} disabled={slotBusy} className="ov-fill">
              {slotBusy ? t("Menyimpan…", "Saving…") : slotTarget?.slot ? t("Simpan Perubahan", "Save Changes") : t("Tambah Slot", "Add Slot")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog kanal & biaya ===== */}
      <Dialog open={methodTarget != null} onOpenChange={(o) => { if (!o) setMethodTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {methodTarget?.method
                ? t("Ubah Kanal — {no}", "Edit Channel — {no}", { no: methodTarget.jo.refNo })
                : t("Tambah Kanal — {no}", "Add Channel — {no}", { no: methodTarget?.jo.refNo ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Metode Rekrutmen *", "Recruitment Method *")}</Label>
              <Select value={methodForm.methodId || undefined} onValueChange={(v) => setMethodForm({ ...methodForm, methodId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Pilih metode", "Pick a method")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(methodsApi.data?.rows ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Media Advertensi", "Ad Media")}</Label>
              <Select value={methodForm.adMediaTypeId || undefined} onValueChange={(v) => setMethodForm({ ...methodForm, adMediaTypeId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(adMediaApi.data?.rows ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agency Tenaga Kerja", "Employment Agency")}</Label>
              <Select value={methodForm.agencyId || undefined} onValueChange={(v) => setMethodForm({ ...methodForm, agencyId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(agencyApi.data?.rows ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Pos Biaya", "Cost Item")}</Label>
              <Select value={methodForm.costItemId || undefined} onValueChange={(v) => setMethodForm({ ...methodForm, costItemId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(costItemApi.data?.rows ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" aria-hidden /> {t("Biaya Rencana (Rp)", "Planned Cost (Rp)")}</Label>
              <Input type="number" min={0} value={methodForm.plannedCost} onChange={(e) => setMethodForm({ ...methodForm, plannedCost: e.target.value })} />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t("Terenkripsi vault uang — hanya role dengan izin yang melihat.", "Encrypted in the money vault — visible only to permitted roles.")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" aria-hidden /> {t("Biaya Realisasi (Rp)", "Actual Cost (Rp)")}</Label>
              <Input type="number" min={0} value={methodForm.actualCost} onChange={(e) => setMethodForm({ ...methodForm, actualCost: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tanggal Posting Kanal", "Channel Posted Date")}</Label>
              <Input type="date" value={methodForm.datePosted} onChange={(e) => setMethodForm({ ...methodForm, datePosted: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Catatan", "Note")}</Label>
              <Textarea rows={2} value={methodForm.note} onChange={(e) => setMethodForm({ ...methodForm, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMethodTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={saveMethod} disabled={methodBusy} className="ov-fill">
              {methodBusy ? t("Menyimpan…", "Saving…") : methodForm.id ? t("Simpan Perubahan", "Save Changes") : t("Tambah Kanal", "Add Channel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
