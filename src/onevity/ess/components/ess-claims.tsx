"use client";
// OneVity ESS — Klaim Saya: 2 tab read-only — Klaim Medis (docNo, jenis,
// tagihan, disetujui, status, tanggal) & Klaim Travel (docNo, tujuan, status,
// advance, settlement). Kolom dibaca defensif (nama field backend bisa varian).
import { HeartPulse, Plane, Loader2, AlertTriangle } from "lucide-react";
import { useApi, fmtIDR, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ESS_BASE, pickNum, pickStr } from "./ess-api";
import type { EssClaimsData, EssRecord } from "./ess-types";

function ErrorRetry({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-10 text-center dark:border-stone-700 dark:bg-stone-900/30">
      <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
      <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-300">{t("Gagal memuat klaim", "Failed to load claims")}</p>
      <p className="max-w-sm break-words text-xs text-stone-500">{message ?? t("Server tidak dapat dijangkau.", "The server could not be reached.")}</p>
      <Button onClick={onRetry} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
        <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
      </Button>
    </div>
  );
}

export function EssClaims() {
  const { t } = useI18n();
  const api = useApi<EssClaimsData>(`${ESS_BASE}/claims`);

  const medical: EssRecord[] = api.data?.medical ?? [];
  const travel: EssRecord[] = api.data?.travel ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Klaim Saya", "My Claims")}
        description={t("Riwayat klaim medis & perjalanan dinas Anda (baca-saja).", "Your medical & business travel claim history (read-only).")}
      />

      <Tabs defaultValue="medical">
        <TabsList className="mb-2">
          <TabsTrigger value="medical" className="gap-1.5">
            <HeartPulse className="h-3.5 w-3.5" /> {t("Klaim Medis", "Medical Claims")}
          </TabsTrigger>
          <TabsTrigger value="travel" className="gap-1.5">
            <Plane className="h-3.5 w-3.5" /> {t("Klaim Travel", "Travel Claims")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="medical">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="px-0 pb-2 pt-2">
              {api.loading && !api.data ? (
                <div className="px-5"><LoadingRows rows={4} /></div>
              ) : api.error && !api.data ? (
                <div className="px-5 pb-2"><ErrorRetry message={api.error} onRetry={api.refresh} /></div>
              ) : medical.length === 0 ? (
                <div className="px-5 pb-2">
                  <EmptyState title={t("Belum ada klaim medis", "No medical claims yet")} description={t("Klaim medis yang diajukan atas nama Anda tampil di sini.", "Medical claims submitted under your name appear here.")} icon={HeartPulse} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("No. Dokumen", "Document No.")}</TableHead>
                        <TableHead>{t("Jenis", "Type")}</TableHead>
                        <TableHead className="text-right">{t("Tagihan", "Billed")}</TableHead>
                        <TableHead className="text-right">{t("Disetujui", "Approved")}</TableHead>
                        <TableHead>{t("Status")}</TableHead>
                        <TableHead className="text-right">{t("Tanggal", "Date")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {medical.map((c, i) => {
                        const docNo = pickStr(c, ["docNo", "no", "documentNo", "doc"]) ?? `#${i + 1}`;
                        const date = pickStr(c, ["submittedAt", "date", "createdAt", "dateLabel", "tanggal", "requestDate"]);
                        return (
                          <TableRow key={docNo + i}>
                            <TableCell className="font-mono text-[12px] font-semibold text-stone-600 dark:text-stone-300">{docNo}</TableCell>
                            <TableCell>
                              <span className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                                {pickStr(c, ["typeName", "type", "benefitType", "jenis"]) ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-stone-700 dark:text-stone-200">
                              {fmtIDR(pickNum(c, ["bill", "claimAmount", "amount", "billed", "tagihan", "total"]))}
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {fmtIDR(pickNum(c, ["approvedAmount", "approved", "disetujui", "settled"]))}
                            </TableCell>
                            <TableCell>
                              <StatusPill status={pickStr(c, ["status"]) ?? "—"} />
                            </TableCell>
                            <TableCell className="text-right text-[12px] text-stone-400">{date ? fmtDate(date) : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="travel">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="px-0 pb-2 pt-2">
              {api.loading && !api.data ? (
                <div className="px-5"><LoadingRows rows={4} /></div>
              ) : api.error && !api.data ? (
                <div className="px-5 pb-2"><ErrorRetry message={api.error} onRetry={api.refresh} /></div>
              ) : travel.length === 0 ? (
                <div className="px-5 pb-2">
                  <EmptyState title={t("Belum ada klaim travel", "No travel claims yet")} description={t("Klaim & settlement perjalanan dinas Anda tampil di sini.", "Your business travel claims & settlements appear here.")} icon={Plane} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("No. Dokumen", "Document No.")}</TableHead>
                        <TableHead>{t("Tujuan", "Destination")}</TableHead>
                        <TableHead>{t("Status")}</TableHead>
                        <TableHead className="text-right">{t("Advance", "Advance")}</TableHead>
                        <TableHead className="text-right">{t("Settlement", "Settlement")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {travel.map((c, i) => {
                        const docNo = pickStr(c, ["docNo", "no", "documentNo", "doc"]) ?? `#${i + 1}`;
                        return (
                          <TableRow key={docNo + i}>
                            <TableCell className="font-mono text-[12px] font-semibold text-stone-600 dark:text-stone-300">{docNo}</TableCell>
                            <TableCell>
                              <span className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                                {loc(pickStr(c, ["purpose", "destination", "tujuan", "destinationCity", "city", "destinationLabel"]) ?? "—")}
                              </span>
                            </TableCell>
                            <TableCell>
                              <StatusPill status={pickStr(c, ["status"]) ?? "—"} />
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-stone-700 dark:text-stone-200">
                              {fmtIDR(pickNum(c, ["advance", "advanceAmount", "uangMuka"]))}
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-amber-700 dark:text-amber-400">
                              {fmtIDR(pickNum(c, ["settlement", "settlementAmount", "claimAmount", "settled"]))}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
