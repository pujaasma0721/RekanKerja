"use client";
// OneVity Attendance — Kalender Hari Libur (T9-HOLIDAY): grid kalender 12 bulan
// + daftar per tahun + tambah/edit/hapus + import CSV / generate tahun berikutnya.
// Overlay engine: tanggal di sini menang atas cycle jadwal (resolveDayType).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { useTableSort } from "@/onevity/shared/lib/use-table-sort";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useI18n } from "@/onevity/shared/lib/i18n";
import {
  CalendarDays, Plus, Pencil, Trash2, Upload, Sparkles, CalendarRange, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface HolidayRow {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  kind: string; // National|Joint|Company
}

interface HolidaysResponse {
  year: number;
  years: number[];
  holidays: HolidayRow[];
  stats: { total: number; national: number; joint: number; company: number };
}

const KIND_OPTIONS = ["National", "Joint", "Company"] as const;

const kindLabel = (t: (id: string, en: string) => string, kind: string) =>
  kind === "Joint" ? t("Cuti Bersama", "Joint Leave") : kind === "Company" ? t("Perusahaan", "Company") : t("Nasional", "National");

const kindCellStyle: Record<string, string> = {
  National: "bg-rose-500/90 text-white hover:bg-rose-500",
  Joint: "bg-amber-400/90 text-stone-900 hover:bg-amber-400",
  Company: "bg-brand/90 text-white hover:bg-brand",
};

const kindBadgeStyle: Record<string, string> = {
  National: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
  Joint: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  Company: "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85",
};

const WEEKDAYS_ID = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const WEEKDAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ============ halaman utama ============

export function AttendanceHolidaysPage() {
  const { t, locale } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const [dialog, setDialog] = useState(false);
  const [edit, setEdit] = useState<HolidayRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HolidayRow | null>(null);
  const [form, setForm] = useState({ date: "", name: "", kind: "National" });

  const api = useApi<HolidaysResponse>(`/api/onevity/attendance/holidays?year=${year}`, [year]);
  const holidays = api.data?.holidays ?? [];

  // Task 72 — sorting kolom tabel libur (default: tanggal terdekat)
  const sort = useTableSort(holidays, {
    date: (h) => h.date,
    name: (h) => h.name,
    kind: (h) => h.kind,
  }, { defaultKey: "date", defaultDir: "asc" });

  // peta cepat date → libur (utk grid kalender)
  const byDate = useMemo(() => {
    const m = new Map<string, HolidayRow>();
    for (const h of holidays) {
      const cur = m.get(h.date);
      if (!cur || (cur.kind !== "National" && h.kind === "National")) m.set(h.date, h);
    }
    return m;
  }, [holidays]);

  const openCreate = () => {
    setEdit(null);
    setForm({ date: `${year}-01-01`, name: "", kind: "National" });
    setDialog(true);
  };
  const openEdit = (h: HolidayRow) => {
    setEdit(h);
    setForm({ date: h.date, name: h.name, kind: h.kind });
    setDialog(true);
  };

  const save = async () => {
    try {
      if (edit) {
        await apiSend("/api/onevity/attendance/holidays", "PATCH", { id: edit.id, ...form });
        toast.success(t("Hari libur {name} diperbarui", "Holiday {name} updated", { name: form.name || form.date }));
      } else {
        await apiSend("/api/onevity/attendance/holidays", "POST", form);
        toast.success(t("Hari libur {name} ditambahkan", "Holiday {name} added", { name: form.name || form.date }));
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await apiSend("/api/onevity/attendance/holidays", "DELETE", { id: deleteTarget.id });
      toast.success(t("{name} dihapus dari kalender", "{name} removed from calendar", { name: deleteTarget.name }));
      setDeleteTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus", "Failed to delete"));
    }
  };

  const stats = api.data?.stats;
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Kalender Libur Nasional", "National Holiday Calendar")}
        description={t("Hari libur nasional, cuti bersama & libur perusahaan — tanggal di sini menang atas jadwal shift (kategori Holiday: lembur 2×/3×/4×, cuti tidak memotong saldo)", "National, joint & company holidays — dates here override shift schedules (Holiday category: overtime 2×/3×/4×, leave days do not consume balance)")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger className="h-9 w-28 rounded-xl text-xs font-bold" aria-label={t("Pilih tahun", "Select year")}>
                <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-stone-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(api.data?.years.length ? api.data.years : [year]).map((y) => (
                  <SelectItem key={y} value={String(y)} className="text-xs font-bold">{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2 font-bold">
              <Upload className="h-4 w-4" /> {t("Import Kalender", "Import Calendar")}
            </Button>
            <Button onClick={openCreate} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Tambah Libur", "Add Holiday")}
            </Button>
          </div>
        }
      />

      {api.loading && !api.data ? (
        <LoadingRows rows={6} />
      ) : holidays.length === 0 ? (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-5">
            <EmptyState
              title={t("Belum ada hari libur tahun {y}", "No holidays for {y}", { y: year })}
              description={t("Tambahkan manual, atau gunakan Import Kalender untuk memuat daftar standar.", "Add manually, or use Import Calendar to load a standard list.")}
              icon={<CalendarRange className="h-6 w-6" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ==== grid kalender 12 bulan ==== */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-bold">{t("Kalender {y}", "Calendar {y}", { y: year })}</p>
                  <p className="text-[11px] text-stone-400">
                    {t("Sel berwarna = hari libur — arahkan kursor untuk nama.", "Colored cells = holidays — hover for the name.")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-stone-500">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> {t("Nasional", "National")}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> {t("Cuti Bersama", "Joint Leave")}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand" /> {t("Perusahaan", "Company")}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 12 }, (_, mo) => (
                  <MiniMonth key={mo} year={year} month={mo} byDate={byDate} todayIso={todayIso} weekdays={locale === "en-US" ? WEEKDAYS_EN : WEEKDAYS_ID} locale={locale} t={t} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ==== daftar tabel per tahun ==== */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
                <div className="flex items-center gap-2.5">
                  <CalendarDays className="h-4 w-4 ov-text-accent" />
                  <p className="text-[13px] font-bold">{t("Daftar Hari Libur {y}", "Holiday List {y}", { y: year })}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("text-[10px] font-bold", kindBadgeStyle.National)}>
                    {t("{n} nasional", "{n} national", { n: stats?.national ?? 0 })}
                  </Badge>
                  <Badge variant="outline" className={cn("text-[10px] font-bold", kindBadgeStyle.Joint)}>
                    {t("{n} cuti bersama", "{n} joint", { n: stats?.joint ?? 0 })}
                  </Badge>
                  <Badge variant="outline" className={cn("text-[10px] font-bold", kindBadgeStyle.Company)}>
                    {t("{n} perusahaan", "{n} company", { n: stats?.company ?? 0 })}
                  </Badge>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                      {sort.head("date", t("Tanggal", "Date"), "text-[11px] font-bold")}
                      <TableHead className="text-[11px] font-bold">{t("Hari", "Day")}</TableHead>
                      {sort.head("name", t("Nama Libur", "Holiday Name"), "text-[11px] font-bold")}
                      {sort.head("kind", t("Jenis", "Kind"), "text-[11px] font-bold")}
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sort.sorted.map((h) => {
                      const d = new Date(`${h.date}T00:00:00`);
                      const isToday = h.date === todayIso;
                      return (
                        <TableRow key={h.id} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", isToday && "bg-rose-50/60 dark:bg-rose-500/5")}>
                          <TableCell className={cn("font-mono text-xs font-bold text-stone-700 dark:text-stone-300", isToday && "text-rose-600 dark:text-rose-400")}>
                            {h.date}{isToday ? t(" (hari ini)", " (today)") : ""}
                          </TableCell>
                          <TableCell className="text-xs text-stone-500">
                            {new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d)}
                          </TableCell>
                          <TableCell className="text-[13px] font-medium text-stone-800 dark:text-stone-200">{h.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px] font-bold", kindBadgeStyle[h.kind] ?? kindBadgeStyle.Company)}>
                              {kindLabel(t, h.kind)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(h)} aria-label={t("Edit hari libur", "Edit holiday")}>
                                <Pencil className="h-3.5 w-3.5 text-stone-400" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => setDeleteTarget(h)} aria-label={t("Hapus hari libur", "Delete holiday")}>
                                <Trash2 className="h-3.5 w-3.5 text-stone-400" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-5 py-3 dark:border-stone-800">
                <p className="text-[11px] text-stone-400">
                  {t("{n} hari libur tahun {y} — hari kerja cuti otomatis melewati tanggal-tanggal ini.", "{n} holidays in {y} — leave day counts automatically skip these dates.", { n: holidays.length, y: year })}
                </p>
                <StatusPill status="Active" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==== dialog tambah/edit ==== */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="rounded-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 ov-text-accent" />
              {edit ? t("Edit Hari Libur", "Edit Holiday") : t("Tambah Hari Libur", "Add Holiday")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal", "Date")}</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jenis", "Kind")}</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                  <SelectTrigger className="text-sm" aria-label={t("Jenis libur", "Holiday kind")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((k) => (
                      <SelectItem key={k} value={k} className="text-sm">{kindLabel(t, k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Nama Libur", "Holiday Name")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("mis. Hari Raya Idulfitri 1447 H", "e.g. Eid al-Fitr 1447 H")}
                className="text-sm"
                maxLength={120}
              />
            </div>
            <p className="flex items-start gap-2 rounded-xl border border-stone-200/70 bg-stone-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-stone-900/40">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
              {t("Tanggal libur menimpa jadwal shift: lembur hari itu masuk kategori Holiday (2×/3×/4×) dan saldo cuti tidak terpotong.", "Holiday dates override shift schedules: overtime falls under Holiday category (2×/3×/4×) and leave balance is not deducted.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="font-bold">{t("Batal", "Cancel")}</Button>
            <Button onClick={save} className="gap-1.5 font-bold">
              {edit ? t("Simpan Perubahan", "Save Changes") : t("Tambahkan", "Add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==== dialog konfirmasi hapus ==== */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t("Hapus hari libur?", "Delete holiday?")}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-stone-500">
            {deleteTarget
              ? t(`"${deleteTarget.name}" (${deleteTarget.date}) akan dihapus dari kalender — jadwal shift kembali mengikuti cycle.`, `"${deleteTarget.name}" (${deleteTarget.date}) will be removed — shift schedules take over again.`)
              : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="font-bold">{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={remove} className="gap-1.5 font-bold">
              <Trash2 className="h-3.5 w-3.5" /> {t("Hapus", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==== dialog import kalender ==== */}
      <HolidayImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        year={year}
        template={holidays}
        onImported={() => {
          api.refresh();
          setImportOpen(false);
        }}
      />
    </div>
  );
}

export default AttendanceHolidaysPage;

// ============ mini bulan (grid kalender) ============

function MiniMonth({
  year, month, byDate, todayIso, weekdays, locale, t,
}: {
  year: number; month: number; byDate: Map<string, HolidayRow>; todayIso: string;
  weekdays: string[]; locale: string; t: (id: string, en: string) => string;
}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Senin = 0
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long" }).format(first);
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-xl border border-stone-200/70 bg-stone-50/50 p-3 dark:border-stone-800 dark:bg-stone-900/40">
      <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-stone-600 dark:text-stone-300">{monthLabel}</p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w) => (
          <span key={w} className="text-[8px] font-bold uppercase text-stone-400">{w.slice(0, 3)}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const h = byDate.get(iso);
          const isToday = iso === todayIso;
          return (
            <span
              key={iso}
              title={h ? `${h.name} — ${h.kind === "Joint" ? t("cuti bersama", "joint leave") : h.kind === "Company" ? t("libur perusahaan", "company holiday") : t("libur nasional", "national holiday")}` : undefined}
              className={cn(
                "flex h-6 items-center justify-center rounded-md text-[10px] font-bold",
                h
                  ? kindCellStyle[h.kind] ?? kindCellStyle.Company
                  : "text-stone-500 dark:text-stone-400",
                isToday && "ring-2 ring-stone-800/60 dark:ring-stone-300/60",
              )}
            >
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ============ dialog import (paste CSV / generate tahun berikutnya) ============

function HolidayImportDialog({
  open, onOpenChange, year, template, onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  year: number;
  template: HolidayRow[];
  onImported: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const parseCsv = (raw: string): { date: string; name: string; kind: string }[] => {
    const out: { date: string; name: string; kind: string }[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const parts = s.split(/[;,\t]/).map((x) => x.trim());
      if (parts.length < 2) continue;
      const date = parts[0] ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const kind = ["National", "Joint", "Company"].includes(parts[2] ?? "") ? parts[2]! : "National";
      out.push({ date, name: parts.slice(1, 2).join(" ").slice(0, 120) || "-", kind });
    }
    return out;
  };

  const parsed = useMemo(() => parseCsv(text), [text]);

  const generateNextYear = () => {
    const next = year + 1;
    if (template.length === 0) {
      toast.info(t("Belum ada libur tahun {y} sebagai template.", "No {y} holidays to use as a template.", { y: year }));
      return;
    }
    const lines = template
      .map((h) => {
        const d = new Date(`${h.date}T00:00:00`);
        d.setFullYear(next);
        // guard 29 Feb di tahun non-kabisat
        if (d.getMonth() !== new Date(`${h.date}T00:00:00`).getMonth()) return null;
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return `${iso};${h.name};${h.kind}`;
      })
      .filter((x): x is string => x !== null);
    setText(lines.join("\n"));
    toast.success(t("Template {y} dimuat dari {n} libur tahun {c} — periksa tanggal, lalu klik Import.", "Template {y} loaded from {n} holidays of {c} — review the dates, then click Import.", { y: next, n: lines.length, c: year }));
  };

  const doImport = async () => {
    if (parsed.length === 0) {
      toast.error(t("Tidak ada baris valid — format: YYYY-MM-DD;Nama;National|Joint|Company", "No valid rows — format: YYYY-MM-DD;Name;National|Joint|Company"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ imported: number; skipped: number; invalid: string[]; note: string }>(
        "/api/onevity/attendance/holidays", "POST", { rows: parsed },
      );
      toast.success(res.note || t("{n} hari libur diimpor", "{n} holidays imported", { n: res.imported }));
      if (res.invalid.length > 0) toast.warning(res.invalid[0]);
      onImported();
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengimpor", "Failed to import"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 ov-text-accent" /> {t("Import Kalender Libur", "Import Holiday Calendar")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-stone-400">
              {t("Format per baris: YYYY-MM-DD;Nama;National|Joint|Company (jenis opsional). Duplikat (tanggal+nama) dilewati otomatis.", "One row per line: YYYY-MM-DD;Name;National|Joint|Company (kind optional). Duplicates (date+name) are skipped automatically.")}
            </p>
            <Button variant="outline" size="sm" onClick={generateNextYear} className="gap-1.5 font-bold">
              <Sparkles className="h-3.5 w-3.5" /> {t("Generate {y} dari {c}", "Generate {y} from {c}", { y: year + 1, c: year })}
            </Button>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={`2027-01-01;Tahun Baru Masehi 2027;National\n2027-08-17;Hari Proklamasi Kemerdekaan RI;National\n2027-12-24;Cuti Bersama Natal;Joint`}
            className="rounded-xl font-mono text-xs"
          />
          <p className="text-[11px] font-semibold text-stone-500">
            {parsed.length > 0
              ? t("{n} baris valid siap diimpor", "{n} valid rows ready to import", { n: parsed.length })
              : t("Tempel CSV di atas, atau generate template tahun berikutnya.", "Paste CSV above, or generate next year's template.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-bold">{t("Batal", "Cancel")}</Button>
          <Button onClick={doImport} disabled={busy || parsed.length === 0} className="gap-1.5 font-bold">
            <Upload className="h-3.5 w-3.5" /> {t("Import {n} baris", "Import {n} rows", { n: parsed.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
