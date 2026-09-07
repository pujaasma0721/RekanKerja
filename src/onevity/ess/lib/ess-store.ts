"use client";
// Portal Karyawan (ESS) — navigasi tanpa sidebar: topnav (desktop) +
// bottom tab bar (mobile). URL: /?area=ess&p=<page>. Area ESS terpisah
// dari aplikasi admin (m=hr&s=...) pada satu route "/" yang sama.
import { create } from "zustand";

export type EssPage = "home" | "attendance" | "leave" | "payslips" | "approvals" | "profile";

export const ESS_PAGES: EssPage[] = ["home", "attendance", "leave", "payslips", "approvals", "profile"];

export interface EssNavState {
  page: EssPage;
  /** params ringan (mis. { dialog: "request" } untuk buka form ajukan cuti) */
  params: Record<string, string>;
  navigate: (page: EssPage, params?: Record<string, string>) => void;
  setParams: (params: Record<string, string>) => void;
  syncFromUrl: () => void;
}

function parsePage(): EssPage {
  if (typeof window === "undefined") return "home";
  const sp = new URLSearchParams(window.location.search);
  const p = (sp.get("p") ?? "home") as EssPage;
  return ESS_PAGES.includes(p) ? p : "home";
}

function parseParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  if (sp.get("dialog")) out.dialog = sp.get("dialog")!;
  return out;
}

function writeUrl(page: EssPage, params: Record<string, string>) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  sp.set("area", "ess");
  if (page !== "home") sp.set("p", page);
  if (params.dialog) sp.set("dialog", params.dialog);
  window.history.replaceState(null, "", `/?${sp.toString()}`);
}

export const useEssNav = create<EssNavState>((set, get) => ({
  page: "home",
  params: {},
  navigate: (page, params) => {
    const p = params ?? {};
    writeUrl(page, p);
    set({ page, params: p });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  },
  setParams: (params) => {
    const { page } = get();
    writeUrl(page, params);
    set({ params });
  },
  syncFromUrl: () => {
    const page = parsePage();
    const params = parseParams();
    const cur = get();
    if (page !== cur.page || JSON.stringify(params) !== JSON.stringify(cur.params)) set({ page, params });
  },
}));

// ============ perpindahan area admin ↔ ESS (satu route "/", tanpa reload) ============

const ADMIN_URL_KEY = "onevity:admin-url";
export const AREA_EVENT = "onevity:area";

/** Simpan URL admin terakhir lalu pindah ke Portal Karyawan. */
export function enterEss() {
  try {
    const qs = window.location.search;
    sessionStorage.setItem(ADMIN_URL_KEY, qs);
  } catch { /* ignore */ }
  window.history.pushState(null, "", "/?area=ess");
  window.dispatchEvent(new Event(AREA_EVENT));
}

/** Kembali ke aplikasi admin (URL admin terakhir dipulihkan). */
export function exitEss() {
  let qs = "";
  try {
    qs = sessionStorage.getItem(ADMIN_URL_KEY) ?? "";
  } catch { /* ignore */ }
  window.history.pushState(null, "", qs ? `/${qs}` : "/");
  window.dispatchEvent(new Event(AREA_EVENT));
}

/** Area aktif dari URL — null bila belum ditentukan (perlu keputusan landing). */
export function areaFromUrl(): "admin" | "ess" | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const area = sp.get("area");
  if (area === "ess") return "ess";
  if (area === "admin") return "admin";
  return null;
}
