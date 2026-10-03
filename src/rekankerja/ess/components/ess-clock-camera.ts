"use client";
// RekanKerja ESS — hook kamera bersama utk widget presensi (Task 100 F1, agen E):
//   · SelfieDialog (G13/G30) — facingMode "user";
//   · QrKioskDialog (G17) — facingMode "environment" (kamera belakang).
// Jaminan cleanup: SEMUA track di-stop saat dialog ditutup, komponen unmount,
// atau stream berganti — tidak ada kamera yang tetap menyala di latar.
import { useCallback, useEffect, useRef, useState } from "react";

export interface CameraStreamApi {
  /** Ref utk elemen <video> pemanggil (srcObject di-set hook). */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** true setelah stream terpasang & play() sukses — video siap dibaca. */
  ready: boolean;
  /** non-null bila getUserMedia gagal/ditolak/tdk didukung (kode "camera"). */
  error: string | null;
  /** Stop manual (mis. setelah foto tercapture) — dipanggil juga otomatis. */
  stop: () => void;
}

/**
 * Buka getUserMedia saat `active` true; lepas & stop SEMUA track saat `active`
 * false / unmount. Dipakai di dalam dialog — pastikan `active` = dialog terbuka
 * DAN tahap yang membutuhkan kamera (mis. belum ada foto tercapture).
 */
export function useCameraStream(active: boolean, facing: "user" | "environment"): CameraStreamApi {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    let cancelled = false;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("unsupported");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) setError("camera");
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, facing, stop]);

  return { videoRef, ready, error, stop };
}
