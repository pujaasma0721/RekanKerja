"use client";
// OneVity — KARYAWAN › Disiplin: semua catatan pelanggaran + statistik level
import { useMemo, useState } from "react";
import { useNav } from "@/lib/onevity/store";
import { useApi, fmtDate, initials, avatarColor } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Scale, Plus, MessageSquareWarning, FileWarning, ShieldAlert, ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { WARNING_LEVEL_META, type DisciplinaryRow } from "./types";
import { DisciplinaryDialog, DeleteRecordButton } from "./detail-dialogs";

interface DisciplinaryResp {
  records: DisciplinaryRow[];
}

export function DisciplinaryView() {
  const { navigate } = useNav();
  const { data, loading, error, refresh } = useApi<DisciplinaryResp>("/api/onevity/disciplinary");
  const [level, setLevel] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const records = useMemo(() => data?.records ?? [], [data]);
  const filtered = useMemo(() => (level === "all" ? records : records.filter((r) => r.warningLevel === level)), [records, level]);

  const levelCards = [
    { key: "Verbal", label: "Verbal", icon: MessageSquareWarning, active: level === "Verbal",
      cls: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
      activeCls: "border-amber-400 bg-amber-50/70 dark:border-amber-500/50 dark:bg-amber-500/10" },
    { key: "Written", label: "Tertulis", icon: FileWarning, active: level === "Written",
      cls: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
      activeCls: "border-orange-400 bg-orange-50/70 dark:border-orange-500/50 dark:bg-orange-500/10" },
    { key: "Final", label: "Akhir", icon: ShieldAlert, active: level === "Final",
      cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
      activeCls: "border-rose-400 bg-rose-50/70 dark:border-rose-500/50 dark:bg-rose-500/10" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="KARYAWAN"
        title="Catatan Disiplin"
        description="Catatan pelanggaran seluruh karyawan — peringatan verbal, tertulis, hingga peringatan akhir."
        actions={
          <Button onClick={() => setDialogOpen(true)} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Catat Pelanggaran
          </Button>
        }
      />

      {/* stats per level */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          onClick={() => setLevel(level === "all" ? "all" : "all")}
          aria-pressed={level === "all"}
          className={cn(
            "flex items-center gap-3 rounded-2xl border p-4 text-left shadow-sm transition-all hover:shadow-md",
            level === "all"
              ? "border-emerald-400 bg-emerald-50/70 dark:border-emerald-500/50 dark:bg-emerald-500/10"
              : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60"
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Scale className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-50">{loading ? "…" : records.length}</span>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Catatan</span>
          </span>
        </button>
        {levelCards.map((c) => {
          const n = records.filter((r) => r.warningLevel === c.key).length;
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              onClick={() => setLevel(level === c.key ? "all" : c.key)}
              aria-pressed={c.active}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-4 text-left shadow-sm transition-all hover:shadow-md",
                c.active
                  ? c.activeCls
                  : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60"
              )}
            >
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", c.cls)}>
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-50">{loading ? "…" : n}</span>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Peringatan {c.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* table */}
      {loading && records.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <LoadingRows rows={6} />
        </div>
      ) : error ? (
        <EmptyState title="Gagal memuat data disiplin" description={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={records.length === 0 ? "Belum ada catatan disiplin" : "Tidak ada catatan untuk level ini"}
          description={records.length === 0 ? "Rekam jejak disiplin seluruh karyawan masih bersih." : "Pilih level lain atau reset filter."}
          icon={<Scale className="h-6 w-6" />}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm dark:border-slate-800">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/80 dark:bg-slate-900/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">Karyawan</TableHead>
                  <TableHead className="min-w-[130px]">Tingkat</TableHead>
                  <TableHead className="min-w-[220px]">Pelanggaran</TableHead>
                  <TableHead className="min-w-[180px]">Sanksi</TableHead>
                  <TableHead className="min-w-[110px]">Diterbitkan</TableHead>
                  <TableHead className="min-w-[110px]">Berlaku s/d</TableHead>
                  <TableHead className="w-12" aria-label="Aksi" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const meta = WARNING_LEVEL_META[r.warningLevel] ?? WARNING_LEVEL_META.Verbal!;
                  return (
                    <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell className="py-3">
                        <button
                          className="flex items-center gap-3 text-left"
                          onClick={() => r.employee && navigate("employee", "detail", { id: r.employee.id })}
                          aria-label={`Buka profil ${r.employee?.fullName ?? ""}`}
                        >
                          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarColor(r.employee?.fullName ?? "?"))}>
                            {initials(r.employee?.fullName ?? "?")}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13.5px] font-bold text-slate-800 dark:text-slate-100">{r.employee?.fullName ?? "—"}</span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
                            </span>
                            <span className="block truncate text-[11px] text-slate-400">
                              <span className="font-mono">{r.employee?.employeeNo ?? "—"}</span> · {r.employee?.position?.title ?? "—"}
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold", meta.cls)}>
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[300px] py-3">
                        <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{r.violation}</p>
                        {r.notes && <p className="truncate text-[11px] text-slate-400">{r.notes}</p>}
                      </TableCell>
                      <TableCell className="py-3 text-[13px] text-slate-600 dark:text-slate-300">{r.sanction ?? "—"}</TableCell>
                      <TableCell className="py-3 text-[13px] text-slate-600 dark:text-slate-300">{fmtDate(r.issuedAt)}</TableCell>
                      <TableCell className="py-3 text-[13px] text-slate-600 dark:text-slate-300">
                        {r.expiresAt ? (
                          <span className="flex items-center gap-1.5">
                            {new Date(r.expiresAt) < new Date() && <TriangleAlert className="h-3.5 w-3.5 text-slate-300" aria-label="Sudah kedaluwarsa" />}
                            {fmtDate(r.expiresAt)}
                          </span>
                        ) : (
                          "Permanen"
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <DeleteRecordButton
                          url={`/api/onevity/disciplinary?id=${r.id}`}
                          title="Hapus catatan disiplin?"
                          description={`Catatan pelanggaran "${r.violation}" akan dihapus permanen.`}
                          onDone={refresh}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <DisciplinaryDialog open={dialogOpen} onOpenChange={setDialogOpen} employeeId={null} employeeName={null} onDone={refresh} />
    </div>
  );
}
