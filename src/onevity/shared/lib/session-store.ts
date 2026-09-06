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
}
export type SessionStatus = "loading" | "anonymous" | "select-tenant" | "ready";

/** Hasil langkah-1 login (T17-MFA): mfaRequired → UI beralih ke step OTP. */
export interface LoginResult {
  ok: boolean;
  mfaRequired: boolean;
  mfaToken: string | null;
}

interface SessionState {
  status: SessionStatus;
  info: SessionInfo | null;
  busy: boolean; // login/register/select-tenant/verify MFA sedang berjalan
  error: string | null;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (input: { workspaceName: string; fullName: string; email: string; password: string }) => Promise<boolean>;
  selectTenant: (tenantId: string) => Promise<boolean>;
  /** Langkah-2 login MFA (T17-MFA): tukar mfaToken + kode 6 digit → sesi. */
  verifyMfa: (mfaToken: string, token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
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
  return { info, status: info.tenant ? ("ready" as const) : ("select-tenant" as const) };
}

export const useSession = create<SessionState>((set) => ({
  status: "loading",
  info: null,
  busy: false,
  error: null,
  clearError: () => set({ error: null }),

  load: async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const info = (await res.json()) as SessionInfo;
        set(applyInfo(info));
      } else {
        set({ status: "anonymous", info: null });
      }
    } catch {
      set({ status: "anonymous", info: null });
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    const { ok, data } = await postJson<SessionInfo & { mfaRequired?: boolean; mfaToken?: string }>("/api/auth/login", {
      email,
      password,
    });
    if (!ok) {
      set({ busy: false, error: data.error ?? "Gagal masuk" });
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
    set({ status: "anonymous", info: null, error: null });
  },
}));
