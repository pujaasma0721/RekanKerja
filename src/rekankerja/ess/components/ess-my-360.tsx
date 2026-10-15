"use client";
// ============================================================================
// RekanKerja ESS P3-PERF — "360 Saya" (§17 ess/my-360, Alur 5 §29-3, §37 PDP):
//   • Daftar undangan reviewer (aktif) + yang sudah submit (read-only).
//   • Isian per undangan: kompetensi 1–5 (deskriptor level di tooltip) +
//     komentar + tombol "✨ Susun dengan AI" (§18.11 — identitas reviewer
//     TIDAK PERNAH dikirim ke model, D20) + tolak undangan.
//   • ANONIMITAS: hasil hanya tampil ter-agregat ≥3 reviewer — reviewer tahu
//     siapa yang dinilai; arah sebaliknya (nama reviewer) yang dirahasiakan.
// ============================================================================
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AiComposeDialog } from "@/rekankerja/performance/components/perf-form-kit";
import { ESS_BASE } from "./ess-api";
import { Users, AlertTriangle, Loader2, Sparkles, Send, ShieldAlert, ChevronDown, XCircle } from "lucide-react";

// ---------- tipe (kontrak API) ----------

interface InvComp {
  competencyId: string; code: string; name: string; kind: string;
  levels: { level: number; label: string; descriptor: string }[];
}
interface Invitation {
  feedbackId: string; status: string; reviewerType: string;
  dueAt: string | null; submittedAt: string | null;
  employeeNo: string; fullName: string; docNo: string; cycleCode: string; appraisalId: string;
  comps: InvComp[];
}

interface F360Draft {
  scores: Record<string, number>;
  comments: Record<string, string>;
  aiAssistedIds: string[];
}

interface BiasWarning {
  category: string;
  phrase: string;
  suggestion: string;
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

export function EssMy360Page() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<{ rows: Invitation[] }>(`${ESS_BASE}/my-360`);
  const rows = data?.rows ?? [];
  const active = rows.filter((r) => r.status === "Invited");
  const done = rows.filter((r) => r.status !== "Invited");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("360 Saya", "My 360")}
        description={t(
          "Undangan umpan balik 360 untuk rekan Anda. Identitas Anda dirahasiakan — hasil hanya tampil ter-agregat bila ≥3 reviewer.",
          "360 feedback invitations for your colleagues. Your identity stays anonymous — results only appear aggregated when ≥3 reviewers.",
        )}
      />

      {error && <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} icon={AlertTriangle} />}
      {loading && <LoadingRows rows={3} />}
      {data && rows.length === 0 && (
        <EmptyState
          icon={Users}
          title={t("Belum ada undangan 360", "No 360 invitations yet")}
          description={t("Anda akan muncul di sini saat atasan/HR mengundang Anda sebagai reviewer untuk siklus dengan 360 aktif.", "You will appear here once a manager/HR invites you as a reviewer for a cycle with 360 enabled.")}
        />
      )}

      {active.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t(`Menunggu isian Anda (${active.length})`, `Awaiting your input (${active.length})`)}</h3>
          {active.map((r) => <InvitationForm key={r.feedbackId} inv={r} onDone={refresh} />)}
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("Riwayat undangan", "Invitation history")}</h3>
          {done.map((r) => (
            <Card key={r.feedbackId} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="flex flex-wrap items-center gap-2 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.fullName} <span className="font-mono text-[11px] text-slate-400">{r.employeeNo}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {r.cycleCode} · {r.reviewerType}{r.submittedAt ? ` · ${t("diisi", "submitted")} ${fmtD(r.submittedAt)}` : r.dueAt ? ` · ${t("tenggat", "due")} ${fmtD(r.dueAt)}` : ""}
                  </p>
                </div>
                <StatusPill status={r.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function InvitationForm({ inv, onDone }: { inv: Invitation; onDone: () => void }) {
  const { t } = useI18n();
  const storageKey = `rekankerja:perf-draft:360:${inv.feedbackId}`;
  const [draft, setDraft] = useState<F360Draft>({ scores: {}, comments: {}, aiAssistedIds: [] });
  const [busy, setBusy] = useState(false);
  const [aiFor, setAiFor] = useState<InvComp | null>(null);
  const [open, setOpen] = useState(true);
  // B2-BL (D-BL7a) — advisori bias pasca-submit: submit TETAP berhasil; kartu
  // tetap terbuka menampilkan banner amber sampai pengguna menutupnya.
  const [biasWarn, setBiasWarn] = useState<BiasWarning[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDraft(JSON.parse(raw) as F360Draft);
    } catch { /* storage rusak */ }
  }, [inv.feedbackId]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* kuota */ }
  }, [draft, storageKey]);

  const filled = inv.comps.filter((c) => (draft.scores[c.competencyId] ?? 0) >= 1).length;

  const submit = async () => {
    if (filled < inv.comps.length) {
      toast.error(t(`Semua kompetensi wajib dinilai (${filled}/${inv.comps.length} terisi)`, `All competencies must be scored (${filled}/${inv.comps.length} filled)`));
      return;
    }
    setBusy(true);
    try {
      // B2-BL — respons menambah biasWarnings ADVISORI (submit tetap 201)
      const out = await apiSend<{ answered: number; biasWarnings?: BiasWarning[] }>(`${ESS_BASE}/my-360`, "POST", {
        action: "submit",
        id: inv.feedbackId,
        answers: inv.comps.map((c) => ({
          competencyId: c.competencyId,
          score: draft.scores[c.competencyId] ?? 0,
          comment: (draft.comments[c.competencyId] ?? "").trim() || undefined,
          aiAssisted: draft.aiAssistedIds.includes(c.competencyId),
        })),
      });
      try { localStorage.removeItem(storageKey); } catch { /* never */ }
      if (out.biasWarnings?.length) {
        // ADVISORI — tidak memblokir: banner amber, form tetap terkirim
        setBiasWarn(out.biasWarnings);
        toast.info(t("Isian terkirim — ada frasa yang perlu diperiksa (lihat peringatan)", "Feedback submitted — some phrases need review (see warnings)"));
      } else {
        toast.success(t("Isian 360 terkirim — terima kasih. Identitas Anda dirahasiakan.", "360 feedback submitted — thank you. Your identity stays anonymous."));
        onDone();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await apiSend(`${ESS_BASE}/my-360`, "POST", { action: "decline", id: inv.feedbackId });
      toast.info(t("Undangan ditolak.", "Invitation declined."));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-amber-200 bg-white/80 dark:border-amber-900/50 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-5">
        <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {inv.fullName} <span className="font-mono text-[11px] font-normal text-slate-400">{inv.employeeNo}</span>
            </p>
            <p className="text-[11px] text-slate-500">
              {inv.cycleCode} · {inv.reviewerType} · {inv.dueAt ? t(`tenggat ${fmtD(inv.dueAt)}`, `due ${fmtD(inv.dueAt)}`) : t("tanpa tenggat", "no due date")}
              {" · "}{t(`${filled}/${inv.comps.length} terisi`, `${filled}/${inv.comps.length} filled`)}
            </p>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", open && "rotate-180")} />
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {biasWarn ? (
              // B2-BL (D-BL7a) — ADVISORI pasca-submit: submit TETAP berhasil;
              // komentar ter-flag masuk antrean moderasi HR (anonim).
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t("Isian terkirim — namun ada frasa yang berpotensi bias", "Feedback submitted — however some phrases may be biased")}
                </p>
                <p className="mt-1 text-[11px] text-amber-700/90 dark:text-amber-400/90">
                  {t(
                    "Isian Anda tetap tersimpan (tidak diblokir). Komentar ter-flag menunggu tinjauan HR sebelum tampil ter-agregat — identitas Anda tetap dirahasiakan (D-BL7).",
                    "Your submission is saved (not blocked). Flagged comments await HR review before appearing in aggregates — your identity remains anonymous (D-BL7).",
                  )}
                </p>
                <ul className="mt-2 space-y-1">
                  {biasWarn.map((w) => (
                    <li key={w.phrase} className="rounded-lg border border-amber-200 bg-white/70 px-2.5 py-1.5 text-[11px] dark:border-amber-900/50 dark:bg-slate-900/60">
                      <span className="font-semibold text-amber-800 dark:text-amber-300">“{w.phrase}”</span>
                      <span className="ml-1 text-slate-500 dark:text-slate-400">({t("kategori", "category")}: {w.category})</span>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-300">{w.suggestion}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="outline" className="h-7 border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300" onClick={onDone}>
                    {t("Saya mengerti", "Got it")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-[11px] text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-400">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("Identitas Anda dirahasiakan — atasan hanya melihat agregat ≥3 reviewer. Tulis komentar yang profesional & berbasis perilaku (§37).", "Your identity stays anonymous — the manager only sees aggregates of ≥3 reviewers. Write professional, behavior-based comments (§37).")}</span>
              </div>
            )}
            <div className="space-y-3">
              {inv.comps.map((c) => {
                const score = draft.scores[c.competencyId] ?? 0;
                const comment = draft.comments[c.competencyId] ?? "";
                const descriptor = c.levels.find((l) => l.level === score);
                return (
                  <div key={c.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{c.name}</p>
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        {c.kind === "CoreValue" ? t("nilai inti", "core value") : c.kind === "Managerial" ? t("manajerial", "managerial") : t("teknis", "technical")}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((v) => {
                        const lv = c.levels.find((l) => l.level === v);
                        return (
                          <label key={v}
                            title={lv ? `${lv.label}: ${lv.descriptor}` : undefined}
                            className={cn(
                              "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition",
                              score === v ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400",
                            )}
                          >
                            <input type="radio" className="sr-only" name={`360-${inv.feedbackId}-${c.competencyId}`} value={v}
                              checked={score === v} onChange={() => setDraft({ ...draft, scores: { ...draft.scores, [c.competencyId]: v } })}
                              aria-label={t(`${c.name} — level ${v}`, `${c.name} — level ${v}`)} />
                            {v}
                          </label>
                        );
                      })}
                      {descriptor && (
                        <span className="ml-1 min-w-0 flex-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="font-semibold">{descriptor.label}:</span> {descriptor.descriptor}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Label className="text-xs">{t("Komentar (opsional)", "Comment (optional)")}</Label>
                        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setAiFor(c)}>
                          <Sparkles className="h-3.5 w-3.5 text-brand" />{t("Susun dengan AI", "Compose with AI")}
                        </Button>
                      </div>
                      <Textarea rows={2} value={comment}
                        placeholder={t("Perilaku teramati yang mendukung penilaian Anda…", "Observed behaviors supporting your rating…")}
                        onChange={(e) => setDraft({ ...draft, comments: { ...draft.comments, [c.competencyId]: e.target.value } })}
                        aria-label={t(`Komentar ${c.name}`, `${c.name} comment`)} />
                    </div>
                  </div>
                );
              })}
            </div>
            {!biasWarn && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={decline} disabled={busy}>
                  <XCircle className="h-4 w-4" />{t("Tolak Undangan", "Decline")}
                </Button>
                <Button onClick={submit} disabled={busy || filled < inv.comps.length}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("Kirim Isian 360", "Submit 360 Feedback")}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {aiFor && (
        <AiComposeDialog
          title={t(`Komentar 360 — ${aiFor.name}`, `360 comment — ${aiFor.name}`)}
          target={{ endpoint: `${ESS_BASE}/my-360`, extra: { scope: "360", appraisalId: inv.appraisalId, competencyId: aiFor.competencyId } }}
          onClose={() => setAiFor(null)}
          onUse={(text) => {
            setDraft((s) => ({
              ...s,
              comments: { ...s.comments, [aiFor.competencyId]: text },
              aiAssistedIds: s.aiAssistedIds.includes(aiFor.competencyId) ? s.aiAssistedIds : [...s.aiAssistedIds, aiFor.competencyId],
            }));
            setAiFor(null);
          }}
        />
      )}
    </Card>
  );
}
