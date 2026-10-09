"use client";
// RekanKerja i18n — provider & hook React. ======================================
// API: const { t, lang, setLang, locale, monthShort } = useI18n();
//   t("Simpan")                          → ID: "Simpan" | EN: kamus dasar
//   t("Gajikan periode {p}?", "Pay period {p}?", { p }) → interpolasi {token}
// Bahasa tersimpan localStorage "rekankerja:lang" + cookie, default EN untuk
// pengguna baru / first login (tanpa preferensi tersimpan).
// <html lang> ikut diperbarui (aksesibilitas). Selain React context, state
// juga disinkronkan ke modul i18n-core agar helper non-React (fmtDate dll.)
// mengikuti bahasa aktif.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  setGlobalLang, translate, monthsShort as monthsShortOf,
  DEFAULT_LANG, type Lang,
} from "@/rekankerja/shared/lib/i18n-core";

export { LANG_OPTIONS, BASE_EN, type Lang, loc, locActivity, locReport } from "@/rekankerja/shared/lib/i18n-core";
export { translate } from "@/rekankerja/shared/lib/i18n-core";

const STORAGE_KEY = "rekankerja:lang";

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

// Default bahasa EN dijalankan di scope modul (bukan hanya useState) supaya
// translate() — yang membaca state i18n-core — akurat SEJAK render pertama
// (SSR maupun hidrasi klien). Modul ini hanya diimpor komponen halaman klien,
// bukan API server — jadi tidak ada efek samping ke bundle route server.
setGlobalLang(DEFAULT_LANG);

const FALLBACK: I18nApi = {
  lang: DEFAULT_LANG,
  setLang: () => undefined,
  toggleLang: () => undefined,
  t: (id) => id,
  locale: "en-US",
  monthShort: monthsShortOf(),
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Muat preferensi tersimpan (render pertama selalu default EN agar hydration stabil,
  // lalu beralih begitu localStorage terbaca — hanya kedipan singkat bagi user ID).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "id") {
        setGlobalLang(stored); // sinkron SEBELUM setState agar render pertama EN akurat
        // eslint-disable-next-line react-hooks/set-state-in-effect -- rehidrasi preferensi dari localStorage memang harus terjadi pasca-mount: render server (SSR) selalu default EN supaya hydration aman, lalu beralih sekali ke preferensi tersimpan.
        setLangState(stored);
      }
    } catch {
      /* storage bisa diblokir — abaikan */
    }
  }, []);

  // Persist + sinkronkan <html lang> + cookie (dibaca server component /v/[id]).
  // Catatan: state global i18n-core TIDAK di-set di sini — harus sinkron saat
  // setState (lih. setLang) supaya translate() tidak pernah membaca bahasa basi.
  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "id";
    // Cookie rklang — satu-satunya kanal preferensi bahasa yang bisa dibaca
    // server component (localStorage hanya ada di browser). Dipakai /v/[id].
    document.cookie = `rklang=${lang}; path=/; max-age=31536000; samesite=lax`;
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
  // Di luar provider (mis. mockup Design Lab yang terisolasi) → fallback default (EN).
  return ctx ?? FALLBACK;
}
