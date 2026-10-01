"use client";
// RekanKerja SaaS session store (client, zustand) — gerbang auth + konteks workspace.
// Status: loading → anonymous (login/daftar) → select-tenant (pilih workspace) → ready.
// JANGAN impor tipe dari src/lib/rekankerja/auth.ts (modul server) — tipe didefinisikan lokal.
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
export interface SessionInfo {
  user: SessionUser;
  tenant: SessionTenant | null;
  workspaces: SessionTenant[];
}
export type SessionStatus = "loading" | "anonymous" | "select-tenant" | "ready";

interface SessionState {
  status: SessionStatus;
  info: SessionInfo | null;
  busy: boolean; // login/register/select-tenant sedang berjalan
  error: string | null;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (input: { workspaceName: string; fullName: string; email: string; password: string }) => Promise<boolean>;
  selectTenant: (tenantId: string) => Promise<boolean>;
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
    const { ok, data } = await postJson<SessionInfo>("/api/auth/login", { email, password });
    if (!ok) {
      set({ busy: false, error: data.error ?? "Gagal masuk" });
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
