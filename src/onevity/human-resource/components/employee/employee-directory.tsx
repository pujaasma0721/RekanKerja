"use client";
// OneVity — KARYAWAN › Direktori (redesign elegan modern, Task 26)
// Pola: segmented status tabs + toolbar ringkas + tabel/kartu + quick-view panel bergaya profil.
// Foto karyawan: photoUrl dari DB (fallback inisial gradient) via <EmployeeAvatar/>.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNav } from "@/onevity/shared/lib/store";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useApi, fmtIDR, fmtDate, tenure, genderLabel } from "@/onevity/shared/lib/api";
import { useTableSort } from "@/onevity/shared/lib/use-table-sort";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Search, ChevronLeft, ChevronRight, UserPlus, Users, X, LayoutGrid, Table2 as TableIcon,
  Building2, GraduationCap, Wallet, CalendarClock, Mail, Phone, ArrowUpRight, User,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { EmployeeAvatar } from "./employee-avatar";
import { EmployeeImportDialog } from "./employee-import-dialog";
import { EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUS_LABEL_EN, employmentStatusBadge, type DirectoryResp, type OrgUnitsLiteResp, type EmployeeRow } from "./types";

const PAGE_SIZE = 25;

type ViewMode = "table" | "grid";

/** 26-b — sisa hari masa kontrak (null bila tanpa contractEnd). */
function contractDaysLeft(contractEnd: string | null): number | null {
  if (!contractEnd) return null;
  const end = new Date(contractEnd);
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

/** Badge masa kontrak: merah ≤7 hr / sudah lewat, amber ≤30 hr. */
function ContractBadge({ employmentStatus, contractEnd }: { employmentStatus: string; contractEnd: string | null }) {
  const { t } = useI18n();
  const isPkwt = ["Contract", "Probation", "Outsourcing"].includes(employmentStatus);
  const days = isPkwt ? contractDaysLeft(contractEnd) : null;
  if (days == null) return <span className="text-[12.5px] text-stone-300">—</span>;
  const overdue = days < 0;
  const critical = days <= 7;
  const soon = days <= 30;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap",
        overdue || critical
          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400"
          : soon
            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
            : "border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-400",
      )}
      title={contractEnd ? new Date(contractEnd).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : undefined}
    >
      <CalendarClock className="h-3 w-3" aria-hidden />
      {overdue
        ? t("Lewat {n} hr", "Overdue {n}d", { n: String(Math.abs(days)) })
        : t("{n} hari", "{n} days", { n: String(days) })}
    </span>
  );
}

// status kerja → dot + teks tenang (mengganti pill "stiker" yang ramai)
const EMPLOYMENT_TAG: Record<string, { text: string; dot: string }> = {
  Permanent: { text: "text-brand-deep dark:text-brand/85", dot: "bg-brand" },
  Probation: { text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  Contract: { text: "text-brand-deep dark:text-brand/85", dot: "bg-brand" },
  Outsourcing: { text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
};

function EmploymentTag({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  const t9 = EMPLOYMENT_TAG[status] ?? { text: "text-stone-500 dark:text-stone-400", dot: "bg-stone-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap", t9.text, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", t9.dot)} />
      {t(EMPLOYMENT_STATUS_LABEL[status] ?? status, EMPLOYMENT_STATUS_LABEL_EN[status])}
    </span>
  );
}

export function EmployeeDirectory() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState("all");
  const [empStatus, setEmpStatus] = useState("all");
  const [contractDue, setContractDue] = useState<number | null>(null); // 26-b: 30/60/90
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ViewMode>("grid");
  const [quick, setQuick] = useState<EmployeeRow | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Task 74 — sorting SERVER-SIDE: sort lintas seluruh data sebelum paginasi.
  // State sort dipakai oleh useMemo url (di bawah) — offset di-reset saat ganti sort.
  const [sortKey, setSortKey] = useState<string | null>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
    setOffset(0);
  };

  // live search — debounce 300ms
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [q]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debouncedQ) sp.set("q", debouncedQ);
    if (status !== "all") sp.set("status", status);
    if (unit !== "all") sp.set("unit", unit);
    if (empStatus !== "all") sp.set("employmentStatus", empStatus);
    if (contractDue != null) sp.set("contractExpiring", String(contractDue));
    // Task 74 — kirim sort ke server (map kolom UI → kolom API)
    const SORT_API: Record<string, string> = {
      name: "fullName", nip: "employeeNo", position: "position", unit: "unit",
      grade: "grade", empStatus: "employmentStatus", salary: "baseSalary",
      join: "joinDate", status: "status", contract: "contractEnd",
    };
    if (sortKey && SORT_API[sortKey]) {
      sp.set("sortBy", SORT_API[sortKey]);
      sp.set("sortDir", sortDir);
    }
    return `/api/onevity/employees?${sp.toString()}`;
  }, [debouncedQ, status, unit, empStatus, contractDue, offset, sortKey, sortDir]);

  const { data, loading, error, refresh } = useApi<DirectoryResp>(url, [debouncedQ, status, unit, empStatus, contractDue, offset]);
  const units = useApi<OrgUnitsLiteResp>("/api/onevity/org-units");

  const rows = data?.employees ?? [];
  const total = data?.total ?? 0;
  const sortedRows = rows;

  // Header sort memakai state server-side (Task 74) — ikon & aksi dari sortKey/sortDir
  const sortHead = (k: string, label: React.ReactNode, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        title="Klik untuk urutkan"
        className="inline-flex items-center gap-1 whitespace-nowrap transition hover:opacity-70"
      >
        {label}
        {sortKey === k ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-35" />
        )}
      </button>
    </TableHead>
  );
  const stats = data?.stats;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const resetPage = () => setOffset(0);

  // segmented status tabs (menggantikan filter chip hitam yang berat)
  const tabs = [
    { key: "all", label: t("Semua"), value: stats?.total, active: status === "all" && empStatus === "all", onClick: () => { setStatus("all"); setEmpStatus("all"); resetPage(); } },
    { key: "active", label: t("Aktif"), value: stats?.active, active: status === "Active", onClick: () => { setStatus(status === "Active" ? "all" : "Active"); setEmpStatus("all"); resetPage(); } },
    { key: "probation", label: t("Probation"), value: stats?.probation, active: empStatus === "Probation", onClick: () => { setEmpStatus(empStatus === "Probation" ? "all" : "Probation"); setStatus("all"); resetPage(); } },
    { key: "contract", label: t("Kontrak", "Contract"), value: stats?.contract, active: empStatus === "Contract", onClick: () => { setEmpStatus(empStatus === "Contract" ? "all" : "Contract"); setStatus("all"); resetPage(); } },
    { key: "inactive", label: t("Non-aktif", "Inactive"), value: stats?.inactive, active: status === "inactive", onClick: () => { setStatus(status === "inactive" ? "all" : "inactive"); setEmpStatus("all"); resetPage(); } },
  ];

  const hasFilter = debouncedQ !== "" || status !== "all" || unit !== "all" || empStatus !== "all" || contractDue != null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t("Karyawan")}
        title={t("Direktori Karyawan")}
        description={stats ? t("{n} karyawan terdaftar · posisi, grade, dan rekap upah", "{n} employees registered · positions, grades & payroll recap", { n: stats.total }) : t("Pusat data seluruh karyawan.", "The central directory of all employees.")}
        actions={
          <div className="flex items-center gap-2">
            {/* toggle tampilan — segmented kecil */}
            <div className="flex h-9 items-center gap-0.5 rounded-lg bg-stone-100/90 p-0.5 dark:bg-stone-800/70" role="group" aria-label={t("Mode tampilan", "View mode")}>
              <button onClick={() => setView("grid")} aria-pressed={view === "grid"} title={t("Tampilan kartu", "Card view")}
                className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-all", view === "grid"
                  ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-900/[0.06] dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-100/10"
                  : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300")}>
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button onClick={() => setView("table")} aria-pressed={view === "table"} title={t("Tampilan tabel", "Table view")}
                className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-all", view === "table"
                  ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-900/[0.06] dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-100/10"
                  : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300")}>
                <TableIcon className="h-4 w-4" />
              </button>
            </div>
            {perms.can("hr", "wizard", "create") && (
              <Button onClick={() => navigate("employee", "wizard")} size="sm" className="h-9 gap-1.5 px-4 font-semibold">
                <UserPlus className="h-4 w-4" /> {t("Onboarding", "Onboarding")}
              </Button>
            )}
            {/* T13-IMPORT — tombol Import/Export Excel (guard + dry-run di komponen) */}
            <EmployeeImportDialog onImported={refresh} />
          </div>
        }
      />

      {/* segmented status tabs */}
      <div className="flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("Filter status karyawan", "Employee status filter")}
          className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-stone-100/90 p-1 [scrollbar-width:none] dark:bg-stone-800/70 [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tb.active}
              onClick={tb.onClick}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-medium transition-all",
                tb.active
                  ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-900/[0.06] dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-100/10"
                  : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
              )}
            >
              {tb.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums",
                  tb.active
                    ? "ov-tile"
                    : "bg-stone-200/80 text-stone-500 dark:bg-stone-700/60 dark:text-stone-400",
                )}
              >
                {loading && !stats ? "…" : (tb.value ?? 0)}
              </span>
            </button>
          ))}
        </div>
        {hasFilter && (
          <button
            onClick={() => { setQ(""); setStatus("all"); setUnit("all"); setEmpStatus("all"); setContractDue(null); resetPage(); }}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
          >
            <X className="h-3.5 w-3.5" /> {t("Reset")}
          </button>
        )}
      </div>

      {/* 26-b P0 — chip PKWT: kontrak berakhir ≤ 30/60/90 hari (PP 35/2021) */}
      {(stats?.contract90 ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {t("Kontrak berakhir:", "Contract ending:")}
          </span>
          {([30, 60, 90] as const).map((band) => {
            const count = band === 30 ? (stats?.contract30 ?? 0) : band === 60 ? (stats?.contract60 ?? 0) : (stats?.contract90 ?? 0);
            const active = contractDue === band;
            return (
              <button
                key={band}
                onClick={() => { setContractDue(active ? null : band); resetPage(); }}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-bold transition-all",
                  active
                    ? "border-amber-300 bg-amber-100 text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-stone-200 bg-white text-stone-500 hover:border-amber-200 hover:text-amber-700 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-400 dark:hover:text-amber-400",
                )}
              >
                {t("≤ {n} hari", "≤ {n} days", { n: String(band) })}
                <span className={cn("rounded-full px-1.5 py-px text-[10px] font-extrabold tabular-nums", active ? "bg-amber-200 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200" : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400")}>{count}</span>
              </button>
            );
          })}
          <span className="text-[10.5px] text-stone-400">{t("termasuk yang sudah lewat jatuh tempo", "including those past their end date")}</span>
        </div>
      )}

      {/* toolbar pencarian & filter */}
      <div className="flex flex-col gap-2.5 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); resetPage(); }}
            placeholder={t("Cari nama, nomor karyawan, email, atau posisi…", "Search by name, employee number, email, or position…")}
            className="h-10 rounded-xl pl-10 text-[13.5px] shadow-none"
            aria-label={t("Cari karyawan", "Search employees")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={unit} onValueChange={(v) => { setUnit(v); resetPage(); }}>
            <SelectTrigger className="h-10 w-full min-w-40 rounded-xl font-medium lg:w-[210px]" aria-label={t("Filter unit organisasi", "Organizational unit filter")}>
              <SelectValue placeholder={t("Semua unit", "All units")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("Semua Unit", "All Units")}</SelectItem>
              {(units.data?.units ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}><span className="truncate">{u.name}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={empStatus === "Probation" || empStatus === "Contract" ? "all" : empStatus} onValueChange={(v) => { setEmpStatus(v); resetPage(); }}>
            <SelectTrigger className="h-10 w-full min-w-36 rounded-xl font-medium lg:w-[178px]" aria-label={t("Filter status kerja", "Employment status filter")}>
              <SelectValue placeholder={t("Semua status kerja", "All employment statuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua Status Kerja", "All Employment Statuses")}</SelectItem>
              <SelectItem value="Permanent">{t("Tetap", "Permanent")}</SelectItem>
              <SelectItem value="Probation">{t("Probation")}</SelectItem>
              <SelectItem value="Contract">{t("Kontrak", "Contract")}</SelectItem>
              <SelectItem value="Outsourcing">{t("Outsourcing")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* konten */}
      {loading && rows.length === 0 ? (
        view === "table" ? (
          <div className="rounded-2xl border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900/50">
            <div className="p-4"><LoadingRows rows={8} /></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center rounded-2xl border border-stone-200/70 px-5 pb-5 pt-8 dark:border-stone-800">
                <Skeleton className="h-[76px] w-[76px] rounded-full" />
                <Skeleton className="mt-4 h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-24" />
                <Skeleton className="mt-3 h-6 w-28 rounded-full" />
                <Skeleton className="mt-4 h-3 w-full" />
              </div>
            ))}
          </div>
        )
      ) : error ? (
        <EmptyState title={t("Gagal memuat direktori", "Failed to load directory")} description={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Tidak ada karyawan yang cocok", "No matching employees")}
          description={hasFilter ? t("Tidak ditemukan hasil untuk filter saat ini. Coba ubah kata kunci atau reset filter.", "No results for the current filters. Try changing the keyword or resetting the filters.") : t("Belum ada karyawan terdaftar — mulai dengan onboarding baru.", "No employees registered yet — start with a new onboarding.")}
          icon={<Users className="h-6 w-6" />}
        />
      ) : view === "table" ? (
        /* ================= TABEL ================= */
        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] dark:border-stone-800 dark:bg-stone-900/50">
          <div className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                <TableRow className="hover:bg-transparent">
                  {sortHead("name", t("Karyawan"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[240px] text-stone-400")}
                  {sortHead("position", t("Posisi"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[170px] text-stone-400")}
                  {sortHead("unit", t("Unit", "Unit"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[150px] hidden text-stone-400 md:table-cell")}
                  {sortHead("grade", t("Grade"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[80px] text-stone-400")}
                  {sortHead("empStatus", t("Status Kerja", "Employment Status"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[110px] text-stone-400")}
                  {sortHead("contract", t("Masa Kontrak", "Contract"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[110px] hidden text-stone-400 sm:table-cell")}
                  {sortHead("salary", t("Gaji Pokok"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[110px] text-right hidden text-stone-400 lg:table-cell")}
                  {sortHead("join", t("Masa Kerja", "Tenure"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[100px] hidden text-stone-400 sm:table-cell")}
                  {sortHead("status", t("Status"), "h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[105px] text-stone-400")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((e) => (
                  <TableRow
                    key={e.id}
                    onClick={() => setQuick(e)}
                    className="cursor-pointer transition-colors hover:bg-stone-50/80 dark:hover:bg-stone-800/40"
                  >
                    <TableCell className="py-3.5 pr-4">
                      <span className="flex items-center gap-3.5">
                        <EmployeeAvatar name={e.fullName} photoUrl={e.photoUrl} size="sm" status={e.status} showStatus />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold text-stone-800 dark:text-stone-100">{e.fullName}</span>
                          <span className="mt-0.5 block truncate font-mono text-[11px] tracking-tight text-stone-500 dark:text-stone-400">{e.employeeNo}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <span className="block max-w-56 truncate text-[13px] text-stone-600 dark:text-stone-300">{e.position?.title ?? "—"}</span>
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 hidden md:table-cell">
                      <span className="block max-w-48 truncate text-[13px] text-stone-500 dark:text-stone-400">{e.orgUnit?.name ?? "—"}</span>
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      {e.grade ? (
                        <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{e.grade.code}</span>
                      ) : (
                        <span className="text-[13px] text-stone-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4">
                      <EmploymentTag status={e.employmentStatus} />
                    </TableCell>
                    <TableCell className="hidden py-3.5 pr-4 sm:table-cell">
                      <ContractBadge employmentStatus={e.employmentStatus} contractEnd={e.contractEnd} />
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 text-right text-[13px] font-medium tabular-nums text-stone-600 dark:text-stone-300 hidden lg:table-cell">
                      {fmtIDR(e.baseSalary)}
                    </TableCell>
                    <TableCell className="py-3.5 pr-4 text-[13px] text-stone-500 dark:text-stone-400 hidden sm:table-cell">{tenure(e.joinDate)}</TableCell>
                    <TableCell className="py-3.5 pr-4"><StatusPill status={e.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* paginasi */}
          <div className="flex flex-col items-center justify-between gap-2 border-t border-stone-200/80 px-4 py-3 dark:border-stone-800 sm:flex-row">
            <p className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
              {t("{from}–{to} dari {total} karyawan", "{from}–{to} of {total} employees", { from, to, total })}
            </p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label={t("Halaman sebelumnya", "Previous page")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)} aria-label={t("Halaman berikutnya", "Next page")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* ================= KARTU (default) ================= */
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((e) => (
              <button
                key={e.id}
                onClick={() => setQuick(e)}
                className="group flex flex-col items-center rounded-2xl border border-stone-200/70 bg-white px-5 pb-4 pt-7 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.18)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-600 dark:hover:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]"
              >
                <EmployeeAvatar name={e.fullName} photoUrl={e.photoUrl} size="lg" status={e.status} showStatus
                  ringClassName="ring-2 ring-stone-100 dark:ring-stone-800 group-hover:ring-ring/20 transition-shadow" />
                <p className="mt-3.5 max-w-full truncate text-[15px] font-semibold text-stone-800 dark:text-stone-100">{e.fullName}</p>
                <p className="mt-0.5 max-w-full truncate text-[13px] text-stone-500 dark:text-stone-400">{e.position?.title ?? "—"}</p>

                {e.orgUnit && (
                  <span className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 dark:bg-stone-800/80 dark:text-stone-300">
                    <Building2 className="h-3 w-3 shrink-0 text-stone-400" aria-hidden />
                    <span className="truncate">{e.orgUnit.name}</span>
                  </span>
                )}

                {/* 26-b — sisa masa kontrak (hanya karyawan PKWT dgn contractEnd) */}
                {contractDaysLeft(e.contractEnd) != null && ["Contract", "Probation", "Outsourcing"].includes(e.employmentStatus) && (
                  <span className="mt-2 flex justify-center">
                    <ContractBadge employmentStatus={e.employmentStatus} contractEnd={e.contractEnd} />
                  </span>
                )}

                <div className="mt-3.5 flex w-full items-center justify-between border-t border-stone-100 pt-3 dark:border-stone-800">
                  <span className="font-mono text-[11px] tracking-tight text-stone-500 dark:text-stone-500">{e.employeeNo}</span>
                  <EmploymentTag status={e.employmentStatus} />
                </div>
              </button>
            ))}
          </div>
          {/* paginasi grid */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">{t("{from}–{to} dari {total} karyawan", "{from}–{to} of {total} employees", { from, to, total })}</p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label={t("Halaman sebelumnya", "Previous page")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)} aria-label={t("Halaman berikutnya", "Next page")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* quick view side panel */}
      <EmployeeQuickView emp={quick} onClose={() => setQuick(null)} onOpenFull={(id) => { setQuick(null); navigate("employee", "detail", { id }); }} />
    </div>
  );
}

/* ============ Quick View — panel profil dengan cover gradient ============ */
function EmployeeQuickView({ emp, onClose, onOpenFull }: { emp: EmployeeRow | null; onClose: () => void; onOpenFull: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={!!emp} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-md [&_[data-slot=sheet-close]]:text-white/90 [&_[data-slot=sheet-close]]:hover:text-white"
      >
        {emp && (
          <div className="flex h-full flex-col overflow-hidden">
            {/* cover */}
            <div className="relative h-32 shrink-0 overflow-hidden ov-hero">
              <div aria-hidden className="absolute -top-12 -right-10 h-40 w-40 rounded-full bg-white/10" />
              <div aria-hidden className="absolute -bottom-20 -left-8 h-36 w-36 rounded-full bg-white/[0.07]" />
              <div aria-hidden className="top-8 left-1/3 absolute h-20 w-20 rounded-full bg-white/10 blur-2xl" />
            </div>

            {/* identitas — avatar besar menumpuk cover */}
            <div className="relative shrink-0 -mt-12 px-6 pb-5">
              <div className="flex items-end gap-4">
                <EmployeeAvatar name={emp.fullName} photoUrl={emp.photoUrl} size="xl" status={emp.status} showStatus
                  className="shadow-lg" ringClassName="ring-4 ring-white dark:ring-stone-950" />
                <div className="min-w-0 flex-1 pb-0.5">
                  <SheetTitle className="block truncate text-lg font-bold tracking-tight text-stone-900 dark:text-stone-50">{emp.fullName}</SheetTitle>
                  <p className="mt-0.5 truncate text-[13px] text-stone-500 dark:text-stone-400">{emp.position?.title ?? "—"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <StatusPill status={emp.status} />
                <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold", employmentStatusBadge(emp.employmentStatus))}>
                  {t(EMPLOYMENT_STATUS_LABEL[emp.employmentStatus] ?? emp.employmentStatus, EMPLOYMENT_STATUS_LABEL_EN[emp.employmentStatus])}
                </span>
                <span className="ml-auto font-mono text-[11px] tracking-tight text-stone-500 dark:text-stone-500">{emp.employeeNo}</span>
              </div>
            </div>

            {/* rincian — grouped rows */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-2">
              <QuickSection title={t("Penempatan & Pekerjaan", "Placement & Employment")}>
                <InfoRow icon={<Building2 className="h-4 w-4" />} label={t("Unit Organisasi")} value={emp.orgUnit?.name} />
                <InfoRow icon={<GraduationCap className="h-4 w-4" />} label={t("Grade")} value={emp.grade ? `${emp.grade.code}${emp.grade.name ? ` · ${emp.grade.name}` : ""}` : undefined} />
                <InfoRow icon={<CalendarClock className="h-4 w-4" />} label={t("Bergabung", "Joined")} value={`${fmtDate(emp.joinDate)} · ${tenure(emp.joinDate)}`} />
                {/* 26-b — sisa masa kontrak PKWT */}
                {["Contract", "Probation", "Outsourcing"].includes(emp.employmentStatus) && emp.contractEnd && (
                  <InfoRow
                    icon={<CalendarClock className="h-4 w-4" />}
                    label={t("Kontrak Berakhir", "Contract Ends")}
                    value={`${fmtDate(emp.contractEnd)}${contractDaysLeft(emp.contractEnd) != null ? ` · ${t("sisa {n} hari", "{n} days left", { n: String(contractDaysLeft(emp.contractEnd)) })}` : ""}`}
                  />
                )}
              </QuickSection>
              <QuickSection title={t("Kontak", "Contact")}>
                <InfoRow icon={<Mail className="h-4 w-4" />} label={t("Email")} value={emp.email ?? undefined} />
                <InfoRow icon={<Phone className="h-4 w-4" />} label={t("Telepon")} value={emp.phone ?? undefined} />
              </QuickSection>
              <QuickSection title={t("Personal & Upah", "Personal & Salary")}>
                <InfoRow icon={<User className="h-4 w-4" />} label={t("Jenis Kelamin", "Gender")} value={genderLabel(emp.gender)} />
                <InfoRow icon={<Wallet className="h-4 w-4" />} label={t("Gaji Pokok")} value={fmtIDR(emp.baseSalary)} />
              </QuickSection>
            </div>

            {/* aksi */}
            <div className="shrink-0 border-t border-stone-200/80 bg-stone-50/60 p-5 dark:border-stone-800 dark:bg-stone-900/60">
              <Button onClick={() => onOpenFull(emp.id)} className="h-10 w-full gap-1.5 font-semibold">
                {t("Buka Profil Lengkap", "Open Full Profile")} <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <SheetDescription className="sr-only">{t("Ringkasan data karyawan", "Employee data summary")}</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

function QuickSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1 px-3 text-[10.5px] font-semibold tracking-[0.08em] text-stone-400 uppercase dark:text-stone-500">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-stone-400 dark:text-stone-500">{label}</p>
        <p className="truncate text-[13.5px] font-medium text-stone-700 dark:text-stone-200">{value ?? "—"}</p>
      </div>
    </div>
  );
}
