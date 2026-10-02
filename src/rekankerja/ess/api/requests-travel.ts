// GET /api/rekankerja/ess/requests/travel + POST ajukan perjalanan dinis (ESS).
// =====================================================================
// Task 98 (F1-4) — pengajuan dinis SELF-SERVICE dari ESS (dulu hanya klaim;
// karyawan tidak bisa mengajukan dinis sendiri — paradigma "HR mengajukan
// atas nama karyawan"). Seluruh guard jalur admin TETAP berlaku via
// submitTravelRequest: validasi tanggal multi-kaki M-5, ≤60 hari, template
// aktif, approval berjenjang "Travel" struktur pemohon (jenjang nominal),
// notifikasi email/in-app, estimasi SBI + budget check.
//
// GET — master form (template aktif + zona + tarif kota SBI utk estimasi
//       client-side) + daftar permintaan dinis SAYA (semua status).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import {
  listTravelRequests, listTemplates, listZones, listCityRates, submitTravelRequest,
} from "@/rekankerja/travel/services/travel-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformUserId, platformRole } = m.actor;

  try {
    const [rows, templates, zones, cityRates] = await Promise.all([
      listTravelRequests(db, { employeeId }),
      listTemplates(db),
      listZones(db),
      listCityRates(db).catch(() => []),
    ]);
    // 45-b: gerbang vault uang (aktor ESS) — advance masked → null ("—" di UI).
    const mv = await getMoneyView(db, { userId: platformUserId, membershipRole: platformRole });
    const g = (n: number) => (mv.canSee ? n : null);
    const requests = rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      dateFrom: new Date(r.dateFrom).toISOString().slice(0, 10),
      dateTo: new Date(r.dateTo).toISOString().slice(0, 10),
      days: r.days,
      purpose: r.purpose,
      status: r.status,
      decisionNote: r.decisionNote,
      claimRequestedAt: r.claimRequestedAt ? new Date(r.claimRequestedAt).toISOString() : null,
      settlementDue: r.settlementDue ? new Date(r.settlementDue).toISOString() : null,
      overdue: r.overdue,
      destinations: r.destinations.map((d) => ({ city: d.city, country: d.country, overseas: d.overseas, dateFrom: new Date(d.dateFrom).toISOString().slice(0, 10), dateTo: new Date(d.dateTo).toISOString().slice(0, 10) })),
      advanceAmount: g(r.advanceAmount),
      hasActiveClaim: r.hasActiveClaim,
      activeClaimDocNo: r.activeClaimDocNo,
      approval: r.approval ? { currentLevel: r.approval.currentLevel, totalLevels: r.approval.totalLevels, currentApprover: r.approval.currentApprover } : null,
    }));
    return NextResponse.json({
      requests,
      templates: templates.filter((t) => t.active).map((t) => ({ code: t.code, name: t.name, settlementDay: t.settlementDay, isDefault: t.isDefault })),
      zones: zones.map((z) => ({ code: z.code, name: z.name, overseas: z.overseas })),
      cityRates,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan perjalanan dinis untuk diri sendiri (multi-destinasi + uang muka).
// Body: { templateCode, dateFrom, dateTo, purpose, remark?, advanceAmount?,
//         advanceNote?, destinations: [{ dateFrom, dateTo, city, country?, zoneCode?, overseas?, note? }] }
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    if (!Array.isArray(b.destinations) || b.destinations.length === 0) {
      return NextResponse.json({ error: "Minimal 1 destinasi wajib" }, { status: 400 });
    }
    // Estimasi SBI direspons — bantu karyawan memahami saran uang muka.
    const res = await submitTravelRequest(db, {
      employeeId,
      templateCode: String(b.templateCode ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      dateTo: String(b.dateTo ?? ""),
      purpose: String(b.purpose ?? ""),
      remark: b.remark ? String(b.remark) : undefined,
      destinations: b.destinations.map((d: Record<string, unknown>) => ({
        dateFrom: String(d.dateFrom ?? ""),
        dateTo: String(d.dateTo ?? ""),
        city: String(d.city ?? ""),
        country: d.country ? String(d.country) : undefined,
        zoneCode: d.zoneCode ? String(d.zoneCode) : undefined,
        overseas: Boolean(d.overseas),
        note: d.note ? String(d.note) : undefined,
      })),
      advanceAmount: Math.max(0, Number(b.advanceAmount ?? 0)),
      advanceNote: b.advanceNote ? String(b.advanceNote) : undefined,
      actorName: `${fullName} (ESS)`,
    });

    // ===== Notifikasi — mirror jalur admin travel/api/requests.ts POST =====
    void (async () => {
      try {
        const cities = (b.destinations as { city?: string }[]).map((d) => d.city ?? "-").filter(Boolean).join(", ");
        notifyEmailEvent(db, {
          event: "travel.submitted",
          to: await approverEmailsOf(db, employeeId),
          data: {
            nama: fullName, docNo: res.docNo, tujuan: cities || "-",
            periode: `${String(b.dateFrom ?? "-")} → ${String(b.dateTo ?? "-")}`,
            biaya: b.advanceAmount ? `Rp ${Number(b.advanceAmount).toLocaleString("id-ID")}` : "-",
          },
        });
        await notifyEvent(db, {
          to: "nextApprover", docType: "Travel", docNo: res.docNo,
          title: `Pengajuan travel ${res.docNo} menunggu persetujuan Anda`,
          body: `${fullName} (ESS) — ${cities || "-"}, ${String(b.dateFrom ?? "-")} → ${String(b.dateTo ?? "-")}${res.estimate ? ` · estimasi SBI Rp ${res.estimate.estimateTotal.toLocaleString("id-ID")}` : ""}`,
          kind: "travel", link: "travel:travel-approval",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama ESS */ }
    })();

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    // validasi bisnis (tanggal/destinasi/template) → 400 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
