import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "PRD markdown tidak ditemukan", detail: msg, cwd: process.cwd() }, { status: 404 });
  }
}
