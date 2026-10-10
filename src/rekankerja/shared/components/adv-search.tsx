"use client";
// ============================================================================
// RekanKerja — ADVANCE SEARCH — tombol kecil + popup (Task adv-search) ======
// ============================================================================
// Pemakaian di view list (pola minimal — lihat wiring modul utk contoh nyata):
//   const [adv, setAdv] = useState<AdvSearch | null>(null);
//   const rows = useMemo(() => filterRowsByAdv(rawRows, adv, FIELDS), [rawRows, adv]);
//   …toolbar… <AdvSearchButton fields={FIELDS} value={adv} onChange={setAdv} />
//
// Untuk endpoint TER-PAGINASI (employees, activity-logs, esign chain) nilai
// dikirim sebagai query param `adv` (encodeAdvParam) dan dijalankan server
// (adv-search-server.ts) — tombol/dialog ini tetap sama.
//
// Dialog mengikuti habbit advance search yang benar:
//   • kombinasi kondisi DAN (Semua) / ATAU (Salah satu) — toggle eksplisit;
//   • operator menyesuaikan tipe field (text/number/date/select);
//   • pola karakter "@" default utk teks: "@x" akhiran, "x@" awalan, "@x@"
//     mengandung (dengan contoh hidup di panel bantuan + hint di bawah input);
//   • kondisi tanpa nilai diabaikan (bukan error) — baris kosong mudah dibuang;
//   • badge jumlah kondisi aktif di tombol + ring saat aktif;
//   • Reset / Batal / Terapkan; Enter di input nilai = Terapkan.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SlidersHorizontal, Plus, X, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  type AdvCond, type AdvFieldDef, type AdvOp, type AdvSearch,
  advCount, sanitizeAdv,
} from "@/rekankerja/shared/lib/adv-search";

// ============ operator per tipe field ============

interface OpDef { op: AdvOp; label: string; labelEn: string }

const TEXT_OPS: OpDef[] = [
  { op: "pattern", label: "Pola @" , labelEn: "@ pattern" },
  { op: "contains", label: "Mengandung", labelEn: "Contains" },
  { op: "startsWith", label: "Berawalan", labelEn: "Starts with" },
  { op: "endsWith", label: "Berakhiran", labelEn: "Ends with" },
  { op: "eq", label: "Sama persis", labelEn: "Equals" },
  { op: "ne", label: "Tidak sama", labelEn: "Not equals" },
  { op: "empty", label: "Kosong", labelEn: "Is empty" },
  { op: "notEmpty", label: "Tidak kosong", labelEn: "Is not empty" },
];
const NUMBER_OPS: OpDef[] = [
  { op: "eq", label: "=", labelEn: "=" },
  { op: "ne", label: "≠", labelEn: "≠" },
  { op: "gt", label: ">", labelEn: ">" },
  { op: "gte", label: "≥", labelEn: "≥" },
  { op: "lt", label: "<", labelEn: "<" },
  { op: "lte", label: "≤", labelEn: "≤" },
  { op: "between", label: "Di antara", labelEn: "Between" },
  { op: "empty", label: "Kosong", labelEn: "Is empty" },
  { op: "notEmpty", label: "Tidak kosong", labelEn: "Is not empty" },
];
const DATE_OPS: OpDef[] = [
  { op: "eq", label: "Pada", labelEn: "On" },
  { op: "ne", label: "Bukan pada", labelEn: "Not on" },
  { op: "gt", label: "Setelah", labelEn: "After" },
  { op: "gte", label: "Pada/setelah", labelEn: "On/after" },
  { op: "lt", label: "Sebelum", labelEn: "Before" },
  { op: "lte", label: "Sampai/sebelum", labelEn: "On/before" },
  { op: "between", label: "Di antara", labelEn: "Between" },
  { op: "empty", label: "Kosong", labelEn: "Is empty" },
  { op: "notEmpty", label: "Tidak kosong", labelEn: "Is not empty" },
];
const SELECT_OPS: OpDef[] = [
  { op: "eq", label: "Sama", labelEn: "Equals" },
  { op: "ne", label: "Tidak sama", labelEn: "Not equals" },
  { op: "empty", label: "Kosong", labelEn: "Is empty" },
  { op: "notEmpty", label: "Tidak kosong", labelEn: "Is not empty" },
];

function opsOf(type: AdvFieldDef["type"]): OpDef[] {
  switch (type) {
    case "number": return NUMBER_OPS;
    case "date": return DATE_OPS;
    case "select": return SELECT_OPS;
    default: return TEXT_OPS;
  }
}

const VALUELESS: AdvOp[] = ["empty", "notEmpty"];

// ============ baris kondisi (draft) ============

interface DraftCond { field: string; op: AdvOp; value: string; value2: string }

function toDraft<R>(adv: AdvSearch | null | undefined, fields: AdvFieldDef<R>[]): DraftCond[] {
  const s = sanitizeAdv(adv);
  if (!s) return [blankCond(fields)];
  return s.conds.map((c) => ({ field: c.field, op: c.op, value: c.value ?? "", value2: c.value2 ?? "" }));
}

function blankCond<R>(fields: AdvFieldDef<R>[]): DraftCond {
  const f = fields[0];
  return { field: f?.key ?? "", op: "pattern", value: "", value2: "" };
}

// ============ tombol + dialog ============

export function AdvSearchButton<R = Record<string, unknown>>({
  fields, value, onChange, className,
}: {
  fields: AdvFieldDef<R>[];
  value: AdvSearch | null | undefined;
  onChange: (v: AdvSearch | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const active = advCount(value);

  if (fields.length === 0) return null;

  return (
    <>
      <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className={cn(
              "h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold",
              active > 0 && "ov-fill border-transparent hover:opacity-90",
              className,
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">{t("Advance Search")}</span>
            <span className="sm:hidden">{t("Advance")}</span>
            {active > 0 && (
              <span className={cn(
                "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-extrabold tabular-nums",
                active > 0 ? "bg-white/25 text-white" : "",
              )}>
                {active}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px] font-semibold">
          {active > 0
            ? t("{n} kondisi aktif — klik untuk ubah", "{n} active conditions — click to edit", { n: active })
            : t("Cari kombinasi multi-field (nama, no. dokumen, tanggal, status…)", "Multi-field combined search (name, doc no., date, status…)")}
        </TooltipContent>
      </Tooltip>
      </TooltipProvider>

      <AdvSearchDialog fields={fields} open={open} onOpenChange={setOpen} value={value} onApply={onChange} />
    </>
  );
}

function AdvSearchDialog<R = Record<string, unknown>>({
  fields, open, onOpenChange, value, onApply,
}: {
  fields: AdvFieldDef<R>[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: AdvSearch | null | undefined;
  onApply: (v: AdvSearch | null) => void;
}) {
  const { t } = useI18n();
  const [match, setMatch] = useState<"all" | "any">("all");
  const [draft, setDraft] = useState<DraftCond[]>([blankCond(fields)]);
  const [initOpen, setInitOpen] = useState(false);

  // muat nilai tersimpan tiap kali dialog dibuka (bukan saat mengetik)
  useEffect(() => {
    if (open && !initOpen) {
      setInitOpen(true);
      const d = toDraft(value, fields);
      setDraft(d.length > 0 ? d : [blankCond(fields)]);
      setMatch(sanitizeAdv(value)?.match ?? "all");
    }
    if (!open) setInitOpen(false);
  }, [open]);

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const upd = (i: number, patch: Partial<DraftCond>) => {
    setDraft((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const add = () => setDraft((prev) => (prev.length >= 12 ? prev : [...prev, blankCond(fields)]));
  const del = (i: number) => setDraft((prev) => (prev.length <= 1 ? [blankCond(fields)] : prev.filter((_, idx) => idx !== i)));

  const apply = () => {
    // buang kondisi tanpa nilai (op tanpa nilai tetap dipertahankan)
    const conds: AdvCond[] = [];
    for (const c of draft) {
      const f = fieldMap.get(c.field);
      if (!f) continue;
      if (VALUELESS.includes(c.op)) { conds.push({ field: c.field, op: c.op }); continue; }
      if (!c.value.trim()) continue;
      conds.push({ field: c.field, op: c.op, value: c.value, ...(c.op === "between" ? { value2: c.value2.trim() || c.value } : {}) });
    }
    const out: AdvSearch | null = conds.length > 0 ? { match, conds } : null;
    onApply(out);
    onOpenChange(false);
  };

  const reset = () => {
    setDraft([blankCond(fields)]);
    setMatch("all");
    onApply(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 ov-text-accent" /> {t("Advance Search")}
          </DialogTitle>
          <DialogDescription>
            {t("Kombinasikan beberapa field — hasil harus memenuhi semua kondisi (DAN) atau salah satunya (ATAU).", "Combine multiple fields — results must match all conditions (AND) or any of them (OR).")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* mode kombinasi */}
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs font-bold">{t("Cocokkan", "Match")}</Label>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
              {([
                { v: "all" as const, label: t("Semua kondisi (DAN)", "All conditions (AND)") },
                { v: "any" as const, label: t("Salah satu (ATAU)", "Any condition (OR)") },
              ]).map((m) => (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => setMatch(m.v)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12px] font-bold transition",
                    match === m.v ? "ov-fill shadow-sm" : "ov-tile text-slate-700 dark:text-slate-200",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* baris kondisi */}
          <div className="space-y-2">
            {draft.map((c, i) => {
              const f = fieldMap.get(c.field);
              const ops = opsOf(f?.type ?? "text");
              const needs2 = c.op === "between";
              const patternHint = c.op === "pattern";
              return (
                <div key={i} className="grid grid-cols-1 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40 sm:grid-cols-[1.1fr_0.9fr_1.4fr_auto]">
                  {/* field */}
                  <Select value={c.field} onValueChange={(v) => {
                    const nf = fieldMap.get(v);
                    const defOp = opsOf(nf?.type ?? "text")[0]!.op;
                    upd(i, { field: v, op: defOp }); // ganti field → op direset ke default tipenya
                  }}>
                    <SelectTrigger className="h-8 bg-white text-xs dark:bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {fields.map((fd) => (
                        <SelectItem key={fd.key} value={fd.key} className="text-xs">{t(fd.label, fd.labelEn)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* operator */}
                  <Select value={c.op} onValueChange={(v) => upd(i, { op: v as AdvOp })}>
                    <SelectTrigger className="h-8 bg-white text-xs dark:bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {ops.map((o) => (
                        <SelectItem key={o.op} value={o.op} className="text-xs">{t(o.label, o.labelEn)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* nilai */}
                  <div className="flex items-center gap-1.5">
                    {VALUELESS.includes(c.op) ? (
                      <p className="px-1 text-[11px] italic text-slate-400">{t("(tanpa nilai)", "(no value needed)")}</p>
                    ) : f?.type === "select" ? (
                      <Select value={c.value || undefined} onValueChange={(v) => upd(i, { value: v })}>
                        <SelectTrigger className="h-8 w-full bg-white text-xs dark:bg-slate-900"><SelectValue placeholder={t("Pilih…", "Pick…")} /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {(f.options ?? []).map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">{t(o.label, o.labelEn)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={f?.type === "number" ? "number" : f?.type === "date" ? "date" : "text"}
                        inputMode={f?.type === "number" ? "decimal" : undefined}
                        step={f?.type === "number" ? "any" : undefined}
                        value={c.value}
                        onChange={(e) => upd(i, { value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
                        placeholder={f?.type === "date" ? "YYYY-MM-DD" : f?.type === "number" ? "0" : t("nilai…", "value…")}
                        className="h-8 bg-white text-xs dark:bg-slate-900"
                      />
                    )}
                    {needs2 && (
                      <>
                        <span className="text-[10px] font-bold text-slate-400">–</span>
                        <Input
                          type={f?.type === "date" ? "date" : f?.type === "number" ? "number" : "text"}
                          step={f?.type === "number" ? "any" : undefined}
                          value={c.value2}
                          onChange={(e) => upd(i, { value2: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
                          placeholder={t("batas atas", "upper bound")}
                          className="h-8 w-28 bg-white text-xs dark:bg-slate-900"
                        />
                      </>
                    )}
                  </div>
                  {/* hapus */}
                  <button
                    type="button"
                    onClick={() => del(i)}
                    aria-label={t("Hapus kondisi", "Remove condition")}
                    title={t("Hapus kondisi", "Remove condition")}
                    className="justify-self-end rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {patternHint && (
                    <p className="text-[10px] leading-snug text-slate-400 sm:col-span-4">
                      {t('Pola "@": "@rahman" = berakhiran rahman · "Andi@" = berawalan Andi · "@kay@" = mengandung kay · tanpa @ = mengandung', '"@" pattern: "@rahman" = ends with rahman · "Andi@" = starts with Andi · "@kay@" = contains kay · without @ = contains')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <Button variant="outline" onClick={add} disabled={draft.length >= 12} className="h-8 gap-1.5 text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> {t("Tambah Kondisi", "Add Condition")}
          </Button>

          {/* panel bantuan pola @ */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
            <p className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
              <Info className="h-3.5 w-3.5 ov-text-accent" /> {t("Karakter unik @ pada kolom teks", 'The "@" wildcard in text fields')}
            </p>
            <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
              <p><code className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-deep shadow-sm dark:bg-slate-800 dark:text-brand/85">@rahman</code> → {t("berakhiran “rahman”", "ends with “rahman”")}</p>
              <p><code className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-deep shadow-sm dark:bg-slate-800 dark:text-brand/85">Andi@</code> → {t("berawalan “Andi”", "starts with “Andi”")}</p>
              <p><code className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-deep shadow-sm dark:bg-slate-800 dark:text-brand/85">@kay@</code> → {t("mengandung “kay”", "contains “kay”")}</p>
              <p><code className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-brand-deep shadow-sm dark:bg-slate-800 dark:text-brand/85">Budi</code> → {t("mengandung (biasa)", "plain contains")}</p>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">
              {t("Tanda @ di tengah kata tetap dianggap biasa — alamat email tetap bisa dicari.", "An @ in the middle stays literal — email addresses remain searchable.")}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={reset} className="h-9 text-xs font-bold text-slate-500 hover:text-rose-600">
            {t("Reset")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-9">{t("Batal", "Cancel")}</Button>
            <Button onClick={apply} className="h-9 gap-1.5 font-bold">
              <SlidersHorizontal className="h-3.5 w-3.5" /> {t("Terapkan", "Apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Badge ringkas jumlah kondisi aktif — utk ditampilkan di header kartu list bila perlu. */
export function AdvActiveBadge({ count }: { count: number }) {
  const { t } = useI18n();
  if (count <= 0) return null;
  return (
    <Badge variant="outline" className="gap-1 border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">
      <SlidersHorizontal className="h-3 w-3" /> {t("{n} filter", "{n} filters", { n: count })}
    </Badge>
  );
}
