// POST /api/rekankerja/payroll/simulation — simulasi THP stateless (D-BM9).
// Guard: LIHAT salah satu menu payroll:simulation / payroll:runs (menu simulasi
// terdaftar nav "Simulasi THP"; pengguna lama tanpa menu baru tetap lolos via
// payroll:runs). TANPA persistensi domain — hanya 1 baris ActivityLog tanpa
// nominal (kebijakan D-BM9: simulasi bukan janji gaji).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { runThpSimulation, validateSimulationInput } from "@/rekankerja/payroll/services/simulation-service";

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["payroll:simulation", "payroll:runs"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json().catch(() => null);
    const { input, error } = validateSimulationInput(b);
    if (error || !input) return NextResponse.json({ error: error ?? "Input tidak valid" }, { status: 400 });

    const result = await runThpSimulation(db, input);

    // Jejak audit TANPA nominal (D-BM9) — metode + status PTKP cukup utk konteks.
    await db.activityLog.create({
      data: {
        action: "Simulated", entity: "PayrollSimulation", entityId: "-",
        appUserId: m.actor.appUserId ?? undefined,
        detail:
          `Simulasi THP dijalankan (metode ${input.method}${input.month === "irregular" ? ", bulan ireguler" : ""}, ` +
          `status ${input.ptkpCategory}${input.npwp ? "" : ", non-NPWP"}${input.grossUp ? ", gross-up" : ""}, ` +
          `${input.components.length} komponen) oleh ${m.actor.name} — estimasi, tanpa nominal tersimpan`,
      },
    });

    return NextResponse.json({ result, disclaimer: "estimasi simulasi — bukan slip gaji" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
