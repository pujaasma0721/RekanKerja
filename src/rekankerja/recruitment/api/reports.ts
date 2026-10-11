import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { toCsv, csvResponse, exportFilename, type ExportCell, type ExportColumn } from "@/rekankerja/shared/lib/export";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  getRecruitmentDashboard, getMetricsCatalog, getAdverseImpact, getProjections,
  getSnapshotHistory,
} from "@/rekankerja/recruitment/services/analytics-service";

// ============================================================================
// RECRUITMENT F8 — API Analytics & Prediktif (DEVELOPMENT-PLAN-RECRUITMENT.md
// §7 F8 + HRX G1–G5 + P4 adverse-impact). Guard: menu recruitment:reports.
//   GET  ?section=dashboard|metrics|adverse-impact|projections|history[&metric=]
//   GET  ?views=1                       → tampilan tersimpan MILIK AKTOR
//   GET  ?export=dashboard|metrics|adverse-impact (op:export) → CSV
//   POST { action: view-save|view-delete|view-schedule (op:views) }
// SavedReportView selalu milik aktor (ownerId = actor.employeeId) — orang
// lain tidak bisa mengubah/menghapus tampilan milik orang lain.
// ============================================================================

const METRIC_KEY_RE = /^[a-z0-9_]{1,40}$/;
const VIEW_KEY_RE = /^[a-z0-9-]{1,40}$/;
const SCHEDULES = ["none", "weekly"] as const;

interface SavedViewRow {
  id: string;
  name: string;
  view: string;
  filters: Record<string, unknown>;
  schedule: string;
  createdAt: string;
  updatedAt: string;
}

function serializeSaved(r: {
  id: string; name: string; view: string; filtersJson: string; schedule: string;
  createdAt: Date; updatedAt: Date;
}): SavedViewRow {
  let filters: Record<string, unknown> = {};
  try { filters = JSON.parse(r.filtersJson) as Record<string, unknown>; } catch { filters = {}; }
  return {
    id: r.id,
    name: r.name,
    view: r.view,
    filters,
    schedule: r.schedule,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function listMyViews(db: TenantDb, ownerId: string): Promise<SavedViewRow[]> {
  const rows = await db.savedReportView.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map(serializeSaved);
}

// ============ CSV builders (data sama dengan section JSON) ============

function dashboardCsv(d: Awaited<ReturnType<typeof getRecruitmentDashboard>>): { columns: ExportColumn[]; rows: ExportCell[][] } {
  const columns: ExportColumn[] = [
    { header: "Seksi", width: 22 }, { header: "Item", width: 34 }, { header: "Nilai 1", width: 18 },
    { header: "Nilai 2", width: 18 }, { header: "Nilai 3", width: 18 }, { header: "Keterangan", width: 42 },
  ];
  const rows: ExportCell[][] = [];
  rows.push(["Kesehatan PR", "PR terbuka", d.prHealth.open, "", "", `Umur rata-rata ${d.prHealth.avgAgeDays ?? "—"} hari`]);
  rows.push(["Kesehatan PR", "PR tertua", d.prHealth.oldest?.prNo ?? "—", d.prHealth.oldest?.days ?? "—", "", "hari sejak requestDate"]);
  rows.push(["Kesehatan PR", "Ditutup bulan ini", d.prHealth.closedThisPeriod, "", "", "Fulfilled/Closed/Cancelled"]);
  rows.push(["Kesehatan PR", "PR at-risk (lebih dari SLA target)", d.prHealth.atRisk.length, "", "", "slaTargetDays terisi & umur > target"]);
  for (const r of d.prHealth.atRisk.slice(0, 20)) {
    rows.push(["Kesehatan PR — at-risk", r.prNo, r.positionTitle ?? "—", r.ageDays, r.targetDays, "umur / target (hari)"]);
  }
  for (const r of d.recruiterLoad) {
    rows.push(["Beban recruiter", r.name, r.activeCandidates, r.activePrs, "", "kandidat aktif / PR aktif"]);
  }
  rows.push(["Kepatuhan SLA", "Tahap tepat waktu", d.slaCompliance.onTime, d.slaCompliance.late, d.slaCompliance.rate ?? "—", "onTime / late / rate %"]);
  if (d.slaCompliance.latestStage) {
    rows.push(["Kepatuhan SLA", "Tahap terlambat terbanyak", d.slaCompliance.latestStage.name, d.slaCompliance.latestStage.late, "", "jumlah terlambat"]);
  }
  rows.push(["ROI sumber", "Sumber", "Belanja (IDR)", "Hire", "Cost per hire (IDR)", ""]);
  for (const r of d.sourceRoi) {
    rows.push(["ROI sumber", r.source, r.spend ?? 0, r.hires, r.costPerHire ?? "—", ""]);
  }
  rows.push(["Funnel", "Tahap", "Jumlah", "", "", ""]);
  for (const s of d.funnel.stages) {
    rows.push(["Funnel", s.label, s.count, "", "", ""]);
  }
  rows.push(["Funnel", "Tingkat penerimaan offer", `${d.funnel.offerAcceptanceRate ?? "—"}%`, "", "", ""]);
  return { columns, rows };
}

function metricsCsv(m: Awaited<ReturnType<typeof getMetricsCatalog>>): { columns: ExportColumn[]; rows: ExportCell[][] } {
  const columns: ExportColumn[] = [
    { header: "Metrik", width: 28 }, { header: "Label", width: 30 }, { header: "Nilai", width: 14 },
    { header: "Satuan", width: 8 }, { header: "Keterangan", width: 60 },
  ];
  const rows: ExportCell[][] = m.map((x) => [x.key, x.labelId, x.value ?? "—", x.unit, x.hint]);
  for (const x of m) {
    for (const b of x.breakdown ?? []) {
      rows.push([x.key, `${x.labelId} — ${b.source}`, b.rate ?? "—", "%", `${b.hires} hire dari ${b.applicants} pelamar`]);
    }
  }
  return { columns, rows };
}

function adverseCsv(a: Awaited<ReturnType<typeof getAdverseImpact>>): { columns: ExportColumn[]; rows: ExportCell[][] } {
  const columns: ExportColumn[] = [
    { header: "Tahap", width: 24 }, { header: "Dimensi", width: 12 }, { header: "Kelompok", width: 16 },
    { header: "Masuk", width: 8 }, { header: "Lulus", width: 8 }, { header: "Rate %", width: 10 },
    { header: "4/5ths", width: 10 }, { header: "n kecil", width: 8 },
  ];
  const rows: ExportCell[][] = [];
  for (const st of a.stages) {
    for (const dim of st.dims) {
      for (const g of dim.groups) {
        rows.push([
          st.stage, dim.dim, g.label, g.entered, g.passed, g.rate ?? "—",
          g.flag ? "FLAG" : "", g.small ? "ya" : "",
        ]);
      }
      rows.push([st.stage, dim.dim, `(impact ratio: ${dim.impactRatio ?? "—"}${dim.flagged ? " — FLAG < 0,8" : ""})`, "", "", "", "", ""]);
    }
  }
  return { columns, rows };
}

// ============ GET ============

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const exportSection = sp.get("export");

    // ---- export CSV (guard op:export) ----
    if (exportSection) {
      const m = await requireMenuAction(req, "recruitment:reports", "op:export");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;
      let built: { columns: ExportColumn[]; rows: ExportCell[][] } | null = null;
      let name = "";
      if (exportSection === "dashboard") { built = dashboardCsv(await getRecruitmentDashboard(db)); name = "rekankerja-reports-dashboard"; }
      else if (exportSection === "metrics") { built = metricsCsv(await getMetricsCatalog(db)); name = "rekankerja-reports-metrics"; }
      else if (exportSection === "adverse-impact") { built = adverseCsv(await getAdverseImpact(db)); name = "rekankerja-reports-adverse-impact"; }
      else return NextResponse.json({ error: `Bagian ekspor tidak dikenal: ${exportSection}` }, { status: 400 });
      return csvResponse(toCsv(built.columns, built.rows, "id"), exportFilename(name, "csv"));
    }

    // ---- section JSON (guard view) ----
    const m = await requireMenuViewAny(req, ["recruitment:reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    if (sp.get("views")) {
      if (!m.actor.employeeId) return NextResponse.json({ views: [] });
      return NextResponse.json({ views: await listMyViews(db, m.actor.employeeId) });
    }

    const section = sp.get("section") ?? "dashboard";
    switch (section) {
      case "dashboard":
        return NextResponse.json({ dashboard: await getRecruitmentDashboard(db) });
      case "metrics":
        return NextResponse.json({ metrics: await getMetricsCatalog(db) });
      case "adverse-impact":
        return NextResponse.json({ adverseImpact: await getAdverseImpact(db) });
      case "projections":
        return NextResponse.json({ projections: await getProjections(db) });
      case "history": {
        const metric = sp.get("metric") ?? "time_to_fill";
        if (!METRIC_KEY_RE.test(metric)) {
          return NextResponse.json({ error: "Kunci metrik tidak valid" }, { status: 400 });
        }
        const limitRaw = Number(sp.get("limit") ?? 24);
        const limit = Number.isFinite(limitRaw) ? limitRaw : 24;
        return NextResponse.json({ history: await getSnapshotHistory(db, metric, limit) });
      }
      default:
        return NextResponse.json({ error: `Bagian tidak dikenal: ${section}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST — saved views milik aktor ============

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "");
    const m = await requireMenuAction(req, "recruitment:reports", "op:views");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    switch (action) {
      case "view-save": {
        if (!m.actor.employeeId) {
          return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan — tampilan tersimpan tidak tersedia" }, { status: 400 });
        }
        const name = String(b.name ?? "").trim();
        const view = String(b.view ?? "").trim();
        if (name.length < 1 || name.length > 80) {
          return NextResponse.json({ error: "Nama tampilan wajib 1–80 karakter" }, { status: 400 });
        }
        if (!VIEW_KEY_RE.test(view)) {
          return NextResponse.json({ error: "Key view tidak valid (huruf kecil/angka/tanda hubung)" }, { status: 400 });
        }
        const filters = (b.filters && typeof b.filters === "object" && !Array.isArray(b.filters)) ? b.filters : {};
        const filtersJson = JSON.stringify(filters);
        if (filtersJson.length > 4000) {
          return NextResponse.json({ error: "Filter terlalu panjang (maks ±4000 karakter)" }, { status: 400 });
        }
        const row = await db.savedReportView.create({
          data: { ownerId: m.actor.employeeId, name, view, filtersJson },
        });
        await db.activityLog.create({
          data: {
            actorType: "user", employeeId: m.actor.employeeId, action: "Created",
            entity: "SavedReportView", entityId: row.id,
            detail: `Tampilan laporan "${name}" (${view}) disimpan oleh ${m.actor.name}`,
          },
        }).catch(() => {});
        return NextResponse.json({ view: serializeSaved(row) }, { status: 201 });
      }
      case "view-delete": {
        if (!m.actor.employeeId) return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan" }, { status: 400 });
        const id = String(b.id ?? "");
        const row = await db.savedReportView.findUnique({ where: { id } });
        if (!row || row.ownerId !== m.actor.employeeId) {
          return NextResponse.json({ error: "Tampilan tidak ditemukan" }, { status: 404 });
        }
        await db.savedReportView.delete({ where: { id } });
        await db.activityLog.create({
          data: {
            actorType: "user", employeeId: m.actor.employeeId, action: "Deleted",
            entity: "SavedReportView", entityId: id,
            detail: `Tampilan laporan "${row.name}" dihapus oleh ${m.actor.name}`,
          },
        }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "view-schedule": {
        if (!m.actor.employeeId) return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan" }, { status: 400 });
        const id = String(b.id ?? "");
        const schedule = String(b.schedule ?? "");
        if (!(SCHEDULES as readonly string[]).includes(schedule)) {
          return NextResponse.json({ error: "Jadwal harus \"none\" atau \"weekly\"" }, { status: 400 });
        }
        const row = await db.savedReportView.findUnique({ where: { id } });
        if (!row || row.ownerId !== m.actor.employeeId) {
          return NextResponse.json({ error: "Tampilan tidak ditemukan" }, { status: 404 });
        }
        const updated = await db.savedReportView.update({ where: { id }, data: { schedule } });
        await db.activityLog.create({
          data: {
            actorType: "user", employeeId: m.actor.employeeId, action: "Updated",
            entity: "SavedReportView", entityId: id,
            detail: `Jadwal tampilan "${row.name}" = ${schedule} (oleh ${m.actor.name})`,
          },
        }).catch(() => {});
        return NextResponse.json({ view: serializeSaved(updated) });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
