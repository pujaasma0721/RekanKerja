"use client";

// CompanySwitcher — switcher company aktif (model 1 tenant multi-Company,
// SATU company aktif per waktu). Fetch /api/rekankerja/companies;
// menyimpan pilihan via setActiveCompanyId (global header seluruh useApi).
import { useEffect, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApi, apiSend, setActiveCompanyId, COMPANY_CHANGED_EVENT } from "@/rekankerja/shared/lib/api";

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  active: boolean;
  _count?: { employees: number; orgUnits: number; companyOffices: number };
}

export function CompanySwitcher() {
  const { data, refresh } = useApi<{ companies: CompanyRow[]; activeId: string | null; multi: boolean }>(
    "/api/rekankerja/companies",
  );
  const [switching, setSwitching] = useState(false);
  const [, force] = useState(0);

  // Dengarkan event dari panel lain (kalau ada) — refresh list.
  useEffect(() => {
    const on = () => force((n) => n + 1);
    window.addEventListener(COMPANY_CHANGED_EVENT, on);
    return () => window.removeEventListener(COMPANY_CHANGED_EVENT, on);
  }, []);

  if (!data?.multi || data.companies.length < 2) return null; // single-company → widget tidak tampil
  const active = data.companies.find((c) => c.id === data.activeId) ?? data.companies[0]!;
  if (!active) return null;

  const switchTo = async (id: string) => {
    if (id === active.id) return;
    setSwitching(true);
    setActiveCompanyId(id);
    await apiSend("/api/rekankerja/companies", "GET").catch(() => null);
    setTimeout(() => {
      // reload seluruh data di bawah konteks company baru (pola workspace)
      window.location.reload();
    }, 60);
    refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={switching}
          aria-label={active.name}
          title={active.name}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
        >
          <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="hidden max-w-[140px] truncate sm:inline">{active.shortName || active.code}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Perusahaan</DropdownMenuLabel>
        {data.companies.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => void switchTo(c.id)}>
            <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === active.id ? (
              <Check className="h-4 w-4 shrink-0 text-brand dark:text-brand/85" />
            ) : (
              <span className="shrink-0 text-[10px] text-slate-400">{c._count?.employees ?? 0} emp</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
