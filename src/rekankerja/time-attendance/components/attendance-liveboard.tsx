"use client";
// RekanKerja Attendance — Papan Kehadiran real-time (Task 27-e): "siapa di kantor
// sekarang". Auto-refresh 30 detik + refresh manual, seksi kelompok state,
// kartu karyawan (foto/awalan, unit, jam clock, badge telat), filter unit +
// cari nama/NIK. A11y: stats aria-live, sr-only label, alt foto.
import { useEffect, useMemo, useState } from "react";
import { useApi, initials, avatarColor } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";
import { ATT_STATUS_LABEL, ATT_STATUS_LABEL_EN } from "@/rekankerja/time-attendance/components/attendance-types";
import { Radar, RefreshCw, Search, LogIn, LogOut, DoorOpen, DoorClosed, UserMinus, Coffee, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveboardRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  photoUrl: string | null;
  orgUnitName: string | null;
  workLocationName: string | null;
  state: "inOffice" | "done" | "noClock" | "off" | "absent";
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
}

interface LiveboardData {
  date: string;
  updatedAt: string;
  stats: { total: number; inOffice: number; done: number; late: number; off: number; absent: number; noClock: number };
  rows: LiveboardRow[];
}

const STATUS_TONE: Record<string, string> = {
  Present: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
  Late: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Absent: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  WorkOff: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
  OnLeave: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
  Holiday: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
  Off: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const fmtTime = (d: string | null, locale: string) => {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
};

const fmtClock = (d: string | null, locale: string) => {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const REFRESH_MS = 30_000;

/** Task adv-search — jam "HH:MM" lokal (selaris fmtTime kartu). */
const hmLocal = (d: string | null) => (d ? new Date(d).toTimeString().slice(0, 5) : d);

/** Task adv-search — field Advance Search papan kehadiran (client-side, filter
 *  TAMBAHAN di atas query/unit; kelompok = state kartu, status = rekap harian
 *  via ATT_STATUS_LABEL). */
const ADV_FIELDS: AdvFieldDef<LiveboardRow>[] = [
  txt("fullName", "Nama Karyawan", "Employee Name"),
  txt("employeeNo", "No. Karyawan", "Employee No."),
  txt("orgUnitName", "Unit Organisasi", "Org Unit"),
  txt("workLocationName", "Lokasi Kerja", "Work Location"),
  sel("state", "Kelompok", "Group", [
    ["inOffice", "Sedang di Kantor", "Currently In Office"],
    ["done", "Sudah Clock-Out", "Already Clocked Out"],
    ["noClock", "Belum Absen / Menunggu", "Not Clocked Yet / Waiting"],
    ["off", "Off · Cuti · Izin", "Off · Leave · Permit"],
    ["absent", "Absen", "Absent"],
  ]),
  sel("status", "Status", "Status", (["Present", "Late", "Absent", "WorkOff", "OnLeave", "Off", "Holiday"] as const).map((k): [string, string, string] => [k, ATT_STATUS_LABEL[k] ?? k, ATT_STATUS_LABEL_EN[k] ?? k])),
  txt("checkIn", "Jam Masuk", "Clock In", (r) => hmLocal(r.checkIn)),
  txt("checkOut", "Jam Pulang", "Clock Out", (r) => hmLocal(r.checkOut)),
  num("lateMinutes", "Telat (menit)", "Late (min)"),
];

export function AttendanceLiveboardPage() {
  const { t, locale } = useI18n();
  const [date, setDate] = useState(todayIso());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [unitFilter, setUnitFilter] = useState("all");
  const [query, setQuery] = useState("");
  // Task adv-search — kondisi advance search (filter tambahan di atas query/unit).
  const [adv, setAdv] = useState<AdvSearch | null>(null);

  const api = useApi<LiveboardData>(`/api/rekankerja/attendance/liveboard?date=${date}`);

  // Auto-refresh 30 dtk (default ON) — memanggil refresh dari useApi; toggle
  // saklar mematikan interval. Refresh manual tersedia kapan pun.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => api.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, api.refresh]);

  const units = useMemo(() => {
    const set = new Set<string>();
    (api.data?.rows ?? []).forEach((r) => { if (r.orgUnitName) set.add(r.orgUnitName); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [api.data]);

  const rows = useMemo(() => filterRowsByAdv((api.data?.rows ?? []).filter((r) => {
    const q = query.toLowerCase();
    const matchQ = !q || r.fullName.toLowerCase().includes(q) || r.employeeNo.toLowerCase().includes(q);
    const matchU = unitFilter === "all" || r.orgUnitName === unitFilter;
    return matchQ && matchU;
  }), adv, ADV_FIELDS), [api.data, query, unitFilter, adv]);

  const stats = api.data?.stats;
  const isHistory = api.data ? api.data.date !== todayIso() : false;

  const sections: {
    key: LiveboardRow["state"] | "off+absent";
    title: string; icon: React.ElementType; dot: string; count: number;
    items: LiveboardRow[];
  }[] = [
    {
      key: "inOffice",
      title: t("Sedang di Kantor", "Currently In Office"),
      icon: DoorOpen, dot: "bg-brand",
      count: rows.filter((r) => r.state === "inOffice").length,
      items: rows.filter((r) => r.state === "inOffice"),
    },
    {
      key: "done",
      title: t("Sudah Clock-Out", "Already Clocked Out"),
      icon: DoorClosed, dot: "bg-slate-400",
      count: rows.filter((r) => r.state === "done").length,
      items: rows.filter((r) => r.state === "done"),
    },
    {
      key: "noClock",
      title: t("Belum Absen / Menunggu", "Not Clocked Yet / Waiting"),
      icon: UserMinus, dot: "bg-amber-400",
      count: rows.filter((r) => r.state === "noClock").length,
      items: rows.filter((r) => r.state === "noClock"),
    },
    {
      key: "off",
      title: t("Off · Cuti · Izin", "Off · Leave · Permit"),
      icon: Coffee, dot: "bg-brand/55",
      count: rows.filter((r) => r.state === "off").length,
      items: rows.filter((r) => r.state === "off"),
    },
    {
      key: "absent",
      title: t("Absen", "Absent"),
      icon: AlertTriangle, dot: "bg-rose-500",
      count: rows.filter((r) => r.state === "absent").length,
      items: rows.filter((r) => r.state === "absent"),
    },
  ];

  const chips = [
    { label: t("Di kantor sekarang", "In office now"), value: stats?.inOffice ?? 0, tone: "text-brand dark:text-brand/85" },
    { label: t("Sudah pulang", "Already left"), value: stats?.done ?? 0, tone: "text-slate-600 dark:text-slate-300" },
    { label: t("Terlambat", "Late"), value: stats?.late ?? 0, tone: "text-amber-600 dark:text-amber-400" },
    { label: t("Off & cuti", "Off & leave"), value: stats?.off ?? 0, tone: "text-brand dark:text-brand/85" },
    { label: t("Belum absen", "Not clocked"), value: stats?.noClock ?? 0, tone: "text-orange-600 dark:text-orange-400" },
    { label: t("Absen", "Absent"), value: stats?.absent ?? 0, tone: "text-rose-600 dark:text-rose-400" },
  ];

  const updating = api.loading && !!api.data;

  return (
    <div>
      <PageHeader
        eyebrow={t("Kehadiran", "Attendance")}
        title={t("Papan Kehadiran", "Attendance Live Board")}
        description={t("Siapa sedang di kantor sekarang — papan real-time dari clock in/out hari ini.", "Who is in the office right now — a real-time board from today's clock in/out.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              aria-label={t("Tanggal papan", "Board date")}
              className="h-9 w-36 text-xs font-bold"
            />
            <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
              <Switch
                id="liveboard-auto" checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label={t("Auto-refresh tiap 30 detik", "Auto-refresh every 30 seconds")}
              />
              <Label htmlFor="liveboard-auto" className="cursor-pointer text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {t("Auto-refresh", "Auto-refresh")}
              </Label>
            </div>
            <Button variant="outline" onClick={() => api.refresh()} disabled={api.loading} className="gap-2 font-bold">
              <RefreshCw className={cn("h-4 w-4", api.loading && "animate-spin")} aria-hidden />
              {t("Refresh", "Refresh")}
              <span className="sr-only">{t("Muat ulang data papan sekarang", "Reload the board data now")}</span>
            </Button>
          </div>
        }
      />

      {/* strip LIVE — indikator denyut + timestamp pembaruan terakhir */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/25 bg-brand/10 px-4 py-3 dark:border-brand/20 dark:bg-brand/10">
        <div className="flex items-center gap-2.5">
          <Radar className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
          {isHistory ? (
            <span className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
              <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden />
              {t("Mode riwayat — data tanggal {d}", "History mode — data for {d}", { d: api.data?.date ?? "—" })}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs font-bold text-brand-deep dark:text-brand/75">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
              {t("Live — diperbarui tiap 30 dtk", "Live — refreshed every 30 s")}
            </span>
          )}
        </div>
        <p role="status" className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {t("Terakhir diperbarui", "Last updated")}{" "}
          <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
            {api.data ? fmtClock(api.data.updatedAt, locale) : "—"}
          </span>
          <span className="sr-only">
            {t("Total populasi {n} karyawan aktif", "{n} active employees in total", { n: stats?.total ?? 0 })}
          </span>
        </p>
      </div>

      {/* chip statistik — aria-live polite utk pembaca layar */}
      <div role="status" aria-live="polite" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {chips.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className={cn("text-lg font-extrabold", k.tone)}>{stats ? k.value : "—"}</p>
          </div>
        ))}
      </div>

      {/* filter: unit organisasi + cari nama/NIK */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-8 w-56 text-xs font-bold" aria-label={t("Filter unit organisasi", "Filter org unit")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">{t("Semua Unit", "All Units")}</SelectItem>
              {units.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Cari nama / NIK…", "Search name / ID…")}
              aria-label={t("Cari karyawan nama atau NIK", "Search employee by name or employee number")}
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} />
        </div>
        <p className="text-[11px] font-semibold text-slate-400">
          {t("Menampilkan {n} dari {total} karyawan aktif", "Showing {n} of {total} active employees", { n: rows.length, total: stats?.total ?? 0 })}
        </p>
      </div>

      {api.error && (
        <EmptyState
          title={t("Gagal memuat papan", "Failed to load board")}
          description={api.error}
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      )}

      {api.loading && !api.data ? (
        <LoadingRows rows={6} />
      ) : !api.error && (
        <div className={cn("space-y-4 transition-opacity", updating && "opacity-60")}>
          {sections.map((sec) => {
            const Icon = sec.icon;
            return (
              <Card key={sec.key} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-800 dark:text-slate-200">
                      <span className={cn("h-2.5 w-2.5 rounded-full", sec.dot, sec.key === "inOffice" && !isHistory && "animate-pulse")} aria-hidden />
                      <Icon className="h-4 w-4 text-slate-400" aria-hidden />
                      {sec.title}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {sec.count}
                      </span>
                    </h3>
                  </div>

                  {sec.items.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-900/30">
                      {t("Tidak ada karyawan di kelompok ini", "No employees in this group")}
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {sec.items.map((r) => (
                          <EmployeeCard key={r.employeeId} r={r} locale={locale} t={t} section={sec.key} />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({
  r, locale, t, section,
}: {
  r: LiveboardRow;
  locale: string;
  t: (id: string, en: string, vars?: Record<string, string | number>) => string;
  section: string;
}) {
  const statusLabel = r.status
    ? t(ATT_STATUS_LABEL[r.status] ?? r.status, ATT_STATUS_LABEL_EN[r.status] ?? r.status)
    : t("Tanpa rekap", "No recap");
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:ov-border-accent hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10 rounded-xl">
            {r.photoUrl && <AvatarImage src={r.photoUrl} alt={t("Foto {name}", "Photo of {name}", { name: r.fullName })} />}
            <AvatarFallback className={cn("rounded-xl text-xs font-extrabold", avatarColor(r.fullName))}>
              {initials(r.fullName)}
            </AvatarFallback>
          </Avatar>
          {section === "inOffice" && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-brand dark:border-slate-900" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-200">{r.fullName}</p>
          <p className="truncate font-mono text-[10px] text-slate-400">{r.employeeNo}</p>
          <p className="truncate text-[10px] text-slate-400">
            {r.orgUnitName ?? "—"}{r.workLocationName ? ` · ${r.workLocationName}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_TONE[r.status ?? ""] ?? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
          {statusLabel}
        </span>
        {r.lateMinutes > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {t("+{n} mnt", "+{n} min", { n: r.lateMinutes })}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800/70">
        {r.checkIn ? (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-brand dark:text-brand/85" title={t("Jam masuk", "Clock in")}>
            <LogIn className="h-3 w-3" aria-hidden /> {fmtTime(r.checkIn, locale)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300 dark:text-slate-600">—</span>
        )}
        <span className="text-[10px] text-slate-300 dark:text-slate-600" aria-hidden>→</span>
        {r.checkOut ? (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-rose-600 dark:text-rose-400" title={t("Jam pulang", "Clock out")}>
            <LogOut className="h-3 w-3" aria-hidden /> {fmtTime(r.checkOut, locale)}
          </span>
        ) : section === "inOffice" ? (
          <span className="text-[10px] font-bold text-brand/80 dark:text-brand/85">{t("masih di kantor", "still in office")}</span>
        ) : (
          <span className="font-mono text-[11px] text-slate-300 dark:text-slate-600">—</span>
        )}
        {(section === "inOffice" || section === "done") && (
          <span className="sr-only">
            {t("{name} masuk {in}, pulang {out}", "{name} in at {in}, out at {out}", { name: r.fullName, in: fmtTime(r.checkIn, locale), out: r.checkOut ? fmtTime(r.checkOut, locale) : "—" })}
          </span>
        )}
      </div>
    </div>
  );
}
