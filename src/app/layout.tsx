import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "@/components/ui/sonner";

// Task 85 — tema SayOne-Learning: Inter sebagai font utama.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif — KHUSUS dokumen surat resmi (letter preview/print);
// layar aplikasi memakai Inter (tema SayOne-Learning, Task 85).
const playfair = Playfair_Display({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "RekanKerja — Human Resource Base",
  description:
    "RekanKerja HR Suite: modern Human Resource Base platform — organizational structure, positions, employee master data, personnel action workflow, and approval engine.",
  keywords: ["RekanKerja", "HRIS", "Human Resource Base", "Personnel Action", "HR Indonesia"],
  // PWA (Task 27-d) — manifest + dukungan iOS standalone + ikon brand.
  applicationName: "RekanKerja",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RekanKerja",
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180x180.png", sizes: "180x180", type: "image/png" }],
  },
};

// PWA (Task 27-d) — warna bilah browser/OS mengikuti tema biru SayOne-Learning (Task 85).
export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${geistMono.variable} ${playfair.variable} font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster />
          <Sonner position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
