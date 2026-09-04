"use client";
// OneVity Attendance — Matriks Jadwal: karyawan × 7 hari (padanan Employee
// Schedule Matrix) dengan warna day type.
import { useState } from "react";
import { useApi } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MatrixRow } from "@/onevity/time-attendance/components/attendance-types";
import { Layers, ChevronLeft, ChevronRight, CalendarRange, Search } from "lucide-react";
import { cn } from "@/lib/utils";

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftDate = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
};

export function AttendanceMatrixPage() {
  const { navigate } = useNav();
  const [from, setFrom] = useState(iso(mondayOf(new Date())));
  const [query, setQuery] = useState("");
  const api = useApi<{ from: string; days: { date: string; label: string }[]; rows: MatrixRow[]; total: number }>(`/api/onevity/attendance/matrix?from=${from}`);

  const rows = (api.data?.rows ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.employeeNo.toLowerCase().includes(query.toLowerCase())
  );
  const days = api.data?.days ?? [];
  const unassigned = (api.data?.rows ?? []).filter((r) => !r.assigned).length;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Matriks Jadwal Karyawan"
        description="Day type efektif per karyawan × 7 hari — padanan Employee Schedule Matrix"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFrom(iso(shiftDate(from, -7)))} className="gap-1" aria-label="Minggu sebelumnya">
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-xs" />
            <Button variant="outline" size="sm" onClick={() => setFrom(iso(shiftDate(from, 7)))} className="gap-1" aria-label="Minggu berikutnya">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div className="flex items-center gap-2.5">
              <Layers className="h-4 w-4 text-emerald-600" />
              <p className="text-[13px] font-bold">Pekan {from} — {iso(shiftDate(from, 6))} · {api.data?.total ?? 0} karyawan</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan…" className="h-8 w-48 pl-8 text-xs" />
              </div>
            </div>
          </div>

          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : rows.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada karyawan aktif" description="Assign jadwal untuk melihat matriks." icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="min-w-52 text-[11px] font-bold">Karyawan</TableHead>
                    {days.map((d) => (
                      <TableHead key={d.date} className="min-w-24 text-center text-[10px] font-bold uppercase">{d.label}</TableHead>
                    ))}
                    <TableHead className="text-[11px] font-bold">Clocking</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 80).map((r) => (
                    <TableRow key={r.employeeId} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", !r.assigned && "opacity-60")}>
                      <TableCell>
                        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{r.fullName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                      </TableCell>
                      {r.cells.map((c) => (
                        <TableCell key={c.date} className="p-1.5 text-center">
                          {c.code ? (
                            <div
                              className="rounded-lg border px-1.5 py-1.5"
                              style={{ backgroundColor: (c.color ?? "#E7E5E4") + "55", borderColor: (c.color ?? "#E7E5E4") }}
                              title={`${c.name} (${c.category})`}
                            >
                              <p className="text-[10px] font-extrabold text-stone-800 dark:text-stone-200">{c.code}</p>
                              <p className="hidden text-[8px] font-medium text-stone-500 sm:block">{c.category === "Off" ? "LIBUR" : c.code === "OFFICE" ? "KANTOR" : ""}</p>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-stone-300 py-1.5 text-[10px] font-bold text-stone-400 dark:border-stone-700" title="Tidak ada jadwal">
                              —
                            </div>
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <span className={cn("text-[10px] font-bold", r.clockingRequired ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400")}>
                          {r.clockingRequired ? "Wajib" : "Non-clock"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {(api.data?.rows.length ?? 0) > 80 && (
            <p className="border-t border-stone-100 px-5 py-2.5 text-[11px] text-stone-400 dark:border-stone-800">
              Menampilkan 80 dari {api.data?.rows.length} karyawan — gunakan pencarian untuk memfilter.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-5 py-3 dark:border-stone-800">
            <div className="flex flex-wrap items-center gap-2">
              {legend().map((l) => (
                <span key={l.code} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-stone-500">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} /> {l.code}
                </span>
              ))}
            </div>
            {unassigned > 0 && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-bold text-amber-600" onClick={() => navigate("attendance", "assignment-schedule")}>
                {unassigned} karyawan belum ter-assign →
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function legend() {
  return [
    { code: "OFFICE", color: "#99CCFF" }, { code: "FLEX", color: "#E7E5E4" },
    { code: "SHIFT1", color: "#A7F3D0" }, { code: "SHIFT2", color: "#FDE68A" },
    { code: "SHIFT3", color: "#C7D2FE" }, { code: "OFF/Off", color: "#FCA5A5" },
  ];
}
