"use client";
// RekanKerja ESS — Pengajuan Perjalanan Dinas self-service (Task 98 F1-4).
// =====================================================================
// Dulu karyawan TIDAK bisa mengajukan dinis sendiri (hanya klaim — paradigma
// "HR mengajukan atas nama karyawan"; mobile pun masih stub). Kini: kartu
// pengajuan di halaman Pengajuan ESS + dialog multi-destinasi (kota, zona,
// luar negeri) + uang muka opsional + ESTIMASI BIAYA SBI PMK 32/2025 live
// (uang harian × hari + plafon hotel × malam — mirror travel-requests admin)
// + daftar permintaan dinis SAYA (status approval berjenjang, jatuh tempo
// settlement, klaim). Guard jalur admin tetap berlaku via submitTravelRequest.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { StatusPill, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ESS_BASE } from "./ess-api";
import {
  CityRateRowUI, estimateTripClient,
  TRAVEL_STATUS_LABEL, TRAVEL_STATUS_LABEL_EN, fmtIDR, fmtIDRShort, fmtDateID,
} from "@/rekankerja/travel/components/travel-types";
import {
  Plane, Plus, Send, Loader2, Wallet, Globe2, Trash2, Sparkles, Clock, MapPin, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const todayISO = () => new Date().toISOString().slice(0, 10);

interface DestForm {
  dateFrom: string; dateTo: string; city: string; country: string; zoneCode: string;
}

const emptyDest = (from: string, to: string): DestForm => ({ dateFrom: from, dateTo: to, city: "", country: "Indonesia", zoneCode: "LOCAL" });

interface MyTravelRequest {
  id: string; docNo: string; dateFrom: string; dateTo: string; days: number;
  purpose: string; status: string; decisionNote: string | null;
  settlementDue: string | null; overdue: boolean;
  destinations: { city: string; country: string; overseas: boolean; dateFrom: string; dateTo: string }[];
  advanceAmount: number | null; hasActiveClaim: boolean; activeClaimDocNo: string | null;
  approval: { currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

interface TravelFormData {
  requests: MyTravelRequest[];
  templates: { code: string; name: string; settlementDay: number; isDefault: boolean }[];
  zones: { code: string; name: string; overseas: boolean }[];
  cityRates: CityRateRowUI[];
}

interface SubmitResult {
  docNo: string; destinations: number; days: number; advanceAmount: number;
  approvalLevels: number; firstApprover: string | null;
  budgetWarning?: string | null;
  budget?: { costCenter: string | null; remaining: number | null } | null;
}

export function EssTravelRequest() {
  const { t } = useI18n();
  const api = useApi<TravelFormData>(`${ESS_BASE}/requests/travel`);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ templateCode: "", dateFrom: todayISO(), dateTo: todayISO(), purpose: "", remark: "", advanceAmount: "", advanceNote: "" });
  const [dests, setDests] = useState<DestForm[]>([emptyDest(todayISO(), todayISO())]);

  const templates = api.data?.templates ?? [];
  const zones = api.data?.zones ?? [];
  const cityRates = api.data?.cityRates ?? [];
  const requests = api.data?.requests ?? [];

  useEffect(() => {
    if (dialog && !form.templateCode && templates.length > 0) {
      setForm((f) => ({ ...f, templateCode: (templates.find((x) => x.isDefault) ?? templates[0]).code }));
    }
  }, [dialog, templates, form.templateCode]);

  // Task 98 (F1-2) — estimasi SBI live (mirror admin travel-requests.tsx).
  const estimate = useMemo(
    () => (dialog && dests.some((d) => d.city.trim())
      ? estimateTripClient(cityRates, dests.map((d) => ({
          city: d.city, dateFrom: d.dateFrom, dateTo: d.dateTo,
          overseas: Boolean(zones.find((z) => z.code === d.zoneCode)?.overseas),
        })))
      : null),
    [dialog, dests, cityRates, zones],
  );

  const openDialog = () => {
    setFormError(null);
    setForm({ templateCode: (templates.find((x) => x.isDefault) ?? templates[0])?.code ?? "", dateFrom: todayISO(), dateTo: todayISO(), purpose: "", remark: "", advanceAmount: "", advanceNote: "" });
    setDests([emptyDest(todayISO(), todayISO())]);
    setDialog(true);
  };

  const submit = async () => {
    if (busy) return;
    if (!form.purpose.trim()) { setFormError(t("Tujuan perjalanan wajib diisi.", "The travel purpose is required.")); return; }
    const validDests = dests.filter((d) => d.city.trim());
    if (validDests.length === 0) { setFormError(t("Minimal 1 destinasi dengan kota terisi.", "At least 1 destination with a city filled in.")); return; }
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiSend<SubmitResult>(`${ESS_BASE}/requests/travel`, "POST", {
        ...form,
        advanceAmount: Number(form.advanceAmount || 0),
        destinations: validDests.map((d) => {
          const zone = zones.find((z) => z.code === d.zoneCode);
          return {
            dateFrom: d.dateFrom, dateTo: d.dateTo, city: d.city.trim(),
            country: zone?.overseas ? d.country : "Indonesia",
            zoneCode: d.zoneCode, overseas: Boolean(zone?.overseas),
          };
        }),
      });
      toast.success(
        t("{no} diajukan — menunggu {who} ({n} jenjang)", "{no} submitted — awaiting {who} ({n} tiers)", {
          no: res.docNo, who: res.firstApprover ?? "approval", n: res.approvalLevels,
        }),
        { description: t("Estimasi SBI & uang muka mengikuti kebijakan; pantau status di daftar bawah.", "SBI estimate & the advance follow policy; track the status in the list below.") },
      );
      if (res.budgetWarning) toast.warning(res.budgetWarning, { duration: 9000 });
      setDialog(false);
      api.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("Gagal mengajukan perjalanan dinis.", "Failed to submit the business trip request."));
    } finally {
      setBusy(false);
    }
  };

  const active = requests.filter((r) => r.status === "Submitted" || r.status === "Approved");
  const history = requests.filter((r) => r.status !== "Submitted" && r.status !== "Approved");

  return (
    <>
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <Plane className="h-4 w-4" aria-hidden />
            </span>
            {t("Perjalanan Dinas Saya", "My Business Trips")}
          </CardTitle>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
            {t("Ajukan dinas sendiri (multi-kota + uang muka) dengan estimasi biaya SBI PMK 32/2025 — approval berjenjang otomatis ke atasan Anda.", "Submit your own trip (multi-city + advance) with SBI cost estimates (PMK 32/2025) — tiered approval goes to your manager automatically.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          {api.loading && !api.data ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("Memuat pengajuan dinis…", "Loading your trips…")}
            </div>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={Plane}
              title={t("Belum ada perjalanan dinis", "No business trips yet")}
              description={t("Ajukan dinas pertama Anda — klaim settlement diajukan setelah perjalanan selesai.", "Submit your first trip — the settlement claim follows after the trip ends.")}
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {[...active, ...history].map((r) => (
                <li key={r.id} className="py-2.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 text-left"
                    onClick={() => setExpanded(expanded === r.docNo ? null : r.docNo)}
                    aria-expanded={expanded === r.docNo}
                  >
                    {expanded === r.docNo
                      ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono text-[12px] font-bold text-amber-700 dark:text-amber-400">{r.docNo}</span>
                        <span className="truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                          {r.destinations.map((d) => d.city).join(" → ")}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {fmtDateID(r.dateFrom)} → {fmtDateID(r.dateTo)} · {r.days} {t("hari", "days")}
                        {r.approval ? ` · ${t("jenjang", "tier")} ${r.approval.currentLevel}/${r.approval.totalLevels}` : ""}
                      </span>
                    </span>
                    <StatusPill status={t(TRAVEL_STATUS_LABEL[r.status] ?? r.status, TRAVEL_STATUS_LABEL_EN[r.status] ?? r.status)} />
                  </button>
                  {expanded === r.docNo && (
                    <div className="mt-2 space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] dark:bg-slate-800/50">
                      <p className="text-slate-600 dark:text-slate-300">{r.purpose}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {r.destinations.map((d) => `${d.city}${d.overseas ? " ✈" : ""}`).join(" → ")}</span>
                        {r.advanceAmount != null && r.advanceAmount > 0 && (
                          <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400"><Wallet className="h-3 w-3" /> {t("uang muka {amt}", "advance {amt}", { amt: fmtIDRShort(r.advanceAmount) })}</span>
                        )}
                        {r.settlementDue && (
                          <span className={cn("flex items-center gap-1", r.overdue ? "font-bold text-rose-600 dark:text-rose-400" : "text-slate-500")}>
                            <Clock className="h-3 w-3" /> {t("jatuh tempo klaim {d}", "claim due {d}", { d: fmtDateID(r.settlementDue) })}{r.overdue ? ` · ${t("LEWAT", "OVERDUE")}` : ""}
                          </span>
                        )}
                        {r.activeClaimDocNo && (
                          <span className="flex items-center gap-1 text-sky-700 dark:text-sky-400">{t("klaim {no} diproses", "claim {no} in process", { no: r.activeClaimDocNo })}</span>
                        )}
                      </div>
                      {r.approval?.currentApprover && r.status === "Submitted" && (
                        <p className="text-slate-500">{t("menunggu", "awaiting")} <b>{r.approval.currentApprover}</b></p>
                      )}
                      {r.decisionNote && <p className="rounded-lg bg-white px-2 py-1.5 text-slate-600 dark:bg-slate-900 dark:text-slate-300">{r.decisionNote}</p>}
                      {r.status === "Approved" && !r.hasActiveClaim && (
                        <p className="rounded-lg bg-amber-50 px-2 py-1.5 font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          {t("Setelah perjalanan selesai, ajukan klaim settlement di Klaim Saya → Klaim Travel.", "After the trip ends, submit the settlement claim under My Claims → Travel Claims.")}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button onClick={openDialog} className="w-full gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
            <Plus className="h-4 w-4" /> {t("Ajukan Perjalanan Dinas", "Request Business Trip")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={(v) => { if (!busy) setDialog(v); }}>
        <DialogContent className="max-h-[92vh] w-[min(680px,94vw)] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plane className="h-4 w-4 text-sky-600" aria-hidden /> {t("Ajukan Perjalanan Dinas", "Request Business Trip")}
            </DialogTitle>
            <DialogDescription>
              {t("Multi-kota + uang muka opsional — estimasi otomatis dari tarif SBI PMK 32/2025; approval berjenjang ke atasan.", "Multi-city + optional advance — automatic estimates from SBI rates (PMK 32/2025); tiered approval to your manager.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Template perjalanan", "Travel template")}</Label>
                <Select value={form.templateCode} onValueChange={(v) => setForm({ ...form, templateCode: v })}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templates.map((tp) => (
                      <SelectItem key={tp.code} value={tp.code}>{tp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Berangkat", "Departure")}</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kembali", "Return")}</Label>
                <Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="rounded-xl" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">{t("Destinasi (kaki perjalanan) *", "Destinations (trip legs) *")}</Label>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-lg text-xs font-bold" onClick={() => setDests([...dests, emptyDest(form.dateFrom, form.dateTo)])}>
                  <Plus className="h-3 w-3" /> {t("Tambah", "Add")}
                </Button>
              </div>
              {dests.map((d, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400">{t("Destinasi {n}", "Destination {n}", { n: i + 1 })}</span>
                    {dests.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 rounded-lg px-2 text-[11px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" onClick={() => setDests(dests.filter((_, x) => x !== i))}>
                        <Trash2 className="h-3 w-3" /> {t("Hapus", "Remove")}
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-slate-500">{t("Kota *", "City *")}</Label>
                      <Input value={d.city} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, city: e.target.value } : x))} placeholder="Bandung" className="h-8 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-slate-500">{t("Zona", "Zone")}</Label>
                      <Select value={d.zoneCode} onValueChange={(v) => setDests(dests.map((x, xi) => xi === i ? { ...x, zoneCode: v } : x))}>
                        <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {zones.map((z) => (
                            <SelectItem key={z.code} value={z.code} className="text-xs">{z.name}{z.overseas ? " ✈" : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-slate-500">{t("Tgl Berangkat", "Departure")}</Label>
                      <Input type="date" value={d.dateFrom} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, dateFrom: e.target.value } : x))} className="h-8 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-slate-500">{t("Tgl Datang", "Arrival")}</Label>
                      <Input type="date" value={d.dateTo} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, dateTo: e.target.value } : x))} className="h-8 rounded-lg text-sm" />
                    </div>
                  </div>
                  {zones.find((z) => z.code === d.zoneCode)?.overseas && (
                    <div className="mt-2 space-y-1">
                      <Label className="text-[10px] font-bold text-slate-500">{t("Negara (luar negeri)", "Country (overseas)")}</Label>
                      <Input value={d.country} onChange={(e) => setDests(dests.map((x, xi) => xi === i ? { ...x, country: e.target.value } : x))} placeholder="Singapura" className="h-8 rounded-lg text-sm" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Task 98 (F1-2) — estimasi SBI live */}
            {estimate && estimate.legs.length > 0 && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-sky-800 dark:text-sky-300">
                  <Sparkles className="h-3.5 w-3.5" /> {t("Estimasi Biaya — tarif SBI PMK 32/2025", "Cost Estimate — SBI rates (PMK 32/2025)")}
                </p>
                <div className="space-y-1.5">
                  {estimate.legs.map((l, i) => (
                    <div key={i} className="rounded-lg bg-white px-3 py-1.5 text-[11px] dark:bg-slate-900">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          {l.city} · {l.days} {t("hari", "days")} / {l.nights} {t("malam", "nights")}
                          {l.overseas && <Globe2 className="ml-1 inline h-3 w-3 text-sky-500" />}
                        </span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{fmtIDRShort(l.perDiem + l.hotelEstimate)}</span>
                      </div>
                      {l.rateFound ? (
                        <p className="text-slate-500 dark:text-slate-400">
                          {t("uang harian {d}/hari + hotel ≤ {h}/malam", "daily allowance {d}/day + hotel ≤ {h}/night", { d: fmtIDRShort(l.uangHarian), h: fmtIDRShort(l.plafonHotel) })}
                        </p>
                      ) : (
                        <p className="text-amber-600 dark:text-amber-400">{t("kota belum ada di master tarif — estimasi Rp 0 (HR dapat menambahkan)", "city not in the rate master — estimate Rp 0 (HR can add it)")}</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black text-sky-800 dark:text-sky-300">
                    {t("Total estimasi: {amt}", "Estimated total: {amt}", { amt: fmtIDR(estimate.estimateTotal) })}
                  </p>
                  <Button
                    type="button" variant="outline" size="sm"
                    className="h-7 gap-1 rounded-lg border-sky-300 text-[11px] font-bold text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40"
                    onClick={() => setForm({ ...form, advanceAmount: String(estimate!.estimateTotal) })}
                  >
                    <Wallet className="h-3 w-3" /> {t("Gunakan sebagai uang muka", "Use as the advance")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
              <Label className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-400">
                <Wallet className="h-3.5 w-3.5" /> {t("Uang Muka (opsional — dicairkan setelah disetujui)", "Advance (optional — disbursed after approval)")}
              </Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  type="number" min="0" value={form.advanceAmount}
                  onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })}
                  placeholder="0" className="h-8 rounded-lg text-sm tabular-nums"
                />
                <Input value={form.advanceNote} onChange={(e) => setForm({ ...form, advanceNote: e.target.value })} placeholder={t("mis. hotel & transport", "e.g. hotel & transport")} className="h-8 rounded-lg text-sm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Tujuan perjalanan *", "Travel purpose *")}</Label>
              <Textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder={t("mis. Kunjungan audit pabrik mitra", "e.g. Partner factory audit visit")} className="rounded-xl text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea rows={2} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className="rounded-xl text-sm" />
            </div>

            {formError && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{formError}</p>
            )}
          </div>

          <DialogFooter className="items-center gap-3">
            <Button variant="outline" className="rounded-xl font-bold" onClick={() => setDialog(false)} disabled={busy}>
              {t("Batal", "Cancel")}
            </Button>
            <Button onClick={submit} disabled={busy || api.loading} className="gap-1.5 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("Ajukan Dinas", "Submit Trip")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
