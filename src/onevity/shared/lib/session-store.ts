"use client";
// OneVity SaaS session store (client, zustand) — gerbang auth + konteks workspace.
// Status: loading → anonymous (login/daftar) → select-tenant (pilih workspace) → ready.
// JANGAN impor tipe dari src/lib/onevity/auth.ts (modul server) — tipe didefinisikan lokal.
import { create } from "zustand";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
}
export interface SessionTenant {
  id: string;
  name: string;
  /** Kode perusahaan workspace (A-Z0-9) — null bila tenant lama tanpa kode. */
  companyCode: string | null;
  slug: string;
  plan: string;
  role: string;
}
export interface SessionPasswordStatus {
  expired: boolean;
  remainingDays: number | null;
  warn: boolean;
  label: string;
}
export interface SessionInfo {
  user: SessionUser;
  tenant: SessionTenant | null;
  workspaces: SessionTenant[];
  /** status umur kata sandi (Task 33) — opsional, best-effort dari /api/auth/me */
  password?: SessionPasswordStatus;
  /** Task 64k — batas idle sesi workspace aktif (menit; tidak ada/null = nonaktif) */
  idleTimeoutMinutes?: number;
}
export type SessionStatus = "loading" | "anonymous" | "select-tenant" | "ready";

/** Hasil langkah-1 login (T17-MFA): mfaRequired → UI beralih ke step OTP. */
export interface LoginResult {
  ok: boolean;
  mfaRequired: boolean;
  mfaToken: string | null;
}

/** Task 78 — sinyal khusus login lewat subdomain tenant (tanpa cookie di-set). */
interface LoginHostSignals {
  host?: boolean; // user anggota workspace LAIN → arahkan ke alamat workspace-nya
  noWorkspaces?: boolean; // pendaftaran via subdomain belum selesai → lanjut daftar
}

interface SessionState {
  status: SessionStatus;
  info: SessionInfo | null;
  busy: boolean; // login/register/select-tenant/verify MFA sedang berjalan
  error: string | null;
  /** Task 64k — true bila sesi berakhir (kedaluwarsa/idle) → UI menampilkan pesan di layar login. */
  expired: boolean;
  /** Task 64k — alasan sesi berakhir (utk pesan AuthScreen). */
  expiredReason: "timeout" | "idle" | null;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (input: { workspaceName: string; companyCode: string; fullName: string; email: string; password: string }) => Promise<boolean>;
  selectTenant: (tenantId: string) => Promise<boolean>;
  /** Langkah-2 login MFA (T17-MFA): tukar mfaToken + kode 6 digit → sesi. */
  verifyMfa: (mfaToken: string, token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** Task 64k — tandai sesi berakhir (dipanggil interceptor 401 & timer idle). */
  expire: (reason: "timeout" | "idle") => void;
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

function applyInfo(info: SessionInfo): Partial<SessionState> {
  return { info, status: info.tenant ? ("ready" as const) : ("select-tenant" as const), expired: false };
}

/**
 * Task 78 — URL host utama (tanpa subdomain) utk redirect UI.
 * Host sekarang = subdomain berakhiran salah satu base domain (env
 * ONEVITY_BASE_DOMAINS dibaca server via /api/auth/host-workspace — tapi ini
 * butuh sinkronisasi; cukup strip SATU label pertama bila host punya ≥3 label
 * dan bukan IP/localhost). Contoh: sayone.onevity.id → onevity.id.
 */
function workspacesHostUrl(): string | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hostname;
  const parts = h.split(".");
  if (parts.length < 3) return null; // host utama / localhost — tidak perlu redirect
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === "localhost") return null;
  return `${window.location.protocol}//${parts.slice(1).join(".")}${window.location.port ? `:${window.location.port}` : ""}`;
}

export const useSession = create<SessionState>((set) => ({
  status: "loading",
  info: null,
  busy: false,
  error: null,
  expired: false,
  expiredReason: null,
  clearError: () => set({ error: null }),

  load: async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const info = (await res.json()) as SessionInfo;
        set(applyInfo(info));
      } else {
        set({ status: "anonymous", info: null, expired: false, expiredReason: null });
      }
    } catch {
      set({ status: "anonymous", info: null, expired: false, expiredReason: null });
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    const { ok, data } = await postJson<SessionInfo & { mfaRequired?: boolean; mfaToken?: string } & LoginHostSignals>("/api/auth/login", {
      email,
      password,
    });
    if (!ok) {
      set({ busy: false, error: data.error ?? "Gagal masuk" });
      // Task 78: login lewat subdomain workspace lain → redirect ke host utama
      // (di sana layar pilih workspace tersedia). Cookie TIDAK di-set server.
      if (data.host) {
        const primary = workspacesHostUrl();
        if (primary) { window.location.href = primary; return { ok: false, mfaRequired: false, mfaToken: null }; }
      }
      return { ok: false, mfaRequired: false, mfaToken: null };
    }
    // T17-MFA: password benar tapi akun ber-MFA → cookie belum di-set server;
    // UI harus meminta kode 6 digit lalu memanggil verifyMfa.
    if (data.mfaRequired && data.mfaToken) {
      set({ busy: false });
      return { ok: false, mfaRequired: true, mfaToken: data.mfaToken };
    }
    set({ busy: false, ...applyInfo(data) });
    return { ok: true, mfaRequired: false, mfaToken: null };
  },

  verifyMfa: async (mfaToken, token) => {
    set({ busy: true, error: null });
    const { ok, data } = await postJson<SessionInfo>("/api/auth/mfa/verify", { mfaToken, token });
    if (!ok) {
      set({ busy: false, error: data.error ?? "Verifikasi gagal" });
      return false;
    }
    set({ busy: false, ...applyInfo(data) });
    return true;
  },

  register: async (input) => {
    set({ busy: true, error: null });
    const { ok, data } = await postJson<SessionInfo>("/api/auth/register", input);
    if (!ok) {
      set({ busy: false, error: data.error ?? "Gagal membuat workspace" });
      return false;
    }
    set({ busy: false, ...applyInfo(data) });
    return true;
  },

  selectTenant: async (tenantId) => {
    set({ busy: true, error: null });
    const { ok, data } = await postJson<SessionInfo>("/api/auth/select-tenant", { tenantId });
    if (!ok) {
      set({ busy: false, error: data.error ?? "Gagal memilih workspace" });
      return false;
    }
    set({ busy: false, ...applyInfo(data) });
    return true;
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // abaikan — cookie lokal tetap dibersihkan via status
    }
    set({ status: "anonymous", info: null, error: null, expired: false, expiredReason: null });
  },

  expire: (reason) => {
    // Revokasi lokal: token di browser tetap ada tapi tidak sah (server menolak
    // via exp/idle policy) — status anonymous menampilkan AuthScreen; flag
    // `expired` memicu pesan "Sesi berakhir" pada layar login.
    set({ status: "anonymous", info: null, error: null, expired: true, expiredReason: reason });
  },
}));
