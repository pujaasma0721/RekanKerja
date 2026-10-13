"use client";
// RekanKerja Performance — Pengaturan modul (P0): penomoran dokumen (PER/PRB/
// PIP/MER), bobot default 70|20|10, jendela banding, retensi arsip
// (DEVELOPMENT-PLAN-PERFORMANCE.md §14.2 menu Pengaturan + §23 register).
import { useEffect, useState } from "react";
import { apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Settings, FileText, Percent, Clock, Archive } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

interface Setting {
  id: string;
  docPrefixes: string;
  defWeights: string;
  appealDays: number;
  retentionYears: number;
}

export function PerformanceSettingsPage() {
  const { t } = useI18n();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState<null | { docPrefixes: string; defWeights: string; appealDays: string; retentionYears: string }>(null);
  const [busy, setBusy] = useState(false);
  const [nextNo, setNextNo] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/rekankerja/performance/settings");
        const j = (await res.json()) as { setting?: Setting; error?: string };
        if (!res.ok) throw new Error(j.error ?? "unknown");
        setSetting(j.setting ?? null);
        if (j.setting) {
          setForm({
            docPrefixes: j.setting.docPrefixes,
            defWeights: j.setting.defWeights,
            appealDays: String(j.setting.appealDays),
            retentionYears: String(j.setting.retentionYears),
          });
        }
        // preview nomor berikutnya per prefix
        const prefixes = (j.setting?.docPrefixes ?? "PER|PRB|PIP|MER").split("|");
        const previews: Record<string, string> = {};
        for (const p of prefixes) {
          try {
            const r2 = await fetch(`/api/rekankerja/performance/settings?previewNo=${p}`);
            const j2 = (await r2.json()) as { nextNo?: string };
            if (j2.nextNo) previews[p] = j2.nextNo;
          } catch {
            /* preview best-effort */
          }
        }
        setNextNo(previews);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "unknown");
      }
    })();
  }, []);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const res = await apiSend<{ setting: Setting }>("/api/rekankerja/performance/settings", "POST", {
        docPrefixes: form.docPrefixes,
        defWeights: form.defWeights,
        appealDays: Number(form.appealDays),
        retentionYears: Number(form.retentionYears),
      });
      setSetting(res.setting);
      toast.success(t("Pengaturan kinerja disimpan", "Performance settings saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  const wSum = form ? form.defWeights.split("|").map(Number).reduce((a, b) => (Number.isFinite(b) ? a + b : a), 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance · P0"
        title={t("Pengaturan Kinerja", "Performance Settings")}
        description={t(
          "Penomoran dokumen penilaian, bobot default, jendela banding karyawan, dan retensi arsip hasil.",
          "Appraisal document numbering, default weights, employee appeal window, and result archive retention.",
        )}
      />

      {loadErr && <EmptyState icon={Settings} title={t("Gagal memuat pengaturan", "Failed to load settings")} description={loadErr} />}

      {!setting && !loadErr ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {setting && form && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(nextNo).map(([p, n]) => (
              <Card key={p} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                    <FileText className="h-4 w-4" />
                    <span className="text-xs font-medium">{t(`Nomor berikutnya ${p}`, `Next ${p} number`)}</span>
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">{n}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="max-w-2xl border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="grid gap-4 p-4 sm:p-6">
              <div className="grid gap-1.5">
                <Label className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  {t("Prefix Dokumen (PER|PRB|PIP|MER)", "Document Prefixes (PER|PRB|PIP|MER)")}
                </Label>
                <Input value={form.docPrefixes} onChange={(e) => setForm({ ...form, docPrefixes: e.target.value })} placeholder={t("PER|PRB|PIP|MER", "PER|PRB|PIP|MER")} />
                <p className="text-xs text-slate-500">
                  {t("Penilaian · Masa Percobaan · PIP · Merit — 4 kode 2–5 huruf.", "Appraisal · Probation · PIP · Merit — 4 codes, 2–5 letters each.")}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label className="flex items-center gap-1.5">
                  <Percent className="h-3.5 w-3.5" />
                  {t("Bobot Default (KPI|Kompetensi|Nilai Inti)", "Default Weights (KPI|Competency|Core)")}
                </Label>
                <Input value={form.defWeights} onChange={(e) => setForm({ ...form, defWeights: e.target.value })} placeholder="70|20|10" />
                <p className={"font-mono text-xs " + (wSum === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  Σ {wSum}% {wSum === 100 ? "✓" : t("— harus 100", "— must be 100")}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {t("Jendela Banding (hari)", "Appeal Window (days)")}
                  </Label>
                  <Input type="number" value={form.appealDays} onChange={(e) => setForm({ ...form, appealDays: e.target.value })} />
                  <p className="text-xs text-slate-500">{t("Setelah publikasi hasil (default 7).", "After result publication (default 7).")}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Archive className="h-3.5 w-3.5" />
                    {t("Retensi Arsip (tahun)", "Archive Retention (years)")}
                  </Label>
                  <Input type="number" value={form.retentionYears} onChange={(e) => setForm({ ...form, retentionYears: e.target.value })} />
                  <p className="text-xs text-slate-500">{t("Riwayat hasil penilaian disimpan (default 5).", "Appraisal result history kept (default 5).")}</p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={save} disabled={busy || wSum !== 100}>
                  {busy ? t("Menyimpan…", "Saving…") : t("Simpan Pengaturan", "Save Settings")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
