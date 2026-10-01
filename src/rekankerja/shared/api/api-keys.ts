// ============ API KEYS (T18-API) — manajemen kunci Public API ============
// GET    → daftar kunci (prefix + nama + scopes + lastUsed + revoked)
// POST   → buat kunci { name, scopes[] } → kunci PENUH dikembalikan SEKALI
// PATCH  → cabut kunci { id, action: "revoke" }
// Guard: menu settings:api + HANYA Admin platform (OWNER/ADMIN) atau AppUser
// Admin (superadmin) — kunci & webhook menembus seluruh data tenant (T1
// fail-closed: role lain ditolak meski menu diizinkan).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, type MenuActor } from "@/rekankerja/shared/services/menu-access";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "@/rekankerja/shared/services/access-scope";
import { generateApiKey, listApiKeys, revokeApiKey, normalizeScopes, API_SCOPES } from "@/rekankerja/shared/services/apikey-service";

/** Fail-closed: hanya platform OWNER/ADMIN atau AppUser Admin. */
function isAdminActor(actor: MenuActor): boolean {
  return (
    SUPER_ADMIN_PLATFORM_ROLES.includes(actor.role) ||
    (actor.appUserRole != null && SUPER_ADMIN_APP_ROLES.includes(actor.appUserRole))
  );
}

const ADMIN_ONLY_MSG =
  "Akses ditolak: kunci API hanya boleh dikelola oleh Admin platform / AppUser Admin (superadmin).";

async function audit(
  db: Parameters<typeof listApiKeys>[0],
  actor: MenuActor,
  action: string,
  detail: string,
): Promise<void> {
  await db.activityLog
    .create({ data: { appUserId: actor.appUserId ?? null, action, entity: "ApiKey", detail } })
    .catch(() => { /* audit gagal — jangan gagalkan aksi */ });
}

// GET — daftar kunci (tanpa hash; prefix saja)
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:api", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const keys = await listApiKeys(m.db);
    return NextResponse.json({ keys, scopes: API_SCOPES });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat kunci baru (kunci penuh dikembalikan SEKALI di response ini)
export async function POST(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:api", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Nama kunci wajib diisi" }, { status: 400 });
    const scopes = normalizeScopes(b.scopes);
    if (scopes.length === 0) {
      return NextResponse.json({ error: "Pilih minimal satu scope (employees / leave / payroll)" }, { status: 400 });
    }

    const { key, record } = await generateApiKey(m.db, { name, scopes });
    await audit(m.db, m.actor, "Created", `Kunci API "${name}" (${record.prefix}…) dibuat oleh ${m.actor.name} — scope: ${scopes.join(", ")}`);

    return NextResponse.json(
      {
        key, // TAMPILKAN SEKALI — simpan sekarang, tidak bisa dilihat lagi
        record,
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH — cabut kunci { id, action: "revoke" }
export async function PATCH(req: NextRequest | Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action !== "revoke") {
      return NextResponse.json({ error: 'Aksi tidak dikenal — hanya "revoke"' }, { status: 400 });
    }
    // op:revoke — operasi khusus menu settings:api (Task 32 pattern)
    const m = await requireMenuAction(req, "settings:api", "op:revoke");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const record = await revokeApiKey(m.db, id);
    if (!record) return NextResponse.json({ error: "Kunci tidak ditemukan" }, { status: 404 });

    await audit(m.db, m.actor, "Updated", `Kunci API "${record.name}" (${record.prefix}…) DICABUT oleh ${m.actor.name} — request berikutnya 401`);
    return NextResponse.json({ record });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
