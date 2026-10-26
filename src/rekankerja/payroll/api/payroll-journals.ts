import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { generateJournalForRun } from "@/rekankerja/payroll/services/payroll-journal";
import { trFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";

// GET /api/rekankerja/payroll-journals            → daftar jurnal + run yang belum diposting
// GET /api/rekankerja/payroll-journals?id=        → detail jurnal (dengan lines)
// GET /api/rekankerja/payroll-journals?export=csv&id= → CSV jurnal
// fix audit 42 K-2 (KRITIS): jurnal memuat nominal TERDEKRIPTI — dulu GET
// hanya requireTenant (POST sudah berguard). Guard hak AKSI menu
// payroll:journals view (key nav "Jurnal Payroll" — menu halaman ini
// sendiri; read-only, ekspor CSV sebangun view).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:journals", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    // 28-c: nominal jurnal tersimpan terenkripsi — dekripsi di batas serializer.
    // 45-b: gate vault — generateJurnal (POST) & dm CSV memakai raw tc saat
    // menulis; display (JSON/CSV) via mv (masked → null/0).
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    const dm = (v: string | null) => mv.dec0(v);

    const exportCsv = req.nextUrl.searchParams.get("export");
    const id = req.nextUrl.searchParams.get("id");

    if (id) {
      const journal = await db.payrollJournal.findUnique({
        where: { id },
        include: { lines: { orderBy: { sequence: "asc" } } },
      });
      if (!journal) return NextResponse.json({ error: "Jurnal tidak ditemukan" }, { status: 404 });

      // ===== P1.4-BM (D-BM11) — ekspor GL ke format akuntansi eksternal =====
      // accurate|jurnal|generic: nominal via dm (vault-aware), D/K dipecah ke
      // kolom Debit/Credit terpisah sesuai konvensi impor tiap sistem.
      const glFormat = exportCsv === "accurate" || exportCsv === "jurnal" || exportCsv === "generic" ? exportCsv : null;
      if (glFormat) {
        const lang: Lang = req.nextUrl.searchParams.get("lang") === "id" ? "id" : "en";
        const H = (idText: string, enText: string) => trFor(lang, idText, enText);
        const gi = (s: string | null | undefined): string => {
          const v = s ?? "";
          return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
        };
        const isoDate = (d: Date) => new Date(d).toISOString().slice(0, 10);
        const dec = (v: string | null) => String(Math.round(dm(v)));
        let header: string;
        let rows: string[];
        if (glFormat === "accurate") {
          header = ["Date", "RefNo", "Description", "Account", "AccountName", "Debit", "Credit", "Currency"].join(";");
          rows = journal.lines.map((l) => [
            isoDate(journal.journalDate),
            `"${gi(journal.journalNo)}"`,
            `"${gi(journal.description)}"`,
            gi(l.accountCode),
            `"${gi(l.accountName)}"`,
            l.position === "Debit" ? dec(l.amount) : "0",
            l.position === "Credit" ? dec(l.amount) : "0",
            "IDR",
          ].join(";"));
        } else if (glFormat === "jurnal") {
          header = ["Transaction Date", "Memo", "Account Code", "Account Name", "Debit", "Credit"].join(";");
          rows = journal.lines.map((l) => [
            isoDate(journal.journalDate),
            `"${gi(journal.description)}"`,
            gi(l.accountCode),
            `"${gi(l.accountName)}"`,
            l.position === "Debit" ? dec(l.amount) : "0",
            l.position === "Credit" ? dec(l.amount) : "0",
          ].join(";"));
        } else {
          header = [
            H("No Jurnal", "Journal No"), H("Tanggal", "Date"), H("Keterangan", "Description"),
            H("Akun", "Account"), H("Nama Akun", "Account Name"), H("Debit", "Debit"), H("Kredit", "Credit"),
            H("Komponen", "Wage Code"), H("Memo Baris", "Line Memo"),
          ].join(";");
          rows = journal.lines.map((l) => [
            `"${gi(journal.journalNo)}"`,
            isoDate(journal.journalDate),
            `"${gi(journal.description)}"`,
            gi(l.accountCode),
            `"${gi(l.accountName)}"`,
            l.position === "Debit" ? dec(l.amount) : "0",
            l.position === "Credit" ? dec(l.amount) : "0",
            gi(l.wageCode) || "",
            `"${gi(l.memo)}"`,
          ].join(";"));
        }
        const totalD = journal.lines.filter((l) => l.position === "Debit").reduce((s, l) => s + Math.round(dm(l.amount)), 0);
        const totalC = journal.lines.filter((l) => l.position === "Credit").reduce((s, l) => s + Math.round(dm(l.amount)), 0);
        const footer = ["", "", `"${H("TOTAL — seimbang", "TOTAL — balanced")}"`, "", "", String(totalD), String(totalC)].join(";");
        const csv = [
          `${H("RekanKerja — Ekspor Jurnal GL", "RekanKerja — GL Journal Export")} (${glFormat}) — ${gi(journal.journalNo)} / ${gi(journal.runNo ?? "-")}`,
          header,
          ...rows,
          footer,
        ].join("\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="rekankerja-gl-${glFormat}-${journal.journalNo}.csv"`,
          },
        });
      }

      if (exportCsv === "csv") {
        // BL2-a (audit bilingual): header/footer CSV legacy kini dwibahasa — pola
        // H() ekspor GL di atas (?lang=, default en utk format ekspor — UI selalu
        // mengirim lang eksplisit dari useI18n).
        const lang: Lang = req.nextUrl.searchParams.get("lang") === "id" ? "id" : "en";
        const H = (idText: string, enText: string) => trFor(lang, idText, enText);
        // AUD-DEPLOY (2-b MED-4) — CSV formula injection: string user yang
        // diawali = + - @ (atau tab/CR) diprefix "'" (mengapit "…" hanya
        // escape CSV, bukan proteksi formula). Angka & kolom sistem aman.
        const gi = (s: string | null | undefined): string => {
          const v = s ?? "";
          return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
        };
        const header = ["SEQ", H("AKUN", "Account"), H("NAMA_AKUN", "Account Name"), H("POSISI", "D/C"), H("NOMINAL", "Amount"), "MEMO", H("KOMPONEN", "Wage Code")].join(";");
        const rows = journal.lines.map((l) => [
          l.sequence, l.accountCode, `"${gi(l.accountName)}"`, l.position, Math.round(dm(l.amount)),
          `"${gi(l.memo)}"`, l.wageCode ?? "",
        ].join(";"));
        const totals = ["", "", `"TOTAL (${gi(journal.journalNo)})"`, "D", Math.round(dm(journal.totalDebit)), `"C = ${Math.round(dm(journal.totalCredit))} (balance ✓)"`, ""].join(";");
        const csv = [`RekanKerja Payroll Journal — ${gi(journal.journalNo)} (${gi(journal.runNo ?? "-")})`, header, ...rows, totals].join("\n");
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="rekankerja-jurnal-${journal.journalNo}.csv"`,
          },
        });
      }
      return NextResponse.json({ journal: mv.json(journal) });
    }

    // Sort server-side (Task 76): whitelist kolom langsung via orderBy Prisma;
    // nominal terenkripsi (debit/kredit) & _count lines diurut in-memory di UI-fetch
    // berikut (endpoint full-list, tanpa take/skip → tetap lintas seluruh data).
    const spJ = req.nextUrl.searchParams;
    const JOURNAL_SORT = { journal: "journalNo", date: "journalDate", run: "runNo", desc: "description", status: "status" } as const;
    const sortColJ = (spJ.get("sortBy") && (JOURNAL_SORT as Record<string, string>)[spJ.get("sortBy")!]) || "createdAt";
    const sortDirJ: "asc" | "desc" = spJ.get("sortDir") === "desc" ? "desc" : spJ.get("sortDir") === "asc" ? "asc" : sortColJ === "createdAt" ? "desc" : "asc";
    const journals = await db.payrollJournal.findMany({
      orderBy: { [sortColJ]: sortDirJ },
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

    return NextResponse.json({ journals: mv.json(journals), missingRuns });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/payroll-journals — generate jurnal untuk run (backfill/idempotent)
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
    // 28-c: dekripsi nominal di batas serializer (angka utk frontend).
    // 45-b: gate vault (aktor requireMenuAction).
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    return NextResponse.json({ journal: mv.json(journal) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
