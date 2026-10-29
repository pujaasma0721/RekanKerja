// OneVity — Report Builder (Task 28-b) =====================================
// Ekspor hasil laporan kustom → file unduhan (Content-Disposition):
//   · POST /api/onevity/custom-reports/export — body { entity, fields,
//     filters, format: "csv"|"xlsx", id?, name? } (spesifikasi inline;
//     bila `id` terisi → pakai definisi laporan tersimpan).
//   · GET  /api/onevity/custom-reports/export?id=<savedId>&format=csv|xlsx —
//     ekspor laporan tersimpan langsung.
// Guard op hr:custom-reports:export; setiap ekspor menulis ActivityLog
// (entity CustomReport, action Exported — format + jumlah baris + aktor).
// CSV/XLSX dibangun shared/lib/export.ts (angka numerik, tanggal dd MMM yyyy).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { getMoneyView } from "@/onevity/shared/lib/money-view";
import {
  buildReportFile, ReportSpecError, serializeSaved, type ExportFormat,
} from "@/onevity/shared/services/report-builder";

export const runtime = "nodejs";

/** Ambil spesifikasi dr laporan tersimpan (fields/filters tersimpan). */
async function specOfSaved(db: Parameters<typeof buildReportFile>[0], id: string) {
  const saved = await db.customReport.findUnique({ where: { id } });
  if (!saved) throw new ReportSpecError(`Laporan tersimpan tidak ditemukan (id ${id})`);
  const row = serializeSaved(saved);
  return { entity: row.entity, fields: row.fields, filters: row.filters, name: row.name };
}

function fileResponse(body: Buffer | string, filename: string, contentType: string): NextResponse {
  const payload = typeof body === "string" ? body : new Uint8Array(body);
  return new NextResponse(payload, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:custom-reports", "op:export");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json().catch(() => ({}));
    const format = b.format === "xlsx" ? "xlsx" : b.format === "csv" ? "csv" : null;
    if (format !== "csv" && format !== "xlsx") {
      return NextResponse.json({ error: "Format ekspor harus csv atau xlsx" }, { status: 400 });
    }
    const spec = b.id
      ? await specOfSaved(m.db, String(b.id))
      : { entity: b.entity, fields: b.fields, filters: b.filters, name: b.name };
    // 45-b: gerbang vault uang — aktor requireMenuAction (userId+role).
    const file = await buildReportFile(m.db, { ...spec, format },
      await getMoneyView(m.db, { userId: m.actor.userId, membershipRole: m.actor.role }));
    await m.db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId,
        action: "Exported", entity: "CustomReport", entityId: String(b.id ?? ""),
        detail: `Ekspor laporan kustom ${file.entityKey} → ${file.filename} (${file.rowCount} baris, ${format.toUpperCase()}) oleh ${m.actor.appUsername ?? m.actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan unduhan */ });
    return fileResponse(file.body, file.filename, file.contentType);
  } catch (e) {
    if (e instanceof ReportSpecError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:custom-reports", "op:export");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const format = sp.get("format");
    if (!id) return NextResponse.json({ error: "Parameter id wajib" }, { status: 400 });
    if (format !== "csv" && format !== "xlsx") {
      return NextResponse.json({ error: "Parameter format harus csv atau xlsx" }, { status: 400 });
    }
    const spec = await specOfSaved(m.db, id);
    // 45-b: gerbang vault uang — aktor requireMenuAction (userId+role).
    const file = await buildReportFile(m.db, { ...spec, format: format as ExportFormat },
      await getMoneyView(m.db, { userId: m.actor.userId, membershipRole: m.actor.role }));
    await m.db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId,
        action: "Exported", entity: "CustomReport", entityId: id,
        detail: `Ekspor laporan tersimpan "${spec.name}" → ${file.filename} (${file.rowCount} baris, ${format.toUpperCase()}) oleh ${m.actor.appUsername ?? m.actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan unduhan */ });
    return fileResponse(file.body, file.filename, file.contentType);
  } catch (e) {
    if (e instanceof ReportSpecError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
