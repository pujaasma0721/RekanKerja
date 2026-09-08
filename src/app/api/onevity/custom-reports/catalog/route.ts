// OneVity — Report Builder (Task 28-b) =====================================
// GET /api/onevity/custom-reports/catalog — katalog entity + field + operator
// utk UI builder (guard requireTenant; whitelist server-side di service).
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { catalogPayload } from "@/onevity/shared/services/report-builder";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const db = await requireTenant(req);
  if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
  return NextResponse.json(catalogPayload());
}
