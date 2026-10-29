"use client";
// OneVity shared API hooks + formatters (client side)
import { useCallback, useEffect, useState } from "react";
import { getLang } from "@/onevity/shared/lib/i18n-core";

/**
 * Event global perubahan status brankas uang (Task 56): dikirim money-vault.tsx
 * setelah unlock/lock/setup/ganti sandi/grant/revoke sukses. SEMUA hook useApi
 * yang sedang ter-mount mendengarkan event ini dan me-refetch data — halaman
 * yang terbuka OTOMATIS berganti nilai uang (Rp 0 ↔ nilai asli) tanpa reload
 * manual ("setelah memasukkan kata sandi enkripsi, halaman terefresh otomatis
 * dengan nilai sebenarnya").
 */
export const VAULT_CHANGED_EVENT = "onevity:vault-changed";

export function useApi<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Task 56: status brankas berubah (unlock/lock/…) → refetch data halaman ini
  // otomatis — nilai uang masked (0) berganti nilai asli tanpa reload browser.
  useEffect(() => {
    const onVaultChanged = () => setTick((t) => t + 1);
    window.addEventListener(VAULT_CHANGED_EVENT, onVaultChanged);
    return () => window.removeEventListener(VAULT_CHANGED_EVENT, onVaultChanged);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!url) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        const d = (await r.json()) as T;
        if (alive) { setData(d); setLoading(false); }
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : "unknown"); setLoading(false); }
      }
    };
    void load();
    return () => { alive = false; };
  }, [url, tick, ...deps]);

  return { data, loading, error, refresh, setData };
}

export async function apiSend<T>(url: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Task 33: error boleh membawa details[] (daftar aturan kebijakan sandi yang gagal)
    const err = new Error((json as { error?: string }).error ?? `HTTP ${res.status}`) as Error & { details?: string[] };
    const details = (json as { details?: unknown }).details;
    if (Array.isArray(details)) err.details = details.map(String);
    throw err;
  }
  return json as T;
}

/** T16-ATTACH — upload multipart/form-data (tanpa header Content-Type manual;
 * browser menyetel boundary). Dipakai area upload lampiran. */
export async function apiUpload<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return json as T;
}

// ============ formatters ============
// Formatter tanggal/mata uang/tenure mengikuti bahasa aktif (i18n-core) —
// dipilih via useI18n().setLang sehingga seluruh modul ikut berganti.

const dateLocale = () => (getLang() === "en" ? "en-US" : "id-ID");

export const fmtIDR = (n: number | null | undefined) =>
  // 56: defensif — nilai non-number/non-finite (mis. string enc: bocor jalur
  // lama) dirender "—", bukan karakter mentah.
  typeof n !== "number" || !Number.isFinite(n) ? "—" : `Rp ${new Intl.NumberFormat(dateLocale()).format(n)}`;

export const fmtIDRShort = (n: number) => {
  // 56: defensif — sama fmtIDR (null/NaN/string enc: → "—").
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (getLang() === "en") {
    if (a >= 1_000_000_000) return `Rp ${sign}${(a / 1_000_000_000).toFixed(1)}B`;
    if (a >= 1_000_000) return `Rp ${sign}${(a / 1_000_000).toFixed(1)}M`;
    return `Rp ${sign}${new Intl.NumberFormat("en-US").format(a)}`;
  }
  if (a >= 1_000_000_000) return `Rp ${sign}${(a / 1_000_000_000).toFixed(1)} M`;
  if (a >= 1_000_000) return `Rp ${sign}${(a / 1_000_000).toFixed(1)} jt`;
  if (a >= 1_000) return `Rp ${sign}${(a / 1_000).toFixed(0)} rb`;
  return `Rp ${n}`;
};

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", year: "numeric" }).format(date);
};

export const fmtDateLong = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long", year: "numeric" }).format(date);
};

export const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

export const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export const tenure = (joinDate: string | Date | null | undefined) => {
  if (!joinDate) return "—";
  const d = typeof joinDate === "string" ? new Date(joinDate) : joinDate;
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (getLang() === "en") {
    if (months < 1) return "< 1 month";
    if (months < 12) return `${months} mo`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem ? `${years} yr ${rem} mo` : `${years} yr${years > 1 ? "s" : ""}`;
  }
  if (months < 1) return "< 1 bulan";
  if (months < 12) return `${months} bulan`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} thn ${rem} bln` : `${years} tahun`;
};

export const genderLabel = (g: string) => (getLang() === "en" ? (g === "F" ? "Female" : "Male") : g === "F" ? "Perempuan" : "Laki-laki");

// PA type label (safe import for modules without ui-kit)
export const paTypeLabelSafe = (t: string): string => {
  const map: Record<string, string> = {
    Hire: "Perekrutan", Promotion: "Promosi", Demotion: "Demosi", Transfer: "Rotasi/Transfer",
    Mutation: "Mutasi", SalaryAdjustment: "Penyesuaian Gaji", ContractRenewal: "Perpanjangan Kontrak",
    ChangeStatus: "Perubahan Status", ExtendProbation: "Perpanjangan Probation",
    Resignation: "Resignasi", Termination: "PHK", Retirement: "Pensiun",
  };
  const en: Record<string, string> = {
    Hire: "Hire", Promotion: "Promotion", Demotion: "Demotion", Transfer: "Transfer",
    Mutation: "Mutation", SalaryAdjustment: "Salary Adjustment", ContractRenewal: "Contract Renewal",
    ChangeStatus: "Status Change", ExtendProbation: "Probation Extension",
    Resignation: "Resignation", Termination: "Termination", Retirement: "Retirement",
  };
  if (getLang() === "en") return en[t] ?? t;
  return map[t] ?? t;
};

// avatar color from name hash
const AVATAR_COLORS = [
  "bg-brand/15 text-brand-deep",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-brand/15 text-brand-deep",
  "bg-orange-100 text-orange-700",
  "bg-lime-100 text-lime-700",
  "bg-brand/15 text-brand-deep",
  "bg-fuchsia-100 text-fuchsia-700",
];
export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
