// T2-ENGINE — uji race generator nomor jurnal (journal-no.ts) di tenant MII.
// Tiga skenario (cleanup otomatis — baris uji dihapus):
//   A. 10 alokasi murni paralel → semua nomor berbeda (advisory lock serialisasi);
//   B. 5 pola pemanggil nyata paralel (alokasi → insert → verifikasi) →
//      semua insert sukses dengan nomor unik (reservasi in-flight);
//   C. 3 pola transaksional paralel (nextJournalNoInTx + insert dalam tx) →
//      semua sukses & unik (varian atomik penuh).
// Jalankan: bun scripts/t2-journal-race.ts
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { nextJournalNo, nextJournalNoInTx } from "@/rekankerja/shared/lib/journal-no";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";
import { tenantCrypto } from "../src/rekankerja/shared/lib/field-crypto";
const tcE = (n: number) => tenantCrypto(MII_SCHEMA).encryptMoney(n);
const RUN_NO = "T2-RACE";

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  // bersihkan sisa uji sebelumnya
  await db.payrollJournal.deleteMany({ where: { runNo: RUN_NO } });

  const insertJournal = (journalNo: string, via: string) =>
    db.payrollJournal.create({
      data: {
        journalNo,
        journalDate: new Date(),
        runId: null,
        runNo: RUN_NO,
        description: `T2 journal race — ${via}`,
        totalDebit: tcE(0),
        totalCredit: tcE(0),
        status: "Posted",
      },
      select: { journalNo: true },
    });

  let pass = true;

  // ---- A. alokasi murni paralel ----
  const a = await Promise.all(Array.from({ length: 10 }, () => nextJournalNo(db)));
  const uniqueA = new Set(a);
  console.log(`A. alokasi paralel ×10 → ${a.length} hasil, unik ${uniqueA.size} ${uniqueA.size === a.length ? "PASS" : "FAIL"}`);
  if (uniqueA.size !== a.length) pass = false;

  // ---- B. pola pemanggil nyata (alokasi → insert) paralel ----
  const bResults = await Promise.allSettled(
    Array.from({ length: 5 }, async () => {
      const no = await nextJournalNo(db);
      await insertJournal(no, "caller pattern");
      return no;
    }),
  );
  const bOk = bResults.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
  const bFail = bResults.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason);
  const uniqueB = new Set(bOk);
  console.log(`B. alokasi+insert paralel ×5 → sukses ${bOk.length}, unik ${uniqueB.size}, gagal ${bFail.length} ${bOk.length === 5 && uniqueB.size === 5 ? "PASS" : "CHECK"}`);
  for (const f of bFail) console.log("   gagal:", f instanceof Error ? f.message : String(f));
  if (bOk.length !== 5 || uniqueB.size !== 5) pass = false;

  // ---- C. pola transaksional (alokasi+insert dalam SATU tx) paralel ----
  const cResults = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      db.$transaction(async (tx) => {
        const no = await nextJournalNoInTx(tx);
        await tx.payrollJournal.create({
          data: {
            journalNo: no,
            journalDate: new Date(),
            runId: null,
            runNo: RUN_NO,
            description: "T2 journal race — in-tx",
            totalDebit: tcE(0),
            totalCredit: tcE(0),
            status: "Posted",
          },
        });
        return no;
      }),
    ),
  );
  const cOk = cResults.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
  const cFail = cResults.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason);
  const uniqueC = new Set(cOk);
  console.log(`C. alokasi+insert SATU tx paralel ×3 → sukses ${cOk.length}, unik ${uniqueC.size}, gagal ${cFail.length} ${cOk.length === 3 && uniqueC.size === 3 ? "PASS" : "CHECK"}`);
  for (const f of cFail) console.log("   gagal:", f instanceof Error ? f.message : String(f));
  if (cOk.length !== 3 || uniqueC.size !== 3) pass = false;

  // ---- verifikasi akhir DB: tidak ada nomor ganda ----
  const rows = await db.payrollJournal.findMany({ where: { runNo: RUN_NO }, select: { journalNo: true } });
  const dbUnique = new Set(rows.map((r) => r.journalNo));
  console.log(`DB: ${rows.length} baris uji, nomor unik ${dbUnique.size} ${rows.length === dbUnique.size ? "PASS" : "FAIL"}`);
  if (rows.length !== dbUnique.size) pass = false;

  // ---- cleanup ----
  const del = await db.payrollJournal.deleteMany({ where: { runNo: RUN_NO } });
  console.log(`cleanup: ${del.count} baris uji dihapus`);
  console.log(pass ? "SEMUA TES JOURNAL PASS" : "ADA TES JOURNAL GAGAL");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
