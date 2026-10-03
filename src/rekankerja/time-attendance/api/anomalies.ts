// GET /api/rekankerja/attendance/anomalies?from=YYYY-MM-DD&to=YYYY-MM-DD
// Task 100 F1 (G27+G29, impl-C) — laporan anomali presensi + burnout lembur.
// Default window = 30 hari terakhir. Guard VIEW menu liveboard ATAU schedules
// (pola absence-export — menu yang melihat rekap kehadiran).
// Webhook "attendance.anomaly" dikirim best-effort utk severity TINGGI
// (tidak boleh memblokir response).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import { detectAnomalies, burnoutRolling } from "@/rekankerja/time-attendance/services/attendance-anomaly";

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:liveboard", "attendance:schedules"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const parseDay = (v: string | null): Date | null =>
      v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null;
    const now = new Date();
    const to = parseDay(sp.get("to")) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const from = parseDay(sp.get("from")) ?? new Date(to.getTime() - 30 * 86_400_000);
    if (from >= to) {
      return NextResponse.json({ error: "Parameter from harus sebelum to" }, { status: 400 });
    }
    // batasi jendela maksimal 180 hari (beban scan tetap terkendali).
    const maxFrom = new Date(to.getTime() - 180 * 86_400_000);
    const effFrom = from < maxFrom ? maxFrom : from;

    const [anomalies, burnout] = await Promise.all([
      detectAnomalies(db, effFrom, to),
      burnoutRolling(db),
    ]);

    // wire webhook utk anomali tinggi — best-effort (never-throw, tanpa await
    // supaya kirim tidak memperlambat response; kegagalan dicatat WebhookLog).
    for (const a of anomalies) {
      if (a.severity === "tinggi") {
        void dispatchWebhookEvent(db, null, "attendance.anomaly", {
          type: a.type,
          severity: a.severity,
          employeeNo: a.employeeNo,
          fullName: a.fullName,
          detail: a.detail,
          window: { from: effFrom.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
          source: "anomaly-scan",
        }).catch(() => undefined);
      }
    }

    return NextResponse.json({
      from: effFrom.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      anomalies,
      burnout,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
