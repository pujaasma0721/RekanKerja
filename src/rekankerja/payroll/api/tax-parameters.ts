import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { PTKP_ANNUAL } from "@/rekankerja/payroll/services/payroll-engine";

// GET /api/rekankerja/tax-parameters — bracket + TER + regulasi aktif + PTKP referensi
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const [brackets, ter, regulation] = await Promise.all([
      db.taxBracket.findMany({ where: { bracketType: "Income" }, orderBy: { lowerLimit: "asc" } }),
      db.terRate.findMany({ orderBy: [{ category: "asc" }, { lowerLimit: "asc" }] }),
      db.payrollRegulation.findFirst({ where: { active: true }, orderBy: { validFrom: "desc" } }),
    ]);
    return NextResponse.json({ brackets, ter, regulation, ptkp: PTKP_ANNUAL });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/rekankerja/tax-parameters — update parameter regulasi (BPJS, biaya jabatan, TER)
// T1-SECURITY: guard hak AKSI menu payroll:parameters (Ubah) — VIEWER/di luar
// izin tidak bisa mengubah parameter pajak lagi (temuan audit pay-2).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:parameters", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const regulation = await db.payrollRegulation.findFirst({ where: { active: true }, orderBy: { validFrom: "desc" } });
    if (!regulation) return NextResponse.json({ error: "Regulasi aktif tidak ditemukan" }, { status: 404 });

    const num = (v: unknown) => (v == null ? undefined : Number(v));

    // P2.1-BM (D-BM16) — identitas cabang BPJS tenant untuk file LKS resmi:
    // KODE KANTOR (LKS BPJS Ketenagakerjaan) & KELAS PERAWATAN 1|2|3 (LKS
    // JKN "Data Peserta"). Null/kosong = belum dikonfigurasi → kolom file
    // LKS dibiarkan kosong (advisori, TIDAK memblokir ekspor).
    let bpjsOfficeCode: string | null | undefined;
    if (b.bpjsOfficeCode !== undefined) {
      const v = b.bpjsOfficeCode == null ? "" : String(b.bpjsOfficeCode).trim();
      if (v.length > 10) {
        return NextResponse.json({ error: "Kode kantor cabang BPJS maksimal 10 karakter" }, { status: 400 });
      }
      bpjsOfficeCode = v === "" ? null : v;
    }
    let bpjsInpatientClass: string | null | undefined;
    if (b.bpjsInpatientClass !== undefined) {
      const v = b.bpjsInpatientClass == null ? "" : String(b.bpjsInpatientClass).trim();
      if (v !== "" && !["1", "2", "3"].includes(v)) {
        return NextResponse.json({ error: "Kelas rawat inap BPJS harus salah satu dari: 1, 2, atau 3" }, { status: 400 });
      }
      bpjsInpatientClass = v === "" ? null : v;
    }

    const updated = await db.payrollRegulation.update({
      where: { id: regulation.id },
      data: {
        biayaJabatanRate: num(b.biayaJabatanRate),
        biayaJabatanCapMonthly: num(b.biayaJabatanCapMonthly),
        jhtEmployeeRate: num(b.jhtEmployeeRate),
        jhtCompanyRate: num(b.jhtCompanyRate),
        jpEmployeeRate: num(b.jpEmployeeRate),
        jpCompanyRate: num(b.jpCompanyRate),
        jpSalaryCap: num(b.jpSalaryCap),
        jkkRate: num(b.jkkRate),
        jkmRate: num(b.jkmRate),
        jpkCompanyRate: num(b.jpkCompanyRate),
        jpkEmployeeRate: num(b.jpkEmployeeRate),
        jpkSalaryCap: num(b.jpkSalaryCap),
        // Task 52-c — parameter JKP (PP 6/2025).
        jkpCompanyRate: num(b.jkpCompanyRate),
        jkpEmployeeRate: num(b.jkpEmployeeRate),
        jkpSalaryCap: num(b.jkpSalaryCap),
        nonNpwpSurcharge: num(b.nonNpwpSurcharge),
        useTer: b.useTer,
        // P2.1-BM (D-BM16) — undefined = tidak dikirim → Prisma skip (pola num()).
        bpjsOfficeCode,
        bpjsInpatientClass,
      },
    });
    // ActivityLog — sertakan perubahan identitas LKS bila dikirim (jejak
    // mutasi konfigurasi file resmi BPJS).
    const lksChanged = [
      bpjsOfficeCode !== undefined ? `KODE KANTOR=${updated.bpjsOfficeCode ?? "—"}` : null,
      bpjsInpatientClass !== undefined ? `KELAS RAWAT INAP=${updated.bpjsInpatientClass ?? "—"}` : null,
    ].filter(Boolean).join(", ");
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "PayrollRegulation", entityId: regulation.id,
        detail: `Parameter regulasi ${regulation.code} diperbarui (useTer=${updated.useTer}${lksChanged ? `; ${lksChanged}` : ""})`,
      },
    });
    return NextResponse.json({ regulation: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
