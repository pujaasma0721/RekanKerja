import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
// P1.4-BM (D-BM8) — chain persetujuan finalisasi utk banner status PendingConfirm.
import { getApprovalChain } from "@/rekankerja/shared/services/approval-engine";
// F1: agregat komponen dihitung lewat tenant-crypto (dispatch prefix enc:v1/v2)
// di batas serializer — sama semantik dgn walker money-view utk mode canSee.
import { tenantCryptoForDb, TENANT_SCHEMA_BRAND } from "@/rekankerja/shared/lib/field-crypto";

// ===========================================================================
// F1 (QA-PAGELOAD-BIGTENANT) — PAGINASI DETAIL RUN ==========================
// ===========================================================================
// Bukti benchmark (tenant bench101 5.000 karyawan): GET lama mengirim SELURUH
// lines+items terdekripsi dalam SATU respons 9,1 MB — cold 11,3 dtk / warm
// ~5,4 dtk, dan satu request menaikkan RSS dev-server +~2 GB (GC tertinggal,
// penyumbang insiden OOM F3). Desain baru:
//   · lines dipaginasi server-side (page/pageSize, default 100, cap 200) —
//     respons ~150 KB terlepas dari jumlah karyawan;
//   · pencarian q (employeeNo/employeeName, case-insensitive) server-side —
//     jangkauan SELURUH run, bukan hanya halaman termuat;
//   · componentTotals (agregat komponen run penuh) dihitung dari query
//     RAMPING (5 kolom item) + dekripsi + CACHE in-memory. Fingerprint
//     (status + waktu kejadian + total terenkripsi + max-id line) berubah
//     setiap calculate/recalc menulis ulang lines → cache otomatis segar;
//   · umkWarnings dihitung server-side run penuh (dulu derivasi frontend dari
//     run.lines — akan terpotong oleh paginasi);
//   · `logs` kini JUGA dikirim top-level (bug lama: frontend membaca data.logs
//     padahal API hanya menaruhnya di run.logs → tab Log selalu kosong).
// ===========================================================================
interface ComponentTotalRow { code: string; name: string; type: string; wageType: string; total: number }

const totalsCacheG = globalThis as unknown as {
  rekankerjaRunComponentTotals?: Map<string, { at: number; rows: ComponentTotalRow[] }>;
};
const totalsCache: Map<string, { at: number; rows: ComponentTotalRow[] }> =
  totalsCacheG.rekankerjaRunComponentTotals ?? new Map();
totalsCacheG.rekankerjaRunComponentTotals = totalsCache;
const TOTALS_CACHE_TTL_MS = 10 * 60_000;
const TOTALS_CACHE_MAX_ENTRIES = 32; // per proses — cukup utk 32 run terakhir dilihat

// GET /api/rekankerja/payroll-run?id=&page=1&pageSize=100&q= — detail run
// + HALAMAN lines + agregat komponen run penuh.
export async function GET(req: NextRequest) {
  try {
    // AUD-DEPLOY (2-a HIGH-3): guard menu — sebelumnya requireTenant saja,
    // seluruh detail run (gaji semua karyawan) terbaca anggota biasa.
    const m = await requireMenuViewAny(req, ["payroll:runs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    // F1: paginasi + pencarian server-side (NaN/negatif → default; cap 200).
    const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(sp.get("pageSize")) || 100) || 100));
    const q = sp.get("q")?.trim() ?? "";

    const run = await db.payrollRun.findUnique({
      where: { id },
      include: {
        period: true,
        processType: true,
        // Task 63 — log kejadian run (parameter kurang/anomali) utk tab Log
        // (cap 500 — log di luar itu diringkas payrollRunLogCount agregat).
        logs: { orderBy: [{ level: "asc" }, { employeeNo: "asc" }], take: 500 },
        // F1: jumlah line run penuh (tanpa filter q) — utk label "N karyawan".
        _count: { select: { lines: true } },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    // where halaman lines: run + pencarian q server-side (insensitive).
    const linesWhere = {
      runId: id,
      ...(q ? { OR: [
        { employeeNo: { contains: q, mode: "insensitive" as const } },
        { employeeName: { contains: q, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [totalLines, maxLine] = await Promise.all([
      db.payrollRunLine.count({ where: linesWhere }),
      // fingerprint cache totals: id line terbaru (cuid monoton waktu —
      // setiap insert line recalc mengubah nilai ini).
      db.payrollRunLine.aggregate({ where: { runId: id }, _max: { id: true } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalLines / pageSize));
    const safePage = Math.min(page, totalPages);

    const lines = totalLines > 0 ? await db.payrollRunLine.findMany({
      where: linesWhere,
      orderBy: { employeeNo: "asc" },
      take: pageSize,
      skip: (safePage - 1) * pageSize,
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }) : [];

    // 28-c: dekripsi di batas serializer — response tetap berbentuk angka
    // (enc:v1:n:… → number, enc:v1:t:… → teks) sehingga frontend tidak berubah.
    // 45-b: gate vault uang — masked → enc:v1:n: → null (frontend render "—").
    const gate = await moneyViewForReq(req, db);
    const dec = gate.json({ ...run, lines });

    // ---- F1: agregat komponen SELURUH run (kartu ringkasan) ----------------
    // Masked (canSee=false) → perilaku identik implementasi lama (jumlah dari
    // nilai 0 → 0 semua): kirim array kosong saja, tanpa query.
    // canSee=true → query ramping 5 kolom + dekripsi + cache fingerprint.
    let componentTotals: ComponentTotalRow[] = [];
    if (run.status !== "Draft" && gate.canSee) {
      const schemaName = (db as unknown as Record<symbol, string | undefined>)[TENANT_SCHEMA_BRAND] ?? "";
      const fp = [
        schemaName, run.id, run.status,
        run.calculatedAt?.toISOString() ?? "",
        run.confirmedAt?.toISOString() ?? "",
        run.paidAt?.toISOString() ?? "",
        String(run.totalBruto), String(run.totalDeduction),
        String(run.totalTax), String(run.totalNet),
        maxLine._max.id ?? "",
      ].join("|");
      const hit = totalsCache.get(fp);
      if (hit && Date.now() - hit.at < TOTALS_CACHE_TTL_MS) {
        componentTotals = hit.rows;
      } else {
        // HANYA kolom agregat — tanpa relasi/field line lain (bekal benchmark:
        // include penuh 5.000 line × 8 item memakan >9 MB & detik-detik).
        const items = await db.payrollRunItem.findMany({
          where: { line: { runId: id } },
          select: { code: true, name: true, type: true, wageType: true, amount: true },
        });
        const tc = tenantCryptoForDb(db);
        const aggByCode = new Map<string, ComponentTotalRow>();
        for (const item of items) {
          const cur = aggByCode.get(item.code)
            ?? { code: item.code, name: item.name, type: item.type, wageType: item.wageType, total: 0 };
          cur.total += tc.decryptMoney(item.amount) ?? 0;
          aggByCode.set(item.code, cur);
        }
        componentTotals = [...aggByCode.values()]
          .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code));
        if (totalsCache.size >= TOTALS_CACHE_MAX_ENTRIES) {
          const oldest = totalsCache.keys().next().value;
          if (oldest !== undefined) totalsCache.delete(oldest);
        }
        totalsCache.set(fp, { at: Date.now(), rows: componentTotals });
      }
    }

    // 26-b P0 — warning UMP/UMK (PP 36/2021) run PENUH di server (dulu derivasi
    // frontend dari run.lines — terpotong paginasi). umkJson = snapshot string.
    const umkWarnings = run.status !== "Draft"
      ? (await db.payrollRunLine.findMany({
          where: { runId: id, umkWarning: true },
          select: { umkJson: true },
          orderBy: { employeeNo: "asc" },
          take: 1000,
        })).flatMap((r) => {
          try { const v = JSON.parse(r.umkJson ?? "null"); return v ? [v] : []; }
          catch { return []; }
        })
      : [];

    // P1.4-BM (D-BM8) — run menunggu persetujuan finalisasi → sertakan chain
    // (jenjang + approver + status) utk banner & tombol Setujui/Tolak di UI.
    const approvalChain = run.status === "PendingConfirm"
      ? await getApprovalChain(db, "PayrollRunConfirm", run.id)
      : null;

    return NextResponse.json({
      run: dec,
      componentTotals,
      umkWarnings,
      pagination: { page: safePage, pageSize, totalLines, totalPages },
      // Fix bug lama: frontend membaca data.logs (top-level) padahal API hanya
      // menaruh log di run.logs → tab Log selalu kosong. Dikirim di keduanya.
      logs: (dec as { logs?: unknown }).logs ?? [],
      ...(approvalChain ? { approvalChain } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
