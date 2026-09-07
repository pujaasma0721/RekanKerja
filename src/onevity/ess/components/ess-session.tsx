"use client";
// Portal Karyawan — konteks sesi ESS (employee self + badge persetujuan).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface EssEmployee {
  id: string;
  employeeNo: string;
  fullName: string;
  photoUrl: string | null;
  status: string;
  joinDate: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  orgUnit: string | null;
  managerName: string | null;
  employmentStatus: string | null;
}

export interface EssSessionData {
  employee: EssEmployee;
  user: { name: string; email: string; role: string };
  canAdminApp: boolean;
  pendingApprovals: number;
}

interface EssSessionCtx {
  data: EssSessionData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const Ctx = createContext<EssSessionCtx>({ data: null, loading: true, error: null, refresh: () => {} });

export function useEssSession(): EssSessionCtx {
  return useContext(Ctx);
}

export function EssSessionProvider({ children, onForbidden }: { children: ReactNode; onForbidden?: (message: string) => void }) {
  const [data, setData] = useState<EssSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/ess/session");
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          setError(j.error ?? `HTTP ${r.status}`);
          if (r.status === 403) onForbidden?.(j.error ?? "Akun tidak tertaut ke data karyawan.");
        } else {
          setData(j as EssSessionData);
        }
      } catch {
        if (alive) setError("Gagal memuat sesi portal");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tick, onForbidden]);

  return <Ctx.Provider value={{ data, loading, error, refresh }}>{children}</Ctx.Provider>;
}
