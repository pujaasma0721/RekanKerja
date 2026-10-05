"use client";
// RekanKerja — sorting tabel sisi-klien (Task 72) ==============================
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
import { useI18n } from "@/rekankerja/shared/lib/i18n";

export type SortAccessor<T> = (row: T) => string | number | Date | null | undefined;
export type SortCfg<T> = Record<string, SortAccessor<T>>;

export function useTableSort<T>(
  rows: T[] | undefined,
  cfg: SortCfg<T>,
  opts?: { defaultKey?: string; defaultDir?: "asc" | "desc" }
) {
  const [key, setKey] = useState<string | null>(opts?.defaultKey ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(opts?.defaultDir ?? "asc");
  const { t } = useI18n(); // Task 102: tooltip sort ikut bahasa aktif

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
        title={t("Klik untuk urutkan", "Click to sort")}
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

// Task 76 — sorting SERVER-SIDE helpers ====================================
// nextServerSort + ServerSortHead untuk tabel besar yang di-sort di API
// (sortBy/sortDir dikirim ke endpoint, whitelist di service) sehingga
// urutan menjangkau SELURUH dataset, bukan hanya baris yang ter-fetch.
//
// (Task 68) Helper ini DIPULIHKAN: commit 75dc4cd (sesi paralel) mengimpor
// nextServerSort/ServerSortHead/ServerSortDir dari modul ini, namun file
// ini tidak pernah dikirim bersama commit tersebut → error "Export
// nextServerSort doesn't exist in target module" mematikan SEMUA halaman
// (GET / 500). Semantik mengikuti pola Task 75 (payroll-profiles):
// kolom sama diklik → balik arah; kolom baru → mulai dari "asc".
//
// Pemakaian:
//   const [sortKey, setSortKey] = useState("doc");
//   const [sortDir, setSortDir] = useState<ServerSortDir>("desc");
//   const clickSort = (k: string) => {
//     const n = nextServerSort(sortKey, sortDir, k);
//     setSortKey(n.sortBy as typeof sortKey);
//     setSortDir(n.sortDir);
//   };
//   <ServerSortHead label={t("Nomor")} active={sortKey === "doc"} dir={sortDir}
//     onClick={() => clickSort("doc")} />
export type ServerSortDir = "asc" | "desc";

/** State sort berikutnya dari klik header (server-side). */
export function nextServerSort(
  currentKey: string | null,
  currentDir: ServerSortDir,
  clickedKey: string,
): { sortBy: string; sortDir: ServerSortDir } {
  if (clickedKey === currentKey) {
    return { sortBy: clickedKey, sortDir: currentDir === "asc" ? "desc" : "asc" };
  }
  return { sortBy: clickedKey, sortDir: "asc" };
}

/** Header kolom sortable server-side — state dikelola pemanggil (bukan hook). */
export function ServerSortHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: ReactNode;
  active: boolean;
  dir: ServerSortDir;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useI18n(); // Task 102: tooltip sort ikut bahasa aktif
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={onClick}
        title={t("Klik untuk urutkan", "Click to sort")}
        className="inline-flex items-center gap-1 whitespace-nowrap transition hover:opacity-70"
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-35" />
        )}
      </button>
    </TableHead>
  );
}
