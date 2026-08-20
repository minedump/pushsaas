import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SENDERA — платформа веб-пушей",
  description: "Веб-push уведомления для сайтов: Android и iPhone (iOS 16.4+).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
