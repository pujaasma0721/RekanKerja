"use client";
// OneVity — Settings › LOG AKTIVITAS (viewer audit trail, 26-b P0) ===========
// =====================================================================
// Data ActivityLog sudah dikumpulkan 12+ API sejak lama — viewer inilah
// yang selama ini hilang. Siapa melakukan apa, kapan, pada entitas mana:
//   • tabel waktu · aktor · karyawan · aksi · entitas · detail
//   • filter: aksi, entitas, karyawan, rentang tanggal, cari detail
//   • paginasi + max-height scroll dengan scrollbar custom
//   • badge warna per jenis aksi (create/update/delete/approve/…)
//   • Export CSV (ikuti pola lib/export.ts — guard op:export server-side)
// Gating: tombol ekspor hanya bila pengguna punya op export settings:audit
// (pola menu-perms-context); menu itu sendiri sudah difilter AppShell.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ChevronLeft, ChevronRight, Download, ScrollText, X, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, locActivity } from "@/onevity/shared/lib/i18n";

const PAGE_SIZE = 50;

// ---------- tipe respons API ----------
interface ActivityRow {
  id: string;
  actorType: string;
  createdAt: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  employee: { employeeNo: string; fullName: string } | null;
  appUser: { username: string; fullName: string } | null;
}

interface LogsResp {
  logs: ActivityRow[];
  total: number;
  limit: number;
  offset: number;
  actions: { key: string; count: number }[];
  entities: { key: string; count: number }[];
}

// ---------- badge warna per aksi (tanpa indigo/blue — palet repo) ----------
const ACTION_CLS: Record<string, string> = {
  Created: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Approved: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Updated: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Processed: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Confirmed: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Posted: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Issued: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Deleted: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Rejected: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Error: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  Submitted: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  Exported: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  Reminder: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
};

const ACTION_LABEL_EN: Record<string, string> = {
  Created: "Create", Updated: "Update", Deleted: "Delete", Submitted: "Submit",
  Approved: "Approve", Rejected: "Reject", Processed: "Process", Cancelled: "Cancel",
  Confirmed: "Confirm", Calculated: "Calculate", Posted: "Post", Exported: "Export",
  Issued: "Issue", Warning: "Warning", Error: "Error", Reminder: "Reminder",
  Scheduled: "Schedule", Sent: "Send", Decided: "Decide",
};

function ActionBadge({ action }: { action: string }) {
  const { t } = useI18n();
  return (
    <Badge variant="outline" className={cn("rounded-full px-2 text-[10px] font-bold whitespace-nowrap", ACTION_CLS[action] ?? "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25")}>
      {t(action, ACTION_LABEL_EN[action])}
    </Badge>
  );
}

export function ActivityLogView() {
  const { t } = useI18n();
  const perms = useMenuPerms();

  // filter state
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [action, setAction] = useState("all");
  const [entity, setEntity] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // live search — debounce 300ms
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedQ(q.trim()); setOffset(0); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [q]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (debouncedQ) sp.set("q", debouncedQ);
    if (action !== "all") sp.set("action", action);
    if (entity !== "all") sp.set("entity", entity);
    if (employeeId !== "all") sp.set("employeeId", employeeId);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    return `/api/onevity/activity-logs?${sp.toString()}`;
  }, [debouncedQ, action, entity, employeeId, from, to, offset]);

  const { data, loading, error } = useApi<LogsResp>(url, [url]);
  const emps = useApi<{ employees: { id: string; fullName: string; employeeNo: string }[] }>(
    "/api/onevity/employees?limit=200&status=Active",
  );

  const rows = data?.logs ?? [];
  const total = data?.total ?? 0;
  const from_ = total === 0 ? 0 : offset + 1;
  const to_ = Math.min(offset + PAGE_SIZE, total);

  const hasFilter = debouncedQ !== "" || action !== "all" || entity !== "all" || employeeId !== "all" || from !== "" || to !== "";
  const resetFilters = () => { setQ(""); setAction("all"); setEntity("all"); setEmployeeId("all"); setFrom(""); setTo(""); setOffset(0); };

  // URL ekspor CSV — filter saat ini + export=csv (server guard op:export)
  const exportUrl = useMemo(() => {
    const sp = new URLSearchParams({ export: "csv" });
    if (debouncedQ) sp.set("q", debouncedQ);
    if (action !== "all") sp.set("action", action);
    if (entity !== "all") sp.set("entity", entity);
    if (employeeId !== "all") sp.set("employeeId", employeeId);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    return `/api/onevity/activity-logs?${sp.toString()}`;
  }, [debouncedQ, action, entity, employeeId, from, to]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Log Aktivitas")}
        description={t(
          "Jejak audit seluruh sistem — siapa mengubah apa dan kapan: onboarding, approval, payroll, surat, hingga pengingat otomatis scheduler.",
          "System-wide audit trail — who changed what and when: onboarding, approvals, payroll, letters, and scheduler reminders.",
        )}
        actions={
          perms.canOp("settings", "audit", "export") ? (
            <a
              href={exportUrl}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-stone-900 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
              aria-label={t("Ekspor log aktivitas ke CSV", "Export activity log to CSV")}
            >
              <Download className="h-4 w-4" /> {t("Export CSV")}
            </a>
          ) : undefined
        }
      />

      {/* toolbar filter */}
      <div className="flex flex-col gap-2.5 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Cari di detail log… (mis. nama, nomor dokumen)", "Search log details… (e.g. name, document number)")}
            className="h-10 rounded-xl pl-10 text-[13.5px]"
            aria-label={t("Cari log aktivitas", "Search activity log")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={action} onValueChange={(v) => { setAction(v); setOffset(0); }}>
            <SelectTrigger className="h-10 w-full min-w-36 rounded-xl font-medium lg:w-[168px]" aria-label={t("Filter aksi", "Action filter")}>
              <SelectValue placeholder={t("Semua aksi", "All actions")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("Semua Aksi", "All Actions")}</SelectItem>
              {(data?.actions ?? []).map((a) => (
                <SelectItem key={a.key} value={a.key}>
                  <span className="flex items-center justify-between gap-3">
                    <span>{t(a.key, ACTION_LABEL_EN[a.key])}</span>
                    <span className="text-[10px] font-bold tabular-nums text-stone-400">{a.count}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entity} onValueChange={(v) => { setEntity(v); setOffset(0); }}>
            <SelectTrigger className="h-10 w-full min-w-40 rounded-xl font-medium lg:w-[190px]" aria-label={t("Filter entitas", "Entity filter")}>
              <SelectValue placeholder={t("Semua entitas", "All entities")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("Semua Entitas", "All Entities")}</SelectItem>
              {(data?.entities ?? []).map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  <span className="flex items-center justify-between gap-3">
                    <span>{e.key}</span>
                    <span className="text-[10px] font-bold tabular-nums text-stone-400">{e.count}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setOffset(0); }}>
            <SelectTrigger className="h-10 w-full min-w-44 rounded-xl font-medium lg:w-[210px]" aria-label={t("Filter karyawan", "Employee filter")}>
              <SelectValue placeholder={t("Semua karyawan", "All employees")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("Semua Karyawan", "All Employees")}</SelectItem>
              {(emps.data?.employees ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="truncate">{e.fullName} · {e.employeeNo}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} aria-label={t("Dari tanggal", "From date")}
              className="h-10 w-[132px] rounded-xl text-[12.5px]" />
            <span className="text-xs text-stone-400">–</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} aria-label={t("Sampai tanggal", "To date")}
              className="h-10 w-[132px] rounded-xl text-[12.5px]" />
            {hasFilter && (
              <button onClick={resetFilters} aria-label={t("Reset filter", "Reset filter")}
                className="inline-flex h-10 items-center gap-1 rounded-xl px-2.5 text-[12px] font-medium text-stone-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10">
                <X className="h-3.5 w-3.5" /> {t("Reset")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* tabel log */}
      {loading && rows.length === 0 ? (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-4"><LoadingRows rows={8} /></CardContent>
        </Card>
      ) : error ? (
        <EmptyState title={t("Gagal memuat log", "Failed to load logs")} description={error} icon={<ScrollText className="h-6 w-6" />} />
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-6">
            <EmptyState
              title={t("Tidak ada aktivitas yang cocok", "No matching activity")}
              description={hasFilter
                ? t("Tidak ditemukan log untuk filter ini — coba rentang tanggal lebih lebar atau reset filter.", "No logs found for these filters — try a wider date range or reset the filters.")
                : t("Belum ada aktivitas tercatat pada tenant ini.", "No activity recorded in this tenant yet.")}
              icon={<ScrollText className="h-6 w-6" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] dark:border-stone-800 dark:bg-stone-900/50">
          <div className="max-h-[620px] overflow-y-auto pr-0.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 min-w-[132px] text-[11px] font-semibold tracking-wider uppercase text-stone-400">{t("Waktu", "Time")}</TableHead>
                  <TableHead className="h-11 min-w-[128px] text-[11px] font-semibold tracking-wider uppercase text-stone-400">{t("Aktor", "Actor")}</TableHead>
                  <TableHead className="h-11 min-w-[150px] hidden text-[11px] font-semibold tracking-wider uppercase text-stone-400 md:table-cell">{t("Karyawan")}</TableHead>
                  <TableHead className="h-11 min-w-[100px] text-[11px] font-semibold tracking-wider uppercase text-stone-400">{t("Aksi", "Action")}</TableHead>
                  <TableHead className="h-11 min-w-[140px] hidden text-[11px] font-semibold tracking-wider uppercase text-stone-400 sm:table-cell">{t("Entitas", "Entity")}</TableHead>
                  <TableHead className="h-11 text-[11px] font-semibold tracking-wider uppercase text-stone-400">{t("Detail")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="align-top transition-colors hover:bg-stone-50/80 dark:hover:bg-stone-800/40">
                    <TableCell className="py-3 pr-4">
                      <p className="text-[12.5px] font-semibold text-stone-700 dark:text-stone-200">
                        {new Date(r.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                      </p>
                      <p className="font-mono text-[10.5px] text-stone-400">
                        {new Date(r.createdAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {r.actorType === "system" ? (
                        <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wide">Sistem</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                          <User className="h-3.5 w-3.5 text-stone-400" aria-hidden />
                          {r.appUser?.username ?? r.appUser?.fullName ?? "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden py-3 pr-4 md:table-cell">
                      {r.employee ? (
                        <span className="block max-w-44 truncate text-[12.5px] text-stone-600 dark:text-stone-300">
                          {r.employee.fullName}
                          <span className="ml-1 font-mono text-[10.5px] text-stone-400">{r.employee.employeeNo}</span>
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-stone-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 pr-4"><ActionBadge action={r.action} /></TableCell>
                    <TableCell className="hidden py-3 pr-4 sm:table-cell">
                      <span className="text-[12.5px] font-medium text-stone-600 dark:text-stone-300">{r.entity}</span>
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <p className="max-w-xl text-[12.5px] leading-relaxed text-stone-600 dark:text-stone-300">{locActivity(r.detail) ?? "—"}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* paginasi */}
          <div className="flex flex-col items-center justify-between gap-2 border-t border-stone-200/80 px-4 py-3 dark:border-stone-800 sm:flex-row">
            <p className="text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
              {t("{f}–{l} dari {n} entri", "{f}–{l} of {n} entries", { f: from_, l: to_, n: total })}
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
      )}
    </div>
  );
}
