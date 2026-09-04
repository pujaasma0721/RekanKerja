"use client";
// OneVity — PETA ORGANISASI: comprehensive org explorer
// Menggabungkan: karyawan (orang), posisi/jabatan, unit organisasi, lowongan,
// biaya gaji, garis pelaporan & data 360° dalam satu peta interaktif.
// Mode "Orang" = pohon pelaporan manajer→bawahan + kartu lowongan (posisi kosong).
// Mode "Unit" = pohon unit organisasi dengan agregat SDM & biaya.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi, fmtIDR, fmtIDRShort, fmtDate, tenure, initials, avatarColor, genderLabel, paTypeLabelSafe } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, EmptyState, StatusPill, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { levelLabel, levelLabelEn } from "./types";
import {
  Users, Building2, Search, X, UnfoldVertical, FoldVertical, ZoomIn, ZoomOut, Maximize2,
  UserPlus, Star, Wallet, GitFork, Network, Landmark, Crown, ChevronRight, ChevronDown,
  Clock3, GraduationCap, Briefcase, BriefcaseBusiness, RefreshCw, MapPin, Building, Layers,
} from "lucide-react";

// ============ types ============
interface MapPerson {
  id: string; employeeNo: string; fullName: string; gender: string; status: string;
  employmentStatus: string; joinDate: string; baseSalary: number;
  positionId: string | null; positionCode: string | null; positionTitle: string | null;
  gradeCode: string | null; unitId: string | null; unitName: string | null; managerId: string | null;
  disciplinaryCount: number; activeActionsCount: number;
}
interface MapVacancy {
  id: string; positionId: string; code: string; title: string; gradeCode: string | null;
  unitId: string | null; unitName: string | null; slots: number;
  reportsToId: string | null; reportsToTitle: string | null;
}
interface MapUnit {
  id: string; code: string; name: string; parentId: string | null;
  level: number; headcountBudget: number; headId: string | null;
}
interface MapPosition {
  id: string; code: string; title: string; gradeCode: string | null;
  unitId: string | null; unitName: string | null; headcount: number; filled: number;
  reportsToTitle: string | null;
}
interface OrgMapRes {
  company: { id: string; code: string; name: string; shortName: string | null } | null;
  stats: {
    activeEmployees: number; totalEmployees: number; probation: number; contract: number;
    units: number; positions: number; totalSlots: number; filledPositions: number;
    vacancies: number; monthlyCost: number; avgSpan: number;
  };
  people: MapPerson[];
  positions: MapPosition[];
  units: MapUnit[];
  vacancies: MapVacancy[];
}
interface UnitAgg { total: number; direct: number; cost: number; vac: number; positions: number }

interface DetailEmp {
  id: string; employeeNo: string; fullName: string; gender: string;
  birthPlace: string | null; birthDate: string | null; nationalId: string | null; taxId: string | null;
  bpjsHealth: string | null; bpjsEmpSkill: string | null; maritalStatus: string | null; religion: string | null;
  bloodType: string | null; email: string | null; phone: string | null; address: string | null; city: string | null;
  bankName: string | null; bankAccount: string | null;
  employmentStatus: string; joinDate: string; baseSalary: number; workShift: string; status: string;
  orgUnit: { name: string } | null;
  position: { title: string; code: string; level: string | null } | null;
  grade: { code: string; name: string; minSalary: number; maxSalary: number } | null;
  manager: { id: string; fullName: string; employeeNo: string; position: { title: string } | null } | null;
  directReports: { id: string; fullName: string; employeeNo: string; position: { title: string } | null }[];
  education: { id: string; level: string; institution: string; major: string | null; startYear: number | null; endYear: number | null; gpa: number | null }[];
  experiences: { id: string; company: string; position: string; startDate: string | null; endDate: string | null }[];
  disciplinary: { id: string; warningLevel: string; violation: string; sanction: string | null; issuedAt: string; expiresAt: string | null; notes: string | null }[];
  actions: { id: string; docNo: string; type: string; status: string; effectiveDate: string }[];
}
interface DetailRes { employee: DetailEmp }

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const EMP_LABEL: Record<string, string> = { Permanent: "Tetap", Probation: "Percobaan", Contract: "Kontrak", Outsourcing: "Outsourcing" };
const empLabel = (s: string) => EMP_LABEL[s] ?? s;
const EMP_LABEL_EN: Record<string, string> = { Permanent: "Permanent", Probation: "Probation", Contract: "Contract", Outsourcing: "Outsourcing" };
const empLabelEn = (s: string) => EMP_LABEL_EN[s] ?? s;
const STATUS_DOT: Record<string, string> = {
  Probation: "bg-amber-400",
  Contract: "bg-teal-400",
  Outsourcing: "bg-orange-400",
  Permanent: "bg-emerald-500",
};
const LINE = "bg-stone-300 dark:bg-stone-700";
const DEFAULT_DEPTH = 1; // kedalaman default terbuka (0 = akar)

// ============ MAIN ============
export function OrgMapView() {
  const { t } = useI18n();
  const api = useApi<OrgMapRes>("/api/onevity/org-map");
  const { navigate } = useNav();
  const [mode, setMode] = useState<"orang" | "unit">("orang");
  const [query, setQuery] = useState("");
  const [expandAll, setExpandAll] = useState(false);
  const [override, setOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [selected, setSelected] = useState<{ type: "person" | "unit"; id: string } | null>(null);
  const [tf, setTf] = useState({ x: 0, y: 24, k: 1 });
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const data = api.data;

  // ---------- model indices ----------
  const model = useMemo(() => {
    if (!data) return null;
    const peopleById = new Map(data.people.map((p) => [p.id, p]));
    const childrenOf = new Map<string, MapPerson[]>();
    const roots: MapPerson[] = [];
    for (const p of data.people) {
      const m = p.managerId ? peopleById.get(p.managerId) : undefined;
      if (m) {
        const arr = childrenOf.get(m.id) ?? [];
        arr.push(p);
        childrenOf.set(m.id, arr);
      } else roots.push(p);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
    roots.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

    // vacancy ghosts menempel pada pemegang posisi induknya
    const personByPosition = new Map<string, MapPerson>();
    for (const p of data.people) if (p.positionId) personByPosition.set(p.positionId, p);
    const vacancyByParent = new Map<string, MapVacancy[]>();
    const orphanVacs: MapVacancy[] = [];
    for (const v of data.vacancies) {
      const holder = v.reportsToId ? personByPosition.get(v.reportsToId) : undefined;
      if (holder) {
        const arr = vacancyByParent.get(holder.id) ?? [];
        arr.push(v);
        vacancyByParent.set(holder.id, arr);
      } else orphanVacs.push(v);
    }

    // unit maps
    const unitById = new Map(data.units.map((u) => [u.id, u]));
    const unitChildren = new Map<string, MapUnit[]>();
    const unitRoots: MapUnit[] = [];
    for (const u of data.units) {
      const parent = u.parentId ? unitById.get(u.parentId) : undefined;
      if (parent) {
        const arr = unitChildren.get(parent.id) ?? [];
        arr.push(u);
        unitChildren.set(parent.id, arr);
      } else unitRoots.push(u);
    }
    const unitMembers = new Map<string, MapPerson[]>();
    for (const p of data.people) {
      if (!p.unitId) continue;
      const arr = unitMembers.get(p.unitId) ?? [];
      arr.push(p);
      unitMembers.set(p.unitId, arr);
    }
    const unitVac = new Map<string, MapVacancy[]>();
    for (const v of data.vacancies) {
      if (!v.unitId) continue;
      const arr = unitVac.get(v.unitId) ?? [];
      arr.push(v);
      unitVac.set(v.unitId, arr);
    }
    const unitPositions = new Map<string, MapPosition[]>();
    for (const p of data.positions) {
      if (!p.unitId) continue;
      const arr = unitPositions.get(p.unitId) ?? [];
      arr.push(p);
      unitPositions.set(p.unitId, arr);
    }
    const headIds = new Set(data.units.map((u) => u.headId).filter((x): x is string => !!x));

    // agregat unit rekursif (subtree)
    const aggMemo = new Map<string, UnitAgg>();
    const unitAgg = (id: string): UnitAgg => {
      const memo = aggMemo.get(id);
      if (memo) return memo;
      const members = unitMembers.get(id) ?? [];
      const vacs = unitVac.get(id) ?? [];
      const agg: UnitAgg = {
        total: members.length,
        direct: members.length,
        cost: members.reduce((a, p) => a + p.baseSalary, 0),
        vac: vacs.reduce((a, v) => a + v.slots, 0),
        positions: (unitPositions.get(id) ?? []).length,
      };
      for (const c of unitChildren.get(id) ?? []) {
        const ca = unitAgg(c.id);
        agg.total += ca.total;
        agg.cost += ca.cost;
        agg.vac += ca.vac;
        agg.positions += ca.positions;
      }
      aggMemo.set(id, agg);
      return agg;
    };

    // pencarian
    const q = query.trim().toLowerCase();
    const searchOn = q.length > 0;
    const matchPersonIds = new Set<string>();
    if (searchOn) {
      for (const p of data.people) {
        const hay = `${p.fullName} ${p.employeeNo} ${p.positionTitle ?? ""} ${p.unitName ?? ""} ${p.gradeCode ?? ""} ${p.positionCode ?? ""}`.toLowerCase();
        if (hay.includes(q)) matchPersonIds.add(p.id);
      }
    }
    const matchAncestors = new Set<string>();
    for (const id of matchPersonIds) {
      let cur = peopleById.get(id)?.managerId ? peopleById.get(peopleById.get(id)!.managerId!) ?? null : null;
      let guard = 0;
      while (cur && guard < 24) {
        matchAncestors.add(cur.id);
        cur = cur.managerId ? (peopleById.get(cur.managerId) ?? null) : null;
        guard++;
      }
    }
    const matchUnitIds = new Set<string>();
    if (searchOn) {
      for (const u of data.units) {
        const hay = `${u.name} ${u.code}`.toLowerCase();
        if (hay.includes(q)) matchUnitIds.add(u.id);
        else if ((unitMembers.get(u.id) ?? []).some((m) => matchPersonIds.has(m.id))) matchUnitIds.add(u.id);
      }
    }
    const unitAncestors = new Set<string>();
    for (const id of matchUnitIds) {
      let cur = unitById.get(id)?.parentId ? unitById.get(unitById.get(id)!.parentId!) ?? null : null;
      let guard = 0;
      while (cur && guard < 24) {
        unitAncestors.add(cur.id);
        cur = cur.parentId ? (unitById.get(cur.parentId) ?? null) : null;
        guard++;
      }
    }

    return {
      peopleById, childrenOf, roots, vacancyByParent, orphanVacs,
      unitById, unitChildren, unitRoots, unitMembers, unitVac, unitPositions, headIds, unitAgg,
      searchOn, matchPersonIds, matchAncestors, matchUnitIds, unitAncestors,
    };
  }, [data, query]);

  // ---------- expansion ----------
  const isExpandedP = useCallback((id: string, depth: number, hasKids: boolean) => {
    if (!hasKids) return false;
    const base = override.get(id) ?? (expandAll ? true : depth <= DEFAULT_DEPTH);
    if (model?.searchOn) return model.matchAncestors.has(id) || model.matchPersonIds.has(id) ? true : base;
    return base;
  }, [override, expandAll, model]);

  const isExpandedU = useCallback((id: string, depth: number, hasKids: boolean) => {
    if (!hasKids) return false;
    const base = override.get(id) ?? (expandAll ? true : depth <= DEFAULT_DEPTH);
    if (model?.searchOn) return model.unitAncestors.has(id) || model.matchUnitIds.has(id) ? true : base;
    return base;
  }, [override, expandAll, model]);

  const toggle = useCallback((id: string, depth: number, hasKids: boolean, isExpanded: (id: string, depth: number, hasKids: boolean) => boolean) => {
    if (!hasKids) return;
    const cur = isExpanded(id, depth, hasKids);
    setOverride((prev) => {
      const m = new Map(prev);
      m.set(id, !cur);
      return m;
    });
  }, []);

  const expandAllAction = () => { setExpandAll(true); setOverride(new Map()); };
  const collapseAllAction = () => {
    setExpandAll(false);
    if (!model) return;
    const m = new Map<string, boolean>();
    for (const id of model.childrenOf.keys()) m.set(id, false);
    for (const id of model.unitChildren.keys()) m.set(id, false);
    setOverride(m);
  };

  // ---------- pan & zoom ----------
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const mx = cx ?? (rect ? rect.width / 2 : 0);
    const my = cy ?? (rect ? rect.height / 2 : 0);
    setTf((prev) => {
      const k = clamp(prev.k * factor, 0.2, 2.5);
      const x = mx - ((mx - prev.x) * k) / prev.k;
      const y = my - ((my - prev.y) * k) / prev.k;
      return { x, y, k };
    });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const content = contentRef.current;
    if (!wrap || !content) return;
    const bw = content.scrollWidth;
    const bh = content.scrollHeight;
    if (!bw || !bh) return;
    const k = clamp(Math.min(wrap.clientWidth / (bw + 96), wrap.clientHeight / (bh + 48)), 0.2, 1.1);
    setTf({ k, x: (wrap.clientWidth - bw * k) / 2, y: Math.max(20, (wrap.clientHeight - bh * k) * 0.08) });
  }, []);

  useEffect(() => {
    if (!data) return;
    const r = requestAnimationFrame(() => fit());
    return () => cancelAnimationFrame(r);
  }, [data, mode, fit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Jangan pegang pointer bila target elemen interaktif (kartu/tombol) —
    // agar click native tetap bekerja (drawer, toggle) dan tidak tertelan pointer capture.
    if ((e.target as HTMLElement).closest("button, [role='button'], input, a, [data-nodrag]")) return;
    wrapRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: tf.x, oy: tf.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setTf((t) => ({ ...t, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    if (wrapRef.current?.hasPointerCapture(e.pointerId)) wrapRef.current.releasePointerCapture(e.pointerId);
  };

  const openPerson = useCallback((id: string) => setSelected({ type: "person", id }), []);
  const openUnit = useCallback((id: string) => setSelected({ type: "unit", id }), []);

  const matchesCount = model?.searchOn ? model.matchPersonIds.size + model.matchUnitIds.size : 0;

  // ---------- render ----------
  if (api.loading && !data) {
    return (
      <div>
        <PageHeader eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")} title={t("Peta Organisasi")} />
        <LoadingRows rows={8} />
      </div>
    );
  }
  if (api.error || !data || data.people.length === 0) {
    return (
      <div>
        <PageHeader eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")} title={t("Peta Organisasi")} description={t("Peta lengkap orang, posisi, unit, dan lowongan dalam satu tampilan.", "A complete map of people, positions, units, and vacancies in one view.")} />
        <EmptyState
          title={t("Belum ada data untuk dipetakan", "No data to map yet")}
          description={api.error ? t("Gagal memuat: {e}", "Failed to load: {e}", { e: api.error }) : t("Tambahkan karyawan aktif dan struktur unit terlebih dahulu.", "Add active employees and the unit structure first.")}
        />
      </div>
    );
  }
  if (!model) return null;

  return (
    <div>
      <PageHeader
        eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")}
        title={t("Peta Organisasi")}
        description={t("Satu peta untuk seluruh organisasi — orang, jabatan, unit, lowongan, hingga biaya gaji. Klik kartu untuk profil 360°, gulir untuk zoom, dan geser kanvas untuk menjelajah.", "One map for the entire organization — people, jobs, units, vacancies, and payroll cost. Click a card for the 360° profile, scroll to zoom, and drag the canvas to explore.")}
        actions={
          <div className="flex items-center gap-2">
            {model.searchOn && (
              <span className="rounded-full border ov-border-accent ov-soft px-2.5 py-1 text-[11px] font-bold">
                {t("{n} hasil", "{n} results", { n: matchesCount })}
              </span>
            )}
            <Button variant="outline" size="sm" className="h-9 gap-1.5 px-3" onClick={api.refresh} disabled={api.loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", api.loading && "animate-spin")} /> {t("Muat Ulang")}
            </Button>
          </div>
        }
      />

      {/* ====== KPI strip ====== */}
      <StatsStrip stats={data.stats} />

      {/* ====== explorer card ====== */}
      <Card className="mt-4 overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200/80 p-3 dark:border-stone-800">
          <div className="flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 dark:border-stone-800 dark:bg-stone-900" role="group" aria-label={t("Mode tampilan", "View mode")}>
            <button
              type="button"
              onClick={() => setMode("orang")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11.5px] font-semibold transition",
                mode === "orang" ? "ov-fill shadow-sm" : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              )}
            >
              <Users className="h-3.5 w-3.5" /> {t("Orang", "People")}
            </button>
            <button
              type="button"
              onClick={() => setMode("unit")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11.5px] font-semibold transition",
                mode === "unit" ? "ov-fill shadow-sm" : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              )}
            >
              <Building2 className="h-3.5 w-3.5" /> {t("Unit", "Units")}
            </button>
          </div>

          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Cari nama, jabatan, unit, grade…", "Search by name, job title, unit, grade…")}
              className="h-9 rounded-lg pl-8 pr-8 text-[12.5px]"
              aria-label={t("Cari pada peta", "Search the chart")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
                aria-label={t("Hapus pencarian", "Clear search")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-[11.5px]" onClick={expandAllAction} title={t("Buka semua cabang", "Expand all branches")}>
              <UnfoldVertical className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("Perluas Semua", "Expand All")}</span>
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-[11.5px]" onClick={collapseAllAction} title={t("Tutup semua cabang", "Collapse all branches")}>
              <FoldVertical className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("Tutup Semua", "Collapse All")}</span>
            </Button>
          </div>
        </div>

        {/* ====== desktop: interactive canvas ====== */}
        <div
          ref={wrapRef}
          className={cn(
            "relative hidden h-[620px] touch-none select-none overflow-hidden md:block",
            dragging ? "cursor-grabbing" : "cursor-grab",
            "bg-stone-50 [background-image:radial-gradient(circle,#d6d3d1_1px,transparent_1px)] [background-size:24px_24px] dark:bg-stone-950/60 dark:[background-image:radial-gradient(circle,#292524_1px,transparent_1px)]"
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            ref={contentRef}
            className="absolute left-0 top-0 w-max origin-top-left pb-10 will-change-transform"
            style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})` }}
          >
            {mode === "orang" ? (
              <div className="flex items-start gap-12 px-10">
                {model.roots.map((p) => (
                  <PersonColumn key={p.id} p={p} depth={0} model={model} isExpanded={isExpandedP} toggle={toggle} openPerson={openPerson} />
                ))}
                {model.orphanVacs.length > 0 && <OrphanVacancies vacs={model.orphanVacs} />}
              </div>
            ) : (
              <div className="flex items-start gap-10 px-10">
                {model.unitRoots.map((u) => (
                  <UnitColumn key={u.id} u={u} depth={0} model={model} isExpanded={isExpandedU} toggle={toggle} openUnit={openUnit} />
                ))}
              </div>
            )}
          </div>

          {/* zoom controls */}
          <div className="absolute bottom-3 right-3 flex flex-col items-center gap-1 rounded-xl border border-stone-200 bg-white/90 p-1 shadow-md backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
            <button type="button" onClick={() => zoomAt(1.25)} title={t("Perbesar", "Zoom in")} aria-label={t("Perbesar", "Zoom in")} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => zoomAt(0.8)} title={t("Perkecil", "Zoom out")} aria-label={t("Perkecil", "Zoom out")} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button type="button" onClick={fit} title={t("Sesuaikan tampilan", "Fit to view")} aria-label={t("Sesuaikan tampilan", "Fit to view")} className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
              <Maximize2 className="h-4 w-4" />
            </button>
            <span className="px-1 pb-0.5 text-[9px] font-bold tabular-nums text-stone-400">{Math.round(tf.k * 100)}%</span>
          </div>

          {/* legend */}
          <div className="absolute left-3 top-3 hidden rounded-xl border border-stone-200 bg-white/90 px-2.5 py-2 shadow-sm backdrop-blur dark:border-stone-800 dark:bg-stone-900/90 lg:block">
            <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Legenda", "Legend")}</p>
            <div className="space-y-1 text-[10px] font-medium text-stone-600 dark:text-stone-300">
              <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {t("Karyawan tetap", "Permanent employee")}</p>
              <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> {t("Percobaan", "Probation")}</p>
              <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal-400" /> {t("Kontrak", "Contract")}</p>
              <p className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded border-2 border-dashed border-amber-400" /> {t("Posisi lowong", "Vacant position")}</p>
              <p className="flex items-center gap-1.5"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> {t("Kepala unit", "Unit head")}</p>
            </div>
          </div>
        </div>

        {/* ====== mobile: stacked tree ====== */}
        <div className="max-h-[68vh] space-y-1.5 overflow-y-auto p-3 md:hidden">
          {mode === "orang" ? (
            model.roots.map((p) => <MobilePersonItem key={p.id} p={p} depth={0} model={model} isExpanded={isExpandedP} toggle={toggle} openPerson={openPerson} />)
          ) : (
            model.unitRoots.map((u) => <MobileUnitItem key={u.id} u={u} depth={0} model={model} isExpanded={isExpandedU} toggle={toggle} openUnit={openUnit} />)
          )}
        </div>
      </Card>

      {/* ====== drawers ====== */}
      <PersonDrawer
        personId={selected?.type === "person" ? selected.id : null}
        model={model}
        onClose={() => setSelected(null)}
        onSelectPerson={openPerson}
        onOpenDirectory={(id) => navigate("employee", "directory", { id })}
      />
      <UnitDrawer
        unitId={selected?.type === "unit" ? selected.id : null}
        model={model}
        onClose={() => setSelected(null)}
        onSelectPerson={(id) => setSelected({ type: "person", id })}
      />
    </div>
  );
}

// ============ KPI strip ============
function StatsStrip({ stats }: { stats: OrgMapRes["stats"] }) {
  const { t } = useI18n();
  const items = [
    { icon: Users, label: t("Karyawan Aktif", "Active Employees"), value: String(stats.activeEmployees), sub: t("{n} total · {m} percobaan", "{n} total · {m} probation", { n: stats.totalEmployees, m: stats.probation }) },
    { icon: Network, label: t("Unit Organisasi"), value: String(stats.units), sub: t("{n} posisi aktif", "{n} active positions", { n: stats.positions }) },
    { icon: BriefcaseBusiness, label: t("Slot Terisi", "Filled Slots"), value: `${stats.filledPositions}/${stats.totalSlots}`, sub: t("headcount terisi", "filled headcount") },
    { icon: UserPlus, label: t("Lowongan", "Vacancies"), value: String(stats.vacancies), sub: t("slot belum terisi", "open slots") },
    { icon: Wallet, label: t("Biaya Gaji / Bulan", "Monthly Salary Cost"), value: fmtIDRShort(stats.monthlyCost), sub: t("gaji pokok aktif", "active base salaries") },
    { icon: GitFork, label: t("Rata-rata Span", "Average Span"), value: String(stats.avgSpan), sub: t("bawahan per atasan", "subordinates per manager") },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-200/70 shadow-sm dark:border-stone-800 dark:bg-stone-800 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="bg-white p-3 dark:bg-stone-900">
          <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-400">
            <it.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{it.label}</span>
          </div>
          <p className="mt-1 truncate text-lg font-extrabold tracking-tight text-stone-900 dark:text-stone-50">{it.value}</p>
          <p className="truncate text-[9.5px] text-stone-400">{it.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ============ shared model type for children ============
interface Model {
  peopleById: Map<string, MapPerson>;
  childrenOf: Map<string, MapPerson[]>;
  roots: MapPerson[];
  vacancyByParent: Map<string, MapVacancy[]>;
  orphanVacs: MapVacancy[];
  unitById: Map<string, MapUnit>;
  unitChildren: Map<string, MapUnit[]>;
  unitRoots: MapUnit[];
  unitMembers: Map<string, MapPerson[]>;
  unitVac: Map<string, MapVacancy[]>;
  unitPositions: Map<string, MapPosition[]>;
  headIds: Set<string>;
  unitAgg: (id: string) => UnitAgg;
  searchOn: boolean;
  matchPersonIds: Set<string>;
  matchAncestors: Set<string>;
  matchUnitIds: Set<string>;
  unitAncestors: Set<string>;
}

type IsExpandedFn = (id: string, depth: number, hasKids: boolean) => boolean;
type ToggleFn = (id: string, depth: number, hasKids: boolean, isExpanded: IsExpandedFn) => void;

// ============ PEOPLE TREE (desktop) ============
function PersonColumn({
  p, depth, model, isExpanded, toggle, openPerson,
}: {
  p: MapPerson; depth: number; model: Model; isExpanded: IsExpandedFn; toggle: ToggleFn; openPerson: (id: string) => void;
}) {
  const kids = model.childrenOf.get(p.id) ?? [];
  const vacs = model.vacancyByParent.get(p.id) ?? [];
  const total = kids.length + vacs.length;
  const expanded = isExpanded(p.id, depth, total > 0);
  const matched = model.matchPersonIds.has(p.id);
  const dimmed = model.searchOn && !matched && !model.matchAncestors.has(p.id);
  const isHead = model.headIds.has(p.id);

  const nodes: ({ kind: "person"; k: MapPerson } | { kind: "vac"; v: MapVacancy })[] = [
    ...kids.map((k) => ({ kind: "person" as const, k })),
    ...vacs.map((v) => ({ kind: "vac" as const, v })),
  ];

  return (
    <div className="flex flex-col items-center">
      <PersonCard p={p} depth={depth} reportCount={kids.length} vacCount={vacs.length} expanded={expanded} matched={matched} dimmed={dimmed} isHead={isHead} onOpen={() => openPerson(p.id)} onToggle={() => toggle(p.id, depth, total > 0, isExpanded)} />

      {total > 0 && expanded && (
        <>
          <div className={cn("h-7 w-px", LINE)} />
          <div className="relative flex items-start">
            {nodes.map((n, i) => {
              const first = i === 0;
              const last = i === nodes.length - 1;
              return (
                <div key={n.kind === "person" ? n.k.id : n.v.id} className="relative flex flex-col items-center px-3.5 pt-7">
                  <div className={cn("absolute top-0 h-px", LINE)} style={{ left: first ? "50%" : "0", right: last ? "50%" : "0" }} />
                  <div className={cn("absolute left-1/2 top-0 h-7 w-px -translate-x-1/2", LINE)} />
                  {n.kind === "person" ? (
                    <PersonColumn p={n.k} depth={depth + 1} model={model} isExpanded={isExpanded} toggle={toggle} openPerson={openPerson} />
                  ) : (
                    <VacancyCard v={n.v} dimmed={model.searchOn} />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PersonCard({
  p, depth, reportCount, vacCount, expanded, matched, dimmed, isHead, onOpen, onToggle,
}: {
  p: MapPerson; depth: number; reportCount: number; vacCount: number; expanded: boolean; matched: boolean; dimmed: boolean; isHead: boolean;
  onOpen: () => void; onToggle: () => void;
}) {
  const { t } = useI18n();
  const root = depth === 0;
  const total = reportCount + vacCount;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cn(
        "relative w-60 cursor-pointer rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        root
          ? "ov-border-accent ov-soft shadow-md"
          : "border-stone-200 bg-white shadow-sm hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700",
        matched && "ring-2 ring-ring",
        dimmed && "opacity-40 saturate-50"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="relative flex shrink-0">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-extrabold", avatarColor(p.fullName), root && "ring-2 ring-ring/40")}>
            {initials(p.fullName)}
          </span>
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-stone-900", STATUS_DOT[p.employmentStatus] ?? "bg-emerald-500")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {root && <Crown className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />}
            <p className="truncate text-[12.5px] font-bold text-stone-900 dark:text-stone-100">{p.fullName}</p>
            {isHead && !root && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
          </div>
          <p className="truncate text-[10.5px] font-medium text-stone-500 dark:text-stone-400">{p.positionTitle ?? t("Tanpa jabatan", "No job title")}</p>
          <p className="mt-0.5 truncate text-[9.5px] text-stone-400 dark:text-stone-500">{p.employeeNo} · {p.unitName ?? "—"}</p>
        </div>
        {p.gradeCode && (
          <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-stone-500 dark:bg-stone-800 dark:text-stone-400">{p.gradeCode}</span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-stone-200 pt-2 dark:border-stone-800">
        <span className="flex items-center gap-1 text-[10px] text-stone-400 dark:text-stone-500">
          <Clock3 className="h-3 w-3" /> {tenure(p.joinDate)}
        </span>
        <span className="flex items-center gap-1">
          {p.employmentStatus !== "Permanent" && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
              p.employmentStatus === "Probation" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"
            )}>
              {t(empLabel(p.employmentStatus), empLabelEn(p.employmentStatus))}
            </span>
          )}
          {total > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              title={expanded ? t("Tutup cabang", "Collapse branch") : t("Buka cabang", "Expand branch")}
              className="flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[9.5px] font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
            >
              <Users className="h-2.5 w-2.5" />
              {total}
              {vacCount > 0 && <span className="text-amber-500">+{vacCount}</span>}
              <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function VacancyCard({ v, dimmed }: { v: MapVacancy; dimmed: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn("w-60 rounded-xl border-2 border-dashed border-amber-300/90 bg-amber-50/60 p-3 dark:border-amber-500/40 dark:bg-amber-500/5", dimmed && "opacity-40 saturate-50")}>
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-amber-400 text-amber-600 dark:text-amber-400">
          <UserPlus className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-amber-700 dark:text-amber-400">{t("Lowong · {n} slot", "Vacant · {n} slots", { n: v.slots })}</p>
          <p className="truncate text-[10.5px] font-medium text-stone-600 dark:text-stone-300">{v.title}</p>
          <p className="truncate text-[9.5px] text-stone-400">{v.unitName ?? "—"}{v.reportsToTitle ? t(" · bawahan {r}", " · reports to {r}", { r: v.reportsToTitle }) : ""}</p>
        </div>
        {v.gradeCode && (
          <span className="shrink-0 rounded-md bg-amber-100/80 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">{v.gradeCode}</span>
        )}
      </div>
    </div>
  );
}

function OrphanVacancies({ vacs }: { vacs: MapVacancy[] }) {
  const { t } = useI18n();
  return (
    <div className="flex max-w-[280px] flex-col gap-2 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-500/40 dark:bg-amber-500/5">
      <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <UserPlus className="h-3.5 w-3.5" /> {t("Lowongan Terpisah ({n})", "Unattached Vacancies ({n})", { n: vacs.length })}
      </p>
      <div className="space-y-2">
        {vacs.slice(0, 5).map((v) => (
          <VacancyCard key={v.id} v={v} dimmed={false} />
        ))}
      </div>
      {vacs.length > 5 && <p className="text-[10px] font-medium text-stone-400">{t("+{n} lowongan lainnya", "+{n} more vacancies", { n: vacs.length - 5 })}</p>}
    </div>
  );
}

// ============ UNIT TREE (desktop) ============
function UnitColumn({
  u, depth, model, isExpanded, toggle, openUnit,
}: {
  u: MapUnit; depth: number; model: Model; isExpanded: IsExpandedFn; toggle: ToggleFn; openUnit: (id: string) => void;
}) {
  const kids = model.unitChildren.get(u.id) ?? [];
  const expanded = isExpanded(u.id, depth, kids.length > 0);
  return (
    <div className="flex flex-col items-center">
      <UnitCard u={u} model={model} depth={depth} expanded={expanded} subCount={kids.length} onOpen={() => openUnit(u.id)} onToggle={() => toggle(u.id, depth, kids.length > 0, isExpanded)} />

      {kids.length > 0 && expanded && (
        <>
          <div className={cn("h-7 w-px", LINE)} />
          <div className="relative flex items-start">
            {kids.map((k, i) => {
              const first = i === 0;
              const last = i === kids.length - 1;
              return (
                <div key={k.id} className="relative flex flex-col items-center px-3.5 pt-7">
                  <div className={cn("absolute top-0 h-px", LINE)} style={{ left: first ? "50%" : "0", right: last ? "50%" : "0" }} />
                  <div className={cn("absolute left-1/2 top-0 h-7 w-px -translate-x-1/2", LINE)} />
                  <UnitColumn u={k} depth={depth + 1} model={model} isExpanded={isExpanded} toggle={toggle} openUnit={openUnit} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const LEVEL_STYLE: Record<number, { icon: typeof Building; box: string }> = {
  1: { icon: Crown, box: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  2: { icon: Landmark, box: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  3: { icon: Building, box: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400" },
  4: { icon: Network, box: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300" },
};

function UnitLevelIcon({ level, className }: { level: number; className?: string }) {
  const Icon = (LEVEL_STYLE[level] ?? LEVEL_STYLE[4]!).icon;
  return <Icon className={className ?? "h-4 w-4"} />;
}

function UnitCard({
  u, model, depth, expanded, subCount, onOpen, onToggle,
}: {
  u: MapUnit; model: Model; depth: number; expanded: boolean; subCount: number; onOpen: () => void; onToggle: () => void;
}) {
  const { t } = useI18n();
  const agg = model.unitAgg(u.id);
  const head = u.headId ? model.peopleById.get(u.headId) : undefined;
  const style = LEVEL_STYLE[u.level] ?? LEVEL_STYLE[4]!;
  const matched = model.matchUnitIds.has(u.id);
  const dimmed = model.searchOn && !matched && !model.unitAncestors.has(u.id);
  const root = depth === 0;
  const overBudget = u.headcountBudget > 0 && agg.total > u.headcountBudget;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cn(
        "w-64 cursor-pointer rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        root
          ? "ov-border-accent ov-soft shadow-md"
          : "border-stone-200 bg-white shadow-sm hover:border-stone-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700",
        matched && "ring-2 ring-ring",
        dimmed && "opacity-40 saturate-50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", style.box)}>
            <style.icon className="h-3.5 w-3.5" />
          </span>
          <p className="truncate text-[12.5px] font-bold text-stone-900 dark:text-stone-100">{u.name}</p>
        </span>
        <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-stone-500 dark:bg-stone-800 dark:text-stone-400">L{u.level}</span>
      </div>

      {head ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-stone-50 px-2 py-1.5 dark:bg-stone-800/60">
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[8px] font-extrabold", avatarColor(head.fullName))}>{initials(head.fullName)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-stone-700 dark:text-stone-200">{head.fullName}</p>
            <p className="truncate text-[9.5px] text-stone-400">{head.positionTitle ?? "—"}</p>
          </div>
          <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-stone-50 px-2 py-1.5 text-[10px] italic text-stone-400 dark:bg-stone-800/60">{t("Belum ada kepala unit", "No unit head yet")}</p>
      )}

      <div className="mt-2 grid grid-cols-3 divide-x divide-stone-100 rounded-lg border border-stone-100 bg-stone-50/60 dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900/60">
        <div className="px-1.5 py-1.5 text-center">
          <p className="text-[8.5px] font-bold uppercase tracking-wide text-stone-400">{t("Orang", "People")}</p>
          <p className="text-[13px] font-extrabold text-stone-800 dark:text-stone-200">{agg.total}</p>
          <p className="text-[8px] text-stone-400">{t("{n} langsung", "{n} direct", { n: agg.direct })}</p>
        </div>
        <div className="px-1.5 py-1.5 text-center">
          <p className="text-[8.5px] font-bold uppercase tracking-wide text-stone-400">{t("Lowong", "Vacant")}</p>
          <p className={cn("text-[13px] font-extrabold", agg.vac > 0 ? "text-amber-600 dark:text-amber-400" : "text-stone-800 dark:text-stone-200")}>{agg.vac}</p>
          <p className="text-[8px] text-stone-400">{t("{n} posisi", "{n} positions", { n: agg.positions })}</p>
        </div>
        <div className="px-1.5 py-1.5 text-center">
          <p className="text-[8.5px] font-bold uppercase tracking-wide text-stone-400">{t("Rp/bln", "Rp/mo")}</p>
          <p className="text-[13px] font-extrabold text-stone-800 dark:text-stone-200">{fmtIDRShort(agg.cost)}</p>
          <p className="text-[8px] text-stone-400">{t("gaji pokok", "base salary")}</p>
        </div>
      </div>

      {u.headcountBudget > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[9.5px]">
          <span className="text-stone-400">{t("Budget {n} org", "Budget {n} people", { n: u.headcountBudget })}</span>
          <span className={cn("font-bold", overBudget ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
            {agg.total}/{u.headcountBudget} {overBudget ? t("melebihi", "over budget") : t("sesuai", "within budget")}
          </span>
        </div>
      )}

      {subCount > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-stone-200 bg-stone-50 py-1 text-[9.5px] font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
        >
          <Layers className="h-2.5 w-2.5" /> {t("{n} sub-unit", "{n} sub-units", { n: subCount })}
          <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

// ============ MOBILE (stacked) ============
function MobilePersonItem({
  p, depth, model, isExpanded, toggle, openPerson,
}: {
  p: MapPerson; depth: number; model: Model; isExpanded: IsExpandedFn; toggle: ToggleFn; openPerson: (id: string) => void;
}) {
  const { t } = useI18n();
  const kids = model.childrenOf.get(p.id) ?? [];
  const vacs = model.vacancyByParent.get(p.id) ?? [];
  const total = kids.length + vacs.length;
  const expanded = isExpanded(p.id, depth, total > 0);
  const matched = model.matchPersonIds.has(p.id);
  const dimmed = model.searchOn && !matched && !model.matchAncestors.has(p.id);
  const isHead = model.headIds.has(p.id);

  return (
    <div>
      <div className={cn("flex min-h-11 items-center gap-2 rounded-xl border p-2.5 shadow-sm", depth === 0 ? "ov-border-accent ov-soft" : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900", matched && "ring-2 ring-ring", dimmed && "opacity-40")}>
        <button type="button" onClick={() => openPerson(p.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="relative flex shrink-0">
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-extrabold", avatarColor(p.fullName))}>{initials(p.fullName)}</span>
            <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-stone-900", STATUS_DOT[p.employmentStatus] ?? "bg-emerald-500")} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate text-[12px] font-bold text-stone-900 dark:text-stone-100">{p.fullName}</span>
              {isHead && <Star className="h-2.5 w-2.5 shrink-0 fill-amber-400 text-amber-400" />}
              {p.gradeCode && <span className="ml-auto shrink-0 rounded bg-stone-100 px-1 font-mono text-[8px] font-bold text-stone-500 dark:bg-stone-800 dark:text-stone-400">{p.gradeCode}</span>}
            </span>
            <span className="block truncate text-[10px] text-stone-500 dark:text-stone-400">{p.positionTitle ?? t("Tanpa jabatan", "No job title")} · {p.unitName ?? "—"}</span>
          </span>
        </button>
        {total > 0 && (
          <button
            type="button"
            onClick={() => toggle(p.id, depth, total > 0, isExpanded)}
            aria-label={expanded ? t("Tutup cabang", "Collapse branch") : t("Buka cabang", "Expand branch")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 dark:border-stone-700 dark:text-stone-400"
          >
            <span className="text-[10px] font-bold">{total}</span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {expanded && total > 0 && (
        <div className="ml-4 mt-1.5 space-y-1.5 border-l-2 border-stone-200 pl-2.5 dark:border-stone-800">
          {kids.map((k) => (
            <MobilePersonItem key={k.id} p={k} depth={depth + 1} model={model} isExpanded={isExpanded} toggle={toggle} openPerson={openPerson} />
          ))}
          {vacs.map((v) => (
            <div key={v.id} className="flex items-center gap-2 rounded-xl border-2 border-dashed border-amber-300/90 bg-amber-50/60 p-2 dark:border-amber-500/40 dark:bg-amber-500/5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-amber-400 text-amber-600 dark:text-amber-400"><UserPlus className="h-3 w-3" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">{t("Lowong · {n} slot", "Vacant · {n} slots", { n: v.slots })}</p>
                <p className="truncate text-[9.5px] text-stone-500 dark:text-stone-400">{v.title}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileUnitItem({
  u, depth, model, isExpanded, toggle, openUnit,
}: {
  u: MapUnit; depth: number; model: Model; isExpanded: IsExpandedFn; toggle: ToggleFn; openUnit: (id: string) => void;
}) {
  const { t } = useI18n();
  const kids = model.unitChildren.get(u.id) ?? [];
  const agg = model.unitAgg(u.id);
  const head = u.headId ? model.peopleById.get(u.headId) : undefined;
  const expanded = isExpanded(u.id, depth, kids.length > 0);
  const matched = model.matchUnitIds.has(u.id);
  const dimmed = model.searchOn && !matched && !model.unitAncestors.has(u.id);

  return (
    <div>
      <div className={cn("flex min-h-11 items-center gap-2 rounded-xl border p-2.5 shadow-sm", depth === 0 ? "ov-border-accent ov-soft" : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900", matched && "ring-2 ring-ring", dimmed && "opacity-40")}>
        <button type="button" onClick={() => openUnit(u.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", (LEVEL_STYLE[u.level] ?? LEVEL_STYLE[4]!).box)}>
            {(LEVEL_STYLE[u.level] ?? LEVEL_STYLE[4]!).icon != null && <UnitLevelIcon level={u.level} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate text-[12px] font-bold text-stone-900 dark:text-stone-100">{u.name}</span>
              <span className="ml-auto shrink-0 rounded bg-stone-100 px-1 font-mono text-[8px] font-bold text-stone-500 dark:bg-stone-800 dark:text-stone-400">L{u.level}</span>
            </span>
            <span className="block truncate text-[10px] text-stone-500 dark:text-stone-400">
              {head ? head.fullName : t("Tanpa kepala", "No head")} · {t("{n} org", "{n} people", { n: agg.total })}{agg.vac > 0 ? t(" · {n} lowong", " · {n} vacant", { n: agg.vac }) : ""} · {fmtIDRShort(agg.cost)}
            </span>
          </span>
        </button>
        {kids.length > 0 && (
          <button
            type="button"
            onClick={() => toggle(u.id, depth, kids.length > 0, isExpanded)}
            aria-label={expanded ? t("Tutup sub-unit", "Collapse sub-units") : t("Buka sub-unit", "Expand sub-units")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 dark:border-stone-700 dark:text-stone-400"
          >
            <span className="text-[10px] font-bold">{kids.length}</span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {expanded && kids.length > 0 && (
        <div className="ml-4 mt-1.5 space-y-1.5 border-l-2 border-stone-200 pl-2.5 dark:border-stone-800">
          {kids.map((k) => (
            <MobileUnitItem key={k.id} u={k} depth={depth + 1} model={model} isExpanded={isExpanded} toggle={toggle} openUnit={openUnit} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ PERSON DRAWER (360°) ============
function PersonDrawer({
  personId, model, onClose, onSelectPerson, onOpenDirectory,
}: {
  personId: string | null;
  model: Model;
  onClose: () => void;
  onSelectPerson: (id: string) => void;
  onOpenDirectory: (id: string) => void;
}) {
  const { t } = useI18n();
  const { data, loading } = useApi<DetailRes>(personId ? `/api/onevity/employee-detail?id=${personId}` : null);
  const e = data?.employee ?? null;

  // garis pelaporan (dari index peta — selalu tersedia walau detail masih loading)
  const chain: MapPerson[] = [];
  if (personId) {
    let cur = model.peopleById.get(personId)?.managerId ? model.peopleById.get(model.peopleById.get(personId)!.managerId!) ?? null : null;
    let guard = 0;
    while (cur && guard < 24) {
      chain.unshift(cur);
      cur = cur.managerId ? (model.peopleById.get(cur.managerId) ?? null) : null;
      guard++;
    }
  }

  const grade = e?.grade;
  const bandPct = grade && grade.maxSalary > grade.minSalary && e
    ? clamp(((e.baseSalary - grade.minSalary) / (grade.maxSalary - grade.minSalary)) * 100, 0, 100)
    : null;

  return (
    <Sheet open={!!personId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        {!e && loading && (
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3.5">
              <Skeleton className="h-14 w-14 rounded-2xl" />
              <div className="flex-1 space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3.5 w-1/2" /></div>
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
            <LoadingRows rows={6} />
          </div>
        )}

        {e && (
          <>
            {/* header */}
            <div className="border-b border-stone-200 p-5 dark:border-stone-800">
              <div className="flex items-start gap-3.5">
                <div className="relative shrink-0">
                  <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-extrabold", avatarColor(e.fullName))}>{initials(e.fullName)}</span>
                  <span className={cn("absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border-[3px] border-white dark:border-stone-900", STATUS_DOT[e.employmentStatus] ?? "bg-emerald-500")} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-base font-bold text-stone-900 dark:text-stone-50">{e.fullName}</p>
                    <StatusPill status={e.status} />
                  </div>
                  <p className="mt-0.5 truncate text-[13px] font-semibold ov-text-accent">{e.position?.title ?? t("Tanpa jabatan", "No job title")}</p>
                  <p className="mt-0.5 truncate text-[11px] text-stone-400">
                    {e.employeeNo} · {e.orgUnit?.name ?? "—"} {e.grade?.code ? `· Grade ${e.grade.code}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{empLabel(e.employmentStatus)}</span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{e.workShift}</span>
                  </div>
                </div>
              </div>

              {/* quick stats */}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: t("Masa Kerja", "Tenure"), value: tenure(e.joinDate) },
                  { label: t("Bergabung", "Joined"), value: fmtDate(e.joinDate) },
                  { label: t("Gaji Pokok"), value: fmtIDRShort(e.baseSalary) },
                  { label: t("Bawahan", "Subordinates"), value: String(e.directReports.length) },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-stone-100 bg-stone-50/70 px-2.5 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{s.label}</p>
                    <p className="mt-0.5 truncate text-[12.5px] font-extrabold text-stone-800 dark:text-stone-200">{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* manager chain */}
            {chain.length > 0 && (
              <div className="border-b border-stone-200 p-4 dark:border-stone-800">
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Garis Pelaporan", "Reporting Line")}</p>
                <div className="flex flex-wrap items-center gap-1">
                  {chain.map((m, i) => (
                    <Fragment key={m.id}>
                      {i > 0 && <ChevronRight className="h-3 w-3 text-stone-300 dark:text-stone-600" />}
                      <button
                        type="button"
                        onClick={() => onSelectPerson(m.id)}
                        className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2 py-1 text-[10.5px] font-semibold text-stone-700 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                      >
                        <span className={cn("flex h-4.5 w-4.5 items-center justify-center rounded-full text-[7px] font-extrabold", avatarColor(m.fullName))}>{initials(m.fullName)}</span>
                        {m.fullName}
                      </button>
                    </Fragment>
                  ))}
                  <ChevronRight className="h-3 w-3 text-stone-300 dark:text-stone-600" />
                  <span className="rounded-full ov-fill px-2 py-1 text-[10.5px] font-bold">{e.fullName}</span>
                </div>
              </div>
            )}

            {/* direct reports */}
            {e.directReports.length > 0 && (
              <div className="border-b border-stone-200 p-4 dark:border-stone-800">
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Bawahan Langsung ({n})", "Direct Reports ({n})", { n: e.directReports.length })}</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {e.directReports.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelectPerson(r.id)}
                      className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-2 text-left transition hover:ov-border-accent dark:border-stone-800 dark:bg-stone-900"
                    >
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold", avatarColor(r.fullName))}>{initials(r.fullName)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-bold text-stone-800 dark:text-stone-200">{r.fullName}</span>
                        <span className="block truncate text-[9.5px] text-stone-400">{r.position?.title ?? "—"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* tabs */}
            <div className="p-4">
              <Tabs defaultValue="profil">
                <TabsList className="w-full">
                  <TabsTrigger value="profil" className="flex-1 text-[11px]">{t("Profil", "Profile")}</TabsTrigger>
                  <TabsTrigger value="karir" className="flex-1 text-[11px]">{t("Karir", "Career")}</TabsTrigger>
                  <TabsTrigger value="disiplin" className="flex-1 text-[11px]">{t("Disiplin", "Discipline")}{e.disciplinary.length > 0 ? ` (${e.disciplinary.length})` : ""}</TabsTrigger>
                  <TabsTrigger value="pengajuan" className="flex-1 text-[11px]">{t("Pengajuan", "Requests")}{e.actions.length > 0 ? ` (${e.actions.length})` : ""}</TabsTrigger>
                </TabsList>

                <TabsContent value="profil" className="mt-3">
                  <div className="grid gap-x-4 sm:grid-cols-2">
                    {([
                      [t("Jenis Kelamin", "Gender"), genderLabel(e.gender)],
                      [t("Tempat, Tgl Lahir", "Place & Date of Birth"), e.birthPlace ? `${e.birthPlace}, ${fmtDate(e.birthDate)}` : fmtDate(e.birthDate)],
                      ["NIK", e.nationalId],
                      ["NPWP", e.taxId],
                      [t("BPJS Kesehatan", "BPJS Health"), e.bpjsHealth],
                      [t("BPJS Ketenagakerjaan", "BPJS Employment"), e.bpjsEmpSkill],
                      [t("Status Perkawinan", "Marital Status"), e.maritalStatus],
                      [t("Agama", "Religion"), e.religion],
                      [t("Golongan Darah", "Blood Type"), e.bloodType],
                      [t("Email"), e.email],
                      [t("Telepon"), e.phone],
                      [t("Kota", "City"), e.city],
                      [t("Alamat"), e.address],
                      ["Bank", e.bankName],
                      [t("No. Rekening", "Account No."), e.bankAccount],
                    ] as [string, string | null][]).map(([l, v]) => (
                      <div key={l} className="flex items-baseline justify-between gap-3 border-b border-dashed border-stone-100 py-1.5 dark:border-stone-800/70">
                        <span className="shrink-0 text-[11px] text-stone-400">{l}</span>
                        <span className="truncate text-right text-[11.5px] font-medium text-stone-700 dark:text-stone-200">{v ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="karir" className="mt-3 space-y-4">
                  {/* salary band */}
                  <div className="rounded-xl border border-stone-200 p-3.5 dark:border-stone-800">
                    <p className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">
                      {t("Posisi Gaji dalam Band {c}", "Salary Position in Band {c}", { c: grade?.code ? `(${grade.code})` : "" })}
                    </p>
                    {bandPct != null ? (
                      <>
                        <div className="flex justify-between text-[10px] font-medium text-stone-400">
                          <span>{fmtIDRShort(grade!.minSalary)}</span>
                          <span>{fmtIDRShort(grade!.maxSalary)}</span>
                        </div>
                        <div className="relative mt-1.5 h-2.5 rounded-full bg-stone-100 dark:bg-stone-800">
                          <div className="absolute inset-y-0 left-0 rounded-full ov-chart" style={{ width: `${bandPct}%` }} />
                          <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-stone-900 shadow dark:border-stone-900 dark:bg-white" style={{ left: `${bandPct}%` }} />
                        </div>
                        <p className="mt-2 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                          {t("Gaji pokok", "Base salary")} <span className="font-bold ov-text-accent">{fmtIDR(e.baseSalary)}</span> · {t("{n}% dari band", "{n}% of band", { n: Math.round(bandPct) })}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-stone-500">{t("Gaji pokok {s} — band grade belum tersedia.", "Base salary {s} — grade band not available.", { s: fmtIDR(e.baseSalary) })}</p>
                    )}
                  </div>

                  {/* education */}
                  <div>
                    <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Pendidikan", "Education")}</p>
                    {e.education.length === 0 ? (
                      <p className="text-[11.5px] italic text-stone-400">{t("Belum ada data pendidikan", "No education records yet")}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {e.education.map((ed) => (
                          <div key={ed.id} className="flex items-start gap-2.5 rounded-lg border border-stone-200 p-2.5 dark:border-stone-800">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ov-tile"><GraduationCap className="h-3.5 w-3.5" /></span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11.5px] font-bold text-stone-800 dark:text-stone-200">{ed.level} · {ed.institution}</p>
                              <p className="truncate text-[10px] text-stone-400">
                                {ed.major ?? "—"}{ed.startYear || ed.endYear ? ` · ${ed.startYear ?? "?"}–${ed.endYear ?? t("sekarang", "present")}` : ""}{ed.gpa ? t(" · IPK {g}", " · GPA {g}", { g: ed.gpa }) : ""}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* experiences */}
                  <div>
                    <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Pengalaman Kerja", "Work Experience")}</p>
                    {e.experiences.length === 0 ? (
                      <p className="text-[11.5px] italic text-stone-400">{t("Belum ada data pengalaman", "No experience records yet")}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {e.experiences.map((ex) => (
                          <div key={ex.id} className="flex items-start gap-2.5 rounded-lg border border-stone-200 p-2.5 dark:border-stone-800">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"><Briefcase className="h-3.5 w-3.5" /></span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11.5px] font-bold text-stone-800 dark:text-stone-200">{ex.position} — {ex.company}</p>
                              <p className="text-[10px] text-stone-400">{fmtDate(ex.startDate)} → {ex.endDate ? fmtDate(ex.endDate) : t("sekarang", "present")}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="disiplin" className="mt-3">
                  {e.disciplinary.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-[11.5px] italic text-stone-400 dark:border-stone-700">
                      {t("Rekam jejak disiplin bersih — tidak ada catatan.", "Clean disciplinary record — no entries.")}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {e.disciplinary.map((d) => (
                        <div key={d.id} className="rounded-lg border border-stone-200 p-2.5 dark:border-stone-800">
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[9.5px] font-bold",
                              d.warningLevel === "Verbal" ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                                : d.warningLevel === "Written" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                            )}>
                              {d.warningLevel === "Verbal" ? t("Teguran Lisan", "Verbal Warning") : d.warningLevel === "Written" ? t("Teguran Tertulis", "Written Warning") : t("Peringatan Akhir", "Final Warning")}
                            </span>
                            <span className="text-[9.5px] text-stone-400">{fmtDate(d.issuedAt)}</span>
                          </div>
                          <p className="mt-1 text-[11.5px] font-semibold text-stone-700 dark:text-stone-200">{d.violation}</p>
                          {d.sanction && <p className="text-[10px] text-stone-400">{t("Sanksi: {s}", "Sanction: {s}", { s: d.sanction })}</p>}
                          {d.notes && <p className="text-[10px] italic text-stone-400">{d.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="pengajuan" className="mt-3">
                  {e.actions.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-[11.5px] italic text-stone-400 dark:border-stone-700">
                      {t("Tidak ada pengajuan aktif untuk karyawan ini.", "No active requests for this employee.")}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {e.actions.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 p-2.5 dark:border-stone-800">
                          <div className="min-w-0">
                            <p className="text-[11.5px] font-bold text-stone-800 dark:text-stone-200">{paTypeLabelSafe(a.type)}</p>
                            <p className="font-mono text-[9.5px] text-stone-400">{a.docNo} · {t("efektif {d}", "effective {d}", { d: fmtDate(a.effectiveDate) })}</p>
                          </div>
                          <StatusPill status={a.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            {/* footer action */}
            <div className="border-t border-stone-200 p-4 dark:border-stone-800">
              <Button className="w-full gap-2" onClick={() => onOpenDirectory(e.id)}>
                <Users className="h-4 w-4" /> {t("Buka di Direktori Karyawan", "Open in Employee Directory")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ============ UNIT DRAWER ============
function UnitDrawer({
  unitId, model, onClose, onSelectPerson,
}: {
  unitId: string | null;
  model: Model;
  onClose: () => void;
  onSelectPerson: (id: string) => void;
}) {
  const { t } = useI18n();
  const u = unitId ? model.unitById.get(unitId) : undefined;
  const agg = unitId ? model.unitAgg(unitId) : null;
  const members = unitId ? (model.unitMembers.get(unitId) ?? []) : [];
  const positions = unitId ? (model.unitPositions.get(unitId) ?? []) : [];
  const vacs = unitId ? (model.unitVac.get(unitId) ?? []) : [];
  const head = u?.headId ? model.peopleById.get(u.headId) : undefined;
  const style = u ? (LEVEL_STYLE[u.level] ?? LEVEL_STYLE[4]!) : null;
  const subUnits = unitId ? (model.unitChildren.get(unitId) ?? []) : [];

  return (
    <Sheet open={!!unitId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        {!u || !agg ? (
          <div className="p-5"><LoadingRows rows={6} /></div>
        ) : (
          <>
            {/* header */}
            <div className="border-b border-stone-200 p-5 dark:border-stone-800">
              <div className="flex items-start gap-3">
                {style && (
                  <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", style.box)}>
                    <style.icon className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold text-stone-900 dark:text-stone-50">{u.name}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400">
                    <span className="font-mono">{u.code}</span> · {t(levelLabel(u.level), levelLabelEn(u.level))} · {t("{n} sub-unit", "{n} sub-units", { n: subUnits.length })}
                  </p>
                  {u.headcountBudget > 0 && (
                    <p className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", agg.total > u.headcountBudget ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400")}>
                      <MapPin className="h-2.5 w-2.5" /> {t("{a}/{b} dari budget", "{a}/{b} of budget", { a: agg.total, b: u.headcountBudget })}
                    </p>
                  )}
                </div>
              </div>

              {/* stats grid */}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { key: "total", label: t("Total Orang", "Total People"), value: String(agg.total), sub: t("{n} langsung", "{n} direct", { n: agg.direct }) },
                  { key: "pos", label: t("Posisi"), value: String(agg.positions), sub: t("aktif", "active") },
                  { key: "vac", label: t("Lowongan", "Vacancies"), value: String(agg.vac), sub: t("slot kosong", "open slots") },
                  { key: "cost", label: t("Biaya Gaji", "Salary Cost"), value: fmtIDRShort(agg.cost), sub: t("per bulan", "per month") },
                ].map((s) => (
                  <div key={s.key} className="rounded-xl border border-stone-100 bg-stone-50/70 px-2.5 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{s.label}</p>
                    <p className={cn("mt-0.5 truncate text-[13px] font-extrabold", s.key === "vac" && agg.vac > 0 ? "text-amber-600 dark:text-amber-400" : "text-stone-800 dark:text-stone-200")}>{s.value}</p>
                    <p className="truncate text-[9px] text-stone-400">{s.sub}</p>
                  </div>
                ))}
              </div>

              {head && (
                <button
                  type="button"
                  onClick={() => onSelectPerson(head.id)}
                  className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-stone-200 p-2.5 text-left transition hover:ov-border-accent dark:border-stone-800"
                >
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold", avatarColor(head.fullName))}>{initials(head.fullName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                      <span className="truncate text-[12px] font-bold text-stone-800 dark:text-stone-200">{head.fullName}</span>
                    </span>
                    <span className="block truncate text-[10px] text-stone-400">{t("Kepala unit · {p}", "Unit head · {p}", { p: head.positionTitle ?? "—" })}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" />
                </button>
              )}
            </div>

            {/* members */}
            <div className="border-b border-stone-200 p-4 dark:border-stone-800">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Anggota Langsung ({n})", "Direct Members ({n})", { n: members.length })}</p>
              {members.length === 0 ? (
                <p className="text-[11.5px] italic text-stone-400">{t("Tidak ada anggota langsung di unit ini.", "No direct members in this unit.")}</p>
              ) : (
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectPerson(m.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-stone-200 p-2 text-left transition hover:ov-border-accent dark:border-stone-800"
                    >
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold", avatarColor(m.fullName))}>{initials(m.fullName)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-bold text-stone-800 dark:text-stone-200">{m.fullName}</span>
                        <span className="block truncate text-[9.5px] text-stone-400">{m.positionTitle ?? "—"}{m.gradeCode ? ` · ${m.gradeCode}` : ""}</span>
                      </span>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[m.employmentStatus] ?? "bg-emerald-500")} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* positions */}
            <div className="border-b border-stone-200 p-4 dark:border-stone-800">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Posisi ({n})", "Positions ({n})", { n: positions.length })}</p>
              {positions.length === 0 ? (
                <p className="text-[11.5px] italic text-stone-400">{t("Belum ada posisi di unit ini.", "No positions in this unit yet.")}</p>
              ) : (
                <div className="space-y-1.5">
                  {positions.map((p) => {
                    const open = Math.max(0, p.headcount - p.filled);
                    return (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg border border-stone-200 p-2.5 dark:border-stone-800">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-300"><BriefcaseBusiness className="h-3.5 w-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11.5px] font-bold text-stone-800 dark:text-stone-200">{p.title}</p>
                          <p className="truncate text-[9.5px] text-stone-400">
                            <span className="font-mono">{p.code}</span>{p.reportsToTitle ? t(" · bawahan {r}", " · reports to {r}", { r: p.reportsToTitle }) : ""}{p.gradeCode ? ` · ${p.gradeCode}` : ""}
                          </p>
                        </div>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold", open > 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400")}>
                          {p.filled}/{p.headcount}{open > 0 ? t(" · lowong", " · vacant") : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* vacancies */}
            {vacs.length > 0 && (
              <div className="p-4">
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-stone-400">{t("Lowongan ({n})", "Vacancies ({n})", { n: vacs.length })}</p>
                <div className="space-y-1.5">
                  {vacs.map((v) => (
                    <div key={v.id} className="rounded-lg border-2 border-dashed border-amber-300/90 bg-amber-50/60 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/5">
                      <p className="text-[11.5px] font-bold text-amber-700 dark:text-amber-400">{t("{title} · {n} slot", "{title} · {n} slots", { title: v.title, n: v.slots })}</p>
                      <p className="text-[9.5px] text-stone-400">{v.reportsToTitle ? t("Melapor ke {r}", "Reports to {r}", { r: v.reportsToTitle }) : t("Belum terpetakan", "Not yet mapped")}{v.gradeCode ? ` · ${v.gradeCode}` : ""}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
