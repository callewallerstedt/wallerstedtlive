import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";

import { TopNav } from "@/components/top-nav";

import "./globals.css";

const headlineFont = Cormorant_Garamond({
  variable: "--font-headline",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const bodyFont = Manrope({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Wallerstedt Control",
  title: "Wallerstedt Content Strategist",
  description: "AI strategist for TikTok content optimization with Spotify growth as the primary target.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wallerstedt Control",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/apple-touch-icon.png", sizes: "180x180", rel: "apple-touch-icon" },
    ],
    shortcut: "/apple-touch-icon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0a09",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${headlineFont.variable} ${bodyFont.variable} antialiased`}>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
