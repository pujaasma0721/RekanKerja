import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { dayStart, addDays, regenerateDaily } from "@/rekankerja/time-attendance/services/attendance-service";

// Task 100 F1 (G16) — Device push realtime (gaya ZKTeco PUSH SDK / ADMS).
// =====================================================================
// POST /api/rekankerja/attendance/device-punch
//   Body kanonik : { key: "ovdev_{tenantSlug}_{secret}", punches: [{ id: "MII0001", time: ISO, dir: "IN"|"OUT"|"auto" }] }
//   Body ZKTeco  : array / { data: [...] } dari { USERID, timestamp, status } —
//                  dinormalisasi kecil (USERID → id; timestamp → time; status
//                  0/"0"/"in" → IN, 1/"1"/"out" → OUT, selain itu → IN auto).
//   Key boleh dari header X-Api-Key (utama) ATAU field key body.
//
// AUTH PERANGKAT (bukan sesi/menu): key = AttendanceRule.deviceApiKey format
// `ovdev_{tenantSlug}_{secret}` → slug dipisah utk resolve Tenant platform
// (Tenant by slug) → client schema tenant → compare dgn rule.deviceApiKey
// (baca defensif — kolom ditambahkan Task 100-impl-C; client lama belum
// memuatnya → null → 401 dgn pesan konfigurasi). Invalid → 401.
//
// Jendela timestamp konsisten G12: [-30 hari, +5 menit] dari sekarang —
// punch di luar jendela DILEWATI (bukan reject seluruh batch), sama seperti
// klasifikasi machine-import. Dedupe (karyawan, timestamp, arah) → skip.
// Rate-limit sederhana: maks 200 punch per request → 400.
// Insert source "Machine" + regenerateDaily per (karyawan, tanggal).
// Response: { ok, imported, skipped, unknown: [ids] }.

const MAX_PUNCHES = 200;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const BACKDATE_MAX_MS = 30 * 86_400_000;
const KEY_PREFIX = "ovdev_";

/** Satu punch ternormalisasi. */
interface NormalizedPunch {
  raw: unknown;
  id: string;
  timestamp: Date;
  direction: "IN" | "OUT";
  /** true bila arah tidak dinyatakan perangkat (auto → default IN). */
  auto: boolean;
}

/** Normalisasi satu item punch (kanonik ATAU ZKTeco minimal). */
function normalizePunch(p: unknown): NormalizedPunch | null {
  if (p == null || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const id = String(o.id ?? o.USERID ?? o.userId ?? o.PIN ?? o.pin ?? "").trim();
  const timeRaw = o.time ?? o.timestamp ?? o.timeStamp ?? o.DateTime ?? o.datetime;
  if (!id) return null;
  const timestamp = timeRaw instanceof Date ? timeRaw : new Date(String(timeRaw ?? ""));
  if (isNaN(timestamp.getTime())) return null;

  // arah: dir/direction/status — "auto"/tak dikenal → IN (catat auto)
  const dirRaw = String(o.dir ?? o.direction ?? o.status ?? "auto").trim().toLowerCase();
  let direction: "IN" | "OUT";
  let auto = false;
  if (dirRaw === "out" || dirRaw === "1" || dirRaw === "true") direction = "OUT";
  else if (dirRaw === "in" || dirRaw === "0" || dirRaw === "false") direction = "IN";
  else { direction = "IN"; auto = true; } // ZKTeco push kerap tanpa arah → default masuk
  return { raw: p, id, timestamp, direction, auto };
}

/**
 * Resolve tenant + client dari device key. Slug idealnya tanpa underscore;
 * kandidat slug = setiap prefix sebelum "_" (urut terpanjang dulu supaya
 * slug paling spesifik menang), lalu key dicocokkan PENUH dgn
 * AttendanceRule.deviceApiKey tenant tsb.
 */
async function resolveTenantByKey(
  key: string,
): Promise<{ db: TenantDb; slug: string } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const rest = key.slice(KEY_PREFIX.length);
  const candidates: string[] = [];
  let idx = rest.indexOf("_");
  while (idx !== -1) {
    const c = rest.slice(0, idx);
    if (c) candidates.push(c);
    idx = rest.indexOf("_", idx + 1);
  }
  if (candidates.length === 0) return null;

  const tenants = await platformDb.tenant.findMany({
    where: { slug: { in: candidates } },
    select: { slug: true, schemaName: true, status: true },
  });
  // kandidat terpanjang dulu (slug lebih spesifik menang bila prefix bertingkat)
  const byLen = [...candidates].sort((a, b) => b.length - a.length);
  for (const slug of byLen) {
    const t = tenants.find((x) => x.slug === slug);
    if (!t || t.status !== "ACTIVE") continue;
    const client = getTenantClient(t.schemaName);
    try {
      // Task 100-impl-C: kolom deviceApiKey kini ada di client (regenerate
      // sudah dijalankan C saat finalisasi file ini) — akses typed; tenant
      // yang belum menjalankan migrate-attendance-advance → kolom belum ada
      // di DB → Prisma error → coba kandidat berikutnya (fail-closed 401).
      const rule = await client.attendanceRule.findFirst({ orderBy: { id: "asc" } });
      const stored = rule?.deviceApiKey ?? null;
      if (stored && stored === key) return { db: client, slug: t.slug };
    } catch {
      // baca rule gagal (tenant belum termigrasi) → coba kandidat berikutnya
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (body == null) {
      return NextResponse.json({ error: "Body JSON wajib berisi data punch" }, { status: 400 });
    }

    // ===== auth perangkat (X-Api-Key utama, field key fallback) =====
    const b = (typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const key = String(req.headers.get("x-api-key") ?? b.key ?? b.apiKey ?? "").trim();
    if (!key) {
      return NextResponse.json(
        { error: "Header X-Api-Key wajib diisi (format ovdev_{tenantSlug}_{secret})" },
        { status: 401 },
      );
    }
    const resolved = await resolveTenantByKey(key);
    if (!resolved) {
      return NextResponse.json(
        { error: "API key perangkat tidak valid — periksa format ovdev_{tenantSlug}_{secret} dan konfigurasi Pengaturan Kehadiran (Device Push)" },
        { status: 401 },
      );
    }
    const db = resolved.db;

    // ===== normalisasi payload punch =====
    let rawItems: unknown[];
    if (Array.isArray(body)) rawItems = body;
    else if (Array.isArray(b.punches)) rawItems = b.punches;
    else if (Array.isArray(b.data)) rawItems = b.data;
    else if (b.USERID != null || b.userId != null) rawItems = [b];
    else rawItems = [];
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "Tidak ada data punch di body (field punches / data / array)" }, { status: 400 });
    }
    if (rawItems.length > MAX_PUNCHES) {
      return NextResponse.json(
        { error: `Maksimum ${MAX_PUNCHES} punch per request (diterima ${rawItems.length}) — kirim bertahap` },
        { status: 400 },
      );
    }
    const punches: NormalizedPunch[] = [];
    const malformed: string[] = [];
    let i = 0;
    for (const item of rawItems) {
      const n = normalizePunch(item);
      if (!n) { malformed.push(`#${i + 1}`); }
      else punches.push(n);
      i++;
    }

    // ===== resolve karyawan by employeeNo (Active saja; unknown dicatat) =====
    const ids = [...new Set(punches.map((p) => p.id))];
    const employees = ids.length > 0
      ? await db.employee.findMany({
          where: { status: "Active", employeeNo: { in: ids } },
          select: { id: true, employeeNo: true },
        })
      : [];
    const byEmpNo = new Map(employees.map((e) => [e.employeeNo, e.id]));
    const unknownIds = new Set<string>();

    // ===== klasifikasi per punch: ok / duplikat / luar jendela / unknown =====
    const valid = punches.filter((p) => byEmpNo.has(p.id));
    for (const p of punches) if (!byEmpNo.has(p.id)) unknownIds.add(p.id);

    const now = Date.now();
    const ok: NormalizedPunch[] = [];
    let skipped = malformed.length; // punch tak terbaca dihitung terlewat
    // dedupe DB: satu query bulk utk window tanggal seluruh punch valid
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    for (const p of valid) {
      if (!minDate || p.timestamp < minDate) minDate = p.timestamp;
      if (!maxDate || p.timestamp > maxDate) maxDate = p.timestamp;
    }
    const dbKeys = new Set<string>();
    const empIds = [...new Set(valid.map((p) => byEmpNo.get(p.id)!))];
    if (minDate && maxDate && empIds.length > 0) {
      const existing = await db.attendanceClockLog.findMany({
        where: {
          employeeId: { in: empIds },
          timestamp: { gte: dayStart(minDate), lt: addDays(dayStart(maxDate), 1) },
        },
        select: { employeeId: true, timestamp: true, direction: true },
      });
      for (const l of existing) dbKeys.add(`${l.employeeId}|${l.timestamp.getTime()}|${l.direction}`);
    }
    const seenInBatch = new Set<string>();
    for (const p of valid) {
      const tsMs = p.timestamp.getTime();
      if (tsMs > now + FUTURE_TOLERANCE_MS || tsMs < now - BACKDATE_MAX_MS) {
        skipped++; // luar jendela G12 — dilewati, bukan reject batch
        continue;
      }
      const empId = byEmpNo.get(p.id)!;
      const k = `${empId}|${tsMs}|${p.direction}`;
      if (dbKeys.has(k) || seenInBatch.has(k)) {
        skipped++; // duplikat (idempoten — push ulang aman)
        continue;
      }
      seenInBatch.add(k);
      ok.push(p);
    }

    // ===== insert + regen rekap per (karyawan, tanggal) =====
    if (ok.length > 0) {
      await db.attendanceClockLog.createMany({
        data: ok.map((p) => ({
          employeeId: byEmpNo.get(p.id)!,
          timestamp: p.timestamp,
          direction: p.direction,
          // G16: deviceId kolom baru (Task 100-impl-C) belum tersedia di client
          // saat file ini ditulis — tidak diisi (defensif); source Machine
          // konsisten dgn machine-import.
          source: "Machine",
          note: p.auto ? "Device push (arah auto → IN)" : null,
        })),
      });
      const done = new Set<string>();
      for (const p of ok) {
        const empId = byEmpNo.get(p.id)!;
        const day = dayStart(p.timestamp);
        const k = `${empId}|${day.getTime()}`;
        if (done.has(k)) continue;
        done.add(k);
        await regenerateDaily(db, day, empId);
      }
    }

    // ===== audit (aktor = sistem/perangkat, bukan pengguna) =====
    await db.activityLog.create({
      data: {
        actorType: "system",
        action: "Imported", entity: "AttendanceClockLog",
        detail:
          `Device push realtime (tenant ${resolved.slug}): ${ok.length} log disisipkan, ${skipped} dilewati ` +
          `(duplikat/luar jendela/malformed), ${unknownIds.size} id tak dikenal` +
          (unknownIds.size > 0 ? ` (${[...unknownIds].slice(0, 20).join(", ")})` : ""),
      },
    }).catch(() => { /* audit best-effort */ });

    return NextResponse.json({
      ok: true,
      imported: ok.length,
      skipped,
      unknown: [...unknownIds],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
