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
// B4-BL — SUCCESSION PLANNING (§4 B4; D-BL13…D-BL15) — seksi di bawah attrisi:
//   • Toolbar "Tambah Peran Kritis" + "Ekspor XLSX" (dwibahasa ikut lang).
//   • Register peran: kartu per peran kritis (pemegang, badge kritis, target,
//     progress coverage x/N ReadyNow — merah bila 0, hijau bila terpenuhi) +
//     kandidat (chip readiness berwarna, snapshot 9-box, flight risk kecil,
//     devNotes ringkas) + aksi per kandidat (edit dialog / refresh risk / hapus)
//     + aksi peran (edit target/kritis/catatan, segarkan semua risiko, hapus).
//   • Dialog tambah kandidat: "Sarankan Kandidat" (9-box + saran readiness —
//     D-BL13) ATAU cari manual; readiness 4 opsi + devNotes textarea.
//   • HANYA dirender bila GET talent mengirim field `succession` (aktor
//     HR/Direksi — D-BL12; cakupan tim atasan tidak melihat register).
// Dwibahasa penuh t() BASE_EN. DialogContent sm:max-w-* (Aturan Emas).
import { Fragment, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  TrendingUp, Search, AlertTriangle, ChevronDown, ChevronRight, Users,
  Plus, Download, RefreshCw, Pencil, Trash2, Crown, UserPlus, Loader2, Lightbulb,
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
  /** B4 — ringkasan succession (hanya utk aktor HR/Direksi — D-BL12). */
  succession?: { positions: number; candidates: number; uncovered: number };
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

      {/* ---- B4: seksi succession — HANYA utk aktor HR/Direksi (field
           succession dikirim server-side; cakupan tim tidak melihat) ---- */}
      {data?.succession != null && <SuccessionSection />}
    </div>
  );
}

// ============================================================================
// B4-BL — SUCCESSION PLAN (D-BL13…D-BL15) — seksi di bawah attrisi
// ============================================================================

interface SuccCandidate {
  id: string; employeeId: string; employeeNo: string; fullName: string;
  unitName: string | null; readiness: string; suggested9Box: string | null;
  flightRisk: number | null; devNotes: string | null;
}
interface SuccPosition {
  id: string; positionId: string; positionTitle: string; positionCode: string;
  unitName: string | null; incumbentName: string | null; incumbentNo: string | null;
  critical: boolean; targetSuccessors: number; note: string | null;
  candidates: SuccCandidate[]; readyNowCount: number;
  coverage: { readyNow: number; target: number; ok: boolean };
}
interface SuccData {
  positions: SuccPosition[];
  stats: { positions: number; candidates: number; uncovered: number };
  viewer: { isHr: boolean };
}
interface PositionPick {
  id: string; code: string; title: string; unitName: string | null;
  incumbentName: string | null; inSuccession: boolean;
}
interface SuggestedRow {
  employeeId: string; employeeNo: string; fullName: string; unitName: string | null;
  rating: number | null; potentialBand: number | null;
  suggested9Box: string | null; suggestedReadiness: string; flightRisk: number | null;
}

/** Label sel 9-box dwibahasa (mirror NINE_BOX_LABELS service — client-side). */
const NINE_BOX_LABELS_UI: Record<string, { id: string; en: string }> = {
  "Bintang": { id: "Bintang", en: "Stars" },
  "Performa Tinggi": { id: "Performa Tinggi", en: "High Performer" },
  "Ahli Andal": { id: "Ahli Andal", en: "Trusted Expert" },
  "Potensi Tinggi": { id: "Potensi Tinggi", en: "High Potential" },
  "Pemain Inti": { id: "Pemain Inti", en: "Core Player" },
  "Efektif": { id: "Efektif", en: "Effective" },
  "Permata Mentah": { id: "Permata Mentah", en: "Rough Diamond" },
  "Tidak Konsisten": { id: "Tidak Konsisten", en: "Inconsistent" },
  "Perlu Perbaikan": { id: "Perlu Perbaikan", en: "Underperformer" },
};

/** Terjemahkan snapshot "4/5 — Bintang" mengikuti bahasa UI. */
function nineBoxLabel(snapshot: string | null, t: (id: string, en: string) => string): string | null {
  if (!snapshot) return null;
  const idx = snapshot.indexOf("—");
  if (idx < 0) return snapshot;
  const rating = snapshot.slice(0, idx).trim();
  const label = snapshot.slice(idx + 1).trim();
  const meta = NINE_BOX_LABELS_UI[label];
  return `${rating} — ${meta ? t(meta.id, meta.en) : label}`;
}

/** Metadata readiness (D-BL13) — label dwibahasa + warna chip. */
const READINESS_META: Record<string, { id: string; en: string; chip: string }> = {
  ReadyNow: {
    id: "Siap Sekarang", en: "Ready Now",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  Ready1yr: {
    id: "Siap 1 Tahun", en: "Ready in 1 Year",
    chip: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-400",
  },
  Ready23yr: {
    id: "Siap 2–3 Tahun", en: "Ready in 2–3 Years",
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500",
  },
  Development: {
    id: "Pengembangan", en: "Development",
    chip: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  },
};

function SuccessionSection() {
  const { t, locale } = useI18n();
  const api = useApi<SuccData>(`${TALENT_API}?succession=1`);
  const data = api.data;
  const isHr = data?.viewer.isHr ?? false;
  const positions = data?.positions ?? [];
  const stats = data?.stats;

  const [busy, setBusy] = useState<string>(""); // key aksi sedang berjalan
  const [exporting, setExporting] = useState(false);

  // ---- dialog peran (tambah/ubah) ----
  const [posOpen, setPosOpen] = useState(false);
  const [posTarget, setPosTarget] = useState<SuccPosition | null>(null); // null = tambah
  const [posForm, setPosForm] = useState<{ positionId: string; critical: boolean; targetSuccessors: number; note: string }>({
    positionId: "", critical: true, targetSuccessors: 2, note: "",
  });
  const pickerApi = useApi<{ positions: PositionPick[] }>(
    posOpen && !posTarget ? `${TALENT_API}?positions=1` : null,
    [posOpen, posTarget],
  );
  const pickerRows = (pickerApi.data?.positions ?? []).filter((p) => !p.inSuccession);

  const openPosCreate = () => {
    setPosTarget(null);
    setPosForm({ positionId: "", critical: true, targetSuccessors: 2, note: "" });
    setPosOpen(true);
  };
  const openPosEdit = (p: SuccPosition) => {
    setPosTarget(p);
    setPosForm({ positionId: p.positionId, critical: p.critical, targetSuccessors: p.targetSuccessors, note: p.note ?? "" });
    setPosOpen(true);
  };

  const submitPos = async () => {
    if (!posTarget && !posForm.positionId) {
      toast.error(t("Pilih posisi utk didaftarkan sebagai peran kritis", "Pick a position to register as a critical role"));
      return;
    }
    if (!Number.isInteger(posForm.targetSuccessors) || posForm.targetSuccessors < 1 || posForm.targetSuccessors > 10) {
      toast.error(t("Target penerus harus 1–10", "Successor target must be 1–10"));
      return;
    }
    setBusy("pos");
    try {
      await apiSend(`${TALENT_API}`, "POST", posTarget
        ? { action: "upsertPosition", id: posTarget.id, critical: posForm.critical, targetSuccessors: posForm.targetSuccessors, note: posForm.note }
        : { action: "upsertPosition", positionId: posForm.positionId, critical: posForm.critical, targetSuccessors: posForm.targetSuccessors, note: posForm.note });
      toast.success(posTarget
        ? t("Register peran diperbarui", "Role register updated")
        : t("Peran kritis terdaftar", "Critical role registered"));
      setPosOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  const deletePos = async (p: SuccPosition) => {
    if (!window.confirm(t(
      `Hapus register peran "${p.positionTitle}"? (hanya bisa bila tidak punya kandidat)`,
      `Remove the role register "${p.positionTitle}"? (only possible with no candidates)`,
    ))) return;
    setBusy(`posdel-${p.id}`);
    try {
      await apiSend(`${TALENT_API}`, "POST", { action: "deletePosition", id: p.id });
      toast.success(t("Register peran dihapus", "Role register deleted"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  // ---- dialog kandidat (tambah) ----
  const [candOpen, setCandOpen] = useState(false);
  const [candTarget, setCandTarget] = useState<SuccPosition | null>(null);
  const [candQ, setCandQ] = useState("");
  const [suggested, setSuggested] = useState<SuggestedRow[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [selected, setSelected] = useState<SuggestedRow | null>(null);
  const [candForm, setCandForm] = useState<{ readiness: string; devNotes: string }>({ readiness: "", devNotes: "" });

  const openCandAdd = (p: SuccPosition) => {
    setCandTarget(p);
    setCandQ("");
    setSuggested(null);
    setSelected(null);
    setCandForm({ readiness: "", devNotes: "" });
    setCandOpen(true);
  };

  const runSuggest = async () => {
    if (!candTarget) return;
    setSuggesting(true);
    try {
      const res = await apiSend<{ rows: SuggestedRow[] }>(`${TALENT_API}`, "POST", {
        action: "suggest", positionId: candTarget.positionId, q: candQ.trim() || undefined,
      });
      setSuggested(res.rows);
      if (res.rows.length === 0) {
        toast.info(t("Tidak ada karyawan yang cocok", "No matching employees"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setSuggesting(false); }
  };

  const pickSuggested = (r: SuggestedRow) => {
    setSelected(r);
    setCandForm((f) => ({ ...f, readiness: r.suggestedReadiness })); // saran sistem — HR bebas mengubah (D-BL13)
  };

  const submitCand = async () => {
    if (!candTarget || !selected) {
      toast.error(t("Pilih kandidat dari daftar saran/pencarian", "Pick a candidate from the suggestion/search list"));
      return;
    }
    setBusy("cand");
    try {
      await apiSend(`${TALENT_API}`, "POST", {
        action: "addCandidate",
        successionPositionId: candTarget.id,
        employeeId: selected.employeeId,
        readiness: candForm.readiness || undefined,
        devNotes: candForm.devNotes || undefined,
      });
      toast.success(t("{n} ditambahkan sebagai kandidat penerus", "{n} added as a successor candidate", { n: selected.fullName }));
      setCandOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  // ---- dialog kandidat (ubah readiness/devNotes) ----
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ cand: SuccCandidate; pos: SuccPosition } | null>(null);
  const [editForm, setEditForm] = useState<{ readiness: string; devNotes: string }>({ readiness: "", devNotes: "" });

  const openCandEdit = (pos: SuccPosition, cand: SuccCandidate) => {
    setEditTarget({ cand, pos });
    setEditForm({ readiness: cand.readiness, devNotes: cand.devNotes ?? "" });
    setEditOpen(true);
  };

  const submitEdit = async (refreshRisk = false) => {
    if (!editTarget) return;
    setBusy("edit");
    try {
      await apiSend(`${TALENT_API}`, "POST", {
        action: "updateCandidate", id: editTarget.cand.id,
        readiness: editForm.readiness, devNotes: editForm.devNotes, refreshRisk,
      });
      toast.success(refreshRisk
        ? t("Kandidat diperbarui + risiko attrisi di-segarkan", "Candidate updated + attrition risk refreshed")
        : t("Kandidat diperbarui", "Candidate updated"));
      setEditOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  const refreshOneRisk = async (cand: SuccCandidate) => {
    setBusy(`risk-${cand.id}`);
    try {
      const res = await apiSend<{ flightRisk: number | null }>(`${TALENT_API}`, "POST", {
        action: "updateCandidate", id: cand.id, refreshRisk: true,
      });
      toast.success(t("Risiko attrisi {n}: {s}", "Flight risk {n}: {s}", { n: cand.fullName, s: String(res.flightRisk ?? "—") }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  const refreshAll = async (p: SuccPosition) => {
    setBusy(`allrisk-${p.id}`);
    try {
      const res = await apiSend<{ refreshed: number }>(`${TALENT_API}`, "POST", {
        action: "refreshAllRisk", successionPositionId: p.id,
      });
      toast.success(t("Risiko attrisi {n} kandidat di-segarkan", "Flight risk refreshed for {n} candidates", { n: String(res.refreshed) }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  const removeCand = async (pos: SuccPosition, cand: SuccCandidate) => {
    if (!window.confirm(t(
      `Hapus ${cand.fullName} dari kandidat "${pos.positionTitle}"?`,
      `Remove ${cand.fullName} from the "${pos.positionTitle}" candidates?`,
    ))) return;
    setBusy(`cdel-${cand.id}`);
    try {
      await apiSend(`${TALENT_API}`, "POST", { action: "removeCandidate", id: cand.id });
      toast.success(t("Kandidat dihapus", "Candidate removed"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(""); }
  };

  // ---- ekspor XLSX (D-BL15 — POST blob → anchor click) ----
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${TALENT_API}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exportXlsx", lang: locale.startsWith("en") ? "en" : "id" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] ?? "rekankerja-succession-plan.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
      toast.success(t("Rencana suksesi terunduh (XLSX).", "The succession plan was downloaded (XLSX)."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ekspor gagal", "Export failed"));
    } finally { setExporting(false); }
  };

  // ---- elemen kecil ----
  const readinessChip = (readiness: string) => {
    const meta = READINESS_META[readiness];
    return (
      <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold", meta ? meta.chip : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400")}>
        {meta ? t(meta.id, meta.en) : readiness}
      </span>
    );
  };

  const riskBadge = (risk: number | null) => (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-black tabular-nums",
        risk == null
          ? "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
          : risk >= 50
            ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
            : risk >= 25
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
      )}
      title={t("Skor heuristik attrisi 0–100 (D-BL10 — refresh on-demand)", "Attrition heuristic score 0–100 (D-BL10 — refreshed on demand)")}
    >
      {risk == null ? "—" : risk}
    </span>
  );

  if (api.loading && !api.data) {
    return (
      <Card className="min-w-0">
        <CardContent className="p-4"><LoadingRows rows={3} /></CardContent>
      </Card>
    );
  }
  if (api.error) {
    return (
      <EmptyState
        icon={<Crown />}
        title={t("Gagal memuat rencana suksesi", "Failed to load the succession plan")}
        description={api.error}
      />
    );
  }

  return (
    <div className="space-y-4">
      <hr className="border-slate-200 dark:border-slate-800" />
      <PageHeader
        eyebrow="Performance · B4"
        title={t("Succession Plan — penerus per peran kritis", "Succession Plan — successors per critical role")}
        description={t(
          "Daftarkan peran kritis & kandidat penerusnya. Saran kandidat di-seed dari penempatan 9-box siklus terakhir yang dipublikasikan (rating × band potensi — D-BL13); readiness adalah keputusan MANUAL HR di atas saran sistem. Catatan pengembangan berupa teks — bukan modul pelatihan (D-BL14).",
          "Register critical roles & their successor candidates. Candidates are seeded from the latest published 9-box placement (rating × potential band — D-BL13); readiness is a MANUAL HR decision on top of the system suggestion. Development notes are plain text — not a training module (D-BL14).",
        )}
      />

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
          <Crown className="h-4 w-4 text-amber-500" aria-hidden />
          {t("Register peran kritis", "Critical role register")}
          {stats && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              {t("{p} peran · {c} kandidat · {u} tanpa penerus siap", "{p} roles · {c} candidates · {u} without a ready successor", { p: String(stats.positions), c: String(stats.candidates), u: String(stats.uncovered) })}
            </Badge>
          )}
        </h3>
        {isHr && (
          <Button size="sm" className="h-9 rounded-xl gap-1.5" onClick={openPosCreate}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("Tambah Peran Kritis", "Add Critical Role")}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-9 rounded-xl gap-1.5" onClick={exportXlsx} disabled={exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
          {t("Ekspor XLSX", "Export XLSX")}
        </Button>
      </div>

      {positions.length === 0 ? (
        <EmptyState
          icon={Crown}
          title={t("Belum ada peran kritis terdaftar", "No critical roles registered yet")}
          description={t(
            "Daftarkan peran kritis pertama (mis. posisi yang sulit digantikan) lalu isi kandidat penerusnya — saran diambil dari penempatan 9-box siklus terakhir yang dipublikasikan.",
            "Register the first critical role (e.g. a hard-to-replace position) then fill in successor candidates — suggestions come from the latest published 9-box placement.",
          )}
        />
      ) : (
        <div className="space-y-3">
          {positions.map((p) => {
            const covered = p.coverage.ok;
            const zero = p.readyNowCount === 0;
            return (
              <Card key={p.id} className="min-w-0">
                <CardContent className="p-4">
                  {/* baris judul peran */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{p.positionTitle}</p>
                        {p.critical && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            {t("Kritis", "Critical")}
                          </span>
                        )}
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[9px] font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                          {p.positionCode}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                        {p.unitName ?? "—"} · {t("pemegang", "incumbent")}: <span className="font-semibold text-slate-600 dark:text-slate-300">{p.incumbentName ?? "—"}</span>{p.incumbentNo ? ` (${p.incumbentNo})` : ""}
                      </p>
                      {p.note && (
                        <p className="mt-1 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-2 py-1 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400" title={p.note}>
                          {p.note}
                        </p>
                      )}
                    </div>
                    {isHr && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openCandAdd(p)}>
                          <UserPlus className="h-3.5 w-3.5" aria-hidden />
                          <span className="ml-1 hidden sm:inline">{t("Kandidat", "Candidate")}</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={busy === `allrisk-${p.id}`} onClick={() => refreshAll(p)} title={t("Segarkan flight risk semua kandidat peran ini", "Refresh the flight risk of all this role's candidates")}>
                          {busy === `allrisk-${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                          <span className="sr-only">{t("Segarkan semua risiko", "Refresh all risks")}</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => openPosEdit(p)} title={t("Ubah target/kritis/catatan", "Edit target/critical/notes")}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">{t("Ubah peran", "Edit role")}</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400" disabled={busy === `posdel-${p.id}`} onClick={() => deletePos(p)} title={t("Hapus register peran", "Delete the role register")}>
                          {busy === `posdel-${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                          <span className="sr-only">{t("Hapus peran", "Delete role")}</span>
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* coverage */}
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                      <span className={cn(
                        "tabular-nums",
                        zero ? "text-rose-600 dark:text-rose-400" : covered ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500",
                      )}>
                        {t("Cakupan: {x}/{n} penerus siap (ReadyNow)", "Coverage: {x}/{n} ready successors (ReadyNow)", { x: String(p.coverage.readyNow), n: String(p.coverage.target) })}
                      </span>
                      <span className={cn(
                        "rounded-full border px-2 py-0.5 text-[9px] font-black",
                        zero
                          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                          : covered
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500",
                      )}>
                        {zero
                          ? t("Tanpa penerus siap", "No ready successor")
                          : covered
                            ? t("Terpenuhi", "Covered")
                            : t("Belum terpenuhi", "Below target")}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={cn("h-full rounded-full", zero ? "bg-rose-500" : covered ? "bg-emerald-500" : "bg-amber-400")}
                        style={{ width: `${Math.min(100, p.coverage.target > 0 ? (p.coverage.readyNow / p.coverage.target) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>

                  {/* daftar kandidat */}
                  {p.candidates.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-400">
                      {t("Belum ada kandidat — tambahkan dari saran 9-box.", "No candidates yet — add one from the 9-box suggestions.")}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-1.5">
                      {p.candidates.map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800"
                        >
                          <div className="min-w-0 flex-1 basis-40">
                            <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{c.fullName}</p>
                            <p className="truncate text-[11px] text-slate-400">
                              {c.employeeNo}{c.unitName ? ` · ${c.unitName}` : ""}
                            </p>
                          </div>
                          {readinessChip(c.readiness)}
                          <span className="max-w-44 truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400" title={t("Snapshot saran 9-box saat ditambahkan (D-BL13)", "9-box suggestion snapshot at add time (D-BL13)")}>
                            {nineBoxLabel(c.suggested9Box, t) ?? t("belum terpetakan", "not placed yet")}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                            {t("risiko", "risk")} {riskBadge(c.flightRisk)}
                          </span>
                          {c.devNotes && (
                            <span className="w-full truncate text-[11px] italic text-slate-500 dark:text-slate-400" title={c.devNotes}>
                              {t("pengembangan", "dev")}: {c.devNotes}
                            </span>
                          )}
                          {isHr && (
                            <div className="ml-auto flex shrink-0 items-center gap-1">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[11px]" disabled={busy === `risk-${c.id}`} onClick={() => refreshOneRisk(c)} title={t("Segarkan flight risk kandidat ini", "Refresh this candidate's flight risk")}>
                                {busy === `risk-${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                                <span className="sr-only">{t("Segarkan risiko", "Refresh risk")}</span>
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[11px]" onClick={() => openCandEdit(p, c)} title={t("Ubah readiness / catatan", "Edit readiness / notes")}>
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">{t("Ubah kandidat", "Edit candidate")}</span>
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400" disabled={busy === `cdel-${c.id}`} onClick={() => removeCand(p, c)} title={t("Hapus kandidat", "Remove candidate")}>
                                {busy === `cdel-${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                                <span className="sr-only">{t("Hapus kandidat", "Remove candidate")}</span>
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ================= dialog tambah/ubah peran ================= */}
      <Dialog open={posOpen} onOpenChange={(o) => { if (!o) setPosOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {posTarget
                ? t("Ubah Peran Kritis — {p}", "Edit Critical Role — {p}", { p: posTarget.positionTitle })
                : t("Tambah Peran Kritis", "Add Critical Role")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {posTarget ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40">
                <p className="font-bold">{posTarget.positionTitle}</p>
                <p className="text-xs text-slate-500">
                  {posTarget.unitName ?? "—"} · {t("pemegang", "incumbent")}: {posTarget.incumbentName ?? "—"}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("Posisi", "Position")}</Label>
                <Select value={posForm.positionId} onValueChange={(v) => setPosForm((f) => ({ ...f, positionId: v }))}>
                  <SelectTrigger aria-label={t("Pilih posisi", "Pick a position")}>
                    <SelectValue placeholder={t("Pilih posisi…", "Pick a position…")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {pickerApi.loading && !pickerApi.data ? (
                      <div className="p-2 text-xs text-slate-400">{t("Memuat posisi…", "Loading positions…")}</div>
                    ) : pickerRows.length === 0 ? (
                      <div className="p-2 text-xs text-slate-400">{t("Semua posisi aktif sudah terdaftar", "All active positions are already registered")}</div>
                    ) : pickerRows.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.title}{x.unitName ? ` · ${x.unitName}` : ""}{x.incumbentName ? ` — ${x.incumbentName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <label className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <span>{t("Peran kritis (sulit digantikan)", "Critical role (hard to replace)")}</span>
              <Switch checked={posForm.critical} onCheckedChange={(v) => setPosForm((f) => ({ ...f, critical: v }))} aria-label={t("Peran kritis", "Critical role")} />
            </label>
            <div className="space-y-1">
              <Label>{t("Target penerus siap (ReadyNow)", "Ready successor target (ReadyNow)")}</Label>
              <Input
                type="number" min={1} max={10}
                value={posForm.targetSuccessors}
                onChange={(e) => setPosForm((f) => ({ ...f, targetSuccessors: Number(e.target.value) }))}
                aria-label={t("Target penerus siap", "Ready successor target")}
              />
              <p className="text-[10px] text-slate-400">{t("Default 2 (D-BL14) — coverage terpenuhi bila jumlah ReadyNow ≥ target.", "Default 2 (D-BL14) — coverage is met when ReadyNow count ≥ target.")}</p>
            </div>
            <div className="space-y-1">
              <Label>{t("Catatan peran (opsional)", "Role note (optional)")}</Label>
              <Textarea
                rows={2}
                value={posForm.note}
                onChange={(e) => setPosForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("Contoh: satu-satunya pemegang lisensi mesin produksi", "e.g. the sole holder of the production machine license")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPosOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitPos} disabled={busy === "pos"}>
              {busy === "pos" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {posTarget ? t("Simpan Perubahan", "Save Changes") : t("Daftarkan", "Register")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= dialog tambah kandidat ================= */}
      <Dialog open={candOpen} onOpenChange={(o) => { if (!o) setCandOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("Tambah Kandidat — {p}", "Add Candidate — {p}", { p: candTarget?.positionTitle ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              <p className="flex items-start gap-1.5">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                {t(
                  "Saran di-seed dari penempatan 9-box siklus terakhir yang dipublikasikan (rating × band potensi — D-BL13). Readiness tetap keputusan manual HR.",
                  "Suggestions are seeded from the latest published 9-box placement (rating × potential band — D-BL13). Readiness remains a manual HR decision.",
                )}
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(ev) => { ev.preventDefault(); runSuggest(); }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={candQ}
                  onChange={(e) => setCandQ(e.target.value)}
                  placeholder={t("Cari nama / no. karyawan…", "Search name / employee no.…")}
                  className="h-9 rounded-xl pl-8"
                  aria-label={t("Cari kandidat", "Search candidates")}
                />
              </div>
              <Button type="submit" size="sm" variant="outline" className="h-9 rounded-xl gap-1.5" disabled={suggesting}>
                {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Lightbulb className="h-3.5 w-3.5" aria-hidden />}
                {t("Sarankan Kandidat", "Suggest Candidates")}
              </Button>
            </form>

            {suggested != null && (
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                {suggested.length === 0 ? (
                  <p className="p-2 text-xs text-slate-400">{t("Tidak ada karyawan yang cocok.", "No matching employees.")}</p>
                ) : suggested.map((r) => {
                  const active = selected?.employeeId === r.employeeId;
                  return (
                    <button
                      key={r.employeeId}
                      type="button"
                      onClick={() => pickSuggested(r)}
                      className={cn(
                        "flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-2.5 py-2 text-left transition",
                        active
                          ? "border-brand bg-brand/10"
                          : "border-slate-200 hover:border-brand/50 dark:border-slate-700",
                      )}
                      aria-pressed={active}
                    >
                      <span className="min-w-0 flex-1 basis-36">
                        <span className="block truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{r.fullName}</span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {r.employeeNo}{r.unitName ? ` · ${r.unitName}` : ""}
                        </span>
                      </span>
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                        {nineBoxLabel(r.suggested9Box, t) ?? t("belum terpetakan", "not placed yet")}
                      </span>
                      {readinessChip(r.suggestedReadiness)}
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        {t("risiko", "risk")} {riskBadge(r.flightRisk)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {selected && (
              <div className="space-y-3 rounded-xl border border-brand/40 bg-brand/5 p-3">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  {t("Kandidat terpilih: {n}", "Selected candidate: {n}", { n: selected.fullName })}
                </p>
                <div className="space-y-1">
                  <Label>{t("Readiness (keputusan HR — D-BL13)", "Readiness (HR decision — D-BL13)")}</Label>
                  <Select value={candForm.readiness} onValueChange={(v) => setCandForm((f) => ({ ...f, readiness: v }))}>
                    <SelectTrigger aria-label={t("Readiness kandidat", "Candidate readiness")}>
                      <SelectValue placeholder={t("Pilih readiness…", "Pick readiness…")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(["ReadyNow", "Ready1yr", "Ready23yr", "Development"] as const).map((k) => {
                        const meta = READINESS_META[k];
                        return <SelectItem key={k} value={k}>{t(meta.id, meta.en)}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("Catatan aksi pengembangan (teks — D-BL14)", "Development action notes (text — D-BL14)")}</Label>
                  <Textarea
                    rows={2}
                    value={candForm.devNotes}
                    onChange={(e) => setCandForm((f) => ({ ...f, devNotes: e.target.value }))}
                    placeholder={t("Contoh: mentoring rotasi ke unit Finance Q3, sertifikasi teknis", "e.g. rotation mentoring with Finance in Q3, technical certification")}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCandOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitCand} disabled={!selected || busy === "cand"}>
              {busy === "cand" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t("Tambahkan Kandidat", "Add Candidate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= dialog ubah kandidat ================= */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("Ubah Kandidat — {n}", "Edit Candidate — {n}", { n: editTarget?.cand.fullName ?? "" })}
            </DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/40">
                <p className="font-bold">{editTarget.cand.fullName} <span className="font-mono text-[10px] text-slate-400">{editTarget.cand.employeeNo}</span></p>
                <p className="text-slate-500">
                  {t("Peran", "Role")}: {editTarget.pos.positionTitle} · 9-box: {nineBoxLabel(editTarget.cand.suggested9Box, t) ?? "—"} · {t("risiko", "risk")}: {editTarget.cand.flightRisk ?? "—"}
                </p>
              </div>
              <div className="space-y-1">
                <Label>{t("Readiness (keputusan HR — D-BL13)", "Readiness (HR decision — D-BL13)")}</Label>
                <Select value={editForm.readiness} onValueChange={(v) => setEditForm((f) => ({ ...f, readiness: v }))}>
                  <SelectTrigger aria-label={t("Readiness kandidat", "Candidate readiness")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["ReadyNow", "Ready1yr", "Ready23yr", "Development"] as const).map((k) => {
                      const meta = READINESS_META[k];
                      return <SelectItem key={k} value={k}>{t(meta.id, meta.en)}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("Catatan aksi pengembangan (teks — D-BL14)", "Development action notes (text — D-BL14)")}</Label>
                <Textarea
                  rows={3}
                  value={editForm.devNotes}
                  onChange={(e) => setEditForm((f) => ({ ...f, devNotes: e.target.value }))}
                  placeholder={t("Aksi pengembangan konkret utk mempersiapkan penerus…", "Concrete development actions to prepare the successor…")}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => submitEdit(true)} disabled={busy === "edit"}>
              {busy === "edit" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />}
              {t("Simpan + Segarkan Risiko", "Save + Refresh Risk")}
            </Button>
            <Button onClick={() => submitEdit(false)} disabled={busy === "edit"}>{t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
