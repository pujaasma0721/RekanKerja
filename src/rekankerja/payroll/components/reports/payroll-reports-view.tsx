"use client";
// RekanKerja Payroll — LAPORAN PAYROLL (view utama) =========================
// Alur 3 tahap: KATALOG (kartu per grup) → PARAMETER (form per laporan) →
// DOKUMEN (cetak/PDF-ready dengan area cetak #rk-print-area + toolbar Cetak /
// Unduh XLSX). Kartu katalog memakai tema grup (bar gradien 3px + blok ikon
// 44px + badge audiens + hover lift — pola T111).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowRight, ChevronLeft, Printer, FileSpreadsheet, FileDown, RefreshCw,
  Banknote, ArrowLeftRight, Calculator,
} from "lucide-react";
import { REPORT_GROUPS, GROUP_THEMES, reportById, type ReportDef } from "./catalog";
import type { Pools } from "./params";
import { ReportParamsForm, type ParamValues } from "./report-params-form";
import { PayslipDoc, RegisterDoc, BankTransferDoc } from "./documents/documents-g1";
import { Pph21MonthlyDoc, Pph26Doc } from "./documents/documents-g2";
import { BuktiPotongA1Doc } from "./documents/bukti-potong-a1";
import { BpjsTkDoc, BpjsKesehatanDoc, TaperaDoc } from "./documents/documents-g3";
import { VarianceDoc, TcowDoc, OvertimeSheetDoc } from "./documents/documents-g4";

type Stage = "catalog" | "params" | "doc";

// data dokumen = payload API (di-parse oleh komponen dokumen masing-masing)
type DocData = Record<string, unknown> & { report?: string };

export function PayrollReportsPage() {
  const { t } = useI18n();
  const poolsApi = useApi<Pools>("/api/rekankerja/payroll-reports/documents?_params=1");
  const pools = poolsApi.data ?? null;

  const [stage, setStage] = useState<Stage>("catalog");
  const [selected, setSelected] = useState<ReportDef | null>(null);
  const [values, setValues] = useState<ParamValues>({});
  const [docData, setDocData] = useState<DocData | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const openParams = (r: ReportDef) => {
    setSelected(r);
    setDocError(null);
    setStage("params");
  };

  /** Susun query dari parameter → ambil payload dokumen. */
  const generate = async (v: ParamValues) => {
    if (!selected) return;
    setValues(v);
    setDocLoading(true);
    setDocError(null);
    try {
      const qs = new URLSearchParams({ report: selected.id });
      if (v.run) qs.set("runId", v.run);
      if (v.period) qs.set("periodId", v.period);
      if (v.year) qs.set("year", v.year);
      if (v.employee) {
        if (selected.id === "r11") qs.set("lineId", v.employee);
        else qs.set("employeeId", v.employee);
      }
      if (v.bank && v.bank !== "all") qs.set("bank", v.bank);
      if (v.units) qs.set("unit", v.units);
      const data = await apiSend<DocData>(`/api/rekankerja/payroll-reports/documents?${qs.toString()}`, "GET");
      setDocData(data);
      setStage("doc");
    } catch (e) {
      setDocError(e instanceof Error ? e.message : "Gagal menyusun dokumen");
    } finally {
      setDocLoading(false);
    }
  };

  const backToParams = () => {
    setStage("params");
    setDocData(null);
  };
  const backToCatalog = () => {
    setStage("catalog");
    setSelected(null);
    setDocData(null);
    setValues({});
    poolsApi.refresh();
  };

  return (
    <div className="pb-10">
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Laporan Payroll", "Payroll Reports")}
        description={t(
          "12 dokumen laporan siap distribusi dalam 4 grup: penggajian internal, pajak PPh 21/26, iuran BPJS/Tapera, dan analisis biaya tenaga kerja — siap cetak & PDF.",
          "12 distribution-ready report documents in 4 groups: internal payroll, PPh 21/26 taxes, BPJS/Tapera contributions, and labor cost analysis — print & PDF ready.",
        )}
        actions={stage === "doc" ? undefined : (
          <div className="flex items-center gap-2">
            {t("Periode tersedia", "Periods available")}: <strong className="font-bold">{pools?.periods.length ?? "…"}</strong>
          </div>
        )}
      />

      {/* ================================================== TAHAP 1: KATALOG */}
      {stage === "catalog" && (
        <>
          {poolsApi.loading && <LoadingCards cards={6} />}
          {poolsApi.error && (
            <EmptyState
              title={t("Gagal memuat data", "Failed to load data")}
              description={poolsApi.error}
              icon={RefreshCw}
            />
          )}
          {pools && pools.runs.length === 0 && (
            <EmptyState
              title={t("Belum ada run payroll terhitung", "No calculated payroll runs yet")}
              description={t(
                "Laporan dokumen membutuhkan minimal satu run berstatus Calculated / Confirmed / Paid. Jalankan proses payroll terlebih dahulu.",
                "Document reports require at least one Calculated / Confirmed / Paid run. Run a payroll process first.",
              )}
              icon={Banknote}
            />
          )}
          {pools && pools.runs.length > 0 && (
            <div className="space-y-8">
              {REPORT_GROUPS.map((g) => {
                const theme = GROUP_THEMES[g.id];
                return (
                  <section key={g.id} aria-labelledby={`grp-${g.id}`}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className={cn("h-1 w-10 rounded-full", theme.bar)} aria-hidden />
                      <div className="min-w-0">
                        <h2 id={`grp-${g.id}`} className="text-[15px] font-bold leading-tight">
                          {t(g.titleId, g.titleEn)}
                        </h2>
                        <p className="text-xs text-muted-foreground">{t(g.descId, g.descEn)}</p>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {g.reports.map((r) => (
                        <ReportCard key={r.id} report={r} theme={theme} onOpen={() => openParams(r)} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ================================================ TAHAP 2: PARAMETER */}
      {stage === "params" && selected && (
        <ReportParamsForm
          report={selected}
          pools={pools}
          submitting={docLoading}
          error={docError}
          onBack={backToCatalog}
          onSubmit={generate}
        />
      )}

      {/* ================================================== TAHAP 3: DOKUMEN */}
      {stage === "doc" && selected && docData && (
        <div>
          {/* toolbar (tidak ikut tercetak) */}
          <div className="rk-noprint mb-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={backToParams}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t("Ubah Parameter", "Change Parameters")}
            </Button>
            <Button variant="outline" size="sm" onClick={backToCatalog}>
              <ArrowLeftRight className="mr-1 h-4 w-4" />
              {t("Katalog Laporan", "Report Catalog")}
            </Button>
            <div className="flex-1" />
            <ParamChips report={selected} values={values} pools={pools} />
            <XlsxExportButton report={selected} values={values} />
            <Button size="sm" className="bg-brand text-white hover:bg-brand-dark" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              {t("Cetak / Simpan PDF", "Print / Save PDF")}
            </Button>
          </div>
          {/* kertas dokumen — scroll horizontal di layar kecil (print tetap utuh) */}
          <div className="rk-doc-scroll overflow-x-auto pb-2">
            <DocRenderer report={selected} data={docData} />
          </div>
          <div className="rk-noprint mt-4 flex justify-center">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              {t("Cetak / Simpan PDF", "Print / Save PDF")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------ kartu katalog ------------

function ReportCard({ report, theme, onOpen }: { report: ReportDef; theme: { bar: string; iconBlock: string; badge: string }; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-5 pt-6 text-left shadow-sm transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-lg hover:ring-1 hover:ring-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-[3px]", theme.bar)} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", theme.iconBlock)}>
          <report.icon className="h-6 w-6" strokeWidth={2} />
        </div>
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-muted-foreground">
          {report.no}
        </span>
      </div>
      <h3 className="mt-3 text-[15px] font-bold leading-snug">{t(report.titleId, report.titleEn)}</h3>
      <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {t(report.descId, report.descEn)}
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        {report.audience.map((a) => (
          <span key={a} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", theme.badge)}>
            {a}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-[12px] font-bold text-brand-deep dark:text-brand/90">
        {t("Susun Laporan", "Generate Report")}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </div>
    </button>
  );
}

// -------------------------------------------- chips parameter + ekspor -------

function ParamChips({ report, values, pools }: { report: ReportDef; values: ParamValues; pools: Pools | null }) {
  const { t } = useI18n();
  const run = pools?.runs.find((r) => r.id === values.run);
  const period = pools?.periods.find((p) => p.id === values.period);
  const items: string[] = [];
  if (run) items.push(`${run.runNo} · ${run.periodName}`);
  else if (period) items.push(period.name);
  if (values.year) items.push(`${t("Tahun", "Year")} ${values.year}`);
  if (values.bank && values.bank !== "all") items.push(values.bank);
  if (values.units) items.push(...values.units.split(",").filter(Boolean));
  return (
    <div className="hidden max-w-[46%] flex-wrap items-center justify-end gap-1.5 md:flex">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{report.no}</span>
      {items.slice(0, 4).map((it) => (
        <span key={it} className="truncate rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {it}
        </span>
      ))}
    </div>
  );
}

/** Unduh XLSX → endpoint ekspor existing (register & rekap BPJS). */
function XlsxExportButton({ report, values }: { report: ReportDef; values: ParamValues }) {
  const { t } = useI18n();
  const href = useMemo(() => {
    if (report.id === "r12" && values.run) return `/api/rekankerja/payroll-reports/monthly?runId=${encodeURIComponent(values.run)}&export=xlsx`;
    if (report.id === "r31" && values.run) return `/api/rekankerja/payroll-reports/bpjs?runId=${encodeURIComponent(values.run)}&export=xlsx`;
    if (report.id === "r22" && values.year) return `/api/rekankerja/payroll-spt?year=${encodeURIComponent(values.year)}&export=a1`;
    return null;
  }, [report.id, values.run, values.year]);
  if (!href) return null;
  const isCsv = report.id === "r22";
  return (
    <a href={href} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[13px] font-medium shadow-sm transition-colors hover:bg-accent">
      {isCsv ? <FileDown className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
      {isCsv ? t("CSV e-SPT (DJP)", "e-SPT CSV (DJP)") : t("Unduh XLSX", "Download XLSX")}
    </a>
  );
}

// ------------------------------------------------ renderer dokumen ----------

function DocRenderer({ report, data }: { report: ReportDef; data: DocData }) {
  switch (report.id) {
    case "r11": return <PayslipDoc data={data as unknown as Parameters<typeof PayslipDoc>[0]["data"]} />;
    case "r12": return <RegisterDoc data={data as unknown as Parameters<typeof RegisterDoc>[0]["data"]} />;
    case "r13": return <BankTransferDoc data={data as unknown as Parameters<typeof BankTransferDoc>[0]["data"]} />;
    case "r21": return <Pph21MonthlyDoc data={data as unknown as Parameters<typeof Pph21MonthlyDoc>[0]["data"]} />;
    case "r22": return <BuktiPotongA1Doc data={data as unknown as Parameters<typeof BuktiPotongA1Doc>[0]["data"]} />;
    case "r23": return <Pph26Doc data={data as unknown as Parameters<typeof Pph26Doc>[0]["data"]} />;
    case "r31": return <BpjsTkDoc data={data as unknown as Parameters<typeof BpjsTkDoc>[0]["data"]} />;
    case "r32": return <BpjsKesehatanDoc data={data as unknown as Parameters<typeof BpjsKesehatanDoc>[0]["data"]} />;
    case "r33": return <TaperaDoc data={data as unknown as Parameters<typeof TaperaDoc>[0]["data"]} />;
    case "r41": return <VarianceDoc data={data as unknown as Parameters<typeof VarianceDoc>[0]["data"]} />;
    case "r42": return <TcowDoc data={data as unknown as Parameters<typeof TcowDoc>[0]["data"]} />;
    case "r43": return <OvertimeSheetDoc data={data as unknown as Parameters<typeof OvertimeSheetDoc>[0]["data"]} />;
    default: return <EmptyState title="—" description={report.id} icon={Calculator} />;
  }
}
