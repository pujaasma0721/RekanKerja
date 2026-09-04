import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { listClaims, submitClaim, decideClaim, previewClaim } from "@/onevity/medical/services/medical-service";
import { notifyEmailEvent, approverEmailsOf, employeeEmailOf } from "@/onevity/shared/services/email-service";

// GET /api/onevity/medical/claims?state=&year=&employeeId=&typeId=&preview=
// &employeeId&typeId — daftar klaim (padanan MedicalBenefitClaim.jsp /
// MedicalBenefitClaimToApprove.jsp); preview=1 → snapshot saldo sebelum ajukan
// (forDependent=1 → pool plafon yang benar utk klaim dependent — fix K-3).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    if (sp.get("preview") === "1") {
      const employeeId = sp.get("employeeId");
      const typeId = sp.get("typeId");
      if (!employeeId || !typeId) {
        return NextResponse.json({ error: "employeeId & typeId wajib utk preview" }, { status: 400 });
      }
      const year = Number(sp.get("year") ?? new Date().getFullYear());
      const forDependent = sp.get("forDependent") === "1";
      // error validasi bisnis (karyawan tidak aktif / jenis tidak aktif / saldo
      // tahun tak ada) → 400, bukan 500 — dipicu temuan dev.log: preview dengan
      // employeeId lintas-tenant/stale sempat 500 "Karyawan tidak ditemukan".
      try {
        const preview = await previewClaim(db, { employeeId, typeId, year, forDependent });
        return NextResponse.json({ preview });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
      }
    }
    const includeLines = sp.get("includeLines") === "1";
    const claims = await listClaims(db, {
      state: sp.get("state") ?? "all",
      year: sp.get("year") ? Number(sp.get("year")) : undefined,
      employeeId: sp.get("employeeId") ?? undefined,
      typeId: sp.get("typeId") ?? undefined,
      includeLines,
    });
    const stats = {
      total: claims.length,
      draft: claims.filter((c) => c.state === "Draft").length,
      submitted: claims.filter((c) => c.state === "Submitted").length,
      approved: claims.filter((c) => c.state === "Approved").length,
      settled: claims.filter((c) => c.state === "Settled").length,
      rejected: claims.filter((c) => c.state === "Rejected").length,
      cancelled: claims.filter((c) => c.state === "Cancelled").length,
      pendingAmount: claims
        .filter((c) => c.state === "Submitted" || c.state === "Approved")
        .reduce((s, c) => s + c.totalApproved, 0),
      settledAmount: claims.filter((c) => c.state === "Settled").reduce((s, c) => s + c.totalApproved, 0),
    };
    return NextResponse.json({ claims, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan klaim medis (baris perawatan multi: treated/diagnosa/kwitansi/
// dokter/RS + bill/reimburse/approved) — padanan Medical Claim form + ESS wizard.
// Guard (fix audit): validasi tanggal (M-2), dedupe kwitansi (M-8), enforce sisa
// plafon pool yang benar (K-1/K-2/K-3). Guard: VIEWER 403 + aktor sesi.
// Task 32-d: guard hak AKSI menu — create pada medical:medical-claim (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "medical:medical-claim", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    // aktor sesi nyata (AppUser bila ada — mis. hrd@mii.co.id → MII000001)
    const actorId = m.actor.appUserId ?? m.actor.userId;
    const b = await req.json();
    if (!b.employeeId || !b.typeId || !b.claimDate || !Array.isArray(b.lines) || b.lines.length === 0) {
      return NextResponse.json({ error: "employeeId, typeId, claimDate & lines wajib" }, { status: 400 });
    }
    const res = await submitClaim(m.db, {
      employeeId: String(b.employeeId),
      typeId: String(b.typeId),
      claimDate: String(b.claimDate),
      letterNo: b.letterNo ? String(b.letterNo) : undefined,
      forDependent: Boolean(b.forDependent),
      note: b.note ? String(b.note) : undefined,
      submit: b.submit !== false,
      lines: b.lines.map((l: Record<string, unknown>) => ({
        treatedName: String(l.treatedName ?? ""),
        treatment: l.treatment ? String(l.treatment) : undefined,
        treatmentDate: l.treatmentDate ? String(l.treatmentDate) : undefined,
        receiptNo: l.receiptNo ? String(l.receiptNo) : undefined,
        physician: l.physician ? String(l.physician) : undefined,
        hospital: l.hospital ? String(l.hospital) : undefined,
        note: l.note ? String(l.note) : undefined,
        occupationalInjury: Boolean(l.occupationalInjury),
        billAmount: Number(l.billAmount ?? 0),
        reimburseAmount: Number(l.reimburseAmount ?? 0),
        approvedAmount: Number(l.approvedAmount ?? 0),
      })),
    }, actorId);

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    if (b.submit !== false) {
      void (async () => {
        try {
          const [emp, typ] = await Promise.all([
            m.db.employee.findUnique({ where: { id: String(b.employeeId) }, select: { fullName: true } }),
            m.db.medicalBenefitType.findUnique({ where: { id: String(b.typeId) }, select: { name: true } }),
          ]);
          const total = Array.isArray(b.lines)
            ? (b.lines as { billAmount?: number }[]).reduce((s, l) => s + (Number(l.billAmount) || 0), 0)
            : 0;
          notifyEmailEvent(m.db, {
            event: "medical.claim.submitted",
            to: await approverEmailsOf(m.db, String(b.employeeId)),
            data: {
              nama: emp?.fullName ?? "-", docNo: res.docNo,
              jenis: typ?.name ?? "-", jumlah: `Rp ${total.toLocaleString("id-ID")}`,
            },
          });
        } catch { /* never */ }
      })();
    }

    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — Operation: submit | return | approve | reject | cancel | settle.
// Settle = jurnal otomatis + saldo used bertambah. Guard re-check sisa plafon
// (K-1/K-2) + guard VIEWER 403 (decidedBy/settledBy = aktor sesi).
// Task 32-d: guard hak AKSI menu per pengguna — submit → op:submit & cancel →
// op:cancel pada medical:medical-claim; approve/reject/return → op:approve &
// settle → op:settle pada medical:medical-approval. Body dibaca SEKALI sebelum
// guard (aksi menentukan menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const actions = ["submit", "return", "approve", "reject", "cancel", "settle"];
    if (!b.id || !actions.includes(b.action)) {
      return NextResponse.json({ error: `id & action (${actions.join("|")}) wajib` }, { status: 400 });
    }
    const m = b.action === "submit" || b.action === "cancel"
      ? await requireMenuAction(req, "medical:medical-claim", b.action === "submit" ? "op:submit" : "op:cancel")
      : await requireMenuAction(req, "medical:medical-approval", b.action === "settle" ? "op:settle" : "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const actorId = m.actor.appUserId ?? m.actor.userId;
    const res = await decideClaim(m.db, {
      claimId: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
    }, actorId);

    // ===== Notifikasi email otomatis (Task 34) — fire-and-forget =====
    if (["approve", "reject", "settle"].includes(b.action) && !res.approval) {
      void (async () => {
        try {
          const cl = await m.db.medicalClaim.findUnique({
            where: { id: String(b.id) },
            select: { docNo: true, totalApproved: true, totalBill: true, employeeId: true, type: { select: { name: true } } },
          });
          const emp = cl ? await employeeEmailOf(m.db, cl.employeeId) : null;
          if (cl && emp) {
            const event = b.action === "settle" ? "medical.claim.settled"
              : b.action === "approve" ? "medical.claim.approved"
              : "medical.claim.rejected";
            notifyEmailEvent(m.db, {
              event,
              to: [emp],
              data: {
                nama: emp.name ?? "-", docNo: cl.docNo,
                jenis: cl.type?.name ?? "-",
                jumlah: `Rp ${(cl.totalApproved ?? cl.totalBill ?? 0).toLocaleString("id-ID")}`,
                catatan: b.note ? String(b.note) : "-",
              },
            });
          }
        } catch { /* never */ }
      })();
    }

    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
