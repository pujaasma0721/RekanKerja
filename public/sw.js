/* RekanKerja HRIS — service worker (Task 27-d, P1: PWA installable)
 * Vanilla JS tanpa bundler — disajikan apa adanya dari public/sw.js.
 *
 * Strategi (DEV-SAFE — Task 87: chunk basi TIDAK PERNAH disajikan):
 *  · /api/*      → SELALU network (tidak di-respondWith sama sekali).
 *  · non-GET     → dilewati.
 *  · cross-origin→ dilewati (browser yang mengurus).
 *  · /_next/static/* → NETWORK-FIRST: selalu ambil dari server; cache hanya
 *    fallback saat offline. Di DEV sebagian nama chunk TIDAK di-hash (mis.
 *    _buildManifest.js) — strategi stale-while-revalidate lama terbukti
 *    menyajikan chunk basi pasca rebrand/theme change (preview "tidak jalan"),
 *    maka sejak v2 chunk basi tidak pernah lagi disajikan saat online.
 *  · /icons/*, /logo.svg, /manifest.webmanifest → cache-first murni
 *    (aset publik statis; ganti isi = ganti nama file).
 *  · navigasi (request.mode === "navigate") → network-first dan HTML
 *    TIDAK PERNAH di-cache (aman untuk dev server yang merender ulang);
 *    saat offline → /offline.html yang di-precache saat install.
 *  · sisanya → passthrough network.
 * Semua dibungkus defensif: SW gagal = aplikasi tetap jalan normal.
 */
const CACHE = "rekankerja-sw-v2";

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

self.addEventListener("message", (event) => {
  // Pola standar Workbox — memungkinkan halaman meminta SW baru langsung
  // aktif (dipakai alur pembaruan di pwa-register.tsx).
  if (event.data === "SKIP_WAITING") {
    try {
      self.skipWaiting();
    } catch (_err) { /* non-fatal */ }
  }
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

  // ---- /_next/static/* → network-first (Task 87: chunk basi tak pernah disajikan) ----
  if (p.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            try {
              const cache = await caches.open(CACHE);
              cache.put(req, res.clone()).catch(() => {});
            } catch (_err) { /* body sudah dipakai — abaikan */ }
          }
          return res;
        } catch (_err) {
          // Offline → coba cache (di PROD chunk content-hashed = versi benar;
          // di DEV koneksi sudah putus, halaman HTML pun tak akan termuat).
          try {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(req);
            if (cached) return cached;
          } catch (_err2) { /* cache tak tersedia */ }
          return new Response("", { status: 504, statusText: "Offline" });
        }
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
