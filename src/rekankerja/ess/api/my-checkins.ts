import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { myCheckins, fillEmployeePart } from "@/rekankerja/performance/services/perf-checkin-service";

// ============================================================================
// PERFORMANCE — ESS "Check-in Saya" (P2 — §17 ess/my-checkins + §27-2/3):
//   GET  → riwayat 1-on-1 semua siklus milik karyawan + progres tengah tahun
//          (midActual per KPI — "progress tampil di kedua sisi").
//   POST {action: fill, id, wins/blockers/next} → BAGIAN KARYAWAN dari check-in
//          dua arah (§27-2 — catatan karyawan digabung; hasil final dicatat
//          atasan). Ekstensi kecil di luar blueprint GET (dibutuhkan alur
//          dua arah §27-2 — dicatat worklog).
// Guard: requireEss (self-scope anti-IDOR).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  try {
    const rows = await myCheckins(m.actor.db, m.actor.employeeId);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    if (action !== "fill") return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const out = await fillEmployeePart(db, employeeId, String(b.id ?? ""), {
      wins: Array.isArray(b.wins) ? b.wins.map(String) : [],
      blockers: Array.isArray(b.blockers) ? b.blockers.map(String) : [],
      next: Array.isArray(b.next) ? b.next.map(String) : [],
    });
    await db.activityLog.create({
      data: {
        action: "Submitted", entity: "CheckIn", entityId: out.id,
        detail: "Bagian karyawan check-in 1-on-1 terisi (dua arah §27-2)",
      },
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
