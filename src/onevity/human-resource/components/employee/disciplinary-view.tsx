"use client";
// OneVity — KARYAWAN › Disiplin: semua catatan pelanggaran + statistik level
import { useMemo, useState } from "react";
import { useNav } from "@/onevity/shared/lib/store";
import { useApi, fmtDate, initials, avatarColor } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Scale, Plus, MessageSquareWarning, FileWarning, ShieldAlert, ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { WARNING_LEVEL_META, WARNING_LEVEL_LABEL_EN, type DisciplinaryRow } from "./types";
import { DisciplinaryDialog, DeleteRecordButton } from "./detail-dialogs";

interface DisciplinaryResp {
  records: DisciplinaryRow[];
}

export function DisciplinaryView() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<DisciplinaryResp>("/api/onevity/disciplinary");
  const [level, setLevel] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const records = useMemo(() => data?.records ?? [], [data]);
  const filtered = useMemo(() => (level === "all" ? records : records.filter((r) => r.warningLevel === level)), [records, level]);

  const levelCards = [
    { key: "Verbal", label: t("Peringatan Verbal", "Verbal Warning"), icon: MessageSquareWarning, active: level === "Verbal",
      cls: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
      activeCls: "border-amber-400 bg-amber-50/70 dark:border-amber-500/50 dark:bg-amber-500/10" },
    { key: "Written", label: t("Peringatan Tertulis", "Written Warning"), icon: FileWarning, active: level === "Written",
      cls: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
      activeCls: "border-orange-400 bg-orange-50/70 dark:border-orange-500/50 dark:bg-orange-500/10" },
    { key: "Final", label: t("Peringatan Akhir", "Final Warning"), icon: ShieldAlert, active: level === "Final",
      cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
      activeCls: "border-rose-400 bg-rose-50/70 dark:border-rose-500/50 dark:bg-rose-500/10" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("Karyawan")}
        title={t("Catatan Disiplin")}
        description={t(
          "Catatan pelanggaran seluruh karyawan — peringatan verbal, tertulis, hingga peringatan akhir.",
          "Violation records for all employees — verbal, written, and final warnings.",
        )}
        actions={
          <Button onClick={() => setDialogOpen(true)} className="h-11 gap-2 px-5 font-bold">
            <Plus className="h-4 w-4" /> {t("Catat Pelanggaran", "Record Violation")}
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
              ? "ov-border-accent ov-soft"
              : "border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900/60"
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ov-tile">
            <Scale className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-xl font-extrabold tabular-nums text-stone-900 dark:text-stone-50">{loading ? "…" : records.length}</span>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400">{t("Total Catatan", "Total Records")}</span>
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
                  : "border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900/60"
              )}
            >
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", c.cls)}>
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-xl font-extrabold tabular-nums text-stone-900 dark:text-stone-50">{loading ? "…" : n}</span>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400">{c.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* table */}
      {loading && records.length === 0 ? (
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900/60">
          <LoadingRows rows={6} />
        </div>
      ) : error ? (
        <EmptyState title={t("Gagal memuat data disiplin", "Failed to load disciplinary data")} description={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={records.length === 0 ? t("Belum ada catatan disiplin", "No disciplinary records yet") : t("Tidak ada catatan untuk level ini", "No records at this level")}
          description={records.length === 0 ? t("Rekam jejak disiplin seluruh karyawan masih bersih.", "Everyone's disciplinary record is still clean.") : t("Pilih level lain atau reset filter.", "Pick another level or reset the filter.")}
          icon={<Scale className="h-6 w-6" />}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200/80 shadow-sm dark:border-stone-800">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-stone-50/80 dark:bg-stone-900/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[220px]">{t("Karyawan")}</TableHead>
                  <TableHead className="min-w-[130px]">{t("Tingkat", "Level")}</TableHead>
                  <TableHead className="min-w-[220px]">{t("Pelanggaran", "Violation")}</TableHead>
                  <TableHead className="min-w-[180px]">{t("Sanksi", "Sanction")}</TableHead>
                  <TableHead className="min-w-[110px]">{t("Diterbitkan", "Issued")}</TableHead>
                  <TableHead className="min-w-[110px]">{t("Berlaku s/d", "Valid until")}</TableHead>
                  <TableHead className="w-12" aria-label={t("Aksi")} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const meta = WARNING_LEVEL_META[r.warningLevel] ?? WARNING_LEVEL_META.Verbal!;
                  return (
                    <TableRow key={r.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell className="py-3">
                        <button
                          className="flex items-center gap-3 text-left"
                          onClick={() => r.employee && navigate("employee", "detail", { id: r.employee.id })}
                          aria-label={t("Buka profil {name}", "Open {name}'s profile", { name: r.employee?.fullName ?? "" })}
                        >
                          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarColor(r.employee?.fullName ?? "?"))}>
                            {initials(r.employee?.fullName ?? "?")}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13.5px] font-bold text-stone-800 dark:text-stone-100">{r.employee?.fullName ?? "—"}</span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-300" aria-hidden />
                            </span>
                            <span className="block truncate text-[11px] text-stone-400">
                              <span className="font-mono">{r.employee?.employeeNo ?? "—"}</span> · {r.employee?.position?.title ?? "—"}
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold", meta.cls)}>
                          {t(meta.label, WARNING_LEVEL_LABEL_EN[r.warningLevel])}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[300px] py-3">
                        <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">{r.violation}</p>
                        {r.notes && <p className="truncate text-[11px] text-stone-400">{r.notes}</p>}
                      </TableCell>
                      <TableCell className="py-3 text-[13px] text-stone-600 dark:text-stone-300">{r.sanction ?? "—"}</TableCell>
                      <TableCell className="py-3 text-[13px] text-stone-600 dark:text-stone-300">{fmtDate(r.issuedAt)}</TableCell>
                      <TableCell className="py-3 text-[13px] text-stone-600 dark:text-stone-300">
                        {r.expiresAt ? (
                          <span className="flex items-center gap-1.5">
                            {new Date(r.expiresAt) < new Date() && <TriangleAlert className="h-3.5 w-3.5 text-stone-300" aria-label={t("Sudah kedaluwarsa", "Expired")} />}
                            {fmtDate(r.expiresAt)}
                          </span>
                        ) : (
                          t("Permanen", "Permanent")
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <DeleteRecordButton
                          url={`/api/onevity/disciplinary?id=${r.id}`}
                          title={t("Hapus catatan disiplin?", "Delete disciplinary record?")}
                          description={t(
                            "Catatan pelanggaran \"{v}\" akan dihapus permanen.",
                            "The violation record \"{v}\" will be permanently deleted.",
                            { v: r.violation },
                          )}
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
