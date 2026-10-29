// RekanKerja — Online Support P2/P3/P4 (FEAT-SUPPORT-P2 · P3 · P4): konfig agen.
// =====================================================================
//   GET  → { config: { toolsEnabled, browserEnabled, patchEnabled,
//                      browserLoginEmail, hasBrowserLoginPass } }  (baris
//                      ABSEN → default true)
//   PUT  → salah satu / gabungan field berikut (minimal satu):
//          · toolsEnabled: boolean      — mode diagnosis L2 (alat baca).
//          · browserEnabled: boolean   — mode reproduksi browser L3.
//          · patchEnabled: boolean     — mode usulan patch L4 (approval
//                                        tetap di tangan developer manusia).
//          · browserLoginEmail: string|null — akun uji reproduksi browser.
//          · browserLoginPass: string  — kata sandi akun uji (WRITE-ONLY:
//            dienkripsi field-crypto lalu disimpan browserLoginPassEnc;
//            tidak pernah dikirim balik ke client — hanya hasBrowserLoginPass).
//          · clearBrowserLogin: true   — hapus akun uji (email + sandi).
// Guard: sesi tenant valid utk GET; PUT memakai op settings:ai-provider
//          update (admin) — kartu ini tampil di halaman Pengaturan → AI.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

interface AgentCfgRow {
  id: string;
  toolsEnabled: boolean;
  browserEnabled: boolean;
  patchEnabled: boolean;
  browserLoginEmail: string | null;
  browserLoginPassEnc: string | null;
}

async function readConfig(db: TenantDb): Promise<AgentCfgRow | null> {
  return (await db.supportAgentConfig.findFirst().catch(() => null)) as AgentCfgRow | null;
}

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    let toolsEnabled = true;
    let browserEnabled = true;
    let patchEnabled = true;
    let browserLoginEmail: string | null = null;
    let hasBrowserLoginPass = false;
    try {
      const row = await readConfig(db);
      if (row) {
        toolsEnabled = row.toolsEnabled !== false;
        browserEnabled = row.browserEnabled !== false;
        patchEnabled = row.patchEnabled !== false;
        browserLoginEmail = row.browserLoginEmail ?? null;
        hasBrowserLoginPass = Boolean(row.browserLoginPassEnc);
      }
    } catch { /* tabel belum termigrasi → default ON */ }
    return NextResponse.json({ config: { toolsEnabled, browserEnabled, patchEnabled, browserLoginEmail, hasBrowserLoginPass } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:ai-provider", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const keys = ["toolsEnabled", "browserEnabled", "patchEnabled", "browserLoginEmail", "browserLoginPass", "clearBrowserLogin"];
    if (!keys.some((k) => b[k] !== undefined)) {
      return NextResponse.json(
        { error: `Kirim minimal satu field: ${keys.join(" / ")}` },
        { status: 400 },
      );
    }

    // ---- validasi per field ----
    const toolsEnabled = typeof b.toolsEnabled === "boolean" ? b.toolsEnabled : null;
    const browserEnabled = typeof b.browserEnabled === "boolean" ? b.browserEnabled : null;
    const patchEnabled = typeof b.patchEnabled === "boolean" ? b.patchEnabled : null;
    let browserLoginEmail: string | null | undefined;
    if (b.browserLoginEmail !== undefined) {
      const email = String(b.browserLoginEmail ?? "").trim().slice(0, 120);
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return NextResponse.json({ error: "Format email akun uji tidak valid" }, { status: 400 });
        }
        browserLoginEmail = email;
      } else {
        browserLoginEmail = null; // kosong = hapus email saja
      }
    }
    let browserLoginPassEnc: string | null | undefined;
    if (b.clearBrowserLogin === true) {
      browserLoginEmail = null;
      browserLoginPassEnc = null;
    } else if (b.browserLoginPass !== undefined && b.browserLoginPass !== null && String(b.browserLoginPass).length > 0) {
      const pass = String(b.browserLoginPass);
      if (pass.length < 6 || pass.length > 128) {
        return NextResponse.json({ error: "Kata sandi akun uji harus 6–128 karakter" }, { status: 400 });
      }
      // Terenkripsi field-crypto per-tenant (pola AiProviderConfig.apiKey).
      browserLoginPassEnc = tenantCryptoForDb(db).encryptText(pass.slice(0, 128));
    }

    const existing = await readConfig(db);
    const data: Record<string, unknown> = {};
    if (toolsEnabled !== null) data.toolsEnabled = toolsEnabled;
    if (browserEnabled !== null) data.browserEnabled = browserEnabled;
    if (patchEnabled !== null) data.patchEnabled = patchEnabled;
    if (browserLoginEmail !== undefined) data.browserLoginEmail = browserLoginEmail;
    if (browserLoginPassEnc !== undefined) data.browserLoginPassEnc = browserLoginPassEnc;
    if (existing) {
      await db.supportAgentConfig.update({ where: { id: existing.id }, data });
    } else {
      // singleton — id default cuid; kolom wajib lain memakai nilai kirim/default
      await db.supportAgentConfig.create({
        data: {
          ...(toolsEnabled !== null ? { toolsEnabled } : {}),
          ...(browserEnabled !== null ? { browserEnabled } : {}),
          ...(patchEnabled !== null ? { patchEnabled } : {}),
          ...(browserLoginEmail !== undefined ? { browserLoginEmail } : {}),
          ...(browserLoginPassEnc !== undefined ? { browserLoginPassEnc } : {}),
        },
      });
    }

    const row = await readConfig(db);
    return NextResponse.json({
      config: {
        toolsEnabled: row ? row.toolsEnabled !== false : true,
        browserEnabled: row ? row.browserEnabled !== false : true,
        patchEnabled: row ? row.patchEnabled !== false : true,
        browserLoginEmail: row?.browserLoginEmail ?? null,
        hasBrowserLoginPass: Boolean(row?.browserLoginPassEnc),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
