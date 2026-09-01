import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/process-types
export async function GET() {
  try {
    const processTypes = await db.processType.findMany({ where: { active: true }, orderBy: { sequence: "asc" } });
    return NextResponse.json({ processTypes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
