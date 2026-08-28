import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SENDERA — платформа веб-пушей",
  description: "Веб-push уведомления для сайтов: Android и iPhone (iOS 16.4+).",
};

// Ставим data-theme ДО гидратации React (см. ThemeToggle в AdminShell.tsx) —
// иначе первый кадр всегда рисуется по системной теме, и при явном выборе
// темы, противоположной системной, был бы заметен мигающий пересвет (FOUC)
// между первой отрисовкой и применением сохранённого выбора.
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('sendera-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-theme ставится инлайн-скриптом ниже до гидратации — это ОЖИДАЕМОЕ
  // расхождение с серверным рендером (сервер темы не знает),
  // suppressHydrationWarning отключает предупреждение именно и только по
  // этому тегу/атрибутам, не по всему дереву.
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
