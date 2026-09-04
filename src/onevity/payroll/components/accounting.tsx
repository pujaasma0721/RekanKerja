"use client";
// OneVity Payroll — Akun & Posting (COA + event posting + pintu ke Jurnal Payroll)
import { useState } from "react";
import { useApi } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, StatusPill, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, ArrowLeftRight, BookOpen, ChevronRight } from "lucide-react";

interface AccountData {
  groups: { id: string; code: string; name: string; accountType: string; accountCount: number }[];
  accounts: { id: string; code: string; name: string; accountGroupId: string | null; accountGroup: { name: string; code: string } | null }[];
  postings: { id: string; code: string; name: string; trigger: string; active: boolean }[];
}

interface JournalSummary {
  journals: { id: string; journalNo: string; journalDate: string; runNo: string | null; totalDebit: number; status: string; _count: { lines: number } }[];
  missingRuns: { id: string; runNo: string; periodName: string; typeName: string }[];
}

export function AccountingPage() {
  const { navigate } = useNav();
  const { data, loading } = useApi<AccountData>("/api/onevity/accounts");
  const journalsApi = useApi<JournalSummary>("/api/onevity/payroll-journals");
  const [tab, setTab] = useState("accounts");
  const journals = journalsApi.data?.journals ?? [];
  const missing = journalsApi.data?.missingRuns ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Akun & Posting"
        description="Integrasi akun buku besar dan event posting payroll ke sistem akuntansi"
      />
      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
              <TabsTrigger value="accounts" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
                <Landmark className="h-3.5 w-3.5" /> Akun ({data?.accounts.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="postings" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
                <ArrowLeftRight className="h-3.5 w-3.5" /> Event Posting ({data?.postings.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="journal" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
                <BookOpen className="h-3.5 w-3.5" /> Jurnal Payroll ({journals.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="accounts">
              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                <div className="space-y-3">
                  {(data?.groups ?? []).map((g) => (
                    <Card key={g.id} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="font-mono text-[10px]">{g.code}</Badge>
                          <Badge variant="secondary" className="text-[9px]">{g.accountType}</Badge>
                        </div>
                        <p className="mt-1.5 text-[13px] font-bold">{g.name}</p>
                        <p className="mt-1 text-[11px] text-stone-400">{g.accountCount} akun</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                            <TableHead className="text-[11px] font-bold">Kode</TableHead>
                            <TableHead className="text-[11px] font-bold">Nama Akun</TableHead>
                            <TableHead className="text-[11px] font-bold">Grup</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(data?.accounts ?? []).map((a) => (
                            <TableRow key={a.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                              <TableCell className="font-mono text-[11px] font-bold text-stone-500">{a.code}</TableCell>
                              <TableCell className="text-[13px] font-semibold">{a.name}</TableCell>
                              <TableCell className="text-xs text-stone-500">{a.accountGroup?.name ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="postings">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(data?.postings ?? []).map((p) => (
                  <Card key={p.id} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl ov-fill shadow-md">
                          <ArrowLeftRight className="h-5 w-5" />
                        </div>
                        <StatusPill status={p.active ? "Active" : "Cancelled"} />
                      </div>
                      <p className="mt-3 text-[14px] font-bold">{p.name}</p>
                      <p className="font-mono text-[10px] text-stone-400">{p.code}</p>
                      <div className="mt-3 border-t border-dashed border-stone-100 pt-3 dark:border-stone-800">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Trigger</p>
                        <p className="text-xs font-semibold ov-text-accent">{p.trigger}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="journal">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
                    <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 ov-text-accent" /> Jurnal Payroll Terposting ({journals.length})</span>
                    <Button variant="outline" size="sm" onClick={() => navigate("payroll", "journals")} className="gap-1.5 font-bold">
                      Buka Jurnal Payroll <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </CardTitle>
                  <p className="text-[11px] text-stone-400">
                    Posting otomatis saat run dikonfirmasi{missing.length > 0 ? ` · ${missing.length} run menunggu backfill` : ""}
                  </p>
                </CardHeader>
                <CardContent className="pt-0">
                  {journals.length === 0 ? (
                    <div className="rounded-xl bg-stone-50 px-4 py-6 text-center text-xs text-stone-400 dark:bg-stone-900">
                      Belum ada jurnal — konfirmasi run payroll atau buka menu Jurnal Payroll untuk backfill.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                            <TableHead className="text-[11px] font-bold">Jurnal</TableHead>
                            <TableHead className="text-[11px] font-bold">Sumber Run</TableHead>
                            <TableHead className="text-center text-[11px] font-bold">Baris</TableHead>
                            <TableHead className="text-right text-[11px] font-bold">Debit = Kredit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {journals.slice(0, 5).map((j) => (
                            <TableRow key={j.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => navigate("payroll", "journals")}>
                              <TableCell className="font-mono text-[11px] font-bold ov-text-accent">{j.journalNo}</TableCell>
                              <TableCell className="font-mono text-[11px] text-stone-500">{j.runNo ?? "—"}</TableCell>
                              <TableCell className="text-center text-xs">{j._count.lines}</TableCell>
                              <TableCell className="text-right text-xs font-bold">{fmtIDRLite(j.totalDebit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function fmtIDRLite(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}
