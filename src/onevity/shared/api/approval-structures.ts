import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { buildApprovalChain, APPROVAL_DOC_TYPES, isAmountDocType } from "@/onevity/shared/services/approval-engine";

// ============ APPROVAL STRUKTUR BERJENJANG (Task 25) ============
// Setup alur persetujuan multi-level per modul dokumen (Leave/Travel/Medical/
// Loan) dengan 6 kriteria penempatan pemohon + tier nominal untuk
// Travel/Medical/Loan. GET mendukung simulasi (?action=preview).

const VALID_APPROVER_TYPES = ["ATASAN_LANGSUNG", "ATASAN_BERJENJANG", "POSISI", "KARYAWAN", "HR_ADMIN"];

interface LevelInput {
  approverType?: string;
  approverPositionId?: string | null;
  approverEmployeeId?: string | null;
  superiorLevel?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  note?: string | null;
}

interface NormalizedLevel {
  levelNo: number;
  approverType: string;
  approverPositionId: string | null;
  approverEmployeeId: string | null;
  superiorLevel: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  note: string | null;
}

/** Validasi & normalisasi jenjang. */
function normalizeLevels(docType: string, raw: LevelInput[]): { levels: NormalizedLevel[]; error?: string } {
  const levels: NormalizedLevel[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i] ?? {};
    const approverType = String(l.approverType ?? "");
    if (!VALID_APPROVER_TYPES.includes(approverType)) {
      return { levels, error: `Jenjang ${i + 1}: tipe approver tidak dikenal` };
    }
    if (approverType === "POSISI" && !l.approverPositionId) {
      return { levels, error: `Jenjang ${i + 1}: pilih posisi approver` };
    }
    if (approverType === "KARYAWAN" && !l.approverEmployeeId) {
      return { levels, error: `Jenjang ${i + 1}: pilih karyawan approver` };
    }
    if (approverType === "ATASAN_BERJENJANG" && (!l.superiorLevel || Number(l.superiorLevel) < 1)) {
      return { levels, error: `Jenjang ${i + 1}: tingkat atasan minimal 1` };
    }
    let minAmount: number | null = l.minAmount != null && l.minAmount !== ("" as unknown) ? Number(l.minAmount) : null;
    let maxAmount: number | null = l.maxAmount != null && l.maxAmount !== ("" as unknown) ? Number(l.maxAmount) : null;
    if (!isAmountDocType(docType)) { minAmount = null; maxAmount = null; } // nominal hanya untuk Travel/Medical/Loan
    if (minAmount != null && minAmount < 0) return { levels, error: `Jenjang ${i + 1}: nominal minimum tidak boleh negatif` };
    if (maxAmount != null && maxAmount < 0) return { levels, error: `Jenjang ${i + 1}: nominal maksimum tidak boleh negatif` };
    if (minAmount != null && maxAmount != null && maxAmount < minAmount) {
      return { levels, error: `Jenjang ${i + 1}: nominal maksimum < minimum` };
    }
    levels.push({
      levelNo: i + 1,
      approverType,
      approverPositionId: approverType === "POSISI" ? (l.approverPositionId ?? null) : null,
      approverEmployeeId: approverType === "KARYAWAN" ? (l.approverEmployeeId ?? null) : null,
      superiorLevel: approverType === "ATASAN_BERJENJANG" ? Number(l.superiorLevel ?? 1) : null,
      minAmount, maxAmount,
      note: l.note ? String(l.note) : null,
    });
  }
  return { levels };
}

// GET /api/onevity/approval-structures?docType=
// GET /api/onevity/approval-structures?action=preview&employeeId=&docType=&amount=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;

    // ---- simulasi jalur untuk seorang pemohon ----
    if (sp.get("action") === "preview") {
      const employeeId = sp.get("employeeId");
      const docType = sp.get("docType") ?? "";
      if (!employeeId) return NextResponse.json({ error: "employeeId wajib untuk simulasi" }, { status: 400 });
      if (!(APPROVAL_DOC_TYPES as readonly string[]).includes(docType)) {
        return NextResponse.json({ error: "docType tidak valid" }, { status: 400 });
      }
      const amountRaw = sp.get("amount");
      const amount = amountRaw != null && amountRaw !== "" && !isNaN(Number(amountRaw)) ? Number(amountRaw) : null;
      const built = await buildApprovalChain(db, employeeId, docType, amount);
      const params = built; // structureCode/structureName/fallback/steps
      return NextResponse.json({ preview: params });
    }

    // ---- daftar struktur + relasi bernama ----
    const docType = sp.get("docType");
    const structures = await db.approvalStructure.findMany({
      where: docType && docType !== "all" ? { docType } : undefined,
      include: {
        companyOffice: { select: { code: true, name: true } },
        workLocation: { select: { code: true, name: true } },
        orgUnit: { select: { code: true, name: true } },
        position: { select: { code: true, title: true } },
        grade: { select: { code: true, name: true } },
        positionLevel: { select: { code: true, name: true } },
        levels: {
          include: {
            approverPosition: { select: { code: true, title: true } },
            approverEmployee: { select: { employeeNo: true, fullName: true } },
          },
          orderBy: { levelNo: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      structures: structures.map((s) => ({
        id: s.id, code: s.code, name: s.name, docType: s.docType, active: s.active,
        companyOfficeId: s.companyOfficeId, companyOffice: s.companyOffice,
        workLocationId: s.workLocationId, workLocation: s.workLocation,
        orgUnitId: s.orgUnitId, orgUnit: s.orgUnit,
        positionId: s.positionId, position: s.position,
        gradeId: s.gradeId, grade: s.grade,
        positionLevelId: s.positionLevelId, positionLevel: s.positionLevel,
        levels: s.levels.map((l) => ({
          id: l.id, levelNo: l.levelNo, approverType: l.approverType,
          approverPositionId: l.approverPositionId,
          approverPosition: l.approverPosition ? `${l.approverPosition.title} (${l.approverPosition.code})` : null,
          approverEmployeeId: l.approverEmployeeId,
          approverEmployee: l.approverEmployee ? `${l.approverEmployee.fullName} (${l.approverEmployee.employeeNo})` : null,
          superiorLevel: l.superiorLevel, minAmount: l.minAmount, maxAmount: l.maxAmount, note: l.note,
        })),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/approval-structures { code, name, docType, kriteria…, levels[] }
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama struktur wajib diisi" }, { status: 400 });
    if (!(APPROVAL_DOC_TYPES as readonly string[]).includes(b.docType)) {
      return NextResponse.json({ error: "Jenis dokumen tidak valid (Leave|Travel|Medical|Loan)" }, { status: 400 });
    }
    const exists = await db.approvalStructure.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode struktur ${b.code} sudah dipakai` }, { status: 400 });
    if (!Array.isArray(b.levels) || b.levels.length === 0) {
      return NextResponse.json({ error: "Minimal 1 jenjang approver" }, { status: 400 });
    }
    const { levels, error } = normalizeLevels(b.docType, b.levels);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const s = await db.approvalStructure.create({
      data: {
        code: b.code, name: b.name, docType: b.docType,
        companyOfficeId: b.companyOfficeId || null,
        workLocationId: b.workLocationId || null,
        orgUnitId: b.orgUnitId || null,
        positionId: b.positionId || null,
        gradeId: b.gradeId || null,
        positionLevelId: b.positionLevelId || null,
        active: b.active !== false,
        levels: { create: levels },
      },
    });
    await db.activityLog.create({
      data: { action: "Created", entity: "ApprovalStructure", entityId: s.id, detail: `Struktur approval ${s.code} (${s.docType}) — ${levels.length} jenjang` },
    });
    return NextResponse.json({ structure: s }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/approval-structures?id= — update field + ganti jenjang
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    const b = await req.json();
    if (!id && !b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const structId = id ?? b.id;
    const cur = await db.approvalStructure.findUnique({ where: { id: structId } });
    if (!cur) return NextResponse.json({ error: "Struktur tidak ditemukan" }, { status: 404 });

    const docType = b.docType ?? cur.docType;
    if (!(APPROVAL_DOC_TYPES as readonly string[]).includes(docType)) {
      return NextResponse.json({ error: "Jenis dokumen tidak valid" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (b.name) data.name = String(b.name);
    if (b.code && b.code !== cur.code) {
      const clash = await db.approvalStructure.findUnique({ where: { code: b.code } });
      if (clash) return NextResponse.json({ error: `Kode struktur ${b.code} sudah dipakai` }, { status: 400 });
      data.code = String(b.code);
    }
    if (b.docType != null) data.docType = docType;
    for (const f of ["companyOfficeId", "workLocationId", "orgUnitId", "positionId", "gradeId", "positionLevelId"] as const) {
      if (b[f] !== undefined) data[f] = b[f] || null;
    }
    if (b.active != null) data.active = !!b.active;

    // ganti jenjang (delete + recreate) bila dikirim
    if (Array.isArray(b.levels)) {
      if (b.levels.length === 0) return NextResponse.json({ error: "Minimal 1 jenjang approver" }, { status: 400 });
      const { levels, error } = normalizeLevels(docType, b.levels);
      if (error) return NextResponse.json({ error }, { status: 400 });
      data.levels = { deleteMany: {}, create: levels };
    }

    const s = await db.approvalStructure.update({ where: { id: structId }, data });
    await db.activityLog.create({
      data: { action: "Updated", entity: "ApprovalStructure", entityId: structId, detail: `Struktur approval ${s.code} diperbarui` },
    });
    return NextResponse.json({ structure: s });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/approval-structures?id=
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const cur = await db.approvalStructure.findUnique({ where: { id }, select: { code: true, chains: { take: 1, select: { id: true } } } });
    if (!cur) return NextResponse.json({ error: "Struktur tidak ditemukan" }, { status: 404 });
    if (cur.chains.length > 0) {
      // chain runtime memakai struktur ini — jalur historis tetap utuh bila struktur
      // hanya di-nonaktifkan; penghapusan fisik ditolak agar jejak tetap terbaca.
      return NextResponse.json({ error: `Struktur ${cur.code} dipakai riwayat persetujuan — nonaktifkan saja` }, { status: 400 });
    }
    await db.approvalStructure.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "ApprovalStructure", entityId: id, detail: `Struktur approval ${cur.code} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
