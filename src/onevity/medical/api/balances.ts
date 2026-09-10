import { NextRequest, NextResponse } from "next/server";
import { UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction, resolveMenuPerms } from "@/onevity/shared/services/menu-access";
import { listBalances, generateBalances, listBenefitTypes } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/balances?year=&employeeId=&typeId= — saldo medis
// karyawan per jenis (padanan Employee Medical Information / My Medical Information)
// + jenis & karyawan utk filter form.
// M-21 (audit 42): dulu katalog saldo SELURUH karyawan dikirim ke siapa pun
// yang login. Kini: pemegang akses LIHAT menu medis (medical:medical-info /
// medical:medical-claim — HR) tetap dapat daftar penuh; pengguna lain hanya
// saldo MILIKNYA (scope actor.employeeId — padanan My Medical Information).
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveMenuPerms(req);
    if (!resolved) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const db = resolved.db;
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") ?? new Date().getFullYear());

    const canViewAll =
      resolved.isSuperAdmin ||
      resolved.all ||
      resolved.perms["medical:medical-info"]?.view === true ||
      resolved.perms["medical:medical-claim"]?.view === true;
    const selfEmployeeId = resolved.actor.employeeId;
    if (!canViewAll && !selfEmployeeId) {
      return NextResponse.json(
        { error: "Akses ditolak: hanya pemegang akses LIHAT menu medis atau pemilik saldo yang dapat melihat saldo medis" },
        { status: 403 },
      );
    }
    // filter employeeId dari klien hanya dihormati utk pemegang menu medis;
    // pengguna lain DIPAKSA scope ke employeeId-nya sendiri.
    const employeeId = canViewAll ? sp.get("employeeId") ?? undefined : selfEmployeeId!;

    const [balances, types, employees] = await Promise.all([
      listBalances(db, {
        year,
        employeeId,
        typeId: sp.get("typeId") ?? undefined,
      }),
      listBenefitTypes(db),
      db.employee.findMany({
        where: canViewAll ? { status: "Active" } : { id: selfEmployeeId! },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    const years = await db.medicalBalance.findMany({
      where: canViewAll ? undefined : { employeeId: selfEmployeeId! },
      select: { year: true }, distinct: ["year"], orderBy: { year: "desc" },
    });
    return NextResponse.json({
      balances, types, employees,
      years: years.map((y) => y.year),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — generate saldo medis per tahun (padanan GenerateMedicalBenefitInfo.jsp:
// period + jenis opsional + Benefit Limit Correction + semua/spesifik karyawan).
// Fix K-4: saldo baru initialUsed = 0 (tanpa auto-carry).
// Task 32-d / fix audit 40 §5: requireMutator longgar → requireMenuAction —
// aksi "create" pada medical:medical-info (view Saldo Medis Karyawan tempat
// tombol Generate berada; katalog op tidak punya entri generate — aksi dasar
// create semantiknya memuat menambah data saldo; VIEWER tetap 403).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "medical:medical-info", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const year = Number(b.year ?? 0);
    if (!year) return NextResponse.json({ error: "year wajib" }, { status: 400 });
    const res = await generateBalances(m.db, {
      year,
      typeId: b.typeId ? String(b.typeId) : undefined,
      limitCorrection: Boolean(b.limitCorrection),
      employeeIds: Array.isArray(b.employeeIds) ? b.employeeIds.map(String) : undefined,
      // Fix audit 40 M-05 — aktor generate tercatat di ActivityLog
      actor: { appUserId: m.actor.appUserId },
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
