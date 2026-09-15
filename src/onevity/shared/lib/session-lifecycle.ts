"use client";
// OneVity session lifecycle client (Task 64k) — tiga lapisan kedaluwarsa:
// 1. Sliding refresh: /api/auth/me diperiodik (tiap 10 menit) — server menerbitkan
//    token segar bila sisa umur < 50% → pengguna aktif tak ter-logout hari ke-7.
// 2. Idle timeout: bila kebijakan tenant idleTimeoutMinutes > 0, sesi dimatikan
//    client-side setelah N menit TANPA interaksi (keydown/pointerdown/scroll).
// 3. Intersep 401: fetch global — respons 401 saat sesi "ready" → expire()
//    → AuthScreen dgn pesan "Sesi berakhir" (bukan error acak di halaman).
import { useEffect } from "react";
import { useSession } from "./session-store";

const KEEPALIVE_MS = 10 * 60 * 1000; // /api/auth/me tiap 10 menit (sliding refresh)

/** Catat aktivitas terakhir (throttle 10 dtk — jangan tulis tiap gerakan mouse). */
let lastActivity = Date.now();
let lastStamp = 0;

export function initSessionLifecycle() {
  if (typeof window === "undefined") return () => {};
  const onActivity = () => {
    const now = Date.now();
    if (now - lastStamp < 10_000) return;
    lastStamp = now;
    lastActivity = now;
  };
  const events: (keyof WindowEventMap)[] = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart", "scroll"];
  for (const ev of events) window.addEventListener(ev, onActivity, { passive: true, capture: true });

  const tick = window.setInterval(() => {
    const { status, info, expired, expire } = useSession.getState();
    if (status !== "ready" || expired) return;

    // ---- lapisan 2: idle timeout (kebijakan tenant) ----
    const idleMinutes = info?.idleTimeoutMinutes ?? 0;
    if (idleMinutes > 0 && Date.now() - lastActivity >= idleMinutes * 60_000) {
      void (async () => {
        try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* offline → tetap expire lokal */ }
        expire("idle");
      })();
      return;
    }

    // ---- lapisan 1: sliding refresh via /api/auth/me ----
    void fetch("/api/auth/me", { cache: "no-store" }).catch(() => {});
  }, KEEPALIVE_MS);

  return () => {
    window.clearInterval(tick);
    for (const ev of events) window.removeEventListener(ev, onActivity, { capture: true } as EventListenerOptions);
  };
}

/** Pasang interceptor fetch global: 401 saat sesi ready → expire("timeout"). */
export function installUnauthorizedInterceptor() {
  if (typeof window === "undefined") return () => {};
  const original = window.fetch.bind(window);
  const wrapped = (async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    if (res.status === 401) {
      const { status, expired, expire } = useSession.getState();
      // Hanya relevan saat sedang login (ready/select-tenant); jangan bereaksi
      // pada 401 login gagal (AuthScreen) — status di situ anonymous.
      if ((status === "ready" || status === "select-tenant") && !expired) {
        const path = typeof args[0] === "string" ? args[0] : (args[0] instanceof URL ? args[0].pathname : "");
        // /api/auth/me dipanggil keepalive & load() — 401 di situ ditangani store.
        if (!path.includes("/api/auth/")) expire("timeout");
      }
    }
    return res;
  }) as typeof fetch;
  // preserve static properties (mis. fetch.preconnect) — bungkus, bukan timpa mentah
  Object.assign(wrapped, original);
  window.fetch = wrapped;
  return () => {
    window.fetch = original;
  };
}

/** Hook bootstrap — dipasang SEKALI di AuthGate (pemilik gerbang sesi). */
export function useSessionLifecycle() {
  useEffect(() => {
    const cleanupA = initSessionLifecycle();
    const cleanupB = installUnauthorizedInterceptor();
    return () => { cleanupA(); cleanupB(); };
  }, []);
}
