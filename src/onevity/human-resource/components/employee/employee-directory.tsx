"use client";
// OneVity — KARYAWAN › Direktori (redesign elegan modern, Task 26)
// Pola: segmented status tabs + toolbar ringkas + tabel/kartu + quick-view panel bergaya profil.
// Foto karyawan: photoUrl dari DB (fallback inisial gradient) via <EmployeeAvatar/>.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNav } from "@/onevity/shared/lib/store";
import { useApi, fmtIDR, fmtDate, tenure, genderLabel } from "@/onevity/shared/lib/api";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmployeeAvatar } from "./employee-avatar";
import { EMPLOYMENT_STATUS_LABEL, employmentStatusBadge, type DirectoryResp, type OrgUnitsLiteResp, type EmployeeRow } from "./types";

const PAGE_SIZE = 25;

type ViewMode = "table" | "grid";

// status kerja → dot + teks tenang (mengganti pill "stiker" yang ramai)
const EMPLOYMENT_TAG: Record<string, { text: string; dot: string }> = {
  Permanent: { text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  Probation: { text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  Contract: { text: "text-teal-700 dark:text-teal-400", dot: "bg-teal-500" },
  Outsourcing: { text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
};

function EmploymentTag({ status, className }: { status: string; className?: string }) {
  const t = EMPLOYMENT_TAG[status] ?? { text: "text-stone-500 dark:text-stone-400", dot: "bg-stone-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap", t.text, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
      {EMPLOYMENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function EmployeeDirectory() {
  const { navigate } = useNav();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState("all");
  const [empStatus, setEmpStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ViewMode>("grid");
  const [quick, setQuick] = useState<EmployeeRow | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return `/api/onevity/employees?${sp.toString()}`;
  }, [debouncedQ, status, unit, empStatus, offset]);

  const { data, loading, error } = useApi<DirectoryResp>(url, [debouncedQ, status, unit, empStatus, offset]);
  const units = useApi<OrgUnitsLiteResp>("/api/onevity/org-units");

  const rows = data?.employees ?? [];
  const total = data?.total ?? 0;
  const stats = data?.stats;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const resetPage = () => setOffset(0);

  // segmented status tabs (menggantikan filter chip hitam yang berat)
  const tabs = [
    { key: "all", label: "Semua", value: stats?.total, active: status === "all" && empStatus === "all", onClick: () => { setStatus("all"); setEmpStatus("all"); resetPage(); } },
    { key: "active", label: "Aktif", value: stats?.active, active: status === "Active", onClick: () => { setStatus(status === "Active" ? "all" : "Active"); setEmpStatus("all"); resetPage(); } },
    { key: "probation", label: "Probation", value: stats?.probation, active: empStatus === "Probation", onClick: () => { setEmpStatus(empStatus === "Probation" ? "all" : "Probation"); setStatus("all"); resetPage(); } },
    { key: "contract", label: "Kontrak", value: stats?.contract, active: empStatus === "Contract", onClick: () => { setEmpStatus(empStatus === "Contract" ? "all" : "Contract"); setStatus("all"); resetPage(); } },
    { key: "inactive", label: "Non-aktif", value: stats?.inactive, active: status === "inactive", onClick: () => { setStatus(status === "inactive" ? "all" : "inactive"); setEmpStatus("all"); resetPage(); } },
  ];

  const hasFilter = debouncedQ !== "" || status !== "all" || unit !== "all" || empStatus !== "all";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Karyawan"
        title="Direktori Karyawan"
        description={stats ? `${stats.total} karyawan terdaftar · posisi, grade, dan rekap upah` : "Pusat data seluruh karyawan."}
        actions={
          <div className="flex items-center gap-2">
            {/* toggle tampilan — segmented kecil */}
            <div className="flex h-9 items-center gap-0.5 rounded-lg bg-stone-100/90 p-0.5 dark:bg-stone-800/70" role="group" aria-label="Mode tampilan">
              <button onClick={() => setView("grid")} aria-pressed={view === "grid"} title="Tampilan kartu"
                className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-all", view === "grid"
                  ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-900/[0.06] dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-100/10"
                  : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300")}>
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button onClick={() => setView("table")} aria-pressed={view === "table"} title="Tampilan tabel"
                className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-all", view === "table"
                  ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-900/[0.06] dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-100/10"
                  : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300")}>
                <TableIcon className="h-4 w-4" />
              </button>
            </div>
            <Button onClick={() => navigate("employee", "wizard")} size="sm" className="h-9 gap-1.5 px-4 font-semibold">
              <UserPlus className="h-4 w-4" /> Onboarding
            </Button>
          </div>
        }
      />

      {/* segmented status tabs */}
      <div className="flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter status karyawan"
          className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-stone-100/90 p-1 [scrollbar-width:none] dark:bg-stone-800/70 [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.active}
              onClick={t.onClick}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-medium transition-all",
                t.active
                  ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-900/[0.06] dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-100/10"
                  : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums",
                  t.active
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "bg-stone-200/80 text-stone-500 dark:bg-stone-700/60 dark:text-stone-400",
                )}
              >
                {loading && !stats ? "…" : (t.value ?? 0)}
              </span>
            </button>
          ))}
        </div>
        {hasFilter && (
          <button
            onClick={() => { setQ(""); setStatus("all"); setUnit("all"); setEmpStatus("all"); resetPage(); }}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
          >
            <X className="h-3.5 w-3.5" /> Reset
          </button>
        )}
      </div>

      {/* toolbar pencarian & filter */}
      <div className="flex flex-col gap-2.5 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); resetPage(); }}
            placeholder="Cari nama, nomor karyawan, email, atau posisi…"
            className="h-10 rounded-xl pl-10 text-[13.5px] shadow-none"
            aria-label="Cari karyawan"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={unit} onValueChange={(v) => { setUnit(v); resetPage(); }}>
            <SelectTrigger className="h-10 w-full min-w-40 rounded-xl font-medium lg:w-[210px]" aria-label="Filter unit organisasi">
              <SelectValue placeholder="Semua unit" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">Semua Unit</SelectItem>
              {(units.data?.units ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}><span className="truncate">{u.name}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={empStatus === "Probation" || empStatus === "Contract" ? "all" : empStatus} onValueChange={(v) => { setEmpStatus(v); resetPage(); }}>
            <SelectTrigger className="h-10 w-full min-w-36 rounded-xl font-medium lg:w-[178px]" aria-label="Filter status kerja">
              <SelectValue placeholder="Semua status kerja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status Kerja</SelectItem>
              <SelectItem value="Permanent">Tetap</SelectItem>
              <SelectItem value="Probation">Probation</SelectItem>
              <SelectItem value="Contract">Kontrak</SelectItem>
              <SelectItem value="Outsourcing">Outsourcing</SelectItem>
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
        <EmptyState title="Gagal memuat direktori" description={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Tidak ada karyawan yang cocok"
          description={hasFilter ? "Tidak ditemukan hasil untuk filter saat ini. Coba ubah kata kunci atau reset filter." : "Belum ada karyawan terdaftar — mulai dengan onboarding baru."}
          icon={<Users className="h-6 w-6" />}
        />
      ) : view === "table" ? (
        /* ================= TABEL ================= */
        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] dark:border-stone-800 dark:bg-stone-900/50">
          <div className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[240px] text-stone-400">Karyawan</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[170px] text-stone-400">Posisi</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[150px] hidden text-stone-400 md:table-cell">Unit</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[80px] text-stone-400">Grade</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[110px] text-stone-400">Status Kerja</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[110px] text-right hidden text-stone-400 lg:table-cell">Gaji Pokok</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[100px] hidden text-stone-400 sm:table-cell">Masa Kerja</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase min-w-[105px] text-stone-400">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
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
              {from}–{to} dari {total} karyawan
            </p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Halaman sebelumnya">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)} aria-label="Halaman berikutnya">
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
                className="group flex flex-col items-center rounded-2xl border border-stone-200/70 bg-white px-5 pb-4 pt-7 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.18)] focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-600 dark:hover:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]"
              >
                <EmployeeAvatar name={e.fullName} photoUrl={e.photoUrl} size="lg" status={e.status} showStatus
                  ringClassName="ring-2 ring-stone-100 dark:ring-stone-800 group-hover:ring-emerald-100 dark:group-hover:ring-emerald-500/20 transition-shadow" />
                <p className="mt-3.5 max-w-full truncate text-[15px] font-semibold text-stone-800 dark:text-stone-100">{e.fullName}</p>
                <p className="mt-0.5 max-w-full truncate text-[13px] text-stone-500 dark:text-stone-400">{e.position?.title ?? "—"}</p>

                {e.orgUnit && (
                  <span className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 dark:bg-stone-800/80 dark:text-stone-300">
                    <Building2 className="h-3 w-3 shrink-0 text-stone-400" aria-hidden />
                    <span className="truncate">{e.orgUnit.name}</span>
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
            <p className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">{from}–{to} dari {total} karyawan</p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Halaman sebelumnya">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)} aria-label="Halaman berikutnya">
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
  return (
    <Sheet open={!!emp} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-md [&_[data-slot=sheet-close]]:text-white/90 [&_[data-slot=sheet-close]]:hover:text-white"
      >
        {emp && (
          <div className="flex h-full flex-col overflow-hidden">
            {/* cover */}
            <div className="relative h-32 shrink-0 overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 dark:from-emerald-800 dark:via-teal-800 dark:to-emerald-900">
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
                  {EMPLOYMENT_STATUS_LABEL[emp.employmentStatus] ?? emp.employmentStatus}
                </span>
                <span className="ml-auto font-mono text-[11px] tracking-tight text-stone-500 dark:text-stone-500">{emp.employeeNo}</span>
              </div>
            </div>

            {/* rincian — grouped rows */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-2">
              <QuickSection title="Penempatan & Pekerjaan">
                <InfoRow icon={<Building2 className="h-4 w-4" />} label="Unit Organisasi" value={emp.orgUnit?.name} />
                <InfoRow icon={<GraduationCap className="h-4 w-4" />} label="Grade" value={emp.grade ? `${emp.grade.code}${emp.grade.name ? ` · ${emp.grade.name}` : ""}` : undefined} />
                <InfoRow icon={<CalendarClock className="h-4 w-4" />} label="Bergabung" value={`${fmtDate(emp.joinDate)} · ${tenure(emp.joinDate)}`} />
              </QuickSection>
              <QuickSection title="Kontak">
                <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={emp.email ?? undefined} />
                <InfoRow icon={<Phone className="h-4 w-4" />} label="Telepon" value={emp.phone ?? undefined} />
              </QuickSection>
              <QuickSection title="Personal & Upah">
                <InfoRow icon={<User className="h-4 w-4" />} label="Jenis Kelamin" value={genderLabel(emp.gender)} />
                <InfoRow icon={<Wallet className="h-4 w-4" />} label="Gaji Pokok" value={fmtIDR(emp.baseSalary)} />
              </QuickSection>
            </div>

            {/* aksi */}
            <div className="shrink-0 border-t border-stone-200/80 bg-stone-50/60 p-5 dark:border-stone-800 dark:bg-stone-900/60">
              <Button onClick={() => onOpenFull(emp.id)} className="h-10 w-full gap-1.5 font-semibold">
                Buka Profil Lengkap <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <SheetDescription className="sr-only">Ringkasan data karyawan</SheetDescription>
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
