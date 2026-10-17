import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportCell, type ExportSheet } from "@/rekankerja/shared/lib/export";
import { type Lang } from "@/rekankerja/shared/lib/i18n-core";
import {
  PolicyError,
  listPolicies,
  upsertPolicy,
  terminatePolicy,
  enrollMember,
  endMembership,
  listMembers,
  premiumReport,
  type PolicyActorRef,
} from "@/rekankerja/medical/services/policy-service";

// GET /api/rekankerja/medical/insurance-policies — administrasi polis asuransi
// grup (D-BM20):
//   ?list&q=            → daftar polis (join provider, hitung anggota) + master
//                         provider INSURANCE aktif + karyawan aktif (dialog
//                         buat/enroll); premi mv-gate (null + premiumMasked).
//   ?detail=ID          → policy + members + laporan premi polis itu.
//   ?report=ID|all      → laporan premi per anggota aktif + rekap per polis.
//   ?report=ID|all&export=xlsx → XLSX dwibahasa (uang null saat vault terkunci
//                         → '' bukan 0 — pelajaran MR) + ActivityLog Exported.
//   ?familyFor=EMPID    → daftar keluarga (dropdown dependen dialog enroll).
// Guard: view menu medical:insurance-policies (opsi register MENU_OPS:
// enroll / terminate).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["medical:insurance-policies"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    // dropdown dependen dialog enroll (registry EmployeeFamily karyawan).
    const familyFor = sp.get("familyFor");
    if (familyFor) {
      const family = await db.employeeFamily.findMany({
        where: { employeeId: familyFor },
        select: { id: true, name: true, relation: true, birthDate: true, isDependent: true },
        orderBy: [{ isDependent: "desc" }, { name: "asc" }],
      });
      return NextResponse.json({ family });
    }

    // 45-b: gerbang vault uang — aktor requireMenuViewAny (userId + role).
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });

    const report = sp.get("report");
    if (report) {
      const scope = report === "all" ? undefined : report;
      const reportData = await premiumReport(db, { policyId: scope }, mv);
      // mode export XLSX — kolom dwibahasa (trFor via toXlsxMulti lang=en).
      if (sp.get("export") === "xlsx") {
        const lang: Lang = sp.get("lang") === "en" ? "en" : "id";
        const sheets: ExportSheet[] = [
          {
            name: "Premi per Anggota",
            title: "Laporan Premi Polis Asuransi Grup",
            columns: [
              { header: "No.", width: 6 },
              { header: "Polis", width: 24 },
              { header: "Penyedia", width: 26 },
              { header: "No. Karyawan", width: 14 },
              { header: "Nama Anggota", width: 28 },
              { header: "Jenis Anggota", width: 14 },
              { header: "Efektif Dari", width: 13 },
              { header: "Efektif Sampai", width: 14 },
              { header: "Premi per Anggota (Rp)", width: 20 },
              { header: "Porsi Perusahaan (Rp)", width: 20 },
              { header: "Porsi Karyawan (Rp)", width: 18 },
            ],
            rows: reportData.rows.map((r, i): ExportCell[] => [
              i + 1,
              r.policyNo,
              r.providerName,
              r.employeeNo,
              r.dependentName ? `${r.dependentName} (${r.dependentRelation})` : r.employeeName,
              r.memberKind,
              r.effectiveFrom,
              r.effectiveTo ?? "",
              // pelajaran MR: vault terkunci → '' (BUKAN 0 — jangan rekayasa angka).
              r.premiumPerMember ?? "",
              r.companyShare ?? "",
              r.employeeShare ?? "",
            ]),
          },
          {
            name: "Rekap per Polis",
            columns: [
              { header: "Polis", width: 24 },
              { header: "Penyedia", width: 26 },
              { header: "Periode", width: 24 },
              { header: "Status", width: 12 },
              { header: "Anggota Aktif", width: 14 },
              { header: "Premi Bulanan (Rp)", width: 18 },
              { header: "Total Premi (Rp)", width: 18 },
              { header: "Total Porsi Perusahaan (Rp)", width: 24 },
              { header: "Total Porsi Karyawan (Rp)", width: 22 },
            ],
            rows: reportData.rekap.map((k): ExportCell[] => [
              k.policyNo,
              k.providerName,
              `${k.periodStart} → ${k.periodEnd}`,
              k.status,
              k.activeMembers,
              k.premiumMonthly ?? "",
              k.totalAllocated ?? "",
              k.totalCompany ?? "",
              k.totalEmployee ?? "",
            ]),
          },
        ];
        const buf = await toXlsxMulti(sheets, { lang });
        try {
          await db.activityLog.create({
            data: {
              action: "Exported", entity: "InsurancePolicy",
              ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
              detail: `Ekspor laporan premi polis asuransi grup ${report === "all" ? "seluruh polis aktif" : reportData.rekap[0]?.policyNo ?? report} (${reportData.rows.length} baris anggota, ${reportData.rekap.length} polis)`,
            },
          });
        } catch { /* ActivityLog opsional — export tetap sukses */ }
        return xlsxResponse(buf, exportFilename("rekankerja-premi-polis", "xlsx", report === "all" ? "semua" : undefined));
      }
      return NextResponse.json({ rows: reportData.rows, rekap: reportData.rekap });
    }

    const detail = sp.get("detail");
    if (detail) {
      const policies = await listPolicies(db, undefined, mv);
      const policy = policies.find((p) => p.id === detail);
      if (!policy) return NextResponse.json({ error: "Polis tidak ditemukan" }, { status: 404 });
      const members = await listMembers(db, { policyId: detail });
      const premium = await premiumReport(db, { policyId: detail }, mv);
      return NextResponse.json({ policy, members, premium });
    }

    // default: register polis + master dialog (provider INSURANCE aktif +
    // karyawan aktif) — sekali jalan utk halaman register.
    const [policies, providers, employees] = await Promise.all([
      listPolicies(db, sp.get("q") ?? undefined, mv),
      db.medicalProvider.findMany({
        where: { kind: "INSURANCE", active: true },
        select: { id: true, code: true, name: true, city: true },
        orderBy: { name: "asc" },
      }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    return NextResponse.json({ policies, providers, employees });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — mutasi polis (body dibaca SEKALI sebelum guard: b.id menentukan
// create vs update — pola providers.ts):
//   { action: "upsert", id?, providerId, policyNo, periodStart, periodEnd,
//     premiumMonthly?, pctCompany, note }         → create/update menu action
//   { action: "terminate", id, note? }             → op:terminate
//   { action: "enroll", policyId, employeeId, dependentId?, effectiveFrom }
//                                                  → op:enroll
//   { action: "end-membership", id, effectiveTo }   → op:enroll
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "upsert");
    if (!["upsert", "terminate", "enroll", "end-membership"].includes(action)) {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
    const m = await requireMenuAction(
      req,
      "medical:insurance-policies",
      action === "terminate" ? "op:terminate"
        : action === "enroll" || action === "end-membership" ? "op:enroll"
          : b.id ? "update" : "create",
    );
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const actor: PolicyActorRef = {
      appUserId: m.actor.appUserId,
      employeeId: m.actor.employeeId,
      name: m.actor.appUsername ?? m.actor.name,
    };
    try {
      if (action === "upsert") {
        if (!b.providerId || !b.policyNo || !b.periodStart || !b.periodEnd) {
          return NextResponse.json({ error: "providerId, policyNo, periodStart & periodEnd wajib" }, { status: 400 });
        }
        const id = await upsertPolicy(m.db, {
          id: b.id ? String(b.id) : undefined,
          providerId: String(b.providerId),
          policyNo: String(b.policyNo),
          periodStart: String(b.periodStart),
          periodEnd: String(b.periodEnd),
          premiumMonthly: b.premiumMonthly == null || b.premiumMonthly === "" ? null : Number(b.premiumMonthly),
          pctCompany: b.pctCompany == null ? 100 : Number(b.pctCompany),
          note: b.note ? String(b.note) : null,
          actor,
        });
        return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
      }
      if (action === "terminate") {
        if (!b.id) return NextResponse.json({ error: "id polis wajib" }, { status: 400 });
        const res = await terminatePolicy(m.db, { id: String(b.id), note: b.note ? String(b.note) : null, actor });
        return NextResponse.json({ ok: true, ...res });
      }
      if (action === "enroll") {
        if (!b.policyId || !b.employeeId || !b.effectiveFrom) {
          return NextResponse.json({ error: "policyId, employeeId & effectiveFrom wajib" }, { status: 400 });
        }
        const id = await enrollMember(m.db, {
          policyId: String(b.policyId),
          employeeId: String(b.employeeId),
          dependentId: b.dependentId ? String(b.dependentId) : null,
          effectiveFrom: String(b.effectiveFrom),
          actor,
        });
        return NextResponse.json({ id }, { status: 201 });
      }
      // end-membership
      if (!b.id || !b.effectiveTo) {
        return NextResponse.json({ error: "id membership & effectiveTo wajib" }, { status: 400 });
      }
      const res = await endMembership(m.db, { id: String(b.id), effectiveTo: String(b.effectiveTo), actor });
      return NextResponse.json({ ok: true, ...res });
    } catch (e) {
      if (e instanceof PolicyError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
