// ESS — GET /api/rekankerja/ess/clock-settings (Task 100 F1, agen E) =========
// =====================================================================
// Flag ringan mode verifikasi presensi utk UI punch clock ESS (G13 selfie
// + G30 face verify): widget mengetahui apakah perlu membuka panel foto
// selfie sebelum submit. HANYA dua field enum ini yang diekspos — tanpa
// secret QR, radius geofence, atau pengaturan lain (prinsip least-exposure).
// Baca defensif: tenant yang belum menjalankan migrasi attendance-advance
// (kolom belum ada) → default "off" (perilaku lama), bukan error 500.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";

const SELFIE_MODES = ["off", "warn", "required"] as const;
const FACE_MODES = ["off", "warn", "strict"] as const;

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db } = m.actor;

  try {
    let selfieMode: string = "off";
    let faceVerifyMode: string = "off";
    try {
      const rule = await db.attendanceRule.findFirst({
        orderBy: { id: "asc" },
        select: { selfieMode: true, faceVerifyMode: true },
      });
      if (rule?.selfieMode && (SELFIE_MODES as readonly string[]).includes(rule.selfieMode)) {
        selfieMode = rule.selfieMode;
      }
      if (rule?.faceVerifyMode && (FACE_MODES as readonly string[]).includes(rule.faceVerifyMode)) {
        faceVerifyMode = rule.faceVerifyMode;
      }
    } catch {
      // kolom belum termigrasi di schema tenant ini → default off
    }
    return NextResponse.json({ selfieMode, faceVerifyMode });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
