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
};

export default nextConfig;
