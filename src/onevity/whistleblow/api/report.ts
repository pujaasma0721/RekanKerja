// OneVity — Whistleblowing (Task 52-f, TPKS UU 12/2022 Ps.22-24) ============
// =====================================================================
// GET  /api/onevity/whistleblowing/report — "Laporan Saya" (ESS, non-anonim).
// POST /api/onevity/whistleblowing/report — kirim laporan pelanggaran.
//
// KEPUTUSAN DESAIN (anonimitas):
// · Sesi login WAJIB (aplikasi single-tenant-domain: tidak ada kanal
//   pra-login) — tetapi identitas pelapor TIDAK DISIMPAN ketika mode
//   anonim: reporterEmployeeId null, TIDAK ada ActivityLog dengan
//   appUserId, tidak ada notifikasi menyebut pelapor. Jaminan ini
//   dituliskan di form supaya pelapor tahu.
// · Mode non-anonim opsional: identitas + kontak disimpan utk tindak
//   lanjut (kasus yang pelapornya bersedia dihubungi).
// · Rate limit 3 laporan / 15 menit / sesi — cegah spam banjir kanal.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { readVerifiedSession } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { hitRateLimit } from "@/onevity/shared/lib/rate-limit";
import { notifyEvent } from "@/onevity/shared/services/notification-service";

export const WHISTLEBLOW_CATEGORIES = [
  "KEKERASAN_SEKSUAL",
  "PELECEHAN",
  "BULLYING",
  "RETALIASI",
  "FRAUD",
  "KESELAMATAN",
  "LAINNYA",
] as const;

/** Nomor tiket berikutnya: WB-<tahun>-NNN (per tahun, gap-safe). */
async function nextTicketNo(db: NonNullable<Awaited<ReturnType<typeof requireTenant>>>): Promise<string> {
  const year = new Date().getFullYear();
  const start = `WB-${year}-`;
  const rows = await db.whistleblowReport.findMany({
    where: { ticketNo: { startsWith: start } },
    select: { ticketNo: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.ticketNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(3, "0")}`;
}

// Task 82-c: GET — "Laporan Saya" utk portal ESS (hanya laporan NON-ANONIM
// milik aktor sendiri; laporan anonim memang tidak bisa dilacak siapa pun —
// by design). Select field aman: tanpa uraian/detail pelapor.
export async function GET(req: NextRequest) {
  try {
    const m = await requireEss(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m.actor;
    const reports = await db.whistleblowReport.findMany({
      where: { reporterEmployeeId: employeeId },
      orderBy: { createdAt: "desc" },
      select: { ticketNo: true, category: true, status: true, createdAt: true },
      take: 50,
    });
    return NextResponse.json({ reports });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Sesi valid = anggota organisasi; identitas TIDAK dipakai (anonim).
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // rate limit per sesi — key dari panjang+potongan cookie (membedakan
    // pemanggil tanpa menyimpan identitas di bucket limiter).
    const cookie = req.headers.get("cookie") ?? "anon";
    const bucketKey = `whistleblow:session:${cookie.length}:${Buffer.from(cookie).toString("base64").slice(-24)}`;
    const rl = hitRateLimit(bucketKey, 3, 15 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Terlalu banyak laporan dalam waktu singkat — coba lagi dalam ${Math.ceil(rl.retryAfterSec / 60)} menit` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    const b = await req.json().catch(() => ({}));
    const category = String(b.category ?? "").trim();
    const description = String(b.description ?? "").trim();
    if (!(WHISTLEBLOW_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: "Kategori laporan tidak dikenal" }, { status: 400 });
    }
    if (description.length < 20) {
      return NextResponse.json({ error: "Uraian kejadian minimal 20 karakter — jelaskan kronologi singkat agar dapat ditindaklanjuti" }, { status: 400 });
    }
    if (description.length > 4000) {
      return NextResponse.json({ error: "Uraian maksimum 4.000 karakter" }, { status: 400 });
    }
    const anonymous = b.anonymous !== false; // default ANONIM
    const incidentDate = b.incidentDate ? new Date(String(b.incidentDate)) : null;
    if (incidentDate && Number.isNaN(incidentDate.getTime())) {
      return NextResponse.json({ error: "Tanggal kejadian tidak valid" }, { status: 400 });
    }
    if (incidentDate && incidentDate.getTime() > Date.now()) {
      return NextResponse.json({ error: "Tanggal kejadian tidak boleh di masa depan" }, { status: 400 });
    }
    const reporterContact = b.reporterContact ? String(b.reporterContact).trim().slice(0, 120) || null : null;
    const involvedHint = b.involvedHint ? String(b.involvedHint).trim().slice(0, 300) || null : null;
    const location = b.location ? String(b.location).trim().slice(0, 200) || null : null;

    // Identitas pelapor: HANYA disimpan saat NON-anonim (diambil dari sesi —
    // bukan dari input pengguna, supaya tidak bisa dipalsukan).
    let reporterEmployeeId: string | null = null;
    if (!anonymous) {
      try {
        const payload = await readVerifiedSession(req);
        if (payload?.uid && payload.tid) {
          const membership = await platformDb.userTenant.findFirst({
            where: { userId: payload.uid, tenantId: payload.tid },
            select: { user: { select: { email: true } } },
          });
          const email = membership?.user.email ?? null;
          if (email) {
            const me = await db.appUser.findFirst({ where: { email }, select: { employeeId: true } });
            reporterEmployeeId = me?.employeeId ?? null;
          }
        }
      } catch {
        reporterEmployeeId = null; // resolusi gagal → perlakukan anonim
      }
    }

    const ticketNo = await nextTicketNo(db);
    const report = await db.whistleblowReport.create({
      data: {
        ticketNo,
        category,
        channel: anonymous ? "ANONIM" : "ESS",
        description,
        incidentDate: incidentDate && !Number.isNaN(incidentDate.getTime()) ? incidentDate : null,
        location,
        involvedHint,
        anonymous,
        reporterEmployeeId,
        reporterContact,
        status: "Baru",
      },
      select: { id: true, ticketNo: true, createdAt: true },
    });

    // Notifikasi tim penangan (admin/HR) — TANPA menyebut identitas pelapor.
    // ActivityLog sengaja TIDAK ditulis dengan aktor user (lihat komentar
    // skema WhistleblowReport); jejak triase ditulis di PATCH reports.
    void notifyEvent(db, {
      to: "admins",
      docType: "Whistleblow",
      docNo: ticketNo,
      docId: report.id,
      title: `Laporan whistleblowing baru ${ticketNo}`,
      body: `Kategori ${category} — laporan ${anonymous ? "anonim" : "teridentifikasi"} masuk, menunggu triase.`,
      kind: "warning",
      link: "whistleblowing:triage",
    });

    return NextResponse.json(
      {
        ok: true,
        ticketNo: report.ticketNo,
        createdAt: report.createdAt,
        message:
          anonymous
            ? "Laporan tersimpan SECARA ANONIM — identitas Anda tidak disimpan di sistem. Simpan nomor tiket untuk mengecek perkembangan."
            : "Laporan tersimpan dengan identitas Anda — tim penangan akan menghubungi untuk tindak lanjut.",
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
