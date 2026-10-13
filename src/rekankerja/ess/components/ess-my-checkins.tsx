"use client";
// ============================================================================
// RekanKerja ESS P2-PERF — "Check-in Saya" (§17 ess/my-checkins + §27-2/3):
//   • Riwayat 1-on-1 per siklus (tanggal · agenda · status · capaian/hambatan/
//     rencana · bagian karyawan dua arah §27-2 · catatan atasan).
//   • Progres tengah tahun (midActual per KPI — "progress tampil di kedua
//     sisi" §27-3) + tombol isi bagian karyawan untuk check-in terdekat.
// ============================================================================
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ESS_BASE } from "./ess-api";
import { MessagesSquare, Loader2, UserRound, ChevronDown, TrendingUp } from "lucide-react";

interface MyCheckinNotes { wins: string[]; blockers: string[]; next: string[]; employee?: { wins: string[]; blockers: string[]; next: string[] } }
interface MyCheckin {
  id: string; heldAt: string; agenda: string | null; status: string;
  notes: MyCheckinNotes; managerComment: string | null; nextCheckInAt: string | null;
}
interface MyCheckinBlock {
  appraisalId: string; docNo: string; status: string;
  cycle: { code: string; status: string; periodStart: string; periodEnd: string };
  checkins: MyCheckin[];
  midProgress: {
    total: number; filled: number; pct: number;
    rows: { id: string; title: string; unit: string; target: number; midActual: number | null; weight: number }[];
  };
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

export function EssMyCheckinsPage() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<{ rows: MyCheckinBlock[] }>(`${ESS_BASE}/my-checkins`);
  const [fillFor, setFillFor] = useState<MyCheckin | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Check-in Saya", "My Check-ins")}
        description={t(
          "Riwayat 1-on-1 dengan atasan + progres tengah tahun. Anda dapat mengisi bagian Anda sebelum/jelang sesi (dua arah).",
          "1-on-1 history with your manager + mid-year progress. You can fill your part before/at the session (two-way).",
        )}
      />

      {error && <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} icon={MessagesSquare} />}
      {loading && <LoadingRows rows={4} />}
      {data && data.rows.length === 0 && (
        <EmptyState
          icon={MessagesSquare}
          title={t("Belum ada check-in", "No check-ins yet")}
          description={t("Atasan Anda belum menjadwalkan 1-on-1. Riwayat akan muncul di sini.", "Your manager has not scheduled a 1-on-1 yet. History will appear here.")}
        />
      )}

      {data && data.rows.map((b) => (
        <Card key={b.appraisalId} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{b.cycle.code}</span>
              <StatusPill status={b.status} />
              <span className="ml-auto font-mono text-xs text-slate-400">{b.docNo}</span>
            </div>

            {/* progres tengah tahun §27-3 — tampil di kedua sisi */}
            {b.midProgress.total > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <TrendingUp className="h-3.5 w-3.5 text-brand" />
                  <span className="font-semibold">{t("Progres tengah tahun", "Mid-year progress")}</span>
                  <span className="ml-auto tabular-nums text-slate-500">
                    {t(`${b.midProgress.filled}/${b.midProgress.total} KPI · ${b.midProgress.pct}%`, `${b.midProgress.filled}/${b.midProgress.total} KPIs · ${b.midProgress.pct}%`)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(b.midProgress.pct, 100)}%` }} />
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-slate-500">{t("rincian per KPI", "per-KPI details")}</summary>
                  <ul className="mt-1 space-y-0.5 pl-4 text-[11px] text-slate-500 dark:text-slate-400">
                    {b.midProgress.rows.map((k) => (
                      <li key={k.id}>• {k.title} — {t("target", "target")} {k.target} {k.unit} · {t("capaian", "actual")}: <span className="font-semibold">{k.midActual ?? "—"}</span></li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {/* riwayat 1-on-1 */}
            <div className="mt-3 space-y-2">
              {b.checkins.length === 0 && (
                <p className="text-xs text-slate-400">{t("Belum ada sesi 1-on-1 di siklus ini.", "No 1-on-1 sessions in this cycle yet.")}</p>
              )}
              {b.checkins.map((c) => (
                <CheckinItem key={c.id} c={c} onFill={() => setFillFor(c)} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {fillFor && (
        <FillPartDialog c={fillFor} onClose={() => setFillFor(null)} onDone={refresh} />
      )}
    </div>
  );
}

function CheckinItem({ c, onFill }: { c: MyCheckin; onFill: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasEmployee = !!c.notes.employee && !!(c.notes.employee.wins?.length || c.notes.employee.blockers?.length || c.notes.employee.next?.length);
  return (
    <div className={cn("rounded-lg border p-3", c.status === "Held" ? "border-emerald-200 dark:border-emerald-900/50" : c.status === "Missed" ? "border-rose-200 dark:border-rose-900/50" : "border-slate-200 dark:border-slate-800")}>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{fmtD(c.heldAt)} {c.agenda ? <span className="font-normal text-slate-500">— {c.agenda}</span> : ""}</p>
          <p className="text-[11px] text-slate-500"><StatusPill status={c.status} />{hasEmployee ? ` · ${t("bagian Anda terisi", "your part filled")}` : ""}</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-xs">
          <List label={t("Capaian sejauh ini", "Wins so far")} items={c.notes.wins} cls="text-emerald-700 dark:text-emerald-400" />
          <List label={t("Hambatan", "Blockers")} items={c.notes.blockers} cls="text-rose-700 dark:text-rose-400" />
          <List label={t("Rencana lanjut", "Next steps")} items={c.notes.next} cls="text-slate-600 dark:text-slate-300" />
          {c.managerComment && (
            <p className="rounded-lg bg-slate-50 p-2 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              <span className="font-semibold">{t("Catatan atasan:", "Manager note:")}</span> {c.managerComment}
            </p>
          )}
          {hasEmployee && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
              <p className="font-semibold text-amber-700 dark:text-amber-400"><UserRound className="mr-1 inline h-3 w-3" />{t("Bagian Anda", "Your part")}</p>
              <List label={t("Capaian", "Wins")} items={c.notes.employee!.wins} cls="text-emerald-700 dark:text-emerald-400" />
              <List label={t("Hambatan", "Blockers")} items={c.notes.employee!.blockers} cls="text-rose-700 dark:text-rose-400" />
              <List label={t("Rencana", "Next")} items={c.notes.employee!.next} cls="text-slate-600 dark:text-slate-300" />
            </div>
          )}
          {c.status !== "Missed" && !hasEmployee && (
            <Button size="sm" variant="outline" className="h-7" onClick={onFill}>
              <UserRound className="h-3.5 w-3.5" />{t("Isi Bagian Anda", "Fill Your Part")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function List({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="font-semibold text-slate-600 dark:text-slate-300">{label}</p>
      <ul className="ml-4 list-disc space-y-0.5">
        {items.map((x, i) => (<li key={i} className={cls}>{x}</li>))}
      </ul>
    </div>
  );
}

function FillPartDialog({ c, onClose, onDone }: { c: MyCheckin; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [w, setW] = useState<string[]>([""]);
  const [b, setB] = useState<string[]>([""]);
  const [n, setN] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`${ESS_BASE}/my-checkins`, "POST", { action: "fill", id: c.id, wins: clean(w), blockers: clean(b), next: clean(n) });
      toast.success(t("Bagian Anda tersimpan — atasan akan melihatnya saat mencatat hasil", "Your part is saved — the manager will see it when logging the result"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const Editor = ({ label, items, set }: { label: string; items: string[]; set: (v: string[]) => void }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {items.map((x, i) => (
        <Input key={i} value={x} onChange={(e) => set(items.map((y, j) => (j === i ? e.target.value : y)))} aria-label={label} />
      ))}
      <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => set([...items, ""])}>+ {t("tambah", "add")}</Button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`Isi Bagian Anda — ${fmtD(c.heldAt)}`, `Fill Your Part — ${fmtD(c.heldAt)}`)}</DialogTitle>
          <DialogDescription>
            {t("Persiapkan poin sebelum sesi 1-on-1; atasan menggabungkannya saat mencatat hasil (dua arah §27-2).", "Prepare your points before the 1-on-1; the manager merges them when logging the result (two-way §27-2).")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Editor label={t("Capaian sejauh ini", "Wins so far")} items={w} set={setW} />
          <Editor label={t("Hambatan yang saya hadapi", "Blockers I face")} items={b} set={setB} />
          <Editor label={t("Rencana lanjut saya", "My next steps")} items={n} set={setN} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan Bagian Saya", "Save My Part")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
