import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { attachChainSummaries } from "@/rekankerja/shared/services/approval-engine";
import { submitWorkoff, decideWorkoff } from "@/rekankerja/time-attendance/services/attendance-service";
import { notifyEmailEvent, employeeEmailOf } from "@/rekankerja/shared/services/email-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";

// GET /api/rekankerja/attendance/workoffs?status= — izin tidak masuk + statistik
// (padanan EmployeeWorkOff.jsp + approval berjenjang).
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:workoff (dulu
// requireTenant: daftar izin seluruh karyawan terbaca tanpa hak LIHAT).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:workoff"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const status = req.nextUrl.searchParams.get("status");
    // Task 76 — sort server-side (whitelist; default terbaru dulu)
    const sortByParam = req.nextUrl.searchParams.get("sortBy") ?? "";
    const sortDirParam = req.nextUrl.searchParams.get("sortDir") === "desc" ? "desc" : "asc";
    const dir = sortDirParam;
    const WO_SORT: Record<string, Record<string, unknown>[]> = {
      doc: [{ docNo: dir }],
      employee: [{ employee: { fullName: dir } }],
      date: [{ dateFrom: dir }, { docNo: dir }],
      duration: [{ allDay: dir }],
      pay: [{ paid: dir }],
      deduct: [{ deductLeave: dir }],
      status: [{ status: dir }],
    };
    const [permits, dayTypes] = await Promise.all([
      db.workOffPermission.findMany({
        where: status && status !== "all" ? { status } : {},
        include: {
          employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
          dayType: { select: { code: true, name: true } },
        },
        orderBy: WO_SORT[sortByParam] ?? [{ dateFrom: "desc" }, { docNo: "desc" }],
      }),
      db.workDayType.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ]);

    // ringkasan approval berjenjang per izin (jenjang aktif + approver menunggu)
    const chainMap = await attachChainSummaries(db, "WorkOff", permits.map((p) => ({ id: p.id })));
    const flat = permits.map((p) => ({
      ...p,
      orgUnitName: p.employee.assignments[0]?.orgUnit?.name ?? null,
      approval: chainMap.get(p.id) ?? null,
    }));
    const days = (from: Date, to: Date) => Math.round((dayStartOf(to) - dayStartOf(from)) / 86_400_000) + 1;
    const stats = {
      total: flat.length,
      pending: flat.filter((p) => p.status === "Pending").length,
      approved: flat.filter((p) => p.status === "Approved").length,
      paid: flat.filter((p) => p.status === "Approved" && p.paid).length,
      unpaid: flat.filter((p) => p.status === "Approved" && !p.paid).length,
      deductLeave: flat.filter((p) => p.status === "Approved" && p.deductLeave).length,
      totalDays: flat.filter((p) => p.status === "Approved").reduce((s, p) => s + days(p.dateFrom, p.dateTo), 0),
    };
    return NextResponse.json({ permits: flat, dayTypes, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

function dayStartOf(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** "YYYY-MM-DD" utk teks notifikasi. */
function iso(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

// POST — ajukan izin (padanan Employee Work Off Permission). Guard VIEWER + aktor sesi.
// Task 32-d: guard hak AKSI menu — create pada attendance:workoff (per pengguna).
// Approval berjenjang: chain dibangun service sesuai struktur WorkOff pemohon.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:workoff", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const res = await submitWorkoff(m.db, {
      employeeId: String(b.employeeId ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      dateTo: b.dateTo ? String(b.dateTo) : undefined,
      allDay: b.allDay === undefined ? true : Boolean(b.allDay),
      timeFrom: b.timeFrom ?? null,
      timeTo: b.timeTo ?? null,
      paid: b.paid === undefined ? true : Boolean(b.paid),
      deductLeave: b.deductLeave === undefined ? true : Boolean(b.deductLeave),
      reason: b.reason ?? null,
      documentNote: b.documentNote ?? null,
      actorName: m.actor.name,
    });

    // ===== Notifikasi in-app (T11-NOTIF) — submit → approver jenjang pertama =====
    const permit = res.permit as
      | { id: string; docNo: string; employeeId: string; dateFrom: Date; dateTo: Date; allDay: boolean; employee: { fullName: string } | null }
      | null;
    if (permit) {
      void notifyEvent(m.db, {
        to: "nextApprover", docType: "WorkOff", docNo: permit.docNo, docId: permit.id,
        title: `Pengajuan izin ${permit.docNo} menunggu persetujuan Anda`,
        body: `${permit.employee?.fullName ?? "Karyawan"} — izin tidak masuk ${iso(permit.dateFrom)} → ${iso(permit.dateTo)} (${permit.allDay ? "sehari penuh" : "setengah hari"})`,
        // Fix audit 40 M-8 — link notifikasi approver ke view modul Work Off
        // ("actions:inbox" hanya memuat dokumen PA — approver TA tidak bisa
        // membuka izin dari sana; "attendance:workoff" = section:view valid
        // yang dinavigasi bell).
        kind: "attendance", link: "attendance:workoff",
      });
    }

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — approve | reject | cancel. Guard VIEWER + aktor sesi.
// Task 32-d: guard hak AKSI menu — op:approve pada attendance:workoff (per pengguna).
// Approval berjenjang: approve jenjang menengah → status tetap Pending (res
// membawa field `approval`); hanya keputusan FINAL yang mengubah status izin.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:workoff", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json().catch(() => ({}));

    // ===== Task 100 F1 (G25) — op:"bulk": putuskan banyak izin sekaligus =====
    // body { ids: string[] (maks 50), action: "approve"|"reject", reason? } →
    // loop decideWorkoff PERSIS seperti op tunggal (approval berjenjang tetap
    // jalan per dokumen); dokumen yang sudah diputuskan proses lain gagal
    // per-id (race-safe) tanpa membatalkan sisa batch. Notifikasi per dokumen
    // mirror op tunggal (email + in-app + webhook, fire-and-forget).
    if (b.op === "bulk") {
      // unknown[] dulu supaya Set ter-infer string[] (new Set(any) → Set<unknown>)
      const rawIds: unknown[] = Array.isArray(b.ids) ? b.ids : [];
      const ids = [...new Set(rawIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
      if (ids.length === 0) return NextResponse.json({ error: "ids wajib diisi (array id dokumen izin)" }, { status: 400 });
      if (ids.length > 50) {
        return NextResponse.json({ error: `Maksimal 50 dokumen per operasi massal (diminta ${ids.length})` }, { status: 400 });
      }
      const actionStr = String(b.action ?? "");
      if (actionStr !== "approve" && actionStr !== "reject") {
        return NextResponse.json({ error: "action wajib approve|reject untuk operasi massal" }, { status: 400 });
      }
      const action: "approve" | "reject" = actionStr;
      const note = b.reason != null ? String(b.reason).slice(0, 300) : undefined;

      const results: Array<{ id: string; ok: boolean; status?: string | null; error?: string }> = [];
      for (const id of ids) {
        try {
          const res = await decideWorkoff(m.db, id, action, {
            approver: m.actor.name,
            note,
            actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
          });
          // keputusan FINAL saja yang menotifikasi (approve jenjang menengah →
          // res.approval terisi, izin masih Pending — mirror op tunggal;
          // bulk hanya approve|reject, tidak ada jalur cancel)
          if (!res.approval) {
            void (async () => {
              try {
                const wo = await m.db.workOffPermission.findUnique({
                  where: { id },
                  select: { employeeId: true, docNo: true, dateFrom: true, dateTo: true, paid: true, employee: { select: { fullName: true } } },
                });
                if (!wo) return;
                const emp = await employeeEmailOf(m.db, wo.employeeId);
                if (emp) {
                  notifyEmailEvent(m.db, {
                    event: action === "approve" ? "workoff.approved" : "workoff.rejected",
                    to: [emp],
                    data: {
                      nama: wo.employee?.fullName ?? "-", docNo: wo.docNo,
                      tanggal: `${new Date(wo.dateFrom).toISOString().slice(0, 10)} → ${new Date(wo.dateTo).toISOString().slice(0, 10)}`,
                      kebijakan: wo.paid ? "Dibayar (gaji tetap)" : "Tanpa upah",
                      status: action === "approve" ? "Disetujui" : "Ditolak",
                      keterangan: note ?? "-",
                    },
                  });
                }
                await notifyEvent(m.db, {
                  to: "employee", docType: "WorkOff", docNo: wo.docNo, docId: id, employeeId: wo.employeeId,
                  title: action === "approve" ? `Pengajuan izin ${wo.docNo} disetujui` : `Pengajuan izin ${wo.docNo} ditolak`,
                  body: `Izin tidak masuk ${new Date(wo.dateFrom).toISOString().slice(0, 10)} → ${new Date(wo.dateTo).toISOString().slice(0, 10)}${note ? ` — catatan: ${note}` : ""}`,
                  kind: "attendance", link: "attendance:workoff",
                });
                await dispatchWebhookEvent(
                  m.db, null,
                  action === "approve" ? "workoff.approved" : "workoff.rejected",
                  {
                    docNo: wo.docNo, employeeId: wo.employeeId, employeeName: wo.employee?.fullName ?? null,
                    dateFrom: new Date(wo.dateFrom).toISOString().slice(0, 10),
                    dateTo: new Date(wo.dateTo).toISOString().slice(0, 10),
                    paid: wo.paid, note: note ?? null, decidedBy: m.actor.name, source: "bulk",
                  },
                );
              } catch {
                // notifikasi tidak boleh menggagalkan keputusan
              }
            })();
          }
          const permit = res.permit as { status?: string } | null;
          results.push({ id, ok: true, status: permit?.status ?? null });
        } catch (e) {
          // race double-decide / akses jenjang → gagal per-id
          results.push({ id, ok: false, error: e instanceof Error ? e.message : "unknown" });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      return NextResponse.json({ results, okCount, failCount: results.length - okCount });
    }

    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    const res = await decideWorkoff(m.db, b.id, b.action, {
      approver: b.approver ?? m.actor.name,
      note: b.note,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
    });

    // ===== Notifikasi in-app (T11-NOTIF) — fire-and-forget =====
    // approve parsial (masih ada jenjang berikutnya) → approver jenjang berikut
    if (b.action === "approve" && res.approval) {
      const permit = res.permit as { docNo: string } | null;
      void notifyEvent(m.db, {
        to: "nextApprover", docType: "WorkOff", docNo: permit?.docNo ?? String(b.id), docId: String(b.id),
        title: `Pengajuan izin ${permit?.docNo ?? "-"} menunggu persetujuan Anda (jenjang ${res.approval.currentLevel}/${res.approval.totalLevels})`,
        body: `Jenjang sebelumnya disetujui — menunggu keputusan ${res.approval.currentApprover ?? "approver berikutnya"}.`,
        // Fix audit 40 M-8 — link notifikasi approver ke view modul Work Off
        // ("actions:inbox" hanya memuat dokumen PA — approver TA tidak bisa
        // membuka izin dari sana; "attendance:workoff" = section:view valid
        // yang dinavigasi bell).
        kind: "attendance", link: "attendance:workoff",
      });
    }

    // ===== Notifikasi email otomatis — fire-and-forget (padanan Leave) =====
    // Hanya keputusan FINAL (approve/reject) yang memicu email ke pengaju;
    // approve jenjang menengah tetap menunggu (res membawa field approval).
    if (b.action !== "cancel" && !res.approval) {
      void (async () => {
        try {
          const wo = await m.db.workOffPermission.findUnique({
            where: { id: String(b.id) },
            select: { employeeId: true, docNo: true, dateFrom: true, dateTo: true, paid: true, employee: { select: { fullName: true } } },
          });
          const emp = wo ? await employeeEmailOf(m.db, wo.employeeId) : null;
          if (wo && emp) {
            notifyEmailEvent(m.db, {
              event: b.action === "approve" ? "workoff.approved" : "workoff.rejected",
              to: [emp],
              data: {
                nama: wo.employee?.fullName ?? "-", docNo: wo.docNo,
                tanggal: `${new Date(wo.dateFrom).toISOString().slice(0, 10)} → ${new Date(wo.dateTo).toISOString().slice(0, 10)}`,
                kebijakan: wo.paid ? "Dibayar (gaji tetap)" : "Tanpa upah",
                status: b.action === "approve" ? "Disetujui" : "Ditolak",
                keterangan: b.note ?? "-",
              },
            });
          }
          // ===== Notifikasi in-app (T11-NOTIF) — keputusan final → pengaju =====
          if (wo) {
            await notifyEvent(m.db, {
              to: "employee", docType: "WorkOff", docNo: wo.docNo, docId: String(b.id), employeeId: wo.employeeId,
              title: b.action === "approve" ? `Pengajuan izin ${wo.docNo} disetujui` : `Pengajuan izin ${wo.docNo} ditolak`,
              body: `Izin tidak masuk ${new Date(wo.dateFrom).toISOString().slice(0, 10)} → ${new Date(wo.dateTo).toISOString().slice(0, 10)}${b.note ? ` — catatan: ${String(b.note)}` : ""}`,
              kind: "attendance", link: "attendance:workoff",
            });
          }
          // ===== Webhook (T18-API) — keputusan FINAL workoff, fire-and-forget =====
          if (wo) {
            await dispatchWebhookEvent(
              m.db, null,
              b.action === "approve" ? "workoff.approved" : "workoff.rejected",
              {
                docNo: wo.docNo, employeeId: wo.employeeId, employeeName: wo.employee?.fullName ?? null,
                dateFrom: new Date(wo.dateFrom).toISOString().slice(0, 10),
                dateTo: new Date(wo.dateTo).toISOString().slice(0, 10),
                paid: wo.paid, note: b.note ? String(b.note) : null, decidedBy: m.actor.name,
              },
            );
          }
        } catch {
          // notifikasi tidak boleh menggagalkan keputusan
        }
      })();
    }
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
