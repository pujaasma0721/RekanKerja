"use client";
// OneVity Payroll — Data Gaji Karyawan: NPWP, PTKP, metode proses, template upah per karyawan
// Task 49: PTKP bisa "auto" — diturunkan dari data keluarga (pasangan → K,
// tanggungan Child/Parent maks 3) + sinkronisasi massal + refresh tahunan 1 Jan.
// Task 50: PTKP efektif = SNAPSHOT hasil refresh tahunan — perubahan keluarga
// tengah tahun (tambah/hapus dependen) TIDAK mengubah payroll; hanya berlaku
// pada refresh 1 Januari tahun berikutnya (hint "→ {s} pada 1 Jan {yr+1}").
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { IdCard, Pencil, Search, Wallet, Users, RefreshCw, ArrowRight, Info, History } from "lucide-react";
import { ProfileRow, PtkpSyncResponse, TAX_STATUS_OPTIONS, TAX_STATUS_OPTION_EN, TemplateRow, PayrollHistoryResponse } from "@/onevity/payroll/components/payroll-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

/**
 * Task 58 — GUARD TAMPILAN (defense in depth): nilai teks PII dari respons
 * API TIDAK PERNAH boleh dirender bila masih berupa ciphertext (enc:…).
 * Backend sudah self-healing (unwrapDeep field-crypto — sisa double-encryption
 * historis dilepas otomatis di batas serializer); guard ini menjaga bila ada
 * respons stale/cache lama yang lolos — tampilkan kosong, bukan karakter enc:.
 */
function safeText(v: string | null | undefined): string {
  return v != null && !v.startsWith("enc:") ? v : "";
}

export function PayrollProfilesPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data, loading, refresh } = useApi<{ employees: ProfileRow[] }>(`/api/onevity/payroll-profiles${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const templatesApi = useApi<{ templates: TemplateRow[] }>("/api/onevity/wage-templates");
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  // Task 64d — riwayat gaji & template per karyawan (dialog dari tombol baris).
  const [histRow, setHistRow] = useState<ProfileRow | null>(null);

  const rows = data?.employees ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Data Gaji Karyawan")}
        description={t("NPWP, status PTKP (penentu pajak), metode Gross-to-Net / Net-to-Gross, template upah, dan rekening bank per karyawan", "NPWP, PTKP status (tax determinant), Gross-to-Net / Net-to-Gross method, wage template, and bank account per employee")}
      />

      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari nama atau nomor karyawan…", "Search by name or employee number…")} className="pl-9" />
            </div>
            <Button variant="outline" onClick={() => setSyncOpen(true)} className="gap-1.5 whitespace-nowrap text-xs font-bold">
              <Users className="h-3.5 w-3.5" />
              {t("Sinkronkan PTKP dari Keluarga", "Sync PTKP from Family")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : rows.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada karyawan", "No employees")} description={t("Belum ada karyawan aktif dengan profil payroll.", "No active employees with a payroll profile yet.")} icon={<IdCard className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Gaji Pokok")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("NPWP")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("PTKP")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Metode", "Method")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Template")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Bank")}</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const auto = r.profile?.ptkpSource === "auto";
                    // T50: auto + beda saran → perubahan TERTUNDA (berlaku 1 Jan
                    // tahun depan) — bukan perubahan hari ini.
                    const pending = auto && !!r.profile && r.ptkpSuggestion.taxStatus !== r.profile!.taxStatus;
                    const mismatch = !auto && r.profile && r.ptkpSuggestion.taxStatus !== r.profile.taxStatus;
                    const nextYear = new Date().getFullYear() + 1;
                    return (
                      <TableRow key={r.employeeId} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                        <TableCell>
                          <p className="text-[13px] font-bold">{r.fullName}</p>
                          <p className="font-mono text-[10px] text-stone-400">{r.employeeNo} · {r.positionName ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-xs font-bold">{fmtIDR(r.baseSalary)}</TableCell>
                        <TableCell>
                          {r.profile?.npwp ? (
                            <span className="font-mono text-[11px] font-semibold">{safeText(r.profile.npwp) || t("—", "—")}</span>
                          ) : (
                            <Badge variant="outline" className="border-rose-300 bg-rose-50 text-[9px] font-bold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">{t("Non-NPWP +20%", "Non-NPWP +20%")}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-bold">{r.profile
                                ? t(
                                  TAX_STATUS_OPTIONS.find((o) => o.value === r.profile!.taxStatus)?.label ?? r.profile.taxStatus,
                                  TAX_STATUS_OPTION_EN[r.profile.taxStatus],
                                )
                                : "—"}</span>
                              {r.profile && (
                                <Badge variant="outline" className={cn("h-4 px-1 text-[8px] font-bold",
                                  auto
                                    ? "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85"
                                    : "border-stone-300 bg-stone-50 text-stone-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400")}>
                                  {auto ? t("Auto", "Auto") : "Manual"}
                                </Badge>
                              )}
                            </div>
                            <span className="text-[10px] text-stone-400">{r.profile ? t("PTKP {v}/thn", "PTKP {v}/yr", { v: fmtIDR(r.profile.ptkpValue) }) : ""}</span>
                            {mismatch && (
                              <span className="text-[10px] font-bold text-brand dark:text-brand/85">
                                {t("Saran keluarga: {s}", "Family suggests: {s}", { s: r.ptkpSuggestion.taxStatus })}
                              </span>
                            )}
                            {pending && (
                              <span className="text-[10px] font-bold text-brand dark:text-brand/85">
                                {t("→ {s} pada 1 Jan {y}", "→ {s} on Jan 1, {y}", { s: r.ptkpSuggestion.taxStatus, y: nextYear })}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[9px] font-bold", r.profile?.processMethod === "NetToGross" ? "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85" : "")}>
                            {r.profile?.processMethod === "NetToGross" ? "NetToGross" : "GrossToNet"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-semibold">{r.profile?.wageTemplateName ?? "—"}</TableCell>
                        <TableCell className="text-xs text-stone-500">
                          {r.profile?.bankName ? (
                            <div className="flex items-center gap-1">
                              <Wallet className="h-3 w-3 text-stone-400" />
                              <span>{r.profile.bankName} <span className="font-mono text-[10px] text-stone-400">{safeText(r.profile.bankAccount)}</span></span>
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setHistRow(r)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label={t("Lihat riwayat gaji & template", "View salary & template history")}>
                              <History className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setEditing(r)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label={t("Edit profil payroll", "Edit payroll profile")}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProfileDialog row={editing} templates={templatesApi.data?.templates ?? []} onClose={() => { setEditing(null); refresh(); }} />
      <SyncPtkpDialog open={syncOpen} onClose={() => { setSyncOpen(false); refresh(); }} />
      <PayrollHistoryDialog row={histRow} onClose={() => setHistRow(null)} />
    </div>
  );
}

// ============ Task 64d — Dialog Riwayat Gaji & Template Upah per karyawan ============

function PayrollHistoryDialog({ row, onClose }: { row: ProfileRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<PayrollHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState("");

  const empId = row?.employeeId ?? "closed";
  if (key !== empId) {
    setKey(empId);
    setData(null);
    if (row) {
      setLoading(true);
      fetch(`/api/onevity/payroll-profiles?history=1&employeeId=${row.employeeId}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("gagal memuat"))))
        .then((d: PayrollHistoryResponse) => setData(d))
        .catch(() => toast.error(t("Gagal memuat riwayat", "Failed to load history")))
        .finally(() => setLoading(false));
    }
  }

  const fmtPeriod = (from: string, to: string | null) =>
    `${new Date(from).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} — ${to ? new Date(to).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : t("Sekarang", "Present")}`;
  const reasonLabel = (r: string | null) =>
    r === "Initial" ? t("Penempatan Awal", "Initial placement")
    : r === "Promotion" ? t("Promosi", "Promotion")
    : r === "Demotion" ? t("Demosi", "Demotion")
    : r === "Transfer" ? t("Transfer", "Transfer")
    : r === "Mutation" ? t("Mutasi", "Mutation")
    : r === "SalaryAdjustment" ? t("Penyesuaian Upah", "Salary adjustment")
    : r === "ChangeStatus" ? t("Perubahan Status", "Status change")
    : r === "ContractRenewal" ? t("Perpanjangan Kontrak", "Contract renewal")
    : r === "ManualEdit" ? t("Perubahan Manual", "Manual edit")
    : (r ?? "—");

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 ov-text-accent" />
            {t("Riwayat Gaji & Template", "Salary & Template History")}
          </DialogTitle>
        </DialogHeader>
        {!row ? null : loading || !data ? (
          <p className="py-6 text-center text-sm text-stone-400">{t("Memuat…", "Loading…")}</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-bold">{data.employee.fullName}</p>
              <p className="font-mono text-[10px] text-stone-400">{data.employee.employeeNo}</p>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">{t("Riwayat Gaji Pokok (per periode berlaku)", "Base Salary History (per effective period)")}</p>
              {data.salary.length === 0 ? (
                <p className="text-xs text-stone-400">{t("Belum ada data.", "No data yet.")}</p>
              ) : (
                <ol className="relative ml-2 space-y-0 border-l border-stone-200 pl-4 dark:border-stone-800">
                  {data.salary.map((s, i) => (
                    <li key={s.id} className="relative pb-3 last:pb-0">
                      <span className={cn("absolute -left-[22px] top-1 h-3 w-3 rounded-full", i === data.salary.length - 1 ? "ov-fill" : "border-2 border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900")} />
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[11px] font-bold text-stone-600 dark:text-stone-300">{fmtPeriod(s.validFrom, s.validTo)}</span>
                        <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-bold">{reasonLabel(s.reason)}</Badge>
                        {s.sourceDocNo && <span className="font-mono text-[10px] text-stone-400">{s.sourceDocNo}</span>}
                      </div>
                      <p className="text-sm font-bold">{fmtIDR(s.baseSalary)}<span className="ml-1.5 text-[10px] font-normal text-stone-400">{s.positionName ?? ""}{s.officeCode ? ` · ${s.officeCode}` : ""}</span></p>
                      {s.notes && <p className="text-[10px] italic text-stone-400">{s.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">{t("Riwayat Template Upah (per periode berlaku)", "Wage Template History (per effective period)")}</p>
              {data.templates.length === 0 ? (
                <p className="text-xs text-stone-400">{t("Belum ada data.", "No data yet.")}</p>
              ) : (
                <ol className="relative ml-2 space-y-0 border-l border-stone-200 pl-4 dark:border-stone-800">
                  {data.templates.map((h, i) => (
                    <li key={h.id} className="relative pb-3 last:pb-0">
                      <span className={cn("absolute -left-[22px] top-1 h-3 w-3 rounded-full", i === data.templates.length - 1 ? "ov-fill" : "border-2 border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900")} />
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[11px] font-bold text-stone-600 dark:text-stone-300">{fmtPeriod(h.validFrom, h.validTo)}</span>
                        <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-bold">{reasonLabel(h.reason)}</Badge>
                        {h.sourceDocNo && <span className="font-mono text-[10px] text-stone-400">{h.sourceDocNo}</span>}
                      </div>
                      <p className="text-sm font-bold">{h.templateName ?? t("(tanpa template)", "(no template)")}<span className="ml-1.5 text-[10px] font-normal text-stone-400">{h.templateCode ?? ""}</span></p>
                      {h.notes && <p className="text-[10px] italic text-stone-400">{h.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <p className="text-[10px] text-stone-400">{t("Run payroll membaca versi yang berlaku pada periode — perubahan efektif di tengah bulan otomatis membentuk segmen prorate.", "Payroll runs read the version effective for the period — mid-month changes automatically form prorate segments.")}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Dialog: Sinkronisasi massal PTKP dari data keluarga ============

function SyncPtkpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<PtkpSyncResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [key, setKey] = useState("");

  // Muat pratinjau (dryRun) setiap kali dialog dibuka.
  const openKey = open ? "open" : "closed";
  if (key !== openKey) {
    setKey(openKey);
    setPreview(null);
    if (open) {
      setBusy(true);
      apiSend("/api/onevity/payroll-profiles", "POST", { action: "sync-ptkp", dryRun: true })
        .then((r) => setPreview(r as PtkpSyncResponse))
        .catch((e) => toast.error((e as Error).message))
        .finally(() => setBusy(false));
    }
  }

  const apply = async () => {
    setApplying(true);
    try {
      const r = (await apiSend("/api/onevity/payroll-profiles", "POST", { action: "sync-ptkp", dryRun: false })) as PtkpSyncResponse;
      toast.success(t(
        "PTKP disinkronkan (koreksi admin) — {changed} dari {total} karyawan mengikuti data keluarga terkini",
        "PTKP synced (admin correction) — {changed} of {total} employees now follow current family data",
        { changed: r.changed, total: r.employees },
      ));
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setApplying(false); }
  };

  const fmtStatus = (s: string) => t(TAX_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s, TAX_STATUS_OPTION_EN[s] ?? s);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] sm:max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4 ov-text-accent" /> {t("Sinkronkan PTKP dari Data Keluarga", "Sync PTKP from Family Data")}</DialogTitle>
        </DialogHeader>
        {busy || !preview ? (
          <div className="py-8 text-center text-sm text-stone-400">{t("Memuat pratinjau…", "Loading preview…")}</div>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-xl border border-stone-200 p-3 text-xs dark:border-stone-700">
              <p className="font-bold">{t("Pratinjau perubahan", "Change preview")}</p>
              <p className="mt-1 text-stone-500">
                {t(
                  "{total} karyawan aktif · {changed} akan berubah status PTKP · {auto} dialihkan ke sumber otomatis",
                  "{total} active employees · {changed} will change PTKP status · {auto} switched to automatic source",
                  { total: preview.employees, changed: preview.changed, auto: preview.autoEnabled },
                )}
              </p>
            </div>
            {preview.preservedKi.length > 0 && (
              <div className="rounded-xl border border-brand/25 bg-brand/10 p-3 text-[11px] dark:border-brand/30 dark:bg-brand/10">
                <p className="font-bold text-brand-deep dark:text-brand/85">{t("K/I dibiarkan manual ({n} karyawan)", "K/I kept manual ({n} employees)", { n: preview.preservedKi.length })}</p>
                <p className="mt-0.5 text-brand-deep/80 dark:text-brand/85/80">
                  {t("Status K/I (penghasilan pasangan digabung) tidak dapat diturunkan dari data keluarga — diatur manual per karyawan.", "K/I status (spouse income combined) cannot be derived from family data — set manually per employee.")}
                </p>
              </div>
            )}
            {preview.changes.length > 0 ? (
              <div className="rounded-xl border border-stone-200 dark:border-stone-700">
                <p className="border-b border-stone-100 px-3 py-2 text-[11px] font-bold dark:border-stone-800">{t("Karyawan yang berubah", "Employees changing")}</p>
                <div className="max-h-48 overflow-y-auto p-2">
                  {preview.changes.map((c) => (
                    <div key={c.employeeId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <span className="min-w-0 flex-1 truncate font-semibold">{c.employeeName}</span>
                      <span className="font-mono text-stone-400">{c.from}</span>
                      <ArrowRight className="h-3 w-3 text-stone-400" />
                      <span className="font-mono font-bold ov-text-accent">{c.to}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-brand/25 bg-brand/10 p-3 text-[11px] font-bold text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85">
                {t("Semua status PTKP sudah sesuai data keluarga — tidak ada perubahan.", "All PTKP statuses already match family data — no changes.")}
              </div>
            )}
            <div className="flex items-start gap-2 rounded-xl bg-stone-50 p-3 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/50">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <p>
                {t(
                  "Sumber otomatis menghitung PTKP dari data keluarga (relasi Pasangan → menikah; anak/ortu tanggungan maks 3). Perubahan data keluarga TIDAK langsung mengubah PTKP payroll — PTKP efektif adalah snapshot hasil refresh 1 Januari; penambahan/pengurangan dependen di tengah tahun berlaku tahun berikutnya. Tombol ini menerapkan sinkronisasi segera sebagai koreksi manual admin (mis. data keluarga baru saja dikoreksi).",
                  "Automatic source derives PTKP from family data (Spouse relation → married; dependent children/parents max 3). Family data changes do NOT immediately change payroll PTKP — the effective PTKP is a snapshot refreshed every January 1st; mid-year dependent additions/reductions take effect the following year. This button applies the sync immediately as an admin correction (e.g. family data was just fixed).",
                )}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={apply} disabled={busy || !preview || applying} className="font-bold">
            {applying ? t("Menerapkan…", "Applying…") : t("Terapkan Sinkronisasi", "Apply Sync")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Dialog: Data payroll per karyawan ============

function ProfileDialog({ row, templates, onClose }: { row: ProfileRow | null; templates: TemplateRow[]; onClose: () => void }) {
  const { t } = useI18n();
  const [npwp, setNpwp] = useState("");
  const [hasNpwp, setHasNpwp] = useState(true);
  const [taxStatus, setTaxStatus] = useState("TK0");
  const [dependents, setDependents] = useState("0");
  const [ptkpSource, setPtkpSource] = useState<"auto" | "manual">("manual");
  const [processMethod, setProcessMethod] = useState("GrossToNet");
  const [wageTemplateId, setWageTemplateId] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const rowKey = row?.employeeId ?? "none";
  if (key !== rowKey) {
    setKey(rowKey);
    // Task 58: safeText — nilai enc: (respons stale lama) tidak pernah masuk
    // input edit (mencegah ciphertext tersimpan ulang saat admin menekan simpan).
    setNpwp(safeText(row?.profile?.npwp));
    setHasNpwp(row?.profile?.hasNpwp ?? true);
    setTaxStatus(row?.profile?.taxStatus ?? "TK0");
    setDependents(String(row?.profile?.dependents ?? 0));
    setPtkpSource(row?.profile?.ptkpSource ?? "manual");
    setProcessMethod(row?.profile?.processMethod ?? "GrossToNet");
    setWageTemplateId(row?.profile?.wageTemplateId ?? "");
    setBankName(row?.profile?.bankName ?? "");
    setBankAccount(safeText(row?.profile?.bankAccount));
  }

  const submit = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await apiSend("/api/onevity/payroll-profiles", "PATCH", {
        employeeId: row.employeeId,
        npwp: hasNpwp ? npwp.trim() || null : null,
        hasNpwp,
        ptkpSource,
        ...(ptkpSource === "manual" ? { taxStatus, dependents: Number(dependents) || 0 } : {}),
        processMethod,
        wageTemplateId: wageTemplateId || null,
        bankName: bankName.trim() || null,
        bankAccount: bankAccount.trim() || null,
      });
      toast.success(t("Profil payroll {name} disimpan", "Payroll profile of {name} saved", { name: row.fullName }));
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!row) return null;
  const selectedPtkp = TAX_STATUS_OPTIONS.find((o) => o.value === taxStatus);
  const suggestion = row.ptkpSuggestion;
  const isKi = /^KI[0-3]$/.test(taxStatus);
  // T50: PTKP efektif yang ditampilkan = snapshot (profil sudah auto) atau
  // saran (aktivasi manual→auto — server mengisi awal saat disimpan).
  const alreadyAuto = row.profile?.ptkpSource === "auto";
  const frozenStatus = alreadyAuto ? (row.profile?.taxStatus ?? taxStatus) : suggestion.taxStatus;
  const frozenPtkp = TAX_STATUS_OPTIONS.find((o) => o.value === frozenStatus);
  const curYear = new Date().getFullYear();
  const nextYear = curYear + 1;
  const pending = alreadyAuto && frozenStatus !== suggestion.taxStatus;

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] sm:max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><IdCard className="h-4 w-4 ov-text-accent" /> {t("Data Payroll — {name}", "Payroll Data — {name}", { name: row.fullName })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <div>
              <p className="text-xs font-bold">{t("Punya NPWP", "Has NPWP")}</p>
              <p className="text-[10px] text-stone-400">{t("Non-NPWP dikenai tarif 20% lebih tinggi", "Non-NPWP is charged a 20% higher rate")}</p>
            </div>
            <Switch checked={hasNpwp} onCheckedChange={setHasNpwp} />
          </div>
          {hasNpwp && (
            <div>
              <Label className="text-xs">{t("Nomor NPWP", "NPWP Number")}</Label>
              <Input value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="09.XXX.XXX.X-XXX.000" className="mt-1.5 font-mono" />
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Sumber Status PTKP", "PTKP Status Source")}</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPtkpSource("auto")}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition-colors",
                  ptkpSource === "auto"
                    ? "border-brand/40 bg-brand/10 dark:border-brand/50 dark:bg-brand/10"
                    : "border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600",
                )}
                aria-pressed={ptkpSource === "auto"}
              >
                <p className="flex items-center gap-1 text-[11px] font-bold"><Users className="h-3 w-3" /> {t("Otomatis dari keluarga", "Automatic from family")}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-stone-500 dark:text-stone-400">{t("Snapshot data keluarga — refresh otomatis 1 Januari", "Family data snapshot — auto-refreshed every Jan 1")}</p>
              </button>
              <button
                type="button"
                onClick={() => setPtkpSource("manual")}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition-colors",
                  ptkpSource === "manual"
                    ? "border-brand/40 bg-brand/10 dark:border-brand/50 dark:bg-brand/10"
                    : "border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600",
                )}
                aria-pressed={ptkpSource === "manual"}
              >
                <p className="flex items-center gap-1 text-[11px] font-bold"><Pencil className="h-3 w-3" /> {t("Manual", "Manual")}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-stone-500 dark:text-stone-400">{t("Ditetapkan admin — mis. K/I digabung", "Admin-set — e.g. K/I combined")}</p>
              </button>
            </div>
          </div>
          {ptkpSource === "auto" ? (
            <div className="grid gap-2">
              <div className="rounded-xl border border-brand/25 bg-brand/10/70 p-3 dark:border-brand/30 dark:bg-brand/10">
                <p className="text-[11px] font-bold text-brand-deep dark:text-brand/85">{t("PTKP efektif — dipakai payroll tahun ini", "Effective PTKP — used by this year's payroll")}</p>
                <p className="mt-1 text-[13px] font-bold ov-text-accent">
                  {t("Status: {s}", "Status: {s}", { s: frozenStatus })} — {fmtIDR(frozenPtkp?.ptkp ?? 0)}/{t("thn", "yr")}
                </p>
                {pending ? (
                  <p className="mt-1.5 rounded-lg border border-brand/25 bg-brand/10 px-2 py-1.5 text-[10px] leading-snug text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85">
                    {t(
                      "Data keluarga terkini: pasangan {spouse}, tanggungan {n} → {s} — berlaku 1 Jan {y} (perubahan tengah tahun menunggu refresh tahunan).",
                      "Current family data: spouse {spouse}, dependents {n} → {s} — effective Jan 1, {y} (mid-year changes wait for the annual refresh).",
                      { spouse: suggestion.spouse ? t("ada", "yes") : t("tidak ada", "none"), n: suggestion.dependents, s: suggestion.taxStatus, y: nextYear },
                    )}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[10px] leading-snug text-brand-deep/80 dark:text-brand/85/80">
                    {t(
                      "Sesuai data keluarga (pasangan {spouse}, tanggungan {n}) — tidak ada perubahan tertunda.",
                      "Matches family data (spouse {spouse}, dependents {n}) — no pending changes.",
                      { spouse: suggestion.spouse ? t("ada", "yes") : t("tidak ada", "none"), n: suggestion.dependents },
                    )}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400">
                  {t("Snapshot hasil refresh 1 Januari — penambahan/pengurangan dependen di tengah tahun berlaku tahun berikutnya.", "Snapshot from the January 1st refresh — mid-year dependent additions/reductions take effect next year.")}
                </p>
              </div>
              <div>
                <Label className="text-xs">{t("Status PTKP efektif", "Effective PTKP Status")}</Label>
                <Select value={frozenStatus} disabled>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={frozenStatus}>{frozenStatus} — {fmtIDR(frozenPtkp?.ptkp ?? 0)}/{t("thn", "yr")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {isKi && (
                <div className="rounded-xl border border-brand/25 bg-brand/10 p-2.5 text-[10px] leading-snug text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85">
                  {t("Status K/I (penghasilan pasangan digabung) hanya dapat diatur manual — data keluarga tidak memuat informasi penggabungan penghasilan.", "K/I status (spouse income combined) can only be set manually — family data does not contain income-combination info.")}
                </div>
              )}
              <div>
                <Label className="text-xs">{t("Status PTKP", "PTKP Status")}</Label>
                <Select value={taxStatus} onValueChange={setTaxStatus}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TAX_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{t(o.label, TAX_STATUS_OPTION_EN[o.value])} — {fmtIDR(o.ptkp)}/{t("thn", "yr")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPtkp && <p className="mt-1 text-[11px] font-bold ov-text-accent">{t("PTKP tahunan: {v}", "Annual PTKP: {v}", { v: fmtIDR(selectedPtkp.ptkp) })}</p>}
              </div>
              <div>
                <Label className="text-xs">{t("Jumlah Tanggungan (max 3)", "Number of Dependents (max 3)")}</Label>
                <Input type="number" min={0} max={3} value={dependents} onChange={(e) => setDependents(e.target.value)} className="mt-1.5" />
              </div>
              {suggestion.taxStatus !== (row.profile?.taxStatus ?? taxStatus) && (
                <button
                  type="button"
                  onClick={() => { setTaxStatus(suggestion.taxStatus); setDependents(String(suggestion.dependents)); }}
                  className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-left text-[11px] transition-colors hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:border-stone-600"
                >
                  <Info className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                  <span className="flex-1">
                    <span className="font-bold">{t("Saran dari data keluarga: {s}", "Family data suggests: {s}", { s: suggestion.taxStatus })} </span>
                    <span className="text-stone-500 dark:text-stone-400">
                      ({t("pasangan {spouse}, tanggungan {n}", "spouse {spouse}, dependents {n}", { spouse: suggestion.spouse ? t("ada", "yes") : "—", n: suggestion.dependents })})
                    </span>
                    <span className="ml-1 font-bold ov-text-accent">{t("Terapkan", "Apply")}</span>
                  </span>
                </button>
              )}
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Metode Proses", "Process Method")}</Label>
            <Select value={processMethod} onValueChange={setProcessMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GrossToNet">{t("Gross to Net — pajak dipotong dari gaji", "Gross to Net — tax deducted from salary")}</SelectItem>
                <SelectItem value="NetToGross">{t("Net to Gross — pajak ditanggung perusahaan (gross-up)", "Net to Gross — tax borne by the company (gross-up)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Template Upah")}</Label>
            <Select value={wageTemplateId} onValueChange={setWageTemplateId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih template", "Select template")} /></SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.items.length} {t("komponen", "components")})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Bank")}</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA / Mandiri / …" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("No. Rekening", "Account No.")}</Label>
              <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="1234567890" className="mt-1.5 font-mono" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
