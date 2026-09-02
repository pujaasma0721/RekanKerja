import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/onevity/shared/lib/auth";

// POST /api/auth/logout — hapus cookie session
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
