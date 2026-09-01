import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, freshSessionToken, sessionCookieOptions, verifyPassword, buildSessionInfo,
} from "@/lib/onevity/auth";

// POST /api/auth/login { email, password } → session cookie (tid otomatis bila 1 workspace)
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");
    if (!email || !password) return NextResponse.json({ error: "Email dan kata sandi wajib diisi" }, { status: 400 });

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Email atau kata sandi salah" }, { status: 401 });
    }

    const info = await buildSessionInfo(user.id, null);
    if (!info) return NextResponse.json({ error: "Sesi gagal dibangun" }, { status: 500 });

    // bila user hanya punya 1 workspace aktif → langsung pilih
    const tid = info.workspaces.length === 1 ? info.workspaces[0]!.id : null;
    const finalInfo = tid ? (await buildSessionInfo(user.id, tid))! : info;

    const res = NextResponse.json(finalInfo);
    res.cookies.set(SESSION_COOKIE, freshSessionToken(user.id, tid), sessionCookieOptions());
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
