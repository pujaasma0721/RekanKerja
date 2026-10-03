// POST /api/rekankerja/ess/clock — presensi mandiri ESS (kontrak T8-ESS-FRONTEND).
// Body: multipart FormData (direction, latitude, longitude, accuracy, note,
// deviceId, qrToken, photo) — fallback JSON lama tetap jalan.
// Validasi: jadwal hari ini ADA & clockingRequired; IN tunggal per hari;
// OUT wajib setelah IN (Task 100 G5: IN kemarin yang belum tertutup juga sah
// utk shift malam lintas hari). Log ditulis source "Web" + koordinat (kolom
// baru T7-ESS), lalu rekap hari itu dihitung ulang (regenerateDaily).
// 27-a P0: geofencing presensi — AttendanceRule.geofenceMode (Off|Warn|Strict)
// × koordinat WorkLocation karyawan. Strict tolak clock di luar radius /
// tanpa koordinat; Warn catat peringatan di note tapi clock tetap sah.
//
// Task 100 F1 (impl-C) — upgrade verifikasi identitas & anti-fraud:
//   G18 geofence MULTI-SITE (rule.geofenceMultiSite): cocokkan jarak ke SEMUA
//       WorkLocation aktif berlat/long — yang TERDEKAT menang (karyawan yang
//       sedang di cabang lain tetap bisa absen sah).
//   G22 speed check: punch terakhir dgn koordinat → kecepatan > 250 km/jam
//       dicatat sebagai flag anomalyNotes "speed" (TIDAK menolak clock).
//   G13 selfie (rule.selfieMode off|warn|required): required tanpa foto → 400;
//       foto disimpan via saveAttachment entityType "attendance-selfie"
//       entityId = id log, lalu selfieUrl diisi (mode warn tanpa foto → flag).
//   G30 face verify (rule.faceVerifyMode off|warn|strict): bila foto ada,
//       bandingkan dgn Employee.selfieRefUrl via VLM z-ai-web-dev-sdk (pola
//       travel/api/ocr.ts). Foto PERTAMA jadi referensi. strict + beda orang →
//       400 (attempt dicatat di ActivityLog); VLM gagal → clock tetap jalan
//       (flag "vlm-unavailable" di mode strict — jangan blokir operasional).
//   G17 QR kios (qrToken): token = base64url(HMAC_SHA256(hex, secret)) dgn
//       secret = sha256(SESSION_SECRET + "|" + tenantSchemaName), message
//       `ovqr|{schemaName}|{bucket}`, bucket = floor(epochSec/30) — terima
//       bucket sekarang ±1 (skew kios). Valid → flag "qr-verified"; salah →
//       flag "qr-invalid" (tidak menolak). Kios menampilkan payload
//       `ovqr:{schemaName}:{token}` (generator UI = agen frontend).
//   deviceId (fingerprint perangkat klien) tersimpan di log.
import { NextResponse } from "next/server";
import { createHash, createHmac } from "node:crypto";
import { requireEss, fmtHhMm } from "@/rekankerja/ess/api/ess-auth";
import { db as platformDb } from "@/lib/db";
import { dayStart, addDays, resolveDayType, regenerateDaily } from "@/rekankerja/time-attendance/services/attendance-service";
import { saveAttachment, readAttachmentFile } from "@/rekankerja/shared/services/attachment-service";

const GEOFENCE_MODES = ["Off", "Warn", "Strict"] as const;
/** Radius default (meter) bila WorkLocation.radiusMeters kosong. */
const DEFAULT_RADIUS_M = 200;
/** Batas ukuran foto selfie (byte) — G13. */
const MAX_SELFIE_BYTES = 2 * 1024 * 1024;
/** Ambang kecepatan mustahil antar-punch (km/jam) — G22. */
const IMPOSSIBLE_SPEED_KMH = 250;
/** entityType lampiran selfie presensi (G13). */
const SELFIE_ENTITY_TYPE = "attendance-selfie";

/** Jarak haversine dua titik koordinat (meter). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===== rule singleton (baca defensif — tenant tanpa kolom baru = default lama) =====

interface ClockRule {
  geofenceMode: "Off" | "Warn" | "Strict";
  geofenceMultiSite: boolean; // G18
  selfieMode: "off" | "warn" | "required"; // G13
  faceVerifyMode: "off" | "warn" | "strict"; // G30
}

async function readClockRule(db: Parameters<typeof resolveDayType>[0]): Promise<ClockRule> {
  try {
    const rule = await db.attendanceRule.findFirst({
      orderBy: { id: "asc" },
      select: { geofenceMode: true, geofenceMultiSite: true, selfieMode: true, faceVerifyMode: true },
    });
    const mode = (v: string | null | undefined, allowed: readonly string[], dflt: string) =>
      v && (allowed as readonly string[]).includes(v) ? v : dflt;
    return {
      geofenceMode: mode(rule?.geofenceMode, GEOFENCE_MODES, "Off") as ClockRule["geofenceMode"],
      geofenceMultiSite: rule?.geofenceMultiSite === true,
      selfieMode: mode(rule?.selfieMode, ["off", "warn", "required"], "off") as ClockRule["selfieMode"],
      faceVerifyMode: mode(rule?.faceVerifyMode, ["off", "warn", "strict"], "off") as ClockRule["faceVerifyMode"],
    };
  } catch {
    return { geofenceMode: "Off", geofenceMultiSite: false, selfieMode: "off", faceVerifyMode: "off" };
  }
}

// ===== G17 — validasi token QR kios (rotating 30 detik, TOTP-style ±1 bucket) =====

/** Secret QR per tenant: sha256(SESSION_SECRET + "|" + schemaName) — hex. */
function qrSecretHex(schemaName: string): string {
  return createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}|${schemaName}`).digest("hex");
}

/** Kandidat token utk satu bucket — dua bentuk encoding (raw digest / hex-string)
 *  diterima supaya kontrak generator kios toleran terhadap interpretasi base64. */
function qrTokenCandidates(secretHex: string, schemaName: string, bucket: number): string[] {
  const digest = createHmac("sha256", secretHex).update(`ovqr|${schemaName}|${bucket}`).digest();
  return [digest.toString("base64url"), Buffer.from(digest.toString("hex"), "utf8").toString("base64url")];
}

/** Validasi token QR kios (G17): terima bucket sekarang atau sebelumnya (±1). */
function qrTokenValid(token: string, schemaName: string): boolean {
  if (!process.env.SESSION_SECRET || !token) return false;
  const secret = qrSecretHex(schemaName);
  const nowBucket = Math.floor(Date.now() / 1000 / 30);
  for (const bucket of [nowBucket, nowBucket - 1, nowBucket + 1]) {
    if (qrTokenCandidates(secret, schemaName, bucket).includes(token)) return true;
  }
  return false;
}

// ===== G30 — verifikasi wajah via VLM z-ai-web-dev-sdk (SERVER-SIDE ONLY) =====

const FACE_PROMPT =
  'Apakah dua foto ini menunjukkan ORANG YANG SAMA? Jawab HANYA JSON {"same": boolean, "confidence": 0-100}';

/** Parse JSON toleran (extract dari teks/markdown) — pola travel/api/ocr.ts. */
function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** MIME referensi dari ekstensi path storage. */
function mimeOfStoragePath(p: string): string {
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Bandingkan foto selfie dgn foto referensi (G30). Return:
 *   { same, confidence } — VLM menjawab pasti;
 *   null — VLM tak tersedia/gagal di-parse (pemanggil: jangan blokir clock,
 *          flag "vlm-unavailable" di mode strict).
 */
async function verifyFace(
  photo: { buffer: Buffer; mime: string },
  refStoragePath: string,
): Promise<{ same: boolean; confidence: number } | null> {
  let refBuf: Buffer;
  try {
    refBuf = await readAttachmentFile({ storagePath: refStoragePath });
  } catch {
    return null; // file referensi hilang dari storage
  }
  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    // d.ts menuntut field `model` tapi runtime SDK mengabaikannya (vision model
    // dipilih backend) — terbukti E2E T98 OCR tanpa model. Kompromi tipe:
    // @ts-expect-error field model tidak diperlukan runtime createVision
    const completion = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: FACE_PROMPT },
            { type: "image_url", image_url: { url: `data:${photo.mime};base64,${photo.buffer.toString("base64")}` } },
            { type: "image_url", image_url: { url: `data:${mimeOfStoragePath(refStoragePath)};base64,${refBuf.toString("base64")}` } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return null;
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed.same !== "boolean") return null;
    const conf = Number(parsed.confidence);
    return { same: parsed.same, confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, conf)) : 0 };
  } catch {
    return null; // VLM gagal (network dsb) — bukan bukti beda orang
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    // ===== parsing input: multipart FormData (baru) / JSON (lama) =====
    const contentType = req.headers.get("content-type") ?? "";
    const fields = new Map<string, string>();
    let photo: { buffer: Buffer; mime: string; name: string } | null = null;
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") fields.set(k, v);
      }
      const f = form.get("photo");
      if (f instanceof File && f.size > 0) {
        const mime = f.type || "";
        if (!["image/jpeg", "image/png"].includes(mime)) {
          return NextResponse.json({ error: "Foto selfie harus JPG atau PNG" }, { status: 400 });
        }
        if (f.size > MAX_SELFIE_BYTES) {
          return NextResponse.json({ error: "Ukuran foto selfie maksimal 2 MB" }, { status: 400 });
        }
        photo = { buffer: Buffer.from(await f.arrayBuffer()), mime, name: f.name || "selfie.jpg" };
      }
    } else {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      for (const [k, v] of Object.entries(b)) {
        if (v != null && typeof v !== "object") fields.set(k, String(v));
      }
    }
    const fld = (k: string): string | undefined => {
      const v = fields.get(k);
      return v === undefined || v === "" ? undefined : v;
    };

    const direction = String(fld("direction") ?? "").toUpperCase();
    let note = fld("note") != null ? String(fld("note")).slice(0, 200) : null;
    const deviceId = fld("deviceId") != null ? String(fld("deviceId")).slice(0, 120) : null;
    const qrToken = fld("qrToken") != null ? String(fld("qrToken")).trim() : null;
    // akurasi GPS (meter) — hanya dicatat di response, tidak memvalidasi
    // (akurasi buruk bukan alasan menolak; geofence sudah menghitung jarak).
    const accuracy = Number(fld("accuracy"));

    if (direction !== "IN" && direction !== "OUT") {
      return NextResponse.json({ error: "direction harus IN atau OUT" }, { status: 400 });
    }

    // koordinat opsional (number — FormData mengirim string)
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (fld("latitude") != null) {
      const lat = Number(fld("latitude"));
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return NextResponse.json({ error: "latitude tidak valid" }, { status: 400 });
      }
      latitude = lat;
    }
    if (fld("longitude") != null) {
      const lng = Number(fld("longitude"));
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return NextResponse.json({ error: "longitude tidak valid" }, { status: 400 });
      }
      longitude = lng;
    }

    const now = new Date();
    const today = dayStart(now);
    const tomorrow = addDays(today, 1);

    // validasi jadwal: assignment aktif hari ini + clocking required
    const { assignment } = await resolveDayType(db, employeeId, today);
    if (!assignment.id) {
      return NextResponse.json(
        { error: "Tidak ada jadwal kerja aktif untuk Anda pada hari ini — hubungi HR" },
        { status: 400 },
      );
    }
    if (assignment.clockingRequired === false) {
      return NextResponse.json(
        { error: "Jadwal Anda non-clocking (jam kerja dianggap normal) — clock tidak diperlukan" },
        { status: 400 },
      );
    }

    // clock log hari ini (window [00:00, 00:00 besok))
    const logs = await db.attendanceClockLog.findMany({
      where: { employeeId, timestamp: { gte: today, lt: tomorrow } },
      orderBy: { timestamp: "asc" },
      select: { direction: true, timestamp: true },
    });
    const firstIn = logs.find((l) => l.direction === "IN");

    if (direction === "IN") {
      // Aturan 1 IN/hari utk IN baru TIDAK berubah (Task 100 G5 hanya membuka
      // OUT lintas hari di bawah).
      if (firstIn) {
        return NextResponse.json(
          { error: `Clock-in hari ini sudah tercatat pukul ${fmtHhMm(firstIn.timestamp)}` },
          { status: 400 },
        );
      }
    } else {
      if (!firstIn) {
        // Task 100 (G5, audit A-05) — shift malam lintas hari (mis. 22:00–06:00):
        // bila tidak ada IN hari ini, cari IN KEMARIN (window kemarin 12:00 →
        // sekarang) yang belum punya OUT setelahnya → clock-out SAH untuk IN
        // tersebut. Regen engine sudah mendukung clock lintas hari (window
        // D..D+2, outLimit +10 jam setelah jam pulang) — hanya guard ESS ini
        // yang dulu salah menolak ("Belum ada clock-in hari ini").
        const yesterday = addDays(today, -1);
        const sinceYesterdayNoon = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 12, 0, 0, 0);
        const yLogs = await db.attendanceClockLog.findMany({
          where: { employeeId, timestamp: { gte: sinceYesterdayNoon, lt: today } },
          orderBy: { timestamp: "asc" },
          select: { direction: true, timestamp: true },
        });
        const combined = [...yLogs, ...logs]; // gabung + logs hari ini (sudah asc per grup, urutan global aman: kemarin < hari ini)
        let openIn: { timestamp: Date } | null = null;
        for (const l of combined) {
          if (l.direction === "IN") openIn = l;
          else openIn = null; // OUT menutup IN sebelumnya
        }
        if (!openIn) {
          return NextResponse.json(
            { error: "Belum ada clock-in hari ini (atau kemarin sejak tengah hari) yang belum ditutup clock-out — clock-out wajib setelah clock-in" },
            { status: 400 },
          );
        }
      }
    }

    // ===== rule singleton (geofence + selfie + face verify) =====
    const rule = await readClockRule(db);

    // ===== 27-a: validasi geofencing (sebelum menulis log) =====
    // Task 100 F1 (G18) — multi-site: bila rule.geofenceMultiSite, cocokkan
    // jarak ke SEMUA WorkLocation aktif berlat/long (terdekat menang) — bukan
    // hanya lokasi karyawan. Lokasi tanpa koordinat tidak berpartisipasi.
    if (rule.geofenceMode !== "Off") {
      interface GeoLoc {
        code: string;
        latitude: number;
        longitude: number;
        radius: number;
      }
      let candidates: GeoLoc[] = [];
      if (rule.geofenceMultiSite) {
        const locs = await db.workLocation.findMany({
          where: { active: true, latitude: { not: null }, longitude: { not: null } },
          select: { code: true, latitude: true, longitude: true, radiusMeters: true },
        });
        candidates = locs.map((l) => ({
          code: l.code,
          latitude: l.latitude as number,
          longitude: l.longitude as number,
          radius: l.radiusMeters && l.radiusMeters > 0 ? l.radiusMeters : DEFAULT_RADIUS_M,
        }));
      } else {
        // perilaku lama: hanya lokasi kerja karyawan
        const emp = await db.employee.findUnique({
          where: { id: employeeId },
          select: { workLocationId: true },
        });
        const loc = emp?.workLocationId
          ? await db.workLocation.findUnique({
              where: { id: emp.workLocationId },
              select: { code: true, latitude: true, longitude: true, radiusMeters: true },
            })
          : null;
        if (loc && loc.latitude != null && loc.longitude != null) {
          candidates = [
            {
              code: loc.code,
              latitude: loc.latitude,
              longitude: loc.longitude,
              radius: loc.radiusMeters && loc.radiusMeters > 0 ? loc.radiusMeters : DEFAULT_RADIUS_M,
            },
          ];
        }
      }

      if (candidates.length > 0) {
        let nearest: { loc: GeoLoc; distance: number } | null = null;
        if (latitude != null && longitude != null) {
          for (const loc of candidates) {
            const distance = haversineM(latitude, longitude, loc.latitude, loc.longitude);
            if (!nearest || distance < nearest.distance) nearest = { loc, distance };
          }
        }
        if (!nearest) {
          if (rule.geofenceMode === "Strict") {
            return NextResponse.json(
              {
                error:
                  `Presensi dari lokasi ini wajib mengaktifkan izin lokasi GPS pada perangkat Anda ` +
                  `(mode Geofencing Ketat${rule.geofenceMultiSite ? `, ${candidates.length} lokasi kantor aktif` : `, lokasi ${candidates[0]!.code}`}). Izinkan akses lokasi lalu ulangi presensi.`,
              },
              { status: 400 },
            );
          }
        } else if (nearest.distance > nearest.loc.radius) {
          if (rule.geofenceMode === "Strict") {
            return NextResponse.json(
              {
                error:
                  `Anda berjarak ${Math.round(nearest.distance)} m dari kantor terdekat (${nearest.loc.code}) — batas presensi ${nearest.loc.radius} m. ` +
                  `Presensi hanya sah di dalam area kantor.`,
              },
              { status: 400 },
            );
          }
          // Warn: clock tetap sah, catat peringatan jarak pada note.
          note = `[geofence] jarak ${Math.round(nearest.distance)}m > radius ${nearest.loc.radius}m (${nearest.loc.code})${note?.trim() ? ` — ${note.trim()}` : ""}`;
        }
      }
    }

    // ===== Task 100 F1 (G13) — selfie wajib/opsional =====
    if (rule.selfieMode === "required" && !photo) {
      return NextResponse.json(
        { error: "Foto selfie wajib dilampirkan saat presensi (mode Selfie Wajib) — ambil foto lalu ulangi" },
        { status: 400 },
      );
    }

    // ===== flag anomali ringkas (dipisah koma di AttendanceClockLog.anomalyNotes) =====
    const flags: string[] = [];
    if (rule.selfieMode === "warn" && !photo) flags.push("noselfie");

    // ===== Task 100 F1 (G22) — speed check vs punch berkoordinat terakhir =====
    if (latitude != null && longitude != null) {
      const lastGeo = await db.attendanceClockLog.findFirst({
        where: { employeeId, latitude: { not: null }, longitude: { not: null }, timestamp: { lt: now } },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true, latitude: true, longitude: true },
      });
      if (lastGeo) {
        const hours = (now.getTime() - lastGeo.timestamp.getTime()) / 3_600_000;
        if (hours > 0) {
          const kmh = haversineM(lastGeo.latitude as number, lastGeo.longitude as number, latitude, longitude) / 1000 / hours;
          if (kmh > IMPOSSIBLE_SPEED_KMH) {
            // HANYA flag — jangan tolak (GPS drift/point jump umum terjadi);
            // ditindaklanjuti deteksi anomali G27 (impossibleTravel).
            flags.push("speed");
          }
        }
      }
    }

    // ===== Task 100 F1 (G30) — verifikasi wajah (VLM) =====
    let faceVerified: boolean | null = null;
    let saveRefSelfie = false; // foto ini jadi referensi PERTAMA kali
    if (photo && rule.faceVerifyMode !== "off") {
      const emp = await db.employee.findUnique({
        where: { id: employeeId },
        select: { selfieRefUrl: true },
      });
      if (!emp?.selfieRefUrl) {
        // belum punya referensi → foto ini DIPERCAYA sebagai referensi pertama
        // (bootstrap — selfie berikutnya dibandingkan dgn ini).
        faceVerified = true;
        saveRefSelfie = true;
      } else {
        const verdict = await verifyFace(photo, emp.selfieRefUrl);
        if (verdict == null) {
          // VLM tak tersedia — JANGAN gagalkan clock operasional (G30):
          // mode strict dicatat "vlm-unavailable" utk audit; warn diam.
          if (rule.faceVerifyMode === "strict") flags.push("vlm-unavailable");
        } else if (verdict.same) {
          faceVerified = true;
        } else {
          // pasti BEDA ORANG
          if (rule.faceVerifyMode === "strict") {
            // catat attempt (audit) lalu tolak — jangan tulis log presensi.
            await db.activityLog
              .create({
                data: {
                  action: "Rejected",
                  entity: "AttendanceClockLog",
                  employeeId,
                  detail:
                    `Clock ${direction} DITOLAK verifikasi wajah (G30 strict): wajah selfie tidak cocok ` +
                    `dgn foto referensi (confidence ${verdict.confidence})${deviceId ? `, device ${deviceId}` : ""}`,
                },
              })
              .catch(() => undefined);
            return NextResponse.json(
              { error: "Verifikasi wajah gagal — foto selfie tidak cocok dengan foto referensi Anda. Hubungi HR bila ini keliru." },
              { status: 400 },
            );
          }
          faceVerified = false;
          flags.push("face-mismatch"); // warn: clock tetap sah + flag
        }
      }
    }

    // ===== Task 100 F1 (G17) — token QR kios =====
    if (qrToken) {
      // terima token mentah ATAU payload lengkap kios "ovqr:{schema}:{token}"
      let schemaName: string | null = null;
      let token = qrToken;
      if (qrToken.startsWith("ovqr:")) {
        const parts = qrToken.split(":");
        if (parts.length === 3) {
          [, schemaName, token] = parts;
        }
      }
      if (schemaName == null) {
        const tenant = await platformDb.tenant.findUnique({
          where: { id: m.actor.tenantId },
          select: { schemaName: true },
        });
        schemaName = tenant?.schemaName ?? null;
      }
      const ok = schemaName ? qrTokenValid(token, schemaName) : false;
      flags.push(ok ? "qr-verified" : "qr-invalid");
    }

    // ===== tulis log =====
    const log = await db.attendanceClockLog.create({
      data: {
        employeeId,
        timestamp: now,
        direction,
        source: "Web",
        note: note?.trim() || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        deviceId: deviceId ?? null,
        faceVerified,
        anomalyNotes: flags.length > 0 ? flags.join(",") : null,
      },
    });

    // ===== simpan foto selfie (SETELAH create log — entityId = id log) =====
    let selfieTaken = false;
    if (photo) {
      const tenant = await platformDb.tenant.findUnique({
        where: { id: m.actor.tenantId },
        select: { slug: true },
      });
      try {
        const att = await saveAttachment(db, tenant?.slug ?? "tenant", {
          file: photo.buffer,
          fileName: photo.name,
          mimeType: photo.mime,
          entityType: SELFIE_ENTITY_TYPE,
          entityId: log.id,
          uploadedBy: m.actor.platformUserId,
        });
        await db.attendanceClockLog.update({
          where: { id: log.id },
          data: { selfieUrl: att.storagePath },
        });
        selfieTaken = true;
        // G30 — foto pertama dipercaya sebagai referensi karyawan.
        if (saveRefSelfie) {
          await db.employee
            .update({ where: { id: employeeId }, data: { selfieRefUrl: att.storagePath } })
            .catch(() => undefined);
        }
      } catch (e) {
        // validasi isi file gagal (magic-number dll) → batalkan log supaya
        // "selfie required" tidak menghasilkan clock tanpa bukti.
        await db.attendanceClockLog.delete({ where: { id: log.id } }).catch(() => undefined);
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Foto selfie gagal disimpan" },
          { status: 400 },
        );
      }
    }

    // rekap hari ini dihitung ulang (IN/OUT baru langsung tercermin)
    await regenerateDaily(db, today, employeeId);

    return NextResponse.json({
      ok: true,
      time: fmtHhMm(now),
      // kontrak agen E (UI ESS): bukti & flag presensi
      faceVerified,
      selfieTaken,
      flags,
      accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
