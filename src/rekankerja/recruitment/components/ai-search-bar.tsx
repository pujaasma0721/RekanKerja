"use client";
// RekanKerja Recruitment F6c (1/2) — pencarian natural-language Talent Pool.
// Search bar AI di atas tabel pelamar: query bebas → GET /api/rekankerja/
// recruitment/ai?q=<query> → { mode, interpreted, rows, total } (kontrak
// F6c-BACKEND/3c — rows = serializer list pelamar + totalExpYears/skills).
// Panel hasil: badge mode jujur (AI emerald / Simulasi amber — D7), teks
// `interpreted` (transparansi filter — P2), jumlah hasil, tabel subset kolom
// list pelamar, tombol bersihkan. Guard op search-ai recruitment:applicants.
// Tipe service BUKAN di-import runtime — mirror lokal (pola F2 `import type`).
import { useState } from "react";
import { apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Sparkles, Search, Loader2, X, Eye, UsersRound } from "lucide-react";
import type { ApplicantRow } from "@/rekankerja/recruitment/services/applicant-service";

const AI_API = "/api/rekankerja/recruitment/ai";

// ---------- tipe (mirror kontrak GET ?q= — F6c) ----------

/** Baris hasil pencarian = ApplicantRow list + info ekstra (kontrak 3c). */
export type AiSearchRowUI = ApplicantRow & {
  totalExpYears: number;
  skills: string[];
};

export interface AiSearchResp {
  mode: "ai" | "simulated";
  interpreted: string;
  rows: AiSearchRowUI[];
  total: number;
}

// ---------- label domain (lokal — pola F2/F3: tidak import service runtime) ----------

const A_LABEL: Record<string, string> = { Active: "Aktif", Outdated: "Kedaluwarsa", Rejected: "Ditolak", Employed: "Bekerja" };
const A_LABEL_EN: Record<string, string> = { Active: "Active", Outdated: "Outdated", Rejected: "Rejected", Employed: "Employed" };
const A_TONE: Record<string, string> = { Active: "emerald", Outdated: "amber", Rejected: "rose", Employed: "teal" };
const SRC_LABEL: Record<string, string> = { Advertisement: "Iklan", Agency: "Agency", Referral: "Referensi", Web: "Web / Portal", Internal: "Internal", Other: "Lainnya" };
const SRC_LABEL_EN: Record<string, string> = { Advertisement: "Advertisement", Agency: "Agency", Referral: "Referral", Web: "Web / Portal", Internal: "Internal", Other: "Other" };

const TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
};
const TONE_DOT: Record<string, string> = {
  emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", teal: "bg-teal-500", slate: "bg-slate-400",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE_CLS[tone] ?? TONE_CLS.slate)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} />
      {children}
    </span>
  );
}

// ---------- badge mode jujur (D7) — dipakai juga copilot-panel.tsx ----------

/**
 * Badge mode hasil F6c (search & copilot) — kontrak hanya mengembalikan
 * {mode} tanpa nama model → tampil "AI" (emerald + Sparkles) / "Simulasi"
 * (amber). Tidak pernah mengklaim model yang tidak diketahui.
 */
export function ResultModeBadge({ mode }: { mode: string }) {
  const { t } = useI18n();
  const isAi = mode === "ai";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      isAi
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
    )}>
      {isAi && <Sparkles className="h-3 w-3" aria-hidden />}
      {isAi ? "AI" : t("Simulasi", "Simulated")}
    </span>
  );
}

// ---------- search bar + panel hasil ----------

/**
 * Pencarian bebas (AI) talent pool — bar di atas tabel pelamar.
 * Hasil independen dari filter/daftar normal; `onOpenDetail` membuka dialog
 * detail pelamar yang sama dengan baris tabel biasa.
 */
export function AiSearchBar({ onOpenDetail }: { onOpenDetail: (r: AiSearchRowUI) => void }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canSearch = perms.canOp("recruitment", "applicants", "search-ai");

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<AiSearchResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canSearch) return null;

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (!query || searching) return;
    setSearching(true);
    setError(null);
    try {
      const res = await apiSend<AiSearchResp>(`${AI_API}?q=${encodeURIComponent(query)}`, "GET");
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      setError(msg);
      toast.error(msg || t("Pencarian AI gagal", "AI search failed"));
    } finally {
      setSearching(false);
    }
  };

  const clear = () => {
    setResult(null);
    setError(null);
  };

  const expLabel = (r: AiSearchRowUI): string => {
    if (r.totalExpYears >= 1) {
      const y = Number.isInteger(r.totalExpYears) ? String(r.totalExpYears) : r.totalExpYears.toFixed(1);
      return t("{n} thn", "{n} yr", { n: y });
    }
    return t("{m} bln", "{m} mo", { m: String(r.totalExpMonths) });
  };

  return (
    <Card className="mb-4 border-emerald-200/70 bg-white/80 shadow-sm dark:border-emerald-500/25 dark:bg-slate-900/80">
      <CardContent className="p-4">
        <form onSubmit={doSearch} className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t(
                "Cari bebas: mis. 'software engineer Bandung 3 tahun, IPK min 3'",
                "Free search: e.g. 'software engineer Bandung 3 years, GPA min 3'",
              )}
              className="pl-9"
              aria-label={t("Pencarian bebas AI talent pool", "AI free-form talent pool search")}
            />
          </div>
          <Button type="submit" className="ov-fill ov-glow gap-2" disabled={searching || !q.trim()}>
            {searching
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Search className="h-4 w-4" aria-hidden />}
            {t("Cari", "Search")}
          </Button>
        </form>

        {/* loading */}
        {searching && (
          <p className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" aria-hidden />
            {t("Menginterpretasi & mencari…", "Interpreting & searching…")}
          </p>
        )}

        {/* error inline (toast sudah terpicu) */}
        {error && !searching && (
          <div className="mt-3">
            <EmptyState title={t("Pencarian AI gagal", "AI search failed")} description={error} />
          </div>
        )}

        {/* panel hasil */}
        {result && !searching && !error && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
              <ResultModeBadge mode={result.mode} />
              <span className="min-w-0 flex-1 basis-64 text-xs italic leading-relaxed text-slate-600 dark:text-slate-300">
                {result.interpreted}
              </span>
              <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {t("{n} pelamar cocok", "{n} matching applicants", { n: String(result.total) })}
              </span>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={clear}>
                <X className="h-3.5 w-3.5" aria-hidden /> {t("Bersihkan", "Clear")}
              </Button>
            </div>

            {result.rows.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                title={t("Tidak ada pelamar yang cocok", "No matching applicants")}
                description={t(
                  "Coba ubah kriteria — mis. longgarkan pengalaman, kota, atau jenjang pendidikan.",
                  "Try relaxing criteria — e.g. experience, city, or education level.",
                )}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Nomor / Nama", "No. / Name")}</TableHead>
                      <TableHead>{t("Status", "Status")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("Sumber", "Source")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("Pendidikan", "Education")}</TableHead>
                      <TableHead className="hidden sm:table-cell">{t("Pengalaman", "Experience")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t("Kota", "City")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r)}>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">{r.applicantNo}</div>
                          <div className="font-medium">{r.fullName}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.emailMasked ?? "—"} · {r.phoneMasked ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Pill tone={A_TONE[r.status] ?? "slate"}>{t(A_LABEL[r.status] ?? r.status, A_LABEL_EN[r.status] ?? r.status)}</Pill>
                            {r.blacklist && <Pill tone="rose">{t("Blacklist", "Blacklisted")}</Pill>}
                            {r.suspend && <Pill tone="amber">{t("Suspend", "Suspended")}</Pill>}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {r.source ? t(SRC_LABEL[r.source] ?? r.source, SRC_LABEL_EN[r.source] ?? r.source) : "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {r.highestEduLevel ?? "—"}
                          {r.highestGpa != null && <span className="text-slate-500 dark:text-slate-400"> · {r.highestGpa.toFixed(2)}</span>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs tabular-nums">{expLabel(r)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-xs">{r.city ?? "—"}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Lihat detail", "View detail")} onClick={() => onOpenDetail(r)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {t(
                "Hasil pencarian bebas (filter diinterpretasi otomatis) — daftar pelamar lengkap tetap di bawah.",
                "Free-search results (filters auto-interpreted) — the full applicant list remains below.",
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
