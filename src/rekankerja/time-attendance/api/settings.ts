import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { readVerifiedSession } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { getRule } from "@/rekankerja/time-attendance/services/attendance-service";

// GET /api/rekankerja/attendance/settings — aturan singleton (padanan Overtime
// Specified + User Defined Rounding + Absence Wage Rules).
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:templates-schedule
// (dulu requireTenant — aturan presensi kini berhak LIHAT per pengguna; PATCH
// tetap requireMenuAction update sejak T41-M2).
// Task 100 F1 (G14/G16, impl-C) — field baru dikembalikan; deviceApiKey
// DISEMBUNYIKAN (hanya indikasi "sudah ada" + bentuk masked) — kunci penuh
// hanya sekali di response PATCH op regenDeviceKey.
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:templates-schedule"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const rule = await getRule(db);
    const components = await db.wageComponent.findMany({
      where: { code: { in: [rule.overtimeComponentCode, rule.lateDeductionComponentCode, rule.absenceDeductionComponentCode, rule.attendanceAllowanceComponentCode] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });
    const allComponents = await db.wageComponent.findMany({
      where: { active: true },
      select: { code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });
    // G16 — kunci perangkat TIDAK pernah dikirim utuh dari GET (mask prefix).
    const deviceApiKeySet = Boolean(rule.deviceApiKey);
    const masked = deviceApiKeySet
      ? `${(rule.deviceApiKey ?? "").split("_").slice(0, 2).join("_")}_••••`
      : null;
    const rulePublic = { ...rule, deviceApiKey: null, deviceApiKeySet, deviceApiKeyMasked: masked };
    return NextResponse.json({ rule: rulePublic, components, allComponents });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — perbarui aturan
// T41-M2: guard hak AKSI menu attendance:templates-schedule (Ubah) — aturan
// presensi (cap lembur/geofence/pembulatan) menggerakkan payroll & lembur;
// sebelumnya requireTenant saja (VIEWER bisa mengubah).
// Task 100 F1 (G14/G16, impl-C) — field baru: selfieMode, faceVerifyMode,
// geofenceMultiSite, otCapMode/otCapDayHours/otCapWeekHours, fatigue*,
// burnoutOtHoursMonthly + op regenDeviceKey (device punch agen D / UI agen E).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:templates-schedule", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const existing = await getRule(db);

    // ===== G16 — regenerasi kunci API perangkat presensi (device punch) =====
    if (b.op === "regenDeviceKey") {
      const payload = await readVerifiedSession(req);
      if (!payload?.tid) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
      const tenant = await platformDb.tenant.findUnique({
        where: { id: payload.tid },
        select: { slug: true },
      });
      const slug = (tenant?.slug ?? "tenant").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "tenant";
      const key = `ovdev_${slug}_${randomBytes(24).toString("hex")}`;
      await db.attendanceRule.update({ where: { id: existing.id }, data: { deviceApiKey: key } });
      // kunci penuh hanya sekali di response ini (GET selalu masked).
      return NextResponse.json({
        rule: { ...existing, deviceApiKey: null, deviceApiKeySet: true, deviceApiKeyMasked: `ovdev_${slug}_••••` },
        deviceApiKey: key,
      });
    }

    const data: Record<string, unknown> = {};
    if (b.roundingMinutes !== undefined) data.roundingMinutes = Math.max(1, Math.min(60, parseInt(b.roundingMinutes, 10) || 5));
    if (b.minOvertimeMinutes !== undefined) data.minOvertimeMinutes = Math.max(0, parseInt(b.minOvertimeMinutes, 10) || 0);
    if (b.overtimeRoundingMinutes !== undefined) data.overtimeRoundingMinutes = Math.max(1, Math.min(60, parseInt(b.overtimeRoundingMinutes, 10) || 30));
    // T15-CHAIN-EXT: cap lembur PP 35/2021 — override per tenant (jam/hari 1–8,
    // cap bulanan opsional; 0/null = tanpa cap bulanan).
    if (b.maxOvertimeHours !== undefined) data.maxOvertimeHours = Math.max(1, Math.min(8, parseInt(b.maxOvertimeHours, 10) || 4));
    if (b.maxOvertimeHoursMonthly !== undefined) {
      const monthly = parseInt(b.maxOvertimeHoursMonthly, 10);
      data.maxOvertimeHoursMonthly = Number.isFinite(monthly) && monthly > 0 ? Math.min(200, monthly) : null;
    }
    if (b.nonClockingPolicy !== undefined && ["AssumeNormal", "ByHours", "ByDays"].includes(b.nonClockingPolicy)) data.nonClockingPolicy = b.nonClockingPolicy;
    // 27-a P0: mode geofencing presensi (Off|Warn|Strict) — validasi nilai.
    if (b.geofenceMode !== undefined) {
      const mode = String(b.geofenceMode);
      if (!["Off", "Warn", "Strict"].includes(mode)) {
        return NextResponse.json({ error: "geofenceMode harus Off, Warn, atau Strict" }, { status: 400 });
      }
      data.geofenceMode = mode;
    }
    // Task 100 F1 (G18) — geofence multi-site.
    if (b.geofenceMultiSite !== undefined) data.geofenceMultiSite = Boolean(b.geofenceMultiSite);
    // Task 100 F1 (G13) — mode selfie.
    if (b.selfieMode !== undefined) {
      const mode = String(b.selfieMode);
      if (!["off", "warn", "required"].includes(mode)) {
        return NextResponse.json({ error: "selfieMode harus off, warn, atau required" }, { status: 400 });
      }
      data.selfieMode = mode;
    }
    // Task 100 F1 (G30) — mode verifikasi wajah.
    if (b.faceVerifyMode !== undefined) {
      const mode = String(b.faceVerifyMode);
      if (!["off", "warn", "strict"].includes(mode)) {
        return NextResponse.json({ error: "faceVerifyMode harus off, warn, atau strict" }, { status: 400 });
      }
      data.faceVerifyMode = mode;
    }
    // Task 100 F1 (G14) — mode cap lembur (PP35 | KEPMEN102 | CUSTOM) + nilai
    // CUSTOM (0/null/invalid → null = fallback preset).
    if (b.otCapMode !== undefined) {
      const mode = String(b.otCapMode);
      if (!["PP35", "KEPMEN102", "CUSTOM"].includes(mode)) {
        return NextResponse.json({ error: "otCapMode harus PP35, KEPMEN102, atau CUSTOM" }, { status: 400 });
      }
      data.otCapMode = mode;
    }
    for (const key of ["otCapDayHours", "otCapWeekHours"] as const) {
      if (b[key] !== undefined) {
        const v = parseInt(b[key], 10);
        data[key] = Number.isFinite(v) && v >= 1 && v <= 40 ? v : null;
      }
    }
    // Task 100 F1 (G23) — fatigue rules (0 = nonaktif).
    if (b.fatigueMaxConsecutiveNights !== undefined) {
      const v = parseInt(b.fatigueMaxConsecutiveNights, 10);
      if (!Number.isFinite(v) || v < 0 || v > 10) {
        return NextResponse.json({ error: "fatigueMaxConsecutiveNights harus 0–10 (0 = nonaktif)" }, { status: 400 });
      }
      data.fatigueMaxConsecutiveNights = v;
    }
    if (b.fatigueMinRestHours !== undefined) {
      const v = parseInt(b.fatigueMinRestHours, 10);
      if (!Number.isFinite(v) || v < 0 || v > 36) {
        return NextResponse.json({ error: "fatigueMinRestHours harus 0–36 jam (0 = nonaktif)" }, { status: 400 });
      }
      data.fatigueMinRestHours = v;
    }
    // Task 100 F1 (G29) — ambang burnout jam lembur per bulan.
    if (b.burnoutOtHoursMonthly !== undefined) {
      const v = parseInt(b.burnoutOtHoursMonthly, 10);
      if (!Number.isFinite(v) || v < 0 || v > 200) {
        return NextResponse.json({ error: "burnoutOtHoursMonthly harus 0–200 jam" }, { status: 400 });
      }
      data.burnoutOtHoursMonthly = v;
    }
    for (const key of ["overtimeComponentCode", "lateDeductionComponentCode", "absenceDeductionComponentCode", "attendanceAllowanceComponentCode"] as const) {
      if (b[key] !== undefined) {
        const code = String(b[key]).trim().toUpperCase();
        if (code) {
          const comp = await db.wageComponent.findUnique({ where: { code } });
          if (!comp) return NextResponse.json({ error: `Komponen gaji ${code} tidak ditemukan` }, { status: 400 });
          data[key] = code;
        }
      }
    }
    if (b.attendanceAllowanceAmount !== undefined) data.attendanceAllowanceAmount = Math.max(0, Number(b.attendanceAllowanceAmount) || 0);
    if (b.lateDeductionPerHour !== undefined) data.lateDeductionPerHour = Math.max(0, Number(b.lateDeductionPerHour) || 0);
    if (b.absenceDeductionPerDay !== undefined) data.absenceDeductionPerDay = Math.max(0, Number(b.absenceDeductionPerDay) || 0);

    const rule = await db.attendanceRule.update({ where: { id: existing.id }, data });
    // G16 — jangan pernah kirim kunci penuh dari PATCH reguler.
    const rulePublic = { ...rule, deviceApiKey: null, deviceApiKeySet: Boolean(rule.deviceApiKey) };
    return NextResponse.json({ rule: rulePublic });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
