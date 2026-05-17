import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SIGmile · 物流配送管理",
  description: "SIGmile manager console",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
