import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

// AUD-DEPLOY (2-b LOW-5): PRD internal = dokumen pengembangan — hanya
// tersedia di luar production (sandbox/dev/staging); produksi menolak 404.
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  try {
    const md = fs.readFileSync(path.join(process.cwd(), "PRD-HR-BASE.md"), "utf-8");
    const download = req.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": download
          ? 'attachment; filename="PRD-HR-BASE.md"'
          : 'inline; filename="PRD-HR-BASE.md"',
      },
    });
  } catch {
    return NextResponse.json({ error: "PRD markdown tidak ditemukan" }, { status: 404 });
  }
}
