"use client";

import { useState } from "react";
import type { LoginStyleConfig } from "@/lib/login-style";
import { BUTTON_SIZE_CSS, INPUT_SIZE_CSS, BUTTON_RADIUS_PX, INPUT_RADIUS_PX, LOGO_SIZE_PX } from "@/lib/login-style";
import { DeviceStage, PreviewCard, type PreviewDevice } from "../widget/DevicePreview";

// Плейсхолдер-текст масштабируется вместе с реальным размером логотипа
// (LOGO_SIZE_PX), просто в шрифтовых px вместо px-квадрата — иначе
// переключатель размера в превью визуально ничего не менял.
const LOGO_TEXT_PX: Record<keyof typeof LOGO_SIZE_PX, number> = { s: 16, m: 20, l: 28 };

// Живой мокап страницы входа — те же таблицы стилей, что и реальная
// страница (app/oidc/[projectId]/auth/route.ts, функция page()), поэтому
// превью не может визуально разойтись с тем, что увидит покупатель. Показан
// так же, как предпросмотр виджетов: рамка телефона или окно браузера с
// переключателем. Страница входа открывается отдельной страницей (белый фон,
// колонка до 420px), а не поверх витрины, поэтому заглушки сайта на фоне нет.
// Сам логотип (файл) настраивается в общих настройках проекта — здесь
// просто плейсхолдер-текст, чтобы не тянуть реальную загрузку файла в превью.
export default function LoginStylePreview({ config }: { config: LoginStyleConfig }) {
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const inputRadius = INPUT_RADIUS_PX[config.inputSize][config.borderRadius];
  const buttonRadius = BUTTON_RADIUS_PX[config.buttonSize][config.borderRadius];
  const inputCss = INPUT_SIZE_CSS[config.inputSize];
  const buttonCss = BUTTON_SIZE_CSS[config.buttonSize];

  return (
    <PreviewCard
      value={device}
      onChange={setDevice}
      options={[
        { value: "phone", label: "Телефон" },
        { value: "desktop", label: "Компьютер" },
      ]}
    >
      <DeviceStage device={device} skeleton={false}>
        <div className="absolute inset-0 bg-white flex justify-center overflow-hidden">
          <div className="w-full max-w-[320px] px-5 pt-[10%]" style={{ color: config.textColor }}>
            <div className="text-center mb-4 font-bold" style={{ fontSize: LOGO_TEXT_PX[config.logoSize], color: config.textColor }}>
              ЛОГО
            </div>
            <div className="text-center font-semibold mb-4" style={{ fontSize: 20 }}>
              Вход по номеру телефона
            </div>
            <div
              className="w-full box-border"
              style={{
                border: "1px solid #c3ccd6",
                borderRadius: inputRadius,
                padding: inputCss.padding,
                fontSize: inputCss.fontSize,
                lineHeight: 1,
                color: "#8b95a1",
              }}
            >
              +7 999 123-45-67
            </div>
            <div
              className="w-full mt-3 flex items-center justify-center font-medium cursor-default select-none"
              style={{
                borderRadius: buttonRadius,
                padding: buttonCss.padding,
                fontSize: buttonCss.fontSize,
                lineHeight: 1,
                background: config.buttonColor,
                color: config.buttonTextColor,
              }}
            >
              Получить код
            </div>
            <div className="text-center mt-3" style={{ fontSize: 14, color: "#5a6570" }}>
              Отправим код подтверждения — push-уведомлением, в Telegram или по SMS.
            </div>
          </div>
        </div>
      </DeviceStage>
    </PreviewCard>
  );
}
