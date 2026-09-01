"use client";
// OneVity SPA navigation — zustand store + URL query sync
import { create } from "zustand";

export type SectionId =
  | "dashboard"
  | "org"
  | "position"
  | "employee"
  | "actions"
  | "payroll"
  | "settings";

export interface NavState {
  section: SectionId;
  view: string; // sub-view inside section
  params: Record<string, string>; // e.g. { id, wizard }
  navigate: (section: SectionId, view?: string, params?: Record<string, string>) => void;
  setParams: (params: Record<string, string>) => void;
  syncFromUrl: () => void;
}

const VALID: SectionId[] = ["dashboard", "org", "position", "employee", "actions", "payroll", "settings"];

function parseUrl(): { section: SectionId; view: string; params: Record<string, string> } {
  if (typeof window === "undefined") return { section: "dashboard", view: "overview", params: {} };
  const sp = new URLSearchParams(window.location.search);
  const s = (sp.get("s") ?? "dashboard") as SectionId;
  const section = VALID.includes(s) ? s : "dashboard";
  const view = sp.get("v") ?? defaultView(section);
  const params: Record<string, string> = {};
  if (sp.get("id")) params.id = sp.get("id")!;
  if (sp.get("wizard")) params.wizard = sp.get("wizard")!;
  return { section, view, params };
}

export function defaultView(section: SectionId): string {
  switch (section) {
    case "org": return "companies"; // item pertama grup "Perusahaan & Organisasi"
    case "position": return "list";
    case "employee": return "directory";
    case "actions": return "inbox";
    case "payroll": return "components";
    case "settings": return "lookups";
    default: return "overview";
  }
}

function writeUrl(section: SectionId, view: string, params: Record<string, string>) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  if (section !== "dashboard") sp.set("s", section);
  if (view !== defaultView(section)) sp.set("v", view);
  if (params.id) sp.set("id", params.id);
  if (params.wizard) sp.set("wizard", params.wizard);
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
}

export const useNav = create<NavState>((set, get) => ({
  section: "dashboard",
  view: "overview",
  params: {},
  navigate: (section, view, params) => {
    const v = view ?? defaultView(section);
    const p = params ?? {};
    writeUrl(section, v, p);
    set({ section, view: v, params: p });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  },
  setParams: (params) => {
    const { section, view } = get();
    writeUrl(section, view, params);
    set({ params });
  },
  syncFromUrl: () => {
    const { section, view, params } = parseUrl();
    if (section !== get().section || view !== get().view) set({ section, view, params });
  },
}));
