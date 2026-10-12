import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// ============================================================================
// PERFORMANCE — API pengaturan modul (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md §17)
//   GET   → { setting } (buat default bila belum ada — idempoten)
//   PATCH → update (docPrefixes/defWeights/appealDays/retentionYears)
// Guard menu: performance:settings. ActivityLog di setiap mutasi.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:settings", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    let setting = await db.performanceSetting.findFirst();
    if (!setting) {
      setting = await db.performanceSetting.create({ data: {} });
    }
    return NextResponse.json({ setting });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const m = await requireMenuAction(req, "performance:settings", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    let setting = await db.performanceSetting.findFirst();
    if (!setting) setting = await db.performanceSetting.create({ data: {} });

    // validasi
    const docPrefixes = b.docPrefixes != null ? String(b.docPrefixes) : setting.docPrefixes;
    const prefixes = docPrefixes.split("|").map((x) => x.trim()).filter(Boolean);
    if (prefixes.length !== 4) bad("Penomoran harus 4 prefix dipisah | (PER|PRB|PIP|MER)");
    const defWeights = b.defWeights != null ? String(b.defWeights) : setting.defWeights;
    const w = defWeights.split("|").map((x) => Number(x));
    if (w.length !== 3 || !w.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
      bad("Bobot default harus 3 angka 0–100 dipisah | (contoh 70|20|10)");
    }
    if (Math.abs(w[0] + w[1] + w[2] - 100) > 0.01) bad("Jumlah bobot default harus 100");
    const appealDays = b.appealDays != null ? Math.trunc(Number(b.appealDays)) : setting.appealDays;
    if (!(appealDays >= 1 && appealDays <= 60)) bad("Jendela banding 1–60 hari");
    const retentionYears = b.retentionYears != null ? Math.trunc(Number(b.retentionYears)) : setting.retentionYears;
    if (!(retentionYears >= 1 && retentionYears <= 30)) bad("Retensi arsip 1–30 tahun");

    const updated = await db.performanceSetting.update({
      where: { id: setting.id },
      data: { docPrefixes: prefixes.join("|"), defWeights: w.join("|"), appealDays, retentionYears },
    });
    await db.activityLog.create({
      data: {
        action: "Updated",
        entity: "PerformanceSetting",
        entityId: setting.id,
        detail: `Pengaturan modul Kinerja diperbarui (penomoran ${prefixes.join("|")} · bobot ${w.join("|")} · banding ${appealDays} hari · retensi ${retentionYears} tahun)`,
      },
    });
    return NextResponse.json({ setting: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

function bad(msg: string): never { throw new Error(msg); }
