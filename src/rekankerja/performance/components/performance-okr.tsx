"use client";
// B1-BL — OKR Kuartalan + Board Transparan (DEVELOPMENT-PLAN-BACKLOG.md §4 B1;
// D-BL1…D-BL5). Alat transparansi tujuan TERPISAH dari mesin penilaian
// (label tegas "tujuan, bukan penilaian" — mitigasi risiko §5).
//   • Header: picker kuartal (default kuartal berjalan) + filter status +
//     (HR) tombol "Objective Baru".
//   • Board: kartu objective (owner + unit, progress bar % live dari skor
//     server on-read, warna confidence dominan) + expand daftar KR (baseline→
//     target, current, mini progress, confidence dot, note) + chip pohon
//     "mendukung: <parent>".
//   • Dialog create/edit (picker owner aktif, align-to Draft/Post kuartal sama,
//     editor KR dinamis 3–5 Σbobot 100 meter, polarity, baseline/target).
//   • Dialog detail (GET ?id= + anak align) + aksi post/close per status
//     (close = konfirmasi skor final server).
//   • Dialog update KR (current/confidence/note — owner/HR saat Posted).
//   • Banner fitur-off (okrEnabled=false, D-BL2) + tombol aktifkan (HR).
//   • Desktop: toggle Board/Tabel; mobile <640px: kartu saja (hscroll=0).
// Dwibahasa penuh t() BASE_EN.
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Telescope, Plus, Search, ChevronDown, ChevronRight, Trash2, Send, Lock,
  Info, ListTree, Table2, LayoutGrid, CircleCheck,
} from "lucide-react";

const OKR_API = "/api/rekankerja/performance/okr";

// ---- bentuk baris (mirror service OkrObjectiveRow — import type tak bisa:
// service mengimpor modul server; bentuk dideklarasi lokal utk client) ----
interface KrRow {
  id: string; title: string; unit: string; polarity: string;
  baseline: number; target: number; current: number;
  weight: number; confidence: string; note: string | null;
  score: number; updatedAt: string;
}
interface OkrRow {
  id: string; quarter: string; title: string; status: string;
  ownerEmployeeId: string; ownerName: string; ownerNo: string;
  ownerUnit: string | null; ownerPosition: string | null;
  alignToId: string | null; alignParentTitle: string | null;
  liveScore: number; progressPct: number; closedScore: number | null;
  confidence: "Red" | "Yellow" | "Green" | null;
  krs: KrRow[]; createdAt: string; updatedAt: string;
}
interface BoardData {
  rows: OkrRow[];
  okrEnabled: boolean;
  currentQuarter: string;
  quarters: string[];
  viewer: { employeeId: string | null; isHr: boolean };
}
interface OkrDetail {
  row: OkrRow;
  alignChildren: { id: string; title: string; ownerName: string; status: string; quarter: string }[];
}
interface EmpOpt { id: string; employeeNo: string; fullName: string; position: string | null; orgUnit: string | null }
interface AlignOpt { id: string; title: string; status: string; ownerName: string }

interface KrForm {
  title: string; unit: string; polarity: string;
  baseline: string; target: string; weight: string;
}
const emptyKr = (): KrForm => ({ title: "", unit: "%", polarity: "HigherIsBetter", baseline: "0", target: "", weight: "" });

const QUARTER_RE_UI = /^\d{4}-Q[1-4]$/;

// warna confidence dot (D-BL4 — subjektif pemilik, BEDA dari skor)
const CONF_DOT: Record<string, string> = {
  Red: "bg-rose-500",
  Yellow: "bg-amber-400",
  Green: "bg-emerald-500",
};
const CONF_LABEL: Record<string, { id: string; en: string }> = {
  Red: { id: "Merah", en: "Red" },
  Yellow: { id: "Kuning", en: "Yellow" },
  Green: { id: "Hijau", en: "Green" },
};

/** Warna progress bar dari skor live (0–100). */
function scoreTone(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 40) return "bg-amber-400";
  return "bg-rose-400";
}

export function PerformanceOkrPage() {
  const { t } = useI18n();
  const [quarter, setQuarter] = useState<string>(""); // kosong = kuartal berjalan
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (quarter) p.set("quarter", quarter);
    if (statusFilter !== "all") p.set("status", statusFilter);
    return `${OKR_API}?${p.toString()}`;
  }, [quarter, statusFilter]);
  const api = useApi<BoardData>(listUrl, [listUrl]);

  const data = api.data;
  const viewer = data?.viewer ?? { employeeId: null, isHr: false };
  const rows = data?.rows ?? [];

  // ---- aktifkan mode OKR (banner fitur-off — D-BL2) ----
  const [busyFlag, setBusyFlag] = useState(false);
  const enableOkr = async () => {
    setBusyFlag(true);
    try {
      await apiSend<{ setting: { okrEnabled: boolean } }>("/api/rekankerja/performance/settings", "POST", { okrEnabled: true });
      toast.success(t("Mode OKR kuartalan diaktifkan", "Quarterly OKR mode enabled"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  // ---- dialog create/edit ----
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OkrRow | null>(null); // null = create
  const [form, setForm] = useState<{ quarter: string; title: string; ownerEmployeeId: string; alignToId: string; krs: KrForm[] }>({
    quarter: "", title: "", ownerEmployeeId: "", alignToId: "none", krs: [emptyKr(), emptyKr(), emptyKr()],
  });
  const [empQ, setEmpQ] = useState("");
  const empApi = useApi<{ employees: EmpOpt[] }>(
    editOpen ? `${OKR_API}?employees=1&q=${encodeURIComponent(empQ)}` : null,
    [editOpen, empQ],
  );
  const alignApi = useApi<{ options: AlignOpt[] }>(
    editOpen ? `${OKR_API}?alignOptions=1&quarter=${encodeURIComponent(form.quarter || data?.currentQuarter || "")}${editTarget ? `&excludeId=${editTarget.id}` : ""}` : null,
    [editOpen, form.quarter, editTarget?.id],
  );
  const selectedEmp = useMemo(
    () => (empApi.data?.employees ?? []).find((e) => e.id === form.ownerEmployeeId) ?? null,
    [empApi.data, form.ownerEmployeeId],
  );
  const krSum = (krs: KrForm[]) => krs.reduce((s, x) => s + (Number(x.weight) || 0), 0);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ quarter: data?.currentQuarter ?? "", title: "", ownerEmployeeId: "", alignToId: "none", krs: [emptyKr(), emptyKr(), emptyKr()] });
    setEmpQ("");
    setEditOpen(true);
  };
  const openEdit = (r: OkrRow) => {
    setEditTarget(r);
    setForm({
      quarter: r.quarter,
      title: r.title,
      ownerEmployeeId: r.ownerEmployeeId,
      alignToId: r.alignToId ?? "none",
      krs: r.krs.map((k) => ({
        title: k.title, unit: k.unit, polarity: k.polarity,
        baseline: String(k.baseline), target: String(k.target), weight: String(k.weight),
      })),
    });
    setEmpQ("");
    setEditOpen(true);
  };

  const submitObjective = async () => {
    if (!QUARTER_RE_UI.test(form.quarter)) { toast.error(t("Kuartal harus format YYYY-Qn, contoh {q}.", "Quarter must be YYYY-Qn, e.g. {q}.", { q: data?.currentQuarter ?? "2026-Q1" })); return; }
    if (form.title.trim().length < 3) { toast.error(t("Judul objective wajib ≥3 karakter", "Objective title needs ≥3 characters")); return; }
    if (!form.ownerEmployeeId) { toast.error(t("Pilih pemilik objective", "Pick the objective owner")); return; }
    if (form.krs.length < 3 || form.krs.length > 5) { toast.error(t("Key result harus 3–5 item", "Key results must be 3–5 items")); return; }
    const sum = krSum(form.krs);
    if (Math.abs(sum - 100) > 0.01) { toast.error(t("Jumlah bobot key result harus 100 (sekarang {w}).", "Key result weights must total 100 (now {w}).", { w: String(Math.round(sum)) })); return; }
    for (const k of form.krs) {
      if (k.title.trim().length < 3 || !k.unit.trim()) { toast.error(t("Judul & satuan tiap key result wajib diisi", "Each key result needs a title and unit")); return; }
      if (Number(k.baseline) === Number(k.target) || !Number.isFinite(Number(k.target))) { toast.error(t("Target tiap key result harus berbeda dari baseline", "Each key result target must differ from its baseline")); return; }
    }
    const payload = {
      quarter: form.quarter,
      title: form.title.trim(),
      ownerEmployeeId: form.ownerEmployeeId,
      alignToId: form.alignToId === "none" ? null : form.alignToId,
      keyResults: form.krs.map((k) => ({
        title: k.title.trim(), unit: k.unit.trim(), polarity: k.polarity,
        baseline: Number(k.baseline), target: Number(k.target), weight: Number(k.weight),
      })),
    };
    setBusyFlag(true);
    try {
      if (editTarget) {
        await apiSend(OKR_API, "POST", { action: "update", id: editTarget.id, ...payload });
        toast.success(t("Objective diperbarui", "Objective updated"));
      } else {
        await apiSend(OKR_API, "POST", { action: "create", ...payload });
        toast.success(t("Objective dibuat sebagai Draft", "Objective created as Draft"));
      }
      setEditOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  // ---- dialog detail ----
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailApi = useApi<OkrDetail>(detailId ? `${OKR_API}?id=${detailId}` : null, [detailId]);
  const detail = detailApi.data?.row ?? null;

  // ---- dialog update KR ----
  const [krTarget, setKrTarget] = useState<OkrRow | null>(null);
  const [krForms, setKrForms] = useState<Record<string, { current: string; confidence: string; note: string }>>({});

  const openKrDialog = (r: OkrRow) => {
    setKrTarget(r);
    setKrForms(Object.fromEntries(r.krs.map((k) => [k.id, { current: String(k.current), confidence: k.confidence, note: k.note ?? "" }])));
  };

  // ---- dialog close (konfirmasi skor final) ----
  const [closeTarget, setCloseTarget] = useState<OkrRow | null>(null);

  const act = async (body: Record<string, unknown>, okMsg: string): Promise<Record<string, unknown> | null> => {
    setBusyFlag(true);
    try {
      const res = await apiSend<Record<string, unknown>>(OKR_API, "POST", body);
      toast.success(okMsg);
      api.refresh();
      detailApi.refresh();
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
      return null;
    } finally { setBusyFlag(false); }
  };

  // aksi per baris — guard server tetap otoritatif (owner/HR, status)
  const isOwner = (r: OkrRow) => viewer.employeeId != null && viewer.employeeId === r.ownerEmployeeId;
  const canMutate = (r: OkrRow) => viewer.isHr || isOwner(r);
  const rowActions = (r: OkrRow) => (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetailId(r.id)}>{t("Detail", "Detail")}</Button>
      {r.status === "Draft" && canMutate(r) && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEdit(r)}>{t("Edit", "Edit")}</Button>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => act({ action: "post", id: r.id }, t("Objective diposting ke board", "Objective posted to the board"))}>
            <Send className="h-3 w-3" aria-hidden /> {t("Posting", "Post")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" disabled={busyFlag} aria-label={t("Hapus", "Delete")} onClick={() => act({ action: "delete", id: r.id }, t("Objective dihapus", "Objective deleted"))}>
            <Trash2 className="h-3 w-3" aria-hidden />
          </Button>
        </>
      )}
      {r.status === "Posted" && canMutate(r) && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => openKrDialog(r)}>
          {t("Update KR", "Update KR")}
        </Button>
      )}
      {r.status === "Posted" && viewer.isHr && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => setCloseTarget(r)}>
          <Lock className="h-3 w-3" aria-hidden /> {t("Tutup", "Close")}
        </Button>
      )}
    </div>
  );

  // ---- sub-render: chip align + confidence ----
  const confDot = (c: string | null) => c ? (
    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", CONF_DOT[c] ?? "bg-slate-300")} aria-label={t(`Confidence ${c}`, `Confidence ${c}`)} />
  ) : null;

  const krMini = (k: KrRow) => (
    <div key={k.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200" title={k.title}>{k.title}</p>
        <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-slate-400">{t("bobot", "weight")} {k.weight}%</span>
        {confDot(k.confidence)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="tabular-nums">{k.baseline} → <span className="font-semibold text-slate-700 dark:text-slate-300">{k.target}</span> {k.unit}</span>
        <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">· {t("kini", "now")} {k.current}</span>
        <span>({k.polarity === "LowerIsBetter" ? t("semakin rendah semakin baik", "lower is better") : t("semakin tinggi semakin baik", "higher is better")})</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className={cn("h-full rounded-full", scoreTone(Math.round(k.score * 100)))} style={{ width: `${Math.round(k.score * 100)}%` }} />
      </div>
      {k.note && <p className="mt-1 line-clamp-2 text-[11px] italic text-slate-500 dark:text-slate-400">“{k.note}”</p>}
    </div>
  );

  const objCard = (r: OkrRow) => {
    const open = expanded.has(r.id);
    return (
      <Card key={r.id} className="min-w-0 border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-50" title={r.title}>{r.title}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {r.ownerName} · {r.ownerNo} · {r.ownerUnit ?? "—"}{r.ownerPosition ? ` · ${r.ownerPosition}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {confDot(r.confidence)}
              <StatusPill status={r.status === "Posted" ? "Approved" : r.status === "Closed" ? "Closed" : "Prepared"} />
            </div>
          </div>
          {r.alignParentTitle && (
            <p className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700 dark:border-fuchsia-500/25 dark:bg-fuchsia-500/10 dark:text-fuchsia-400">
              <ListTree className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{t("mendukung: {p}", "supports: {p}", { p: r.alignParentTitle })}</span>
            </p>
          )}
          {/* progress bar live (skor server on-read — D-BL5) */}
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className={cn("h-full rounded-full transition-all", scoreTone(r.progressPct))} style={{ width: `${r.progressPct}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right text-sm font-black tabular-nums text-slate-900 dark:text-slate-50">
              {r.status === "Closed" && r.closedScore != null
                ? `${Math.round(r.closedScore * 100)}%`
                : `${r.progressPct}%`}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] font-medium text-slate-400">
            {r.status === "Closed"
              ? t("skor final tersimpan saat ditutup", "final score saved at close")
              : t("progres live — dihitung on-read, bukan penilaian", "live progress — computed on-read, not an appraisal")}
          </p>
          <div className="mt-2">
            {rowActions(r)}
          </div>
          {/* expand KR */}
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-1 rounded-md px-1 py-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            aria-expanded={open}
            onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            {t("{n} key result", "{n} key results", { n: String(r.krs.length) })}
          </button>
          {open && <div className="mt-2 space-y-2">{r.krs.map(krMini)}</div>}
        </CardContent>
      </Card>
    );
  };

  if (!api.data && api.loading) return <LoadingRows />;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Performance · B1"
        title={t("OKR Kuartalan", "Quarterly OKR")}
        description={t(
          "Tujuan kuartalan + board transparan — alat penyelarasan, BUKAN penilaian (terpisah dari skor/rating/merit). Posted terlihat seluruh karyawan; Draft hanya pemilik + HR; skor server dihitung on-read dan disimpan final saat kuartal ditutup (HR).",
          "Quarterly objectives + a transparent board — an alignment tool, NOT an appraisal (fully separate from scores/ratings/merit). Posted is visible to all employees; Draft stays with its owner + HR; the server score is computed on-read and only saved as final when HR closes the quarter.",
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={quarter || data?.currentQuarter || ""} onValueChange={(v) => setQuarter(v === data?.currentQuarter ? "" : v)}>
              <SelectTrigger className="w-32" aria-label={t("Kuartal", "Quarter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(data?.quarters ?? [data?.currentQuarter ?? ""]).filter(Boolean).map((q) => (
                  <SelectItem key={q} value={q}>{q}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" aria-label={t("Filter status", "Status filter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
                <SelectItem value="Posted">{t("Posted", "Posted")}</SelectItem>
                <SelectItem value="Draft">{t("Draft", "Draft")}</SelectItem>
                <SelectItem value="Closed">{t("Closed", "Closed")}</SelectItem>
              </SelectContent>
            </Select>
            {/* desktop toggle board/tabel */}
            <div className="hidden overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 sm:flex">
              <Button size="sm" variant={viewMode === "board" ? "default" : "ghost"} className="h-8 rounded-none px-2.5" aria-pressed={viewMode === "board"} onClick={() => setViewMode("board")}>
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button size="sm" variant={viewMode === "table" ? "default" : "ghost"} className="h-8 rounded-none px-2.5" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")} aria-label={t("Tabel", "Table")}>
                <Table2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            {viewer.isHr && (
              <Button onClick={openCreate}><Plus className="h-4 w-4" aria-hidden /> {t("Objective Baru", "New Objective")}</Button>
            )}
          </div>
        )}
      />

      {api.error && <EmptyState icon={<Telescope />} title={t("Gagal memuat OKR", "Failed to load OKR")} description={api.error} />}

      {/* banner fitur-off (D-BL2 — default OFF per tenant) */}
      {data && !data.okrEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex min-w-0 items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">{t("Mode OKR kuartalan belum aktif", "Quarterly OKR mode is not enabled")}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700/90 dark:text-amber-400/80">
                {t(
                  "Fitur per-tenant default nonaktif. Aktifkan untuk mulai menyusun objective kuartalan, board transparan lintas tim, dan skor server otoritatif.",
                  "This per-tenant feature is off by default. Enable it to start drafting quarterly objectives, a cross-team transparent board, and authoritative server scoring.",
                )}
              </p>
            </div>
          </div>
          {viewer.isHr && (
            <Button disabled={busyFlag} onClick={enableOkr} className="shrink-0 bg-amber-600 font-bold text-white hover:bg-amber-700">
              <CircleCheck className="h-4 w-4" aria-hidden /> {t("Aktifkan Mode OKR", "Enable OKR Mode")}
            </Button>
          )}
        </div>
      )}

      {data?.okrEnabled && rows.length === 0 ? (
        <EmptyState
          icon={Telescope}
          title={t("Belum ada objective di kuartal ini", "No objectives in this quarter")}
          description={t(
            "Objective ber-status Posted terlihat seluruh karyawan (board silang-tim). HR atau karyawan (via OKR Saya) dapat membuat objective baru ber-status Draft.",
            "Posted objectives are visible to all employees (cross-team board). HR — or employees via My OKR — can create new objectives as Drafts.",
          )}
        />
      ) : null}

      {data?.okrEnabled && rows.length > 0 && (
        <>
          {/* ---- board grid (default; satu-satunya tampilan di mobile <640px) ---- */}
          {viewMode === "board" && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map(objCard)}
            </div>
          )}
          {/* ---- tabel ringkas (≥640px, mode tabel) ---- */}
          {viewMode === "table" && (
            <Card className="min-w-0">
              <CardContent className="p-4">
                <div className="hidden overflow-x-auto sm:block">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>{t("Objective", "Objective")}</TableHead>
                      <TableHead>{t("Pemilik", "Owner")}</TableHead>
                      <TableHead>{t("Kuartal", "Quarter")}</TableHead>
                      <TableHead>{t("Progres", "Progress")}</TableHead>
                      <TableHead>{t("Confidence", "Confidence")}</TableHead>
                      <TableHead>{t("Status", "Status")}</TableHead>
                      <TableHead className="w-56"></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="max-w-64">
                            <button type="button" className="text-left font-semibold text-fuchsia-600 hover:underline dark:text-fuchsia-400" onClick={() => setDetailId(r.id)}>{r.title}</button>
                            {r.alignParentTitle && <p className="text-[10px] text-slate-500">{t("mendukung: {p}", "supports: {p}", { p: r.alignParentTitle })}</p>}
                            <p className="text-[10px] text-slate-400">{r.krs.length} KR</p>
                          </TableCell>
                          <TableCell className="text-xs">
                            <p className="font-medium">{r.ownerName}</p>
                            <p className="text-slate-500">{r.ownerNo} · {r.ownerUnit ?? "—"}</p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.quarter}</TableCell>
                          <TableCell className="w-40">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                                <div className={cn("h-full rounded-full", scoreTone(r.progressPct))} style={{ width: `${r.progressPct}%` }} />
                              </div>
                              <span className="text-xs font-bold tabular-nums">{r.status === "Closed" && r.closedScore != null ? Math.round(r.closedScore * 100) : r.progressPct}%</span>
                            </div>
                          </TableCell>
                          <TableCell>{confDot(r.confidence)}</TableCell>
                          <TableCell>
                            <StatusPill status={r.status === "Posted" ? "Approved" : r.status === "Closed" ? "Closed" : "Prepared"} />
                          </TableCell>
                          <TableCell>{rowActions(r)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* mobile <640px → kartu (pola collapse) */}
                <div className="space-y-3 sm:hidden">
                  {rows.map(objCard)}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ---- dialog: create / edit objective ---- */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget
                ? t("Edit Objective (Draft) — {q}", "Edit Objective (Draft) — {q}", { q: editTarget.quarter })
                : t("Objective Baru — Kuartal {q}", "New Objective — Quarter {q}", { q: form.quarter || data?.currentQuarter || "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("Kuartal (YYYY-Qn)", "Quarter (YYYY-Qn)")}</Label>
                <Input value={form.quarter} placeholder={data?.currentQuarter ?? "2026-Q1"} onChange={(e) => setForm((f) => ({ ...f, quarter: e.target.value }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>{t("Judul objective", "Objective title")}</Label>
                <Input value={form.title} placeholder={t("Naikkan kepuasan pelanggan internal…", "Raise internal customer satisfaction…")} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
            </div>

            {/* owner picker (aktif) */}
            <div className="space-y-1.5">
              <Label>{t("Pemilik objective", "Objective owner")}</Label>
              {form.ownerEmployeeId && selectedEmp ? (
                <div className="flex items-center justify-between rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-sm dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
                  <span className="min-w-0"><strong>{selectedEmp.fullName}</strong> · {selectedEmp.employeeNo} · {selectedEmp.position ?? "—"} · {selectedEmp.orgUnit ?? "—"}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setForm((f) => ({ ...f, ownerEmployeeId: "" }))}>{t("Ganti", "Change")}</Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <Input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder={t("Cari karyawan aktif…", "Search active employees…")} className="pl-8" />
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    {(empApi.data?.employees ?? []).length === 0 && (
                      <p className="px-3 py-3 text-xs text-slate-500">{t("Tidak ada karyawan cocok.", "No matching employees.")}</p>
                    )}
                    {(empApi.data?.employees ?? []).map((e) => (
                      <button key={e.id} type="button" className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                        onClick={() => setForm((f) => ({ ...f, ownerEmployeeId: e.id }))}>
                        <span className="font-medium">{e.fullName}</span>
                        <span className="ml-2 text-xs text-slate-500">{e.employeeNo} · {e.position ?? "—"} · {e.orgUnit ?? "—"}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* align-to picker (pohon dukungan — D-BL4, 1 level) */}
            <div className="space-y-1">
              <Label>{t("Mendukung objective (opsional)", "Supports objective (optional)")}</Label>
              <Select value={form.alignToId} onValueChange={(v) => setForm((f) => ({ ...f, alignToId: v }))}>
                <SelectTrigger aria-label={t("Align ke objective", "Align to objective")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("— tidak align (mandiri)", "— none (standalone)")}</SelectItem>
                  {(alignApi.data?.options ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.title} · {o.ownerName} ({o.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{t("Pohon dukungan: objective ini mendukung objective lain pada kuartal sama (chip “mendukung” muncul di board).", "Support tree: this objective supports another objective in the same quarter (a “supports” chip appears on the board).")}</p>
            </div>

            <KrEditor
              items={form.krs}
              onChange={(items) => setForm((f) => ({ ...f, krs: items }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busyFlag}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitObjective} disabled={busyFlag}>
              {editTarget ? t("Simpan perubahan", "Save changes") : t("Buat Draft", "Create Draft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: detail (GET ?id= — anak align + KRs + aksi) ---- */}
      <Dialog open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="sr-only">{t("Detail objective", "Objective detail")}</DialogTitle>
          </DialogHeader>
          {detailApi.loading && !detail ? (
            <p className="py-6 text-center text-sm text-slate-500">{t("Memuat…", "Loading…")}</p>
          ) : detail && (() => {
            const d = detailApi.data;
            return (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 flex-1 text-base font-bold leading-snug text-slate-900 dark:text-slate-50">{detail.title}</h3>
                    <StatusPill status={detail.status === "Posted" ? "Approved" : detail.status === "Closed" ? "Closed" : "Prepared"} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {detail.ownerName} · {detail.ownerNo} · {detail.ownerUnit ?? "—"}{detail.ownerPosition ? ` · ${detail.ownerPosition}` : ""} · <span className="font-mono">{detail.quarter}</span>
                  </p>
                  {detail.alignParentTitle && (
                    <p className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700 dark:border-fuchsia-500/25 dark:bg-fuchsia-500/10 dark:text-fuchsia-400">
                      <ListTree className="h-3 w-3 shrink-0" aria-hidden /> {t("mendukung: {p}", "supports: {p}", { p: detail.alignParentTitle })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div className={cn("h-full rounded-full", scoreTone(detail.progressPct))} style={{ width: `${detail.progressPct}%` }} />
                      </div>
                      <span className="text-sm font-black tabular-nums">{detail.status === "Closed" && detail.closedScore != null ? Math.round(detail.closedScore * 100) : detail.progressPct}%</span>
                    </div>
                    <p className="mt-1 text-[10px] font-medium text-slate-400">
                      {detail.status === "Closed"
                        ? t("skor final {s} tersimpan server (D-BL5)", "final score {s} saved server-side (D-BL5)", { s: String(detail.closedScore) })
                        : t("skor live on-read = Σ(bobot/100 × clamp((current−baseline)/(target−baseline)))", "live on-read score = Σ(weight/100 × clamp((current−baseline)/(target−baseline)))")}
                    </p>
                  </div>
                  {confDot(detail.confidence) && (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                      {t("confidence", "confidence")} {confDot(detail.confidence)} {t(CONF_LABEL[detail.confidence ?? "Yellow"].id, CONF_LABEL[detail.confidence ?? "Yellow"].en)}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="font-semibold">{t("Key results", "Key results")}</p>
                  {detail.krs.map((k) => <div key={k.id}>{krMini(k)}</div>)}
                </div>
                {d?.alignChildren && d.alignChildren.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-semibold">{t("Objective yang mendukung ini", "Objectives supporting this one")}</p>
                    {d.alignChildren.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
                        <span className="min-w-0 truncate">{c.title} · <span className="text-slate-500">{c.ownerName}</span></span>
                        <StatusPill status={c.status === "Posted" ? "Approved" : c.status === "Closed" ? "Closed" : "Prepared"} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {detail.status === "Draft" && canMutate(detail) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { openEdit(detail); setDetailId(null); }}>{t("Edit", "Edit")}</Button>
                      <Button size="sm" onClick={() => act({ action: "post", id: detail.id }, t("Objective diposting ke board", "Objective posted to the board"))}>
                        <Send className="h-3.5 w-3.5" aria-hidden /> {t("Posting", "Post")}
                      </Button>
                    </>
                  )}
                  {detail.status === "Posted" && canMutate(detail) && (
                    <Button size="sm" variant="outline" onClick={() => { openKrDialog(detail); setDetailId(null); }}>{t("Update KR", "Update KR")}</Button>
                  )}
                  {detail.status === "Posted" && viewer.isHr && (
                    <Button size="sm" variant="outline" onClick={() => { setCloseTarget(detail); setDetailId(null); }}>
                      <Lock className="h-3.5 w-3.5" aria-hidden /> {t("Tutup kuartal", "Close quarter")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ---- dialog: update KR (current/confidence/note — owner/HR saat Posted) ---- */}
      <Dialog open={!!krTarget} onOpenChange={(o) => { if (!o) setKrTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Update Progres Key Result", "Update Key Result Progress")}</DialogTitle>
          </DialogHeader>
          {krTarget && (
            <>
              <p className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
                <strong>{krTarget.title}</strong> · {krTarget.ownerName} · <span className="font-mono">{krTarget.quarter}</span>
              </p>
              <div className="space-y-2">
                {krTarget.krs.map((k) => {
                  const f = krForms[k.id] ?? { current: String(k.current), confidence: k.confidence, note: "" };
                  return (
                    <div key={k.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{k.title}</p>
                        <span className="text-[10px] font-bold text-slate-400">{k.baseline} → {k.target} {k.unit} · {k.weight}%</span>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-500">{t("Nilai kini (boleh lewat target)", "Current value (may exceed target)")}</Label>
                          <Input type="number" step="any" className="h-8" value={f.current} onChange={(e) => setKrForms((s) => ({ ...s, [k.id]: { ...f, current: e.target.value } }))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-500">{t("Confidence", "Confidence")}</Label>
                          <Select value={f.confidence} onValueChange={(v) => setKrForms((s) => ({ ...s, [k.id]: { ...f, confidence: v } }))}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(["Green", "Yellow", "Red"] as const).map((c) => (
                                <SelectItem key={c} value={c}>{t(CONF_LABEL[c].id, CONF_LABEL[c].en)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        <Label className="text-[10px] text-slate-500">{t("Catatan progres (opsional)", "Progress note (optional)")}</Label>
                        <Input className="h-8" value={f.note} placeholder={t("Ringkasan kendala/insight minggu ini…", "This week&apos;s blockers/insights…")} onChange={(e) => setKrForms((s) => ({ ...s, [k.id]: { ...f, note: e.target.value } }))} />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={async () => {
                          await act({
                            action: "updateKr", id: k.id,
                            current: Number(f.current), confidence: f.confidence, note: f.note || null,
                          }, t("Progres KR tersimpan", "KR progress saved"));
                          api.refresh(); // progress live naik tanpa reload
                        }}>
                          {t("Simpan KR ini", "Save this KR")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                {t(
                  "Confidence adalah perasaan subjektif pemilik (beda dari skor) — Merah/Kuning/Hijau. Nilai kini boleh melewati target; skor server di-clamp 0–100%.",
                  "Confidence is the owner&apos;s subjective feeling (distinct from the score) — Red/Yellow/Green. Current may exceed target; the server score is clamped to 0–100%.",
                )}
              </p>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setKrTarget(null); api.refresh(); }}>{t("Selesai", "Done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: konfirmasi close (skor final server — D-BL5, HR saja) ---- */}
      <Dialog open={!!closeTarget} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Tutup objective ini?", "Close this objective?")}</DialogTitle>
          </DialogHeader>
          {closeTarget && (
            <div className="space-y-3 text-sm">
              <p className="rounded-md bg-slate-50 p-2 dark:bg-slate-900">
                <strong>{closeTarget.title}</strong> · {closeTarget.ownerName} · <span className="font-mono">{closeTarget.quarter}</span>
              </p>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <p className="font-bold">{t("Skor final akan disimpan server", "The final score will be saved server-side")}</p>
                <p className="mt-1">
                  {t(
                    "Progres live saat ini {p}%. Saat ditutup, skor final dihitung server (Σ bobot×clamp KR) dan DISIMPAN permanen; transisi tidak bisa dibatalkan (D-BL5 — terpisah dari penilaian kinerja).",
                    "Current live progress is {p}%. On close, the server computes the final score (Σ weight×clamped KR) and SAVES it permanently; the transition cannot be undone (D-BL5 — separate from appraisals).",
                    { p: String(closeTarget.progressPct) },
                  )}
                </p>
              </div>
              <p className="text-xs text-slate-500">
                {t("Pastikan seluruh progres KR sudah diperbarui sebelum menutup — nilai kini terakhir yang dihitung.", "Make sure all KR progress is updated before closing — the latest current values are what get scored.")}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)} disabled={busyFlag}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busyFlag} onClick={async () => {
              const res = await act({ action: "close", id: closeTarget?.id ?? "" }, t("Objective ditutup — skor final tersimpan", "Objective closed — final score saved"));
              if (res) setCloseTarget(null);
            }}>
              <Lock className="h-4 w-4" aria-hidden /> {t("Tutup & Simpan Skor", "Close & Save Score")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- editor KR bersama (create + edit) — 3–5 item Σbobot 100 (D-BL4/D-BL5) ----
function KrEditor({ items, onChange }: { items: KrForm[]; onChange: (items: KrForm[]) => void }) {
  const { t } = useI18n();
  const sum = items.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  const upd = (i: number, patch: Partial<KrForm>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("Key results (3–5 item, Σbobot 100)", "Key results (3–5 items, Σweight 100)")}</Label>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={items.length >= 5} onClick={() => onChange([...items, emptyKr()])}>
          <Plus className="h-3 w-3" aria-hidden /> {t("KR", "KR")}
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((k, i) => (
          <div key={i} className="grid grid-cols-1 gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-[1fr_70px_110px_78px_78px_70px_36px]">
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Judul", "Title")}</Label>
              <Input className="h-8 text-xs" value={k.title} placeholder={t("Waktu respons tiket…", "Ticket response time…")} onChange={(e) => upd(i, { title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Satuan", "Unit")}</Label>
              <Input className="h-8 text-xs" value={k.unit} placeholder="%" onChange={(e) => upd(i, { unit: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Polarity", "Polarity")}</Label>
              <Select value={k.polarity} onValueChange={(v) => upd(i, { polarity: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HigherIsBetter">{t("↑ tinggi lebih baik", "↑ higher is better")}</SelectItem>
                  <SelectItem value="LowerIsBetter">{t("↓ rendah lebih baik", "↓ lower is better")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Baseline", "Baseline")}</Label>
              <Input type="number" step="any" className="h-8 text-xs" value={k.baseline} onChange={(e) => upd(i, { baseline: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Target", "Target")}</Label>
              <Input type="number" step="any" className="h-8 text-xs" value={k.target} onChange={(e) => upd(i, { target: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Bobot %", "Weight %")}</Label>
              <Input type="number" min={0} max={100} className="h-8 text-xs" value={k.weight} onChange={(e) => upd(i, { weight: e.target.value })} />
            </div>
            <div className="flex items-end pb-0.5">
              <Button size="sm" variant="ghost" className="h-8 w-9 px-0 text-slate-400" disabled={items.length <= 3} aria-label={t("Hapus KR", "Remove KR")} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {/* meter Σbobot (pola goals/PIP/probation builder) */}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className={cn("h-full rounded-full transition-all", Math.abs(sum - 100) < 0.01 ? "bg-emerald-500" : sum > 100 ? "bg-rose-500" : "bg-amber-400")} style={{ width: `${Math.min(100, sum)}%` }} />
        </div>
        <span className={cn("text-sm font-bold tabular-nums", Math.abs(sum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ {Math.round(sum)}%</span>
        {Math.abs(sum - 100) > 0.01 && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onChange(items.map((x, j, arr) => ({ ...x, weight: String(j === arr.length - 1 ? 100 - Math.floor(100 / arr.length) * (arr.length - 1) : Math.floor(100 / arr.length)) })))}>
            {t("Bagi rata", "Split evenly")}
          </Button>
        )}
      </div>
    </div>
  );
}
