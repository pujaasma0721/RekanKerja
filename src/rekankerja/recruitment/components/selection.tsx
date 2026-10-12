"use client";
// RekanKerja Recruitment F3 — view "Kandidat & Seleksi": board kanban per PR
// (kolom tahap seleksi + kolom terminal Lulus / Gagal-Ditarik), drag & drop
// naik satu tahap (Catat Hasil), bulk advance, navigasi keyboard J/K/Enter,
// kalender seleksi bulanan + transfer kandidat + manager rubrik scorecard.
// Padanan EvaluationProcess/PerCandidate + HRX D1/D2/D3 (lihat
// DEVELOPMENT-PLAN-RECRUITMENT.md §7 F3). Dialog di selection-dialogs.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  SELECTION_API, CANDIDATES_API, AI_API, BLIND_LS_KEY,
  type BoardColumn, type CalendarEvent, type CandidateCard, type NominationOptions,
  type ProcessOpt, type PrOpt, type SelectionBoard, type SummaryRow, type AiScore,
  CandPill, Pill, daysLateOf, AiScoreBadge,
} from "./selection-shared";
import { AiScoreDialog, AiRubricDialog } from "./ai-score-dialogs";
import { CopilotPanel } from "./copilot-panel";
import {
  CandidateDetailDialog, DayEventsDialog, ResultAdvanceDialog, RubricManagerDialog,
  TransferDialog, type ResultTarget,
} from "./selection-dialogs";
import {
  AlarmClock, AlertTriangle, ArrowUpRight, BadgeCheck, Bot, CalendarDays, ClipboardCheck,
  Handshake, KanbanSquare, Keyboard, MailCheck, Settings2, SlidersHorizontal, Sparkles,
  UserPlus, UserRoundCheck, EyeOff,
} from "lucide-react";

const SELECTION_MASTER = "/api/rekankerja/recruitment/masters?type=selection-process";

/** "YYYY-MM" bulan ini (lokal). */
function monthNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function SelectionPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const nav = useNav();

  // ---------- data ----------
  const summariesApi = useApi<{ summaries: SummaryRow[]; recommendations: string[] }>(`${SELECTION_API}?summaries=1`, []);
  const optionsApi = useApi<NominationOptions>(`${CANDIDATES_API}?options=1`, []);
  const stagesApi = useApi<{ rows: ProcessOpt[] }>(SELECTION_MASTER, []);

  const [prIdUser, setPrIdUser] = useState<string | null>(null);
  const [mode, setMode] = useState<"board" | "calendar">("board");
  const [calMonth, setCalMonth] = useState(monthNow());
  const [statFilter, setStatFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);

  const prs = optionsApi.data?.prs ?? [];
  const employees = optionsApi.data?.employees ?? [];
  const stages = useMemo(() => (stagesApi.data?.rows ?? []).filter((s) => s.active), [stagesApi.data]);
  const summaries = summariesApi.data?.summaries ?? [];

  // default PR (derived, tanpa effect) = PR layak pertama yang punya kandidat
  // (cek summaries) → PR berkandidat mana pun → PR layak pertama.
  const defaultPrId = useMemo(() => {
    const withCand = prs.find((p) => summaries.some((s) => s.prId === p.id && s.candidates > 0));
    const anyCand = summaries.find((s) => s.candidates > 0);
    return withCand?.id ?? anyCand?.prId ?? prs[0]?.id ?? "";
  }, [prs, summaries]);
  const prId = prIdUser ?? defaultPrId;
  /** ganti PR — reset seleksi bulk/filter/keyboard (event handler, bukan effect). */
  const changePr = (v: string) => {
    setPrIdUser(v);
    setFocusIdx(-1);
    setSelected(new Set());
    setStatFilter(null);
  };

  const boardApi = useApi<{ board: SelectionBoard }>(prId ? `${SELECTION_API}?board=1&prId=${prId}` : null, [prId]);
  const board = boardApi.data?.board ?? null;

  const calendarApi = useApi<{ month: string; events: CalendarEvent[] }>(
    mode === "calendar" ? `${SELECTION_API}?calendar=${calMonth}` : null,
    [mode, calMonth],
  );
  const calEvents = calendarApi.data?.events ?? [];

  // PR picker: union options.prs + PR khusus dari summaries (mis. sudah Fulfilled)
  const prOptions = useMemo(() => {
    const map = new Map<string, PrOpt>();
    for (const p of prs) map.set(p.id, p);
    for (const s of summaries) {
      if (!map.has(s.prId)) map.set(s.prId, { id: s.prId, prNo: s.prNo, positionTitle: null, requiredNo: 0, status: "" });
    }
    return [...map.values()].sort((a, b) => a.prNo.localeCompare(b.prNo));
  }, [prs, summaries]);

  // ---------- gating ----------
  const canNominate = perms.canOp("recruitment", "candidates", "nominate");
  const canResult = perms.canOp("recruitment", "selection", "result");
  const canRubric = perms.can("recruitment", "selection", "update") || perms.can("recruitment", "selection", "create");
  // F6b — skor AI explainable (generate + rubrik skor per PR) — op:score.
  const canScore = perms.canOp("recruitment", "selection", "score");
  // F6c — Recruiter Copilot (draf JD/ringkasan/interview/outreach/pipeline/bias) — op:copilot.
  const canCopilot = perms.canOp("recruitment", "selection", "copilot");

  // ---------- dialog ----------
  const [detailId, setDetailId] = useState<string | null>(null);
  const [resultTarget, setResultTarget] = useState<ResultTarget | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [rubricOpen, setRubricOpen] = useState(false);
  const [dayEvents, setDayEvents] = useState<{ day: string; events: CalendarEvent[] } | null>(null);
  // F6b — dialog skor AI (per kandidat) + manager rubrik skor AI (per PR).
  const [scoreTarget, setScoreTarget] = useState<{ id: string; displayName: string } | null>(null);
  const [aiRubricOpen, setAiRubricOpen] = useState(false);
  // F6c — panel Recruiter Copilot.
  const [copilotOpen, setCopilotOpen] = useState(false);
  const dialogOpen = detailId != null || resultTarget != null || transferOpen || rubricOpen || dayEvents != null
    || scoreTarget != null || aiRubricOpen || copilotOpen;

  // ---------- F6c — mode buta (blind screening, display-only) ----------
  // localStorage rk-blind-selection; baca SETELAH mount (hindari hydration
  // mismatch SSR) — data TIDAK pernah diubah, hanya tampilan yang disamarkan.
  const [blind, setBlind] = useState(false);
  useEffect(() => {
    try {
      // rehidrasi preferensi localStorage memang harus pasca-mount: SSR selalu
      // false supaya hydration stabil, lalu beralih sekali ke nilai tersimpan.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- baca localStorage rk-blind-selection pasca-mount (pola i18n.tsx)
      setBlind(window.localStorage.getItem(BLIND_LS_KEY) === "1");
    } catch { /* storage bisa diblokir — abaikan */ }
  }, []);
  const toggleBlind = (on: boolean) => {
    setBlind(on);
    try { window.localStorage.setItem(BLIND_LS_KEY, on ? "1" : "0"); } catch { /* private mode */ }
    toast(on
      ? t("Mode Buta AKTIF — nama & institusi kandidat disamarkan di papan (data tidak berubah).", "Blind Mode ON — candidate names & institutions are masked on the board (data unchanged).")
      : t("Mode Buta nonaktif — tampilan papan dipulihkan.", "Blind Mode off — board display restored."));
  };

  const refreshAll = () => {
    boardApi.refresh(); summariesApi.refresh(); optionsApi.refresh();
    setFocusIdx(-1); setSelected(new Set());
  };

  const flatCards = useMemo(
    () => (board?.columns ?? []).flatMap((col) => col.cards.map((card) => ({ card, col }))),
    [board],
  );
  // seleksi yang masih valid (kartu bisa hilang/pindah setelah mutasi data)
  const validSelected = useMemo(
    () => new Set(flatCards.filter((f) => selected.has(f.card.id)).map((f) => f.card.id)),
    [flatCards, selected],
  );

  // ---------- F6b — badge skor AI kartu (1 fetch bulk per PR via latest-scores) ----------
  const [aiScores, setAiScores] = useState<Record<string, AiScore>>({});
  const [scoreTick, setScoreTick] = useState(0);
  const boardPrId = board?.pr.id ?? null;
  useEffect(() => {
    if (!boardPrId || !canScore) return;
    let alive = true;
    void (async () => {
      try {
        const res = await apiSend<{ scores: AiScore[] }>(AI_API, "POST", { action: "latest-scores", prId: boardPrId });
        if (alive) setAiScores(Object.fromEntries((res.scores ?? []).map((s) => [s.candidateId, s])));
      } catch {
        if (alive) setAiScores({}); // board tetap jalan tanpa badge (mis. endpoint sibuk)
      }
    })();
    return () => { alive = false; };
  }, [boardPrId, canScore, scoreTick]);
  /** skor baru dari dialog → refresh badge semua kartu (1 fetch). */
  const onScoredRefresh = () => setScoreTick((x) => x + 1);

  // ---------- F6c — nomor anonim stabil per PR (urut nominatedAt, bukan id) ----------
  const blindNoMap = useMemo(() => {
    const all = (board?.columns ?? []).flatMap((c) => c.cards)
      .slice().sort((a, b) => a.nominatedAt.localeCompare(b.nominatedAt) || a.id.localeCompare(b.id));
    return new Map(all.map((c, i) => [c.id, i + 1]));
  }, [board]);
  /** nama tampil kartu/dialog — Mode Buta mengganti dgn "Kandidat #n". */
  const displayNameOf = (card: { id: string; fullName: string }) =>
    blind ? t("Kandidat #{n}", "Candidate #{n}", { n: String(blindNoMap.get(card.id) ?? 0) }) : card.fullName;
  /** PR terpilih (utk dialog rubrik skor AI — jalan bahkan sebelum board termuat). */
  const selectedPrOpt = prOptions.find((p) => p.id === prId) ?? null;

  // F6c — opsi kandidat copilot: reuse kartu board (tanpa fetch tambahan).
  const copilotCandidates = useMemo(
    () => flatCards.map((f) => ({ id: f.card.id, name: f.card.fullName, sub: f.card.currentStageName ?? null })),
    [flatCards],
  );

  // ---------- keyboard: J/K navigasi + Enter detail ----------
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen || mode !== "board" || flatCards.length === 0) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable || el.closest("[role=dialog]"))) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, flatCards.length - 1));
      } else if (k === "k") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusIdx >= 0 && focusIdx < flatCards.length) {
        e.preventDefault();
        setDetailId(flatCards[focusIdx].card.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, mode, flatCards, focusIdx]);

  useEffect(() => {
    if (focusIdx < 0 || focusIdx >= flatCards.length) return;
    const el = cardRefs.current.get(flatCards[focusIdx].card.id);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusIdx, flatCards]);

  // ---------- drag & drop (HTML5 native) ----------
  const [drag, setDrag] = useState<{ id: string; fromSeq: number } | null>(null);
  const [dropColId, setDropColId] = useState<string | null>(null);

  const onDropOnCol = (col: BoardColumn) => {
    const d = drag;
    setDrag(null);
    setDropColId(null);
    if (!d) return;
    const origin = flatCards.find((f) => f.card.id === d.id);
    if (!origin) return;
    if (col.stageId === "__passed__" || col.stageId === "__out__") {
      toast.info(col.stageId === "__passed__"
        ? t("Gunakan “Catat Hasil” hingga kandidat lulus semua tahap — kartu tidak bisa dijatuhkan langsung ke kolom Lulus.", "Use “Record Result” until the candidate passes every stage — cards can't be dropped straight into the Passed column.")
        : t("Kandidat gagal/ditarik diatur lewat “Catat Hasil” (Gagal) atau tombol “Tarik Kandidat”.", "Failed/withdrawn candidates are handled via “Record Result” (Fail) or the “Withdraw Candidate” button."));
      return;
    }
    if (col.seqNo !== origin.col.seqNo + 1) {
      toast.info(t("Kartu hanya bisa dimajukan satu tahap — gunakan “Catat Hasil”.", "A card can only advance one stage at a time — use “Record Result”."));
      return;
    }
    // tahap yang DINILAI = tahap asal (kolom asal) — info kuantitatif dari master
    const master = stages.find((s) => s.id === origin.col.stageId);
    setResultTarget({
      mode: "advance",
      cards: [{ id: origin.card.id, fullName: displayNameOf(origin.card) }],
      evaluatedStageName: origin.col.name,
      toStageName: col.name,
      resultType: master?.resultType ?? origin.col.resultType,
      minResultPass: master?.minResultPass ?? null,
    });
  };

  // ---------- bulk ----------
  const toggleSelect = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const openBulkAdvance = () => {
    const cards = flatCards
      .filter((f) => validSelected.has(f.card.id))
      .map((f) => f.card)
      .filter((c) => c.currentSeqNo != null);
    if (cards.length === 0) return;
    const first = cards[0];
    const originCol = flatCards.find((f) => f.card.id === first.id)?.col;
    const master = stages.find((s) => s.id === originCol?.stageId);
    const nextCol = (board?.columns ?? []).find((c) => c.seqNo === (originCol?.seqNo ?? 0) + 1);
    setResultTarget({
      mode: "bulk",
      cards: cards.map((c) => ({ id: c.id, fullName: displayNameOf(c) })),
      evaluatedStageName: originCol?.name ?? (first.currentStageName ?? ""),
      toStageName: nextCol?.name ?? null,
      resultType: master?.resultType ?? originCol?.resultType ?? null,
      minResultPass: master?.minResultPass ?? null,
    });
  };

  // ---------- render helpers ----------

  const stats = board?.stats;

  const statChip = (key: string, label: string, labelEn: string, value: number | undefined, opts?: { accent?: boolean; title?: string }) => (
    <button key={key} type="button"
      onClick={() => setStatFilter(statFilter === key ? null : key)}
      title={opts?.title}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        statFilter === key
          ? "ov-border-accent ov-soft"
          : opts?.accent
            ? "border-amber-200 bg-amber-50/70 hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-500/10"
            : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
      )}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className={cn(
        "mt-0.5 text-xl font-semibold tabular-nums",
        opts?.accent ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-50",
      )}>{value ?? 0}</div>
    </button>
  );

  const matchFilter = (c: CandidateCard): boolean => {
    if (!statFilter) return true;
    if (statFilter === "Overdue") return c.overdue;
    return c.status === statFilter;
  };

  const boardCard = (card: CandidateCard, col: BoardColumn) => {
    const isTerminalCol = col.stageId === "__passed__" || col.stageId === "__out__";
    const late = daysLateOf(card.dueDate);
    const focused = flatCards[focusIdx]?.card.id === card.id;
    const seq = card.currentSeqNo ?? card.totalSteps;
    const pct = card.totalSteps > 0 ? Math.round((card.passedSteps / card.totalSteps) * 100) : 0;
    const ai = aiScores[card.id] ?? null;
    return (
      <div
        key={card.id}
        ref={(el) => { if (el) cardRefs.current.set(card.id, el); else cardRefs.current.delete(card.id); }}
        draggable={!isTerminalCol}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", card.id);
          e.dataTransfer.effectAllowed = "move";
          setDrag({ id: card.id, fromSeq: col.seqNo });
        }}
        onDragEnd={() => { setDrag(null); setDropColId(null); }}
        onClick={() => setDetailId(card.id)}
        title={t("klik utk detail · seret ke kolom berikutnya utk naik tahap", "click for details · drag to the next column to advance")}
        className={cn(
          "group cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition-all hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600",
          focused && "ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-slate-950",
          statFilter && !matchFilter(card) && "opacity-40",
          drag?.id === card.id && "opacity-50",
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="min-w-0 truncate text-[13px] font-semibold text-slate-900 dark:text-slate-50">{displayNameOf(card)}</span>
          <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {canScore && (
              ai
                ? <AiScoreBadge total={ai.total} onClick={() => setScoreTarget({ id: card.id, displayName: displayNameOf(card) })} />
                : (
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 text-slate-400 hover:text-brand-deep dark:hover:text-brand/80"
                    title={t("Skor AI (belum ada) — buka dialog generate", "AI score (none yet) — open the generate dialog")}
                    aria-label={t("Skor AI kandidat", "Candidate AI score")}
                    onClick={() => setScoreTarget({ id: card.id, displayName: displayNameOf(card) })}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )
            )}
            <Checkbox
              className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100"
              checked={selected.has(card.id)}
              onCheckedChange={(c) => toggleSelect(card.id, c === true)}
              aria-label={t("pilih kandidat", "select candidate")}
            />
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {card.source === "Internal"
            ? <Pill tone="brand">{t("Internal", "Internal")}</Pill>
            : <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">{t("Eksternal", "External")}</span>}
          <CandPill status={card.status} />
          {/* F4 — kandidat lulus semua tahap → buat offer (navigasi ke view Offer) */}
          {card.status === "Passed" && (
            <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="outline" size="sm"
                className="h-7 gap-1 border-emerald-200 px-2 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                title={t("Buat Offer — lanjut ke view Offer & Pengangkatan", "Create Offer — continue to the Offers & Appointment view")}
                onClick={() => nav.navigate("recruitment", "offers", { id: card.id })}
              >
                <Handshake className="h-3.5 w-3.5" aria-hidden /> {t("Offer", "Offer")}
              </Button>
            </span>
          )}
        </div>
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
            <span>{t("tahap {a}/{b}", "stage {a}/{b}", { a: String(seq), b: String(card.totalSteps) })}</span>
            {card.latestScore != null && (
              <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{t("skor", "score")} {card.latestScore}</span>
            )}
          </div>
          <div className="mt-1 h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
            <div className="h-1 rounded-full ov-bar" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {(card.overdue || card.scorecardCount > 0 || card.invitationLetterNo) && (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
            {card.overdue && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                <AlarmClock className="h-3 w-3" aria-hidden /> {late} {t("hari", "days")}
              </span>
            )}
            {card.scorecardCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                title={card.divergence
                  ? t("Panel divergen >2 — perlu kalibrasi", "Panel divergent >2 — calibration needed")
                  : t("scorecard terkirim di tahap aktif", "scorecards submitted on the active stage")}>
                <ClipboardCheck className="h-3 w-3" aria-hidden /> {card.scorecardCount}
              </span>
            )}
            {card.divergence && (
              <span title={t("Panel divergen >2 — perlu kalibrasi", "Panel divergent >2 — calibration needed")}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              </span>
            )}
            {card.invitationLetterNo && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-400"
                title={t("undangan terbit", "invitation issued")}>
                <MailCheck className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate font-mono">{card.invitationLetterNo}</span>
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const boardColumn = (col: BoardColumn) => {
    const isPassed = col.stageId === "__passed__";
    const isOut = col.stageId === "__out__";
    const isTerminal = isPassed || isOut;
    const validNext = drag != null && !isTerminal && col.seqNo === drag.fromSeq + 1;
    return (
      <div
        key={col.stageId}
        onDragOver={(e) => { e.preventDefault(); setDropColId(col.stageId); }}
        onDragLeave={() => setDropColId((c) => (c === col.stageId ? null : c))}
        onDrop={(e) => { e.preventDefault(); onDropOnCol(col); }}
        className={cn(
          "flex max-h-[70vh] w-[248px] shrink-0 flex-col rounded-xl border",
          isPassed
            ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/25 dark:bg-emerald-500/5"
            : isOut
              ? "border-zinc-200 bg-zinc-50/70 dark:border-zinc-700 dark:bg-zinc-800/20"
              : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40",
          validNext && dropColId === col.stageId && "border-emerald-400 ring-2 ring-emerald-400/40 dark:border-emerald-500",
          drag != null && !validNext && dropColId === col.stageId && !isTerminal && "border-slate-300 dark:border-slate-600",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2 dark:border-slate-800/70">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn(
              "truncate text-xs font-bold uppercase tracking-wide",
              isPassed ? "text-emerald-700 dark:text-emerald-400" : isOut ? "text-zinc-500 dark:text-zinc-400" : "text-slate-600 dark:text-slate-300",
            )}>{col.name}</span>
            <Badge variant="secondary" className="font-mono">{col.cards.length}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
            {col.overdueCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                title={t("kartu lewat SLA", "cards past SLA")}>
                <AlarmClock className="h-3 w-3" aria-hidden />{col.overdueCount}
              </span>
            )}
            {col.slaDays != null && <span title={t("SLA master tahap (hari)", "Stage master SLA (days)")}>SLA {col.slaDays}{t("h", "d")}</span>}
            {col.needAck && (
              <span title={t("perlu acknowledgement kandidat", "candidate acknowledgement required")}>
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          {col.cards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-xs text-slate-300 dark:border-slate-700 dark:text-slate-600">—</p>
          ) : col.cards.map((c) => boardCard(c, col))}
        </div>
      </div>
    );
  };

  // ---------- kalender ----------
  const [yOf, mOf] = calMonth.split("-").map(Number);
  const firstDay = new Date(yOf, mOf - 1, 1);
  const startDow = (firstDay.getDay() + 6) % 7; // Senin = 0
  const daysInMonth = new Date(yOf, mOf, 0).getDate();
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of calEvents) {
      const key = new Date(e.planDate).toLocaleDateString("sv-SE"); // YYYY-MM-DD lokal
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [calEvents]);

  const shiftMonth = (delta: number) => {
    const m = mOf - 1 + delta;
    const ny = yOf + Math.floor(m / 12);
    const nm = ((m % 12) + 12) % 12 + 1;
    setCalMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  };

  const evtChipCls = (e: CalendarEvent): string => {
    const base = "block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold";
    const tone: Record<string, string> = {
      Planned: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
      Acknowledged: "ov-soft",
      Performed: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
      Passed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      Failed: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
      Cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400",
    };
    return cn(base, tone[e.status] ?? tone.Planned, e.overdue && "ring-1 ring-rose-500");
  };

  const calDays = locale === "en-US"
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const cells: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const todayKey = new Date().toLocaleDateString("sv-SE");

  // ---------- render ----------

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Seleksi")}
        title={t("Kandidat & Seleksi", "Candidates & Selection")}
        description={t(
          "Papan kanban proses seleksi per PR — naikkan kandidat tahap demi tahap (Catat Hasil), kelola scorecard panel & divergensi, surat undangan, SLA dan kalender jadwal.",
          "A per-PR kanban board of the selection process — advance candidates stage by stage (Record Result), manage scorecard panels & divergence, invitation letters, SLA, and the schedule calendar.",
        )}
        actions={<>
          {canScore && (
            <Button variant="outline" onClick={() => setAiRubricOpen(true)} className="gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> {t("Rubrik Skor AI", "AI Score Rubric")}
            </Button>
          )}
          {canNominate && (
            <Button onClick={() => setTransferOpen(true)} className="ov-fill ov-glow gap-2">
              <UserPlus className="h-4 w-4" aria-hidden /> {t("Transfer Kandidat", "Transfer Candidate")}
            </Button>
          )}
          {canRubric && (
            <Button variant="outline" onClick={() => setRubricOpen(true)} className="gap-2">
              <Settings2 className="h-4 w-4" aria-hidden /> {t("Rubrik Scorecard", "Scorecard Rubrics")}
            </Button>
          )}
        </>}
      />

      {/* chips statistik (klik → highlight) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statChip("Nominated", "Dinominasikan", "Nominated", stats?.nominated)}
        {statChip("InProcess", "Proses Seleksi", "In Process", stats?.inProcess)}
        {statChip("Passed", "Lulus", "Passed", stats?.passed)}
        {statChip("Failed", "Gagal", "Failed", stats?.failed)}
        {statChip("Withdrawn", "Ditarik", "Withdrawn", stats?.withdrawn)}
        {statChip("Overdue", "Lewat SLA", "Past SLA", stats?.overdue, {
          accent: true,
          title: board && board.overdueCount > 0
            ? t("IncompleteEvaluation — {n} tahap aktif lewat SLA dueDate", "IncompleteEvaluation — {n} active stages past their SLA due date", { n: String(board.overdueCount) })
            : t("IncompleteEvaluation — tahap aktif lewat SLA dueDate", "IncompleteEvaluation — active stages past their SLA due date"),
        })}
      </div>

      {/* toolbar: PR picker + info + mode */}
      <Card className="mb-4 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
          <div className="flex min-w-[260px] flex-1 flex-wrap items-end gap-3">
            {/* F6b fix mobile 375px: trigger shadcn w-fit + teks PR panjang →
                luapan horizontal; jadikan full-width (kapsulation sm:w-[300px]). */}
            <div className="w-full min-w-0 space-y-1.5 sm:w-[300px]">
              <Label>{t("Permintaan Karyawan (PR)", "Personnel Requisition (PR)")}</Label>
              <Select value={prId || undefined} onValueChange={changePr}>
                <SelectTrigger className="w-full"><SelectValue placeholder={prs.length === 0 ? t("memuat…", "loading…") : t("Pilih PR…", "Pick a PR…")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {prOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.prNo}{p.positionTitle ? ` — ${p.positionTitle}` : ""}{p.requiredNo ? ` · ${t("kebutuhan {n} org", "{n} headcount", { n: String(p.requiredNo) })}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {board && (
              <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{board.pr.prNo}</span>
                <span>{board.pr.positionTitle ?? t("tanpa posisi", "no position")}</span>
                <span>· {t("kebutuhan {n} org", "{n} headcount", { n: String(board.pr.requiredNo) })}</span>
                {board.overdueCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                    title={t("IncompleteEvaluation — tahap aktif lewat SLA dueDate", "IncompleteEvaluation — active stages past their SLA due date")}>
                    <AlarmClock className="h-3 w-3" aria-hidden /> {board.overdueCount} {t("lewat SLA", "past SLA")}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* F6c — Recruiter Copilot (draf JD · ringkasan · interview · outreach · tanya pipeline · cek bias) */}
            {canCopilot && (
              <Button variant="outline" className="gap-2" onClick={() => setCopilotOpen(true)}>
                <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> {t("Copilot", "Copilot")}
              </Button>
            )}
            {/* F6c — mode buta: samarkan identitas di papan (display-only) */}
            {blind && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-400">
                <EyeOff className="h-3.5 w-3.5" aria-hidden /> {t("MODE BUTA AKTIF", "BLIND MODE ON")}
              </span>
            )}
            <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
              title={t("Sembunyikan nama & institusi kandidat di papan — hanya tampilan, data tidak berubah.", "Mask candidate names & institutions on the board — display only, data unchanged.")}>
              <EyeOff className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {t("Mode Buta", "Blind Mode")}
              <Switch checked={blind} onCheckedChange={toggleBlind} aria-label={t("Mode Buta", "Blind Mode")} />
            </label>
            <Tabs value={mode} onValueChange={(v) => setMode(v === "calendar" ? "calendar" : "board")}>
              <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
                <TabsTrigger value="board"><KanbanSquare className="h-4 w-4" aria-hidden /> {t("Papan", "Board")}</TabsTrigger>
                <TabsTrigger value="calendar"><CalendarDays className="h-4 w-4" aria-hidden /> {t("Kalender", "Calendar")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* ============ MODE BOARD ============ */}
      {mode === "board" ? (
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            {boardApi.loading && !boardApi.data ? (
              <LoadingRows rows={6} />
            ) : boardApi.error ? (
              <EmptyState title={t("Gagal memuat papan seleksi", "Failed to load the selection board")} description={boardApi.error} />
            ) : !board ? (
              <EmptyState
                icon={UserRoundCheck}
                title={t("Belum ada PR terpilih", "No PR selected yet")}
                description={t("Pilih PR di atas — bila kosong, transfer kandidat dari talent pool / karyawan internal lewat tombol “Transfer Kandidat”.", "Pick a PR above — if empty, transfer candidates from the talent pool / internal employees via “Transfer Candidate”.")}
              />
            ) : (
              <>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {board.columns.map(boardColumn)}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                  <Keyboard className="h-3.5 w-3.5" aria-hidden />
                  {t("J/K navigasi · Enter detail · seret kartu ke kolom berikutnya utk Catat Hasil & naik tahap", "J/K navigation · Enter for details · drag a card to the next column to record the result & advance")}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        // ============ MODE KALENDER ============
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)} aria-label={t("Bulan sebelumnya", "Previous month")}>
                  <span aria-hidden>‹</span>
                </Button>
                <span className="min-w-[150px] text-center text-sm font-semibold">
                  {firstDay.toLocaleDateString(locale, { month: "long", year: "numeric" })}
                </span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)} aria-label={t("Bulan berikutnya", "Next month")}>
                  <span aria-hidden>›</span>
                </Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setCalMonth(monthNow())}>{t("Hari ini", "Today")}</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300 dark:bg-slate-500" />{t("Terjadwal", "Planned")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm ov-bar" />{t("Dikonfirmasi", "Acknowledged")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" />{t("Dilaksanakan", "Performed")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" />{t("Lulus", "Passed")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-400" />{t("Gagal", "Failed")}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full ring-1 ring-rose-500" />{t("lewat SLA", "past SLA")}</span>
              </div>
            </div>
            {calendarApi.loading && !calendarApi.data ? (
              <LoadingRows rows={6} />
            ) : calendarApi.error ? (
              <EmptyState title={t("Gagal memuat kalender", "Failed to load the calendar")} description={calendarApi.error} />
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1.5">
                  {calDays.map((d) => (
                    <div key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{d}</div>
                  ))}
                  {cells.map((d, i) => {
                    if (d == null) return <div key={`e${i}`} className="min-h-[88px] rounded-lg border border-transparent" />;
                    const key = `${calMonth}-${String(d).padStart(2, "0")}`;
                    const evts = eventsByDay.get(key) ?? [];
                    const isToday = key === todayKey;
                    return (
                      <div key={key}
                        className={cn(
                          "min-h-[88px] rounded-lg border p-1.5",
                          isToday ? "ov-border-accent ov-soft" : "border-slate-200 bg-white/50 dark:border-slate-800 dark:bg-slate-900/40",
                        )}>
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[11px] font-semibold", isToday ? "ov-text-accent" : "text-slate-500 dark:text-slate-400")}>{d}</span>
                          {evts.length > 0 && <Badge variant="secondary" className="h-4 px-1 font-mono text-[9px]">{evts.length}</Badge>}
                        </div>
                        <div className="mt-1 space-y-1">
                          {evts.slice(0, 2).map((e) => (
                            <button key={e.stepId} type="button" className={evtChipCls(e)} onClick={() => setDetailId(e.candidateId)}
                              title={`${e.candidateName} — ${e.stageName} (${e.prNo})`}>
                              {new Date(e.planDate).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} {e.candidateName}
                            </button>
                          ))}
                          {evts.length > 2 && (
                            <button type="button" className="text-[10px] font-semibold text-slate-500 hover:underline dark:text-slate-400"
                              onClick={() => setDayEvents({ day: key, events: evts })}>
                              +{evts.length - 2} {t("lagi", "more")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {calEvents.length === 0 && (
                  <p className="mt-3 text-center text-xs text-slate-400">
                    {t("Belum ada jadwal tahap pada bulan ini.", "No stage schedules for this month yet.")}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* toolbar bulk melayang */}
      {mode === "board" && validSelected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {t("{n} kandidat dipilih", "{n} candidates selected", { n: String(validSelected.size) })}
          </span>
          {canResult && (
            <Button size="sm" className="ov-fill gap-1.5" onClick={openBulkAdvance}>
              <ArrowUpRight className="h-4 w-4" aria-hidden />
              {t("Naikkan {n} kandidat", "Advance {n} candidates", { n: String(validSelected.size) })}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("Batal", "Clear")}</Button>
        </div>
      )}

      {/* ===== dialog ===== */}
      <CandidateDetailDialog
        candidateId={detailId}
        employees={employees}
        stages={stages}
        blind={blind}
        displayName={detailId != null && flatCards.some((f) => f.card.id === detailId)
          ? displayNameOf(flatCards.find((f) => f.card.id === detailId)!.card)
          : null}
        onClose={() => setDetailId(null)}
        onMutated={() => { boardApi.refresh(); summariesApi.refresh(); }}
        onScored={onScoredRefresh}
      />
      <ResultAdvanceDialog target={resultTarget} employees={employees} onClose={() => setResultTarget(null)} onDone={refreshAll} />
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} prs={prOptions} employees={employees} defaultPrId={prId} onDone={refreshAll} />
      <RubricManagerDialog open={rubricOpen} onClose={() => setRubricOpen(false)} stages={stages} />
      <DayEventsDialog
        day={dayEvents?.day ?? null}
        events={dayEvents?.events ?? []}
        onClose={() => setDayEvents(null)}
        onOpenCandidate={(id) => setDetailId(id)}
      />
      {/* F6b — dialog skor AI per kandidat + manager rubrik skor per PR terpilih */}
      <AiScoreDialog
        candidate={scoreTarget}
        canGenerate={canScore}
        onClose={() => setScoreTarget(null)}
        onScored={onScoredRefresh}
      />
      <AiRubricDialog
        pr={aiRubricOpen && selectedPrOpt ? { id: selectedPrOpt.id, prNo: selectedPrOpt.prNo, positionTitle: selectedPrOpt.positionTitle } : null}
        onClose={() => setAiRubricOpen(false)}
      />
      {/* F6c — panel Recruiter Copilot (opsi PR/kandidat reuse data view — tanpa fetch baru) */}
      <CopilotPanel
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        prs={prOptions.map((p) => ({ id: p.id, prNo: p.prNo, positionTitle: p.positionTitle }))}
        candidates={copilotCandidates}
      />
    </div>
  );
}
