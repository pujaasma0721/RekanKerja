"use client";
// RekanKerja Payroll — PEMBAYARAN BUKAN PEGAWAI (PMK 168/2023) ================
// Tab Pembayaran (honor/fee → PPh21 dipotong: DPP 50% × Pasal 17 atas bruto
// setelah eksklusi 12(4)(b)), Mitra (master Bukan Pegawai), Ledger Bukti
// Potong (kertas kerja per masa pajak + ekspor CSV).
// Bukan Pegawai TIDAK lewat mesin payroll karyawan — lihat
// non-employee-payment-service.ts untuk dasar hukum pasal-per-pasal.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { toast } from "sonner";
import {
  FileSpreadsheet, FileDown, UserRound, Calculator, Plus, Info, HandCoins, BookOpen, Search, Users, Pencil,
} from "lucide-react";

const MENU_KEY = "payroll:non-employee";

interface PartnerLite { id: string; code: string; name: string; isCatering: boolean }
interface PartnerRow {
  id: string; code: string; name: string; idType: string; idNumber: string | null;
  address: string | null; serviceKind: string; isCatering: boolean;
  bankName: string | null; bankAccount: string | null; notes: string | null;
  active: boolean; _count: { payments: number };
}
interface PaymentRow {
  id: string; docNo: string; description: string;
  grossAmount: number; dpp: number; pph21: number; netAmount: number;
  paymentDate: string; taxYear: number; taxMonth: number; excludedAmount: number | null;
  status: string; excludedNotes: string | null; createdBy: string | null;
  partner: { code: string; name: string; serviceKind: string };
}
interface LedgerRow { year: number; month: number; paymentCount: number; totalGross: number; totalDpp: number; totalPph21: number }
interface LedgerDetail {
  taxYear: number; taxMonth: number; gross: number; dpp: number; pph21: number; net: number;
  docNo: string; paymentDate: string; description: string;
  partner: { code: string; name: string; serviceKind: string };
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export function NonEmployeePaymentsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"payments" | "partners" | "ledger">("payments");
  const [q, setQ] = useState("");
  const [year, setYear] = useState<string>("all");
  const [month, setMonth] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [payDialog, setPayDialog] = useState(false);
  const [partnerDialog, setPartnerDialog] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerRow | null>(null);
  const [detail, setDetail] = useState<LedgerDetail[] | null>(null);

  const yearQ = year !== "all" ? `&year=${year}` : "";
  const monthQ = month !== "all" ? `&month=${month}` : "";
  const statusQ = status !== "all" ? `&status=${status}` : "";
  const qQ = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";

  const paymentsApi = useApi<{ payments: PaymentRow[]; partners: PartnerLite[]; years: number[] }>(
    tab === "payments" ? `/api/rekankerja/non-employee-payments?tab=payments${yearQ}${monthQ}${statusQ}${qQ}` : null,
    [tab, year, month, status, q],
  );
  const partnersApi = useApi<{ partners: PartnerRow[] }>(
    tab === "partners" ? `/api/rekankerja/non-employee-payments?tab=partners${qQ}` : null,
    [tab, q],
  );
  const ledgerApi = useApi<{ ledger: LedgerRow[]; years: number[] }>(
    tab === "ledger" ? `/api/rekankerja/non-employee-payments?tab=ledger${yearQ}` : null,
    [tab, year],
  );

  const TABS = [
    { id: "payments" as const, label: t("Pembayaran", "Payments"), icon: HandCoins },
    { id: "partners" as const, label: t("Mitra", "Partners"), icon: Users },
    { id: "ledger" as const, label: t("Ledger Bukti Potong", "Withholding Ledger"), icon: BookOpen },
  ];

  const totals = useMemo(() => {
    const rows = paymentsApi.data?.payments ?? [];
    return {
      count: rows.length,
      gross: rows.reduce((s, r) => s + (r.grossAmount || 0), 0),
      pph: rows.reduce((s, r) => s + (r.pph21 || 0), 0),
    };
  }, [paymentsApi.data]);

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Pembayaran Bukan Pegawai", "Non-Employee Payments")}
        description={t(
          "Honorarium/komisi/fee untuk konsultan, tenaga ahli & pemberi jasa (Bukan Pegawai — PMK 168/2023): PPh21 dipotong otomatis (DPP 50% × tarif Pasal 17 atas bruto setelah eksklusi), ledger bukti potong per masa pajak. Tidak lewat payroll karyawan.",
          "Honoraria/commissions/fees for consultants, experts & service providers (Non-Employees — PMK 168/2023): PPh21 withheld automatically (50% DPP × Article 17 rates on post-exclusion gross), withholding ledger per tax period. Bypasses the employee payroll engine.",
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-[12px] font-bold transition ${
              tab === tb.id
                ? "border-brand/40 bg-brand/10 text-brand-deep dark:text-brand/80"
                : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <tb.icon className="h-3.5 w-3.5" />
            {tb.label}
          </button>
        ))}
        <div className="flex-1" />
        {tab === "payments" && (
          <Button size="sm" className="h-9 rounded-xl gap-2" onClick={() => setPayDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> {t("Catat Pembayaran", "Record Payment")}
          </Button>
        )}
        {tab === "partners" && (
          <Button size="sm" className="h-9 rounded-xl gap-2" onClick={() => { setEditingPartner(null); setPartnerDialog(true); }}>
            <Plus className="h-3.5 w-3.5" /> {t("Mitra Baru", "New Partner")}
          </Button>
        )}
        {tab === "ledger" && (
          <a
            href={`/api/rekankerja/non-employee-payments?export=csv${yearQ}${monthQ}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-[12px] font-bold text-slate-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-slate-700 dark:text-slate-300"
          >
            <FileDown className="h-3.5 w-3.5" /> CSV
          </a>
        )}
      </div>

      {/* ---- Tab Pembayaran ---- */}
      {tab === "payments" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari dokumen/mitra…", "Search docs/partners…")} className="h-9 w-56 rounded-xl pl-8 text-xs" />
            </div>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-9 w-[120px] rounded-xl text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua Tahun", "All Years")}</SelectItem>
                {(paymentsApi.data?.years ?? []).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-9 w-[130px] rounded-xl text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua Masa", "All Periods")}</SelectItem>
                {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-[130px] rounded-xl text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Paid">{t("Dibayar", "Paid")}</SelectItem>
                <SelectItem value="Cancelled">{t("Dibatalkan", "Cancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <div className="flex gap-4 text-[11px]">
              <span className="text-slate-400">{t("{n} dokumen", "{n} documents", { n: totals.count })}</span>
              <span className="font-bold text-slate-600 dark:text-slate-300">{t("Bruto", "Gross")} {fmtIDR(totals.gross)}</span>
              <span className="font-bold text-rose-600 dark:text-rose-400">{t("PPh21", "PPh21")} {fmtIDR(totals.pph)}</span>
            </div>
          </div>
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              {paymentsApi.loading && !paymentsApi.data ? (
                <div className="p-5"><LoadingRows rows={5} /></div>
              ) : (paymentsApi.data?.payments ?? []).length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={t("Belum ada pembayaran Bukan Pegawai", "No non-employee payments yet")}
                    description={t("Catat pembayaran honorarium/komisi/fee ke konsultan, tenaga ahli, atau pemberi jasa. PPh21 dipotong otomatis (DPP 50% × Pasal 17 setelah eksklusi komponen terbukti).", "Record honoraria/commissions/fees paid to consultants, experts, or service providers. PPh21 is withheld automatically (50% DPP × Article 17 after evidenced exclusions).")}
                    icon={<HandCoins className="h-6 w-6" />}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableHead className="text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Mitra", "Partner")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Uraian", "Description")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Bruto", "Gross")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("DPP 50%", "DPP 50%")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("PPh21 Dipotong", "PPh21 Withheld")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Masa", "Period")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                        <TableHead className="w-[170px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(paymentsApi.data?.payments ?? []).map((p) => (
                        <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell>
                            <p className="font-mono text-[11px] font-bold ov-text-accent">{p.docNo}</p>
                            <p className="text-[10px] text-slate-400">{new Date(p.paymentDate).toLocaleDateString()}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs font-bold">{p.partner.name}</p>
                            <p className="text-[10px] text-slate-400">{p.partner.serviceKind}</p>
                          </TableCell>
                          <TableCell className="max-w-[240px] truncate text-xs text-slate-500">{p.description}</TableCell>
                          <TableCell className="text-right text-xs font-bold">{fmtIDR(p.grossAmount)}</TableCell>
                          <TableCell className="text-right text-xs text-slate-500">{fmtIDR(p.dpp)}</TableCell>
                          <TableCell className="text-right text-xs font-bold text-rose-600 dark:text-rose-400">{fmtIDR(p.pph21)}</TableCell>
                          <TableCell className="text-[11px] text-slate-500">{MONTHS[p.taxMonth - 1]?.slice(0, 3)} {p.taxYear}</TableCell>
                          <TableCell><StatusPill status={p.status} /></TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {p.status === "Draft" && (
                                <MarkPaidButton id={p.id} docNo={p.docNo} onDone={() => paymentsApi.refresh()} />
                              )}
                              {p.status === "Draft" && (
                                <button
                                  onClick={async () => {
                                    try {
                                      await apiSend("/api/rekankerja/non-employee-payments", "PATCH", { id: p.id, status: "Cancelled" });
                                      toast.success(t("{d} dibatalkan", "{d} cancelled", { d: p.docNo }));
                                      paymentsApi.refresh();
                                    } catch (e) { toast.error((e as Error).message); }
                                  }}
                                  className="inline-flex h-7 items-center rounded-lg border border-slate-200 px-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                                >
                                  {t("Batal", "Cancel")}
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <CalcNote />
        </div>
      )}

      {/* ---- Tab Mitra ---- */}
      {tab === "partners" && (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-0">
            {partnersApi.loading && !partnersApi.data ? (
              <div className="p-5"><LoadingRows rows={4} /></div>
            ) : (partnersApi.data?.partners ?? []).length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title={t("Belum ada mitra Bukan Pegawai", "No non-employee partners yet")}
                  description={t("Daftarkan konsultan/tenaga ahli/pemberi jasa beserta NPWP atau NIK. NIK 16 digit berlaku sebagai NPWP (UU HPP & PMK 66/2023); tanpa identitas valid dikenai tarif non-NPWP ×120%.", "Register consultants/experts/service providers with their NPWP or NIK. A 16-digit NIK counts as an NPWP (UU HPP & PMK 66/2023); without a valid ID the non-NPWP ×120% rate applies.")}
                  icon={<UserRound className="h-6 w-6" />}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="text-[11px] font-bold">{t("Kode", "Code")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Nama", "Name")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Jenis Jasa", "Service")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Identitas", "ID")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Katering", "Catering")}</TableHead>
                      <TableHead className="text-center text-[11px] font-bold">{t("Pembayaran", "Payments")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                      <TableHead className="w-[70px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(partnersApi.data?.partners ?? []).map((p) => (
                      <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell className="font-mono text-[11px] font-bold">{p.code}</TableCell>
                        <TableCell className="text-xs font-bold">{p.name}</TableCell>
                        <TableCell className="text-xs text-slate-500">{p.serviceKind}</TableCell>
                        <TableCell className="text-[11px] text-slate-500">
                          {p.idType === "none" ? "—" : <span className="font-mono">{p.idNumber ?? t("(terenkripsi)", "(encrypted)")}</span>}
                        </TableCell>
                        <TableCell>{p.isCatering ? <Badge variant="outline" className="text-[9px]">{t("Katering", "Catering")}</Badge> : "—"}</TableCell>
                        <TableCell className="text-center text-xs font-semibold">{p._count.payments}</TableCell>
                        <TableCell><StatusPill status={p.active ? "Active" : "Inactive"} /></TableCell>
                        <TableCell>
                          <button
                            onClick={() => { setEditingPartner(p); setPartnerDialog(true); }}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                            aria-label={t("Ubah mitra {c}", "Edit partner {c}", { c: p.code })}
                          >
                            <Pencil className="h-3 w-3" /> {t("Ubah", "Edit")}
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Tab Ledger ---- */}
      {tab === "ledger" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-9 w-[120px] rounded-xl text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua Tahun", "All Years")}</SelectItem>
                {(ledgerApi.data?.years ?? []).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-slate-400">{t("Hanya pembayaran berstatus Dibayar yang masuk bukti potong.", "Only Paid payments appear in the withholding ledger.")}</span>
          </div>
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              {ledgerApi.loading && !ledgerApi.data ? (
                <div className="p-5"><LoadingRows rows={4} /></div>
              ) : (ledgerApi.data?.ledger ?? []).length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={t("Belum ada bukti potong", "No withholding records yet")}
                    description={t("Rekap per masa pajak muncul setelah pembayaran ditandai Dibayar — dasar lapor bupot \"Pembayaran kepada Pihak Lain\" di Coretax (bukan 1721-A1).", "Per-period recaps appear once payments are marked Paid — the basis for filing \"Payments to Other Parties\" bupot in Coretax (not 1721-A1).")}
                    icon={<FileSpreadsheet className="h-6 w-6" />}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableHead className="text-[11px] font-bold">{t("Masa Pajak", "Tax Period")}</TableHead>
                        <TableHead className="text-center text-[11px] font-bold">{t("Dokumen", "Documents")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Total Bruto", "Total Gross")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Total DPP", "Total DPP")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Total PPh21", "Total PPh21")}</TableHead>
                        <TableHead className="w-[120px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(ledgerApi.data?.ledger ?? []).map((l) => (
                        <TableRow key={`${l.year}-${l.month}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell className="text-xs font-bold">{MONTHS[l.month - 1]} {l.year}</TableCell>
                          <TableCell className="text-center text-xs">{l.paymentCount}</TableCell>
                          <TableCell className="text-right text-xs font-bold">{fmtIDR(l.totalGross)}</TableCell>
                          <TableCell className="text-right text-xs text-slate-500">{fmtIDR(l.totalDpp)}</TableCell>
                          <TableCell className="text-right text-xs font-bold text-rose-600 dark:text-rose-400">{fmtIDR(l.totalPph21)}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end">
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await apiSend<{ details: LedgerDetail[] }>(`/api/rekankerja/non-employee-payments?tab=ledger&year=${l.year}&month=${l.month}`, "GET");
                                    setDetail(res.details ?? []);
                                  } catch (e) { toast.error((e as Error).message); }
                                }}
                                className="inline-flex h-7 items-center rounded-lg border border-slate-200 px-2.5 text-[11px] font-bold text-slate-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-slate-700 dark:text-slate-300"
                              >
                                {t("Rincian", "Details")}
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <PaymentDialog open={payDialog} onClose={() => setPayDialog(false)} partners={paymentsApi.data?.partners ?? []} onSaved={() => { setPayDialog(false); paymentsApi.refresh(); }} />
      <PartnerDialog open={partnerDialog} editing={editingPartner} onClose={() => { setPartnerDialog(false); setEditingPartner(null); }} onSaved={() => { setPartnerDialog(false); setEditingPartner(null); partnersApi.refresh(); }} />
      <LedgerDetailDialog details={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function MarkPaidButton({ id, docNo, onDone }: { id: string; docNo: string; onDone: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiSend("/api/rekankerja/non-employee-payments", "PATCH", { id, status: "Paid" });
          toast.success(t("{d} ditandai dibayar — masuk ledger bukti potong", "{d} marked paid — added to the withholding ledger", { d: docNo }));
          onDone();
        } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
      }}
      className="inline-flex h-7 items-center rounded-lg border border-brand/40 bg-brand/10 px-2.5 text-[11px] font-bold text-brand-deep transition hover:bg-brand/20 disabled:opacity-50 dark:text-brand/75"
    >
      {busy ? "…" : t("Tandai Dibayar", "Mark Paid")}
    </button>
  );
}

function CalcNote() {
  const { t } = useI18n();
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="p-4">
        <p className="flex items-center gap-2 text-[13px] font-bold"><Calculator className="h-4 w-4 ov-text-accent" /> {t("Dasar perhitungan (PMK 168/2023)", "Calculation basis (PMK 168/2023)")}</p>
        <div className="mt-3 grid gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
            <p className="font-bold text-slate-700 dark:text-slate-300">1 · {t("DPP", "DPP")}</p>
            <p>{t("50% × bruto setelah eksklusi (Pasal 12(3) + 12(4)(b)) — tanpa PTKP & biaya jabatan", "50% × post-exclusion gross (Articles 12(3) + 12(4)(b)) — no PTKP & occupational deduction")}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
            <p className="font-bold text-slate-700 dark:text-slate-300">2 · {t("Tarif", "Rate")}</p>
            <p>{t("Pasal 17 UU PPh progresif × DPP — non-NPWP ×120% (Pasal 16(3)); NIK 16 digit = tarif NPWP (UU HPP)", "Article 17 progressive rates × DPP — non-NPWP ×120% (Article 16(3)); 16-digit NIK gets NPWP rates (UU HPP)")}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
            <p className="font-bold text-slate-700 dark:text-slate-300">3 · {t("Pelaporan", "Filing")}</p>
            <p>{t('Bupot "Pembayaran kepada Pihak Lain" (Coretax) — bukan 1721-A1', '"Payments to Other Parties" bupot (Coretax) — not 1721-A1')}</p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {t("PPh21 Bukan Pegawai adalah KREDIT PAJAK penerima di SPT Tahunan — bukan pajak final (Lampiran PMK 168/2023 contoh V). Komponen gaji tenaga kerja mitra / barang-material / jasa pihak ketiga yang terbukti (Pasal 12(4)(b), 12(5)) dikeluarkan dari bruto SEBELUM ×50%; untuk jasa katering bruto = seluruh jumlah (Pasal 12(4)(a)).", "Non-employee PPh21 is a TAX CREDIT for the recipient in their annual return — not a final tax (PMK 168/2023 Annex example V). Evidenced worker wages / materials / third-party services (Articles 12(4)(b), 12(5)) are excluded from gross BEFORE ×50%; for catering services the gross is the entire amount (Article 12(4)(a)).")}
        </p>
      </CardContent>
    </Card>
  );
}

const emptyPay = { partnerId: "", description: "", grossAmount: "", paymentDate: new Date().toISOString().slice(0, 10), excludedAmount: "", excludedNotes: "", markPaid: false };

function PaymentDialog({ open, onClose, partners, onSaved }: { open: boolean; onClose: () => void; partners: PartnerLite[]; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ ...emptyPay });
  const [busy, setBusy] = useState(false);
  const grossNum = Number(f.grossAmount) || 0;
  const selPartner = partners.find((p) => p.id === f.partnerId);
  // Jasa katering (Pasal 12(4)(a)): bruto = seluruh jumlah — eksklusi DILARANG.
  const catering = !!selPartner?.isCatering;
  const exclNum = catering ? 0 : Math.max(0, Number(f.excludedAmount) || 0);
  const taxableEst = Math.max(0, grossNum - exclNum);
  const dppEst = Math.round(taxableEst * 0.5);
  // estimasi kasar tarif Pasal 17 lapisan pertama (5%) — angka final dihitung server
  const pphEst = Math.round(dppEst * 0.05);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.partnerId || !f.description.trim() || !f.grossAmount) {
      toast.error(t("Mitra, uraian, dan bruto wajib diisi", "Partner, description, and gross amount are required"));
      return;
    }
    if (exclNum > grossNum) {
      toast.error(t("Komponen dikeluarkan tidak boleh melebihi bruto", "Excluded components cannot exceed gross"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/non-employee-payments", "POST", {
        op: "payment", partnerId: f.partnerId, description: f.description, grossAmount: grossNum,
        excludedAmount: exclNum || null,
        paymentDate: f.paymentDate, excludedNotes: f.excludedNotes || null, status: f.markPaid ? "Paid" : "Draft",
      });
      toast.success(t("Pembayaran dicatat — PPh21 dihitung server (kredit pajak penerima)", "Payment recorded — PPh21 computed server-side (recipient's tax credit)"));
      setF({ ...emptyPay });
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><HandCoins className="h-4 w-4 ov-text-accent" /> {t("Catat Pembayaran Bukan Pegawai", "Record Non-Employee Payment")}</DialogTitle>
        </DialogHeader>
        {partners.length === 0 ? (
          <div className="py-2 text-sm text-slate-500">
            {t("Belum ada mitra — daftarkan dulu di tab Mitra.", "No partners yet — register one in the Partners tab first.")}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] font-bold">{t("Mitra (Bukan Pegawai)", "Partner (Non-Employee)")}</Label>
              <Select value={f.partnerId} onValueChange={(v) => set("partnerId", v)}>
                <SelectTrigger className="mt-1 h-9 rounded-xl text-xs"><SelectValue placeholder={t("Pilih mitra", "Select partner")} /></SelectTrigger>
                <SelectContent>
                  {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] font-bold">{t("Uraian pembayaran", "Payment description")}</Label>
              <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder={t("cth: Fee konsultasi pajak September 2026", "e.g.: Tax consulting fee Sep 2026")} className="mt-1 h-9 rounded-xl text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] font-bold">{t("Penghasilan bruto (Rp)", "Gross income (IDR)")}</Label>
                <Input type="number" min={0} value={f.grossAmount} onChange={(e) => set("grossAmount", e.target.value)} placeholder="0" className="mt-1 h-9 rounded-xl text-xs" />
              </div>
              <div>
                <Label className="text-[11px] font-bold">{t("Tanggal bayar", "Payment date")}</Label>
                <Input type="date" value={f.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} className="mt-1 h-9 rounded-xl text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-[11px] font-bold">{t("Komponen dikeluarkan dari bruto (Rp)", "Components excluded from gross (IDR)")}</Label>
              <Input type="number" min={0} value={catering ? "" : f.excludedAmount} disabled={catering} onChange={(e) => set("excludedAmount", e.target.value)} placeholder="0" className="mt-1 h-9 rounded-xl text-xs" />
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                {catering
                  ? t("Jasa katering: bruto = seluruh jumlah penghasilan — eksklusi TIDAK diperbolehkan (Pasal 12(4)(a)).", "Catering service: gross is the entire amount — exclusions are NOT allowed (Article 12(4)(a)).")
                  : t("Gaji tenaga kerja mitra / barang-material / jasa pihak ketiga yang terbukti (Pasal 12(4)(b)) — dikurangkan dari bruto SEBELUM ×50%.", "Partner's worker wages / materials / third-party services, evidenced (Article 12(4)(b)) — subtracted from gross BEFORE ×50%.")}
              </p>
            </div>
            <div>
              <Label className="text-[11px] font-bold">{t("Bukti eksklusi (kontrak kerja, faktur, daftar gaji — Pasal 12(5))", "Exclusion evidence (work contracts, invoices, payroll list — Article 12(5))")}</Label>
              <Textarea value={f.excludedNotes} onChange={(e) => set("excludedNotes", e.target.value)} placeholder={t("cth: upah ahli kelistrikan Rp 4.500.000 + komponen AC Rp 1.000.000 — kontrak & faktur terlampir (Pasal 12(4)b)", "e.g.: electrician wages IDR 4,500,000 + AC parts IDR 1,000,000 — contract & invoices attached (Article 12(4)b)")} className="mt-1 min-h-[60px] rounded-xl text-xs" />
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-slate-900">
              <p className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300"><Calculator className="h-3.5 w-3.5" /> {t("Estimasi", "Estimate")}</p>
              <p className="mt-1">
                {t("Bruto kena pajak ±", "Taxable gross ±")} <b>{fmtIDR(taxableEst)}</b> · {t("DPP ±", "DPP ±")} <b>{fmtIDR(dppEst)}</b> · {t("PPh21 ±", "PPh21 ±")} <b className="text-rose-600 dark:text-rose-400">{fmtIDR(pphEst)}</b>{" "}
                <span className="text-slate-400">({t("estimasi tarif dasar 5% — angka final dihitung server dengan tarif Pasal 17 & status NPWP/NIK mitra", "rough 5% base-rate estimate — final amount computed server-side with Article 17 rates & partner NPWP/NIK status")})</span>
              </p>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div>
                <Label className="text-[11px] font-bold">{t("Langsung tandai dibayar", "Mark paid immediately")}</Label>
                <p className="text-[10px] text-slate-400">{t("Status Paid = final, masuk ledger bukti potong masa pajak tanggal bayar.", "Paid status is final and enters the withholding ledger of the payment date's tax period.")}</p>
              </div>
              <Switch checked={f.markPaid} onCheckedChange={(v) => set("markPaid", v)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={save} disabled={busy || partners.length === 0}>{busy ? t("Menyimpan…", "Saving…") : t("Simpan", "Save")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const emptyPartner = { code: "", name: "", idType: "npwp", idNumber: "", serviceKind: "Pekerjaan Bebas", isCatering: false, address: "", bankName: "", bankAccount: "", notes: "", active: true };

function PartnerDialog({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing?: PartnerRow | null }) {
  const { t } = useI18n();
  const [f, setF] = useState({ ...emptyPartner });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  // Buka → isi ulang form (mode baru ATAU mode ubah dari baris tabel).
  useEffect(() => {
    if (!open) return;
    setF(editing
      ? {
          code: editing.code, name: editing.name, idType: editing.idType, idNumber: editing.idNumber ?? "",
          serviceKind: editing.serviceKind, isCatering: editing.isCatering, address: editing.address ?? "",
          bankName: editing.bankName ?? "", bankAccount: editing.bankAccount ?? "", notes: editing.notes ?? "",
          active: editing.active,
        }
      : { ...emptyPartner });
  }, [open, editing]);

  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) {
      toast.error(t("Kode dan nama mitra wajib diisi", "Partner code and name are required"));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        // Ubah mitra — kode unik tetap (API tidak mengubah code); NPWP/NIK bisa
        // dikoreksi (kesalahan nomor = salah tarif — temuan audit T107-d).
        await apiSend("/api/rekankerja/non-employee-payments", "PATCH", {
          op: "partner", id: editing.id, name: f.name, idType: f.idType,
          idNumber: f.idNumber || null, serviceKind: f.serviceKind, isCatering: f.isCatering,
          address: f.address || null, bankName: f.bankName || null, bankAccount: f.bankAccount || null,
          notes: f.notes || null, active: f.active,
        });
        toast.success(t("Mitra diperbarui", "Partner updated"));
      } else {
        await apiSend("/api/rekankerja/non-employee-payments", "POST", { op: "partner", ...f, idNumber: f.idNumber || null });
        toast.success(t("Mitra terdaftar — NPWP/NIK tersimpan terenkripsi", "Partner registered — NPWP/NIK stored encrypted"));
      }
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 ov-text-accent" /> {editing ? t("Ubah Mitra Bukan Pegawai", "Edit Non-Employee Partner") : t("Mitra Bukan Pegawai Baru", "New Non-Employee Partner")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] font-bold">{t("Kode", "Code")}</Label>
              <Input value={f.code} disabled={!!editing} onChange={(e) => set("code", e.target.value)} placeholder="KONS-001" className="mt-1 h-9 rounded-xl text-xs disabled:opacity-70" />
            </div>
            <div>
              <Label className="text-[11px] font-bold">{t("Nama", "Name")}</Label>
              <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("cth: Andi Wijaya, S.E., Ak.", "e.g.: Andi Wijaya, S.E., Ak.")} className="mt-1 h-9 rounded-xl text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] font-bold">{t("Jenis identitas", "ID type")}</Label>
              <Select value={f.idType} onValueChange={(v) => set("idType", v)}>
                <SelectTrigger className="mt-1 h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="npwp">NPWP</SelectItem>
                  <SelectItem value="nik">NIK</SelectItem>
                  <SelectItem value="none">{t("Tanpa", "None")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] font-bold">{t("Nomor", "Number")}</Label>
              <Input value={f.idNumber} onChange={(e) => set("idNumber", e.target.value)} placeholder={f.idType === "npwp" ? "15/16 digit" : "16 digit"} className="mt-1 h-9 rounded-xl text-xs" />
            </div>
          </div>
          <div>
            <Label className="text-[11px] font-bold">{t("Jenis jasa", "Service kind")}</Label>
            <Input value={f.serviceKind} onChange={(e) => set("serviceKind", e.target.value)} placeholder={t("cth: Konsultan pajak (Pekerjaan Bebas)", "e.g.: Tax consultant (independent work)")} className="mt-1 h-9 rounded-xl text-xs" />
          </div>
          <div>
            <Label className="text-[11px] font-bold">{t("Alamat", "Address")}</Label>
            <Input value={f.address} onChange={(e) => set("address", e.target.value)} className="mt-1 h-9 rounded-xl text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] font-bold">{t("Bank", "Bank")}</Label>
              <Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} className="mt-1 h-9 rounded-xl text-xs" />
            </div>
            <div>
              <Label className="text-[11px] font-bold">{t("No. rekening", "Account no.")}</Label>
              <Input value={f.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} className="mt-1 h-9 rounded-xl text-xs" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <Label className="text-[11px] font-bold">{t("Jasa katering", "Catering service")}</Label>
              <p className="text-[10px] leading-relaxed text-slate-400">{t("Katering: bruto = seluruh jumlah penghasilan — komponen tenaga kerja/material TIDAK boleh dikeluarkan (Pasal 12(4)(a)); eksklusi hanya untuk jasa non-katering (Pasal 12(4)(b)).", "Catering: gross is the entire amount — worker/material components may NOT be excluded (Article 12(4)(a)); exclusions apply only to non-catering services (Article 12(4)(b)).")}</p>
            </div>
            <Switch checked={f.isCatering} onCheckedChange={(v) => set("isCatering", v)} />
          </div>
          {editing && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div>
                <Label className="text-[11px] font-bold">{t("Mitra aktif", "Active partner")}</Label>
                <p className="text-[10px] text-slate-400">{t("Non-aktifkan menyembunyikan mitra dari pencatatan baru — riwayat bukti potong tetap utuh.", "Deactivating hides the partner from new records — withholding history stays intact.")}</p>
              </div>
              <Switch checked={f.active} onCheckedChange={(v) => set("active", v)} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Simpan", "Save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LedgerDetailDialog({ details, onClose }: { details: LedgerDetail[] | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={!!details} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4 ov-text-accent" /> {t("Rincian bukti potong masa pajak", "Withholding details for tax period")}</DialogTitle>
        </DialogHeader>
        <TooltipProvider delayDuration={150}>
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                <TableRow>
                  <TableHead className="text-[10px] font-bold">{t("Dokumen", "Document")}</TableHead>
                  <TableHead className="text-[10px] font-bold">{t("Mitra", "Partner")}</TableHead>
                  <TableHead className="text-[10px] font-bold">{t("Uraian", "Description")}</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">{t("Bruto", "Gross")}</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">{t("DPP", "DPP")}</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">{t("PPh21", "PPh21")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(details ?? []).map((d) => (
                  <Tooltip key={d.docNo}>
                    <TooltipTrigger asChild>
                      <TableRow className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell>
                          <p className="font-mono text-[11px] font-bold">{d.docNo}</p>
                          <p className="text-[10px] text-slate-400">{new Date(d.paymentDate).toLocaleDateString()}</p>
                        </TableCell>
                        <TableCell className="text-[11px] font-bold">{d.partner?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-[11px] text-slate-500">{d.description}</TableCell>
                        <TableCell className="text-right text-[11px] font-semibold">{fmtIDR(d.gross)}</TableCell>
                        <TableCell className="text-right text-[11px] text-slate-500">{fmtIDR(d.dpp)}</TableCell>
                        <TableCell className="text-right text-[11px] font-bold text-rose-600 dark:text-rose-400">{fmtIDR(d.pph21)}</TableCell>
                      </TableRow>
                    </TooltipTrigger>
                    <TooltipContent side="top">{d.partner?.serviceKind}</TooltipContent>
                  </Tooltip>
                ))}
                <TableRow className="border-t-2 border-slate-200 bg-slate-50/80 font-bold dark:border-slate-700 dark:bg-slate-900/50">
                  <TableCell colSpan={3} className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("Total", "Total")}</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold">{fmtIDR((details ?? []).reduce((s, d) => s + d.gross, 0))}</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold text-slate-500">{fmtIDR((details ?? []).reduce((s, d) => s + d.dpp, 0))}</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR((details ?? []).reduce((s, d) => s + d.pph21, 0))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
        <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
      </DialogContent>
    </Dialog>
  );
}
