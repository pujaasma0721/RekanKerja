"use client";
// P0-PERF — Pengaturan modul Performance (§17 settings): penomoran dokumen,
// bobot default, jendela banding, retensi arsip.
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Save, Settings } from "lucide-react";

interface PerfSetting {
  id: string;
  docPrefixes: string;
  defWeights: string;
  appealDays: number;
  retentionYears: number;
}

export function PerformanceSettingsPage() {
  const { t } = useI18n();
  const api = useApi<{ setting: PerfSetting }>("/api/rekankerja/performance/settings");
  const [form, setForm] = useState({ docPrefixes: "PER|PRB|PIP|MER", defWeights: "70|20|10", appealDays: "7", retentionYears: "5" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = api.data?.setting;
    if (s) {
      setForm({
        docPrefixes: s.docPrefixes,
        defWeights: s.defWeights,
        appealDays: String(s.appealDays),
        retentionYears: String(s.retentionYears),
      });
    }
  }, [api.data]);

  const save = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/settings", "PATCH", {
        docPrefixes: form.docPrefixes,
        defWeights: form.defWeights,
        appealDays: Number(form.appealDays),
        retentionYears: Number(form.retentionYears),
      });
      toast.success(t("Pengaturan kinerja disimpan", "Performance settings saved"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Penilaian Kinerja")}
        title={t("Pengaturan Kinerja", "Performance Settings")}
        description={t(
          "Penomoran dokumen, bobot komponen default, jendela banding karyawan, dan retensi arsip hasil penilaian.",
          "Document numbering, default component weights, employee appeal window, and appraisal archive retention.",
        )}
        actions={(
          <Button onClick={save} disabled={busy || api.loading}>
            <Save className="h-4 w-4" aria-hidden /> {busy ? t("Menyimpan…", "Saving…") : t("Simpan")}
          </Button>
        )}
      />

      <Card className="max-w-2xl">
        <CardContent className="grid gap-4 p-6">
          {api.loading && !api.data ? (
            <p className="text-sm text-slate-500">{t("Memuat…", "Loading…")}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>{t("Penomoran Dokumen (4 prefix)", "Document Numbering (4 prefixes)")}</Label>
                <Input value={form.docPrefixes} onChange={(e) => setForm({ ...form, docPrefixes: e.target.value })} placeholder={t("PER|PRB|PIP|MER", "PER|PRB|PIP|MER")} className="font-mono" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t(
                    "Urutan: Penilaian | Masa Percobaan | PIP | Merit — menjadi PER-2026-0001, PRB-2026-0001, dst.",
                    "Order: Appraisal | Probation | PIP | Merit — yields PER-2026-0001, PRB-2026-0001, etc.",
                  )}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>{t("Bobot Komponen Default", "Default Component Weights")}</Label>
                <Input value={form.defWeights} onChange={(e) => setForm({ ...form, defWeights: e.target.value })} placeholder="70|20|10" className="font-mono" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t(
                    "Format: KPI | Kompetensi | Nilai inti (jumlah = 100). Dapat dioverride per siklus dan per template jabatan.",
                    "Format: KPI | Competency | Core values (sum = 100). Can be overridden per cycle and per job template.",
                  )}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("Jendela Banding (hari)", "Appeal Window (days)")}</Label>
                  <Input type="number" min={1} max={60} value={form.appealDays} onChange={(e) => setForm({ ...form, appealDays: e.target.value })} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("Lamanya waktu karyawan dapat mengajukan banding sejak publikasi hasil (D6).", "How long an employee may appeal after results are published (D6).")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Retensi Arsip (tahun)", "Archive Retention (years)")}</Label>
                  <Input type="number" min={1} max={30} value={form.retentionYears} onChange={(e) => setForm({ ...form, retentionYears: e.target.value })} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("Lama penyimpanan hasil penilaian sebelum diarsipkan permanen.", "How long appraisal results are kept before permanent archiving.")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <Settings className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  {t(
                    "Perubahan di sini berlaku untuk dokumen BARU; nomor yang sudah terbit tidak diubah. Bobot default dipakai bila siklus tidak meng-override.",
                    "Changes here apply to NEW documents; issued numbers are not altered. Default weights apply when a cycle does not override them.",
                  )}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
