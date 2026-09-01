"use client";
// OneVity Payroll — Akun & Posting (dipindah dari payroll-module lama)
import { useState } from "react";
import { useApi } from "@/lib/onevity/api";
import { PageHeader, StatusPill, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, ArrowLeftRight, BookOpen } from "lucide-react";

interface AccountData {
  groups: { id: string; code: string; name: string; accountType: string; accountCount: number }[];
  accounts: { id: string; code: string; name: string; accountGroupId: string | null; accountGroup: { name: string; code: string } | null }[];
  postings: { id: string; code: string; name: string; trigger: string; active: boolean }[];
}

export function AccountingPage() {
  const { data, loading } = useApi<AccountData>("/api/onevity/accounts");
  const [tab, setTab] = useState("accounts");

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
              <TabsTrigger value="accounts" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                <Landmark className="h-3.5 w-3.5" /> Akun ({data?.accounts.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="postings" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                <ArrowLeftRight className="h-3.5 w-3.5" /> Event Posting ({data?.postings.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="journal" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                <BookOpen className="h-3.5 w-3.5" /> Preview Jurnal
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
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-md">
                          <ArrowLeftRight className="h-5 w-5" />
                        </div>
                        <StatusPill status={p.active ? "Active" : "Cancelled"} />
                      </div>
                      <p className="mt-3 text-[14px] font-bold">{p.name}</p>
                      <p className="font-mono text-[10px] text-stone-400">{p.code}</p>
                      <div className="mt-3 border-t border-dashed border-stone-100 pt-3 dark:border-stone-800">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Trigger</p>
                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{p.trigger}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="journal">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><BookOpen className="h-4 w-4 text-emerald-600" /> Preview Jurnal — Post Monthly Payroll (Ilustrasi)</CardTitle>
                  <p className="text-[11px] text-stone-400">Struktur jurnal gaji bulanan berdasarkan master akun</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                          <TableHead className="text-[11px] font-bold">Akun</TableHead>
                          <TableHead className="text-[11px] font-bold">Nama</TableHead>
                          <TableHead className="text-right text-[11px] font-bold">Debit</TableHead>
                          <TableHead className="text-right text-[11px] font-bold">Kredit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <JournalRow code="5101" name="Gaji & Upah" debit="Rp 462.000.000" />
                        <JournalRow code="5102" name="Tunjangan Karyawan" debit="Rp 85.500.000" />
                        <JournalRow code="5103" name="BPJS Perusahaan" debit="Rp 52.000.000" />
                        <JournalRow code="2101" name="Hutang Gaji" credit="Rp 462.000.000" />
                        <JournalRow code="2102" name="Hutang PPh 21" credit="Rp 38.500.000" />
                        <JournalRow code="2103" name="Hutang BPJS" credit="Rp 99.000.000" />
                        <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                          <TableCell colSpan={2} className="text-xs font-bold uppercase tracking-wide text-stone-500">Total (Balance ✓)</TableCell>
                          <TableCell className="text-right text-xs font-extrabold">Rp 599.500.000</TableCell>
                          <TableCell className="text-right text-xs font-extrabold">Rp 599.500.000</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function JournalRow({ code, name, debit, credit }: { code: string; name: string; debit?: string; credit?: string }) {
  return (
    <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
      <TableCell className="font-mono text-[11px] font-bold text-stone-500">{code}</TableCell>
      <TableCell className="text-[13px]">{name}</TableCell>
      <TableCell className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400">{debit ?? ""}</TableCell>
      <TableCell className="text-right text-xs font-semibold text-rose-600 dark:text-rose-400">{credit ?? ""}</TableCell>
    </TableRow>
  );
}
