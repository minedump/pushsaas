// Конфигурация внешнего вида двух опциональных механик поверх основного
// /embed/{projectId}.js — плавающей кнопки и слайд-плашки, обе слиты в тот
// же единственный скрипт (см. lib/widget-scripts.ts), отдельного
// widgets.js больше нет. Живёт в projects.widget_config (jsonb, миграция
// 0014). Резолверы ниже — единственное место, где расходятся дефолты/
// валидация, используются и настройками (перед записью), и самим скриптом
// (при чтении — защита на случай кривых данных в колонке).

export type ButtonPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type ButtonSize = "s" | "m" | "l";
export type CornerRadius = "none" | "sm" | "md" | "lg";

export type ButtonConfig = {
  enabled: boolean;
  text: string;
  color: string;
  textColor: string;
  position: ButtonPosition;
  size: ButtonSize;
  borderRadius: CornerRadius;
  dismissDays: number;
  delaySeconds: number;
  minPageViews: number;
};

export type PromptConfig = {
  enabled: boolean;
  title: string;
  body: string;
  iosBody: string;
  color: string;
  textColor: string;
  secondaryColor: string;
  secondaryBg: string;
  cardBg: string;
  cardTextColor: string;
  borderRadius: CornerRadius;
  dismissDays: number;
  delaySeconds: number;
  minPageViews: number;
};

export const DEFAULT_BUTTON: ButtonConfig = {
  enabled: true,
  text: "Уведомления",
  color: "#2c4a66",
  textColor: "#ffffff",
  position: "bottom-right",
  size: "m",
  borderRadius: "lg",
  dismissDays: 1,
  delaySeconds: 0,
  minPageViews: 1,
};

export const DEFAULT_PROMPT: PromptConfig = {
  enabled: false,
  title: "Получайте уведомления",
  body: "Узнавайте первыми о заказах и акциях",
  iosBody: "Добавьте сайт на экран «Домой», чтобы получать уведомления на iPhone.",
  color: "#2c4a66",
  textColor: "#ffffff",
  secondaryColor: "#5a6570",
  secondaryBg: "#f0f2f4",
  cardBg: "#ffffff",
  cardTextColor: "#16202a",
  borderRadius: "lg",
  dismissDays: 1,
  delaySeconds: 0,
  minPageViews: 1,
};

export const BUTTON_POSITIONS: ButtonPosition[] = ["bottom-right", "bottom-left", "top-right", "top-left"];
export const BUTTON_SIZES: ButtonSize[] = ["s", "m", "l"];
export const CORNER_RADIUS_VALUES: CornerRadius[] = ["none", "sm", "md", "lg"];
const HEX = /^#[0-9a-fA-F]{3,8}$/;

function resolveCornerRadius(raw: unknown, fallback: CornerRadius): CornerRadius {
  return CORNER_RADIUS_VALUES.includes(raw as CornerRadius) ? (raw as CornerRadius) : fallback;
}

// И у кнопки, и у плашки — сколько дней молчать после того, как посетитель
// закрыл/отклонил виджет на этом устройстве (localStorage-метка времени +
// TTL, см. lib/widget-scripts.ts). 0 и меньше не допускаем — "не показывать
// больше никогда" отдельно уже покрыт полной проверкой sendera.isSubscribed(),
// а не нулевой паузой.
function resolveDismissDays(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.round(n))) : fallback;
}

// Задержка показа (сек. после того, как выполнены остальные условия — не
// заблокирован, не в паузе) и минимум просмотренных страниц за визит,
// прежде чем виджет вообще имеет право показаться. 0/1 — прежнее поведение
// "сразу на первой странице", менять не обязан никто.
function resolveDelaySeconds(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(120, Math.max(0, Math.round(n))) : fallback;
}
function resolveMinPageViews(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(20, Math.max(1, Math.round(n))) : fallback;
}

export function resolveButtonConfig(raw: unknown): ButtonConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<ButtonConfig>;
  return {
    enabled: c.enabled !== false,
    text: typeof c.text === "string" && c.text.trim() ? c.text.trim().slice(0, 40) : DEFAULT_BUTTON.text,
    color: typeof c.color === "string" && HEX.test(c.color.trim()) ? c.color.trim() : DEFAULT_BUTTON.color,
    textColor: typeof c.textColor === "string" && HEX.test(c.textColor.trim()) ? c.textColor.trim() : DEFAULT_BUTTON.textColor,
    position: BUTTON_POSITIONS.includes(c.position as ButtonPosition) ? (c.position as ButtonPosition) : DEFAULT_BUTTON.position,
    size: BUTTON_SIZES.includes(c.size as ButtonSize) ? (c.size as ButtonSize) : DEFAULT_BUTTON.size,
    borderRadius: resolveCornerRadius(c.borderRadius, DEFAULT_BUTTON.borderRadius),
    dismissDays: resolveDismissDays(c.dismissDays, DEFAULT_BUTTON.dismissDays),
    delaySeconds: resolveDelaySeconds(c.delaySeconds, DEFAULT_BUTTON.delaySeconds),
    minPageViews: resolveMinPageViews(c.minPageViews, DEFAULT_BUTTON.minPageViews),
  };
}

export function resolvePromptConfig(raw: unknown): PromptConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<PromptConfig>;
  return {
    enabled: c.enabled === true,
    title: typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, 60) : DEFAULT_PROMPT.title,
    body: typeof c.body === "string" && c.body.trim() ? c.body.trim().slice(0, 140) : DEFAULT_PROMPT.body,
    iosBody: typeof c.iosBody === "string" && c.iosBody.trim() ? c.iosBody.trim().slice(0, 140) : DEFAULT_PROMPT.iosBody,
    color: typeof c.color === "string" && HEX.test(c.color.trim()) ? c.color.trim() : DEFAULT_PROMPT.color,
    textColor: typeof c.textColor === "string" && HEX.test(c.textColor.trim()) ? c.textColor.trim() : DEFAULT_PROMPT.textColor,
    secondaryColor:
      typeof c.secondaryColor === "string" && HEX.test(c.secondaryColor.trim()) ? c.secondaryColor.trim() : DEFAULT_PROMPT.secondaryColor,
    secondaryBg: typeof c.secondaryBg === "string" && HEX.test(c.secondaryBg.trim()) ? c.secondaryBg.trim() : DEFAULT_PROMPT.secondaryBg,
    cardBg: typeof c.cardBg === "string" && HEX.test(c.cardBg.trim()) ? c.cardBg.trim() : DEFAULT_PROMPT.cardBg,
    cardTextColor: typeof c.cardTextColor === "string" && HEX.test(c.cardTextColor.trim()) ? c.cardTextColor.trim() : DEFAULT_PROMPT.cardTextColor,
    borderRadius: resolveCornerRadius(c.borderRadius, DEFAULT_PROMPT.borderRadius),
    dismissDays: resolveDismissDays(c.dismissDays, DEFAULT_PROMPT.dismissDays),
    delaySeconds: resolveDelaySeconds(c.delaySeconds, DEFAULT_PROMPT.delaySeconds),
    minPageViews: resolveMinPageViews(c.minPageViews, DEFAULT_PROMPT.minPageViews),
  };
}
