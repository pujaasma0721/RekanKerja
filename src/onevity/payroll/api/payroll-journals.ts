import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { generateJournalForRun } from "@/onevity/payroll/services/payroll-journal";

// GET /api/onevity/payroll-journals            → daftar jurnal + run yang belum diposting
// GET /api/onevity/payroll-journals?id=        → detail jurnal (dengan lines)
// GET /api/onevity/payroll-journals?export=csv&id= → CSV jurnal
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const exportCsv = req.nextUrl.searchParams.get("export");
    const id = req.nextUrl.searchParams.get("id");

    if (id) {
      const journal = await db.payrollJournal.findUnique({
        where: { id },
        include: { lines: { orderBy: { sequence: "asc" } } },
      });
      if (!journal) return NextResponse.json({ error: "Jurnal tidak ditemukan" }, { status: 404 });

      if (exportCsv === "csv") {
        const header = ["SEQ", "AKUN", "NAMA_AKUN", "POSISI", "NOMINAL", "MEMO", "KOMPONEN"].join(";");
        const rows = journal.lines.map((l) => [
          l.sequence, l.accountCode, `"${l.accountName}"`, l.position, Math.round(l.amount),
          `"${l.memo ?? ""}"`, l.wageCode ?? "",
        ].join(";"));
        const totals = ["", "", `"TOTAL (${journal.journalNo})"`, "D", Math.round(journal.totalDebit), `"C = ${Math.round(journal.totalCredit)} (balance ✓)"`, ""].join(";");
        const csv = [`OneVity Payroll Journal — ${journal.journalNo} (${journal.runNo ?? "-"})`, header, ...rows, totals].join("\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="onevity-jurnal-${journal.journalNo}.csv"`,
          },
        });
      }
      return NextResponse.json({ journal });
    }

    const journals = await db.payrollJournal.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { lines: true } } },
    });

    // Run confirmed/paid yang belum punya jurnal (untuk tombol backfill di UI).
    const runs = await db.payrollRun.findMany({
      where: { status: { in: ["Confirmed", "Paid"] } },
      include: { period: true, processType: true },
      orderBy: { confirmedAt: "asc" },
    });
    const journalRunIds = new Set(journals.map((j) => j.runId).filter(Boolean) as string[]);
    const missingRuns = runs
      .filter((r) => !journalRunIds.has(r.id))
      .map((r) => ({ id: r.id, runNo: r.runNo, periodName: r.period.name, typeName: r.processType.name, status: r.status }));

    return NextResponse.json({ journals, missingRuns });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/payroll-journals — generate jurnal untuk run (backfill/idempotent)
// T1-SECURITY: guard hak AKSI menu payroll:journals (Baru) — membuat jurnal
// adalah mutasi data keuangan; VIEWER / tanpa izin ditolak.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:journals", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.runId) return NextResponse.json({ error: "runId wajib" }, { status: 400 });
    const journal = await generateJournalForRun(db, b.runId);
    return NextResponse.json({ journal });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
