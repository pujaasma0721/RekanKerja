// Migrasi TRAVEL SETTLEMENT FIX (T3-TRAVEL) ke 3 tenant sandbox — idempoten:
//   1. DDL lifecycle advance (M-3/B5):
//      - TravelAdvance.status (Requested|Given|Void) ADD COLUMN IF NOT EXISTS
//      - TravelAdvance.givenAt → nullable (diisi saat request APPROVED final)
//   2. Backfill status advance dari status request:
//      - request Rejected/Cancelled → Void (uang muka tidak lagi beredar)
//      - request Submitted → Requested + givenAt NULL (belum dicairkan)
//      - request Approved → Given (+ givenAt diisi dari decidedAt bila kosong)
//   3. Rekomputasi B1/B2 semua klaim dari baris expense + header (a) tersimpan:
//      R = Σ rincian + rugi kurs − (a); b = max(0, R − advance aktif);
//      c = max(0, advance − R); totalSettlement = R (gross, sebanding jurnal)
//   4. Selaraskan jurnal klaim ber-status Approved/Transferred/Paid yang masih
//      memakai rumus lama (debit (a) sbg beban / split kredit ≠ b/c baru) —
//      dihapus & di-regenerate via generateClaimJournal (D=C tetap).
//   5. Sinkronkan amount EmployeeComponentAssignment UTRP/TRVSTLIN klaim
//      Transferred yang b/c-nya berubah (notes memuat docNo klaim).
// FIX (seed-remote wave): (a) kunci tenant kini dari schemaName aktual — dulu
//      memakai env SEED_TENANT_SCHEMA (salah kunci saat dijalankan standalone);
//      (b) amount jurnal PayrollJournalLine kini TERENKRIPSI (wave 28-c) →
//      didekripsi dulu sebelum uji konsistensi (tanpa ini, jurnal dianggap
//      selalu tidak-konsisten & diregenerasi tiap rerun).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun run scripts/migrate-travel-settlement-fix.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { tenantCrypto } from "../src/onevity/shared/lib/field-crypto";
import { Client } from "pg";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { generateClaimJournal } from "@/onevity/travel/services/travel-service";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const round2 = (n: number) => Math.round(n * 100) / 100;

interface AdvanceRow { id: string; requestId: string; status: string | null; givenAt: Date | null; amount: number }
interface ClaimRow {
  id: string; docNo: string; status: string; requestId: string | null; journalNo: string | null;
  otherCompanyExp: number; exchangeLoss: number;
  payableEmployee: number; payableCompany: number; totalSettlement: number;
  expenses: { amount: number }[];
}
interface JournalLineRow { position: string; accountCode: string; amount: number; memo: string | null }

/** Hitung formula baru — SAMA logika dgn travel-service.createClaim. */
function computeSettlement(claim: ClaimRow, advance: number) {
  const expenses = round2(claim.expenses.reduce((s, e) => s + e.amount, 0));
  const aEff = Math.min(Math.max(0, claim.otherCompanyExp), round2(expenses + Math.max(0, claim.exchangeLoss)));
  const R = round2(expenses + Math.max(0, claim.exchangeLoss) - aEff);
  return {
    expenses, aEff, R,
    b: Math.max(0, round2(R - advance)),
    c: Math.max(0, round2(advance - R)),
  };
}

/** Split jurnal baru — SAMA logika dgn travel-service.generateClaimJournal. */
function journalSplit(claim: ClaimRow, advance: number) {
  const { expenses, aEff, R, b, c } = computeSettlement(claim, advance);
  const total = round2(expenses + Math.max(0, claim.exchangeLoss));
  const bPayroll = Math.min(b, R);
  const cPayroll = Math.min(c, round2(R - bPayroll));
  return { total, aEff, bPayroll, cPayroll, cashPortion: round2(R - bPayroll - cPayroll) };
}

/** Apakah jurnal existing sudah konsisten dgn formula baru?
 *  amount bisa string terenkripsi (enc:v1:…) ATAU number legacy → dinormalisasi
 *  oleh caller via decodeAmount sebelum masuk sini. */
function journalConsistent(claim: ClaimRow, advance: number, lines: JournalLineRow[]): boolean {
  const exp = journalSplit(claim, advance);
  const sum = (pos: string, filter: (l: JournalLineRow) => boolean) =>
    round2(lines.filter((l) => l.position === pos && filter(l)).reduce((s, l) => s + l.amount, 0));
  const debitTotal = round2(lines.filter((l) => l.position === "Debit").reduce((s, l) => s + l.amount, 0));
  const hasOldADebit = lines.some((l) => l.position === "Debit" && (l.memo ?? "").includes("pihak lain"));
  return (
    !hasOldADebit &&
    Math.abs(debitTotal - exp.total) < 0.005 &&
    Math.abs(sum("Credit", (l) => l.accountCode === "5105") - exp.aEff) < 0.005 &&
    Math.abs(sum("Credit", (l) => l.accountCode === "2101") - round2(exp.bPayroll + exp.cPayroll)) < 0.005 &&
    Math.abs(sum("Credit", (l) => l.accountCode === "1101") - exp.cashPortion) < 0.005
  );
}

async function migrateSchema(schemaName: string) {
  const tc = tenantCrypto(schemaName);
  // normalisasi amount jurnal: string terenkripsi → number (legacy number tetap)
  const decodeAmount = (v: number | string | null): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    return tc.decryptMoney(v) ?? Number(v) ?? 0;
  };
  // ---- 1. DDL lifecycle advance (idempoten) ----
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  let ddlCols = 0;
  try {
    await c.query(`SET search_path TO "${schemaName}"`);
    const hasStatus = await c.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'TravelAdvance' AND column_name = 'status'",
      [schemaName],
    );
    if (hasStatus.rowCount === 0) {
      await c.query(`ALTER TABLE "TravelAdvance" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Given'`);
      ddlCols++;
    }
    await c.query(`ALTER TABLE "TravelAdvance" ALTER COLUMN "givenAt" DROP NOT NULL`); // idempoten
  } finally {
    await c.end();
  }

  const db: TenantDb = getTenantClient(schemaName);

  // ---- 2. backfill status advance ----
  const advances = await db.travelAdvance.findMany({
    include: { request: { select: { status: true, decidedAt: true } } },
  });
  let voided = 0, requested = 0, givenFixed = 0;
  for (const adv of advances) {
    const reqStatus = adv.request.status;
    if (reqStatus === "Rejected" || reqStatus === "Cancelled") {
      if (adv.status !== "Void") {
        await db.travelAdvance.update({ where: { id: adv.id }, data: { status: "Void" } });
        voided++;
      }
    } else if (reqStatus === "Submitted") {
      if (adv.status !== "Requested" || adv.givenAt !== null) {
        await db.travelAdvance.update({ where: { id: adv.id }, data: { status: "Requested", givenAt: null } });
        requested++;
      }
    } else if (reqStatus === "Approved" && (adv.status !== "Given" || adv.givenAt === null)) {
      await db.travelAdvance.update({
        where: { id: adv.id },
        data: { status: "Given", givenAt: adv.givenAt ?? adv.request.decidedAt ?? new Date() },
      });
      givenFixed++;
    }
  }

  // ---- 3+4+5. rekomputasi klaim + jurnal + assignment ----
  const claims = await db.travelClaim.findMany({
    include: { expenses: { select: { amount: true } } },
    orderBy: { docNo: "asc" },
  }) as unknown as ClaimRow[];
  const advancesByRequest = new Map<string, AdvanceRow[]>();
  for (const adv of advances) {
    const row: AdvanceRow = { id: adv.id, requestId: adv.requestId, status: adv.status, givenAt: adv.givenAt, amount: adv.amount };
    const cur = advancesByRequest.get(adv.requestId) ?? [];
    cur.push(row);
    advancesByRequest.set(adv.requestId, cur);
  }
  const activeAdvance = (claim: ClaimRow) =>
    round2((advancesByRequest.get(claim.requestId ?? "") ?? [])
      .filter((x) => (x.status ?? "Given") !== "Void")
      .reduce((s, x) => s + x.amount, 0));

  let recalculated = 0;
  const changedClaims: { claim: ClaimRow; b: number; c: number; ts: number }[] = [];
  for (const claim of claims) {
    // advance aktif = Σ baris advance request klaim ini yang tidak Void
    const advance = activeAdvance(claim);
    const { R, b, c } = computeSettlement(claim, advance);
    if (
      Math.abs(claim.payableEmployee - b) > 0.005 ||
      Math.abs(claim.payableCompany - c) > 0.005 ||
      Math.abs(claim.totalSettlement - R) > 0.005
    ) {
      await db.travelClaim.update({
        where: { id: claim.id },
        data: { payableEmployee: b, payableCompany: c, totalSettlement: R },
      });
      recalculated++;
      changedClaims.push({ claim, b, c, ts: R });
    }
  }

  // jurnal: hanya klaim yang SUDAH diputus (punya journalNo) — cek konsistensi,
  // regenerate bila masih format lama (debit (a) / split lama).
  let journalsRegen = 0;
  for (const claim of claims) {
    if (!claim.journalNo) continue;
    if (!["Approved", "Transferred", "Paid"].includes(claim.status)) continue;
    const advance = activeAdvance(claim);
    const journal = await db.payrollJournal.findUnique({
      where: { journalNo: claim.journalNo },
      include: { lines: { select: { position: true, accountCode: true, amount: true, memo: true } } },
    });
    // jurnal klaim = runId null + runNo = docNo; jurnal run payroll tidak disentuh
    if (journal && journal.runId === null && !journalConsistent(claim, advance,
      (journal.lines as unknown as { position: string; accountCode: string; amount: number | string; memo: string | null }[])
        .map((l) => ({ position: l.position, accountCode: l.accountCode, memo: l.memo, amount: decodeAmount(l.amount) })))) {
      const regen = await generateClaimJournal(db, claim.id);
      if (regen.journalNo) {
        await db.travelClaim.update({
          where: { id: claim.id },
          data: { journalNo: regen.journalNo, journalDate: regen.journalDate },
        });
        journalsRegen++;
      }
    }
  }

  // assignment UTRP/TRVSTLIN klaim Transferred yang b/c-nya berubah
  let assignmentsSynced = 0;
  const compUtrp = await db.wageComponent.findUnique({ where: { code: "UTRP" } });
  const compDed = await db.wageComponent.findUnique({ where: { code: "TRVSTLIN" } });
  if (compUtrp && compDed) {
    for (const { claim, b, c } of changedClaims) {
      if (claim.status !== "Transferred") continue;
      const targets = await db.employeeComponentAssignment.findMany({
        where: {
          wageComponentId: { in: [compUtrp.id, compDed.id] },
          kind: "Specific",
          notes: { contains: claim.docNo },
        },
        select: { id: true, wageComponentId: true, amount: true },
      });
      // FIX: kunci tenant dari schemaName aktual (dulu SEED_TENANT_SCHEMA — salah kunci standalone)
      for (const t of targets) {
        const expected = Math.round(t.wageComponentId === compUtrp.id ? b : c);
        const currentAmt = tc.decryptMoney(t.amount as unknown as string) ?? Number(t.amount) ?? 0; // legacy plaintext di-parse
        if (Math.abs(currentAmt - expected) > 0.5) {
          await db.employeeComponentAssignment.update({ where: { id: t.id }, data: { amount: tc.encryptMoney(expected) } });
          assignmentsSynced++;
        }
      }
    }
  }

  if (recalculated > 0 || journalsRegen > 0 || voided + requested + givenFixed > 0 || ddlCols > 0) {
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "TravelClaim", entityId: "migrate-travel-settlement-fix",
        detail: `T3-TRAVEL settlement fix: ${recalculated} klaim dihitung ulang (b/c/totalSettlement = rincian + rugi kurs − (a) vs uang muka), ${journalsRegen} jurnal klaim di-regenerate, ${assignmentsSynced} assignment payroll disinkronkan, advance: ${voided} Void / ${requested} Requested / ${givenFixed} Given`,
      },
    });
  }

  await db.$disconnect();
  return { ddlCols, claims: claims.length, recalculated, journalsRegen, assignmentsSynced, voided, requested, givenFixed };
}

let totalClaims = 0, totalRecalc = 0, totalJournals = 0, totalAssign = 0;

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner).
 *  PENTING: jalankan SETELAH migrate-encrypt (kolom jurnal/assignment sudah TEXT
 *  terenkripsi — generateClaimJournal & tulis amount terenkripsi aman). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  totalClaims = 0; totalRecalc = 0; totalJournals = 0; totalAssign = 0;
  for (const schema of list) {
  console.log(`\n[${schema}] T3-TRAVEL settlement fix…`);
  const r = await migrateSchema(schema);
  totalClaims += r.claims; totalRecalc += r.recalculated; totalJournals += r.journalsRegen; totalAssign += r.assignmentsSynced;
  console.log(
    `  kolom baru: ${r.ddlCols} · klaim diperiksa: ${r.claims}, dihitung ulang: ${r.recalculated}` +
    ` · jurnal di-regenerate: ${r.journalsRegen} · assignment disinkronkan: ${r.assignmentsSynced}` +
    ` · advance Void/Requested/Given: ${r.voided}/${r.requested}/${r.givenFixed}`,
  );
  }
  console.log(`\nTOTAL: klaim ${totalClaims} (rekalkulasi ${totalRecalc}), jurnal ${totalJournals}, assignment ${totalAssign}`);
  console.log("DONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
