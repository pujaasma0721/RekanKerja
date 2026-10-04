"use client";
// RekanKerja ESS — dialog scan QR kios presensi (Task 100 F1 G17, agen E).
// Kamera BELAKANG (facingMode environment) + jsQR per frame (canvas lebar 480,
// interval ~250ms via requestAnimationFrame). QR valid diawali "ovqr:" —
// payload PENUH dikirim parent sebagai qrToken FormData (server mem-parse
// "ovqr:{schema}:{token}" sendiri & menoleransi skew bucket ±1×30 dtk).
// Auto-tutup 60 detik bila tidak ada QR terdeteksi; kamera selalu di-stop.
import { useEffect, useRef } from "react";
import jsQR from "jsqr";
import { QrCode, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCameraStream } from "./ess-clock-camera";

/** Lebar canvas pemindaian (px) — 480 cukup utk QR kios & hemat CPU. */
const SCAN_WIDTH = 480;
/** Jeda antar-frame pemindaian (ms). */
const SCAN_INTERVAL_MS = 250;
/** Batas waktu pemindaian sebelum dialog ditutup otomatis (ms). */
const SCAN_TIMEOUT_MS = 60_000;

export interface EssClockQrDialogProps {
  open: boolean;
  /** Arah yang AKAN dicatat (auto dari state clock widget). */
  direction: "IN" | "OUT";
  busy: boolean;
  /** Payload QR lengkap (harus diawali "ovqr:") — parent menutup dialog & submit. */
  onDetected: (token: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function EssClockQrDialog({ open, direction, busy, onDetected, onOpenChange }: EssClockQrDialogProps) {
  const { t } = useI18n();
  const { videoRef, ready, error } = useCameraStream(open, "environment");
  const detectedRef = useRef(false);

  // loop pemindaian jsQR — berjalan hanya saat kamera siap
  useEffect(() => {
    if (!open || !ready) return;
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (detectedRef.current || ts - last < SCAN_INTERVAL_MS) return;
      last = ts;
      if (!video.videoWidth || !video.videoHeight) return;
      const w = SCAN_WIDTH;
      const h = Math.round((video.videoHeight / video.videoWidth) * w);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      try {
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
        if (code?.data && code.data.startsWith("ovqr:")) {
          detectedRef.current = true;
          cancelAnimationFrame(raf);
          onDetected(code.data);
        }
      } catch {
        /* frame korup — coba frame berikutnya */
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, ready, videoRef, onDetected]);

  // timeout 60 dtk — tutup otomatis + kabari (kios mungkin menampilkan QR basi)
  useEffect(() => {
    if (!open) return;
    detectedRef.current = false;
    const id = window.setTimeout(() => {
      if (detectedRef.current) return;
      onOpenChange(false);
      toast.info(t("Waktu pemindaian habis — buka kembali bila QR kios sudah tampil.", "Scan timed out — reopen once the kiosk QR is showing."));
    }, SCAN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [open, onOpenChange, t]);

  const dirLabel = direction === "IN" ? t("Clock In", "Clock In") : t("Clock Out", "Clock Out");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && busy) return; onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Absen via QR Kios", "Clock via Kiosk QR")}
          </DialogTitle>
          <DialogDescription>
            {t("Arahkan kamera belakang ke QR di layar kios presensi.", "Point the rear camera at the QR code on the attendance kiosk screen.")}
          </DialogDescription>
        </DialogHeader>

        {/* ===== area pemindaian ===== */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 dark:border-slate-800">
          <div className="relative aspect-[3/4] w-full">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label={t("Kamera belakang untuk memindai QR kios presensi", "Rear camera for scanning the attendance kiosk QR")}
              className="h-full w-full bg-slate-900 object-cover"
            />
            {/* bingkai target — dekoratif */}
            {ready && !error && (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-52 w-52">
                  <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-4 border-t-4 border-white/80" />
                  <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-4 border-t-4 border-white/80" />
                  <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-4 border-l-4 border-white/80" />
                  <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-4 border-r-4 border-white/80" />
                </div>
              </div>
            )}
            {ready && !error && (
              <p className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 text-[12px] font-bold text-white/90 drop-shadow">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t("Memindai QR…", "Scanning QR…")}
              </p>
            )}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <AlertTriangle className="h-7 w-7 text-amber-400" aria-hidden />
                <p className="text-[13px] font-semibold leading-relaxed text-slate-100">
                  {t("Kamera tidak dapat diakses. Izinkan akses kamera di peramban Anda lalu coba lagi.", "The camera cannot be accessed. Allow camera access in your browser and try again.")}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ===== arah yang akan dicatat ===== */}
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-center text-[12px] font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {t("Arah presensi otomatis: {dir}", "Auto attendance direction: {dir}", { dir: dirLabel })}
        </p>

        <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)} className="h-11 w-full rounded-xl text-[12.5px] font-bold">
          {t("Batal", "Cancel")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
