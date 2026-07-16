// Конфигурация внешнего вида двух опциональных механик поверх основного
// /embed/{projectId}.js — плавающей кнопки и слайд-плашки, обе отдаются
// одним файлом /embed/{projectId}/widgets.js. Живёт в projects.widget_config
// (jsonb, миграция 0014). Резолверы ниже — единственное место, где
// расходятся дефолты/валидация, используются и настройками (перед
// записью), и самим скриптом (при чтении — защита на случай кривых данных
// в колонке).

export type ButtonPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type ButtonSize = "s" | "m" | "l";

export type ButtonConfig = {
  enabled: boolean;
  text: string;
  color: string;
  position: ButtonPosition;
  size: ButtonSize;
};

export type PromptConfig = {
  enabled: boolean;
  title: string;
  body: string;
  color: string;
};

export const DEFAULT_BUTTON: ButtonConfig = {
  enabled: true,
  text: "Уведомления",
  color: "#2c4a66",
  position: "bottom-right",
  size: "m",
};

export const DEFAULT_PROMPT: PromptConfig = {
  enabled: false,
  title: "Получайте уведомления",
  body: "Узнавайте первыми о заказах и акциях",
  color: "#2c4a66",
};

export const BUTTON_POSITIONS: ButtonPosition[] = ["bottom-right", "bottom-left", "top-right", "top-left"];
export const BUTTON_SIZES: ButtonSize[] = ["s", "m", "l"];
const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function resolveButtonConfig(raw: unknown): ButtonConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<ButtonConfig>;
  return {
    enabled: c.enabled !== false,
    text: typeof c.text === "string" && c.text.trim() ? c.text.trim().slice(0, 40) : DEFAULT_BUTTON.text,
    color: typeof c.color === "string" && HEX.test(c.color.trim()) ? c.color.trim() : DEFAULT_BUTTON.color,
    position: BUTTON_POSITIONS.includes(c.position as ButtonPosition) ? (c.position as ButtonPosition) : DEFAULT_BUTTON.position,
    size: BUTTON_SIZES.includes(c.size as ButtonSize) ? (c.size as ButtonSize) : DEFAULT_BUTTON.size,
  };
}

export function resolvePromptConfig(raw: unknown): PromptConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<PromptConfig>;
  return {
    enabled: c.enabled === true,
    title: typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, 60) : DEFAULT_PROMPT.title,
    body: typeof c.body === "string" && c.body.trim() ? c.body.trim().slice(0, 140) : DEFAULT_PROMPT.body,
    color: typeof c.color === "string" && HEX.test(c.color.trim()) ? c.color.trim() : DEFAULT_PROMPT.color,
  };
}
