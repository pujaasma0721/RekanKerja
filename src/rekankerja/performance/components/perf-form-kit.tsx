"use client";
// ============================================================================
// PERFORMANCE — Form kit (P1 — §18.7 AM2 "Ketahanan Pengisian" + §18.1-3):
//   • useDraftAutosave — hook autosave: debounce 3 detik + paling lambat 10
//     detik selama mengetik → PATCH draf server; MIRROR localStorage (offline
//     tetap bisa diketik); indikator "Menyimpan… → Tersimpan otomatis HH:MM:SS";
//     pemulihan draf lokal eksplisit (server = sumber kebenaran); beforeunload
//     guard anti tutup tak sengaja.
//   • WeightMeter — meter Σbobot live (hijau 100 · amber mendekati · merah lebih)
//   • ProgressTrackerBar — "Formulir Anda selesai N%" di ATAS formulir (§18.7).
// Dipakai KPI Builder (P1) dan nanti semua formulir panjang P3+.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { CloudUpload, CloudOff, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// useDraftAutosave
// ---------------------------------------------------------------------------

export interface AutosaveState<T> {
  /** Nilai draf saat ini (diketik pengguna). */
  draft: T | null;
  setDraft: (v: T | null, opts?: { touch?: boolean }) => void;
  /** Ada perubahan yang belum tersimpan (kotor). */
  dirty: boolean;
  /** Status penyimpanan terakhir. */
  status: "idle" | "saving" | "saved" | "offline" | "error";
  savedAt: string | null;
  lastError: string | null;
  /** Simpan SEKARANG (flush — dipanggil sebelum submit / saat unmount kotor). */
  saveNow: () => Promise<boolean>;
  /** Terdapat salinan lokal lebih baru dari server → banner pemulihan. */
  localMirror: { at: string; value: T } | null;
  restoreLocal: () => void;
  discardLocal: () => void;
}

const DEBOUNCE_MS = 3_000;
const MAX_INTERVAL_MS = 10_000;

/**
 * Autosave draf ke server (patch) + mirror localStorage.
 * `serialize`/`deserialize` menjaga tipe T stabil di localStorage (JSON).
 */
export function useDraftAutosave<T>(
  key: string,
  patch: (value: T) => Promise<unknown>,
  opts: { enabled?: boolean; equals?: (a: T | null, b: T | null) => boolean } = {},
): AutosaveState<T> {
  const enabled = opts.enabled !== false;
  const equalsRef = useRef(opts.equals);
  equalsRef.current = opts.equals;
  const [draft, setDraftState] = useState<T | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<AutosaveState<T>["status"]>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [localMirror, setLocalMirror] = useState<{ at: string; value: T } | null>(null);

  const lastSavedRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const draftRef = useRef<T | null>(null);
  draftRef.current = draft;

  const storageKey = `rekankerja:perf-draft:${key}`;

  // mirror lokal — baca SEKALI saat mount: bila ada & lebih baru dari server
  // (draft dimuat belum tersentuh), tawarkan pemulihan eksplisit.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { at: string; value: T };
        if (parsed?.value != null) setLocalMirror(parsed);
      }
    } catch { /* storage rusak — abaikan */ }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    };
  }, [storageKey]);

  const doSave = useCallback(async (): Promise<boolean> => {
    const v = draftRef.current;
    if (v == null || savingRef.current) return false;
    const eq = equalsRef.current;
    if (eq ? eq(v, lastSavedRef.current) : JSON.stringify(v) === JSON.stringify(lastSavedRef.current)) {
      setDirty(false);
      return true;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      await patch(v);
      lastSavedRef.current = v;
      setDirty(false);
      setStatus("saved");
      setSavedAt(new Date().toLocaleTimeString("id-ID"));
      setLastError(null);
      // tersimpan di server → mirror lokal tidak lagi diperlukan
      try { localStorage.removeItem(storageKey); } catch { /* never */ }
      return true;
    } catch (e) {
      setStatus(navigator.onLine ? "error" : "offline");
      setLastError(e instanceof Error ? e.message : "unknown");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [patch, storageKey]);

  const setDraft = useCallback((v: T | null, o?: { touch?: boolean }) => {
    setDraftState(v);
    if (o?.touch === false) {
      // muatan server (bukan ketikan) — reset baseline tanpa menandai kotor
      draftRef.current = v;
      lastSavedRef.current = v;
      setDirty(false);
      return;
    }
    setDirty(true);
    draftRef.current = v;
    // mirror lokal §18.7 — offline tetap bisa diketik
    try {
      localStorage.setItem(storageKey, JSON.stringify({ at: new Date().toISOString(), value: v }));
    } catch { /* kuota penuh — abaikan */ }
  }, [storageKey]);

  // debounce 3 detik + interval maks 10 detik selama kotor
  useEffect(() => {
    if (!enabled || !dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void doSave(); }, DEBOUNCE_MS);
    if (!maxTimerRef.current) {
      maxTimerRef.current = setTimeout(() => {
        if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
        maxTimerRef.current = null;
        void doSave();
      }, MAX_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [draft, dirty, enabled, doSave]);

  // anti tutup tak sengaja (§18.7) — beforeunload bila kotor
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // offline → online: coba simpan ulang otomatis
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const h = () => { if (dirtyRef.current) void doSave(); };
    window.addEventListener("online", h);
    return () => window.removeEventListener("online", h);
  }, [doSave]);

  const restoreLocal = useCallback(() => {
    if (!localMirror) return;
    setDraft(localMirror.value);
    setLocalMirror(null);
  }, [localMirror, setDraft]);
  const discardLocal = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch { /* never */ }
    setLocalMirror(null);
  }, [storageKey]);

  return { draft, setDraft, dirty, status, savedAt, lastError, saveNow: doSave, localMirror, restoreLocal, discardLocal };
}

// ---------------------------------------------------------------------------
// Indikator status autosave (silent success — §18.7 "tanpa dialog")
// ---------------------------------------------------------------------------

export function AutosaveIndicator({ state }: { state: AutosaveState<unknown> }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
      {state.status === "saving" && (<><Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />{t("Menyimpan…", "Saving…")}</>)}
      {state.status === "saved" && (<><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />{t(`Tersimpan otomatis ${state.savedAt ?? ""}`, `Auto-saved ${state.savedAt ?? ""}`)}</>)}
      {state.status === "offline" && (<><CloudOff className="h-3.5 w-3.5 text-amber-600" />{t("Offline — tersimpan di perangkat", "Offline — saved on device")}</>)}
      {state.status === "error" && (
        <span className="text-rose-600 dark:text-rose-400" title={state.lastError ?? undefined}>
          <CloudUpload className="h-3.5 w-3.5" />
          {t("Gagal menyimpan — coba lagi", "Failed to save — retry")}
        </span>
      )}
      {state.status === "idle" && state.dirty && (<><CloudUpload className="h-3.5 w-3.5" />{t("Perubahan menunggu disimpan", "Changes pending")}</>)}
    </span>
  );
}

/** Banner pemulihan draf lokal (§18.7 — eksplisit, server sumber kebenaran). */
export function DraftRecoveryBanner({ state, describe }: { state: AutosaveState<unknown>; describe?: (v: unknown) => string | null }) {
  const { t } = useI18n();
  if (!state.localMirror) return null;
  const at = new Date(state.localMirror.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const desc = describe?.(state.localMirror.value) ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
      <RotateCcw className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1">
        {t(
          `Pemulihan draf lokal (${at}) ditemukan${desc ? ` — ${desc}` : ""}. Server tetap sumber kebenaran.`,
          `Local draft recovery (${at}) found${desc ? ` — ${desc}` : ""}. The server remains the source of truth.`,
        )}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-7 border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300" onClick={state.discardLocal}>
          {t("Buang", "Discard")}
        </Button>
        <Button size="sm" className="h-7 bg-amber-600 hover:bg-amber-700" onClick={state.restoreLocal}>
          {t("Pulihkan", "Restore")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter Σbobot live (§18.1-3) — hijau tepat 100 · amber mendekati · merah lebih
// ---------------------------------------------------------------------------

export function WeightMeter({ value, compact }: { value: number; compact?: boolean }) {
  const { t } = useI18n();
  const pct = Math.min(value, 130);
  const tone =
    Math.abs(value - 100) < 0.01 ? "bg-emerald-500"
    : value > 100 ? "bg-rose-500"
    : value >= 85 ? "bg-amber-500"
    : "bg-slate-400";
  return (
    <div className={cn("flex items-center gap-2", compact ? "text-xs" : "text-sm")}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={130}>
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.min((pct / 130) * 100, 100)}%` }} />
      </div>
      <span className={cn("tabular-nums font-medium", Math.abs(value - 100) < 0.01 ? "text-emerald-700 dark:text-emerald-400" : value > 100 ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300")}>
        {Number.isInteger(value) ? value : value.toFixed(1)}%
      </span>
      {!compact && (
        <span className="hidden text-xs text-slate-400 sm:inline">
          {Math.abs(value - 100) < 0.01 ? t("(tepat 100)", "(exactly 100)") : t("harus 100", "must be 100")}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress tracker bar (§18.7 — "Formulir Anda selesai N%" di ATAS formulir)
// ---------------------------------------------------------------------------

export function ProgressTrackerBar({ pct, breakdown }: { pct: number; breakdown?: string | null }) {
  const { t } = useI18n();
  const done = pct >= 100;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80" aria-label={t("Progres pengisian formulir", "Form completion progress")}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {t(`Formulir Anda selesai ${pct}%`, `Your form is ${pct}% complete`)}
        </span>
        {breakdown && <span className="text-slate-400">{breakdown}</span>}
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={cn("h-full rounded-full transition-all", done ? "bg-emerald-500" : "bg-brand")}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Distribusi bobot "bagi rata sisa" (§18.1-3 tombol bantuan). */
export function distributeEvenly(weights: number[], target = 100): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const base = Math.floor((target / n) * 100) / 100;
  const out = Array(n).fill(base);
  out[n - 1] = Math.round((target - base * (n - 1)) * 100) / 100;
  return out;
}
