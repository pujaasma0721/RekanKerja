import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { limitSnapshot, type LimitSnapshot } from "@/rekankerja/payroll/services/benefit-service";

const RESET = ["None", "Monthly", "Quarterly", "Yearly"];

/** 45-b: salinan DISPLAY limitSnapshot — field uang → null saat vault masked
 *  (snapshot asli tetap raw: dipakai utk VALIDASI submit klaim benefit). */
function maskUsageForDisplay(u: LimitSnapshot, mv: { canSee: boolean }): LimitSnapshot {
  if (mv.canSee) return u;
  return { ...u, used: 0, limit: null, remaining: null };
}

// GET /api/rekankerja/benefit-types[?employeeId=] — master + statistik klaim;
// employeeId menambahkan snapshot pemakaian limit (untuk form pengajuan).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const types = await db.benefitType.findMany({
      where: { active: true },
      include: {
        wageComponent: { select: { id: true, code: true, name: true } },
        // Task 33 — jumlah aturan diferensiasi limit klaim.
        _count: { select: { rules: true } },
      },
      orderBy: { code: "asc" },
    });
    const claims = await db.benefitClaim.findMany({
      select: { benefitTypeId: true, status: true, amount: true, claimDate: true },
    });
    // M-8: amount klaim terenkripsi — dekripsi utk statistik in-memory.
    // 45-b: gate vault (requireTenant → resolve via sesi) — stats via dec0
    // (masked → 0); limitSnapshot tetap raw (dipakai validasi submit klaim).
    const mv = await moneyViewForReq(req, db);
    const claimsDec = claims.map((c) => ({ ...c, amount: mv.dec0(c.amount) }));
    const now = new Date();
    const year = now.getFullYear();
    const result = await Promise.all(types.map(async (t) => {
      const of = claimsDec.filter((c) => c.benefitTypeId === t.id);
      const active = of.filter((c) => ["Approved", "Scheduled", "Paid"].includes(c.status));
      const usage = employeeId ? await limitSnapshot(db, t, employeeId, now) : null;
      const { _count, ...rest } = t;
      return {
        ...rest,
        ruleCount: _count.rules,
        claimCount: of.length,
        activeClaimCount: active.length,
        totalApprovedAmount: active.reduce((s, c) => s + c.amount, 0),
        ytdAmount: active.filter((c) => c.claimDate.getFullYear() === year).reduce((s, c) => s + c.amount, 0),
        // 45-b: snapshot limit = kalkulasi validasi (raw); tampilannya di-mask
        // di batas route saat vault tertutup (field uang → null, shape tetap).
        usage: usage ? maskUsageForDisplay(usage, mv) : null,
      };
    }));
    return NextResponse.json({ types: result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/benefit-types — jenis benefit baru.
// T1-SECURITY: guard hak AKSI menu payroll:benefits (Baru) — master benefit
// diedit dari view Benefit Karyawan, jadi ikut izin menu itu.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:benefits", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code?.trim() || !b.name?.trim()) return NextResponse.json({ error: "Kode & nama wajib diisi" }, { status: 400 });
    const code = b.code.trim().toUpperCase();
    if (await db.benefitType.findUnique({ where: { code } })) {
      return NextResponse.json({ error: `Kode ${code} sudah dipakai` }, { status: 400 });
    }
    const payInPayroll = Boolean(b.payInPayroll ?? true);
    if (payInPayroll && !b.wageComponentId) {
      return NextResponse.json({ error: "Benefit pay-in-payroll wajib memetakan komponen upah (tampil di payslip)" }, { status: 400 });
    }
    if (b.wageComponentId && !(await db.wageComponent.findUnique({ where: { id: b.wageComponentId } }))) {
      return NextResponse.json({ error: "Komponen upah tidak ditemukan" }, { status: 404 });
    }
    const resetPeriod = RESET.includes(b.resetPeriod) ? b.resetPeriod : "Monthly";
    const type = await db.benefitType.create({
      data: {
        code,
        name: b.name.trim(),
        category: b.category?.trim() || "Umum",
        description: b.description?.trim() || null,
        resetPeriod,
        maxClaimAmount: Number(b.maxClaimAmount ?? 0),
        unlimited: Boolean(b.unlimited),
        allowOverlimit: Boolean(b.allowOverlimit),
        needDocuments: Boolean(b.needDocuments),
        autoApproveInLimit: Boolean(b.autoApproveInLimit ?? true),
        payInPayroll,
        wageComponentId: b.wageComponentId ?? null,
        entitleFor: b.entitleFor ?? "All",
      },
      include: { wageComponent: { select: { code: true, name: true } } },
    });
    await db.activityLog.create({
      data: { action: "Created", entity: "BenefitType", entityId: type.id, detail: `Jenis benefit ${type.code} — ${type.name}` },
    });
    return NextResponse.json({ type }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/rekankerja/benefit-types — ubah master.
// T1-SECURITY: guard hak AKSI menu payroll:benefits (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:benefits", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.benefitType.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Jenis benefit tidak ditemukan" }, { status: 404 });
    if (b.wageComponentId && !(await db.wageComponent.findUnique({ where: { id: b.wageComponentId } }))) {
      return NextResponse.json({ error: "Komponen upah tidak ditemukan" }, { status: 404 });
    }
    const payInPayroll = b.payInPayroll ?? existing.payInPayroll;
    const wageComponentId = b.wageComponentId ?? existing.wageComponentId;
    if (payInPayroll && !wageComponentId) {
      return NextResponse.json({ error: "Benefit pay-in-payroll wajib memetakan komponen upah" }, { status: 400 });
    }
    const type = await db.benefitType.update({
      where: { id: b.id },
      data: {
        name: b.name?.trim() ?? existing.name,
        category: b.category?.trim() ?? existing.category,
        description: b.description !== undefined ? (b.description?.trim() || null) : existing.description,
        resetPeriod: RESET.includes(b.resetPeriod) ? b.resetPeriod : existing.resetPeriod,
        maxClaimAmount: b.maxClaimAmount !== undefined ? Number(b.maxClaimAmount) : existing.maxClaimAmount,
        unlimited: b.unlimited ?? existing.unlimited,
        allowOverlimit: b.allowOverlimit ?? existing.allowOverlimit,
        needDocuments: b.needDocuments ?? existing.needDocuments,
        autoApproveInLimit: b.autoApproveInLimit ?? existing.autoApproveInLimit,
        payInPayroll,
        wageComponentId: b.wageComponentId !== undefined ? (b.wageComponentId || null) : existing.wageComponentId,
        entitleFor: b.entitleFor ?? existing.entitleFor,
        active: b.active ?? existing.active,
      },
      include: { wageComponent: { select: { code: true, name: true } } },
    });
    return NextResponse.json({ type });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/rekankerja/benefit-types?id= — guard: dipakai klaim.
// T1-SECURITY: guard hak AKSI menu payroll:benefits (Hapus).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:benefits", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const count = await db.benefitClaim.count({ where: { benefitTypeId: id } });
    if (count > 0) {
      return NextResponse.json({ error: `Tidak dapat dihapus — dipakai ${count} klaim. Nonaktifkan saja.` }, { status: 400 });
    }
    await db.benefitType.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
