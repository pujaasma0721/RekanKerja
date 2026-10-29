// GET  /api/public/leave-requests?status=&employeeId=&year= — daftar + jenjang.
// POST /api/public/leave-requests { employeeId, typeId, dateFrom, dateTo, reason }
//      — ajukan permintaan cuti (reuse leave-service submitRequest; aktor
//        "apikey:{prefix}" tercatat pada chain.createdBy + ActivityLog).
// Scope: leave.
import { NextRequest, NextResponse } from "next/server";
import { requirePublicApi, publicOk, publicError, auditPublicApi } from "@/onevity/public/api/guard";
import { listRequests, submitRequest } from "@/onevity/leave/services/leave-service";
import { dispatchWebhookEvent } from "@/onevity/shared/services/webhook-service";

const iso = (d: Date) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// GET — daftar permintaan + ringkasan approval berjenjang (currentLevel/total/approver)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await requirePublicApi(req, "leave");
  if (!g.ok) return g.response;
  const auth = g.auth; // { db, tenant, key }
  const db = auth.db;

  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "all";
    const employeeId = sp.get("employeeId") ?? undefined;
    const year = sp.get("year") ? Number(sp.get("year")) : undefined;
    if (sp.get("employeeId") && !employeeId) {
      return publicError(400, "employeeId tidak valid");
    }

    const rows = await listRequests(db, { status, employeeId, year });
    const requests = rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      employeeId: r.employeeId,
      employeeNo: r.employeeNo,
      fullName: r.fullName,
      orgUnitName: r.orgUnitName,
      leaveType: r.leaveTypeName,
      year: r.year,
      dateFrom: iso(r.dateFrom),
      dateTo: iso(r.dateTo),
      sessionFrom: r.sessionFrom,
      sessionTo: r.sessionTo,
      workingDays: r.workingDays,
      status: r.status,
      source: r.source,
      reason: r.reason,
      requestDate: r.requestDate,
      approval: r.approval
        ? {
            status: r.approval.status,
            currentLevel: r.approval.currentLevel,
            totalLevels: r.approval.totalLevels,
            currentApprover: r.approval.currentApprover,
          }
        : null,
    }));

    auditPublicApi(db, auth, {
      method: "GET", path: "/api/public/leave-requests", status: 200, scope: "leave",
      detail: `${requests.length} permintaan (status ${status})`,
    });
    return publicOk({ requests, total: requests.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    auditPublicApi(db, auth, { method: "GET", path: "/api/public/leave-requests", status: 500, scope: "leave", detail: msg });
    return publicError(500, msg);
  }
}

// POST — ajukan permintaan cuti (padanan POST /api/onevity/leave/requests,
// aktor = kunci API; seluruh guard bisnis leave-service tetap berlaku).
export async function POST(req: NextRequest | Request): Promise<NextResponse> {
  const g = await requirePublicApi(req, "leave");
  if (!g.ok) return g.response;
  const auth = g.auth; // { db, tenant, key }
  const db = auth.db;

  const path = "/api/public/leave-requests";
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = {
      employeeId: String(b.employeeId ?? ""),
      leaveTypeId: String(b.typeId ?? b.leaveTypeId ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      dateTo: String(b.dateTo ?? ""),
      sessionFrom: b.sessionFrom === "PM" ? ("PM" as const) : ("AM" as const),
      sessionTo: b.sessionTo === "AM" ? ("AM" as const) : ("PM" as const),
      reason: String(b.reason ?? ""),
      note: b.note ? String(b.note) : undefined,
      source: "API",
      actorName: auth.key.actor, // apikey:ov_… — tercatat pada approval chain + audit
    };
    if (!input.employeeId || !input.leaveTypeId || !input.dateFrom || !input.dateTo) {
      return publicError(400, "employeeId, typeId, dateFrom, dateTo wajib diisi");
    }
    if (!input.reason.trim()) {
      return publicError(400, "reason wajib diisi");
    }
    for (const [label, v] of [["dateFrom", input.dateFrom], ["dateTo", input.dateTo]] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return publicError(400, `${label} harus format YYYY-MM-DD`);
      }
    }

    const res = await submitRequest(db, input);
    // webhook leave.submitted — parity dgn route internal (aktor = kunci API)
    void dispatchWebhookEvent(db, auth.tenant.name, "leave.submitted", {
      docNo: res.docNo, employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      dateFrom: input.dateFrom, dateTo: input.dateTo,
      workingDays: res.workingDays, reason: input.reason || null, source: "api",
    });
    // audit eksplisit aktor kunci API — leave-service sudah menulis baris
    // Submitted milik bisnis; baris ini menandai jalur Public API.
    auditPublicApi(db, auth, {
      method: "POST", path, status: 201, scope: "leave",
      detail: `permintaan cuti ${res.docNo} diajukan (${res.workingDays} hari kerja, sisa saldo ${res.remaining})`,
    });
    return publicOk(res, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    auditPublicApi(db, auth, { method: "POST", path, status: 400, scope: "leave", detail: msg });
    return publicError(400, msg);
  }
}
