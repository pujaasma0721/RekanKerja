// GET /api/rekankerja/ess/claims/medical + POST ajukan klaim medis (ESS).
// =====================================================================
// GET  — data form pengajuan: jenis benefit AKTIF + snapshot saldo per
//        jenis (sisa utk klaim setelah reservasi menunggu K-1/K-2, pool
//        dependent K-3, frekuensi, limitRule) dari previewClaim service —
//        jalur yang sama dengan admin (rule plafon Task 33 ikut dievaluasi).
// POST — ajukan klaim medis untuk DIRI SENDIRI via medical-service
//        submitClaim: seluruh guard jalur admin TETAP berlaku (validasi
//        tanggal M-2, dedupe kwitansi M-8, enforce plafon pool K-1/K-2/K-3,
//        approval berjenjang "Medical").
//
// Lampiran kwitansi: ESS TIDAK menegakkan upload lampiran (endpoint
// /api/rekankerja/attachments ter-guard menu medical:medical-claim milik HR —
// pekerja ESS tidak punya akses upload). Klaim ESS bersifat deklarasi
// pekerja: notifikasi approver menyebut verifikasi kwitansi fisik, dan
// approver dapat me-RETURN klaim bila kwitansi tidak diserahkan (guard
// lampiran jalur admin tetap utuh).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { previewClaim, submitClaim } from "@/rekankerja/medical/services/medical-service";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, approverEmailsOf } from "@/rekankerja/shared/services/email-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";

// GET — jenis benefit aktif + saldo (form pengajuan klaim medis ESS).
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformUserId, platformRole } = m.actor;

  try {
    const year = new Date().getFullYear();
    const types = await db.medicalBenefitType.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, code: true, name: true, limitRule: true,
        needReceipt: true, dependentEnabled: true,
        freqUnlimited: true, freqValue: true, freqPeriod: true,
      },
    });
    // 45-b: gerbang vault uang (aktor ESS) — masked → nilai 0 (Task 56),
    // limitRule UNLIMITED tetap terbaca → UI menampilkan "∞".
    const mv = await getMoneyView(db, { userId: platformUserId, membershipRole: platformRole });
    const g = (n: number | null) => (mv.canSee ? n : 0);

    const out: unknown[] = [];
    for (const t of types) {
      try {
        const p = await previewClaim(db, { employeeId, typeId: t.id, year });
        out.push({
          typeId: t.id,
          code: t.code,
          name: t.name,
          limitRule: t.limitRule,
          needReceipt: t.needReceipt,
          dependentEnabled: t.dependentEnabled,
          freqUnlimited: t.freqUnlimited,
          freqValue: t.freqValue,
          freqPeriod: t.freqPeriod,
          benefitAmount: g(p.benefitAmount),
          remaining: g(p.remaining),
          remainingForClaim: g(p.remainingForClaim),
          pendingReserved: g(p.pendingReserved),
          depRemaining: g(p.depRemaining),
          claimPool: p.claimPool,
          claimCountYear: p.claimCountYear,
        });
      } catch {
        // jenis tanpa saldo/row (mis. rule error per karyawan) → dilewati,
        // form hanya menampilkan jenis yang sehat saja.
      }
    }
    return NextResponse.json({ types: out, year });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan klaim medis untuk diri sendiri.
// Body: { typeId, claimDate, forDependent?, note?,
//         lines: [{ treatedName, treatment?, treatmentDate?, receiptNo?,
//                   physician?, hospital?, note?, billAmount,
//                   reimburseAmount?, approvedAmount? }] }
// approvedAmount (nilai yang diajukan direimburse) default = billAmount.
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, appUserId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const typeId = String(b.typeId ?? "");
    const claimDate = String(b.claimDate ?? "");
    if (!typeId) return NextResponse.json({ error: "Jenis benefit wajib dipilih" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(claimDate)) {
      return NextResponse.json({ error: "Tanggal klaim wajib format YYYY-MM-DD" }, { status: 400 });
    }
    if (!Array.isArray(b.lines) || b.lines.length === 0) {
      return NextResponse.json({ error: "Klaim wajib memuat minimal satu baris perawatan" }, { status: 400 });
    }
    for (const [i, l] of (b.lines as Record<string, unknown>[]).entries()) {
      if (!String(l.treatedName ?? "").trim()) {
        return NextResponse.json({ error: `Baris ${i + 1}: nama yang dirawat wajib diisi` }, { status: 400 });
      }
      if (!(Number(l.billAmount) > 0)) {
        return NextResponse.json({ error: `Baris ${i + 1}: nilai tagihan wajib lebih dari 0` }, { status: 400 });
      }
    }

    // ESS selalu submit langsung (Submitted) — aktor = AppUser karyawan sendiri.
    const res = await submitClaim(
      db,
      {
        employeeId,
        typeId,
        claimDate,
        forDependent: b.forDependent === true,
        note: b.note ? String(b.note) : "Diajukan via ESS oleh karyawan",
        submit: true,
        lines: (b.lines as Record<string, unknown>[]).map((l) => {
          const bill = Math.max(0, Number(l.billAmount ?? 0));
          return {
            treatedName: String(l.treatedName ?? ""),
            treatment: l.treatment ? String(l.treatment) : undefined,
            treatmentDate: l.treatmentDate ? String(l.treatmentDate) : undefined,
            receiptNo: l.receiptNo ? String(l.receiptNo) : undefined,
            physician: l.physician ? String(l.physician) : undefined,
            hospital: l.hospital ? String(l.hospital) : undefined,
            note: l.note ? String(l.note) : undefined,
            occupationalInjury: l.occupationalInjury === true,
            billAmount: bill,
            reimburseAmount: Math.max(0, Number(l.reimburseAmount ?? 0)),
            // nilai pengajuan reimburse karyawan — approver dapat mengoreksi.
            approvedAmount: Math.max(0, Number(l.approvedAmount ?? bill)),
          };
        }),
      },
      appUserId,
      { appUserId, employeeId },
    );

    // ===== Notifikasi (mirror jalur admin medical/api/claims.ts POST) =====
    const total = res.totalBill;
    void (async () => {
      try {
        const type = await db.medicalBenefitType.findUnique({ where: { id: typeId }, select: { name: true } });
        notifyEmailEvent(db, {
          event: "medical.claim.submitted",
          to: await approverEmailsOf(db, employeeId),
          data: {
            nama: fullName, docNo: res.docNo,
            jenis: type?.name ?? "-",
            jumlah: `Rp ${total.toLocaleString("id-ID")}`,
          },
        });
        await notifyEvent(db, {
          to: "nextApprover", docType: "Medical", docNo: res.docNo,
          title: `Klaim medis ${res.docNo} menunggu persetujuan Anda`,
          body: `${fullName} — ${type?.name ?? "klaim medis"}, total tagihan Rp ${total.toLocaleString("id-ID")} (diajukan via ESS — kwitansi asli diverifikasi saat approval)`,
          kind: "medical", link: "medical:medical-approval",
        });
      } catch { /* notifikasi tidak boleh mengganggu proses utama ESS */ }
    })();
    void dispatchWebhookEvent(db, null, "medical.claim.submitted", {
      docNo: res.docNo, employeeId, employeeName: fullName,
      totalBill: total, lineCount: (b.lines as unknown[]).length,
      source: "ess",
    });

    return NextResponse.json(
      {
        // Task 82-b: `warnings` (validasi lembut klaim dependent, audit T10)
        // ikut via spread — ADDITIVE, field lain tidak berubah.
        ...res,
        receiptNote:
          "Kwitansi asli/tagihan tetap diserahkan ke HR untuk verifikasi sebelum klaim disetujui.",
      },
      { status: 201 },
    );
  } catch (e) {
    // validasi bisnis (plafon/tanggal/kwitansi ganda/frekuensi) → 400 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
