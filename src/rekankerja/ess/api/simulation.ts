// POST /api/rekankerja/ess/simulation — simulasi THP HYPOTHETICAL utk karyawan
// ESS (D-BM9, tab "Simulasi Gaji" di Slip Gaji). Kebijakan vault: ESS payslip
// digerbang Money Vault — simulasi TIDAK memakai data upah nyata apa pun
// (TIDAK ada prefill gaji sendiri); input manual murni (komponen hypothetical).
// Guard requireEss (self-scope). Tanpa persistensi domain — hanya 1 baris
// ActivityLog tanpa nominal.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { runThpSimulation, validateSimulationInput } from "@/rekankerja/payroll/services/simulation-service";

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, appUserId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => null);
    const { input, error } = validateSimulationInput(b);
    if (error || !input) return NextResponse.json({ error: error ?? "Input tidak valid" }, { status: 400 });

    const result = await runThpSimulation(db, input);

    // Jejak audit TANPA nominal (D-BM9) — self-scope ESS.
    await db.activityLog.create({
      data: {
        action: "Simulated", entity: "PayrollSimulation", entityId: "-",
        appUserId, employeeId,
        detail:
          `Simulasi THP dijalankan dari ESS oleh ${fullName} (metode ${input.method}${input.month === "irregular" ? ", bulan ireguler" : ""}, ` +
          `status ${input.ptkpCategory}${input.npwp ? "" : ", non-NPWP"}${input.grossUp ? ", gross-up" : ""}) — estimasi, tanpa nominal tersimpan`,
      },
    });

    return NextResponse.json({ result, disclaimer: "estimasi simulasi — bukan slip gaji" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
