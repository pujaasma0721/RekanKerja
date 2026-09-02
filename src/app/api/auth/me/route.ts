import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, buildSessionInfo, readSessionCookie } from "@/onevity/shared/lib/auth";

// GET /api/auth/me — session saat ini (user + tenant terpilih + daftar workspace)
export async function GET(req: NextRequest) {
  try {
    const payload = readSessionCookie(req);
    if (!payload) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    const info = await buildSessionInfo(payload.uid, payload.tid);
    if (!info) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
