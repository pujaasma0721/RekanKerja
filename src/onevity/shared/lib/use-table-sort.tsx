"use client";
// OneVity — sorting tabel sisi-klien (Task 72) ==============================
// Hook + header kolom klik-untuk-urut (asc → desc → asc). Null selalu di
// paling bawah. Angka dibandingkan numerik, teks pakai localeCompare "id"
// (numeric: NIP "SAYONE0002" < "SAYONE0010").
//
// Pemakaian:
//   const { sorted, head } = useTableSort(rows, {
//     nip: (r) => r.employeeNo,          // teks
//     gaji: (r) => r.baseSalary,         // angka
//     tgl: (r) => r.startDate,           // ISO string / Date
//   }, { defaultKey: "nip", defaultDir: "asc" });
//   {head("nip", t("NIP"), "text-[11px] font-bold")}
//   {sorted.map((r) => <TableRow .../>)}
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export type SortAccessor<T> = (row: T) => string | number | Date | null | undefined;
export type SortCfg<T> = Record<string, SortAccessor<T>>;

export function useTableSort<T>(
  rows: T[] | undefined,
  cfg: SortCfg<T>,
  opts?: { defaultKey?: string; defaultDir?: "asc" | "desc" }
) {
  const [key, setKey] = useState<string | null>(opts?.defaultKey ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(opts?.defaultDir ?? "asc");

  const toggle = (k: string) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setKey(k); setDir("asc"); }
  };

  const sorted = useMemo(() => {
    const arr = [...(rows ?? [])];
    if (!key) return arr;
    const acc = cfg[key];
    if (!acc) return arr;
    arr.sort((a, b) => {
      const rawA = acc(a);
      const rawB = acc(b);
      const va = rawA instanceof Date ? rawA.getTime() : rawA;
      const vb = rawB instanceof Date ? rawB.getTime() : rawB;
      let c: number;
      if (va == null && vb == null) c = 0;
      else if (va == null) c = 1; // null/undefined selalu paling bawah
      else if (vb == null) c = -1;
      else if (typeof va === "number" && typeof vb === "number") c = va - vb;
      else c = String(va).localeCompare(String(vb), "id", { numeric: true, sensitivity: "base" });
      return dir === "asc" ? c : -c;
    });
    return arr;
  }, [rows, key, dir, cfg]);

  /** Header kolom sortable — menggantikan <TableHead> sepenuhnya. */
  const head = (k: string, label: ReactNode, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggle(k)}
        title="Klik untuk urutkan"
        className="inline-flex items-center gap-1 whitespace-nowrap transition hover:opacity-70"
      >
        {label}
        {key === k ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-35" />
        )}
      </button>
    </TableHead>
  );

  return { sorted, key, dir, toggle, head };
}
