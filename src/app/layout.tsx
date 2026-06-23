import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/shell";
import { readConfig } from "@/lib/config";
import { NO_FLASH_SCRIPT } from "@/lib/themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interface Manager — SoC HW/SW Interface",
  description: "SFR & HAL viewer, changelog and reuse statistics for SoC projects",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfg = readConfig();
  const projects = cfg.projects.map((p) => ({ id: p.id, name: p.name, codename: p.codename }));

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* apply the saved theme before first paint to avoid a light-mode flash */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="h-full">
        <Shell projects={projects}>{children}</Shell>
      </body>
    </html>
  );
}
