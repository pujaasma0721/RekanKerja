import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { toCsv, csvResponse, exportFilename, type ExportCell, type ExportColumn } from "@/rekankerja/shared/lib/export";
import {
  setRecruitmentSetting,
} from "@/rekankerja/recruitment/services/recruitment-setting-service";
import {
  createDsr, listDsr, updateDsrStatus, completeDsr, rejectDsr, getDsrPackage,
  withdrawConsent, listConsentLedger, runRetention, retentionOverview,
  listPiiAudit, ComplianceError, type DsrType,
} from "@/rekankerja/recruitment/services/compliance-service";

// ============================================================================
// RECRUITMENT F9 — API Kepatuhan UU PDP (DSR, consent, retensi, audit PII).
// Guard menu: recruitment:compliance (ops: handle, retention, export).
//   GET  ?section=dsr|consents|retention|audit          (view)
//   GET  ?dsr-package=<id>  → paket data JSON (op:export; DSR Export/Access)
//   GET  ?export=audit      → CSV log akses PII (op:export)
//   POST { action: dsr-create|dsr-progress|dsr-complete|dsr-reject
//                 |consent-withdraw (op:handle)
//                 |retention-config|retention-run (op:retention) }
// Error map: 400 validasi · 403 guard · 404 tidak ketemu · 409 konflik/status.
// ============================================================================

const RETENTION_KEYS = ["retention.months.rejected", "retention.months.outdated", "retention.anonymize"] as const;

// GET /api/rekankerja/recruitment/compliance
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    // ---- paket data DSR (attachment JSON — op:export) ----
    const dsrPackageId = sp.get("dsr-package");
    if (dsrPackageId) {
      const m = await requireMenuAction(req, "recruitment:compliance", "op:export");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const pkg = await getDsrPackage(m.db, dsrPackageId);
      const applicantNo = String((pkg.applicant as { applicantNo?: string }).applicantNo ?? "pelamar");
      return new NextResponse(JSON.stringify(pkg, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="dsr-${applicantNo}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // ---- export CSV audit PII (op:export) ----
    if (sp.get("export") === "audit") {
      const m = await requireMenuAction(req, "recruitment:compliance", "op:export");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const rows = await listPiiAudit(m.db, 500);
      const columns: ExportColumn[] = [
        { header: "Waktu", width: 22 }, { header: "Karyawan", width: 28 },
        { header: "Pelamar", width: 16 }, { header: "Aktivitas Akses", width: 30 },
      ];
      const body: ExportCell[][] = rows.map((r) => [
        r.createdAt.slice(0, 19).replace("T", " "),
        r.employeeName ?? r.employeeId ?? "(sistem)",
        r.applicantNo ?? "",
        r.what ?? "",
      ]);
      return csvResponse(toCsv(columns, body, "id"), exportFilename("rekankerja-pii-audit", "csv"));
    }
    if (sp.get("export")) {
      return NextResponse.json({ error: `Bagian ekspor tidak dikenal: ${sp.get("export")}` }, { status: 400 });
    }

    // ---- section JSON (view) ----
    const m = await requireMenuViewAny(req, ["recruitment:compliance"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    switch (sp.get("section") ?? "dsr") {
      case "dsr":
        return NextResponse.json({ list: await listDsr(db) });
      case "consents":
        return NextResponse.json({ list: await listConsentLedger(db) });
      case "retention":
        return NextResponse.json(await retentionOverview(db));
      case "audit":
        return NextResponse.json({ list: await listPiiAudit(db) });
      default:
        return NextResponse.json({ error: `Bagian tidak dikenal: ${sp.get("section")}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ComplianceError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/recruitment/compliance — aksi kepatuhan
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");
    const guard = async (op: "handle" | "retention") => {
      const ref: MenuActionRef = `op:${op}`;
      const m = await requireMenuAction(req, "recruitment:compliance", ref);
      if (!m.ok) throw new ComplianceError(m.status, m.error);
      return m;
    };

    switch (action) {
      case "dsr-create": {
        const m = await guard("handle");
        const res = await createDsr(m.db, {
          applicantId: String(b.applicantId ?? ""),
          type: String(b.type ?? "") as DsrType,
          note: b.note ? String(b.note) : null,
        }, { employeeId: m.actor.employeeId, name: m.actor.name });
        return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
      }
      case "dsr-progress": {
        const m = await guard("handle");
        await updateDsrStatus(m.db, { id: String(b.id ?? "") }, { employeeId: m.actor.employeeId, name: m.actor.name });
        return NextResponse.json({ ok: true });
      }
      case "dsr-complete": {
        const m = await guard("handle");
        const res = await completeDsr(m.db, {
          id: String(b.id ?? ""),
          handledById: m.actor.employeeId,
        }, m.actor.name);
        return NextResponse.json({ ok: true, ...res });
      }
      case "dsr-reject": {
        const m = await guard("handle");
        await rejectDsr(m.db, {
          id: String(b.id ?? ""),
          handledById: m.actor.employeeId,
          resultNote: b.resultNote ? String(b.resultNote) : null,
        }, m.actor.name);
        return NextResponse.json({ ok: true });
      }
      case "consent-withdraw": {
        const m = await guard("handle");
        const res = await withdrawConsent(m.db, {
          applicantId: String(b.applicantId ?? ""),
          consentId: String(b.consentId ?? ""),
          note: b.note ? String(b.note) : null,
        }, { employeeId: m.actor.employeeId, name: m.actor.name });
        return NextResponse.json({ ok: true, ...res });
      }
      case "retention-config": {
        const m = await guard("retention");
        const key = String(b.key ?? "");
        if (!(RETENTION_KEYS as readonly string[]).includes(key)) {
          return NextResponse.json({ error: `Kunci retensi tidak dikenal: ${key}` }, { status: 400 });
        }
        const value = String(b.value ?? "").trim();
        if (value === "") return NextResponse.json({ error: "Nilai pengaturan wajib diisi" }, { status: 400 });
        if (key === "retention.anonymize") {
          if (value !== "true" && value !== "false") {
            return NextResponse.json({ error: "Nilai anonimisasi harus \"true\" atau \"false\"" }, { status: 400 });
          }
        } else {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > 120) {
            return NextResponse.json({ error: "Retensi (bulan) harus bilangan bulat 1–120" }, { status: 400 });
          }
        }
        await setRecruitmentSetting(m.db, key, value, { employeeId: m.actor.employeeId, name: m.actor.name });
        return NextResponse.json({ ok: true, key, value });
      }
      case "retention-run": {
        const m = await guard("retention");
        const result = await runRetention(m.db);
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ComplianceError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
