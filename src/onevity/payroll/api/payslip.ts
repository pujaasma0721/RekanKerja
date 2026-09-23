// GET /api/onevity/payslip/[lineId]?download=1|0 — PDF slip gaji karyawan.
// =====================================================================
// Respons: application/pdf (bukan JSON).
// Otorisasi (T10):
//   - HR / pengguna dgn hak LIHAT menu payroll:runs → SEMUA line run.
//   - Pengguna lain → HANYA line miliknya (AppUser.employeeId sesi) dan
//     run berstatus Confirmed/Paid (pola T7 ess payslips/detail).
// download=1 → attachment (unduh); download=0 → inline (preview browser).
import { NextRequest, NextResponse } from "next/server";
import { resolveMenuPerms } from "@/onevity/shared/services/menu-access";
import { UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { getMoneyView } from "@/onevity/shared/lib/money-view";
import { buildPayslipPdfByLineId } from "@/onevity/payroll/services/payslip-pdf";

const FORBIDDEN_OWN_MSG = "Slip gaji ini bukan milik Anda";

export async function GET(req: NextRequest, ctx: { params: Promise<{ lineId: string }> }) {
  try {
    const resolved = await resolveMenuPerms(req);
    if (!resolved) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const { db, actor, all, perms } = resolved;

    // HR payroll: super admin / mode ALL / CUSTOM dgn payroll:runs view.
    const canViewAll = all || perms["payroll:runs"]?.view === true;

    const { lineId } = await ctx.params;
    if (!lineId) return NextResponse.json({ error: "lineId wajib" }, { status: 400 });

    // 45-b: gerbang vault uang — aktor sesi (userId+role platform); masked →
    // nilai uang PDF dirender "—" (identitas/tanggal tetap utuh).
    const mv = await getMoneyView(db, { userId: actor.userId, membershipRole: actor.role });
    // Task 80d: stamp e-Sign run — PDF slip membawa QR ttd PayrollRun bila sudah ditandatangani.
    const built = await buildPayslipPdfByLineId(db, lineId, mv, { esignReq: req });
    if (!built) return NextResponse.json({ error: "Slip gaji tidak ditemukan" }, { status: 404 });

    if (!canViewAll) {
      // karyawan: hanya line miliknya + run sudah final (ESS pattern)
      if (!actor.employeeId || built.slip.employeeId !== actor.employeeId) {
        return NextResponse.json({ error: FORBIDDEN_OWN_MSG }, { status: 403 });
      }
      if (built.slip.runStatus !== "Confirmed" && built.slip.runStatus !== "Paid") {
        return NextResponse.json({ error: "Slip gaji belum final (run belum dikonfirmasi/dibayar)" }, { status: 403 });
      }
    }

    const download = req.nextUrl.searchParams.get("download") !== "0";
    if (download) {
      await db.activityLog.create({
        data: {
          action: "Exported",
          entity: "PayrollRunLine",
          entityId: built.slip.lineId,
          appUserId: actor.appUserId ?? undefined,
          detail: `Unduh PDF slip gaji ${built.slip.employeeNo} ${built.slip.employeeName} (${built.slip.runNo} · ${built.slip.periodName})`,
        },
      }).catch(() => { /* log tidak boleh menggagalkan unduhan */ });
    }

    const disposition = `${download ? "attachment" : "inline"}; filename="${built.filename}"`;
    return new NextResponse(Buffer.from(built.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    }) as NextResponse;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
