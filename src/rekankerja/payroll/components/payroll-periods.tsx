"use client";
// RekanKerja Payroll — Periode Payroll: daftar period multi-jendela + buat/tutup period
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CalendarRange, Plus, Lock, ChevronRight, PencilLine } from "lucide-react";
import { PeriodRow } from "@/rekankerja/payroll/components/payroll-types";
import { useI18n, loc } from "@/rekankerja/shared/lib/i18n";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";

export function PayrollPeriodsPage() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ periods: PeriodRow[] }>("/api/rekankerja/payroll-periods");
  const [open, setOpen] = useState(false);
  const [taEdit, setTaEdit] = useState<PeriodRow | null>(null);

  // Task 72 — sorting kolom tabel period (asc/desc via header)
  const sort = useTableSort(data?.periods, {
    name: (p) => p.name,
    code: (p) => p.code,
    start: (p) => p.startDate,
    taStart: (p) => p.taStartDate,
    tax: (p) => p.sptYear * 100 + p.sptMonth,
    runs: (p) => p._count.runs,
    status: (p) => p.status,
  }, { defaultKey: "start", defaultDir: "desc" });

  const closePeriod = async (p: PeriodRow) => {
    try {
      await apiSend("/api/rekankerja/payroll-periods", "PATCH", { id: p.id, status: "Closed" });
      toast.success(t("Period {name} ditutup", "Period {name} closed", { name: loc(p.name) }));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Periode Payroll")}
        description={t("Period gaji dengan jendela payroll & kehadiran (TA) terpisah, bulan pajak, dan status kunci period", "Salary periods with separate payroll & attendance (TA) windows, tax month, and period lock status")}
        actions={
          <Button onClick={() => setOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Period Baru", "New Period")}
          </Button>
        }
      />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : (data?.periods.length ?? 0) === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada period", "No periods yet")} description={t("Buat period payroll pertama untuk memulai proses gaji.", "Create the first payroll period to start paying salaries.")} icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    {sort.head("name", t("Period"), "text-[11px] font-bold")}
                    {sort.head("start", t("Jendela Payroll", "Payroll Window"), "text-[11px] font-bold")}
                    {sort.head("taStart", t("Jendela Kehadiran (TA)", "Attendance Window (TA)"), "text-[11px] font-bold")}
                    {sort.head("tax", t("Bulan Pajak", "Tax Month"), "text-[11px] font-bold")}
                    {sort.head("runs", t("Run"), "text-center text-[11px] font-bold")}
                    {sort.head("status", t("Status"), "text-[11px] font-bold")}
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((p) => (
                    <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold">{loc(p.name)}</p>
                        <p className="font-mono text-[10px] text-slate-400">{p.code} · {p.payType}</p>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {p.taStartDate ? `${fmtDate(p.taStartDate)} – ${fmtDate(p.taEndDate ?? p.endDate)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{p.sptMonth}/{p.sptYear}</TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => navigate("payroll", "runs", { period: p.id })}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 transition hover:ov-soft dark:bg-slate-800 dark:text-slate-300"
                        >
                          {p._count.runs} <ChevronRight className="h-3 w-3" />
                        </button>
                      </TableCell>
                      <TableCell><StatusPill status={p.status} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {p.status === "Open" && (
                            <>
                              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setTaEdit(p)}>
                                <PencilLine className="h-3 w-3" /> {t("Ubah TA")}
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => closePeriod(p)}>
                                <Lock className="h-3 w-3" /> {t("Tutup")}
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] font-bold ov-text-accent" onClick={() => navigate("payroll", "runs", { period: p.id })}>
                            {t("Runs")} <ChevronRight className="h-3 w-3" />
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

      <PeriodDialog open={open} onClose={() => { setOpen(false); refresh(); }} periods={data?.periods ?? []} />
      {taEdit && <TaEditDialog period={taEdit} onClose={() => { setTaEdit(null); refresh(); }} />}
    </div>
  );
}

// ===== Dialog ubah jendela TA (user-defined) pada satu period =====
function TaEditDialog({ period, onClose }: { period: PeriodRow; onClose: () => void }) {
  const { t } = useI18n();
  const [taStart, setTaStart] = useState(period.taStartDate?.slice(0, 10) ?? "");
  const [taEnd, setTaEnd] = useState(period.taEndDate?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      // kirim null bila dikosongkan → jendela TA dihapus (ikut rentang period)
      await apiSend("/api/rekankerja/payroll-periods", "PATCH", {
        id: period.id,
        taStartDate: taStart || null,
        taEndDate: taEnd || null,
      });
      toast.success(t("Jendela TA period {name} diperbarui", "Attendance window of period {name} updated", { name: period.code }));
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-4 w-4 ov-text-accent" /> {t("Jendela Kehadiran (TA)", "Attendance Window (TA)")} — {period.code}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs leading-relaxed text-slate-500">
            {t("Period payroll", "Payroll period")}: <b>{fmtDate(period.startDate)} – {fmtDate(period.endDate)}</b>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("TA Mulai", "TA Start")}</Label>
              <Input type="date" value={taStart} onChange={(e) => setTaStart(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("TA Selesai", "TA End")}</Label>
              <Input type="date" value={taEnd} onChange={(e) => setTaEnd(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
            {t("Jendela TA dipakai sebagai window default transfer absensi & cutoff kehadiran payroll. Kosongkan keduanya bila TA = rentang period.", "The TA window is the default window for attendance transfers and the attendance cutoff for payroll. Leave both empty when TA = period range.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PeriodMode = "single" | "bulk";

interface BulkRow {
  month: number; name: string; code: string;
  start: string; end: string; taStart: string | null; taEnd: string | null;
  skip: string | null;
}

const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Task 103-g — alasan skip bulk disimpan sbg KODE (bukan teks ID) agar bisa
// diterjemahkan di titik render; label ID/EN dipetakan via t() dua-argumen.
const SKIP_LABEL: Record<string, string> = { ada: "sudah ada", irisan: "beririsan" };
const SKIP_LABEL_EN: Record<string, string> = { ada: "already exists", irisan: "overlapping" };

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const safeDay = (v: string, fb: number) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, 1), 28) : fb; };

function PeriodDialog({ open, onClose, periods }: { open: boolean; onClose: () => void; periods: PeriodRow[] }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PeriodMode>("single");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  // bulk (12 bulan)
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [startDay, setStartDay] = useState("1");
  const [useTa, setUseTa] = useState(false);
  const [taStartDay, setTaStartDay] = useState("26");
  const [taStartOff, setTaStartOff] = useState("-1"); // -1 = bulan lalu, 0 = bulan ini
  const [taEndDay, setTaEndDay] = useState("25");
  const [taEndOff, setTaEndOff] = useState("0");

  const existingRanges = useMemo(
    () => periods.map((p) => ({ code: p.code, m: p.sptMonth, y: p.sptYear, s: p.startDate.slice(0, 10), e: p.endDate.slice(0, 10) })),
    [periods]
  );

  // Preview 12 bulan: hitung lokal (tanpa request) — sumber kebenaran tetap server saat submit
  const preview: BulkRow[] = useMemo(() => {
    const y = Number(year);
    if (mode !== "bulk" || !Number.isInteger(y) || y < 2000 || y > 2999) return [];
    const sd = safeDay(startDay, 1);
    return MONTH_NAMES.map((nm, i) => {
      const m = i + 1;
      const code = `${y}-${String(m).padStart(2, "0")}`;
      const s = iso(y, m, sd);
      const e = iso(y, m, lastDay(y, m));
      const ts = useTa ? iso(y, m + Number(taStartOff || 0), safeDay(taStartDay, 26)) : null;
      const te = useTa ? iso(y, m + Number(taEndOff || 0), safeDay(taEndDay, 25)) : null;
      let skip: string | null = null;
      if (existingRanges.some((p) => p.code === code || (p.y === y && p.m === m))) skip = "ada";
      else if (existingRanges.some((p) => p.s <= e && p.e >= s)) skip = "irisan";
      return { month: m, name: `${nm} ${y}`, code, start: s, end: e, taStart: ts, taEnd: te, skip };
    });
  }, [mode, year, startDay, useTa, taStartDay, taStartOff, taEndDay, taEndOff, existingRanges]);

  const creatable = preview.filter((r) => !r.skip);

  const submit = async () => {
    if (mode === "bulk") {
      if (creatable.length === 0) { toast.error(t("Tidak ada bulan yang bisa dibuat", "No months available to create")); return; }
      setBusy(true);
      try {
        const res = await apiSend<{ created: unknown[]; skipped: { month: number; reason: string }[] }>(
          "/api/rekankerja/payroll-periods", "POST",
          { bulk: true, year: Number(year), startDay: Number(startDay), payType: "Monthly", useTa,
            taStartDay: Number(taStartDay), taStartMonthOffset: Number(taStartOff),
            taEndDay: Number(taEndDay), taEndMonthOffset: Number(taEndOff) }
        );
        toast.success(t("{n} period dibuat", "{n} periods created", { n: res.created.length }) +
          (res.skipped.length ? ` · ${t("{n} dilewati", "{n} skipped", { n: res.skipped.length })}` : ""));
        onClose();
      } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
      return;
    }
    if (!name.trim() || !startDate || !endDate) { toast.error(t("Nama & tanggal period wajib diisi", "Period name & dates are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/payroll-periods", "POST", { name: name.trim(), startDate, endDate });
      toast.success(t("Period payroll dibuat", "Payroll period created"));
      setName(""); setStartDate(""); setEndDate("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-4 w-4 ov-text-accent" /> {t("Period Payroll Baru", "New Payroll Period")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-1 dark:bg-slate-900">
            {([
              ["single", t("Satu Period", "Single Period")],
              ["bulk", t("12 Bulan Sekaligus", "12 Months at Once")],
            ] as const).map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${mode === k ? "bg-white shadow-sm ov-text-accent dark:bg-slate-800" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
                {label}
              </button>
            ))}
          </div>

          {mode === "single" ? (
            <>
              <div>
                <Label className="text-xs">{t("Nama Period *", "Period Name *")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cth: OKTOBER 2026", "e.g. OCTOBER 2026")} className="mt-1.5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t("Tanggal Mulai *", "Start Date *")}</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-xs">{t("Tanggal Selesai *", "End Date *")}</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1.5" />
                </div>
              </div>
              <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
                {t("Kode period & bulan pajak (SPT) diisi otomatis dari rentang tanggal. Jendela TA dapat diatur setelah period dibuat (tombol Ubah TA).", "Period code & tax month (SPT) are filled automatically from the date range. The TA window can be set after creation (Ubah TA button).")}
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t("Tahun *", "Year *")}</Label>
                  <Input type="number" min={2000} max={2999} value={year} onChange={(e) => setYear(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-xs">{t("Tgl mulai period", "Period start day")}</Label>
                  <Input type="number" min={1} max={28} value={startDay} onChange={(e) => setStartDay(e.target.value)} className="mt-1.5" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={useTa} onChange={(e) => setUseTa(e.target.checked)} className="h-4 w-4 accent-current" />
                {t("Set jendela TA (kehadiran) sekaligus", "Also set the attendance (TA) window")}
              </label>
              {useTa && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div>
                    <Label className="text-xs">{t("TA mulai tgl", "TA start day")}</Label>
                    <Input type="number" min={1} max={28} value={taStartDay} onChange={(e) => setTaStartDay(e.target.value)} className="mt-1.5" />
                    <select value={taStartOff} onChange={(e) => setTaStartOff(e.target.value)} className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                      <option value="-1">{t("bulan sebelumnya", "previous month")}</option>
                      <option value="0">{t("bulan yang sama", "same month")}</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("TA selesai tgl", "TA end day")}</Label>
                    <Input type="number" min={1} max={28} value={taEndDay} onChange={(e) => setTaEndDay(e.target.value)} className="mt-1.5" />
                    <select value={taEndOff} onChange={(e) => setTaEndOff(e.target.value)} className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
                      <option value="-1">{t("bulan sebelumnya", "previous month")}</option>
                      <option value="0">{t("bulan yang sama", "same month")}</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs">{t("Preview 12 bulan", "12-month preview")}</Label>
                <div className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900">
                      <tr>
                        <th className="px-2.5 py-1.5 text-left font-bold">{t("Period")}</th>
                        <th className="px-2.5 py-1.5 text-left font-bold">{t("Payroll", "Payroll")}</th>
                        <th className="px-2.5 py-1.5 text-left font-bold">{t("TA")}</th>
                        <th className="px-2.5 py-1.5 text-left font-bold">{t("Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r) => (
                        <tr key={r.code} className={`border-t border-slate-100 dark:border-slate-800 ${r.skip ? "opacity-45" : ""}`}>
                          <td className="px-2.5 py-1.5 font-bold">{loc(r.name)}</td>
                          <td className="px-2.5 py-1.5 font-mono text-slate-500">{r.start.slice(5)} → {r.end.slice(5)}</td>
                          <td className="px-2.5 py-1.5 font-mono text-slate-500">
                            {r.taStart ? `${r.taStart.slice(5)} → ${r.taEnd?.slice(5)}` : "—"}
                          </td>
                          <td className={`px-2.5 py-1.5 font-semibold ${r.skip ? "text-amber-600" : "ov-text-accent"}`}>
                            {r.skip ? t(SKIP_LABEL[r.skip] ?? r.skip, SKIP_LABEL_EN[r.skip] ?? r.skip) : t("akan dibuat", "will be created")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                {t("{n} period akan dibuat — bulan yang sudah ada/beririsan dilewati.", "{n} periods will be created — existing/overlapping months are skipped.", { n: creatable.length })}
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">
            {busy ? t("Menyimpan…") : mode === "bulk"
              ? t("Buat {n} Period", "Create {n} Periods", { n: creatable.length })
              : t("Buat Period", "Create Period")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
