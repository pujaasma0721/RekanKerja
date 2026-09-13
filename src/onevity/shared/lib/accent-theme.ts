"use client";
// OneVity — TEMA AKSEN GLOBAL (dipilih di topbar).
// Warna-warna lama per modul (HR emerald, Payroll amber, Attendance teal, …)
// kini menjadi pilihan tema: SATU warna untuk SEMUA modul & halaman.
// Mekanisme: menimpa --primary/--ring via --accent-live sehingga seluruh
// komponen UI (shadcn) + halaman apa pun ikut berubah saat tema diganti.
import { create } from "zustand";

export interface AccentTheme {
  id: string;
  label: string;
  labelEn: string;
  /** aksen utama — light mode */
  hex: string;
  /** aksen versi dark mode (lebih terang agar kontras di latar gelap) */
  hexDark: string;
}

// Sumber warna: identitas modul lama (dipertahankan sebagai pilihan tema).
export const ACCENT_THEMES: AccentTheme[] = [
  { id: "emerald", label: "Emerald",   labelEn: "Emerald",   hex: "#10b981", hexDark: "#34d399" }, // sml. HR Base
  { id: "amber",   label: "Amber",     labelEn: "Amber",     hex: "#f59e0b", hexDark: "#fbbf24" }, // sml. Payroll
  { id: "teal",    label: "Teal",      labelEn: "Teal",      hex: "#14b8a6", hexDark: "#2dd4bf" }, // sml. Attendance
  { id: "cyan",    label: "Cyan",      labelEn: "Cyan",      hex: "#06b6d4", hexDark: "#22d3ee" }, // sml. Leave
  { id: "violet",  label: "Ungu Violet", labelEn: "Violet",  hex: "#8b5cf6", hexDark: "#a78bfa" }, // sml. Travel
  { id: "rose",    label: "Rose",      labelEn: "Rose",      hex: "#f43f5e", hexDark: "#fb7185" }, // sml. Medical
];

export const DEFAULT_ACCENT = "emerald";
const ACCENT_KEY = "onevity:accent";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Warna teks yang terbaca di atas aksen (tombol/badge solid). */
function readableFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? "#1c1917" : "#ffffff";
}

/** Tulis variabel --accent-live-* ke :root (dipanggil saat ganti tema & hydrate). */
export function applyAccentTheme(id: string): void {
  if (typeof document === "undefined") return;
  const th = ACCENT_THEMES.find((x) => x.id === id) ?? ACCENT_THEMES[0];
  const dark = document.documentElement.classList.contains("dark");
  const main = dark ? th.hexDark : th.hex;
  const [r, g, b] = hexToRgb(main);
  const s = document.documentElement.style;
  s.setProperty("--accent-live", main);
  s.setProperty("--accent-live-rgb", `${r} ${g} ${b}`);
  s.setProperty("--accent-live-fg", readableFg(main));
}

interface AccentThemeState {
  accent: string;
  setAccent: (id: string) => void;
  hydrate: () => void;
}

export const useAccentTheme = create<AccentThemeState>((set) => ({
  accent: DEFAULT_ACCENT,
  setAccent: (id) => {
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(ACCENT_KEY, id); } catch { /* storage bisa diblokir */ }
    }
    applyAccentTheme(id);
    set({ accent: id });
  },
  hydrate: () => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(ACCENT_KEY);
      const id = v && ACCENT_THEMES.some((t) => t.id === v) ? v : DEFAULT_ACCENT;
      applyAccentTheme(id);
      set({ accent: id });
    } catch { /* abaikan */ }
  },
}));
