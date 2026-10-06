import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import {
  computeNonEmployeeTax, ledgerOfPayments, taxPeriodOf, canTransition, nextDocNo,
} from "@/rekankerja/payroll/services/non-employee-payment-service";

// RekanKerja — API PEMBAYARAN BUKAN PEGAWAI (PMK 168/2023)
// GET    /api/rekankerja/non-employee-payments?tab=payments|partners|ledger&year=&month=&status=&q=
//        &export=csv&year=&month=  → CSV kertas kerja bukti potong per masa pajak
// POST   { op: "partner" | "payment", ... }
// PATCH  { op: "partner", ... } | { id, status?, grossAmount?, excludedNotes?, description?, paymentDate? }
// DELETE ?partnerId=  — hanya mitra TANPA pembayaran (payment di-cancel, tidak dihapus — jejak audit pajak)

const MENU_KEY = "payroll:non-employee";

// GET /api/rekankerja/non-employee-payments
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const tab = sp.get("tab") ?? "payments";
    const q = sp.get("q")?.trim();
    const status = sp.get("status");
    const year = sp.get("year") ? Number(sp.get("year")) : null;
    const month = sp.get("month") ? Number(sp.get("month")) : null;
    const mv = await moneyViewForReq(req, db);

    // ---- Ekspor CSV kertas kerja bukti potong (Paid saja — final) ----
    if (sp.get("export") === "csv") {
      // bukti potong = artefak pajak → boleh juga dibuka pemegang menu SPT
      const m = await requireMenuViewAny(req, [MENU_KEY, "payroll:spt"]);
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const rows = await db.nonEmployeePayment.findMany({
        where: {
          status: "Paid",
          ...(year ? { taxYear: year } : {}),
          ...(month ? { taxMonth: month } : {}),
        },
        // idNumber (PII terenkripsi) ikut di-select — HANYA utk masking 4 digit terakhir.
        include: { partner: { select: { code: true, name: true, idType: true, idNumber: true, serviceKind: true } } },
        orderBy: [{ taxYear: "desc" }, { taxMonth: "desc" }, { docNo: "asc" }],
      });
      const tc = tenantCryptoForDb(db);
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = [
        ["DokNo", "Tanggal Bayar", "Masa Pajak", "Kode Mitra", "Nama Mitra", "Jenis Id", "Nomor Id (mask)", "Jenis Jasa", "Uraian", "Bruto", "Dikeluarkan (12(4)b)", "DPP (50%)", "PPh21 Dipotong", "Neto"].join(";"),
        ...rows.map((r) => {
          const idNum = tc.decryptText(r.partner.idNumber) ?? "";
          const masked = idNum ? `${"*".repeat(Math.max(0, idNum.length - 4))}${idNum.slice(-4)}` : "-";
          const excl = r.excludedAmount ? (mv.dec0(r.excludedAmount) || 0) : 0;
          return [
            esc(r.docNo), r.paymentDate.toISOString().slice(0, 10), `${r.taxMonth}/${r.taxYear}`,
            esc(r.partner.code), esc(r.partner.name), r.partner.idType, masked, esc(r.partner.serviceKind),
            esc(r.description),
            String(mv.dec0(r.grossAmount)), String(excl), String(mv.dec0(r.dpp)), String(mv.dec0(r.pph21)), String(mv.dec0(r.netAmount)),
          ].join(";");
        }),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bupot-bukan-pegawai-${year ?? "all"}${month ? `-${month}` : ""}.csv"` },
      });
    }

    // ---- Tab pembayaran ----
    if (tab === "payments") {
      const payments = await db.nonEmployeePayment.findMany({
        where: {
          ...(status && status !== "all" ? { status } : {}),
          ...(year ? { taxYear: year } : {}),
          ...(month ? { taxMonth: month } : {}),
          ...(q ? { OR: [{ docNo: { contains: q } }, { description: { contains: q } }, { partner: { name: { contains: q } } }, { partner: { code: { contains: q } } }] } : {}),
        },
        include: { partner: { select: { code: true, name: true, serviceKind: true } } },
        orderBy: [{ paymentDate: "desc" }, { docNo: "desc" }],
        take: 500,
      });
      const partners = await db.nonEmployeePartner.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, isCatering: true } });
      const years = await db.nonEmployeePayment.findMany({ select: { taxYear: true }, distinct: ["taxYear"] });
      return NextResponse.json(mv.json({
        payments,
        partners,
        years: years.map((y) => y.taxYear).sort((a, b) => b - a),
      }));
    }

    // ---- Tab mitra (identitas PII terenkripsi — dekripsi teks mengikuti money-view) ----
    if (tab === "partners") {
      const partners = await db.nonEmployeePartner.findMany({
        where: q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { serviceKind: { contains: q } }] } : {},
        include: { _count: { select: { payments: true } } },
        orderBy: { name: "asc" },
      });
      return NextResponse.json(mv.json({ partners }));
    }

    // ---- Tab ledger bukti potong per masa pajak (status Paid = final) ----
    const rows = await db.nonEmployeePayment.findMany({
      where: { status: "Paid", ...(year ? { taxYear: year } : {}) },
      select: { taxYear: true, taxMonth: true, grossAmount: true, dpp: true, pph21: true, netAmount: true, docNo: true, paymentDate: true, description: true, partner: { select: { code: true, name: true, serviceKind: true } } },
      orderBy: [{ taxMonth: "desc" }, { docNo: "asc" }],
    });
    const tc = tenantCryptoForDb(db);
    const dec = rows.map((r) => ({
      taxYear: r.taxYear, taxMonth: r.taxMonth,
      gross: mv.dec0(r.grossAmount), dpp: mv.dec0(r.dpp),
      pph21: mv.dec0(r.pph21), net: mv.dec0(r.netAmount),
      docNo: r.docNo, paymentDate: r.paymentDate, description: r.description, partner: r.partner,
    }));
    const ledger = ledgerOfPayments(dec);
    return NextResponse.json({
      ledger,
      years: [...new Set(dec.map((r) => r.taxYear))].sort((a, b) => b - a),
      details: mv.json(dec),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/non-employee-payments — { op: "partner" | "payment", ... }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const op = b.op ?? "payment";

    // ---- master mitra (guard khusus op:partner — menu baru, role CUSTOM lama aman) ----
    if (op === "partner") {
      const m = await requireMenuAction(req, MENU_KEY, "op:partner");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;
      if (!b.code?.trim() || !b.name?.trim()) return NextResponse.json({ error: "Kode dan nama mitra wajib diisi" }, { status: 400 });
      const exists = await db.nonEmployeePartner.findUnique({ where: { code: b.code.trim() } });
      if (exists) return NextResponse.json({ error: `Kode mitra ${b.code} sudah dipakai` }, { status: 400 });
      const tc = tenantCryptoForDb(db);
      const partner = await db.nonEmployeePartner.create({
        data: {
          code: b.code.trim(), name: b.name.trim(),
          idType: ["npwp", "nik", "none"].includes(b.idType) ? b.idType : "npwp",
          idNumber: b.idNumber ? tc.encryptText(String(b.idNumber).trim()) : null,
          address: b.address || null,
          serviceKind: b.serviceKind?.trim() || "Pekerjaan Bebas",
          isCatering: !!b.isCatering,
          bankName: b.bankName || null, bankAccount: b.bankAccount || null,
          notes: b.notes || null,
        },
      });
      await db.activityLog.create({ data: { action: "Created", entity: "NonEmployeePartner", entityId: partner.id, detail: `Mitra Bukan Pegawai ${partner.name} (${partner.code}) dibuat` } });
      return NextResponse.json({ partner: { ...partner, idNumber: undefined } }, { status: 201 });
    }

    // ---- pembayaran (PPh21 dihitung server — nilai dari client TIDAK dipercaya) ----
    const m = await requireMenuAction(req, MENU_KEY, "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    if (!b.partnerId || !b.description?.trim() || !b.paymentDate) {
      return NextResponse.json({ error: "Mitra, uraian, dan tanggal bayar wajib diisi" }, { status: 400 });
    }
    const gross = Number(b.grossAmount);
    if (!Number.isFinite(gross) || gross <= 0) return NextResponse.json({ error: "Penghasilan bruto harus angka > 0" }, { status: 400 });
    const excludedAmount = b.excludedAmount == null ? 0 : Number(b.excludedAmount);
    if (!Number.isFinite(excludedAmount) || excludedAmount < 0) return NextResponse.json({ error: "Komponen dikeluarkan harus angka ≥ 0" }, { status: 400 });
    if (excludedAmount > gross) return NextResponse.json({ error: "Komponen dikeluarkan tidak boleh melebihi penghasilan bruto (Pasal 12(4)(b))" }, { status: 400 });
    const partner = await db.nonEmployeePartner.findUnique({ where: { id: b.partnerId } });
    if (!partner) return NextResponse.json({ error: "Mitra tidak ditemukan" }, { status: 404 });
    if (partner.isCatering && excludedAmount > 0) {
      return NextResponse.json({ error: "Jasa katering: bruto = seluruh jumlah penghasilan — komponen tenaga kerja/material tidak boleh dikeluarkan (Pasal 12(4)(a) PMK 168/2023)" }, { status: 400 });
    }

    const paymentDate = new Date(b.paymentDate);
    const { year, month } = taxPeriodOf(paymentDate);
    const brackets = await db.taxBracket.findMany({ where: { bracketType: "Income", OR: [{ validTo: null }, { validTo: { gte: paymentDate } }] } });
    // Tarif mengikuti identitas mitra (PII terenkripsi):
    // · NPWP 15/16 digit → tarif NPWP
    // · NIK 16 digit → tarif NPWP — UU HPP & PMK 66/2023: NIK penduduk = NPWP
    // · selainnya (tanpa identitas / format tidak valid) → surcharge ×120%
    const tc = tenantCryptoForDb(db);
    const idDigits = (tc.decryptText(partner.idNumber) ?? "").replace(/[^0-9]/g, "");
    const hasNpwp = partner.idType === "npwp" ? idDigits.length >= 15 : partner.idType === "nik" && idDigits.length === 16;
    const calc = computeNonEmployeeTax(gross, { brackets, hasNpwp, isCatering: partner.isCatering }, b.excludedNotes ?? null, excludedAmount);
    const docNo = await nextDocNo(db, year);

    const payment = await db.nonEmployeePayment.create({
      data: {
        docNo, partnerId: partner.id, description: b.description.trim(),
        // M-8: kolom uang NOT NULL (String) — encryptMoney non-null (null → "0" terenkripsi).
        grossAmount: tc.encryptMoney(calc.gross) ?? "0", excludedNotes: calc.excludedNotes || null,
        excludedAmount: calc.excluded > 0 ? (tc.encryptMoney(calc.excluded) ?? "0") : null,
        dpp: tc.encryptMoney(calc.dpp) ?? "0", pph21: tc.encryptMoney(calc.pph21) ?? "0", netAmount: tc.encryptMoney(calc.net) ?? "0",
        paymentDate, taxYear: year, taxMonth: month,
        status: b.status === "Paid" ? "Paid" : "Draft",
        paidAt: b.status === "Paid" ? new Date() : null,
        createdBy: m.actor?.name ?? null,
      },
      include: { partner: { select: { code: true, name: true, serviceKind: true } } },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "NonEmployeePayment", entityId: payment.id, detail: `Pembayaran Bukan Pegawai ${docNo} — ${partner.name}, PPh21 dipotong (PMK 168/2023)` } });
    // 45-b: gate vault (aktor guard) — nilai uang dalam balikan mengikuti money-view.
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    return NextResponse.json(mv.json({ payment }), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/rekankerja/non-employee-payments
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();

    if (b.op === "partner") {
      const m = await requireMenuAction(req, MENU_KEY, "op:partner");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;
      if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
      const tc = tenantCryptoForDb(db);
      const partner = await db.nonEmployeePartner.update({
        where: { id: b.id },
        data: {
          ...(b.name != null ? { name: String(b.name).trim() } : {}),
          ...(b.idType != null && ["npwp", "nik", "none"].includes(b.idType) ? { idType: b.idType } : {}),
          ...(b.idNumber !== undefined ? { idNumber: b.idNumber ? tc.encryptText(String(b.idNumber).trim()) : null } : {}),
          ...(b.address !== undefined ? { address: b.address || null } : {}),
          ...(b.serviceKind != null ? { serviceKind: String(b.serviceKind).trim() } : {}),
          ...(b.isCatering != null ? { isCatering: !!b.isCatering } : {}),
          ...(b.bankName !== undefined ? { bankName: b.bankName || null } : {}),
          ...(b.bankAccount !== undefined ? { bankAccount: b.bankAccount || null } : {}),
          ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
          ...(b.active != null ? { active: !!b.active } : {}),
        },
      });
      return NextResponse.json({ partner: { ...partner, idNumber: undefined } });
    }

    const m = await requireMenuAction(req, MENU_KEY, "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.nonEmployeePayment.findUnique({ where: { id: b.id }, include: { partner: true } });
    if (!existing) return NextResponse.json({ error: "Pembayaran tidak ditemukan" }, { status: 404 });

    // transisi status (Paid = final — hanya boleh ke Cancelled)
    if (b.status && b.status !== existing.status && !canTransition(existing.status, b.status)) {
      return NextResponse.json({ error: `Transisi status ${existing.status} → ${b.status} tidak diizinkan (pembayaran final hanya dapat dibatalkan)` }, { status: 400 });
    }

    const tc = tenantCryptoForDb(db);

    // Paid = final → tidak boleh ubah nilai (jejak pajak); hanya status ke Cancelled
    if (existing.status === "Paid") {
      if (b.status && b.status !== "Cancelled" && b.status !== "Paid") {
        return NextResponse.json({ error: "Pembayaran final tidak dapat diubah — batalkan bila salah" }, { status: 400 });
      }
      const payment = await db.nonEmployeePayment.update({
        where: { id: b.id },
        data: b.status === "Cancelled" ? { status: "Cancelled" } : {},
      });
      const mvF = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
      return NextResponse.json(mvF.json({ payment }));
    }

    // Draft: ubah deskripsi/tanggal → recompute pajak bila bruto/tanggal/mitra berubah
    const gross = b.grossAmount != null ? Number(b.grossAmount) : (tc.decryptMoney(existing.grossAmount) ?? 0);
    const excludedAmount = b.excludedAmount != null ? Number(b.excludedAmount) : (existing.excludedAmount ? (tc.decryptMoney(existing.excludedAmount) ?? 0) : 0);
    if (!Number.isFinite(excludedAmount) || excludedAmount < 0) return NextResponse.json({ error: "Komponen dikeluarkan harus angka ≥ 0" }, { status: 400 });
    if (excludedAmount > gross) return NextResponse.json({ error: "Komponen dikeluarkan tidak boleh melebihi penghasilan bruto (Pasal 12(4)(b))" }, { status: 400 });
    const paymentDate = b.paymentDate ? new Date(b.paymentDate) : existing.paymentDate;
    const partnerId = b.partnerId ?? existing.partnerId;
    const partner = partnerId === existing.partnerId ? existing.partner : await db.nonEmployeePartner.findUnique({ where: { id: partnerId } });
    if (!partner) return NextResponse.json({ error: "Mitra tidak ditemukan" }, { status: 404 });
    if (partner.isCatering && excludedAmount > 0) {
      return NextResponse.json({ error: "Jasa katering: bruto = seluruh jumlah penghasilan — komponen tenaga kerja/material tidak boleh dikeluarkan (Pasal 12(4)(a) PMK 168/2023)" }, { status: 400 });
    }
    const { year, month } = taxPeriodOf(paymentDate);
    const periodChanged = year !== existing.taxYear || month !== existing.taxMonth;
    const brackets = await db.taxBracket.findMany({ where: { bracketType: "Income", OR: [{ validTo: null }, { validTo: { gte: paymentDate } }] } });
    // NIK 16 digit = NPWP (UU HPP & PMK 66/2023) — lihat catatan POST di atas.
    const idDigits = (tc.decryptText(partner.idNumber) ?? "").replace(/[^0-9]/g, "");
    const hasNpwp = partner.idType === "npwp" ? idDigits.length >= 15 : partner.idType === "nik" && idDigits.length === 16;
    const calc = computeNonEmployeeTax(gross, { brackets, hasNpwp, isCatering: partner.isCatering }, b.excludedNotes ?? existing.excludedNotes, excludedAmount);

    const payment = await db.nonEmployeePayment.update({
      where: { id: b.id },
      data: {
        ...(b.description != null ? { description: String(b.description).trim() } : {}),
        ...(b.partnerId != null ? { partnerId } : {}),
        grossAmount: tc.encryptMoney(calc.gross) ?? "0",
        excludedNotes: calc.excludedNotes || null,
        excludedAmount: calc.excluded > 0 ? (tc.encryptMoney(calc.excluded) ?? "0") : null,
        dpp: tc.encryptMoney(calc.dpp) ?? "0", pph21: tc.encryptMoney(calc.pph21) ?? "0", netAmount: tc.encryptMoney(calc.net) ?? "0",
        paymentDate, taxYear: year, taxMonth: month,
        ...(b.status === "Paid" ? { status: "Paid", paidAt: new Date() } : b.status ? { status: b.status } : {}),
      },
      include: { partner: { select: { code: true, name: true, serviceKind: true } } },
    });
    if (periodChanged || b.status === "Paid") {
      await db.activityLog.create({ data: { action: "Updated", entity: "NonEmployeePayment", entityId: payment.id, detail: `Pembayaran ${payment.docNo} diperbarui — masa pajak ${month}/${year}${b.status === "Paid" ? ", ditandai dibayar" : ""}` } });
    }
    const mvD = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    return NextResponse.json(mvD.json({ payment }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/rekankerja/non-employee-payments?partnerId= — hapus MITRA tanpa pembayaran
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, MENU_KEY, "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const partnerId = req.nextUrl.searchParams.get("partnerId");
    if (!partnerId) return NextResponse.json({ error: "partnerId wajib — pembayaran hanya dapat dibatalkan (jejak pajak), bukan dihapus" }, { status: 400 });
    const used = await db.nonEmployeePayment.count({ where: { partnerId } });
    if (used > 0) return NextResponse.json({ error: `Mitra masih memiliki ${used} pembayaran — non-aktifkan saja (jejak bukti potong harus utuh)` }, { status: 400 });
    const partner = await db.nonEmployeePartner.delete({ where: { id: partnerId } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "NonEmployeePartner", entityId: partnerId, detail: `Mitra Bukan Pegawai ${partner.name} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
