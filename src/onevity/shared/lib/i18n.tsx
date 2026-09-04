"use client";
// OneVity i18n — provider & hook React. ======================================
// API: const { t, lang, setLang, locale, monthShort } = useI18n();
//   t("Simpan")                          → ID: "Simpan" | EN: kamus dasar
//   t("Gajikan periode {p}?", "Pay period {p}?", { p }) → interpolasi {token}
// Bahasa tersimpan localStorage "onevity:lang" + cookie, default "id".
// <html lang> ikut diperbarui (aksesibilitas). Selain React context, state
// juga disinkronkan ke modul i18n-core agar helper non-React (fmtDate dll.)
// mengikuti bahasa aktif.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  setGlobalLang, translate, monthsShort as monthsShortOf,
  type Lang,
} from "@/onevity/shared/lib/i18n-core";

export { LANG_OPTIONS, BASE_EN, type Lang, loc } from "@/onevity/shared/lib/i18n-core";
export { translate } from "@/onevity/shared/lib/i18n-core";

const STORAGE_KEY = "onevity:lang";

export interface I18nApi {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Ganti bahasa id ↔ en (praktis untuk tombol toggle). */
  toggleLang: () => void;
  /** Terjemahkan: (1) teks Indonesia sumber, (2) EN opsional, (3) variabel {token}. */
  t: (id: string, en?: string, vars?: Record<string, string | number>) => string;
  /** Locale Intl aktif ("id-ID" | "en-US") — untuk format tanggal/angka. */
  locale: "id-ID" | "en-US";
  /** Nama bulan pendek sesuai bahasa (indeks 0-11). */
  monthShort: string[];
}

const I18nContext = createContext<I18nApi | null>(null);

const FALLBACK: I18nApi = {
  lang: "id",
  setLang: () => undefined,
  toggleLang: () => undefined,
  t: (id) => id,
  locale: "id-ID",
  monthShort: monthsShortOf(),
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("id");

  // Muat preferensi tersimpan (render pertama selalu "id" agar hydration stabil,
  // lalu beralih begitu localStorage terbaca — hanya kedipan singkat bagi user EN).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "id") {
        setGlobalLang(stored); // sinkron SEBELUM setState agar render pertama EN akurat
        // eslint-disable-next-line react-hooks/set-state-in-effect -- rehidrasi preferensi dari localStorage memang harus terjadi pasca-mount: render server (SSR) selalu "id" supaya hydration aman, lalu beralih sekali ke preferensi tersimpan.
        setLangState(stored);
      }
    } catch {
      /* storage bisa diblokir — abaikan */
    }
  }, []);

  // Persist + sinkronkan <html lang> + cookie (untuk SSR masa depan).
  // Catatan: state global i18n-core TIDAK di-set di sini — harus sinkron saat
  // setState (lih. setLang) supaya translate() tidak pernah membaca bahasa basi.
  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "id";
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* abaikan */
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setGlobalLang(l); // sinkron dgn state React SEKALIGUS saat aksi — render berikutnya langsung benar
    setLangState(l);
  }, []);
  const toggleLang = useCallback(() => setLang(lang === "id" ? "en" : "id"), [lang, setLang]);

  const t = useCallback(
    (id: string, en?: string, vars?: Record<string, string | number>) => translate(id, en, vars),
    // translate() membaca state module-level i18n-core (disinkronkan setLang) —
    // dependensi lang dipakai agar komponen re-render saat bahasa berganti.
    [lang],
  );

  const value = useMemo<I18nApi>(
    () => ({ lang, setLang, toggleLang, t, locale: lang === "en" ? "en-US" : "id-ID", monthShort: monthsShortOf() }),
    [lang, setLang, toggleLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nApi {
  const ctx = useContext(I18nContext);
  // Di luar provider (mis. mockup Design Lab yang terisolasi) → fallback Indonesia.
  return ctx ?? FALLBACK;
}
