"use client";
// OneVity — Task 33: DIALOG ATURAN PARAMETER GENERIK (leave/medical/travel/benefit).
// Satu komponen dikonfigurasi domain (ENTITY_RULE_DOMAINS) — menampilkan daftar
// rule, builder kondisi (20 parameter pekerjaan+personal), dan tab simulasi
// per karyawan. Domain "wage" memakai dialog khusus payroll (Task 32).
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/onevity/shared/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, SlidersHorizontal, FlaskConical, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import {
  RuleCondition, RuleParamDef, RuleMatchMode,
  RULE_PARAMS, RULE_OP_LABEL, RULE_PARAM_BY_KEY,
  describeCondition, describeConditionValue,
} from "@/onevity/shared/lib/parameter-rules";
import { EntityRuleDomainDef, RuleDomain } from "@/onevity/shared/lib/entity-rule-domains";

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  conditions: RuleCondition[];
  /** mode kombinasi antar kondisi ("all"=DAN default; "any"=ATAU). */
  matchMode?: RuleMatchMode;
  actionType: string;
  notes: string | null;
  active: boolean;
  days?: number;
  amount?: number;
}

interface EntityOpt { code: string; name?: string; title?: string; shortName?: string | null; city?: string | null }
interface OptionsPayload {
  orgUnits: EntityOpt[]; positions: EntityOpt[]; grades: EntityOpt[]; positionLevels: EntityOpt[];
  offices: EntityOpt[]; workLocations: EntityOpt[]; companies: EntityOpt[];
  religion: string[]; maritalStatus: string[]; bloodType: string[]; city: string[];
  workShift: string[]; employmentStatus: string[];
}

interface RulesPayload {
  domainDef: EntityRuleDomainDef;
  entity: { id: string; code: string; name: string } & Record<string, unknown>;
  baseLabel: string;
  rules: RuleRow[];
  options: OptionsPayload;
}

interface PreviewRow {
  employeeNo: string; fullName: string;
  orgUnitName: string | null; positionName: string | null;
  officeName: string | null; workLocationName: string | null;
  employmentStatus: string; gender: string | null; religion: string | null; maritalStatus: string | null;
  tenureYears: number | null;
  /** Task 37: nilai ramah semua 20 param karyawan (key RULE_PARAMS). */
  paramDisplay?: Record<string, string | null>;
  base: number | null; final: number | null;
  matchedRule: { id: string; name: string; actionType: string; value: number; conditions?: RuleCondition[] } | null;
}

export interface EntityRuleTarget {
  domain: RuleDomain;
  id: string;
  code: string;
  name: string;
}

/** Tombol kecil "Aturan (n)" — dipasang di tabel master tiap modul. */
export function EntityRulesButton({ target, ruleCount, onOpen }: { target: EntityRuleTarget; ruleCount: number; onOpen: (t: EntityRuleTarget) => void }) {
  const { t } = useI18n();
  return (
    <button
      onClick={() => onOpen(target)}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors",
        ruleCount
          ? "ov-soft ov-border-accent ov-text-accent hover:shadow-sm"
          : "border-stone-200 text-stone-400 hover:border-stone-300 hover:text-stone-600 dark:border-stone-700 dark:text-stone-500",
      )}
      title={t("Aturan diferensiasi parameter", "Parameter differentiation rules")}
      aria-label={t("Aturan {name}", "Rules {name}", { name: target.name })}
    >
      <SlidersHorizontal className="h-3 w-3" /> {ruleCount}
    </button>
  );
}

export function EntityRulesDialog({ open, target, onClose }: { open: boolean; target: EntityRuleTarget | null; onClose: () => void }) {
  const { t } = useI18n();
  const url = target ? `/api/onevity/entity-rules?domain=${target.domain}&entityId=${target.id}` : null;
  const { data, loading, refresh } = useApi<RulesPayload>(url ?? "/api/onevity/entity-rules");
  const [editor, setEditor] = useState<{ open: boolean; rule: RuleRow | null }>({ open: false, rule: null });

  if (!target) return null;
  const def = data?.domainDef;
  const rules = data?.rules ?? [];
  const entityLabel = def ? t(def.entityLabel, def.entityLabelEn) : "";
  const valueField = def?.valueField ?? "amount";

  const remove = async (r: RuleRow) => {
    if (!window.confirm(t("Hapus aturan '{name}'?", "Delete rule '{name}'?", { name: r.name }))) return;
    try {
      await apiSend(`/api/onevity/entity-rules?domain=${target.domain}&id=${r.id}`, "DELETE");
      toast.success(t("Aturan dihapus", "Rule deleted"));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const toggleActive = async (r: RuleRow) => {
    try {
      await apiSend("/api/onevity/entity-rules", "PATCH", { domain: target.domain, id: r.id, active: !r.active });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const fmtValue = (v: number) => (def?.valueField === "days" ? `${v}` : fmtIDR(v));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 ov-text-accent" />
            {def ? t(def.label, def.labelEn) : t("Aturan Diferensiasi", "Differentiation Rules")}
            <Badge variant="outline" className="font-mono text-[10px]">{target.code}</Badge>
          </DialogTitle>
          <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            {t(
              `Rule menilai parameter karyawan (pekerjaan & personal) lalu mengubah ${valueField === "days" ? "entitlement" : "limit"} ${entityLabel.toLowerCase()} ini. Kombinasi antar kondisi bisa DAN (semua cocok) atau ATAU (salah satu); urutan prioritas menentukan rule yang menang (pertama yang cocok).`,
              `Rules evaluate employee parameters (job & personal) then adjust this ${entityLabel.toLowerCase()}'s ${valueField === "days" ? "entitlement" : "limit"}. Conditions combine with AND (all match) or OR (any one); priority order decides the winning rule (first match).`,
            )}
          </p>
        </DialogHeader>

        <Tabs defaultValue="rules" className="mt-1">
          <TabsList className="h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
            <TabsTrigger value="rules" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
              <SlidersHorizontal className="h-3.5 w-3.5" /> {t("Aturan ({n})", "Rules ({n})", { n: rules.length })}
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
              <FlaskConical className="h-3.5 w-3.5" /> {t("Simulasi Karyawan", "Employee Simulation")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-400">
                <Info className="h-3.5 w-3.5" />
                {def ? t(def.baseLabel, def.baseLabelEn) : ""}:
                <span className="ov-text-accent font-mono">{data?.baseLabel ?? "—"}</span>
              </div>
              <Button size="sm" onClick={() => setEditor({ open: true, rule: null })} className="gap-1.5 text-xs font-bold">
                <Plus className="h-3.5 w-3.5" /> {t("Tambah Aturan", "Add Rule")}
              </Button>
            </div>

            {loading && !data ? (
              <Card><CardContent className="p-8 text-center text-xs text-stone-400">{t("Memuat aturan…", "Loading rules…")}</CardContent></Card>
            ) : rules.length === 0 ? (
              <Card className="rounded-2xl border-dashed">
                <CardContent className="p-8 text-center">
                  <SlidersHorizontal className="mx-auto mb-2 h-6 w-6 text-stone-300" />
                  <p className="text-xs font-bold text-stone-500">{t("Belum ada aturan — nilai sama untuk semua karyawan", "No rules yet — same value for all employees")}</p>
                  <p className="mt-1 text-[11px] text-stone-400">{t("Tambahkan aturan untuk membedakan nilai berdasarkan parameter karyawan.", "Add a rule to differentiate by employee parameters.")}</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                          <TableHead className="text-[11px] font-bold">#</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Nama Aturan", "Rule Name")}</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Kondisi", "Conditions")}</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Aksi", "Action")}</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Aktif")}</TableHead>
                          <TableHead className="w-20" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rules.map((r) => (
                          <TableRow key={r.id} className={cn("align-top hover:bg-stone-50 dark:hover:bg-stone-900/60", !r.active && "opacity-50")}>
                            <TableCell className="font-mono text-[11px] font-bold text-stone-400">{r.priority}</TableCell>
                            <TableCell className="max-w-64 text-[12px] font-bold">{r.name}</TableCell>
                            <TableCell className="max-w-80">
                              <div className="flex flex-col gap-1">
                                {r.conditions.length > 1 && (
                                  <span
                                    className={cn(
                                      "w-fit rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide",
                                      (r.matchMode ?? "all") === "any"
                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                        : "bg-stone-200 text-stone-500 dark:bg-stone-700 dark:text-stone-300",
                                    )}
                                    title={(r.matchMode ?? "all") === "any" ? t("Salah satu kondisi cukup", "Any one condition suffices") : t("Semua kondisi harus cocok", "All conditions must match")}
                                  >
                                    {(r.matchMode ?? "all") === "any" ? t("ATAU", "OR") : t("DAN", "AND")}
                                  </span>
                                )}
                                {r.conditions.map((c, i) => (
                                  <span key={i} className="rounded-lg bg-stone-100 px-2 py-1 text-[10px] font-semibold leading-relaxed text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                    {describeCondition(c, t)}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-[11px] font-bold ov-text-accent">{actionLabel(r.actionType, def, t)}</span>
                              <span className="block font-mono text-[11px] font-bold text-stone-700 dark:text-stone-200">
                                {r.actionType === "Multiply" ? `× ${r[valueField] ?? 0}` : fmtValue(r[valueField] ?? 0)}
                              </span>
                            </TableCell>
                            <TableCell><Switch checked={r.active} onCheckedChange={() => toggleActive(r)} aria-label={t("Toggle {name}", "Toggle {name}", { name: r.name })} /></TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <button onClick={() => setEditor({ open: true, rule: r })} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label={t("Ubah")}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => remove(r)} className="rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus")}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="preview" className="mt-3">
            <PreviewTab domain={target.domain} entityId={target.id} def={def} />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
        </DialogFooter>
      </DialogContent>

      {editor.open && def && (
        <RuleEditorDialog
          open={editor.open}
          domain={target.domain}
          entityId={target.id}
          entityCode={target.code}
          def={def}
          baseLabel={data?.baseLabel ?? ""}
          rule={editor.rule}
          options={data?.options}
          onClose={() => { setEditor({ open: false, rule: null }); refresh(); }}
        />
      )}
    </Dialog>
  );
}

function actionLabel(actionType: string, def: EntityRuleDomainDef | undefined, t: (a: string, b: string) => string): string {
  const a = def?.actions.find((x) => x.value === actionType);
  return a ? t(a.label, a.labelEn) : actionType;
}

// ============ TAB SIMULASI ============

function PreviewTab({ domain, entityId, def }: { domain: RuleDomain; entityId: string; def?: EntityRuleDomainDef }) {
  const { t } = useI18n();
  const { data, loading } = useApi<{ preview: PreviewRow[] }>(`/api/onevity/entity-rules?domain=${domain}&entityId=${entityId}&preview=1`);
  const rows = data?.preview ?? [];
  const matchedCount = rows.filter((r) => r.matchedRule).length;
  const isDays = def?.valueField === "days";
  const fmt = (v: number | null) => (v == null ? "—" : isDays ? `${v}` : fmtIDR(v));

  if (loading && !data) {
    return <Card><CardContent className="p-8 text-center text-xs text-stone-400">{t("Menghitung simulasi…", "Computing simulation…")}</CardContent></Card>;
  }
  if (rows.length === 0) {
    return <Card><CardContent className="p-8 text-center text-xs text-stone-400">{t("Tidak ada karyawan aktif dengan penempatan.", "No active employees with assignments.")}</CardContent></Card>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
        <Badge className="gap-1 bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {t("{n} karyawan", "{n} employees", { n: rows.length })}
        </Badge>
        <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
          {t("{n} kena aturan", "{n} matched by rule", { n: matchedCount })}
        </Badge>
        <Badge className="gap-1 bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {t("{n} nilai dasar", "{n} base value", { n: rows.length - matchedCount })}
        </Badge>
      </div>
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-900">
                <TableRow>
                  <TableHead className="text-[11px] font-bold">{t("No.")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Karyawan", "Employee")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Penempatan", "Placement")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Parameter (rule yang cocok)", "Parameters (matched rule)")}</TableHead>
                  <TableHead className="text-right text-[11px] font-bold">{isDays ? t("Dasar (hari)", "Base (days)") : t("Dasar", "Base")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Aturan", "Rule")}</TableHead>
                  <TableHead className="text-right text-[11px] font-bold">{t("Final", "Final")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.employeeNo} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <TableCell className="font-mono text-[11px] font-bold text-stone-500">{r.employeeNo}</TableCell>
                    <TableCell className="text-[12px] font-bold">{r.fullName}</TableCell>
                    <TableCell className="max-w-56 text-[10px] leading-relaxed text-stone-500 dark:text-stone-400">
                      {r.positionName ?? "—"}<br />
                      {r.officeName ?? r.workLocationName ?? "—"} · {r.employmentStatus}
                    </TableCell>
                    <TableCell className="max-w-48 text-[10px] leading-relaxed text-stone-500 dark:text-stone-400">
                      {r.matchedRule && r.matchedRule.conditions && r.matchedRule.conditions.length > 0 ? (
                        <div
                          className="flex flex-col gap-0.5"
                          title={r.matchedRule.conditions.map((c) => describeCondition(c, t)).join("  •  ")}
                        >
                          {r.matchedRule.conditions.map((c) => {
                            const pd = RULE_PARAM_BY_KEY.get(c.param);
                            const label = pd ? t(pd.label, pd.labelEn) : c.param;
                            const raw = r.paramDisplay?.[c.param];
                            const val = raw == null ? t("(kosong)", "(empty)") : describeConditionValue(c.param, raw, t);
                            return (
                              <span key={c.param} className="truncate">
                                {label}: <span className="font-bold text-stone-600 dark:text-stone-300">{val}</span>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] text-stone-500">{fmt(r.base)}</TableCell>
                    <TableCell>
                      {r.matchedRule ? (
                        <Badge variant="outline" className="max-w-56 truncate text-[9px] font-bold text-emerald-600 dark:text-emerald-400" title={r.matchedRule.name}>
                          {r.matchedRule.name}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-stone-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-[11px] font-bold", r.matchedRule ? "ov-text-accent" : "text-stone-700 dark:text-stone-200")}>
                      {fmt(r.final)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
        {t(
          "Simulasi memakai data penempatan & profil saat ini; untuk medical berbasis faktor gaji, plafon dihitung dari gaji pokok masing-masing karyawan.",
          "Simulation uses current placement & profile data; for salary-factor medical types, the limit is computed per employee's base salary.",
        )}
      </p>
    </div>
  );
}

// ============ EDITOR RULE ============

const blankRule = (): { name: string; priority: string; actionType: string; value: string; notes: string; active: boolean; matchMode: RuleMatchMode; conditions: RuleCondition[] } => ({
  name: "", priority: "100", actionType: "", value: "0", notes: "", active: true,
  matchMode: "all",
  conditions: [{ param: "office", op: "in", values: [] }],
});

/** Toggle mode kombinasi antar kondisi (DAN / ATAU) — muncul saat kondisi ≥ 2. */
function MatchModeToggle({ value, onChange }: { value: RuleMatchMode; onChange: (m: RuleMatchMode) => void }) {
  const { t } = useI18n();
  const items: { v: RuleMatchMode; label: string; labelEn: string; activeCls: string }[] = [
    { v: "all", label: "DAN — semua cocok", labelEn: "AND — all match", activeCls: "bg-white ov-text-accent shadow-sm dark:bg-stone-700" },
    { v: "any", label: "ATAU — salah satu", labelEn: "OR — any one", activeCls: "bg-white text-amber-600 shadow-sm dark:bg-stone-700 dark:text-amber-400" },
  ];
  return (
    <div className="flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800" role="group" aria-label={t("Kombinasi kondisi", "Condition combination")}>
      {items.map((it) => (
        <button
          key={it.v}
          type="button"
          onClick={() => onChange(it.v)}
          aria-pressed={value === it.v}
          className={cn(
            "rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors",
            value === it.v ? it.activeCls : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300",
          )}
        >
          {t(it.label, it.labelEn)}
        </button>
      ))}
    </div>
  );
}

function RuleEditorDialog({ open, domain, entityId, entityCode, def, baseLabel, rule, options, onClose }: {
  open: boolean;
  domain: RuleDomain;
  entityId: string;
  entityCode: string;
  def: EntityRuleDomainDef;
  baseLabel: string;
  rule: RuleRow | null;
  options?: OptionsPayload;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(blankRule());
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const formKey = rule?.id ?? "new";
  if (key !== formKey) {
    setKey(formKey);
    const fallbackAction = rule?.actionType ?? def.actions[0].value;
    setForm(rule
      ? {
          name: rule.name,
          priority: String(rule.priority),
          actionType: rule.actionType || fallbackAction,
          value: String(rule[def.valueField] ?? 0),
          notes: rule.notes ?? "",
          active: rule.active,
          matchMode: rule.matchMode ?? "all",
          conditions: rule.conditions.length > 0 ? rule.conditions.map((c) => ({ ...c, values: [...c.values] })) : [{ param: "office", op: "in", values: [] }],
        }
      : { ...blankRule(), actionType: fallbackAction });
  }

  const updateCond = (i: number, patch: Partial<RuleCondition>) => {
    setForm((f) => ({ ...f, conditions: f.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  };
  // toggle nilai chip dgn update fungsional — aman utk klik beruntun (batching) sekalipun
  const toggleCondValue = (i: number, v: string) => {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, idx) =>
        idx === i ? { ...c, values: c.values.includes(v) ? c.values.filter((x) => x !== v) : [...c.values, v] } : c),
    }));
  };
  const addCond = () => setForm((f) => ({ ...f, conditions: [...f.conditions, { param: "gender", op: "in", values: [] }] }));
  const removeCond = (i: number) => setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error(t("Nama aturan wajib diisi", "Rule name is required")); return; }
    const conds = form.conditions.filter((c) => c.op === "is_empty" || c.op === "not_empty" || c.values.length > 0);
    if (conds.length === 0) { toast.error(t("Minimal satu kondisi terisi nilai", "At least one condition with values is required")); return; }
    const value = Number(form.value.replace(",", "."));
    if (!isFinite(value)) { toast.error(t("Nilai harus angka", "Value must be numeric")); return; }
    if (form.actionType === "Multiply" && value <= 0) { toast.error(t("Faktor Multiply harus > 0", "Multiply factor must be > 0")); return; }

    setBusy(true);
    const payload = {
      domain, entityId, name: form.name.trim(),
      priority: Number(form.priority) || 100,
      conditions: { mode: form.matchMode, conditions: conds }, actionType: form.actionType, value,
      notes: form.notes.trim() || null, active: form.active,
    };
    try {
      if (rule) {
        await apiSend("/api/onevity/entity-rules", "PATCH", { id: rule.id, ...payload });
        toast.success(t("Aturan diperbarui", "Rule updated"));
      } else {
        await apiSend("/api/onevity/entity-rules", "POST", payload);
        toast.success(t("Aturan dibuat", "Rule created"));
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const isDays = def.valueField === "days";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 ov-text-accent" />
            {rule ? t("Edit Aturan", "Edit Rule") : t("Aturan Baru — {code}", "New Rule — {code}", { code: entityCode })}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <div>
              <Label className="text-xs">{t("Nama Aturan *", "Rule Name *")}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("cth: Entitlement loyalitas 10 tahun", "e.g. 10-year loyalty entitlement")} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("Prioritas", "Priority")}</Label>
              <Input type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="mt-1.5 font-mono" />
              <p className="mt-1 text-[10px] text-stone-400">{t("kecil dievaluasi lebih dulu", "lower evaluated first")}</p>
            </div>
          </div>

          {/* ---- kondisi ---- */}
          <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                {form.matchMode === "any"
                  ? t("Kondisi Parameter (salah satu cocok — ATAU)", "Parameter Conditions (any one matches — OR)")
                  : t("Kondisi Parameter (semua harus cocok — DAN)", "Parameter Conditions (all must match — AND)")}
              </p>
              <div className="flex items-center gap-2">
                {form.conditions.length > 1 && <MatchModeToggle value={form.matchMode} onChange={(m) => setForm((f) => ({ ...f, matchMode: m }))} />}
                <Button size="sm" variant="outline" onClick={addCond} className="h-7 gap-1 px-2 text-[10px] font-bold">
                  <Plus className="h-3 w-3" /> {t("Kondisi", "Condition")}
                </Button>
              </div>
            </div>
            {form.conditions.length > 1 && (
              <p className="mb-2 text-[10px] leading-relaxed text-stone-400">
                {t(
                  "Beberapa nilai dalam satu kondisi sudah bermakna ATAU (\"salah satu dari\"). Pilihan di atas mengatur hubungan ANTAR kondisi: DAN = semua kondisi harus cocok; ATAU = cukup satu kondisi cocok.",
                  "Multiple values within one condition already mean OR (\"is one of\"). The toggle above controls the relation BETWEEN conditions: AND = all must match; OR = any one suffices.",
                )}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {form.conditions.map((c, i) => {
                const pd = RULE_PARAMS.find((p) => p.key === c.param);
                return (
                  <div key={i} className="rounded-xl bg-stone-50 p-2.5 dark:bg-stone-900/60">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={c.param}
                        onValueChange={(v) => {
                          const newDef = RULE_PARAMS.find((p) => p.key === v);
                          const kind = newDef?.kind;
                          const resetOp: RuleCondition["op"] = kind === "number" ? "gte" : "in";
                          updateCond(i, { param: v, op: resetOp, values: [] });
                        }}
                      >
                        <SelectTrigger className="h-8 min-w-44 flex-1 text-[11px] font-bold"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel className="text-[10px] font-bold uppercase">{t("Pekerjaan", "Job")}</SelectLabel>
                            {RULE_PARAMS.filter((p) => p.group === "job").map((p) => (
                              <SelectItem key={p.key} value={p.key} className="text-[11px]">{t(p.label, p.labelEn)}</SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel className="text-[10px] font-bold uppercase">{t("Personal", "Personal")}</SelectLabel>
                            {RULE_PARAMS.filter((p) => p.group === "personal").map((p) => (
                              <SelectItem key={p.key} value={p.key} className="text-[11px]">{t(p.label, p.labelEn)}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <Select value={c.op} onValueChange={(v) => updateCond(i, { op: v as RuleCondition["op"], values: [] })}>
                        <SelectTrigger className="h-8 min-w-40 flex-1 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(RULE_OP_LABEL)
                            .filter(([opKey]) => pd?.kind === "number" || !RULE_OP_LABEL[opKey as RuleCondition["op"]].numericOnly)
                            .map(([opKey, op]) => (
                              <SelectItem key={opKey} value={opKey} className="text-[11px]">{t(op.label, op.labelEn)}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      {form.conditions.length > 1 && (
                        <button onClick={() => removeCond(i)} className="shrink-0 rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus kondisi", "Remove condition")}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {pd && c.op !== "is_empty" && c.op !== "not_empty" && (
                      <div className="mt-2">
                        {pd.kind === "number" ? (
                          <Input
                            type="number" step="any"
                            value={c.values[0] ?? ""}
                            onChange={(e) => updateCond(i, { values: [e.target.value] })}
                            placeholder={t("cth: 5", "e.g. 5")}
                            className="h-8 w-full max-w-64 font-mono text-[11px]"
                          />
                        ) : (
                          <ValueChips cond={c} def={pd} options={options} onToggle={(v) => toggleCondValue(i, v)} onChange={(values) => updateCond(i, { values })} />
                        )}
                        {pd.desc && <p className="mt-1 text-[10px] text-stone-400">{t(pd.desc, pd.descEn ?? pd.desc)}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- aksi ---- */}
          <div className="grid gap-3 rounded-2xl border border-stone-200 p-3 sm:grid-cols-2 dark:border-stone-800">
            <div>
              <Label className="text-xs">{t("Aksi terhadap Nilai", "Value Action")}</Label>
              <Select value={form.actionType} onValueChange={(v) => setForm((f) => ({ ...f, actionType: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {def.actions.map((a) => (
                    <SelectItem key={a.value} value={a.value} className="text-[11px]">
                      {t(a.label, a.labelEn)} — <span className="text-stone-400">{t(a.hint, a.hintEn)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                {form.actionType === "Multiply" ? t("Faktor *", "Factor *") : `${t(def.valueLabel, def.valueLabelEn)} *`}
              </Label>
              <Input
                type="number" step="any"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="mt-1.5 font-mono"
              />
              {!isDays && form.actionType !== "Multiply" && Number(form.value) !== 0 && (
                <p className="mt-1 text-[11px] font-bold text-stone-500">{fmtIDR(Number(form.value) || 0)}</p>
              )}
              <p className="mt-1 text-[10px] text-stone-400">
                {t(`dasar: ${baseLabel || "—"}`, `base: ${baseLabel || "—"}`)}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("Catatan", "Notes")}</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("opsional — dasar kebijakan, referensi dokumen", "optional — policy basis, document reference")} className="mt-1.5" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3 sm:col-span-2 dark:border-stone-700">
              <p className="text-xs font-bold">{t("Aturan Aktif", "Rule Active")}</p>
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pemilih nilai kondisi — chips toggle (master entity / data aktual / opsi baku). */
function ValueChips({ cond, def, options, onToggle, onChange }: {
  cond: RuleCondition;
  def: RuleParamDef;
  options?: OptionsPayload;
  onToggle?: (v: string) => void;
  onChange: (values: string[]) => void;
}) {
  const { t } = useI18n();

  let opts: { value: string; label: string }[] = [];
  if (def.kind === "entity" && def.optionsKey && options) {
    const list = (options as unknown as Record<string, EntityOpt[]>)[def.optionsKey] ?? [];
    opts = list.map((o) => ({ value: o.code, label: `${o.code} — ${o.shortName ?? o.name ?? o.title ?? ""}`.trim() }));
  } else {
    // gabung opsi baku (staticOptions) + nilai distinkt data aktual (optionsKey)
    const statik = (def.staticOptions ?? []).map((o) => ({ value: o.value, label: t(o.label, o.labelEn ?? o.label) }));
    const dataValues = def.optionsKey && options
      ? ((options as unknown as Record<string, string[]>)[def.optionsKey] ?? [])
      : [];
    const seen = new Set(statik.map((o) => o.value));
    opts = [...statik, ...dataValues.filter((v) => !seen.has(v)).map((v) => ({ value: v, label: v }))];
  }

  const toggle = (v: string) => {
    if (onToggle) { onToggle(v); return; }
    const has = cond.values.includes(v);
    onChange(has ? cond.values.filter((x) => x !== v) : [...cond.values, v]);
  };

  if (opts.length === 0) {
    return (
      <Input
        value={cond.values.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder={t("pisahkan dengan koma", "comma separated")}
        className="h-8 text-[11px]"
      />
    );
  }

  return (
    <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-white p-2 dark:bg-stone-900">
      {opts.map((o) => {
        const active = cond.values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cn(
              "rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors",
              active
                ? "ov-soft ov-border-accent ov-text-accent"
                : "border-stone-200 text-stone-500 hover:border-stone-300 dark:border-stone-700 dark:text-stone-400",
            )}
            aria-pressed={active}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
