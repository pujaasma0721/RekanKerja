// RekanKerja — Report Builder (P3.4-BM / D-BM26) ==============================
// Jadwal pengiriman laporan kustom (email XLSX periodik — satu jadwal per
// laporan tersimpan, upsert by reportId):
//   · POST { action: "schedule-save", reportId, frequency, dayOfWeek?, dayOfMonth?,
//     hour, recipients, active } — upsert (guard op hr:custom-reports:schedule).
//   · POST { action: "schedule-delete", reportId } — hapus jadwal (guard sama).
// Validasi: frequency Daily|Weekly|Monthly (Weekly wajib dayOfWeek 0–6;
// Monthly wajib dayOfMonth 1–28), hour 0–23 (WIB), recipients 1–20 email valid
// dipisah koma/titik-koma. Setiap mutasi menulis ActivityLog entity
// ReportSchedule (detail frekuensi + penerima + aktor).
// Eksekusi kirim dilakukan job scheduler jobCustomReportSchedules
// (scheduler-service.ts) — bukan route ini.
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { serializeSchedule } from "@/rekankerja/shared/services/report-builder";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_RECIPIENTS = 20;
const FREQUENCIES = ["Daily", "Weekly", "Monthly"] as const;

const DAY_OF_WEEK_LABEL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function freqLabel(frequency: string, dayOfWeek: number | null, dayOfMonth: number | null): string {
  if (frequency === "Weekly" && dayOfWeek != null) return `Mingguan (${DAY_OF_WEEK_LABEL[dayOfWeek] ?? String(dayOfWeek)})`;
  if (frequency === "Monthly" && dayOfMonth != null) return `Bulanan (tanggal ${dayOfMonth})`;
  return frequency === "Weekly" ? "Mingguan" : frequency === "Monthly" ? "Bulanan" : "Harian";
}

export async function POST(req: NextRequest) {
  try {
    // menu op "schedule" sudah terdaftar di MENU_OPS hr:custom-reports (P3-0b).
    const m = await requireMenuAction(req, "hr:custom-reports", "op:schedule");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "schedule-save");
    if (action !== "schedule-save" && action !== "schedule-delete") {
      return NextResponse.json({ error: "Aksi tidak dikenal (schedule-save | schedule-delete)" }, { status: 400 });
    }

    const reportId = String(b.reportId ?? "");
    if (!reportId) return NextResponse.json({ error: "id laporan wajib" }, { status: 400 });
    const report = await db.customReport.findUnique({ where: { id: reportId } });
    if (!report) return NextResponse.json({ error: "Laporan tersimpan tidak ditemukan" }, { status: 404 });

    // ================= schedule-delete =================
    if (action === "schedule-delete") {
      const existing = await db.reportSchedule.findUnique({ where: { reportId } });
      if (!existing) return NextResponse.json({ error: "Jadwal tidak ditemukan" }, { status: 404 });
      await db.reportSchedule.delete({ where: { reportId } });
      await db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action: "Deleted", entity: "ReportSchedule", entityId: existing.id,
          detail: `Jadwal kirim laporan ${report.code} — "${report.name}" (${freqLabel(existing.frequency, existing.dayOfWeek, existing.dayOfMonth)}, ${existing.recipients}) dihapus oleh ${actor.appUsername ?? actor.name}`,
        },
      }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });
      return NextResponse.json({ ok: true });
    }

    // ================= schedule-save (upsert by reportId) =================
    const frequency = String(b.frequency ?? "");
    if (!(FREQUENCIES as readonly string[]).includes(frequency)) {
      return NextResponse.json({ error: "Frekuensi harus Daily, Weekly, atau Monthly" }, { status: 400 });
    }
    let dayOfWeek: number | null = null;
    if (frequency === "Weekly") {
      const d = Math.trunc(Number(b.dayOfWeek ?? NaN));
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        return NextResponse.json({ error: "Hari mingguan wajib 0–6 (0 = Minggu)" }, { status: 400 });
      }
      dayOfWeek = d;
    }
    let dayOfMonth: number | null = null;
    if (frequency === "Monthly") {
      const d = Math.trunc(Number(b.dayOfMonth ?? NaN));
      if (!Number.isInteger(d) || d < 1 || d > 28) {
        return NextResponse.json({ error: "Tanggal bulanan wajib 1–28" }, { status: 400 });
      }
      dayOfMonth = d;
    }
    const hourRaw = Math.trunc(Number(b.hour ?? NaN));
    if (!Number.isInteger(hourRaw) || hourRaw < 0 || hourRaw > 23) {
      return NextResponse.json({ error: "Jam kirim wajib 0–23 (WIB)" }, { status: 400 });
    }
    const recipientsRaw = String(b.recipients ?? "");
    const recipients = recipientsRaw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) {
      return NextResponse.json({ error: "Minimal 1 email penerima wajib diisi" }, { status: 400 });
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json({ error: `Maksimal ${MAX_RECIPIENTS} email penerima` }, { status: 400 });
    }
    const bad = recipients.find((r) => !EMAIL_RE.test(r) || r.length > 200);
    if (bad) return NextResponse.json({ error: `Alamat email tidak valid: "${bad}"` }, { status: 400 });
    const active = b.active !== false; // default ON — UI selalu mengirim eksplisit

    const existing = await db.reportSchedule.findUnique({ where: { reportId } });
    const saved = await db.reportSchedule.upsert({
      where: { reportId },
      update: { frequency, dayOfWeek, dayOfMonth, hour: hourRaw, recipients: recipients.join(", "), active },
      create: { reportId, frequency, dayOfWeek, dayOfMonth, hour: hourRaw, recipients: recipients.join(", "), active },
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: existing ? "Updated" : "Created", entity: "ReportSchedule", entityId: saved.id,
        detail:
          `Jadwal kirim laporan ${report.code} — "${report.name}": ${freqLabel(frequency, dayOfWeek, dayOfMonth)}, ` +
          `jam ${hourRaw} WIB, ${recipients.length} penerima, ${active ? "aktif" : "nonaktif"} ` +
          `${existing ? "diubah" : "dibuat"} oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ schedule: serializeSchedule(saved) }, { status: existing ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
