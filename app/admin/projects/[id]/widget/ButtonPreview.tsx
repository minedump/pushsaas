"use client";

import { useState } from "react";
import type { ButtonConfig } from "@/lib/widget-config";
import { BELL_SVG, CLOSE_SVG, buttonBaseStyle } from "@/lib/widget-scripts";
import { DeviceStage, PreviewCard, type PreviewDevice } from "./DevicePreview";

// Живой мокап плавающей кнопки — те же стилевые константы, что и реально
// сгенерированный скрипт (lib/widget-scripts.ts), поэтому превью не может
// визуально разойтись с тем, что увидит посетитель. Чисто презентационная
// разметка — без localStorage/Notification/service worker.
export default function ButtonPreview({ config }: { config: ButtonConfig }) {
  const [device, setDevice] = useState<PreviewDevice>("phone");
  return (
    <PreviewCard
      value={device}
      onChange={setDevice}
      options={[
        { value: "phone", label: "Телефон" },
        { value: "desktop", label: "Компьютер" },
      ]}
    >
      <DeviceStage device={device}>
        {config.enabled && (
          <div
            className="absolute inline-flex items-center font-semibold"
            style={{ ...buttonBaseStyle(config), position: "absolute", zIndex: 1, cursor: "default" }}
          >
            <span className="shrink-0" dangerouslySetInnerHTML={{ __html: BELL_SVG }} />
            <span className="ml-2">{config.text || "Уведомления"}</span>
            <span className="ml-2 opacity-70 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: CLOSE_SVG }} />
          </div>
        )}
      </DeviceStage>
    </PreviewCard>
  );
}
