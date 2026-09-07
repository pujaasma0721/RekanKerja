import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";

interface InboxItem {
  docType: "Leave" | "Travel" | "Medical" | "Loan";
  docId: string;
  docNo: string;
  requester: { employeeNo: string | null; fullName: string; photoUrl: string | null };
  title: string; // ringkasan jenis dokumen
  lines: string[]; // baris detail singkat
  amount: number | null;
  requestedAt: string | null;
  currentLevel: number;
  totalLevels: number;
}

// GET /api/ess/approvals — kotak masuk persetujuan: dokumen yang jenjang
// SAAT INYA menunggu keputusan karyawan ini (approverEmployeeId = self).
// Mendukung Leave / Travel / Medical (dok berbasis chain approval).
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const steps = await db.approvalStep.findMany({
      where: { status: "Current", approverEmployeeId: employeeId, chain: { status: "InProgress" } },
      include: { chain: true },
      orderBy: { chain: { createdAt: "asc" } },
    });
    if (steps.length === 0) return NextResponse.json({ items: [], count: 0 });

    const byType = new Map<string, string[]>();
    for (const s of steps) {
      const arr = byType.get(s.chain.docType) ?? [];
      arr.push(s.chain.docId);
      byType.set(s.chain.docType, arr);
    }

    const items: InboxItem[] = [];

    // ---- Leave ----
    const leaveIds = byType.get("Leave") ?? [];
    if (leaveIds.length > 0) {
      const docs = await db.leaveRequest.findMany({
        where: { id: { in: leaveIds }, status: "Submitted" },
        include: {
          employee: { select: { employeeNo: true, fullName: true, photoUrl: true } },
          leaveType: { select: { name: true } },
        },
      });
      for (const d of docs) {
        const chain = steps.find((s) => s.chain.docType === "Leave" && s.chain.docId === d.id)?.chain;
        if (!chain) continue;
        items.push({
          docType: "Leave", docId: d.id, docNo: d.docNo,
          requester: d.employee,
          title: `Pengajuan ${d.leaveType.name}`,
          lines: [
            `Periode: ${new Date(d.dateFrom).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })} – ${new Date(d.dateTo).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`,
            `Lama: ${d.workingDays} hari kerja`,
            d.reason ? `Alasan: ${d.reason}` : "",
          ].filter(Boolean),
          amount: null,
          requestedAt: d.requestDate?.toISOString() ?? null,
          currentLevel: chain.currentLevel,
          totalLevels: chain.totalLevels,
        });
      }
    }

    // ---- Travel ----
    const travelIds = byType.get("Travel") ?? [];
    if (travelIds.length > 0) {
      const docs = await db.travelRequest.findMany({
        where: { id: { in: travelIds }, status: "Submitted" },
        include: {
          employee: { select: { employeeNo: true, fullName: true, photoUrl: true } },
          destinations: { orderBy: { seq: "asc" }, select: { city: true, country: true } },
          advances: { select: { amount: true } },
        },
      });
      for (const d of docs) {
        const chain = steps.find((s) => s.chain.docType === "Travel" && s.chain.docId === d.id)?.chain;
        if (!chain) continue;
        const advance = d.advances.reduce((s, a) => s + a.amount, 0);
        items.push({
          docType: "Travel", docId: d.id, docNo: d.docNo,
          requester: d.employee,
          title: "Perjalanan Dinas",
          lines: [
            `Tujuan: ${d.destinations.map((x) => x.city).join(" → ") || "—"}`,
            `Tanggal: ${new Date(d.dateFrom).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${new Date(d.dateTo).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`,
            d.purpose ? `Tujuan tugas: ${d.purpose}` : "",
          ].filter(Boolean),
          amount: advance > 0 ? advance : null,
          requestedAt: d.requestDate?.toISOString() ?? null,
          currentLevel: chain.currentLevel,
          totalLevels: chain.totalLevels,
        });
      }
    }

    // ---- Medical ----
    const medIds = byType.get("Medical") ?? [];
    if (medIds.length > 0) {
      const docs = await db.medicalClaim.findMany({
        where: { id: { in: medIds }, state: "Submitted" },
        include: {
          employee: { select: { employeeNo: true, fullName: true, photoUrl: true } },
          type: { select: { name: true } },
        },
      });
      for (const d of docs) {
        const chain = steps.find((s) => s.chain.docType === "Medical" && s.chain.docId === d.id)?.chain;
        if (!chain) continue;
        items.push({
          docType: "Medical", docId: d.id, docNo: d.docNo,
          requester: d.employee,
          title: `Klaim Medis — ${d.type.name}`,
          lines: [
            `Tanggal klaim: ${new Date(d.claimDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`,
            `Total tagihan: Rp ${d.totalBill.toLocaleString("id-ID")}`,
            d.forDependent ? "Untuk anggota keluarga (dependent)" : "Untuk karyawan sendiri",
          ],
          amount: d.totalBill,
          requestedAt: d.claimDate?.toISOString() ?? null,
          currentLevel: chain.currentLevel,
          totalLevels: chain.totalLevels,
        });
      }
    }

    // ---- Loan / tipe lain: tampilkan ringkas (tanpa aksi keputusan) ----
    const otherTypes = [...byType.keys()].filter((t) => !["Leave", "Travel", "Medical"].includes(t));
    for (const t of otherTypes) {
      for (const docId of byType.get(t)!) {
        const chain = steps.find((s) => s.chain.docId === docId)?.chain;
        if (!chain) continue;
        items.push({
          docType: t as InboxItem["docType"],
          docId,
          docNo: "—",
          requester: { employeeNo: null, fullName: "Dokumen lain", photoUrl: null },
          title: `Persetujuan ${t}`,
          lines: [`Jenjang ${chain.currentLevel} dari ${chain.totalLevels}`],
          amount: chain.amount,
          requestedAt: null,
          currentLevel: chain.currentLevel,
          totalLevels: chain.totalLevels,
        });
      }
    }

    items.sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));
    return NextResponse.json({ items, count: items.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
