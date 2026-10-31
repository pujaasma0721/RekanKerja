// RekanKerja — Online Support P2/P3/P4/P10 (FEAT-SUPPORT-P2 · P3 · P4): konfig agen.
// =====================================================================
//   GET  → { config: { toolsEnabled, browserEnabled, patchEnabled,
//                      browserLoginEmail, hasBrowserLoginPass } }  (baris
//                      ABSEN → default true; hanya utk INFO tenant —
//                      sakelar alat TIDAK lagi bisa diubah dari sisi tenant)
//   PUT  → salah satu / gabungan field berikut (minimal satu):
//          · browserLoginEmail: string|null — akun uji reproduksi browser.
//          · browserLoginPass: string  — kata sandi akun uji (WRITE-ONLY:
//            dienkripsi field-crypto lalu disimpan browserLoginPassEnc;
//            tidak pernah dikirim balik ke client — hanya hasBrowserLoginPass).
//          · clearBrowserLogin: true   — hapus akun uji (email + sandi).
//   (P10) toolsEnabled/browserEnabled/patchEnabled — sakelar ALAT AGEN
//          (mode diagnosis L2, reproduksi browser L3, usulan patch L4) —
//          kini KEWENANGAN PEMILIK APLIKASI lewat konsol Platform Admin
//          (alat menyentuh kode aplikasi & infrastruktur platform, bukan
//          ranah tenant). Kirim field tersebut dari tenant → 403.
// Guard: GET = aktor support valid + layanan aktif (paritas route lain);
//          PUT memakai op settings:ai-provider update (admin) — kartu ini
//          tampil di halaman Pengaturan → AI.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  resolveSupportActor, supportActorDenied, supportServiceDenied,
} from "@/rekankerja/support/api/support-auth";
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
    // R4/M2 (audit-2) — samakan gate dengan seluruh route support lain:
    // aktor valid (profil AppUser tenant) + layanan AKTIF. Sebelumnya GET
    // hanya memakai requireTenant — sesi valid apa pun (termasuk pengguna
    // tanpa profil, atau saat layanan sudah dinonaktifkan pemilik aplikasi)
    // bisa membaca email akun uji browser + status alat agen.
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const svc = await supportServiceDenied(a); // P5 — gate layanan berbayar
    if (svc) return svc;
    const db = a.db;
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

    // P10 — sakelar alat agen adalah kewenangan pemilik aplikasi (konsol
    // Platform Admin); dari sisi tenant ditolak eksplisit dengan pesan jelas.
    if (b.toolsEnabled !== undefined || b.browserEnabled !== undefined || b.patchEnabled !== undefined) {
      return NextResponse.json(
        {
          error:
            "Sakelar alat agen support (mode diagnosis, reproduksi browser, usulan patch) dikelola pemilik aplikasi lewat konsol Platform Admin — bukan pengaturan tenant. Yang dapat Anda kelola di sini hanya akun uji browser.",
        },
        { status: 403 },
      );
    }

    const keys = ["browserLoginEmail", "browserLoginPass", "clearBrowserLogin"];
    if (!keys.some((k) => b[k] !== undefined)) {
      return NextResponse.json(
        { error: `Kirim minimal satu field: ${keys.join(" / ")}` },
        { status: 400 },
      );
    }

    // ---- validasi per field ----
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
    if (browserLoginEmail !== undefined) data.browserLoginEmail = browserLoginEmail;
    if (browserLoginPassEnc !== undefined) data.browserLoginPassEnc = browserLoginPassEnc;
    if (existing) {
      await db.supportAgentConfig.update({ where: { id: existing.id }, data });
    } else {
      // singleton — id default cuid; kolom wajib lain memakai nilai kirim/default
      await db.supportAgentConfig.create({
        data: {
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
