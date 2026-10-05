"use client";
// RekanKerja ESS — dialog foto selfie presensi (Task 100 F1 G13+G30, agen E).
// Dibuka widget punch clock saat rule selfieMode required|warn SEBELUM submit:
//   · <video> getUserMedia facingMode "user" + tombol "Ambil Foto";
//   · capture canvas max sisi 640px, JPEG quality 0.8 → preview + "Ambil Ulang";
//   · hasil dikirim parent sebagai Blob (nama file selfie.jpg saat FormData);
//   · faceVerifyMode != off → hint foto dibandingkan referensi wajah;
//   · kamera gagal: required → pesan kamera diperlukan; warn → boleh lanjut
//     tanpa foto (server menandai flag "noselfie");
//   · stream dijamin berhenti saat dialog ditutup/unmount (hook kamera).
import { useState } from "react";
import { Camera, RefreshCcw, Send, ScanFace, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCameraStream } from "./ess-clock-camera";

/** Dimensi maksimum sisi foto selfie (px) — kompresi hemat bandwith. */
const SELFIE_MAX_SIDE = 640;
/** Kualitas JPEG encode. */
const SELFIE_QUALITY = 0.8;

export interface EssClockSelfieDialogProps {
  open: boolean;
  /** Arah presensi yang sedang diajukan (label tombol kirim). */
  direction: "IN" | "OUT";
  selfieMode: "off" | "warn" | "required";
  faceVerifyMode: "off" | "warn" | "strict";
  /** true saat clock sedang dikirim (tombol dikunci). */
  busy: boolean;
  /** null = lanjut tanpa foto (hanya wajar di mode warn). */
  onSubmit: (photo: Blob | null) => void;
  onOpenChange: (open: boolean) => void;
}

export function EssClockSelfieDialog({
  open, direction, selfieMode, faceVerifyMode, busy, onSubmit, onOpenChange,
}: EssClockSelfieDialogProps) {
  const { t } = useI18n();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  // kamera hidup hanya saat dialog terbuka DAN belum ada foto (hemat baterai;
  // "Ambil Ulang" menghidupkan ulang otomatis karena photoUrl kembali null).
  const { videoRef, ready, error } = useCameraStream(open && photoUrl == null, "user");

  const reset = () => {
    setPhotoUrl(null);
    setPhotoBlob(null);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, SELFIE_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", SELFIE_QUALITY);
    setPhotoUrl(dataUrl);
    // dataURL → Blob utk FormData (fetch data: adalah cara termurah di browser)
    void (async () => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        setPhotoBlob(blob);
      } catch {
        /* blob gagal → tombol kirim tetap terkunci sampai retake */
      }
    })();
  };

  const dirLabel = direction === "IN" ? t("Clock In", "Clock In") : t("Clock Out", "Clock Out");
  const cameraFailed = error != null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && busy) return; onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Foto Selfie Presensi", "Attendance Selfie Photo")}
          </DialogTitle>
          <DialogDescription>
            {selfieMode === "required"
              ? t("Foto wajib dilampirkan sebagai bukti kehadiran {dir}.", "A photo is required as attendance proof for {dir}.", { dir: dirLabel })
              : t("Lampirkan foto sebagai bukti kehadiran {dir} (opsional).", "Attach a photo as attendance proof for {dir} (optional).", { dir: dirLabel })}
          </DialogDescription>
        </DialogHeader>

        {/* ===== area kamera / preview ===== */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 dark:border-slate-800">
          <div className="relative aspect-[3/4] w-full">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={t("Preview foto selfie presensi", "Attendance selfie photo preview")}
                className="h-full w-full object-cover"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  aria-label={t("Kamera depan untuk foto selfie presensi", "Front camera for the attendance selfie photo")}
                  className="h-full w-full bg-slate-900 object-cover"
                />
                {/* panduan posisi wajah — dekoratif */}
                {ready && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  >
                    <div className="h-[62%] w-[62%] rounded-[50%] border-2 border-dashed border-white/60 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]" />
                  </div>
                )}
              </>
            )}
            {cameraFailed && photoUrl == null && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                <AlertTriangle className="h-7 w-7 text-amber-400" aria-hidden />
                <p className="text-[13px] font-semibold leading-relaxed text-slate-100">
                  {t("Kamera tidak dapat diakses. Pastikan izin kamera diizinkan lalu coba lagi.", "The camera cannot be accessed. Allow camera permission and try again.")}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ===== pesan mode kamera gagal ===== */}
        {cameraFailed && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
            {selfieMode === "required"
              ? t("Kamera diperlukan untuk presensi — izinkan akses kamera di pengaturan peramban Anda, atau gunakan perangkat kios HR.", "A camera is required to clock in — allow camera access in your browser settings, or use the HR kiosk device.")
              : t("Kamera tidak tersedia — Anda tetap dapat melanjutkan tanpa foto (dicatat pada presensi).", "Camera unavailable — you can still continue without a photo (recorded on the attendance log).")}
          </div>
        )}

        {/* ===== hint verifikasi wajah + privasi ===== */}
        {faceVerifyMode !== "off" && (
          <p className="flex items-start gap-1.5 text-[11px] font-medium leading-relaxed text-amber-700 dark:text-amber-400">
            <ScanFace className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("Foto dibandingkan dengan foto referensi wajah Anda — pastikan wajah terlihat jelas.", "The photo is compared with your stored face reference — make sure your face is clearly visible.")}
          </p>
        )}
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("Foto tersimpan terenkripsi sebagai bukti kehadiran.", "The photo is stored encrypted as proof of attendance.")}
        </p>

        {/* ===== tombol aksi ===== */}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {photoUrl == null ? (
            <>
              <Button
                type="button"
                onClick={capture}
                disabled={!ready || busy || cameraFailed}
                className="h-11 w-full gap-2 rounded-xl bg-amber-600 text-[13px] font-bold text-white hover:bg-amber-700"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {t("Ambil Foto", "Take Photo")}
              </Button>
              {selfieMode === "warn" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onSubmit(null)}
                  className="h-11 w-full rounded-xl text-[12.5px] font-bold"
                >
                  {t("Lanjut Tanpa Foto", "Continue Without Photo")}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                type="button"
                disabled={photoBlob == null || busy}
                onClick={() => photoBlob && onSubmit(photoBlob)}
                className="h-11 w-full gap-2 rounded-xl bg-amber-600 text-[13px] font-bold text-white hover:bg-amber-700"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t("Kirim Presensi — {dir}", "Send Attendance — {dir}", { dir: dirLabel })}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={reset}
                className="h-11 w-full gap-2 rounded-xl text-[12.5px] font-bold"
              >
                <RefreshCcw className="h-4 w-4" /> {t("Ambil Ulang", "Retake")}
              </Button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className={cn("h-11 w-full rounded-xl text-[12.5px] font-bold text-slate-500 transition hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200")}
          >
            {t("Batal", "Cancel")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
