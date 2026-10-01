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
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
