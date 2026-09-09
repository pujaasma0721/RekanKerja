import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import {
  startApprovalChain, decideApprovalChain, getApprovalChain, attachChainSummaries, type ChainSummary,
} from "@/onevity/shared/services/approval-engine";
import { dispatchWebhookEvent } from "@/onevity/shared/services/webhook-service";

// ============ LOAN (Pinjaman Karyawan) — approval berjenjang (Task 25) ============
// POST   : buat pengajuan pinjaman (status Submitted) + jalur approval berjenjang
//          sesuai struktur Loan — jenjang nominal (jumlah pinjaman) menentukan
//          jenjang tambahan (mis. ≥ Rp 10 jt → HR Manager, ≥ Rp 100 jt → CEO).
// PATCH  : approve → putuskan jenjang; jenjang TERAKHIR membuat skedul cicilan +
//          status Active. reject/cancel → status Rejected/Cancelled tanpa cicilan.
//          PaidOff/Cancelled manual untuk pinjaman Active tetap didukung.
// Cicilan hanya digenerate setelah seluruh jenjang disetujui — pinjaman
// Submitted tidak dipotong payroll (engine memfilter status Active).

// GET /api/onevity/loans?employeeId=&status=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const status = req.nextUrl.searchParams.get("status");
    const loans = await db.employeeLoan.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(status && status !== "all" ? { status } : {}),
      },
      include: {
        employee: { select: { employeeNo: true, fullName: true } },
        installments: { orderBy: { sequence: "asc" } },
      },
      orderBy: { loanDate: "desc" },
    });
    const chainMap = await attachChainSummaries(db, "Loan", loans.map((l) => ({ id: l.id })));
    return NextResponse.json({
      loans: loans.map((l) => ({
        id: l.id, employeeId: l.employeeId, letterNo: l.letterNo, loanDate: l.loanDate,
        amount: l.amount, installmentCount: l.installmentCount, installmentAmount: l.installmentAmount,
        interestRate: l.interestRate, startPaymentDate: l.startPaymentDate, purpose: l.purpose,
        status: l.status, paidAmount: l.paidAmount, outstanding: l.outstanding,
        wageComponentCode: l.wageComponentCode,
        employee: l.employee,
        installments: l.installments,
        approval: chainMap.get(l.id) ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/loans — ajukan pinjaman (Submitted + jalur approval berjenjang)
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.employeeId || !b.letterNo || !b.amount || !b.installmentCount) {
      return NextResponse.json({ error: "Karyawan, no surat, jumlah pinjaman & jumlah cicilan wajib" }, { status: 400 });
    }
    const employee = await db.employee.findUnique({ where: { id: b.employeeId } });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    const exists = await db.employeeLoan.findUnique({ where: { letterNo: b.letterNo } });
    if (exists) return NextResponse.json({ error: `No surat ${b.letterNo} sudah dipakai` }, { status: 400 });

    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Jumlah pinjaman harus > 0" }, { status: 400 });
    const installmentCount = Math.max(1, Number(b.installmentCount));
    const interestRate = Number(b.interestRate ?? 0); // flat %/tahun
    const startPayment = b.startPaymentDate ? new Date(b.startPaymentDate) : new Date();

    // Total tagihan = pokok + bunga flat per bulan; cicilan rata (bulan terakhir penyeimbang).
    const months = installmentCount;
    const interestTotal = amount * (interestRate / 100) * (months / 12);
    const totalDue = amount + interestTotal;
    const per = Math.round(totalDue / months);

    // status Submitted — menunggu seluruh jenjang approval; cicilan dibuat saat approved.
    const loan = await db.employeeLoan.create({
      data: {
        employeeId: b.employeeId,
        letterNo: b.letterNo,
        loanDate: b.loanDate ? new Date(b.loanDate) : new Date(),
        amount,
        installmentCount,
        installmentAmount: per,
        interestRate,
        startPaymentDate: startPayment,
        purpose: b.purpose ?? null,
        status: "Submitted",
        paidAmount: 0,
        outstanding: totalDue,
        wageComponentCode: "LOAN",
      },
    });

    // jalur approval berjenjang — nominal = jumlah pinjaman (tier jenjang aktif)
    const chain = await startApprovalChain(db, {
      docType: "Loan", docId: loan.id, employeeId: b.employeeId,
      amount, createdBy: m.actor.name,
    });

    await db.activityLog.create({
      data: {
        action: "Created", entity: "EmployeeLoan", entityId: loan.id, employeeId: b.employeeId,
        detail: `Pengajuan pinjaman ${loan.letterNo} (${employee.fullName}): Rp ${amount.toLocaleString("id-ID")} × ${installmentCount}x — approval berjenjang ${chain.totalLevels} level (menunggu ${chain.steps[0]?.approverLabel ?? "approver"})`,
      },
    });

    // ===== Webhook (T41-M14) — loan.created, fire-and-forget, never-throw =====
    void (async () => {
      try {
        await dispatchWebhookEvent(db, null, "loan.created", {
          docNo: loan.letterNo,
          employeeId: loan.employeeId,
          employeeName: employee.fullName,
          employeeNo: employee.employeeNo,
          amount,
          installmentCount,
          installmentAmount: per,
          interestRate,
          startPaymentDate: startPayment.toISOString().slice(0, 10),
          purpose: loan.purpose,
          status: loan.status,
          approvalLevels: chain.totalLevels,
          source: "app",
        });
      } catch { /* webhook tidak boleh mengganggu proses utama */ }
    })();

    return NextResponse.json({ loan, approval: { levels: chain.totalLevels, firstApprover: chain.steps[0]?.approverLabel ?? null } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/loans — keputusan approval (approve|reject) atau status manual
// (PaidOff|Cancelled) untuk pinjaman Active.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const loan = await db.employeeLoan.findUnique({ where: { id: b.id }, include: { installments: true } });
    if (!loan) return NextResponse.json({ error: "Pinjaman tidak ditemukan" }, { status: 404 });

    // ==== alur approval berjenjang (pinjaman Submitted) ====
    if (loan.status === "Submitted") {
      if (!["approve", "reject", "cancel"].includes(b.action)) {
        return NextResponse.json({ error: "Pinjaman menunggu persetujuan — aksi wajib approve|reject|cancel" }, { status: 400 });
      }
      let chain = await getApprovalChain(db, "Loan", loan.id);
      if (!chain) {
        chain = await startApprovalChain(db, { docType: "Loan", docId: loan.id, employeeId: loan.employeeId, amount: loan.amount, createdBy: "legacy-backfill" });
      }
      const res = await decideApprovalChain(db, {
        docType: "Loan", docId: loan.id, action: b.action, note: b.note,
        actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
      });

      if (b.action !== "approve") {
        const to = b.action === "reject" ? "Rejected" : "Cancelled";
        const updated = await db.employeeLoan.update({ where: { id: loan.id }, data: { status: to } });
        await db.activityLog.create({
          data: { action: to, entity: "EmployeeLoan", entityId: loan.id, employeeId: loan.employeeId, detail: `Pinjaman ${loan.letterNo} → ${to} di jenjang ${chain.currentLevel}${b.note ? ` — ${b.note}` : ""}` },
        });
        return NextResponse.json({ loan: updated });
      }

      if (!res.final) {
        // jenjang menengah — pinjaman tetap Submitted
        const currentStep = res.chain.steps.find((s) => s.status === "Current");
        await db.activityLog.create({
          data: { action: "Approved", entity: "EmployeeLoan", entityId: loan.id, employeeId: loan.employeeId, detail: `Pinjaman ${loan.letterNo}: jenjang ${chain.currentLevel}/${chain.totalLevels} disetujui — menunggu ${currentStep?.approverLabel ?? "jenjang berikutnya"}` },
        });
        return NextResponse.json({
          loan,
          approval: { currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels, currentApprover: currentStep?.approverLabel ?? null },
        });
      }

      // jenjang terakhir → generate skedul cicilan + status Active
      const months = loan.installmentCount;
      const totalDue = loan.amount + loan.amount * (loan.interestRate / 100) * (months / 12);
      const per = Math.round(totalDue / months);
      const installments = Array.from({ length: months }, (_, i) => {
        const due = new Date(loan.startPaymentDate);
        due.setMonth(due.getMonth() + i);
        return { sequence: i + 1, dueDate: due, amount: i === months - 1 ? totalDue - per * (months - 1) : per };
      });
      const updated = await db.employeeLoan.update({
        where: { id: loan.id },
        data: { status: "Active", installments: { create: installments } },
        include: { installments: { orderBy: { sequence: "asc" } } },
      });
      await db.activityLog.create({
        data: { action: "Approved", entity: "EmployeeLoan", entityId: loan.id, employeeId: loan.employeeId, detail: `Pinjaman ${loan.letterNo} disetujui penuh (${chain.totalLevels} jenjang) — skedul ${months}x cicilan dibuat` },
      });
      return NextResponse.json({ loan: updated, approval: { final: true, totalLevels: chain.totalLevels } });
    }

    // ==== status manual pinjaman Active (PaidOff / Cancelled) ====
    if (!["Active", "PaidOff", "Cancelled"].includes(b.status)) {
      return NextResponse.json({ error: "Status tidak valid" }, { status: 400 });
    }
    if (loan.status !== "Active") {
      return NextResponse.json({ error: `Status pinjaman saat ini ${loan.status} — hanya Active yang bisa diubah manual` }, { status: 400 });
    }
    if (b.status === "Cancelled" && loan.installments.some((i) => i.status === "Deducted")) {
      return NextResponse.json({ error: "Tidak bisa membatalkan — sudah ada cicilan terpotong payroll" }, { status: 400 });
    }
    const updated = await db.employeeLoan.update({ where: { id: b.id }, data: { status: b.status } });
    return NextResponse.json({ loan: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
