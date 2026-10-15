import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { getPerfSetting, updatePerfSetting, nextPerfNo } from "@/rekankerja/performance/services/perf-master-service";

// ============================================================================
// PERFORMANCE — API pengaturan modul (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md §14
// menu Pengaturan: penomoran dokumen, bobot default, jendela banding, retensi)
//   GET  → { setting } (+ previewNextNo bila ?previewNo=PER|PRB|PIP|MER)
//   POST { docPrefixes?, defWeights?, appealDays?, retentionYears? } → { setting }
// Guard menu: performance:settings.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:settings", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const setting = await getPerfSetting(db);
    const previewKind = req.nextUrl.searchParams.get("previewNo");
    if (previewKind === "PER" || previewKind === "PRB" || previewKind === "PIP" || previewKind === "MER") {
      const nextNo = await nextPerfNo(db, previewKind);
      return NextResponse.json({ setting, nextNo });
    }
    return NextResponse.json({ setting });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const m = await requireMenuAction(req, "performance:settings", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const setting = await updatePerfSetting(db, {
      docPrefixes: b.docPrefixes != null ? String(b.docPrefixes) : undefined,
      defWeights: b.defWeights != null ? String(b.defWeights) : undefined,
      appealDays: b.appealDays != null ? Number(b.appealDays) : undefined,
      retentionYears: b.retentionYears != null ? Number(b.retentionYears) : undefined,
      // B1-BL (D-BL2) — mode OKR kuartalan per-tenant (default OFF).
      okrEnabled: b.okrEnabled != null ? b.okrEnabled === true : undefined,
    });
    await db.activityLog.create({
      data: {
        action: "Updated",
        entity: "PerformanceSetting",
        entityId: setting.id,
        detail: `Pengaturan kinerja: prefix=${setting.docPrefixes} bobot=${setting.defWeights} banding=${setting.appealDays}hari retensi=${setting.retentionYears}th okr=${setting.okrEnabled ? "AKTIF" : "off"}`,
      },
    });
    return NextResponse.json({ setting });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
