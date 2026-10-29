"use client";
// OneVity SPA navigation — zustand store + URL query sync
// Module system: 6 modul besar (dropdown sidebar) — tiap modul punya section & menu sendiri.
import { create } from "zustand";

export type ModuleId =
  | "hr"
  | "payroll"
  | "attendance"
  | "leave"
  | "travel"
  | "medical";

export type SectionId =
  | "dashboard"
  | "org"
  | "position"
  | "employee"
  | "actions"
  | "payroll"
  | "settings"
  | "attendance"
  | "leave"
  | "travel"
  | "medical";

export interface NavState {
  module: ModuleId;
  section: SectionId;
  view: string; // sub-view inside section
  params: Record<string, string>; // e.g. { id, wizard }
  navigate: (section: SectionId, view?: string, params?: Record<string, string>) => void;
  setModule: (m: ModuleId) => void;
  setParams: (params: Record<string, string>) => void;
  syncFromUrl: () => void;
}

const VALID_MODULES: ModuleId[] = ["hr", "payroll", "attendance", "leave", "travel", "medical"];
const VALID: SectionId[] = ["dashboard", "org", "position", "employee", "actions", "payroll", "settings", "attendance", "leave", "travel", "medical"];

export const MODULE_LABEL: Record<ModuleId, string> = {
  hr: "Human Resource Base",
  payroll: "Payroll",
  attendance: "Attendance",
  leave: "Leave",
  travel: "Travel",
  medical: "Medical",
};

export function moduleOfSection(section: SectionId): ModuleId {
  switch (section) {
    case "payroll":
      return "payroll";
    case "attendance":
      return "attendance";
    case "leave":
      return "leave";
    case "travel":
      return "travel";
    case "medical":
      return "medical";
    default:
      return "hr"; // dashboard, org, position, employee, actions, settings
  }
}

export function defaultSectionOfModule(m: ModuleId): SectionId {
  switch (m) {
    case "payroll":
      return "payroll";
    case "attendance":
      return "attendance";
    case "leave":
      return "leave";
    case "travel":
      return "travel";
    case "medical":
      return "medical";
    default:
      return "dashboard";
  }
}

export function defaultView(section: SectionId): string {
  switch (section) {
    case "org": return "companies"; // item pertama grup "Perusahaan & Organisasi"
    case "position": return "list";
    case "employee": return "directory";
    case "actions": return "inbox";
    case "payroll": return "overview";
    case "settings": return "lookups";
    case "attendance": return "schedules";
    case "leave": return "balances";
    case "travel": return "requests";
    case "medical": return "claims";
    default: return "overview";
  }
}

function parseUrl(): { module: ModuleId; section: SectionId; view: string; params: Record<string, string> } {
  if (typeof window === "undefined") return { module: "hr", section: "dashboard", view: "overview", params: {} };
  const sp = new URLSearchParams(window.location.search);
  const m = (sp.get("m") ?? "hr") as ModuleId;
  const mod: ModuleId = VALID_MODULES.includes(m) ? m : "hr";
  const s = (sp.get("s") ?? defaultSectionOfModule(mod)) as SectionId;
  let section = VALID.includes(s) ? s : defaultSectionOfModule(mod);
  // jaga konsistensi section ↔ module (mis. ?m=payroll&s=employee tidak valid)
  if (moduleOfSection(section) !== mod) section = defaultSectionOfModule(mod);
  const view = sp.get("v") ?? defaultView(section);
  const params: Record<string, string> = {};
  if (sp.get("id")) params.id = sp.get("id")!;
  if (sp.get("wizard")) params.wizard = sp.get("wizard")!;
  return { module: mod, section, view, params };
}

function writeUrl(mod: ModuleId, section: SectionId, view: string, params: Record<string, string>) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  if (mod !== "hr") sp.set("m", mod);
  if (section !== defaultSectionOfModule(mod)) sp.set("s", section);
  if (view !== defaultView(section)) sp.set("v", view);
  if (params.id) sp.set("id", params.id);
  if (params.wizard) sp.set("wizard", params.wizard);
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
}

export const useNav = create<NavState>((set, get) => ({
  module: "hr",
  section: "dashboard",
  view: "overview",
  params: {},
  navigate: (section, view, params) => {
    const mod = moduleOfSection(section);
    const v = view ?? defaultView(section);
    const p = params ?? {};
    writeUrl(mod, section, v, p);
    set({ module: mod, section, view: v, params: p });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  },
  setModule: (m) => {
    const section = defaultSectionOfModule(m);
    const view = defaultView(section);
    writeUrl(m, section, view, {});
    set({ module: m, section, view, params: {} });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  },
  setParams: (params) => {
    const { module, section, view } = get();
    writeUrl(module, section, view, params);
    set({ params });
  },
  syncFromUrl: () => {
    const state = parseUrl();
    const cur = get();
    if (state.module !== cur.module || state.section !== cur.section || state.view !== cur.view) set(state);
  },
}));
