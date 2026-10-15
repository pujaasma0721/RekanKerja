"use client";
// B3-BL — TALENT & RISIKO ATTRISI (DEVELOPMENT-PLAN-BACKLOG.md §4 B3; D-BL10…D-BL12).
// Heuristik EXPLAINABLE — BUKAN prediksi ML:
//   • Header + banner disclaimer amber (D-BL11): label eksplisit "heuristik —
//     bukan prediksi ML"; faktor yang datanya tak tersedia DINETRALKAN (keluar
//     dari pembilang & penyebut — chip "data terbatas", bukan difabrikasi).
//   • Filter: pencarian nama/no + select unit (/api/rekankerja/org-units —
//     endpoint daftar unit yang sama dgn modul Kinerja lain) + toggle
//     "hanya Tinggi".
//   • Statistik 3 tile (Tinggi/Sedang/Rendah — distribusi populasi).
//   • Tabel desktop (≥640px): karyawan, unit, jabatan, skor (badge merah/amber/
//     hijau), level, expand rincian faktor (mini progress score/max + note +
//     chip "data terbatas" bila unavailable). Mobile <640px: kartu.
//   • Empty state + scope info (atasan melihat tim sendiri — D-BL12).
// Dwibahasa penuh t() BASE_EN. Read-only — tanpa dialog fase ini.
import { Fragment, useMemo, useState } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  TrendingUp, Search, AlertTriangle, ChevronDown, ChevronRight, Users,
} from "lucide-react";

const TALENT_API = "/api/rekankerja/performance/talent";

// ---- bentuk baris (mirror service talent-service.ts — deklarasi lokal utk client) ----
interface FactorRow {
  key: string; score: number; max: number; available: boolean; note: string;
}
interface AttritionRow {
  employeeId: string; employeeNo: string; fullName: string;
  unitName: string | null; positionName: string | null; gradeCode: string | null;
  score: number; level: "Tinggi" | "Sedang" | "Rendah";
  factors: FactorRow[];
}
interface TalentData {
  rows: AttritionRow[];
  stats: { tinggi: number; sedang: number; rendah: number; total: number };
  disclaimer: string;
  scope: "all" | "team";
}

// label faktor dwibahasa (key dari service — API kirim key saja)
const FACTOR_LABEL: Record<string, { id: string; en: string; max: number }> = {
  rating: { id: "Rating terakhir", en: "Latest rating", max: 30 },
  trend: { id: "Tren rating (2 siklus)", en: "Rating trend (2 cycles)", max: 10 },
  pip: { id: "PIP aktif / riwayat", en: "Active / past PIP", max: 20 },
  tenure: { id: "Tenure", en: "Tenure", max: 10 },
  compa: { id: "Kompa-rasio gaji", en: "Salary compa-ratio", max: 15 },
  reward: { id: "Waktu sejak reward", en: "Time since reward", max: 15 },
};
const FACTOR_ORDER = ["rating", "trend", "pip", "tenure", "compa", "reward"];

const LEVEL_STYLE: Record<string, { chip: string; bar: string }> = {
  Tinggi: {
    chip: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
    bar: "bg-rose-500",
  },
  Sedang: {
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500",
    bar: "bg-amber-400",
  },
  Rendah: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
};

export function PerformanceTalentPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState(""); // nilai terkirim (debounce sederhana via Enter/tombol)
  const [unitId, setUnitId] = useState("all");
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("q", search.trim());
    if (unitId !== "all") p.set("unitId", unitId);
    if (onlyHigh) p.set("onlyHigh", "1");
    return `${TALENT_API}?${p.toString()}`;
  }, [search, unitId, onlyHigh]);

  const api = useApi<TalentData>(listUrl, [listUrl]);
  const unitsApi = useApi<{ units: { id: string; name: string }[] }>("/api/rekankerja/org-units");

  const data = api.data;
  const rows = data?.rows ?? [];
  const stats = data?.stats;

  const toggleExpand = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // ---- rincian faktor (dipakai tabel desktop & kartu mobile) ----
  const factorDetail = (f: FactorRow) => {
    const meta = FACTOR_LABEL[f.key] ?? { id: f.key, en: f.key, max: f.max };
    const pct = f.available && meta.max > 0 ? Math.round((f.score / meta.max) * 100) : 0;
    return (
      <div
        key={f.key}
        className={cn(
          "rounded-xl border px-3 py-2",
          f.available
            ? "border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40"
            : "border-dashed border-slate-300 bg-transparent dark:border-slate-700",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-bold text-slate-700 dark:text-slate-300">
            {t(meta.id, meta.en)}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {!f.available && (
              <span className="rounded-md border border-slate-300 bg-white px-1 py-px text-[9px] font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
                {t("data terbatas", "limited data")}
              </span>
            )}
            <span className="text-[11px] font-black tabular-nums text-slate-900 dark:text-slate-50">
              {f.available ? `${f.score}/${f.max}` : "—"}
            </span>
          </div>
        </div>
        {/* mini progress per faktor (explainable — D-BL10) */}
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={cn("h-full rounded-full", pct >= 60 ? "bg-rose-500" : pct > 0 ? "bg-amber-400" : "bg-emerald-500")}
            style={{ width: f.available ? `${Math.max(pct, 4)}%` : "0%" }}
          />
        </div>
        <p className="mt-1 truncate text-[10px] leading-snug text-slate-500 dark:text-slate-400" title={f.note}>{f.note}</p>
      </div>
    );
  };

  const scoreBadge = (r: AttritionRow) => (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black tabular-nums", LEVEL_STYLE[r.level].chip)}>
      {r.score}
    </span>
  );

  const levelBadge = (level: string) => (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold", LEVEL_STYLE[level].chip)}>
      {level === "Tinggi" ? t("Tinggi", "High") : level === "Sedang" ? t("Sedang", "Medium") : t("Rendah", "Low")}
    </span>
  );

  const rowExpandBtn = (r: AttritionRow, compact = false) => {
    const open = expanded.has(r.employeeId);
    const hiddenCount = r.factors.filter((f) => !f.available).length;
    return (
      <button
        type="button"
        className={cn(
          "flex items-center gap-1 rounded-md font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
          compact ? "text-[10px]" : "text-[11px]",
        )}
        aria-expanded={open}
        aria-label={t("Rincian faktor {n}", "Factor breakdown of {n}", { n: r.fullName })}
        onClick={() => toggleExpand(r.employeeId)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        {t("faktor", "factors")}
        {hiddenCount > 0 && (
          <span className="rounded bg-slate-200 px-1 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {hiddenCount} {t("terbatas", "limited")}
          </span>
        )}
      </button>
    );
  };

  // ---- kartu mobile (<640px — pola collapse performance-okr) ----
  const mobileCard = (r: AttritionRow) => {
    const open = expanded.has(r.employeeId);
    return (
      <Card key={r.employeeId} className="min-w-0">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-50">{r.fullName}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {r.employeeNo} · {r.unitName ?? "—"}
              </p>
              <p className="truncate text-[11px] text-slate-400">
                {r.positionName ?? "—"}{r.gradeCode ? ` · ${r.gradeCode}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {scoreBadge(r)}
              {levelBadge(r.level)}
            </div>
          </div>
          {/* bar skor penuh 0–100 */}
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className={cn("h-full rounded-full", LEVEL_STYLE[r.level].bar)} style={{ width: `${r.score}%` }} />
          </div>
          <div className="mt-2">{rowExpandBtn(r, true)}</div>
          {open && <div className="mt-2 grid grid-cols-2 gap-1.5">{r.factors.map(factorDetail)}</div>}
        </CardContent>
      </Card>
    );
  };

  if (!api.data && api.loading) return <LoadingRows />;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Performance · B3"
        title={t("Talent & Risiko Attrisi", "Talent & Attrition Risk")}
        description={t(
          "Heuristik explainable dari faktor ber-bobot tetap (rating, tren, PIP, tenure, kompa-rasio, waktu sejak reward) — BUKAN prediksi ML. Faktor yang datanya tak tersedia dinetralkan (dikeluarkan dari pembilang & penyebut) dan ditandai \"data terbatas\".",
          "An explainable heuristic from fixed-weight factors (rating, trend, PIP, tenure, compa-ratio, time since reward) — NOT an ML prediction. Factors with missing data are neutralized (removed from both numerator & denominator) and flagged \"limited data\".",
        )}
      />

      {api.error && <EmptyState icon={<TrendingUp />} title={t("Gagal memuat risiko attrisi", "Failed to load attrition risk")} description={api.error} />}

      {/* ---- banner disclaimer amber (D-BL11 — SELALU tampil) ---- */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
            {t("Heuristik explainable — BUKAN prediksi ML", "Explainable heuristic — NOT an ML prediction")}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700/90 dark:text-amber-400/80">
            {t(
              "Skor 0–100 dihitung dari bobot tetap yang ter-audit, bukan model statistik — bukan kepastian bahwa karyawan akan resign. Gunakan sebagai sinyal percakapan retensi 1-on-1; faktor yang datanya kurang (mis. belum 2 siklus penilaian) dinetralkan dan diberi tanda \"data terbatas\", tidak difabrikasi.",
              "The 0–100 score is computed from auditable fixed weights, not a statistical model — it is not a certainty that the employee will resign. Use it as a conversation starter for 1-on-1 retention talks; factors with insufficient data (e.g. fewer than 2 appraisal cycles) are neutralized and flagged \"limited data\", never fabricated.",
            )}
          </p>
        </div>
      </div>

      {/* ---- filter: pencarian + unit + hanya Tinggi ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2 sm:max-w-xs"
          onSubmit={(ev) => { ev.preventDefault(); setSearch(q); }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Cari nama / no. karyawan…", "Search name / employee no.…")}
              className="h-9 rounded-xl pl-8"
              aria-label={t("Cari karyawan", "Search employee")}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-9 rounded-xl">
            {t("Cari", "Search")}
          </Button>
        </form>
        <Select value={unitId} onValueChange={setUnitId}>
          <SelectTrigger className="h-9 w-40 rounded-xl sm:w-48" aria-label={t("Filter unit kerja", "Org unit filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua unit", "All units")}</SelectItem>
            {(unitsApi.data?.units ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <Switch checked={onlyHigh} onCheckedChange={setOnlyHigh} aria-label={t("Hanya risiko Tinggi", "High risk only")} />
          {t("Hanya Tinggi", "High only")}
        </label>
        {data?.scope === "team" && (
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[10px] font-bold text-brand-deep dark:text-brand/85">
            {t("Cakupan: tim langsung Anda", "Scope: your direct team")}
          </span>
        )}
      </div>

      {/* ---- statistik 3 tile (distribusi populasi sebelum filter onlyHigh) ---- */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: "tinggi", label: t("Tinggi", "High"), value: stats.tinggi, style: "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10", num: "text-rose-600 dark:text-rose-400" },
            { key: "sedang", label: t("Sedang", "Medium"), value: stats.sedang, style: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10", num: "text-amber-600 dark:text-amber-500" },
            { key: "rendah", label: t("Rendah", "Low"), value: stats.rendah, style: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10", num: "text-emerald-600 dark:text-emerald-400" },
          ]).map((x) => (
            <Card key={x.key} className={cn("border", x.style)}>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{x.label}</p>
                <p className={cn("mt-1 text-2xl font-black tabular-nums", x.num)}>{x.value}</p>
                <p className="text-[10px] text-slate-400">
                  {t("dari {n} karyawan", "of {n} employees", { n: stats.total })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("Tidak ada karyawan pada cakupan ini", "No employees in this scope")}
          description={t(
            "Coba ubah kata kunci pencarian, unit, atau matikan filter \"Hanya Tinggi\". Daftar hanya memuat karyawan berstatus Aktif.",
            "Try changing the search keyword, unit, or turning off the \"High only\" filter. The list only includes Active employees.",
          )}
        />
      ) : (
        <Card className="min-w-0">
          <CardContent className="p-4">
            {/* ---- tabel desktop (≥640px) ---- */}
            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Karyawan", "Employee")}</TableHead>
                    <TableHead>{t("Unit", "Unit")}</TableHead>
                    <TableHead>{t("Jabatan", "Position")}</TableHead>
                    <TableHead className="text-right">{t("Skor", "Score")}</TableHead>
                    <TableHead>{t("Level", "Level")}</TableHead>
                    <TableHead className="w-40">{t("Rincian", "Breakdown")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const open = expanded.has(r.employeeId);
                    return (
                      <Fragment key={r.employeeId}>
                        <TableRow>
                          <TableCell className="max-w-56">
                            <p className="font-semibold">{r.fullName}</p>
                            <p className="text-[11px] text-slate-500">{r.employeeNo}{r.gradeCode ? ` · ${r.gradeCode}` : ""}</p>
                          </TableCell>
                          <TableCell className="max-w-40 truncate text-xs" title={r.unitName ?? undefined}>
                            {r.unitName ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-xs" title={r.positionName ?? undefined}>
                            {r.positionName ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 lg:block dark:bg-slate-800">
                                <div className={cn("h-full rounded-full", LEVEL_STYLE[r.level].bar)} style={{ width: `${r.score}%` }} />
                              </div>
                              {scoreBadge(r)}
                            </div>
                          </TableCell>
                          <TableCell>{levelBadge(r.level)}</TableCell>
                          <TableCell>{rowExpandBtn(r)}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-slate-50/60 p-3 dark:bg-slate-900/30">
                              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                {FACTOR_ORDER.map((key) => {
                                  const f = r.factors.find((x) => x.key === key);
                                  return f ? factorDetail(f) : null;
                                })}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {/* ---- mobile <640px → kartu ---- */}
            <div className="space-y-3 sm:hidden">
              {rows.map(mobileCard)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
