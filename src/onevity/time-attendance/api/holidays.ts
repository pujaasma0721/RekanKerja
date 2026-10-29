import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction, type MenuActor } from "@/onevity/shared/services/menu-access";

// ============ T9-HOLIDAY — Kalender Hari Libur (CRUD + import tahunan) =======
// GET  /api/onevity/attendance/holidays?year=2026 — daftar libur tahun tsb
//      + tahun tersedia + ringkasan per jenis (National/Joint/Company).
// POST — dua mode:
//      {date, name, kind}             → tambah satu hari libur
//      {rows: [{date, name, kind}]}   → import massal (CSV tahunan dari UI) —
//                                       idempoten per (date,name): duplikat dilewati
// PATCH {id, date?, name?, kind?}     → ubah
// DELETE {id}                          → hapus
// Guard mutasi: requireMenuAction menu "attendance:holidays" (pola route
// attendance lain — overtime/workoff/assignments).
const HOLIDAY_KINDS = ["National", "Joint", "Company"] as const;

interface HolidayRow {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  kind: string;
  createdAt?: string;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Parse "YYYY-MM-DD" ketat — null bila format/tanggal kalender tidak sah. */
function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const [y, m, day] = s.split("-").map(Number);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) return null;
  return d;
}

async function logHoliday(db: TenantDb, actor: MenuActor | null, action: string, entityId: string, detail: string) {
  try {
    await db.activityLog.create({
      data: {
        action, entity: "HolidayDate", entityId, appUserId: actor?.appUserId ?? null,
        detail: actor ? `${detail} oleh ${actor.name}` : detail,
      },
    });
  } catch {
    // jejak audit best-effort — jangan gagalkan operasi
  }
}

// GET — kalender per tahun (tanpa mutasi → requireTenant, pola GET attendance)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const yearParam = req.nextUrl.searchParams.get("year");
    const year = yearParam && /^\d{4}$/.test(yearParam)
      ? Math.max(2000, Math.min(2100, parseInt(yearParam, 10)))
      : new Date().getFullYear();

    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    const rows = await db.holidayDate.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: [{ date: "asc" }, { kind: "desc" }, { name: "asc" }],
    });
    const holidays: HolidayRow[] = rows.map((h) => ({
      id: h.id,
      date: h.date.toISOString().slice(0, 10),
      name: h.name,
      kind: h.kind,
    }));

    // tahun yang tersedia (utk pemilih tahun di UI)
    const allDates = await db.holidayDate.findMany({ select: { date: true } });
    const years = [...new Set(allDates.map((d) => d.date.getFullYear()))].sort((a, b) => a - b);

    const stats = {
      total: holidays.length,
      national: holidays.filter((h) => h.kind === "National").length,
      joint: holidays.filter((h) => h.kind === "Joint").length,
      company: holidays.filter((h) => h.kind === "Company").length,
    };
    return NextResponse.json({ year, years, holidays, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

interface ImportRow {
  date: string;
  name: string;
  kind: string;
}

/** Validasi satu baris import → [data, null] atau [null, error]. */
function validateRow(raw: { date?: unknown; name?: unknown; kind?: unknown }, i: number): [{ date: Date; dateStr: string; name: string; kind: string }, string] | [null, string] {
  const dateStr = String(raw.date ?? "").trim();
  const d = parseYmd(dateStr);
  if (!d) return [null, `baris ${i + 1}: tanggal "${dateStr}" tidak valid (YYYY-MM-DD, tanggal kalender sah)`];
  const name = String(raw.name ?? "").trim();
  if (!name || name.length > 120) return [null, `baris ${i + 1}: nama libur wajib 1–120 karakter`];
  const kind = raw.kind == null || String(raw.kind).trim() === "" ? "National" : String(raw.kind).trim();
  if (!(HOLIDAY_KINDS as readonly string[]).includes(kind)) {
    return [null, `baris ${i + 1}: jenis "${kind}" tidak dikenal (National|Joint|Company)`];
  }
  return [{ date: d, dateStr, name, kind }, ""];
}

// POST — tambah tunggal / import massal (idempoten per date+name)
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:holidays", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();

    // ---- mode import massal: {rows: [{date,name,kind}]} ----
    if (Array.isArray(b.rows)) {
      const valid: { date: Date; dateStr: string; name: string; kind: string }[] = [];
      const invalid: string[] = [];
      const seen = new Set<string>();
      let duplicatedInBatch = 0;
      for (let i = 0; i < b.rows.length; i++) {
        const [data, err] = validateRow(b.rows[i], i);
        if (!data) { invalid.push(err); continue; }
        const key = `${data.dateStr}|${data.name.toLowerCase()}`;
        if (seen.has(key)) { duplicatedInBatch++; continue; }
        seen.add(key);
        valid.push(data);
      }
      if (valid.length > 500) {
        return NextResponse.json({ error: "Maksimal 500 baris per import" }, { status: 400 });
      }
      // ON CONFLICT (date,name) DO NOTHING — idempoten
      const res = await m.db.holidayDate.createMany({
        data: valid.map((v) => ({ date: v.date, name: v.name, kind: v.kind })),
        skipDuplicates: true,
      });
      const imported = res.count;
      const skipped = valid.length - imported;
      await logHoliday(m.db, m.actor, "Created", `import-${new Date().toISOString().slice(0, 10)}`,
        `Import kalender libur: ${imported} baru, ${skipped} dilewati (sudah terdaftar), ${duplicatedInBatch} duplikat dalam batch, ${invalid.length} baris tidak valid`);
      return NextResponse.json(
        {
          imported,
          skipped,
          duplicatedInBatch,
          invalid,
          note: `${imported} hari libur ditambahkan${skipped > 0 ? `, ${skipped} dilewati (sudah terdaftar)` : ""}${invalid.length > 0 ? `, ${invalid.length} baris tidak valid` : ""}`,
        },
        { status: 201 },
      );
    }

    // ---- mode tunggal: {date, name, kind} ----
    const [data, err] = validateRow(b, -1);
    if (!data) return NextResponse.json({ error: err.replace(/^baris 0: /, "") }, { status: 400 });
    const existing = await m.db.holidayDate.findFirst({
      where: { date: data.date, name: data.name },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Libur "${data.name}" tanggal ${data.dateStr} sudah terdaftar` },
        { status: 400 },
      );
    }
    const holiday = await m.db.holidayDate.create({
      data: { date: data.date, name: data.name, kind: data.kind },
    });
    await logHoliday(m.db, m.actor, "Created", holiday.id, `Hari libur baru ${data.dateStr} — ${data.name} (${data.kind})`);
    return NextResponse.json(
      { holiday: { id: holiday.id, date: holiday.date.toISOString().slice(0, 10), name: holiday.name, kind: holiday.kind } },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — ubah nama/jenis/tanggal
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:holidays", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await m.db.holidayDate.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Hari libur tidak ditemukan" }, { status: 404 });

    const data: { date?: Date; name?: string; kind?: string } = {};
    if (b.date !== undefined) {
      const d = parseYmd(String(b.date));
      if (!d) return NextResponse.json({ error: "Tanggal tidak valid (YYYY-MM-DD)" }, { status: 400 });
      data.date = d;
    }
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name || name.length > 120) return NextResponse.json({ error: "Nama libur wajib 1–120 karakter" }, { status: 400 });
      data.name = name;
    }
    if (b.kind !== undefined) {
      if (!(HOLIDAY_KINDS as readonly string[]).includes(String(b.kind))) {
        return NextResponse.json({ error: `Jenis harus National|Joint|Company` }, { status: 400 });
      }
      data.kind = String(b.kind);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan (date/name/kind)" }, { status: 400 });
    }

    const newDate = data.date ?? existing.date;
    const newName = data.name ?? existing.name;
    const clash = await m.db.holidayDate.findFirst({
      where: { date: newDate, name: newName, id: { not: existing.id } },
    });
    if (clash) {
      return NextResponse.json(
        { error: `Libur "${newName}" tanggal ${newDate.toISOString().slice(0, 10)} sudah terdaftar` },
        { status: 400 },
      );
    }

    const holiday = await m.db.holidayDate.update({ where: { id: existing.id }, data });
    await logHoliday(m.db, m.actor, "Updated", holiday.id,
      `Hari libur ${existing.date.toISOString().slice(0, 10)} — ${existing.name} (${existing.kind}) diubah → ${holiday.date.toISOString().slice(0, 10)} — ${holiday.name} (${holiday.kind})`);
    return NextResponse.json({
      holiday: { id: holiday.id, date: holiday.date.toISOString().slice(0, 10), name: holiday.name, kind: holiday.kind },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE — hapus hari libur
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:holidays", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await m.db.holidayDate.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Hari libur tidak ditemukan" }, { status: 404 });

    await m.db.holidayDate.delete({ where: { id: existing.id } });
    await logHoliday(m.db, m.actor, "Deleted", existing.id,
      `Hari libur dihapus: ${existing.date.toISOString().slice(0, 10)} — ${existing.name} (${existing.kind})`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
