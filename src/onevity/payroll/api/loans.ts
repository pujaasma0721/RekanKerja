import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

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
    return NextResponse.json({ loans });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/loans — buat pinjaman + skedul cicilan
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
    const installmentCount = Math.max(1, Number(b.installmentCount));
    const interestRate = Number(b.interestRate ?? 0); // flat %/tahun
    const startPayment = b.startPaymentDate ? new Date(b.startPaymentDate) : new Date();

    // Total tagihan = pokok + bunga flat per bulan; cicilan rata (bulan terakhir penyeimbang).
    const months = installmentCount;
    const interestTotal = amount * (interestRate / 100) * (months / 12);
    const totalDue = amount + interestTotal;
    const per = Math.round(totalDue / months);
    const installments = Array.from({ length: months }, (_, i) => {
      const due = new Date(startPayment);
      due.setMonth(due.getMonth() + i);
      return { sequence: i + 1, dueDate: due, amount: i === months - 1 ? totalDue - per * (months - 1) : per };
    });

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
        status: "Active",
        paidAmount: 0,
        outstanding: totalDue,
        wageComponentCode: "LOAN",
        installments: { create: installments },
      },
      include: { employee: { select: { employeeNo: true, fullName: true } }, installments: { orderBy: { sequence: "asc" } } },
    });
    await db.activityLog.create({
      data: { action: "Created", entity: "EmployeeLoan", entityId: loan.id, employeeId: b.employeeId, detail: `Pinjaman ${loan.letterNo} (${employee.fullName}): ${installmentCount}x cicilan` },
    });
    return NextResponse.json({ loan }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/loans — ubah status (PaidOff manual / Cancelled)
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const loan = await db.employeeLoan.findUnique({ where: { id: b.id } });
    if (!loan) return NextResponse.json({ error: "Pinjaman tidak ditemukan" }, { status: 404 });
    if (!["Active", "PaidOff", "Cancelled"].includes(b.status)) {
      return NextResponse.json({ error: "Status tidak valid" }, { status: 400 });
    }
    const updated = await db.employeeLoan.update({ where: { id: b.id }, data: { status: b.status } });
    return NextResponse.json({ loan: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
