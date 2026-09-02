// OneVity shared — generator nomor jurnal tunggal (fix audit BPA M-07/C-04):
// sebelumnya 3 generator paralel (payroll count-based, travel max-parse, medical
// slice(3) salah → menghasilkan "JV-2027..2031") bertabrakan di tabel yang sama.
// Aturan baru: satu generator max-suffix per tahun → aman terhadap penghapusan
// jurnal, unik lintas sumber (payroll run / klaim travel / klaim medical).
import type { TenantDb } from "./tenant-db";

/** Nomor jurnal berikutnya: `JV-<tahun>-<urut>` — max-suffix tahun berjalan. */
export async function nextJournalNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JV-${year}-`;
  const rows = await db.payrollJournal.findMany({
    where: { journalNo: { startsWith: prefix } },
    select: { journalNo: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.journalNo.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
