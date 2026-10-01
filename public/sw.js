/* RekanKerja HRIS — service worker (Task 27-d, P1: PWA installable)
 * Vanilla JS tanpa bundler — disajikan apa adanya dari public/sw.js.
 *
 * Strategi (DEV-SAFE — server dev Next.js + hot reload tetap hidup):
 *  · /api/*      → SELALU network (tidak di-respondWith sama sekali).
 *  · non-GET     → dilewati.
 *  · cross-origin→ dilewati (browser yang mengurus).
 *  · /_next/static/* → stale-while-revalidate: jawab instan dari cache bila
 *    ada, lalu segarkan cache di belakang layar. Di PROD aset ini
 *    content-hashed, tapi di DEV sebagian nama chunk TIDAK di-hash
 *    (mis. _buildManifest.js) — cache-first murni akan melayani chunk basi
 *    dan merusak hot reload; SWR menjaga keduanya.
 *  · /icons/*, /logo.svg, /manifest.webmanifest → cache-first murni
 *    (aset publik statis; ganti isi = ganti nama file).
 *  · navigasi (request.mode === "navigate") → network-first dan HTML
 *    TIDAK PERNAH di-cache (aman untuk dev server yang merender ulang);
 *    saat offline → /offline.html yang di-precache saat install.
 *  · sisanya → passthrough network.
 * Semua dibungkus defensif: SW gagal = aplikasi tetap jalan normal.
 */
const CACHE = "rekankerja-w27-v1";

const PRECACHE = [
  "/manifest.webmanifest",
  "/logo.svg",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-192x192.png",
  "/offline.html",
];

// Aset publik immutable — cache-first murni.
const STATIC_EXACT = new Set(["/logo.svg", "/manifest.webmanifest"]);
const STATIC_PREFIX = "/icons/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll(PRECACHE);
      } catch (_err) {
        // Precache gagal (mis. satu file 404) — install tetap lanjut;
        // aset akan terisi bertahap saat pertama kali diminta.
      }
      try {
        await self.skipWaiting();
      } catch (_err) { /* non-fatal */ }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        );
        await self.clients.claim();
      } catch (_err) { /* non-fatal */ }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_err) {
    return;
  }
  if (url.origin !== self.location.origin) return; // cross-origin → browser
  if (url.pathname.startsWith("/api/")) return; // API → selalu network

  const p = url.pathname;

  // ---- /_next/static/* → stale-while-revalidate (dev-safe) ----
  if (p.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              try {
                cache.put(req, res.clone()).catch(() => {});
              } catch (_err) { /* body sudah dipakai — abaikan */ }
            }
            return res;
          })
          .catch(() => undefined);
        if (cached) {
          try {
            event.waitUntil(refresh); // segarkan cache tanpa memblok respons
          } catch (_err) { /* event sudah selesai — abaikan */ }
          return cached;
        }
        const fresh = await refresh;
        return fresh || new Response("", { status: 504, statusText: "Offline" });
      })()
    );
    return;
  }

  // ---- aset publik immutable → cache-first ----
  if (STATIC_EXACT.has(p) || p.startsWith(STATIC_PREFIX)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            try {
              cache.put(req, res.clone()).catch(() => {});
            } catch (_err) { /* abaikan */ }
          }
          return res;
        } catch (_err) {
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // ---- navigasi halaman → network-first, HTML tidak di-cache ----
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch (_err) {
          try {
            const cache = await caches.open(CACHE);
            const offline = await cache.match("/offline.html");
            if (offline) return offline;
          } catch (_err2) { /* cache tidak tersedia — fallback teks */ }
          return new Response("RekanKerja — Anda sedang offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
  }
  // sisanya → passthrough network (tidak di-respondWith)
});
