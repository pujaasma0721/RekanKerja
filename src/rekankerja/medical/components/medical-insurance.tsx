"use client";
// RekanKerja Medical — Piutang Asuransi (W4-1, fix G-3 BPA-medical)
// Padanan oranHR "Reimbursement Employee: Paid By Insurance %": jurnal settle
// memecah bagian asuransi ke piutang 13xx (wave 1); halaman ini mengelola
// siklusnya — kirim ke asuransi → terima pembayaran (jurnal kas/piutang) →
// atau hapus buku (write-off, jurnal beban/piutang).
import { useState } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INS_STATE_LABEL, INS_STATE_LABEL_EN, InsReceivableUI, fmtIDR, fmtDateID } from "./medical-types";
import { Coins, Send, HandCoins, Eraser, Building2 } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { toast } from "sonner";

type InsRow = InsReceivableUI;
interface InsApi {
  rows: InsRow[];
  byInsurer: { insurer: string; count: number; submitted: number; outstanding: number }[];
  totalOutstanding: number;
  unsubmitted: number;
  waitingPayment: number;
}
type InsAction = "submit" | "paid" | "writeoff";

const INS_STATE_VARIANT: Record<string, string> = {
  NONE: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  WRITTEN_OFF: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export function MedicalInsurancePage() {
  const { t } = useI18n();
  const api = useApi<InsApi>("/api/rekankerja/medical/insurance");
  const [dialog, setDialog] = useState<{ row: InsRow; action: InsAction } | null>(null);
  const [refNo, setRefNo] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const data = api.data;
  const rows = data?.rows ?? [];
  const byInsurer = data?.byInsurer ?? [];

  const openDialog = (row: InsRow, action: InsAction) => {
    setDialog({ row, action });
    setRefNo(row.insRefNo ?? "");
    setPaidAmount(action === "paid" && row.outstanding != null ? String(row.outstanding) : "");
    setNote("");
  };

  const submitAction = async () => {
    if (!dialog) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { id: dialog.row.id, action: dialog.action };
      if (dialog.action === "submit" && refNo.trim()) body.insRefNo = refNo.trim();
      if (dialog.action === "paid") body.paidAmount = Number(paidAmount) || undefined;
      if (dialog.action === "writeoff") {
        if (!note.trim()) {
          toast.error(t("Alasan hapus buku wajib diisi", "Write-off reason is required"));
          setBusy(false);
          return;
        }
        body.note = note.trim();
      } else if (note.trim()) {
        body.note = note.trim();
      }
      const res = await fetch("/api/rekankerja/medical/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 200) {
        toast.success(
          dialog.action === "submit"
            ? t(`Klaim ${dialog.row.docNo} dikirim ke ${dialog.row.insurer}`, `Claim ${dialog.row.docNo} submitted to ${dialog.row.insurer}`)
            : dialog.action === "paid"
              ? t(`Pembayaran Rp ${Number(j.insPaidAmount ?? 0).toLocaleString("id-ID")} dicatat — jurnal ${j.journalNo ?? "-"}`, `Payment recorded — journal ${j.journalNo ?? "-"}`)
              : t(`Piutang ${dialog.row.docNo} dihapus buku — jurnal ${j.journalNo ?? "-"}`, `Receivable written off — journal ${j.journalNo ?? "-"}`),
        );
        setDialog(null);
        await api.refresh();
      } else {
        toast.error(String(j?.error ?? t("Gagal ({code})", "Failed ({code})", { code: res.status })));
      }
    } finally {
      setBusy(false);
    }
  };

  const dTitle: Record<InsAction, string> = {
    submit: t("Kirim ke Asuransi", "Submit to Insurance"),
    paid: t("Terima Pembayaran Asuransi", "Record Insurance Payment"),
    writeoff: t("Hapus Buku Piutang", "Write Off Receivable"),
  };
  const dDesc: Record<InsAction, string> = {
    submit: t("Tandai klaim sebagai ditagihkan ke perusahaan asuransi (piutang berjalan).", "Mark the claim as billed to the insurance company (receivable in progress)."),
    paid: t("Catat pembayaran asuransi — jurnal otomatis Debit Kas / Credit Piutang. Pelunasan penuh menandai PAID.", "Record the insurance payment — automatic journal Debit Cash / Credit Receivable. Full settlement marks PAID."),
    writeoff: t("Hapus sisa piutang ke beban perusahaan (Debit 5106 / Credit Piutang) — asuransi menolak / tidak mampu membayar.", "Write the remaining receivable off to company expense (Debit 5106 / Credit Receivable) — insurance rejected / unable to pay."),
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Settlement", "Medical · Settlement")}
        title={t("Piutang Asuransi", "Insurance Receivables")}
        description={t("Bagian klaim yang dibayar asuransi (Paid By Insurance %) — kirim, tagih, terima pembayaran, atau hapus buku", "The insurance-paid portion of claims (Paid By Insurance %) — submit, collect, record payment, or write off")}
      />

      {api.loading && !data ? (
        <LoadingRows rows={6} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Total Belum Tertagih", "Total Outstanding")}</p>
                  <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{data ? fmtIDR(data.totalOutstanding) : "—"}</p>
                </div>
                <div className="ov-tile rounded-xl p-2.5"><Coins className="h-5 w-5" /></div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Belum Dikirim", "Not Submitted")}</p>
                  <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{data?.unsubmitted ?? "—"}</p>
                </div>
                <div className="ov-tile rounded-xl p-2.5"><Send className="h-5 w-5" /></div>
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Menunggu Pembayaran", "Awaiting Payment")}</p>
                  <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{data?.waitingPayment ?? "—"}</p>
                </div>
                <div className="ov-tile rounded-xl p-2.5"><HandCoins className="h-5 w-5" /></div>
              </CardContent>
            </Card>
          </div>

          {byInsurer.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {byInsurer.map((b) => (
                <span key={b.insurer} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <Building2 className="h-3.5 w-3.5 ov-text-accent" />
                  {b.insurer} · {t("{n} klaim", "{n} claims", { n: b.count })} · {fmtIDR(b.outstanding)}
                </span>
              ))}
            </div>
          )}

          <Card className="mt-4 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-bold">
                <Coins className="h-4 w-4 ov-text-accent" /> {t("Daftar Piutang Klaim Settled", "Settled Claim Receivables")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <EmptyState
                  icon={Coins}
                  title={t("Belum ada piutang asuransi", "No insurance receivables")}
                  description={t("Klaim yang disettle pada jenis benefit dengan kebijakan Paid By Insurance akan tampil di sini", "Claims settled on benefit types with the Paid By Insurance policy will appear here")}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Klaim", "Claim")}</TableHead>
                      <TableHead>{t("Karyawan", "Employee")}</TableHead>
                      <TableHead>{t("Jenis / Asuransi", "Type / Insurer")}</TableHead>
                      <TableHead className="text-right">{t("Piutang", "Receivable")}</TableHead>
                      <TableHead className="text-right">{t("Diterima", "Received")}</TableHead>
                      <TableHead>{t("Status", "Status")}</TableHead>
                      <TableHead className="text-right">{t("Usia", "Age")}</TableHead>
                      <TableHead className="text-right">{t("Aksi", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-semibold">
                          {r.docNo}
                          <div className="text-xs font-normal text-slate-500">{r.journalNo ?? "—"}{r.settleDate ? ` · ${fmtDateID(r.settleDate)}` : ""}</div>
                        </TableCell>
                        <TableCell>
                          {r.fullName}
                          <div className="text-xs text-slate-500">{r.employeeNo}</div>
                        </TableCell>
                        <TableCell>
                          {r.typeName}
                          <div className="text-xs text-slate-500">{r.insurer} · {r.pctInsurance}%{r.insRefNo ? ` · ref ${r.insRefNo}` : ""}</div>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{r.insAmount == null ? "—" : fmtIDR(r.insAmount)}</TableCell>
                        <TableCell className="text-right">{r.insPaidAmount == null ? "—" : fmtIDR(r.insPaidAmount)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${INS_STATE_VARIANT[r.insState] ?? ""}`}>
                            {t(INS_STATE_LABEL[r.insState] ?? r.insState, INS_STATE_LABEL_EN[r.insState] ?? r.insState)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-slate-500">{t("{n} hr", "{n} d", { n: r.ageDays })}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {r.insState === "NONE" && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openDialog(r, "submit")}>
                                <Send className="mr-1 h-3 w-3" />{t("Kirim", "Submit")}
                              </Button>
                            )}
                            {r.insState === "SUBMITTED" && (r.outstanding ?? 0) > 0 && (
                              <>
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={() => openDialog(r, "paid")}>
                                  <HandCoins className="mr-1 h-3 w-3" />{t("Terima", "Receive")}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700" onClick={() => openDialog(r, "writeoff")}>
                                  <Eraser className="mr-1 h-3 w-3" />{t("Hapus Buku", "Write Off")}
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog ? `${dTitle[dialog.action]} — ${dialog.row.docNo}` : ""}</DialogTitle>
          </DialogHeader>
          {dialog && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">{dDesc[dialog.action]}</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                <div className="flex justify-between"><span className="text-slate-500">{t("Piutang", "Receivable")}</span><span className="font-semibold">{dialog.row.insAmount == null ? "—" : fmtIDR(dialog.row.insAmount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("Sisa", "Outstanding")}</span><span className="font-semibold">{dialog.row.outstanding == null ? "—" : fmtIDR(dialog.row.outstanding)}</span></div>
              </div>
              {dialog.action === "submit" && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">{t("No. Klaim Asuransi (opsional)", "Insurance claim no. (optional)")}</label>
                  <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder={t("mis. INS-2026-0042", "e.g. INS-2026-0042")} />
                </div>
              )}
              {dialog.action === "paid" && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500">{t("Nilai Diterima", "Amount received")}</label>
                  <Input type="number" min={0} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
                  <p className="text-xs text-slate-500">{t("Kosongkan untuk sisa piutang penuh; parsial tetap SUBMITTED sampai lunas", "Leave empty for the full remainder; partial stays SUBMITTED until settled")}</p>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">
                  {dialog.action === "writeoff" ? t("Alasan (wajib)", "Reason (required)") : t("Catatan (opsional)", "Note (optional)")}
                </label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={dialog.action === "writeoff" ? t("mis. klaim ditolak asuransi", "e.g. claim rejected by insurance") : ""} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>{t("Batal", "Cancel")}</Button>
            <Button
              variant={dialog?.action === "writeoff" ? "destructive" : "default"}
              disabled={busy || (dialog?.action === "writeoff" && !note.trim())}
              onClick={submitAction}
            >
              {busy ? t("Memproses…", "Processing…") : dTitle[dialog?.action ?? "submit"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
