"use client";
// OneVity ESS — Pengumuman (Task 27-f) =====================================
// =====================================================================
// Feed pengumuman perusahaan utk karyawan:
//   · Chip "n belum dibaca" di header halaman (badge amber);
//   · Kartu daftar — pengumuman disematkan selalu paling atas dgn tepi
//     amber + badge pin: kategori, judul, ringkas 2 baris, tanggal terbit,
//     titik "Belum dibaca";
//   · Klik kartu → dialog isi lengkap (paragraf dipertahankan) — membuka
//     detail OTOMATIS menandai sudah dibaca (AnnouncementRead, idempoten)
//     + toast halus; titik belum-dibaca & chip ikut turun;
//   · Draft / kedaluwarsa tidak pernah muncul (server memfilter).
import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Megaphone, Pin, CalendarDays, CheckCheck, Dot, PartyPopper, Scale, Siren,
} from "lucide-react";
import { useApi, apiSend, fmtDate, fmtDateTime } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ESS_BASE } from "./ess-api";
import { cn } from "@/lib/utils";

// ================= TIPE DATA =================
interface EssAnnouncement {
  id: string;
  code: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  readByMe: boolean;
  readAt: string | null;
  totalReads: number;
}
interface EssAnnouncementsData {
  announcements: EssAnnouncement[];
  counts: { total: number; unread: number };
}

// ================= CHIP KATEGORI =================
const CATEGORY_META: Record<string, { icon: React.ElementType; cls: string }> = {
  Umum: { icon: Megaphone, cls: "border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300" },
  Kebijakan: { icon: Scale, cls: "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85" },
  Event: { icon: PartyPopper, cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" },
  Darurat: { icon: Siren, cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400" },
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

// ================= HALAMAN =================
export function EssAnnouncements() {
  const { t } = useI18n();
  const api = useApi<EssAnnouncementsData>(`${ESS_BASE}/announcements`);
  const [detail, setDetail] = useState<EssAnnouncement | null>(null);

  const announcements = api.data?.announcements ?? [];
  const unread = api.data?.counts?.unread ?? 0;

  // buka detail → TANDAI DIBACA otomatis (idempoten) + toast halus
  const openDetail = (ann: EssAnnouncement) => {
    setDetail(ann);
    if (ann.readByMe) return;
    void apiSend<{ ok: true }>(`${ESS_BASE}/announcements`, "POST", { id: ann.id })
      .then(() => {
        // perbarui state lokal: kartu kehilangan titik belum-dibaca + chip turun
        api.setData((prev) =>
          prev
            ? {
                ...prev,
                announcements: prev.announcements.map((a) =>
                  a.id === ann.id ? { ...a, readByMe: true, readAt: new Date().toISOString() } : a,
                ),
                counts: { ...prev.counts, unread: Math.max(0, prev.counts.unread - 1) },
              }
            : prev,
        );
        toast.info(t(
          "Ditandai sudah dibaca — terima kasih.",
          "Marked as read — thank you.",
        ));
      })
      .catch(() => { /* penandaan gagal (offline dsb.) — tidak menghalangi membaca */ });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Pengumuman", "Announcements")}
        description={t(
          "Kabar resmi perusahaan — kebijakan, acara, dan informasi mendesak. Membuka pengumuman otomatis mencatat bahwa Anda sudah membacanya.",
          "Official company news — policies, events, and urgent notices. Opening an announcement automatically records that you have read it.",
        )}
        actions={
          unread > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" role="status">
              <Dot className="h-4 w-4 -mx-1 fill-amber-500 text-amber-500" aria-hidden />
              {t("{n} belum dibaca", "{n} unread", { n: unread })}
            </span>
          ) : announcements.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-3 py-1.5 text-[11.5px] font-bold text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85" role="status">
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              {t("Semua sudah dibaca", "All read")}
            </span>
          ) : undefined
        }
      />

      {/* ===== daftar kartu pengumuman ===== */}
      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={t("Belum ada pengumuman", "No announcements yet")}
          description={t(
            "Pengumuman resmi perusahaan akan tampil di sini begitu diterbitkan HR.",
            "Official company announcements will appear here as soon as HR publishes them.",
          )}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          {announcements.map((ann, i) => (
            <motion.button
              key={ann.id}
              type="button"
              onClick={() => openDetail(ann)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(i * 0.04, 0.24), ease: "easeOut" }}
              className={cn(
                "group rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500",
                ann.pinned
                  ? "border-amber-300 bg-gradient-to-br from-amber-50/80 to-white dark:border-amber-500/40 dark:from-amber-500/10 dark:to-stone-900"
                  : "border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900",
              )}
              aria-label={t("Buka pengumuman {title}", "Open announcement {title}", { title: ann.title })}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <CategoryBadge category={ann.category} />
                  {ann.pinned && (
                    <Badge className="gap-1 border-0 bg-amber-500/15 text-[10px] font-bold text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
                      <Pin className="h-3 w-3" aria-hidden /> {t("Disematkan", "Pinned")}
                    </Badge>
                  )}
                </div>
                {!ann.readByMe && (
                  <span
                    className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"
                    aria-label={t("Belum dibaca", "Unread")}
                    title={t("Belum dibaca", "Unread")}
                  />
                )}
              </div>
              <p className={cn(
                "mt-2 text-[14px] font-bold leading-snug text-stone-800 dark:text-stone-100",
                !ann.readByMe && "text-stone-900 dark:text-white",
              )}>
                {ann.title}
              </p>
              <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                {ann.body}
              </p>
              <p className="mt-2.5 flex items-center gap-1.5 text-[10.5px] font-medium text-stone-400">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {ann.publishedAt ? fmtDateTime(ann.publishedAt) : "—"}
                <span className="font-mono text-stone-300 dark:text-stone-600">· {ann.code}</span>
              </p>
            </motion.button>
          ))}
        </div>
      )}

      {/* ===== dialog isi lengkap ===== */}
      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-base">
                  {detail.pinned && <Pin className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />}
                  <span className="min-w-0">{detail.title}</span>
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <CategoryBadge category={detail.category} />
                  <span className="font-mono text-[11px] font-semibold text-stone-400">{detail.code}</span>
                  {detail.publishedAt && (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" aria-hidden /> {fmtDate(detail.publishedAt)}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              {/* isi — paragraf dipertahankan, panjang di-scroll */}
              <div
                className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-stone-50/60 p-4 text-[13px] leading-relaxed text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700"
                role="region"
                aria-label={t("Isi pengumuman", "Announcement body")}
              >
                {detail.body}
              </div>

              {detail.expiresAt && (
                <p className="text-[10.5px] text-stone-400">
                  {t("Tersedia hingga {date}.", "Available until {date}.", { date: fmtDate(detail.expiresAt) })}
                </p>
              )}
              <DialogFooter className="items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-brand dark:text-brand/85" role="status">
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                  {detail.readByMe || api.data?.announcements.find((a) => a.id === detail.id)?.readByMe
                    ? t("Sudah Anda baca", "You have read this")
                    : t("Menandai dibaca…", "Marking as read…")}
                </p>
                <Button
                  variant="outline"
                  onClick={() => setDetail(null)}
                  className="rounded-xl font-bold"
                >
                  {t("Tutup", "Close")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
