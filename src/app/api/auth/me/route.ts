import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, buildSessionInfo, readVerifiedSession } from "@/onevity/shared/lib/auth";
import { passwordStatusOfSession } from "@/onevity/shared/services/password-security";

// GET /api/auth/me — session saat ini (user + tenant terpilih + daftar workspace)
// Task 33: + status umur kata sandi (best-effort) utk toast peringatan shell.
// T1-SECURITY: readVerifiedSession — token dicek terhadap User.sessionVersion
// (logout menaikkan versi → me langsung 401, bukan hanya cookie dihapus).
export async function GET(req: NextRequest) {
  try {
    const payload = await readVerifiedSession(req);
    if (!payload) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    const info = await buildSessionInfo(payload.uid, payload.tid);
    if (!info) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    const pwStatus = info.user.email
      ? await passwordStatusOfSession(payload.uid, payload.tid, info.user.email)
      : null;
    return NextResponse.json({ ...info, ...(pwStatus ? { password: pwStatus } : {}) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
