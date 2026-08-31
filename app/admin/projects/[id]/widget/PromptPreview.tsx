"use client";

import type { PromptConfig } from "@/lib/widget-config";
import { BELL_SVG, PROMPT_BUTTON_RADIUS_PX, promptDesktopStyle, promptMobileStyle } from "@/lib/widget-scripts";

// Живой мокап плашки — реальное поведение отличается на мобильном
// (полоса на всю ширину сверху) и на десктопе (карточка 300px слева
// вверху), поэтому показываем оба варианта сразу. Те же стилевые
// функции, что использует сгенерированный скрипт (lib/widget-scripts.ts).
// iOS всегда рендерится в мобильной позиции (Safari на iPhone — узкий
// viewport, "mobile" = window.matchMedia("(max-width: 640px)") всегда true),
// но с текстом config.iosBody вместо config.body и без кнопки «Разрешить» —
// Safari вне режима «На экране «Домой»» не может спросить разрешение,
// см. homeScreen в lib/widget-scripts.ts.
function Card({ config, variant }: { config: PromptConfig; variant: "mobile" | "desktop" | "ios" }) {
  const base = variant === "desktop" ? promptDesktopStyle(config) : promptMobileStyle(config);
  const actionsRow = variant !== "desktop";
  const ios = variant === "ios";
  return (
    <div
      className="shadow-lg"
      style={{
        ...base,
        position: "absolute",
        zIndex: 1,
        fontFamily: "-apple-system,'Segoe UI',sans-serif",
        flexWrap: actionsRow ? "wrap" : "nowrap",
        cursor: "default",
      }}
    >
      <div className="shrink-0 pt-px" style={{ color: config.color || "#2c4a66" }} dangerouslySetInnerHTML={{ __html: BELL_SVG }} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold leading-tight">{config.title || "Получайте уведомления"}</div>
        <div className="text-[12.5px] leading-snug mt-0.5" style={{ color: config.cardTextColor || "#16202a", opacity: 0.65 }}>
          {ios
            ? config.iosBody || "Добавьте сайт на экран «Домой», чтобы получать уведомления на iPhone."
            : config.body || "Узнавайте первыми о заказах и акциях"}
        </div>
      </div>
      <div className={`shrink-0 flex gap-1.5 ${actionsRow ? "flex-row w-full mt-2" : "flex-col"}`}>
        <button
          type="button"
          className={`border-none font-semibold text-[12.5px] px-3 py-1.5 whitespace-nowrap cursor-default ${actionsRow ? "flex-1" : ""}`}
          style={{
            background: config.secondaryBg || "#f0f2f4",
            color: config.secondaryColor || "#5a6570",
            borderRadius: PROMPT_BUTTON_RADIUS_PX[config.borderRadius],
          }}
        >
          Не сейчас
        </button>
        {!ios && (
          <button
            type="button"
            className={`border-none font-semibold text-[12.5px] px-3 py-1.5 whitespace-nowrap cursor-default ${actionsRow ? "flex-1" : ""}`}
            style={{
              background: config.color || "#2c4a66",
              color: config.textColor || "#ffffff",
              borderRadius: PROMPT_BUTTON_RADIUS_PX[config.borderRadius],
            }}
          >
            Разрешить
          </button>
        )}
      </div>
    </div>
  );
}

export default function PromptPreview({ config }: { config: PromptConfig }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <div className="text-[11px] text-ink-faint mb-1.5">Мобильный</div>
        <div className="relative h-40 rounded-xl border border-border bg-surface-2 overflow-hidden">
          <Card config={config} variant="mobile" />
        </div>
      </div>
      <div>
        <div className="text-[11px] text-ink-faint mb-1.5">Десктоп</div>
        <div className="relative h-40 rounded-xl border border-border bg-surface-2 overflow-hidden">
          <Card config={config} variant="desktop" />
        </div>
      </div>
      <div>
        <div className="text-[11px] text-ink-faint mb-1.5">iPhone (не на экране «Домой»)</div>
        <div className="relative h-40 rounded-xl border border-border bg-surface-2 overflow-hidden">
          <Card config={config} variant="ios" />
        </div>
      </div>
    </div>
  );
}
