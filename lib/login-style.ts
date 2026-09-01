import type { CornerRadius } from "@/lib/widget-config";

// Визуальное оформление кнопки/инпута/логотипа на странице входа
// (app/oidc/[projectId]/auth/route.ts) — oidc_clients.config.login_style
// (jsonb). Тот же паттерн, что и lib/widget-config.ts: единственное место,
// где расходятся дефолты/валидация, используется и настройками (перед
// записью), и самой страницей входа (при чтении — защита от кривых данных).

export type LoginSize = "s" | "m" | "l";

export type LoginStyleConfig = {
  buttonSize: LoginSize;
  buttonColor: string;
  buttonTextColor: string;
  inputSize: LoginSize;
  borderRadius: CornerRadius;
  textColor: string;
  logoSize: LoginSize;
};

export const DEFAULT_LOGIN_STYLE: LoginStyleConfig = {
  buttonSize: "m",
  buttonColor: "#2c4a66",
  buttonTextColor: "#ffffff",
  inputSize: "m",
  borderRadius: "md",
  textColor: "#16202a",
  logoSize: "m",
};

export const LOGIN_SIZES: LoginSize[] = ["s", "m", "l"];
export const LOGIN_RADIUS_VALUES: CornerRadius[] = ["none", "sm", "md", "lg"];
const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function resolveLoginStyle(raw: unknown): LoginStyleConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<LoginStyleConfig>;
  return {
    buttonSize: LOGIN_SIZES.includes(c.buttonSize as LoginSize) ? (c.buttonSize as LoginSize) : DEFAULT_LOGIN_STYLE.buttonSize,
    buttonColor: typeof c.buttonColor === "string" && HEX.test(c.buttonColor.trim()) ? c.buttonColor.trim() : DEFAULT_LOGIN_STYLE.buttonColor,
    buttonTextColor:
      typeof c.buttonTextColor === "string" && HEX.test(c.buttonTextColor.trim())
        ? c.buttonTextColor.trim()
        : DEFAULT_LOGIN_STYLE.buttonTextColor,
    inputSize: LOGIN_SIZES.includes(c.inputSize as LoginSize) ? (c.inputSize as LoginSize) : DEFAULT_LOGIN_STYLE.inputSize,
    borderRadius: LOGIN_RADIUS_VALUES.includes(c.borderRadius as CornerRadius)
      ? (c.borderRadius as CornerRadius)
      : DEFAULT_LOGIN_STYLE.borderRadius,
    textColor: typeof c.textColor === "string" && HEX.test(c.textColor.trim()) ? c.textColor.trim() : DEFAULT_LOGIN_STYLE.textColor,
    logoSize: LOGIN_SIZES.includes(c.logoSize as LoginSize) ? (c.logoSize as LoginSize) : DEFAULT_LOGIN_STYLE.logoSize,
  };
}

// Пиксельные/CSS-таблицы — общий источник и для реальной страницы входа, и
// для превью в админке (см. app/admin/projects/[id]/auth/LoginStylePreview.tsx),
// чтобы они не могли разойтись визуально. Паддинги — в px (не rem), чтобы
// высота элемента считалась однозначно ниже (line-height:1 в CSS страницы
// входа — см. route.ts).
export const BUTTON_SIZE_CSS: Record<LoginSize, { padding: string; fontSize: number }> = {
  s: { padding: "8px 12px", fontSize: 14 },
  m: { padding: "12px 14px", fontSize: 16 },
  l: { padding: "16px 18px", fontSize: 18 },
};
export const INPUT_SIZE_CSS: Record<LoginSize, { padding: string; fontSize: number }> = {
  s: { padding: "8px 10px", fontSize: 15 },
  m: { padding: "10px 12px", fontSize: 17 },
  l: { padding: "13px 16px", fontSize: 19 },
};

// Радиус — доля от реальной высоты элемента ПРИ ЕГО ТЕКУЩЕМ РАЗМЕРЕ, не
// плоский px на все размеры (тот же приём, что и BUTTON_RADIUS_PX в
// lib/widget-scripts.ts — иначе одинаковый px либо превышает половину
// высоты маленького элемента, либо выглядит слишком тонким на большом).
// sm ≈ четверть высоты, md ≈ 40% высоты, lg = 999px — гарантированная
// пилюля при любом размере (браузер сам обрежет радиус до height/2).
// Высота = paddingTop+paddingBottom (см. таблицы выше) + fontSize.
export const BUTTON_RADIUS_PX: Record<LoginSize, Record<CornerRadius, string>> = {
  s: { none: "0px", sm: "8px", md: "12px", lg: "999px" }, // высота 8*2+14=30
  m: { none: "0px", sm: "10px", md: "16px", lg: "999px" }, // высота 12*2+16=40
  l: { none: "0px", sm: "13px", md: "20px", lg: "999px" }, // высота 16*2+18=50
};
export const INPUT_RADIUS_PX: Record<LoginSize, Record<CornerRadius, string>> = {
  s: { none: "0px", sm: "8px", md: "12px", lg: "999px" }, // высота 8*2+15=31
  m: { none: "0px", sm: "9px", md: "15px", lg: "999px" }, // высота 10*2+17=37
  l: { none: "0px", sm: "11px", md: "18px", lg: "999px" }, // высота 13*2+19=45
};
export const LOGO_SIZE_PX: Record<LoginSize, number> = { s: 56, m: 88, l: 128 };
