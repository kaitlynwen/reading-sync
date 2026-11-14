import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppBootstrap from "@/components/AppBootstrap";
import BackendSetup from "@/components/BackendSetup";
import CommandPalette from "@/components/CommandPalette";
import PlatformClass from "@/components/PlatformClass";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reading Sync",
  description: "Stay on the same chapter as your friends.",
  applicationName: "Reading Sync",
  appleWebApp: {
    capable: true,
    title: "Reading Sync",
    statusBarStyle: "black",
  },
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PlatformClass />
        <AppBootstrap>
          <BackendSetup>{children}</BackendSetup>
          {/* Global Cmd/Ctrl+K command palette (task 14.5). Mounted once at the
              root so the accelerator works from any screen. */}
          <CommandPalette />
        </AppBootstrap>
      </body>
    </html>
  );
}
