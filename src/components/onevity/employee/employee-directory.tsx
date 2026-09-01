"use client";
// OneVity — KARYAWAN › Direktori (modern redesign)
// Pattern: flat filter chips + compact toolbar + table/grid toggle + quick-view side panel (Rippling/HiBob style)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNav } from "@/lib/onevity/store";
import { useApi, initials, avatarColor, fmtIDR, tenure, genderLabel } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Search, ChevronLeft, ChevronRight, UserPlus, Users, X, LayoutGrid, Table2 as TableIcon,
  BriefcaseBusiness, Building2, GraduationCap, Wallet, CalendarClock, Mail, ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPLOYMENT_STATUS_LABEL, employmentStatusBadge, type DirectoryResp, type OrgUnitsLiteResp, type EmployeeRow } from "./types";

const PAGE_SIZE = 25;

type ViewMode = "table" | "grid";

export function EmployeeDirectory() {
  const { navigate } = useNav();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState("all");
  const [empStatus, setEmpStatus] = useState("all");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ViewMode>("table");
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

  // flat filter chips — klik untuk filter (ganti kartu statistik lama)
  const chips = [
    { key: "all", label: "Semua", value: stats?.total, active: status === "all" && empStatus === "all", onClick: () => { setStatus("all"); setEmpStatus("all"); resetPage(); } },
    { key: "active", label: "Aktif", value: stats?.active, active: status === "Active", onClick: () => { setStatus(status === "Active" ? "all" : "Active"); setEmpStatus("all"); resetPage(); } },
    { key: "probation", label: "Probation", value: stats?.probation, active: empStatus === "Probation", onClick: () => { setEmpStatus(empStatus === "Probation" ? "all" : "Probation"); setStatus("all"); resetPage(); } },
    { key: "contract", label: "Kontrak", value: stats?.contract, active: empStatus === "Contract", onClick: () => { setEmpStatus(empStatus === "Contract" ? "all" : "Contract"); setStatus("all"); resetPage(); } },
    { key: "inactive", label: "Non-aktif", value: stats?.inactive, active: status === "inactive", onClick: () => { setStatus(status === "inactive" ? "all" : "inactive"); setEmpStatus("all"); resetPage(); } },
  ];

  const hasFilter = debouncedQ !== "" || status !== "all" || unit !== "all" || empStatus !== "all";

  return (
    <div>
      <PageHeader
        eyebrow="Karyawan"
        title="Direktori Karyawan"
        description={stats ? `${stats.total} karyawan terdaftar · posisi, grade, dan rekap upah` : "Pusat data seluruh karyawan."}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex h-9 items-center rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900" role="group" aria-label="Mode tampilan">
              <button onClick={() => setView("table")} aria-pressed={view === "table"} title="Tampilan tabel"
                className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-colors", view === "table" ? "bg-stone-100 text-stone-900 dark:bg-stone-700 dark:text-stone-100" : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300")}>
                <TableIcon className="h-4 w-4" />
              </button>
              <button onClick={() => setView("grid")} aria-pressed={view === "grid"} title="Tampilan kartu"
                className={cn("flex h-8 w-9 items-center justify-center rounded-md transition-colors", view === "grid" ? "bg-stone-100 text-stone-900 dark:bg-stone-700 dark:text-stone-100" : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300")}>
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
            <Button onClick={() => navigate("employee", "wizard")} size="sm" className="h-9 gap-1.5 px-3.5 font-semibold">
              <UserPlus className="h-4 w-4" /> Onboarding
            </Button>
          </div>
        }
      />

      {/* filter chips — flat, tanpa kartu */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={c.onClick}
            aria-pressed={c.active}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
              c.active
                ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
            )}
          >
            {c.label}
            <span className={cn("rounded-full px-1.5 text-[11px] font-bold tabular-nums", c.active ? "bg-white/20 text-white dark:bg-black/10 dark:text-stone-900" : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400")}>
              {loading && !stats ? "…" : (c.value ?? 0)}
            </span>
          </button>
        ))}
        {hasFilter && (
          <button onClick={() => { setQ(""); setStatus("all"); setUnit("all"); setEmpStatus("all"); resetPage(); }}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-stone-400 transition-colors hover:text-rose-500">
            <X className="h-3.5 w-3.5" /> Reset filter
          </button>
        )}
      </div>

      {/* toolbar — flat bar, bukan kartu */}
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); resetPage(); }}
            placeholder="Cari nama, nomor karyawan, email, atau posisi…"
            className="h-9 pl-9"
            aria-label="Cari karyawan"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={unit} onValueChange={(v) => { setUnit(v); resetPage(); }}>
            <SelectTrigger className="h-9 w-full min-w-40 font-medium lg:w-[200px]" aria-label="Filter unit organisasi">
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
            <SelectTrigger className="h-9 w-full min-w-36 font-medium lg:w-[170px]" aria-label="Filter status kerja">
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

      {/* content */}
      {loading && rows.length === 0 ? (
        <div className="rounded-xl border border-stone-200/80 dark:border-stone-800"><div className="p-4"><LoadingRows rows={8} /></div></div>
      ) : error ? (
        <EmptyState title="Gagal memuat direktori" description={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Tidak ada karyawan yang cocok"
          description={hasFilter ? "Tidak ditemukan hasil untuk filter saat ini. Coba ubah kata kunci atau reset filter." : "Belum ada karyawan terdaftar — mulai dengan onboarding baru."}
          icon={<Users className="h-6 w-6" />}
        />
      ) : view === "table" ? (
        <div className="overflow-hidden rounded-xl border border-stone-200/80 dark:border-stone-800">
          <div className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">Karyawan</TableHead>
                  <TableHead className="min-w-[160px]">Posisi</TableHead>
                  <TableHead className="min-w-[140px] hidden md:table-cell">Unit</TableHead>
                  <TableHead className="min-w-[80px]">Grade</TableHead>
                  <TableHead className="min-w-[100px]">Status Kerja</TableHead>
                  <TableHead className="min-w-[110px] text-right hidden lg:table-cell">Gaji Pokok</TableHead>
                  <TableHead className="min-w-[100px] hidden sm:table-cell">Masa Kerja</TableHead>
                  <TableHead className="min-w-[105px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow
                    key={e.id}
                    onClick={() => setQuick(e)}
                    className="cursor-pointer"
                  >
                    <TableCell className="py-2.5">
                      <span className="flex items-center gap-3">
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", avatarColor(e.fullName))}>
                          {initials(e.fullName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">{e.fullName}</span>
                          <span className="block truncate font-mono text-[11px] text-stone-400">{e.employeeNo}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="block max-w-52 truncate text-[13px] text-stone-600 dark:text-stone-300">{e.position?.title ?? "—"}</span>
                    </TableCell>
                    <TableCell className="py-2.5 hidden md:table-cell">
                      <span className="block max-w-44 truncate text-[13px] text-stone-500 dark:text-stone-400">{e.orgUnit?.name ?? "—"}</span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      {e.grade ? (
                        <span className="inline-flex items-center rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{e.grade.code}</span>
                      ) : (
                        <span className="text-[13px] text-stone-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", employmentStatusBadge(e.employmentStatus))}>
                        {EMPLOYMENT_STATUS_LABEL[e.employmentStatus] ?? e.employmentStatus}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 text-right text-[13px] font-medium tabular-nums text-stone-600 dark:text-stone-300 hidden lg:table-cell">
                      {fmtIDR(e.baseSalary)}
                    </TableCell>
                    <TableCell className="py-2.5 text-[13px] text-stone-500 dark:text-stone-400 hidden sm:table-cell">{tenure(e.joinDate)}</TableCell>
                    <TableCell className="py-2.5"><StatusPill status={e.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* pagination — flat */}
          <div className="flex flex-col items-center justify-between gap-2 border-t border-stone-200/80 px-4 py-2.5 dark:border-stone-800 sm:flex-row">
            <p className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
              {from}–{to} dari {total} karyawan
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Halaman sebelumnya">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8" disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)} aria-label="Halaman berikutnya">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* grid view — kartu karyawan ala HiBob/BambooHR */
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((e) => (
              <button key={e.id} onClick={() => setQuick(e)}
                className="group rounded-xl border border-stone-200/80 bg-white p-4 text-left transition-all hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700">
                <div className="flex items-start gap-3">
                  <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold", avatarColor(e.fullName))}>
                    {initials(e.fullName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-stone-800 dark:text-stone-100">{e.fullName}</p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">{e.position?.title ?? "—"}</p>
                    <p className="mt-0.5 truncate text-[11px] text-stone-400 dark:text-stone-500">{e.orgUnit?.name ?? "—"}</p>
                  </div>
                  <StatusPill status={e.status} className="scale-90" />
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5 dark:border-stone-800">
                  <span className="font-mono text-[11px] text-stone-400">{e.employeeNo}</span>
                  <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold", employmentStatusBadge(e.employmentStatus))}>
                    {EMPLOYMENT_STATUS_LABEL[e.employmentStatus] ?? e.employmentStatus}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {/* grid pagination */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-stone-500 dark:text-stone-400">{from}–{to} dari {total}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Halaman sebelumnya">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8" disabled={offset + PAGE_SIZE >= total || loading}
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

function EmployeeQuickView({ emp, onClose, onOpenFull }: { emp: EmployeeRow | null; onClose: () => void; onOpenFull: (id: string) => void }) {
  return (
    <Sheet open={!!emp} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {emp && (
          <>
            {/* header */}
            <div className="border-b border-stone-200/80 px-5 py-4 dark:border-stone-800">
              <div className="flex items-start gap-3.5">
                <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-bold", avatarColor(emp.fullName))}>
                  {initials(emp.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base font-semibold text-stone-900 dark:text-stone-50">{emp.fullName}</SheetTitle>
                  <p className="text-[13px] text-stone-500 dark:text-stone-400">{emp.position?.title ?? "—"}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusPill status={emp.status} />
                    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", employmentStatusBadge(emp.employmentStatus))}>
                      {EMPLOYMENT_STATUS_LABEL[emp.employmentStatus] ?? emp.employmentStatus}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* info rows */}
            <div className="flex-1 space-y-0.5 overflow-y-auto px-5 py-4">
              <InfoRow icon={<Building2 className="h-4 w-4" />} label="Unit Organisasi" value={emp.orgUnit?.name} />
              <InfoRow icon={<GraduationCap className="h-4 w-4" />} label="Grade" value={emp.grade ? `${emp.grade.code}${emp.grade.name ? ` · ${emp.grade.name}` : ""}` : undefined} />
              <InfoRow icon={<BriefcaseBusiness className="h-4 w-4" />} label="Jenis Kelamin" value={genderLabel(emp.gender)} />
              <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={emp.email ?? undefined} />
              <InfoRow icon={<CalendarClock className="h-4 w-4" />} label="Join & Masa Kerja" value={`${emp.joinDate} · ${tenure(emp.joinDate)}`} />
              <InfoRow icon={<Wallet className="h-4 w-4" />} label="Gaji Pokok" value={fmtIDR(emp.baseSalary)} />
            </div>

            {/* actions */}
            <div className="border-t border-stone-200/80 p-4 dark:border-stone-800">
              <Button onClick={() => onOpenFull(emp.id)} className="h-10 w-full gap-1.5 font-semibold">
                Buka Profil Lengkap <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
        <SheetDescription className="sr-only">Ringkasan data karyawan</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-stone-50 dark:hover:bg-stone-800/50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-stone-400 dark:text-stone-500">{label}</p>
        <p className={cn("truncate text-[13px] font-medium text-stone-700 dark:text-stone-200", mono && "font-mono")}>{value ?? "—"}</p>
      </div>
    </div>
  );
}
