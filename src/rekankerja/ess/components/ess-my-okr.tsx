"use client";
// B1-BL — ESS "OKR Saya" (DEVELOPMENT-PLAN-BACKLOG.md §4 B1; D-BL3/D-BL4):
//   • Objective kuartalan MILIK SAYA semua kuartal + statistik progres.
//   • Buat Draft utk diri sendiri → owner boleh memosting miliknya (D-BL3);
//     progres KR (current/confidence/note) diupdate saat Posted; Draft bisa
//     diedit penuh / dihapus. CLOSE tidak ada di ESS (HR saja).
//   • Board transparan kuartal terpilih: objective Posted/Closed seluruh
//     organisasi (silang-tim — pola Google OKR), read-only.
// Dwibahasa penuh t() BASE_EN. Mobile-first (kartu, tanpa h-scroll).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { Target, Plus, ChevronDown, ChevronRight, Trash2, Send, ListTree, Users } from "lucide-react";

const OKR_API = "/api/rekankerja/ess/my-okr";

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
interface MyOkrData {
  okrEnabled: boolean;
  currentQuarter: string;
  quarters: string[];
  rows: OkrRow[];
  stats: { total: number; draft: number; posted: number; closed: number; avgProgressPct: number | null };
  board: OkrRow[];
}
interface AlignOpt { id: string; title: string; status: string; ownerName: string }

interface KrForm { title: string; unit: string; polarity: string; baseline: string; target: string; weight: string }
const emptyKr = (): KrForm => ({ title: "", unit: "%", polarity: "HigherIsBetter", baseline: "0", target: "", weight: "" });

const QUARTER_RE_UI = /^\d{4}-Q[1-4]$/;

const CONF_DOT: Record<string, string> = { Red: "bg-rose-500", Yellow: "bg-amber-400", Green: "bg-emerald-500" };
const CONF_LABEL: Record<string, { id: string; en: string }> = {
  Red: { id: "Merah", en: "Red" }, Yellow: { id: "Kuning", en: "Yellow" }, Green: { id: "Hijau", en: "Green" },
};
function scoreTone(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 40) return "bg-amber-400";
  return "bg-rose-400";
}

export function EssMyOkrPage() {
  const { t } = useI18n();
  const [boardQuarter, setBoardQuarter] = useState<string>(""); // "" = kuartal berjalan
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const listUrl = useMemo(() => `${OKR_API}${boardQuarter ? `?quarter=${encodeURIComponent(boardQuarter)}` : ""}`, [boardQuarter]);
  const api = useApi<MyOkrData>(listUrl, [listUrl]);
  const data = api.data;
  const rows = data?.rows ?? [];
  const stats = data?.stats;

  // ---- dialog create/edit Draft ----
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OkrRow | null>(null);
  const [form, setForm] = useState<{ quarter: string; title: string; alignToId: string; krs: KrForm[] }>({
    quarter: "", title: "", alignToId: "none", krs: [emptyKr(), emptyKr(), emptyKr()],
  });
  const [alignOpts, setAlignOpts] = useState<AlignOpt[]>([]);
  const krSum = (krs: KrForm[]) => krs.reduce((s, x) => s + (Number(x.weight) || 0), 0);

  const loadAlignOpts = async (quarter: string) => {
    try {
      const res = await apiSend<{ options: AlignOpt[] }>(OKR_API, "POST", { action: "alignOptions", quarter });
      setAlignOpts(res.options ?? []);
    } catch { setAlignOpts([]); }
  };

  const openCreate = () => {
    setEditTarget(null);
    const q = data?.currentQuarter ?? "";
    setForm({ quarter: q, title: "", alignToId: "none", krs: [emptyKr(), emptyKr(), emptyKr()] });
    void loadAlignOpts(q);
    setEditOpen(true);
  };
  const openEdit = (r: OkrRow) => {
    setEditTarget(r);
    setForm({
      quarter: r.quarter,
      title: r.title,
      alignToId: r.alignToId ?? "none",
      krs: r.krs.map((k) => ({
        title: k.title, unit: k.unit, polarity: k.polarity,
        baseline: String(k.baseline), target: String(k.target), weight: String(k.weight),
      })),
    });
    void loadAlignOpts(r.quarter);
    setEditOpen(true);
  };

  const submitObjective = async () => {
    if (!QUARTER_RE_UI.test(form.quarter)) { toast.error(t("Kuartal harus format YYYY-Qn, contoh {q}.", "Quarter must be YYYY-Qn, e.g. {q}.", { q: data?.currentQuarter ?? "2026-Q1" })); return; }
    if (form.title.trim().length < 3) { toast.error(t("Judul objective wajib ≥3 karakter", "Objective title needs ≥3 characters")); return; }
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
      alignToId: form.alignToId === "none" ? null : form.alignToId,
      keyResults: form.krs.map((k) => ({
        title: k.title.trim(), unit: k.unit.trim(), polarity: k.polarity,
        baseline: Number(k.baseline), target: Number(k.target), weight: Number(k.weight),
      })),
    };
    setBusy(true);
    try {
      if (editTarget) {
        await apiSend(OKR_API, "POST", { action: "update", id: editTarget.id, ...payload });
        toast.success(t("Objective diperbarui", "Objective updated"));
      } else {
        await apiSend(OKR_API, "POST", { action: "create", ...payload });
        toast.success(t("Objective dibuat sebagai Draft — posting bila sudah siap dilihat seluruh karyawan", "Objective created as a Draft — post it once it is ready for the whole company to see"));
      }
      setEditOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  // ---- dialog update KR (milik saya saat Posted) ----
  const [krTarget, setKrTarget] = useState<OkrRow | null>(null);
  const [krForms, setKrForms] = useState<Record<string, { current: string; confidence: string; note: string }>>({});
  const openKrDialog = (r: OkrRow) => {
    setKrTarget(r);
    setKrForms(Object.fromEntries(r.krs.map((k) => [k.id, { current: String(k.current), confidence: k.confidence, note: k.note ?? "" }])));
  };

  const act = async (body: Record<string, unknown>, okMsg: string): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    try {
      const res = await apiSend<Record<string, unknown>>(OKR_API, "POST", body);
      toast.success(okMsg);
      api.refresh();
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
      return null;
    } finally { setBusy(false); }
  };

  const confDot = (c: string | null) => c ? (
    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", CONF_DOT[c] ?? "bg-slate-300")} aria-label={t(`Confidence ${c}`, `Confidence ${c}`)} />
  ) : null;

  const krMini = (k: KrRow) => (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
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

  const myActions = (r: OkrRow) => (
    <div className="mt-2 flex flex-wrap gap-1">
      {r.status === "Draft" && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEdit(r)}>{t("Edit", "Edit")}</Button>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => act({ action: "post", id: r.id }, t("Objective diposting — kini terlihat seluruh karyawan", "Objective posted — now visible to all employees"))}>
            <Send className="h-3 w-3" aria-hidden /> {t("Posting", "Post")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" disabled={busy} aria-label={t("Hapus", "Delete")} onClick={() => act({ action: "delete", id: r.id }, t("Objective dihapus", "Objective deleted"))}>
            <Trash2 className="h-3 w-3" aria-hidden />
          </Button>
        </>
      )}
      {r.status === "Posted" && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => openKrDialog(r)}>
          {t("Update progres", "Update progress")}
        </Button>
      )}
      {r.status === "Closed" && (
        <p className="text-[11px] font-medium text-slate-400">
          {t("kuartal selesai — skor final {p}%", "quarter closed — final score {p}%", { p: String(r.closedScore != null ? Math.round(r.closedScore * 100) : 0) })}
        </p>
      )}
    </div>
  );

  const objCard = (r: OkrRow, mine: boolean) => {
    const open = expanded.has(r.id);
    return (
      <Card key={r.id} className="min-w-0 border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-50" title={r.title}>{r.title}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono">{r.quarter}</span>
                {mine ? t(" · milik saya", " · mine") : ` · ${r.ownerName} · ${r.ownerUnit ?? "—"}`}
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
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className={cn("h-full rounded-full transition-all", scoreTone(r.progressPct))} style={{ width: `${r.progressPct}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right text-sm font-black tabular-nums text-slate-900 dark:text-slate-50">
              {r.status === "Closed" && r.closedScore != null ? `${Math.round(r.closedScore * 100)}%` : `${r.progressPct}%`}
            </span>
          </div>
          {mine && myActions(r)}
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-1 rounded-md px-1 py-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            aria-expanded={open}
            onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            {t("{n} key result", "{n} key results", { n: String(r.krs.length) })}
          </button>
          {open && <div className="mt-2 space-y-2">{r.krs.map((k) => <div key={k.id}>{krMini(k)}</div>)}</div>}
        </CardContent>
      </Card>
    );
  };

  if (!api.data && api.loading) return <LoadingRows />;

  if (data && !data.okrEnabled) {
    return (
      <EmptyState
        icon={Target}
        title={t("Mode OKR kuartalan belum aktif", "Quarterly OKR mode is not enabled")}
        description={t(
          "Perusahaan belum mengaktifkan OKR kuartalan. Hubungi HR bila Anda ingin mulai menyusun objective kuartalan.",
          "Your company has not enabled quarterly OKR yet. Contact HR if you would like to start setting quarterly objectives.",
        )}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Self Service · B1"
        title={t("OKR Saya", "My OKR")}
        description={t(
          "Tujuan kuartalan Anda (3–5 key result ber-bobot) — alat penyelarasan, BUKAN penilaian. Objective yang diposting terlihat seluruh karyawan di board transparan; progres update kapan saja saat Posted.",
          "Your quarterly objectives (3–5 weighted key results) — an alignment tool, NOT an appraisal. Posted objectives are visible to every employee on the transparent board; update progress anytime while Posted.",
        )}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" aria-hidden /> {t("Objective Baru", "New Objective")}</Button>}
      />

      {api.error && <EmptyState icon={<Target />} title={t("Gagal memuat OKR", "Failed to load OKR")} description={api.error} />}

      {/* statistik progres */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: t("Draft", "Draft"), value: stats.draft },
            { label: t("Posted", "Posted"), value: stats.posted },
            { label: t("Closed", "Closed"), value: stats.closed },
            { label: t("Rata-rata progres", "Average progress"), value: stats.avgProgressPct != null ? `${stats.avgProgressPct}%` : "—" },
          ].map((x) => (
            <Card key={x.label} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{x.label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">{x.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ---- objective milik saya (semua kuartal) ---- */}
      <section aria-labelledby="ess-okr-mine">
        <h2 id="ess-okr-mine" className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-200">{t("Objective Saya (semua kuartal)", "My Objectives (all quarters)")}</h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title={t("Belum ada objective", "No objectives yet")}
            description={t(
              "Mulai dengan satu objective kuartalan yang bermakna bagi tim Anda — 3–5 key result terukur.",
              "Start with one quarterly objective that matters to your team — 3–5 measurable key results.",
            )}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => objCard(r, true))}
          </div>
        )}
      </section>

      {/* ---- board transparan (silang-tim — D-BL3) ---- */}
      <section aria-labelledby="ess-okr-board">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="ess-okr-board" className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">
            <Users className="h-4 w-4" aria-hidden /> {t("Board Transparan — seluruh perusahaan", "Transparent Board — whole company")}
          </h2>
          <Select value={boardQuarter || data?.currentQuarter || ""} onValueChange={(v) => setBoardQuarter(v === data?.currentQuarter ? "" : v)}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("Kuartal board", "Board quarter")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {(data?.quarters ?? [data?.currentQuarter ?? ""]).filter(Boolean).map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(data?.board ?? []).length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("Belum ada objective Posted di kuartal ini", "No posted objectives in this quarter")}
            description={t("Objective yang diposting karyawan mana pun muncul di sini — lintas tim.", "Objectives posted by any employee appear here — across teams.")}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(data?.board ?? []).map((r) => objCard(r, false))}
          </div>
        )}
      </section>

      {/* ---- dialog: create / edit Draft ---- */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
                <Input value={form.quarter} placeholder={data?.currentQuarter ?? "2026-Q1"} onChange={(e) => { setForm((f) => ({ ...f, quarter: e.target.value })); void loadAlignOpts(e.target.value); }} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>{t("Judul objective", "Objective title")}</Label>
                <Input value={form.title} placeholder={t("Percepat waktu respons layanan…", "Cut service response time…")} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("Mendukung objective (opsional)", "Supports objective (optional)")}</Label>
              <Select value={form.alignToId} onValueChange={(v) => setForm((f) => ({ ...f, alignToId: v }))}>
                <SelectTrigger aria-label={t("Align ke objective", "Align to objective")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("— tidak align (mandiri)", "— none (standalone)")}</SelectItem>
                  {alignOpts.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.title} · {o.ownerName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{t("Objective ini mendukung objective lain pada kuartal sama — muncul sebagai chip “mendukung” di board.", "This objective supports another one in the same quarter — shown as a “supports” chip on the board.")}</p>
            </div>
            <EssKrEditor items={form.krs} onChange={(items) => setForm((f) => ({ ...f, krs: items }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitObjective} disabled={busy}>
              {editTarget ? t("Simpan perubahan", "Save changes") : t("Buat Draft", "Create Draft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: update progres KR (milik saya saat Posted) ---- */}
      <Dialog open={!!krTarget} onOpenChange={(o) => { if (!o) setKrTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Update Progres Key Result", "Update Key Result Progress")}</DialogTitle>
          </DialogHeader>
          {krTarget && (
            <>
              <p className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
                <strong>{krTarget.title}</strong> · <span className="font-mono">{krTarget.quarter}</span>
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
                          <Label className="text-[10px] text-slate-500">{t("Confidence (perasaan Anda)", "Confidence (your gut feeling)")}</Label>
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
                        <Input className="h-8" value={f.note} onChange={(e) => setKrForms((s) => ({ ...s, [k.id]: { ...f, note: e.target.value } }))} />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={async () => {
                          await act({
                            action: "updateKr", id: k.id,
                            current: Number(f.current), confidence: f.confidence, note: f.note || null,
                          }, t("Progres tersimpan", "Progress saved"));
                        }}>
                          {t("Simpan", "Save")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                {t("Confidence = perasaan subjektif Anda (Merah/Kuning/Hijau), beda dari skor. Nilai kini boleh melewati target — skor di-clamp 0–100%.", "Confidence = your subjective feeling (Red/Yellow/Green), distinct from the score. Current may exceed target — the score is clamped to 0–100%.")}
              </p>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setKrTarget(null); api.refresh(); }}>{t("Selesai", "Done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- editor KR ESS (3–5 item Σbobot 100 — D-BL4/D-BL5) ----
function EssKrEditor({ items, onChange }: { items: KrForm[]; onChange: (items: KrForm[]) => void }) {
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
          <div key={i} className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-[1fr_64px_104px_72px_72px_64px_36px]">
            <div className="space-y-1 col-span-2 sm:col-span-1">
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
                  <SelectItem value="HigherIsBetter">{t("↑ tinggi baik", "↑ higher better")}</SelectItem>
                  <SelectItem value="LowerIsBetter">{t("↓ rendah baik", "↓ lower better")}</SelectItem>
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
