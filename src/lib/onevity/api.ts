"use client";
// OneVity shared API hooks + formatters (client side)
import { useCallback, useEffect, useState } from "react";

export function useApi<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

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

export async function apiSend<T>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

// ============ formatters ============
export const fmtIDR = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const fmtIDRShort = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `Rp ${sign}${(a / 1_000_000_000).toFixed(1)} M`;
  if (a >= 1_000_000) return `Rp ${sign}${(a / 1_000_000).toFixed(1)} jt`;
  if (a >= 1_000) return `Rp ${sign}${(a / 1_000).toFixed(0)} rb`;
  return `Rp ${n}`;
};

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

export const fmtDateLong = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date);
};

export const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

export const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export const tenure = (joinDate: string | Date | null | undefined) => {
  if (!joinDate) return "—";
  const d = typeof joinDate === "string" ? new Date(joinDate) : joinDate;
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return "< 1 bulan";
  if (months < 12) return `${months} bulan`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} thn ${rem} bln` : `${years} tahun`;
};

export const genderLabel = (g: string) => (g === "F" ? "Perempuan" : "Laki-laki");

// PA type label (safe import for modules without ui-kit)
export const paTypeLabelSafe = (t: string): string => {
  const map: Record<string, string> = {
    Hire: "Perekrutan", Promotion: "Promosi", Demotion: "Demosi", Transfer: "Rotasi/Transfer",
    Mutation: "Mutasi", SalaryAdjustment: "Penyesuaian Gaji", ContractRenewal: "Perpanjangan Kontrak",
    ChangeStatus: "Perubahan Status", ExtendProbation: "Perpanjangan Probation",
    Resignation: "Resignasi", Termination: "PHK", Retirement: "Pensiun",
  };
  return map[t] ?? t;
};

// avatar color from name hash
const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-lime-100 text-lime-700",
  "bg-cyan-100 text-cyan-700",
  "bg-fuchsia-100 text-fuchsia-700",
];
export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
