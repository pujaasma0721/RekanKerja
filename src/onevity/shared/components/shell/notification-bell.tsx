"use client";
// OneVity Admin Notification Bell (T11-NOTIF) — upgrade dari counter polos
// (pendingActions) menjadi FEED notifikasi nyata per AppUser (pola ESS bell T8):
//   · GET /api/onevity/notifications → 20 terbaru + badge unread;
//   · polling ringan 30 dtk (hanya saat tab terlihat, cleanup) + refetch saat
//     dropdown dibuka — tidak pernah spam API;
//   · klik item → tandai dibaca + navigasi link "section:view" (hr inbox utk
//     approval, payroll runs, dsb; tanpa link → mark-read saja);
//   · "Tandai semua dibaca" + empty state rapi.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, CheckCheck, Palmtree, Plane, HeartPulse, Wallet, CalendarClock, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, apiSend, fmtDateTime } from "@/onevity/shared/lib/api";
import { useNav, type SectionId } from "@/onevity/shared/lib/store";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const NOTIF_BASE = "/api/onevity/notifications";

export interface AdminNotificationItem {
  id: string;
  title: string;
  body: string | null;
  kind: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsData {
  items: AdminNotificationItem[];
  unread: number;
}

/** SectionId valid shell admin — supaya link "section:view" salah bentuk diabaikan. */
const VALID_SECTIONS: SectionId[] = [
  "dashboard", "org", "position", "employee", "actions",
  "payroll", "settings", "attendance", "leave", "travel", "medical",
];

function parseNotifLink(link: string | null | undefined): { section: SectionId; view: string } | null {
  if (!link) return null;
  const idx = link.indexOf(":");
  if (idx <= 0) return null;
  const section = link.slice(0, idx) as SectionId;
  const view = link.slice(idx + 1);
  if (!view || !VALID_SECTIONS.includes(section)) return null;
  return { section, view };
}

/** Ikon kecil per kategori emisi (kind). */
const KIND_ICON: Record<string, React.ElementType> = {
  leave: Palmtree,
  travel: Plane,
  medical: HeartPulse,
  payroll: Wallet,
  attendance: CalendarClock,
};
const KIND_ICON_CLS: Record<string, string> = {
  leave: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  travel: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  medical: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  payroll: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
  attendance: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
};

export function NotificationBell() {
  const { t } = useI18n();
  const { navigate } = useNav();
  const [open, setOpen] = useState(false);
  const notif = useApi<NotificationsData>(NOTIF_BASE);
  const unread = notif.data?.unread ?? 0;
  const items = notif.data?.items ?? [];
  const refresh = notif.refresh;

  // Polling ringan: 30 dtk, hanya saat tab terlihat (cleanup saat unmount).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") refresh();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const markOne = async (id: string) => {
    try {
      await apiSend(`${NOTIF_BASE}/read`, "POST", { id });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menandai notifikasi", "Failed to mark notification"));
    }
  };
  const markAll = async () => {
    try {
      await apiSend(`${NOTIF_BASE}/read`, "POST", { all: true });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menandai semua notifikasi", "Failed to mark all notifications"));
    }
  };

  const onItemClick = (n: AdminNotificationItem) => {
    if (!n.readAt) void markOne(n.id);
    const target = parseNotifLink(n.link);
    if (target) {
      setOpen(false);
      navigate(target.section, target.view);
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) refresh(); // feed segar setiap kali dibuka
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="relative rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={t("Notifikasi", "Notifications")}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-extrabold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 dark:border-stone-800">
          <div>
            <p className="text-sm font-bold">{t("Notifikasi", "Notifications")}</p>
            <p className="text-[11px] text-stone-400">
              {unread > 0
                ? t("{n} belum dibaca", "{n} unread", { n: unread })
                : t("Semua sudah dibaca", "All read")}
            </p>
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void markAll()} className="h-7 gap-1.5 px-2 text-[11px] font-bold text-amber-700 hover:text-amber-800 dark:text-amber-400">
              <CheckCheck className="h-3.5 w-3.5" /> {t("Tandai semua dibaca", "Mark all read")}
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-100 dark:bg-stone-800">
                <Bell className="h-5 w-5 text-stone-400" />
              </div>
              <p className="text-xs text-stone-400">
                {t("Belum ada notifikasi — keputusan approval & proses payroll akan muncul di sini.", "No notifications yet — approval decisions & payroll events will appear here.")}
              </p>
            </div>
          ) : (
            items.map((n) => {
              const isUnread = !n.readAt;
              const Icon = (n.kind && KIND_ICON[n.kind]) || Inbox;
              const iconCls = (n.kind && KIND_ICON_CLS[n.kind]) || "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400";
              return (
                <button
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl p-3 text-left transition",
                    isUnread ? "bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-500/10 dark:hover:bg-amber-500/15" : "hover:bg-stone-100 dark:hover:bg-stone-800/60",
                  )}
                >
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", iconCls)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {!isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" aria-hidden />}
                      <span className="truncate text-xs font-bold text-stone-800 dark:text-stone-100">{n.title}</span>
                    </span>
                    {n.body && <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">{n.body}</span>}
                    <span className="mt-1 block text-[10px] font-medium text-stone-400">{fmtDateTime(n.createdAt)}</span>
                  </span>
                  {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />}
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
