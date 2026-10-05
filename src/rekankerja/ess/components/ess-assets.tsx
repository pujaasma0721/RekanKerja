"use client";
// RekanKerja ESS — Aset Saya (Task 27-b) =====================================
// =====================================================================
// Daftar aset perusahaan yang sedang dipegang karyawan (kartu amber:
// kode, nama, kategori, tanggal penugasan, jatuh tempo + badge Terlambat,
// catatan) + riwayat pengembalian (kondisi Baik/Rusak/Hilang).
// Read-only — penugasan & pengembalian dikelola HR (modul Aset Karyawan).
import { Package, PackageCheck, History, CalendarClock, CircleAlert, PackageOpen, AlertTriangle, Loader2 } from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { fmtDate } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EssAssetAssignment {
  id: string;
  assetId: string;
  assignedAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  returnCondition: string | null;
  notes: string | null;
  asset: { code: string; name: string; category: string; serialNumber: string | null; value: number | null };
}
interface EssAssetsData {
  active: EssAssetAssignment[];
  history: EssAssetAssignment[];
}

// ikon ringan per kategori aset (konsisten dgn modul admin)
function categoryIcon(category: string): React.ElementType {
  switch (category) {
    case "Elektronik": return Package;
    case "Kendaraan": return History;
    case "Alat Kerja": return PackageOpen;
    default: return PackageCheck;
  }
}

// Task 103-e — kategori aset disimpan DB dalam Bahasa Indonesia → peta EN
// (render t(category, EN[category] ?? category); kategori tak dikenal → raw).
const ASSET_CATEGORY_EN: Record<string, string> = {
  Elektronik: "Electronics",
  Kendaraan: "Vehicle",
  "Alat Kerja": "Work Tool",
  Seragam: "Uniform",
  Furniture: "Furniture",
  Lainnya: "Other",
};

// pil kondisi pengembalian utk riwayat (dot warna ikut kondisi — selaras titik timeline)
function ConditionPill({ cond }: { cond: string | null }) {
  const { t } = useI18n();
  const map: Record<string, { label: string; en: string; cls: string; dot: string }> = {
    Good: { label: "Baik", en: "Good", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
    Damaged: { label: "Rusak", en: "Damaged", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", dot: "bg-amber-400" },
    Lost: { label: "Hilang", en: "Lost", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  };
  const c = cond ? map[cond] : null;
  if (!c) return <span className="text-[10px] text-slate-400">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold", c.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
      {t(c.label, c.en)}
    </span>
  );
}

// kotak error kanon + tombol Coba Lagi (pola ErrorRetry ess-claims)
function ErrorRetry({ title, message, onRetry }: { title: string; message: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
      <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
      <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{title}</p>
      <p className="max-w-sm break-words text-xs text-slate-500">{message ?? t("Server tidak dapat dijangkau.", "The server could not be reached.")}</p>
      <Button onClick={onRetry} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
        <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
      </Button>
    </div>
  );
}

export function EssAssets() {
  const { t } = useI18n();
  const api = useApi<EssAssetsData>("/api/rekankerja/ess/assets");
  const active = api.data?.active ?? [];
  const history = api.data?.history ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Aset Saya", "My Assets")}
        description={t(
          "Aset perusahaan yang sedang Anda pegang — laptop, seragam, alat kerja — beserta riwayat pengembalian.",
          "Company assets you currently hold — laptops, uniforms, work equipment — plus your return history.",
        )}
      />

      {/* ===== sedang dipinjam ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Package className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Sedang Dipinjam", "Currently Holding")}
            <Badge variant="outline" className={cn(
              "text-[10px] font-bold",
              active.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
            )}>
              {t("{n} aset", "{n} asset(s)", { n: active.length })}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          {api.loading && !api.data ? (
            <LoadingRows rows={3} />
          ) : api.error && !api.data ? (
            <ErrorRetry
              title={t("Gagal memuat aset", "Failed to load assets")}
              message={api.error}
              onRetry={api.refresh}
            />
          ) : active.length === 0 ? (
            <EmptyState
              icon={<PackageOpen className="h-6 w-6" />}
              title={t("Anda tidak sedang memegang aset perusahaan", "You are not holding any company assets")}
              description={t("Aset yang ditugaskan HR kepada Anda akan tampil di sini.", "Assets assigned to you by HR will appear here.")}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              {active.map((a) => {
                const overdue = a.dueAt != null && new Date(a.dueAt).getTime() < Date.now();
                const Icon = categoryIcon(a.asset.category);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "rounded-xl border p-3.5",
                      overdue
                        ? "border-rose-200 bg-rose-50/50 dark:border-rose-500/25 dark:bg-rose-500/5"
                        : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold leading-snug text-slate-800 dark:text-slate-200">{a.asset.name}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {a.asset.code}{a.asset.serialNumber ? ` · SN ${a.asset.serialNumber}` : ""}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                            {t(a.asset.category, ASSET_CATEGORY_EN[a.asset.category] ?? a.asset.category)}
                          </Badge>
                          {a.dueAt && (
                            <Badge variant="outline" className={cn(
                              "gap-1 text-[10px] font-bold",
                              overdue
                                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400"
                                : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
                            )}>
                              {overdue ? <CircleAlert className="h-3 w-3" aria-hidden /> : <CalendarClock className="h-3 w-3" aria-hidden />}
                              {t("jatuh tempo", "due")} {fmtDate(a.dueAt)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-dashed border-slate-200 pt-2 text-[11px] text-slate-400 dark:border-slate-800">
                      <span>{t("Ditugaskan {date}", "Assigned {date}", { date: fmtDate(a.assignedAt) })}</span>
                      {a.notes && <span className="max-w-full truncate italic">"{a.notes}"</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== riwayat pengembalian ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Riwayat Pengembalian", "Return History")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          {api.loading && !api.data ? (
            <LoadingRows rows={3} />
          ) : api.error && !api.data ? (
            <ErrorRetry
              title={t("Gagal memuat riwayat", "Failed to load history")}
              message={api.error}
              onRetry={api.refresh}
            />
          ) : history.length === 0 ? (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title={t("Belum ada riwayat pengembalian", "No return history yet")}
              description={t("Riwayat pengembalian aset Anda tampil di sini setelah HR mencatatnya.", "Your asset return history appears here once HR records it.")}
            />
          ) : (
            <ol className="relative ml-2 space-y-3 border-l border-slate-200 pl-6 dark:border-slate-800">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -left-[31px] top-3.5 h-3.5 w-3.5 rounded-full border-[3px] border-white dark:border-slate-950",
                      h.returnCondition === "Good" ? "bg-brand" : h.returnCondition === "Damaged" ? "bg-amber-400" : h.returnCondition === "Lost" ? "bg-rose-500" : "bg-slate-400",
                    )}
                  />
                  <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{h.asset.name}</p>
                      <span className="font-mono text-[11px] font-semibold text-slate-400">{h.asset.code}</span>
                      <ConditionPill cond={h.returnCondition} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t("Ditugaskan {date}", "Assigned {date}", { date: fmtDate(h.assignedAt) })}
                      {h.returnedAt ? ` · ${t("dikembalikan", "returned")} ${fmtDate(h.returnedAt)}` : ""}
                    </p>
                    {h.notes && (
                      <p className="mt-1 rounded-lg bg-slate-100/70 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        “{h.notes}”
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
