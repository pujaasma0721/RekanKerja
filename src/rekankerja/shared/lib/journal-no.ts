// RekanKerja shared — generator nomor jurnal tunggal (fix audit BPA M-07/C-04):
// sebelumnya 3 generator paralel (payroll count-based, travel max-parse, medical
// slice(3) salah → menghasilkan "JV-2027..2031") bertabrakan di tabel yang sama.
// Aturan baru: satu generator max-suffix per tahun → aman terhadap penghapusan
// jurnal, unik lintas sumber (payroll run / klaim travel / klaim medical).
//
// RACE-SAFE (fix audit AUDIT-3/5 — read-then-insert tanpa lock → duplikat saat
// concurrent), tiga lapis:
//  1. pg_advisory_xact_lock(kelas, tahun) dalam transaksi singkat — alokasi
//     concurrent (request/proses mana pun) tidak membaca max-suffix bersamaan;
//  2. reservasi in-flight per client (WeakMap): nomor yang baru saja
//     dialokasikan request lain di proses ini (insert pemanggil belum commit)
//     dilewati → tabrakan intra-proses tertutup penuh (nomor bisa melompat
//     bila pemanggil gagal — aman, generator max-suffix toleran celah);
//  3. pre-flight + hitung ulang max-suffix (maks 3) bila nomor ternyata sudah
//     dipakai proses lain yang menang race commit.
// UNIQUE PayrollJournal.journalNo tetap penjaga terakhir fail-closed: duplikat
// nomor jurnal MUSTAHIL tersimpan — sisanya paling-paling P2002 yang jelas.
//
// Catatan arsitektur: pemanggil (payroll-journal / travel / medical) melakukan
// INSERT setelah fungsi ini kembali — untuk atomik penuh lintas proses
// (alokasi+insert dalam satu lock) gunakan nextJournalNoInTx(tx) di dalam
// $transaction pemanggil.
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "./tenant-db";

/** Kunci kelas advisory lock alokasi nomor jurnal (server-wide, per tahun). */
const JOURNAL_LOCK_CLASS = 9418700;

/** Umur reservasi in-flight (ms) — pemanggil yang crash tidak membocorkan
 *  nomor selamanya; nomor bebas dipakai lagi setelah TTL. */
const INFLIGHT_TTL_MS = 60_000;

/** Reservasi nomor yang sudah dialokasikan tapi insert pemanggil belum
 *  terlihat di DB (per client Prisma = per tenant, WeakMap). */
const inflightByClient = new WeakMap<TenantDb, Map<string, number>>();

function inflightOf(db: TenantDb): Map<string, number> {
  let m = inflightByClient.get(db);
  if (!m) {
    m = new Map();
    inflightByClient.set(db, m);
  }
  return m;
}

function pruneInflight(m: Map<string, number>): void {
  const now = Date.now();
  for (const [no, at] of m) {
    if (now - at > INFLIGHT_TTL_MS) m.delete(no);
  }
}

/** Hitung max-suffix tahun berjalan + kunci advisory xact (transaksi/tx aktif). */
async function computeNextLocked(tx: Prisma.TransactionClient, year: number): Promise<string> {
  // serialisasi alokasi antar request/proses — lock lepas otomatis saat tx selesai
  // (T3-TRAVEL hotfix: $executeRaw — statement locking mengembalikan kolom void
  // yang gagal di-deserialize $queryRaw pada Prisma 6.19 → semua approve klaim /
  // confirm run error; executeRaw tidak mem-deserialize result set).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${JOURNAL_LOCK_CLASS}::int, ${year}::int)`;
  const prefix = `JV-${year}-`;
  const rows = await tx.payrollJournal.findMany({
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

/**
 * Nomor jurnal berikutnya: `JV-<tahun>-<urut>` — max-suffix tahun berjalan.
 * Transaksi singkat + advisory lock + reservasi in-flight + cek bentrok dengan
 * hitung ulang (maks 3 percobaan).
 */
export async function nextJournalNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JV-${year}-`;
  const inflight = inflightOf(db);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const base = await db.$transaction((tx) => computeNextLocked(tx, year));
    // lewati nomor yang sedang in-flight (request lain di proses ini belum
    // commit insert-nya) — lompat ke nomor berikutnya yang bebas.
    pruneInflight(inflight);
    let candidate = base;
    while (inflight.has(candidate)) {
      const n = parseInt(candidate.slice(prefix.length), 10);
      candidate = `${prefix}${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0")}`;
    }
    // RESERVASI sinkron sebelum await apa pun — dua alokasi concurrent di proses
    // ini tidak akan pernah memilih nomor yang sama (yang kalah di event-loop
    // melihat reservasi pemenang dan melompat ke nomor berikutnya).
    inflight.set(candidate, Date.now());
    // pre-flight (async): nomor sudah dipakai alokasi proses lain yang menang
    // race commit → lepas reservasi + hitung ulang max-suffix.
    const clash = await db.payrollJournal.findUnique({
      where: { journalNo: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    inflight.delete(candidate);
  }
  throw new Error("Nomor jurnal unik tidak berhasil dialokasikan setelah 3 percobaan — coba ulang sesaat lagi");
}

/**
 * Varian transaksional: hitung nomor DI DALAM $transaction pemanggil (lock
 * advisory xact tetap dipegang sampai pemanggil commit) — pemanggil melakukan
 * INSERT jurnal dalam transaksi yang sama → alokasi+insert 100% atomik.
 * Pemakaian:
 *   await db.$transaction(async (tx) => {
 *     const journalNo = await nextJournalNoInTx(tx);
 *     await tx.payrollJournal.create({ data: { journalNo, ... } });
 *   });
 */
export async function nextJournalNoInTx(tx: Prisma.TransactionClient): Promise<string> {
  return computeNextLocked(tx, new Date().getFullYear());
}
