import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Task 87 — panel preview platform memuat halaman dari domain
  // preview-chat-<sessionId>.space-z.ai yang di-proxy ke port 3000; tanpa ini
  // Next 16 menolak resource /_next/* dari origin asing (warning kini,
  // blokir 403 di versi mayor berikutnya). Wildcard mencakup semua sesi chat.
  allowedDevOrigins: ["*.space-z.ai"],
  // nodemailer dimuat saat RUNTIME dari node_modules (tidak dibundel saat build)
  // → bila paket belum terpasang, app tetap jalan; kirim email didegradasi jadi
  // pesan jelas di log/tes kirim, BUKAN build error mematikan seluruh aplikasi.
  serverExternalPackages: ["nodemailer"],
  // indikator dev-tools Next.js (portal mengambang kiri-bawah) menutupi tombol
  // Pengaturan di rail — dimatikan agar preview bersih; error tetap terlihat di dev.log
  devIndicators: false,
  // PWA (Task 27-d): service worker di-root scope & tidak boleh di-cache
  // oleh perantara mana pun — versi baru harus aktif segera setelah deploy.
  async headers() {
    const swHeaders = [
      {
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
    // AUD-DEPLOY (2-b HIGH-1) — security headers global.
    // HANYA PRODUCTION (NODE_ENV=production): di sandbox dev, aplikasi
    // di-embed iframe oleh panel preview (origin chat) — XFO/frame-ancestors
    // akan memutus preview. Saat `next build`, header keamanan penuh aktif.
    if (process.env.NODE_ENV !== "production") return swHeaders;
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      // ESS clock & kiosk memakai kamera (QR) + geolokasi — scoping per-fitur.
      { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          // Tanpa infrastruktur nonce, Next.js butuh inline utk bootstrap script
          // & style Tailwind/Radix — connect-src 'self' menutup exfiltrasi.
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "media-src 'self' blob:",
          // frame PDF 1721-A1 dirender via <iframe src="blob:..."> createObjectURL
          // pada sisi klien — 'self' saja menolak scheme blob: di prod
          // ("This content is blocked"). frame-src eksplisit, tetap ketat.
          "frame-src 'self' blob:",
          "frame-ancestors 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ];
    return [
      ...swHeaders,
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
