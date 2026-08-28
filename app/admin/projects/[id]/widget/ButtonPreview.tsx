"use client";

import type { ButtonConfig } from "@/lib/widget-config";
import { BELL_SVG, CLOSE_SVG, buttonBaseStyle } from "@/lib/widget-scripts";

// Живой мокап плавающей кнопки — те же стилевые константы, что и реально
// сгенерированный скрипт (lib/widget-scripts.ts), поэтому превью не может
// визуально разойтись с тем, что увидит посетитель. Чисто презентационная
// разметка — без localStorage/Notification/service worker.
export default function ButtonPreview({ config }: { config: ButtonConfig }) {
  return (
    <div className="relative h-56 rounded-xl border border-border bg-surface-2 overflow-hidden">
      <div className="p-4 flex flex-col gap-2 opacity-30">
        <div className="h-2.5 w-2/3 rounded bg-ink-faint" />
        <div className="h-2.5 w-1/2 rounded bg-ink-faint" />
        <div className="h-2.5 w-5/6 rounded bg-ink-faint" />
      </div>
      <div
        className="absolute inline-flex items-center font-semibold"
        style={{ ...buttonBaseStyle(config), position: "absolute", zIndex: 1, cursor: "default" }}
      >
        <span className="shrink-0" dangerouslySetInnerHTML={{ __html: BELL_SVG }} />
        <span className="ml-2">{config.text || "Уведомления"}</span>
        <span className="ml-2 opacity-70 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: CLOSE_SVG }} />
      </div>
    </div>
  );
}
