"use client";
// OneVity Travel — Permintaan Travel: form multi-destinasi + uang muka
// (padanan TravelRequest.jsp + Destination detail + Cash Advance)
import { Fragment, useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { nextServerSort, ServerSortHead, type ServerSortDir } from "@/onevity/shared/lib/use-table-sort";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  TravelRequestRowUI, TemplateRowUI, ZoneRowUI, EmployeeOption,
  TRAVEL_STATUS_LABEL, TRAVEL_STATUS_LABEL_EN, fmtIDR, fmtDateID, fmtIDRShort,
} from "./travel-types";
import {
  Plane, Plus, Search, MapPin, Wallet, Send, Ban, ChevronDown, ChevronRight, Globe2,
  FileText, Clock, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

interface DestForm {
  dateFrom: string; dateTo: string; city: string; country: string; zoneCode: string; note: string;
}

const emptyDest = (from: string, to: string): DestForm => ({ dateFrom: from, dateTo: to, city: "", country: "Indonesia", zoneCode: "LOCAL", note: "" });

export function TravelRequestsPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dests, setDests] = useState<DestForm[]>([emptyDest(todayISO(), todayISO())]);
  const [form, setForm] = useState({
    employeeId: "", templateCode: "TRAVEL", dateFrom: todayISO(), dateTo: todayISO(),
    purpose: "", remark: "", advanceAmount: "", advanceNote: "",
  });

  // Task 76 — sorting SERVER-SIDE: sortBy/sortDir dikirim ke API (whitelist di service).
  const [sortKey, setSortKey] = useState<"doc" | "employee" | "plan" | "template" | "destinations" | "advance" | "status">("doc");
  const [sortDir, setSortDir] = useState<ServerSortDir>("desc");
  const clickSort = (k: typeof sortKey) => {
    const n = nextServerSort(sortKey, sortDir, k);
    setSortKey(n.sortBy as typeof sortKey);
    setSortDir(n.sortDir);
  };

  const api = useApi<{ requests: TravelRequestRowUI[]; stats: { total: number; submitted: number; approved: number; rejected: number; cancelled: number; withClaim: number; overdueSettlement: number; advanceTotal: number } }>(
    `/api/onevity/travel/requests?status=${statusFilter}&sortBy=${sortKey}&sortDir=${sortDir}`,
    [statusFilter, sortKey, sortDir],
  );
  const master = useApi<{ templates: TemplateRowUI[]; zones: ZoneRowUI[]; employees: EmployeeOption[] }>("/api/onevity/travel/templates");

  const requests = useMemo(() => (api.data?.requests ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase()) || r.purpose.toLowerCase().includes(query.toLowerCase()),
  ), [api.data, query]);

  const zones = master.data?.zones ?? [];
  const templates = (master.data?.templates ?? []).filter((t) => t.active);

  const submit = async () => {
    if (!form.employeeId) { toast.error(t("Karyawan wajib dipilih", "Employee is required")); return; }
    if (!form.purpose.trim()) { toast.error(t("Tujuan perjalanan wajib diisi", "Travel purpose is required")); return; }
    const validDests = dests.filter((d) => d.city.trim());
    if (validDests.length === 0) { toast.error(t("Minimal 1 destinasi dengan kota terisi", "At least 1 destination with a city filled in")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; destinations: number; days: number; advanceAmount: number; settlementDue: string | null }>(
        "/api/onevity/travel/requests", "POST",
        {
          ...form,
          advanceAmount: Number(form.advanceAmount || 0),
          destinations: validDests.map((d) => {
            const zone = zones.find((z) => z.code === d.zoneCode);
            return {
              dateFrom: d.dateFrom, dateTo: d.dateTo, city: d.city.trim(),
              country: zone?.overseas ? d.country : "Indonesia",
              zoneCode: d.zoneCode, overseas: Boolean(zone?.overseas), note: d.note || undefined,
            };
          }),
        },
      );
      toast.success(t(
        "{no} diajukan — {n} destinasi, {d} hari{adv}",
        "{no} submitted — {n} destinations, {d} days{adv}",
        { no: res.docNo, n: res.destinations, d: res.days, adv: res.advanceAmount > 0 ? t(", uang muka {amt}", ", advance {amt}", { amt: fmtIDRShort(res.advanceAmount) }) : "" },
      ));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan permintaan travel", "Failed to submit travel request"));
    } finally { setBusy(false); }
  };

  const cancelRequest = async (r: TravelRequestRowUI) => {
    try {
      const res = await apiSend<{ docNo: string; status: string }>("/api/onevity/travel/requests", "PATCH", { id: r.id, action: "cancel", note: "Dibatalkan pemberi kuasa" });
      toast.success(t("{no} dibatalkan", "{no} cancelled", { no: res.docNo }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membatalkan", "Failed to cancel"));
    }
  };

  const stats = api.data?.stats;
  const totalAdvance = dests.length ? Number(form.advanceAmount || 0) : 0;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Permintaan Perjalanan Dinas", "Business Travel Requests")}
        description={t("Pengajuan dinas dengan destinasi multi-kaki (kota, zona, luar negeri) dan uang muka — padanan Travel Request (format nomor TR-tahun-urut)", "Trip requests with multi-leg destinations (city, zone, overseas) and advances — Travel Request equivalent (TR-year-sequence number format)")}
        actions={
          perms.can("travel", "travel-request", "create") && (
            <Button
              onClick={() => {
                setForm({
                  employeeId: master.data?.employees[0]?.id ?? "", templateCode: (templates.find((t) => t.isDefault) ?? templates[0])?.code ?? "TRAVEL",
                  dateFrom: todayISO(), dateTo: todayISO(), purpose: "", remark: "", advanceAmount: "", advanceNote: "",
                });
                setDests([emptyDest(todayISO(), todayISO())]);
                setDialog(true);
              }}
              className="gap-2 font-bold"
            >
              <Plus className="h-4 w-4" /> {t("Ajukan Perjalanan", "Submit Travel")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
              statusFilter === f.key
                ? "ov-fill shadow-sm"
                : "bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800",
            )}
          >
            {t(f.label)}
            {f.key === "all" && stats ? ` (${stats.total})` : ""}
            {f.key === "Submitted" && stats ? ` (${stats.submitted})` : ""}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari nama / nomor / tujuan…", "Search name / number / purpose…")} className="w-56 pl-9 text-sm" />
        </div>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : requests.length === 0 ? (
            <EmptyState icon={Plane} title={t("Belum ada permintaan travel", "No travel requests yet")} description={t("Ajukan perjalanan dinas pertama dengan tombol Ajukan Perjalanan.", "Submit the first business trip using the Submit Travel button.")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                    <TableHead className="w-8" />
                    <ServerSortHead label={t("Nomor", "No.")} active={sortKey === "doc"} dir={sortDir} onClick={() => clickSort("doc")} />
                    <ServerSortHead label={t("Karyawan")} active={sortKey === "employee"} dir={sortDir} onClick={() => clickSort("employee")} />
                    <ServerSortHead label={t("Rencana", "Plan")} active={sortKey === "plan"} dir={sortDir} onClick={() => clickSort("plan")} />
                    <ServerSortHead label="Template" active={sortKey === "template"} dir={sortDir} onClick={() => clickSort("template")} />
                    <ServerSortHead label={t("Destinasi", "Destinations")} active={sortKey === "destinations"} dir={sortDir} onClick={() => clickSort("destinations")} className="hidden md:table-cell" />
                    <ServerSortHead label={t("Uang Muka", "Advance")} active={sortKey === "advance"} dir={sortDir} onClick={() => clickSort("advance")} className="text-right" />
                    <ServerSortHead label={t("Status")} active={sortKey === "status"} dir={sortDir} onClick={() => clickSort("status")} />
                    <TableHead className="text-right">{t("Aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <Fragment key={r.id}>
                      <TableRow key={r.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/60" onClick={() => setExpanded(expanded === r.docNo ? null : r.docNo)}>
                        <TableCell className="p-2">
                          {expanded === r.docNo ? <ChevronDown className="h-4 w-4 text-stone-400" /> : <ChevronRight className="h-4 w-4 text-stone-400" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-bold ov-text-accent">{r.docNo}</TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{r.fullName}</p>
                          <p className="text-[11px] text-stone-500">{r.employeeNo}{r.costCenter ? ` · CC ${r.costCenter}` : ""}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">{fmtDateID(r.dateFrom)} → {fmtDateID(r.dateTo)}</p>
                          <p className="text-[11px] text-stone-500">{t("{n} hari · diajukan {d}", "{n} days · submitted {d}", { n: r.days, d: fmtDateID(r.requestDate) })}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px] font-bold">{r.templateName}</Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <p className="text-xs text-stone-600 dark:text-stone-300">
                            {r.destinations.map((d) => d.city).join(" → ")}
                          </p>
                          <p className="text-[11px] text-stone-500">{t("{n} kaki perjalanan", "{n} trip legs", { n: r.destinations.length })}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.advanceAmount > 0 ? (
                            <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{fmtIDRShort(r.advanceAmount)}</span>
                          ) : (
                            <span className="text-xs text-stone-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={t(TRAVEL_STATUS_LABEL[r.status] ?? r.status, TRAVEL_STATUS_LABEL_EN[r.status] ?? r.status)} />
                          {r.claimCount > 0 && (
                            <Badge className="ml-1 bg-brand/15 text-[9px] font-bold text-brand-deep hover:bg-brand/15 dark:bg-brand/15 dark:text-brand/85">{t("KLAIM ✓", "CLAIM ✓")}</Badge>
                          )}
                          {r.overdue && (
                            <Badge className="ml-1 bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">{t("TELAT SETTLE", "OVERDUE")}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === "Submitted" ? (
                            perms.canOp("travel", "travel-request", "cancel") ? (
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold text-rose-600 hover:text-rose-700" onClick={(e) => { e.stopPropagation(); cancelRequest(r); }}>
                                <Ban className="h-3 w-3" /> {t("Batal")}
                              </Button>
                            ) : (
                              <span className="text-[11px] text-stone-400">{r.decisionNote ?? "—"}</span>
                            )
                          ) : (
                            <span className="text-[11px] text-stone-400">{r.decisionNote ?? "—"}</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === r.docNo && (
                        <TableRow key={`${r.id}-detail`} className="bg-stone-50/60 dark:bg-stone-800/30">
                          <TableCell colSpan={9} className="px-6 py-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="mb-1 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-stone-500">
                                  <MapPin className="h-3.5 w-3.5" /> {t("Rincian Destinasi", "Destination Details")}
                                </p>
                                <div className="space-y-1.5">
                                  {r.destinations.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs dark:bg-stone-900">
                                      <span className="flex h-5 w-5 items-center justify-center rounded ov-fill text-[10px] font-black">{d.seq}</span>
                                      <span className="font-semibold text-stone-800 dark:text-stone-200">{d.city}</span>
                                      <span className="text-stone-500">{d.country}</span>
                                      {d.overseas && <Globe2 className="h-3 w-3 text-brand" />}
                                      {d.zoneName && <Badge variant="outline" className="text-[9px]">{d.zoneName}</Badge>}
                                      <span className="ml-auto text-stone-500">{fmtDateID(d.dateFrom)} → {fmtDateID(d.dateTo)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-black uppercase tracking-wide text-stone-500">{t("Tujuan & Status", "Purpose & Status")}</p>
                                <p className="rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-stone-700 dark:bg-stone-900 dark:text-stone-300">{r.purpose}</p>
                                {r.remark && <p className="mt-1 rounded-lg bg-white px-3 py-2 text-[11px] text-stone-500 dark:bg-stone-900">{r.remark}</p>}
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
                                  {r.settlementDue && (
                                    <span className="flex items-center gap-1 rounded-full bg-white px-2 py-1 dark:bg-stone-900">
                                      <Clock className="h-3 w-3" /> {t("Jatuh tempo klaim: {d}", "Claim due date: {d}", { d: fmtDateID(r.settlementDue) })}
                                    </span>
                                  )}
                                  {r.claimCount > 0 && (
                                    <span className="flex items-center gap-1 rounded-full bg-white px-2 py-1 dark:bg-stone-900">
                                      <FileText className="h-3 w-3" /> {t("{n} klaim dibuat", "{n} claims created", { n: r.claimCount })}
                                    </span>
                                  )}
                                  {r.advanceAmount > 0 && (
                                    <span className="flex items-center gap-1 rounded-full bg-white px-2 py-1 dark:bg-stone-900">
                                      <Wallet className="h-3 w-3" /> {t("Uang muka {amt}", "Advance {amt}", { amt: fmtIDR(r.advanceAmount) })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plane className="h-5 w-5 ov-text-accent" /> {t("Ajukan Perjalanan Dinas", "Submit Business Travel")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Karyawan *", "Employee *")}</Label>
                <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(master.data?.employees ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-sm">
                        {e.employeeNo} — {e.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Template *")}</Label>
                <Select value={form.templateCode} onValueChange={(v) => setForm({ ...form, templateCode: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.code} className="text-sm">
                        {tpl.name} {tpl.isDefault ? "(default)" : ""} — {t("settle {n} hr", "settle in {n} days", { n: tpl.settlementDay })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Berangkat", "Departure Date")}</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Kembali", "Return Date")}</Label>
                <Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="text-sm" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">{t("Destinasi (kaki perjalanan) *", "Destinations (trip legs) *")}</Label>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => setDests([...dests, emptyDest(form.dateFrom, form.dateTo)])}>
                  <Plus className="h-3 w-3" /> {t("Tambah Destinasi", "Add Destination")}
                </Button>
              </div>
              <div className="space-y-2">
                {dests.map((d, i) => (
                  <div key={i} className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex h-5 w-5 items-center justify-center rounded ov-fill text-[10px] font-black">{i + 1}</span>
                      {dests.length > 1 && (
                        <button className="text-[11px] font-bold text-rose-600 hover:text-rose-700" onClick={() => setDests(dests.filter((_, x) => x !== i))}>
                          {t("Hapus")}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold text-stone-500">{t("Kota *", "City *")}</Label>
                        <Input value={d.city} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, city: e.target.value } : x))} placeholder="Bandung" className="h-8 text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold text-stone-500">{t("Zona", "Zone")}</Label>
                        <Select value={d.zoneCode} onValueChange={(v) => setDests(dests.map((x, xi) => xi === i ? { ...x, zoneCode: v } : x))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {zones.map((z) => (
                              <SelectItem key={z.id} value={z.code} className="text-xs">
                                {z.name}{z.overseas ? " ✈" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Fix audit 40 m-4 — label destinasi terbalik: semantik service
                          (submitTravelRequest) dateFrom kaki = tanggal BERANGKAT,
                          dateTo = tanggal DATANG; label lama tertukar. */}
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold text-stone-500">{t("Tgl Berangkat", "Departure Date")}</Label>
                        <Input type="date" value={d.dateFrom} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, dateFrom: e.target.value } : x))} className="h-8 text-sm" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-bold text-stone-500">{t("Tgl Datang", "Arrival Date")}</Label>
                        <Input type="date" value={d.dateTo} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, dateTo: e.target.value } : x))} className="h-8 text-sm" />
                      </div>
                      {zones.find((z) => z.code === d.zoneCode)?.overseas && (
                        <div className="col-span-2 space-y-1 sm:col-span-4">
                          <Label className="text-[10px] font-bold text-stone-500">{t("Negara (luar negeri)", "Country (overseas)")}</Label>
                          <Input value={d.country} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, country: e.target.value } : x))} placeholder="Singapura" className="h-8 text-sm" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
              <Label className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-400">
                <Wallet className="h-3.5 w-3.5" /> {t("Uang Muka (Cash Advance) — opsional", "Cash Advance — optional")}
              </Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  type="number" min="0" value={form.advanceAmount}
                  onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })}
                  placeholder="0" className="h-8 text-sm"
                />
                <Input value={form.advanceNote} onChange={(e) => setForm({ ...form, advanceNote: e.target.value })} placeholder={t("Catatan uang muka (mis. transport & hotel)", "Advance note (e.g. transport & hotel)")} className="h-8 text-sm" />
              </div>
              {totalAdvance > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  {t(
                    "Uang muka {amt} baru dicairkan setelah permintaan disetujui final — bukan pinjaman karyawan; diselesaikan otomatis saat klaim settlement (mengurangi (b) / menambah (c)).",
                    "The advance of {amt} is only disbursed after the request is fully approved — it is not an employee loan; it is settled automatically at claim settlement (reducing (b) / adding to (c)).",
                    { amt: fmtIDR(totalAdvance) },
                  )}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Tujuan Perjalanan *", "Travel Purpose *")}</Label>
              <Textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder={t("Mis. Audit mutu pabrik mitra Bandung", "e.g. Quality audit of partner factory in Bandung")} rows={2} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} rows={2} className="text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(false)} className="font-bold">{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy} className="gap-2 font-bold">
              <Send className="h-4 w-4" /> {busy ? t("Mengirim…", "Submitting…") : t("Ajukan Permintaan", "Submit Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
