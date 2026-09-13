"use client";
// OneVity — Pengumuman Perusahaan (Task 27-f) ==============================
// =====================================================================
// Broadcast pengumuman ke seluruh karyawan ESS + pelacakan dibaca:
//   · Kartu ringkasan: Aktif (terbit & belum kedaluwarsa), Draft,
//     Kedaluwarsa, Total dibaca (agregat seluruh konfirmasi baca);
//   · Tab Semua / Terbit / Draft / Kedaluwarsa + filter kategori + cari;
//   · Daftar (tabel desktop / kartu mobile): kode, judul + ringkas,
//     kategori, sematan pin, status, PROGRES DIBACA (n/aktif + bar mini),
//     tanggal terbit & kedaluwarsa, aksi;
//   · Dialog buat/ubah (Simpan Draft vs Terbitkan Sekarang — terbit
//     digerbang op hr:announcements:publish), pratinjau isi, hapus draft
//     (AlertDialog — hanya draft).
// Aksi digerbang hak menu hr:announcements (create/update/delete + op publish).
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Megaphone, Pencil, Plus, Search, Trash2, Eye, Rocket, Undo2, Pin, PinOff,
  Loader2, CalendarClock, CheckCheck, FileText, PartyPopper, Scale, Siren, BookOpen,
} from "lucide-react";
import { useApi, apiSend, fmtDate, fmtDateTime } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CATEGORIES = ["Umum", "Kebijakan", "Event", "Darurat"] as const;

// ================= TIPE DATA =================
interface AnnouncementRow {
  id: string;
  code: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "published" | "expired";
  reads: number;
}
interface AnnouncementsData {
  announcements: AnnouncementRow[];
  stats: { active: number; draft: number; expired: number; totalReads: number; totalActive: number };
}

// ================= STATUS PILL LOKAL =================
const STATUS_META: Record<string, { label: string; en: string; cls: string; dot: string }> = {
  draft: {
    label: "Draft", en: "Draft",
    cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25",
    dot: "bg-stone-400",
  },
  published: {
    label: "Terbit", en: "Published",
    cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
    dot: "bg-brand",
  },
  expired: {
    label: "Kedaluwarsa", en: "Expired",
    cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
    dot: "bg-brand",
  },
};
function AnnStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const s = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(s.label, s.en)}
    </span>
  );
}

/** Chip kategori — ikon + warna ringan per kelompok pengumuman. */
const CATEGORY_META: Record<string, { icon: React.ElementType; cls: string }> = {
  Umum: { icon: Megaphone, cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25" },
  Kebijakan: { icon: Scale, cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25" },
  Event: { icon: PartyPopper, cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25" },
  Darurat: { icon: Siren, cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" },
};
function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.Umum;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px] font-bold", meta.cls)}>
      <Icon className="h-3 w-3" aria-hidden /> {category}
    </Badge>
  );
}

/** Progres dibaca: "12/44" + bar mini emerald. */
function ReadProgress({ reads, total }: { reads: number; total: number }) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.min(100, Math.round((reads / total) * 100)) : 0;
  return (
    <div className="w-32 max-w-full" aria-label={t("{n} dari {total} karyawan membaca", "{n} of {total} employees read", { n: reads, total })}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold tabular-nums text-stone-600 dark:text-stone-300">
          {reads}<span className="text-stone-400">/{total}</span>
        </span>
        <span className="text-[10px] font-semibold text-stone-400">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 80 ? "bg-brand" : pct >= 40 ? "bg-brand/55" : "bg-amber-400")}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

// ================= MODUL =================
export function AnnouncementsView() {
  const { t } = useI18n();
  const perms = useMenuPerms();

  return (
    <div>
      <PageHeader
        eyebrow={t("Komunikasi", "Communication")}
        title={t("Pengumuman", "Announcements")}
        description={t(
          "Broadcast pengumuman perusahaan ke seluruh karyawan ESS — lengkap dengan pelacakan siapa yang sudah membaca.",
          "Broadcast company announcements to all ESS employees — complete with read tracking.",
        )}
      />
      <AnnouncementsList perms={perms} />
    </div>
  );
}

type PermsApi = ReturnType<typeof useMenuPerms>;

// ================= DAFTAR + FILTER =================
function AnnouncementsList({ perms }: { perms: PermsApi }) {
  const { t } = useI18n();
  const [tab, setTab] = useState("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState(""); // pencarian di-debounce ringan
  const [dialog, setDialog] = useState<{ open: boolean; editing: AnnouncementRow | null }>({ open: false, editing: null });
  const [previewing, setPreviewing] = useState<AnnouncementRow | null>(null);
  const [deleting, setDeleting] = useState<AnnouncementRow | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  /** id baris yang sedang dimutasi (aksi publish/pin/dll.) — tombol spinner. */
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDq(q), 350);
    return () => window.clearTimeout(id);
  }, [q]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (tab !== "all") p.set("status", tab);
    if (category !== "all") p.set("category", category);
    if (dq.trim()) p.set("q", dq.trim());
    return `/api/onevity/announcements?${p.toString()}`;
  }, [tab, category, dq]);

  const { data, loading, refresh } = useApi<AnnouncementsData>(url);
  const rows = data?.announcements ?? [];
  const stats = data?.stats ?? { active: 0, draft: 0, expired: 0, totalReads: 0, totalActive: 0 };

  const canCreate = perms.can("hr", "announcements", "create");
  const canUpdate = perms.can("hr", "announcements", "update");
  const canDelete = perms.can("hr", "announcements", "delete");
  const canPublish = perms.canOp("hr", "announcements", "publish");

  // aksi baris: publish | unpublish | pin | unpin
  const doAction = async (row: AnnouncementRow, action: "publish" | "unpublish" | "pin" | "unpin") => {
    setBusyId(row.id);
    try {
      const res = await apiSend<{ notified?: number }>("/api/onevity/announcements", "PATCH", { id: row.id, action });
      if (action === "publish") {
        toast.success(t(
          "Pengumuman {code} diterbitkan — {n} notifikasi ESS terkirim",
          "Announcement {code} published — {n} ESS notifications sent",
          { code: row.code, n: res.notified ?? 0 },
        ));
      } else if (action === "unpublish") {
        toast.success(t("Penerbitan {code} dibatalkan — kembali draft", "Publication of {code} cancelled — back to draft", { code: row.code }));
      } else {
        toast.success(t(
          action === "pin" ? "{code} disematkan di feed ESS" : "{code} lepas dari sematan",
          action === "pin" ? "{code} pinned to the ESS feed" : "{code} unpinned",
          { code: row.code },
        ));
      }
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await apiSend(`/api/onevity/announcements?id=${encodeURIComponent(deleting.id)}`, "DELETE");
      toast.success(t("Pengumuman {code} dihapus", "Announcement {code} deleted", { code: deleting.code }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyDelete(false);
    }
  };

  const actionProps = { busyId, doAction, setPreviewing, setDialog, setDeleting, canUpdate, canDelete, canPublish, perms, t } as const;

  return (
    <div>
      {/* ===== kartu ringkasan ===== */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={t("Terbit Aktif", "Active Published")} value={String(stats.active)} icon={Megaphone} tone="emerald" />
        <MiniStat label={t("Draft", "Drafts")} value={String(stats.draft)} icon={FileText} tone="amber" />
        <MiniStat label={t("Kedaluwarsa", "Expired")} value={String(stats.expired)} icon={CalendarClock} />
        <MiniStat label={t("Total Dibaca", "Total Reads")} value={String(stats.totalReads)} icon={CheckCheck} mono />
      </div>

      {/* ===== toolbar: tab status + kategori + cari + buat ===== */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="space-y-3 p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-10 rounded-xl bg-stone-100 p-1 dark:bg-stone-900">
                {([
                  ["all", t("Semua", "All")],
                  ["published", t("Terbit", "Published")],
                  ["draft", t("Draft", "Draft")],
                  ["expired", t("Kedaluwarsa", "Expired")],
                ] as const).map(([key, label]) => (
                  <TabsTrigger key={key} value={key} className="rounded-lg px-3.5 text-[12px] font-bold data-[state=active]:bg-white data-[state=active]:text-stone-900 dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-stone-50">
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {canCreate && (
              <Button onClick={() => setDialog({ open: true, editing: null })} className="ml-auto gap-2 font-bold">
                <Plus className="h-4 w-4" /> {t("Pengumuman Baru", "New Announcement")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-44 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("Cari kode / judul / isi…", "Search code / title / body…")}
                className="pl-9"
                aria-label={t("Cari pengumuman", "Search announcements")}
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-44" aria-label={t("Filter kategori", "Filter category")}>
                <SelectValue placeholder={t("Semua kategori", "All categories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua kategori", "All categories")}</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] font-bold text-stone-400" aria-live="polite">
              {t("{n} baris", "{n} rows", { n: rows.length })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ===== daftar: tabel desktop / kartu mobile ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : rows.length > 0 ? (
            <>
              {/* desktop */}
              <div className="hidden max-h-[480px] overflow-y-auto overflow-x-auto pr-1 md:block [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                    <TableRow>
                      <TableHead className="min-w-56 text-[11px] font-bold">{t("Pengumuman", "Announcement")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Kategori", "Category")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Status", "Status")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Progres Dibaca", "Read Progress")}</TableHead>
                      <TableHead className="hidden text-[11px] font-bold lg:table-cell">{t("Terbit", "Published")}</TableHead>
                      <TableHead className="hidden text-[11px] font-bold xl:table-cell">{t("Kedaluwarsa", "Expires")}</TableHead>
                      <TableHead className="w-44 text-right text-[11px] font-bold">{t("Aksi", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((a) => (
                      <TableRow key={a.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                        <TableCell>
                          <div className="flex items-start gap-2">
                            {a.pinned && (
                              <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={t("Disematkan", "Pinned")} />
                            )}
                            <div className="min-w-0">
                              <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{a.title}</p>
                              <p className="font-mono text-[10px] text-stone-400">{a.code}</p>
                              <p className="mt-0.5 line-clamp-2 max-w-72 text-[11px] leading-snug text-stone-400">{a.body}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><CategoryBadge category={a.category} /></TableCell>
                        <TableCell><AnnStatusPill status={a.status} /></TableCell>
                        <TableCell><ReadProgress reads={a.reads} total={stats.totalActive} /></TableCell>
                        <TableCell className="hidden text-xs text-stone-600 dark:text-stone-400 lg:table-cell">
                          {a.publishedAt ? fmtDate(a.publishedAt) : <span className="text-stone-400">—</span>}
                        </TableCell>
                        <TableCell className="hidden text-xs lg:table-cell xl:table-cell">
                          {a.expiresAt ? (
                            <span className={cn("flex items-center gap-1 font-semibold", a.status === "expired" ? "text-brand dark:text-brand/85" : "text-stone-600 dark:text-stone-400")}>
                              <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {fmtDate(a.expiresAt)}
                            </span>
                          ) : (
                            <span className="text-xs text-stone-400">{t("tanpa batas", "no limit")}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <RowActions row={a} {...actionProps} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* mobile */}
              <ul className="space-y-2.5 p-3 md:hidden">
                {rows.map((a) => (
                  <li key={a.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        {a.pinned && <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={t("Disematkan", "Pinned")} />}
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{a.title}</p>
                          <p className="font-mono text-[10px] text-stone-400">{a.code}</p>
                        </div>
                      </div>
                      <AnnStatusPill status={a.status} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-stone-500 dark:text-stone-400">{a.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CategoryBadge category={a.category} />
                      <span className="text-[10.5px] text-stone-400">
                        {a.publishedAt ? `${t("terbit", "published")} ${fmtDate(a.publishedAt)}` : t("belum terbit", "not published")}
                        {a.expiresAt ? ` · ${t("s.d.", "until")} ${fmtDate(a.expiresAt)}` : ""}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <ReadProgress reads={a.reads} total={stats.totalActive} />
                      <RowActions row={a} {...actionProps} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={<Megaphone className="h-6 w-6" />}
                title={t("Belum ada pengumuman", "No announcements yet")}
                description={t(
                  "Sesuaikan filter, atau buat pengumuman baru dengan tombol \"Pengumuman Baru\".",
                  "Adjust the filters, or create a new announcement with \"New Announcement\".",
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog buat/ubah */}
      <AnnouncementDialog
        open={dialog.open}
        editing={dialog.editing}
        canPublish={canPublish}
        setOpen={(v) => setDialog({ open: v, editing: v ? dialog.editing : null })}
        onSaved={refresh}
      />

      {/* dialog pratinjau isi */}
      {previewing && <PreviewDialog row={previewing} onClose={() => setPreviewing(null)} />}

      {/* konfirmasi hapus */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-rose-500" />
              {t("Hapus pengumuman {code}?", "Delete announcement {code}?", { code: deleting?.code ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "\"{title}\" akan dihapus permanen. Hanya pengumuman draft yang bisa dihapus — batalkan terbitannya dulu bila sudah pernah terbit.",
                "\"{title}\" will be permanently deleted. Only drafts can be deleted — cancel the publication first if it was ever published.",
                { title: deleting?.title ?? "" },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyDelete}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async (e) => { e.preventDefault(); await doDelete(); }}
            >
              {busyDelete ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ================= AKSI BARIS =================
function RowActions({
  row, busyId, doAction, setPreviewing, setDialog, setDeleting, canUpdate, canDelete, canPublish, t,
}: {
  row: AnnouncementRow;
  busyId: string | null;
  doAction: (row: AnnouncementRow, action: "publish" | "unpublish" | "pin" | "unpin") => Promise<void>;
  setPreviewing: (r: AnnouncementRow) => void;
  setDialog: (v: { open: boolean; editing: AnnouncementRow | null }) => void;
  setDeleting: (r: AnnouncementRow) => void;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  perms: PermsApi;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const busy = busyId === row.id;
  return (
    <div className="inline-flex items-center gap-0.5">
      <Button
        variant="ghost" size="icon" className="h-8 w-8"
        onClick={() => setPreviewing(row)}
        aria-label={t("Pratinjau {code}", "Preview {code}", { code: row.code })}
        title={t("Pratinjau isi", "Preview content")}
      >
        <Eye className="h-4 w-4 text-stone-400" />
      </Button>
      {busy ? (
        <span className="flex h-8 w-8 items-center justify-center" role="status" aria-label={t("Memproses…", "Processing…")}>
          <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
        </span>
      ) : (
        <>
          {canPublish && row.status === "draft" && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 hover:ov-text-accent"
              onClick={() => void doAction(row, "publish")}
              aria-label={t("Terbitkan {code}", "Publish {code}", { code: row.code })}
              title={t("Terbitkan ke seluruh ESS", "Publish to all ESS")}
            >
              <Rocket className="h-4 w-4 text-stone-400" />
            </Button>
          )}
          {canUpdate && row.status !== "draft" && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => void doAction(row, "unpublish")}
              aria-label={t("Batalkan terbitan {code}", "Unpublish {code}", { code: row.code })}
              title={t("Batalkan terbitan — kembali draft", "Unpublish — back to draft")}
            >
              <Undo2 className="h-4 w-4 text-stone-400" />
            </Button>
          )}
          {canUpdate && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => void doAction(row, row.pinned ? "unpin" : "pin")}
              aria-label={row.pinned ? t("Lepas sematan {code}", "Unpin {code}", { code: row.code }) : t("Sematkan {code}", "Pin {code}", { code: row.code })}
              title={row.pinned ? t("Lepas dari sematan", "Unpin") : t("Sematkan di feed ESS", "Pin to the ESS feed")}
            >
              {row.pinned ? <PinOff className="h-4 w-4 text-amber-500" /> : <Pin className="h-4 w-4 text-stone-400" />}
            </Button>
          )}
          {canUpdate && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => setDialog({ open: true, editing: row })}
              aria-label={t("Ubah {code}", "Edit {code}", { code: row.code })}
              title={t("Ubah pengumuman", "Edit announcement")}
            >
              <Pencil className="h-4 w-4 text-stone-400" />
            </Button>
          )}
          {canDelete && row.status === "draft" && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 hover:text-rose-600"
              onClick={() => setDeleting(row)}
              aria-label={t("Hapus {code}", "Delete {code}", { code: row.code })}
              title={t("Hapus draft", "Delete draft")}
            >
              <Trash2 className="h-4 w-4 text-stone-400" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ================= DIALOG BUAT/UBAH =================
function AnnouncementDialog({ open, editing, canPublish, setOpen, onSaved }: {
  open: boolean;
  editing: AnnouncementRow | null;
  canPublish: boolean;
  setOpen: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ title: "", category: "Umum", body: "", pinned: false, expiresAt: "" });
  const [busy, setBusy] = useState<"" | "draft" | "publish" | "edit">("");
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // isi form saat dialog dibuka (create kosong / edit dari baris)
  const seedKey = open ? editing?.id ?? "new" : null;
  if (seedKey !== hydratedFor) {
    setHydratedFor(seedKey);
    if (editing) {
      setForm({
        title: editing.title,
        category: editing.category,
        body: editing.body,
        pinned: editing.pinned,
        expiresAt: editing.expiresAt ? String(editing.expiresAt).slice(0, 10) : "",
      });
    } else {
      setForm({ title: "", category: "Umum", body: "", pinned: false, expiresAt: "" });
    }
  }

  const validate = (): string | null => {
    if (!form.title.trim()) return t("Judul pengumuman wajib diisi", "Announcement title is required");
    if (form.title.trim().length > 160) return t("Judul maksimal 160 karakter", "Title is limited to 160 characters");
    if (!form.body.trim()) return t("Isi pengumuman wajib diisi", "Announcement body is required");
    return null;
  };

  const submit = async (mode: "draft" | "publish" | "edit") => {
    if (busy) return;
    const err = validate();
    if (err) { toast.error(err); return; }
    setBusy(mode);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        category: form.category,
        body: form.body.trim(),
        pinned: form.pinned,
        expiresAt: form.expiresAt || null,
      };
      if (editing) {
        body.id = editing.id;
        await apiSend("/api/onevity/announcements", "PATCH", body);
        toast.success(t("Pengumuman {code} diperbarui", "Announcement {code} updated", { code: editing.code }));
      } else {
        const res = await apiSend<{ announcement: { code: string }; notified: number }>("/api/onevity/announcements", "POST", {
          ...body,
          publish: mode === "publish",
        });
        toast.success(
          mode === "publish"
            ? t("Pengumuman {code} diterbitkan — {n} notifikasi ESS terkirim", "Announcement {code} published — {n} ESS notifications sent", { code: res.announcement.code, n: res.notified })
            : t("Draft {code} disimpan — terbitkan saat siap", "Draft {code} saved — publish when ready", { code: res.announcement.code }),
        );
      }
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const busyNow = busy !== "";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busyNow) setOpen(v); }}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 ov-text-accent" aria-hidden />
            {editing
              ? t("Ubah Pengumuman {code}", "Edit Announcement {code}", { code: editing.code })
              : t("Pengumuman Baru", "New Announcement")}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t("Perubahan langsung terlihat karyawan pada feed ESS.", "Changes are immediately visible to employees on the ESS feed.")
              : t("Simpan sebagai draft, atau terbitkan langsung ke seluruh karyawan ESS.", "Save as a draft, or publish straight away to all ESS employees.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="pgm-title" className="text-xs">{t("Judul *", "Title *")}</Label>
            <Input
              id="pgm-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("cth: Townhall Q1 — Rencana Produksi Kuartal Ini", "e.g.: Q1 Townhall — This Quarter's Production Plan")}
              maxLength={160}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pgm-cat" className="text-xs">{t("Kategori *", "Category *")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger id="pgm-cat" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                      {c === "Darurat" ? t(" (mendesak)", " (urgent)") : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pgm-exp" className="text-xs">{t("Kedaluwarsa (opsional)", "Expires (optional)")}</Label>
              <Input
                id="pgm-exp"
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
              <p className="text-[10px] text-stone-400">
                {t("Lewat tanggal ini pengumuman otomatis keluar feed ESS.", "Past this date the announcement automatically leaves the ESS feed.")}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pgm-body" className="text-xs">{t("Isi pengumuman *", "Body *")}</Label>
            <Textarea
              id="pgm-body"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={8}
              maxLength={20000}
              placeholder={t(
                "Tulis isi pengumuman — baris kosong menjadi pemisah paragraf di feed karyawan.",
                "Write the announcement body — blank lines become paragraph separators on the employee feed.",
              )}
              className="min-h-36"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
            <div className="min-w-0">
              <Label htmlFor="pgm-pin" className="text-xs font-bold">{t("Sematkan di feed ESS", "Pin to ESS feed")}</Label>
              <p className="text-[10.5px] leading-relaxed text-stone-400">
                {t("Pengumuman disematkan selalu tampil paling atas.", "Pinned announcements always show at the top.")}
              </p>
            </div>
            <Switch
              id="pgm-pin"
              checked={form.pinned}
              onCheckedChange={(v) => setForm((f) => ({ ...f, pinned: v }))}
              aria-label={t("Sematkan pengumuman", "Pin announcement")}
            />
          </div>
          {!editing && (
            <p className="rounded-xl bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-900">
              {t(
                "Kode dibuat otomatis (PGM-0001, dst.). Menerbitkan mengirim notifikasi in-app ke seluruh akun ESS aktif.",
                "The code is generated automatically (PGM-0001, etc.). Publishing sends an in-app notification to every active ESS account.",
              )}
            </p>
          )}
        </div>
        <DialogFooter className={cn(!editing && "flex-col-reverse gap-2 sm:flex-row sm:justify-end")}>
          <Button variant="outline" disabled={busyNow} onClick={() => setOpen(false)} className="rounded-xl font-bold">{t("Batal", "Cancel")}</Button>
          {editing ? (
            <Button onClick={() => void submit("edit")} disabled={busyNow} className="gap-2 rounded-xl font-bold">
              {busyNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              {busyNow ? t("Menyimpan…") : t("Simpan Perubahan", "Save Changes")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => void submit("draft")}
                disabled={busyNow}
                className="gap-2 rounded-xl font-bold"
              >
                {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                {busy === "draft" ? t("Menyimpan…") : t("Simpan Draft", "Save Draft")}
              </Button>
              {canPublish && (
                <Button
                  onClick={() => void submit("publish")}
                  disabled={busyNow}
                  className="gap-2 rounded-xl font-bold"
                >
                  {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {busy === "publish" ? t("Menerbitkan…", "Publishing…") : t("Terbitkan Sekarang", "Publish Now")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DIALOG PRATINJAU =================
function PreviewDialog({ row, onClose }: { row: AnnouncementRow; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 ov-text-accent" aria-hidden />
            <span className="min-w-0 flex-1">{row.title}</span>
            {row.pinned && <Pin className="h-3.5 w-3.5 text-amber-500" aria-label={t("Disematkan", "Pinned")} />}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-stone-400">{row.code}</span>
            <CategoryBadge category={row.category} />
            <AnnStatusPill status={row.status} />
          </DialogDescription>
        </DialogHeader>

        {/* meta ringkas */}
        <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-xl bg-stone-50 p-2.5 dark:bg-stone-900">
            <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{t("Terbit", "Published")}</p>
            <p className="mt-0.5 font-semibold text-stone-700 dark:text-stone-200">{row.publishedAt ? fmtDateTime(row.publishedAt) : "—"}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-2.5 dark:bg-stone-900">
            <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{t("Kedaluwarsa", "Expires")}</p>
            <p className="mt-0.5 font-semibold text-stone-700 dark:text-stone-200">{row.expiresAt ? fmtDate(row.expiresAt) : t("tanpa batas", "no limit")}</p>
          </div>
          <div className="col-span-2 rounded-xl bg-stone-50 p-2.5 sm:col-span-1 dark:bg-stone-900">
            <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{t("Dibaca", "Read")}</p>
            <p className="mt-0.5 font-semibold text-stone-700 dark:text-stone-200">{row.reads}</p>
          </div>
        </div>

        {/* isi — whitespace dipertahankan, panjang di-scroll */}
        <div
          className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-white p-4 text-[13px] leading-relaxed text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700"
          role="region"
          aria-label={t("Isi pengumuman", "Announcement body")}
        >
          {row.body}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-xl font-bold">{t("Tutup", "Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= KARTU STATISTIK =================
function MiniStat({ label, value, icon: Icon, tone, mono }: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: "amber" | "emerald";
  mono?: boolean;
}) {
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          tone === "amber" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
            : tone === "emerald" ? "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85"
              : "ov-soft ov-text-accent",
        )}>
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
          <p className={cn("mt-0.5 truncate font-extrabold text-stone-900 dark:text-stone-50", mono ? "text-[15px] tabular-nums" : "text-xl")}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
