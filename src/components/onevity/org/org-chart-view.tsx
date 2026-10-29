"use client";
// OneVity — ORGANISASI › Bagan Organisasi: pure CSS/SVG-free org chart (4 levels)
// Level 1 CEO → Level 2 Management (pimpinan divisi/direksi) → Level 3 Divisi → Level 4 Sub-Unit
import { useMemo, useState } from "react";
import { useApi, initials, avatarColor } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingCards } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown, Landmark, Building2, Network, Users, Focus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgUnitNode, OrgTreeRes } from "./types";

// ---- minimal position shape consumed here (from /api/onevity/positions) ----
interface PosApiRow {
  id: string;
  code: string;
  title: string;
  active: boolean;
  orgUnitId: string | null;
  grade: { code: string } | null;
  employees: { id: string; fullName: string; employeeNo: string; status: string }[];
}
interface PositionsApiRes { positions: PosApiRow[]; total: number }

interface ChartPos {
  id: string;
  code: string;
  title: string;
  gradeCode: string | null;
  holderName: string | null;
  unitId: string | null;
}

function gradeRank(code: string | null | undefined): number {
  if (!code) return 0;
  const n = Number(code.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function activeHolder(p: PosApiRow): string | null {
  return p.employees.find((e) => e.status === "Active")?.fullName ?? null;
}

function flattenUnits(nodes: OrgUnitNode[], out: OrgUnitNode[] = []): OrgUnitNode[] {
  for (const n of nodes) { out.push(n); if (n.children?.length) flattenUnits(n.children, out); }
  return out;
}

export function OrgChartView() {
  const treeApi = useApi<OrgTreeRes>("/api/onevity/org-units?withChildren=1");
  const posApi = useApi<PositionsApiRes>("/api/onevity/positions?limit=300");
  const [focusId, setFocusId] = useState<string | null>(null);

  const tree = treeApi.data?.tree ?? [];
  const positions = useMemo(() => posApi.data?.positions ?? [], [posApi.data]);

  const model = useMemo(() => {
    const flat = flattenUnits(tree);
    const ceoUnit = flat.find((u) => u.level === 1) ?? null;
    const mgtUnit = flat.find((u) => u.level === 2) ?? null;
    const divisions = flat.filter((u) => u.level === 3);

    const sorted = [...positions].sort((a, b) => gradeRank(b.grade?.code) - gradeRank(a.grade?.code) || a.code.localeCompare(b.code));
    const ceoPos = ceoUnit ? sorted.find((p) => p.active && p.orgUnitId === ceoUnit.id) ?? null : null;
    const mgmtTier = sorted.filter((p) => p.active && gradeRank(p.grade?.code) >= 5 && (!ceoUnit || p.orgUnitId !== ceoUnit.id));

    const headOf = (unitId: string): PosApiRow | null => {
      const inUnit = sorted.filter((p) => p.active && p.orgUnitId === unitId);
      if (inUnit.length === 0) return null;
      return inUnit.find((p) => mgmtTier.some((m) => m.id === p.id)) ?? inUnit[0]!;
    };

    return { flat, ceoUnit, mgtUnit, divisions, ceoPos, mgmtTier, headOf };
  }, [tree, positions]);

  // highlighted set = ancestors + descendants of focused unit
  const highlight = useMemo(() => {
    const set = new Set<string>();
    if (!focusId) return set;
    const byId = new Map(model.flat.map((u) => [u.id, u]));
    let cur: OrgUnitNode | null = byId.get(focusId) ?? null;
    while (cur) { set.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) ?? null : null; }
    const addDesc = (u: OrgUnitNode) => { set.add(u.id); u.children?.forEach(addDesc); };
    byId.get(focusId)?.children?.forEach(addDesc);
    return set;
  }, [focusId, model.flat]);

  const toChartPos = (p: PosApiRow): ChartPos => ({
    id: p.id, code: p.code, title: p.title, gradeCode: p.grade?.code ?? null,
    holderName: activeHolder(p), unitId: p.orgUnitId,
  });

  const bandActive = focusId == null || highlight.has(model.mgtUnit?.id ?? "") || highlight.has(model.ceoUnit?.id ?? "");
  const totalFilled = positions.reduce((acc, p) => acc + (activeHolder(p) ? 1 : 0), 0);
  const loading = treeApi.loading || posApi.loading;

  const clickUnit = (id: string) => setFocusId((prev) => (prev === id ? null : id));

  return (
    <div>
      <PageHeader
        eyebrow="PERUSAHAAN & ORGANISASI"
        title="Bagan Organisasi"
        description="Struktur visual perusahaan — CEO, jajaran manajemen, divisi, hingga sub-unit. Klik kartu untuk menyorot jalurnya."
        actions={
          focusId ? (
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={() => setFocusId(null)}>
              <Focus className="h-3.5 w-3.5" /> Hapus Sorotan
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <LoadingCards cards={3} />
      ) : tree.length === 0 ? (
        <EmptyState title="Belum ada struktur organisasi" description="Buat unit organisasi terlebih dahulu pada menu Unit Organisasi." />
      ) : (
        <>
          {/* summary + legend */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-3 text-[11px] font-medium text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {model.divisions.length} divisi · {model.flat.length} unit</span>
            <span className="flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> {model.mgmtTier.length} pimpinan manajemen</span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {totalFilled} posisi terisi
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> {positions.length - totalFilled} lowong
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3.5 rounded-sm border-2 border-emerald-500" /> jalur aktif
            </span>
          </div>

          {/* ======== DESKTOP: horizontal-scroll org chart ======== */}
          <Card className="hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800 md:block">
            <CardContent className="overflow-x-auto p-6">
              <div className="mx-auto inline-flex min-w-max flex-col items-center">
                {/* L1: CEO */}
                {model.ceoUnit && (
                  <CEOCard
                    pos={model.ceoPos ? toChartPos(model.ceoPos) : null}
                    unitName={model.ceoUnit.name}
                    onClick={() => clickUnit(model.ceoUnit!.id)}
                  />
                )}
                <div className="h-8 w-px bg-slate-300 dark:bg-slate-700" />

                {/* L2: management band */}
                <div
                  className={cn(
                    "rounded-2xl border-2 px-5 pb-5 pt-3 transition-colors",
                    bandActive
                      ? "border-emerald-400/80 bg-emerald-50/50 dark:border-emerald-500/50 dark:bg-emerald-500/10"
                      : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40"
                  )}
                >
                  <p className={cn("mb-3 flex items-center justify-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em]", bandActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>
                    <Landmark className="h-3.5 w-3.5" /> Management
                  </p>
                  <div className="flex max-w-max flex-wrap justify-center gap-3">
                    {model.mgmtTier.map((p) => (
                      <MgmtCard key={p.id} pos={toChartPos(p)} highlighted={p.orgUnitId ? highlight.has(p.orgUnitId) : false} onClick={() => p.orgUnitId && clickUnit(p.orgUnitId)} />
                    ))}
                  </div>
                </div>
                <div className="h-8 w-px bg-slate-300 dark:bg-slate-700" />

                {/* L3+L4: divisions with sub-units */}
                <div className="flex items-start">
                  {model.divisions.map((d, i) => {
                    const first = i === 0;
                    const last = i === model.divisions.length - 1;
                    const single = model.divisions.length === 1;
                    const head = model.headOf(d.id);
                    return (
                      <div key={d.id} className="relative flex flex-col items-center px-3.5 pt-8">
                        {/* horizontal connector segment */}
                        <div
                          className={cn("absolute left-0 right-0 top-0 h-px bg-slate-300 dark:bg-slate-700", single ? "left-1/2 right-1/2" : first ? "left-1/2 right-0" : last ? "left-0 right-1/2" : "")}
                        />
                        {/* vertical stub down to card */}
                        <div className="absolute left-1/2 top-0 h-8 w-px -translate-x-1/2 bg-slate-300 dark:bg-slate-700" />
                        <DivisionCard unit={d} head={head ? toChartPos(head) : null} highlighted={highlight.has(d.id)} onClick={() => clickUnit(d.id)} />

                        {/* L4: sub-units */}
                        {(d.children?.length ?? 0) > 0 && (
                          <div className="mt-0 flex flex-col items-center">
                            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700" />
                            <div className="w-full space-y-1.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                              {d.children!.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => clickUnit(s.id)}
                                  className={cn(
                                    "flex w-full min-h-9 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition",
                                    highlight.has(s.id)
                                      ? "border-emerald-400 bg-white ring-1 ring-emerald-500/30 dark:bg-slate-900"
                                      : "border-slate-200/70 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-slate-700"
                                  )}
                                >
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <Network className="h-3 w-3 shrink-0 text-slate-400" />
                                    <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">{s.name}</span>
                                  </span>
                                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    {s._count?.employees ?? 0}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ======== MOBILE: stacked tree ======== */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800 md:hidden">
            <CardContent className="space-y-5 p-4 sm:p-5">
              {model.ceoUnit && (
                <div className="space-y-4">
                  <CEOCard pos={model.ceoPos ? toChartPos(model.ceoPos) : null} unitName={model.ceoUnit.name} onClick={() => clickUnit(model.ceoUnit!.id)} full />
                  <div className="flex justify-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              )}

              <div className={cn("rounded-2xl border-2 p-3.5", bandActive ? "border-emerald-400/80 bg-emerald-50/50 dark:border-emerald-500/50 dark:bg-emerald-500/10" : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40")}>
                <p className={cn("mb-2.5 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em]", bandActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>
                  <Landmark className="h-3.5 w-3.5" /> Management
                </p>
                <div className="space-y-2">
                  {model.mgmtTier.map((p) => (
                    <MgmtCard key={p.id} pos={toChartPos(p)} highlighted={p.orgUnitId ? highlight.has(p.orgUnitId) : false} onClick={() => p.orgUnitId && clickUnit(p.orgUnitId)} full />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {model.divisions.map((d) => {
                  const head = model.headOf(d.id);
                  return (
                    <div key={d.id} className="space-y-2">
                      <DivisionCard unit={d} head={head ? toChartPos(head) : null} highlighted={highlight.has(d.id)} onClick={() => clickUnit(d.id)} full />
                      {(d.children?.length ?? 0) > 0 && (
                        <div className="ml-3 space-y-1.5 border-l-2 border-slate-200 pl-3 dark:border-slate-800">
                          {d.children!.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => clickUnit(s.id)}
                              className={cn(
                                "flex w-full min-h-9 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition",
                                highlight.has(s.id)
                                  ? "border-emerald-400 bg-white ring-1 ring-emerald-500/30 dark:bg-slate-900"
                                  : "border-slate-200/70 bg-slate-50/70 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/50"
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <Network className="h-3 w-3 shrink-0 text-slate-400" />
                                <span className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">{s.name}</span>
                              </span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {s._count?.employees ?? 0}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ============ node cards ============

function HolderLine({ name }: { name: string | null }) {
  if (!name) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Lowong
      </p>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold", avatarColor(name))}>{initials(name)}</span>
      <p className="truncate text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{name}</p>
    </div>
  );
}

function CEOCard({ pos, unitName, onClick, full }: { pos: ChartPos | null; unitName: string; onClick: () => void; full?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group rounded-2xl border-2 border-emerald-600 bg-white p-4 text-left shadow-md shadow-emerald-900/10 transition hover:shadow-lg dark:bg-slate-900 dark:shadow-emerald-500/10",
        full ? "w-full" : "w-64"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow">
          <Crown className="h-4.5 w-4.5" />
        </span>
        {pos?.gradeCode && <Badge variant="outline" className="font-mono text-[9px] text-emerald-700 dark:text-emerald-400">{pos.gradeCode}</Badge>}
      </div>
      <p className="mt-2.5 text-sm font-extrabold leading-tight text-slate-900 dark:text-slate-50">{pos?.title ?? "Chief Executive Officer"}</p>
      <div className="mt-1.5"><HolderLine name={pos?.holderName ?? null} /></div>
      <p className="mt-1.5 truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">{unitName}</p>
    </button>
  );
}

function MgmtCard({ pos, highlighted, onClick, full }: { pos: ChartPos; highlighted: boolean; onClick: () => void; full?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-white p-3.5 text-left shadow-sm transition hover:shadow-md dark:bg-slate-900",
        highlighted
          ? "border-emerald-500 ring-2 ring-emerald-500/20"
          : "border-slate-200/80 hover:border-slate-300 dark:border-slate-800",
        full ? "w-full" : "w-52"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
          <Landmark className="h-3.5 w-3.5" />
        </span>
        {pos.gradeCode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{pos.gradeCode}</span>}
      </div>
      <p className="mt-2 text-[12.5px] font-bold leading-tight text-slate-900 dark:text-slate-100">{pos.title}</p>
      <div className="mt-1.5"><HolderLine name={pos.holderName} /></div>
    </button>
  );
}

function DivisionCard({ unit, head, highlighted, onClick, full }: {
  unit: OrgUnitNode;
  head: ChartPos | null;
  highlighted: boolean;
  onClick: () => void;
  full?: boolean;
}) {
  const actual = unit._count?.employees ?? 0;
  const over = unit.headcountBudget > 0 && actual > unit.headcountBudget;
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-white p-3.5 text-left shadow-sm transition hover:shadow-md dark:bg-slate-900",
        highlighted
          ? "border-emerald-500 ring-2 ring-emerald-500/20"
          : "border-slate-200/80 hover:border-slate-300 dark:border-slate-800",
        full ? "w-full" : "w-56"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
          <Building2 className="h-3.5 w-3.5" />
        </span>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[9px] font-bold",
          over ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
        )}>
          {actual}/{unit.headcountBudget || "—"}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] font-bold leading-tight text-slate-900 dark:text-slate-100">{unit.name}</p>
      {head ? (
        <div className="mt-1.5">
          <p className="truncate text-[10px] font-medium text-slate-400">{head.title}</p>
          <HolderLine name={head.holderName} />
        </div>
      ) : (
        <p className="mt-1.5 text-[10px] text-slate-400 italic">Belum ada kepala unit</p>
      )}
    </button>
  );
}
