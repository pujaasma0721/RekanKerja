"use client";
// RekanKerja — kartu opt-in WEB PUSH (P2.2-BM · D-BM17) =================
// =====================================================================
// Komponen bersama admin shell & ESS:
//   · GET  {endpoint}  → {enabled, subscribed, publicKey};
//   · aktifkan: permission "denied" → pesan tenang dwibahasa (fallback);
//     "default" → requestPermission; "granted" → pushManager.subscribe
//     (applicationServerKey = publicKey dari GET) → POST subscribe;
//   · nonaktifkan → POST unsubscribe;
//   · chip status hijau/abu + salinan dwibahasa t().
// Dipasang di ess-profile (tab personal) + footer dropdown bell admin.
// Pemanggil WAJIB guard dukungan browser (serviceWorker + PushManager) —
// fallback di browser lama = komponen disembunyikan, TANPA error.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, BellOff, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";

interface PushStatusRes {
  enabled: boolean;
  subscribed: boolean;
  publicKey: string | null;
}

// FIX pre-existing TS5.7+ — Uint8Array generik (ArrayBufferLike) tak lagi
// kompatibel dgn BufferSource (butuh ArrayBuffer murni); alokasi eksplisit
// ArrayBuffer supaya tipe pas utk applicationServerKey pushManager.subscribe.
/** Konversi base64url (VAPID publicKey) → Uint8Array utk applicationServerKey. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Dukungan web push browser (serviceWorker + PushManager + Notification). */
function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function PushOptIn({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<PushStatusRes | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as PushStatusRes;
      setStatus(json);
    } catch {
      // jaringan gagal → tetap tampil status netral (bukan error keras)
      setStatus((s) => s ?? { enabled: false, subscribed: false, publicKey: null });
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    if (!pushSupported() || busy) return;
    setBusy(true);
    try {
      const permission = Notification.permission; // "default" | "granted" | "denied"
      if (permission === "denied") {
        // user pernah memblokir — prompt tak bisa dimunculkan lagi; pesan tenang
        toast.info(
          t(
            "Notifikasi diblokir di browser ini — ubah izin notifikasi untuk situs ini di pengaturan browser, lalu coba lagi.",
            "Notifications are blocked in this browser — change the notification permission for this site in your browser settings, then try again.",
          ),
        );
        return;
      }
      const granted = permission === "granted" ? true : await Notification.requestPermission();
      if (granted !== "granted") return; // user menutup prompt → batal tenang

      const reg = await navigator.serviceWorker.ready;
      const key = status?.publicKey;
      if (!key) {
        toast.error(t("Konfigurasi push belum tersedia — coba beberapa saat lagi.", "Push configuration is not ready — try again in a moment."));
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          endpoint: json.endpoint ?? "",
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        await sub.unsubscribe().catch(() => {});
        toast.error(err.error ?? t("Gagal mengaktifkan notifikasi push", "Failed to enable push notifications"));
        return;
      }
      await refresh();
      toast.success(t("Notifikasi push diaktifkan", "Push notifications enabled"));
    } catch {
      // kegagalan subscribe browser → fallback tenang (tanpa error keras)
      toast.error(t("Gagal mengaktifkan notifikasi push", "Failed to enable push notifications"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // unsubscribe lokal browser (best-effort) + hapus baris server
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        await sub?.unsubscribe();
      } catch {
        /* browser tanpa langganan lokal — lanjut hapus server */
      }
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe-all" }),
      });
      if (!res.ok) throw new Error("failed");
      await refresh();
      toast.success(t("Notifikasi push dinonaktifkan", "Push notifications disabled"));
    } catch {
      toast.error(t("Gagal menonaktifkan notifikasi push", "Failed to disable push notifications"));
    } finally {
      setBusy(false);
    }
  };

  // browser tanpa dukungan → Pemanggil sudah men-guard; pengaman ekstra di sini
  if (!pushSupported()) return null;

  const subscribed = status?.subscribed === true;
  const enabled = status?.enabled !== false; // null saat memuat → anggap siap

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {t("Notifikasi Push", "Push Notifications")}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {t(
              "Terima keputusan approval & pengumuman langsung di perangkat Anda — bahkan saat tab RekanKerja tertutup.",
              "Receive approval decisions & announcements directly on your device — even when the RekanKerja tab is closed.",
            )}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
            subscribed
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
          )}
        >
          {subscribed ? <BellRing className="h-3 w-3" aria-hidden /> : <BellOff className="h-3 w-3" aria-hidden />}
          {subscribed ? t("Aktif", "Active") : t("Nonaktif", "Inactive")}
        </span>
      </div>

      {!enabled ? (
        <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t(
            "Notifikasi push belum tersedia di server — coba beberapa saat lagi.",
            "Push notifications are not available on the server yet — try again in a moment.",
          )}
        </p>
      ) : subscribed ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void disable()}
          disabled={busy}
          className="h-9 gap-2 rounded-xl px-4 text-xs font-bold"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {t("Nonaktifkan", "Disable")}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => void enable()}
          disabled={busy}
          className="h-9 gap-2 rounded-xl bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <BellRing className="h-3.5 w-3.5" aria-hidden />}
          {t("Aktifkan", "Enable")}
        </Button>
      )}
    </div>
  );
}
