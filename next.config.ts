import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // nodemailer dimuat saat RUNTIME dari node_modules (tidak dibundel saat build)
  // → bila paket belum terpasang, app tetap jalan; kirim email didegradasi jadi
  // pesan jelas di log/tes kirim, BUKAN build error mematikan seluruh aplikasi.
  serverExternalPackages: ["nodemailer"],
  // indikator dev-tools Next.js (portal mengambang kiri-bawah) menutupi tombol
  // Pengaturan di rail — dimatikan agar preview bersih; error tetap terlihat di dev.log
  devIndicators: false,
};

export default nextConfig;
