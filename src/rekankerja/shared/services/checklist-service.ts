// RekanKerja — Checklist Onboarding/Offboarding per bagian (Task 65) =========
// Sumber tunggal konsep "bagian" (owner checklist): Supervisor, IT, GA,
// Finance, HR, Payroll. Dipakai bersama oleh:
//   • API onboarding & offboarding (buat proses + kirim email per bagian)
//   • Halaman checklist publik via token (centang hanya bagiannya sendiri)
//   • In-app: user hanya boleh mencentang tugas bagiannya sendiri
//     (Admin/HR/OWNER/PLATFORM-ADMIN bebas — koordinator checklist)
// Penerima email per bagian disimpan di Lookup (category "ChecklistDeptEmail",
// code = kode bagian, label = email dipisah koma/SPASI — fallback ke
// approverEmailsOf saat belum dikonfigurasi).
// =====================================================================
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { approverEmailsOf, type EmailRecipient } from "@/rekankerja/shared/services/email-service";
import { sessionSecret } from "@/rekankerja/shared/lib/auth";
import { TENANT_SCHEMA_BRAND } from "@/rekankerja/shared/lib/field-crypto";

/** Kode bagian yang dikenal sistem (label Indonesia utk UI/email). */
export const CHECKLIST_DEPARTMENTS = [
  { code: "Supervisor", label: "Supervisor / Atasan Langsung" },
  { code: "IT", label: "IT" },
  { code: "GA", label: "General Affairs (GA)" },
  { code: "Finance", label: "Finance / Keuangan" },
  { code: "HR", label: "HR / Personalia" },
  { code: "Payroll", label: "Payroll" },
] as const;

export type ChecklistDeptCode = (typeof CHECKLIST_DEPARTMENTS)[number]["code"];

const DEPT_CODES = CHECKLIST_DEPARTMENTS.map((d) => d.code) as string[];

export function isChecklistDept(v: string | null | undefined): v is ChecklistDeptCode {
  return !!v && DEPT_CODES.includes(v);
}

export function deptLabelOf(code: string | null | undefined): string {
  return CHECKLIST_DEPARTMENTS.find((d) => d.code === code)?.label ?? code ?? "-";
}

const LOOKUP_CATEGORY = "ChecklistDeptEmail";

// ---------- penerima email per bagian ----------

/** Parse isi Lookup.label → daftar email (pisah koma/spasi/baris baru). */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/** Simpan penerima email satu bagian (dipanggil API recipients). */
export async function setDeptRecipients(db: TenantDb, dept: string, emails: string[]): Promise<void> {
  if (!isChecklistDept(dept)) throw new Error(`Bagian tidak dikenal: ${dept}`);
  const uniq = [...new Set(emails.map((e) => e.trim()).filter(Boolean))];
  const value = uniq.join(", ");
  await db.lookup.upsert({
    where: { category_code: { category: LOOKUP_CATEGORY, code: dept } },
    create: { category: LOOKUP_CATEGORY, code: dept, label: value || "-", sortOrder: DEPT_CODES.indexOf(dept) },
    update: { label: value || "-" },
  });
}

/** Baca penerima email satu bagian. */
export async function getDeptRecipients(db: TenantDb, dept: string): Promise<string[]> {
  const row = await db.lookup.findUnique({
    where: { category_code: { category: LOOKUP_CATEGORY, code: dept } },
    select: { label: true },
  });
  return row && row.label && row.label !== "-" ? parseEmails(row.label) : [];
}

/**
 * Penerima email checklist sebuah bagian — konfigurasi Lookup → fallback
 * AppUser Admin/HR aktif (approverEmailsOf) supaya tidak pernah kosong total.
 */
export async function resolveDeptEmails(db: TenantDb, dept: string): Promise<EmailRecipient[]> {
  const configured = await getDeptRecipients(db, dept);
  if (configured.length > 0) {
    return configured.map((email) => ({ email, name: deptLabelOf(dept) }));
  }
  return approverEmailsOf(db);
}

/** Penerima seluruh bagian yang punya tugas pada checklist (dipakai header email). */
export async function resolveDeptEmailsMany(db: TenantDb, depts: string[]): Promise<Map<string, EmailRecipient[]>> {
  const map = new Map<string, EmailRecipient[]>();
  for (const d of [...new Set(depts)]) {
    if (isChecklistDept(d)) map.set(d, await resolveDeptEmails(db, d));
  }
  return map;
}

// ---------- token checklist publik (HMAC) ----------

// Payload token: {kind}.{tenantSlug}.{processId}.{dept} — MAC dgn sessionSecret
// (kunci server sudah ada; tanpa env tambahan). Token membawa tenant →
// halaman publik cukup /checklist/{token} tanpa query param.
function macOf(kind: string, tenantSlug: string, processId: string, dept: string): string {
  return createHmac("sha256", sessionSecret()).update(`${kind}|${tenantSlug}|${processId}|${dept}`).digest("base64url");
}

export function makeChecklistToken(
  kind: "onboarding" | "offboarding",
  tenantSlug: string,
  processId: string,
  dept: string,
): string {
  return [kind, tenantSlug, Buffer.from(processId).toString("base64url"), Buffer.from(dept).toString("base64url"), macOf(kind, tenantSlug, processId, dept)]
    .join(".");
}

export type ChecklistTokenPayload =
  | { ok: true; kind: "onboarding" | "offboarding"; tenantSlug: string; processId: string; dept: string }
  | { ok: false };

export function verifyChecklistToken(token: string | null | undefined): ChecklistTokenPayload {
  if (!token) return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 5) return { ok: false };
  const [kind, tenantSlug, pidB, deptB, mac] = parts;
  if (kind !== "onboarding" && kind !== "offboarding") return { ok: false };
  let processId: string;
  let dept: string;
  try {
    processId = Buffer.from(pidB, "base64url").toString("utf8");
    dept = Buffer.from(deptB, "base64url").toString("utf8");
  } catch {
    return { ok: false };
  }
  if (!isChecklistDept(dept)) return { ok: false };
  const expect = macOf(kind, tenantSlug, processId, dept);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, kind, tenantSlug, processId, dept };
}

/** URL halaman publik checklist (base dari env APP_PUBLIC_URL / req). */
export function checklistUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/checklist/${encodeURIComponent(token)}`;
}

/** Base URL publik untuk link email: env APP_PUBLIC_URL → header proxy → host. */
export function publicBaseUrlOf(req: { headers: { get(name: string): string | null } }): string {
  const envUrl = process.env.APP_PUBLIC_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("192.168.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Slug tenant dari client tenant (brand schema `tenant_<slug>` → potong prefix,
 * underscore → strip; slug registry memakai strip). Dipakai menyusun token
 * checklist publik (tenant ikut dalam token).
 */
export function tenantSlugOf(db: TenantDb): string {
  const schema = (db as unknown as Record<string, unknown>)[TENANT_SCHEMA_BRAND];
  if (typeof schema !== "string" || !schema.startsWith("tenant_")) return "";
  return schema.slice("tenant_".length).replace(/_/g, "-");
}

// ---------- otorisasi centang per bagian ----------

export interface ChecklistActor {
  /** role workspace platform: OWNER | ADMIN | HR | VIEWER (MenuActor.role) */
  role: string;
  /** role AppUser tenant, mis. Admin / HR Manager / Supervisor / Viewer */
  appUserRole: string | null;
}

/** Koordinator checklist: boleh melihat & mencentang SEMUA bagian. */
export function isChecklistCoordinator(actor: ChecklistActor): boolean {
  return ["OWNER", "ADMIN"].includes(actor.role) || actor.appUserRole === "Admin";
}

/**
 * Bagian yang boleh dicentang user in-app:
 *   • koordinator → semua (null = tanpa batasan)
 *   • selain itu → bagian dari role AppUser (Supervisor→Supervisor,
 *     dst.) bila role terdaftar; role lain → tidak boleh centang apa pun.
 */
export function allowedDeptsOf(actor: ChecklistActor): string[] | null {
  if (isChecklistCoordinator(actor)) return null;
  const role = actor.appUserRole ?? "";
  if (DEPT_CODES.includes(role)) return [role];
  return [];
}

export function canTouchDept(actor: ChecklistActor, dept: string | null | undefined): boolean {
  const allowed = allowedDeptsOf(actor);
  if (allowed === null) return true;
  if (!dept) return false; // tugas tanpa owner → hanya koordinator
  return allowed.includes(dept);
}
